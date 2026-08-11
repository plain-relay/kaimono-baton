import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  parseJsonStdout,
  requireSuccess,
} from './native-command.mjs'
import {
  MANUAL_TEST_STATE_SCHEMA_VERSION,
  acquireManualTestLock,
  isIncompleteManualTestState,
  readManualTestState,
  resolveStatePaths,
  writeManualTestStateAtomic,
} from './manual-test-state.mjs'

export const MANUAL_TEST_REPOSITORY = 'plain-relay/kaimono-baton'
export const MANUAL_TEST_WORKER_NAME = 'kaimono-baton-handwriting-import'
export const MANUAL_TEST_ALLOWED_ORIGIN = 'https://plain-relay.github.io'
export const MANUAL_TEST_TURNSTILE_HOSTNAME = 'plain-relay.github.io'
export const MANUAL_TEST_PUBLIC_URL =
  'https://plain-relay.github.io/kaimono-baton/'
export const MANUAL_TEST_DURATION_MS = 45 * 60 * 1000

export class ManualTestOrchestrationError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'ManualTestOrchestrationError'
    this.code = code
  }
}

function canonicalVariableFingerprint(variables) {
  const canonical = variables
    .map((variable) => ({
      name: String(variable?.name ?? ''),
      value: String(variable?.value ?? ''),
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
  return createHash('sha256')
    .update(JSON.stringify(canonical))
    .digest('hex')
}

function findVariable(variables, name) {
  return variables.find((variable) => variable?.name === name)?.value
}

export function summarizeRepositoryVariables(variables) {
  if (!Array.isArray(variables)) {
    throw new ManualTestOrchestrationError(
      'GitHub returned an invalid Repository Variable list.',
      'INVALID_REPOSITORY_VARIABLES',
    )
  }
  const importEnabled = String(
    findVariable(variables, 'VITE_HANDWRITING_IMPORT_ENABLED') ?? '',
  )
  const diagnosticsEnabled = String(
    findVariable(variables, 'VITE_HANDWRITING_DIAGNOSTICS_ENABLED') ?? '',
  )
  const endpointConfigured = Boolean(
    String(
      findVariable(variables, 'VITE_HANDWRITING_IMPORT_ENDPOINT') ?? '',
    ).trim(),
  )
  const turnstileSiteKeyConfigured = Boolean(
    String(
      findVariable(variables, 'VITE_TURNSTILE_SITE_KEY') ?? '',
    ).trim(),
  )
  return {
    importEnabled,
    diagnosticsEnabled,
    endpointConfigured,
    turnstileSiteKeyConfigured,
    fingerprint: canonicalVariableFingerprint(variables),
  }
}

export function assertSafeRepositoryVariables(summary) {
  if (
    summary.importEnabled !== 'false' ||
    summary.diagnosticsEnabled !== 'false' ||
    !summary.endpointConfigured ||
    !summary.turnstileSiteKeyConfigured
  ) {
    throw new ManualTestOrchestrationError(
      'Repository Variables are not in the required safe OFF state.',
      'REPOSITORY_VARIABLES_UNSAFE',
    )
  }
}

function createManualUrl(sessionId) {
  const url = new URL(MANUAL_TEST_PUBLIC_URL)
  url.searchParams.set('handwritingDiagnostics', '1')
  url.searchParams.set('manualTestSessionId', sessionId)
  url.hash = '/create'
  return url.toString()
}

function offSessionId(sessionId) {
  return `${sessionId}-off`
}

function nextOffSessionId(sessionId, createId) {
  const suffix = createId().replaceAll('-', '').slice(0, 12)
  if (!/^[A-Za-z0-9]{12}$/u.test(suffix)) {
    throw new ManualTestOrchestrationError(
      'Could not create a safe recovery attempt ID.',
      'INVALID_RECOVERY_ATTEMPT_ID',
    )
  }
  return `${sessionId}-off-${suffix}`
}

export function createManualTestOrchestrator({
  repositoryRoot,
  workerConfig = join(repositoryRoot, 'worker', 'wrangler.toml'),
  pagesClient,
  workerClient,
  runCaptured,
  runInteractive,
  logger = console,
  now = Date.now,
  createSessionId = randomUUID,
  createAttemptId = randomUUID,
  readState = readManualTestState,
  writeState = writeManualTestStateAtomic,
  acquireLock = acquireManualTestLock,
  wranglerInvocation = { command: 'npx', argsPrefix: [] },
}) {
  const { statePath, lockPath } = resolveStatePaths(repositoryRoot)
  let activeState
  let activeRecoveryPromise
  let interruptionReason

  function requestInterruption(reason = 'interrupted') {
    if (!interruptionReason) {
      interruptionReason = reason
    }
  }

  function assertNotInterrupted() {
    if (interruptionReason) {
      throw new ManualTestOrchestrationError(
        'The manual-test operation was interrupted.',
        'INTERRUPTED',
      )
    }
  }

  async function capturedText(command, args) {
    const result = await runCaptured(command, args, {
      cwd: repositoryRoot,
    })
    requireSuccess(command, result)
    return result.stdout.trim()
  }

  async function capturedJson(command, args) {
    const result = await runCaptured(command, args, {
      cwd: repositoryRoot,
    })
    return parseJsonStdout(command, result)
  }

  async function getRepositoryVariables() {
    const variables = await capturedJson('gh', [
      'variable',
      'list',
      '--repo',
      MANUAL_TEST_REPOSITORY,
      '--json',
      'name,value',
    ])
    return {
      raw: variables,
      summary: summarizeRepositoryVariables(variables),
    }
  }

  async function persist(state, patch) {
    const next = { ...state, ...patch }
    await writeState(statePath, next)
    if (activeState?.sessionId === next.sessionId) {
      activeState = next
    }
    return next
  }

  async function preflight({ ref = 'main', forStart = false } = {}) {
    if (forStart) {
      const existingState = await readState(statePath)
      if (isIncompleteManualTestState(existingState)) {
        throw new ManualTestOrchestrationError(
          'An unfinished manual-test session exists. Run status or recover.',
          'UNFINISHED_SESSION',
        )
      }
    }

    const branch = await capturedText('git', ['branch', '--show-current'])
    if (branch !== ref) {
      throw new ManualTestOrchestrationError(
        `Current branch must match the requested ref: ${ref}`,
        'BRANCH_MISMATCH',
      )
    }
    if (await capturedText('git', ['status', '--porcelain'])) {
      throw new ManualTestOrchestrationError(
        'The working tree must be clean.',
        'WORKTREE_DIRTY',
      )
    }
    const fetchExitCode = await runInteractive(
      'git',
      ['fetch', 'origin', ref],
      { cwd: repositoryRoot },
    )
    if (fetchExitCode !== 0) {
      throw new ManualTestOrchestrationError(
        'Could not fetch the requested origin ref.',
        'GIT_FETCH_FAILED',
      )
    }
    const mainSha = await capturedText('git', ['rev-parse', 'HEAD'])
    const remoteReference = await capturedText('git', [
      'ls-remote',
      '--exit-code',
      'origin',
      `refs/heads/${ref}`,
    ])
    const originSha = remoteReference.split(/\s+/u)[0]
    if (mainSha !== originSha || !/^[0-9a-f]{40}$/u.test(mainSha)) {
      throw new ManualTestOrchestrationError(
        'HEAD does not match the requested origin ref.',
        'REF_NOT_CURRENT',
      )
    }

    for (const [command, args] of [
      ['gh', ['auth', 'status']],
      [
        wranglerInvocation.command,
        [...wranglerInvocation.argsPrefix, 'wrangler', 'whoami'],
      ],
    ]) {
      const exitCode = await runInteractive(command, args, {
        cwd: repositoryRoot,
      })
      if (exitCode !== 0) {
        throw new ManualTestOrchestrationError(
          `${command} authentication check failed.`,
          'AUTH_CHECK_FAILED',
        )
      }
    }

    const configText = await readFile(workerConfig, 'utf8')
    const workerName =
      /^\s*name\s*=\s*"([^"]+)"\s*$/mu.exec(configText)?.[1]
    const allowedOrigin =
      /^\s*ALLOWED_ORIGINS\s*=\s*"([^"]+)"\s*$/mu.exec(configText)?.[1]
    if (
      workerName !== MANUAL_TEST_WORKER_NAME ||
      allowedOrigin !== MANUAL_TEST_ALLOWED_ORIGIN
    ) {
      throw new ManualTestOrchestrationError(
        'Worker configuration is not limited to the expected production origin.',
        'WORKER_CONFIG_UNSAFE',
      )
    }

    const variables = await getRepositoryVariables()
    assertSafeRepositoryVariables(variables.summary)
    const worker = await workerClient.getActiveWorker()
    if (
      worker.diagnosticMode !== 'false' ||
      worker.allowedOrigin !== MANUAL_TEST_ALLOWED_ORIGIN
    ) {
      throw new ManualTestOrchestrationError(
        'The active Worker is not in the required safe OFF state.',
        'WORKER_UNSAFE',
      )
    }
    await workerClient.verifyPreflightResources()
    const actor = await pagesClient.getAuthenticatedActor()
    await pagesClient.verifyDeploymentRefAllowed(ref)

    return {
      ref,
      mainSha,
      actor,
      variables: variables.summary,
      worker,
    }
  }

  async function verifyVariablesUnchanged(initialVariables) {
    const current = await getRepositoryVariables()
    assertSafeRepositoryVariables(current.summary)
    if (current.summary.fingerprint !== initialVariables.fingerprint) {
      throw new ManualTestOrchestrationError(
        'Repository Variables changed during the manual-test session.',
        'REPOSITORY_VARIABLES_CHANGED',
      )
    }
    return current.summary
  }

  async function recoverState(
    startingState,
    { recoveryStatus = 'recovered', reason = 'recover' } = {},
  ) {
    let state = startingState
    const failures = []
    const retryingOffDeployment = Boolean(
      state.pagesOffRunId ||
        state.phase === 'stop-requested' ||
        state.phase === 'pages-off-dispatched' ||
        state.phase === 'recovery-required',
    )
    const offId = retryingOffDeployment
      ? nextOffSessionId(state.sessionId, createAttemptId)
      : state.pagesOffSessionId || offSessionId(state.sessionId)
    state = await persist(state, {
      phase: 'stop-requested',
      pagesOffSessionId: offId,
      pagesOffRunId: null,
      recoveryStatus: `in-progress:${reason}`,
    })

    try {
      await pagesClient.verifyDeploymentRefAllowed(state.ref)
      const offRun = {
        ref: state.ref,
        mode: 'manual-off',
        sessionId: offId,
        headSha: state.mainSha,
        actor: state.actor,
      }
      await pagesClient.dispatch(offRun)
      state = await persist(state, {
        phase: 'pages-off-dispatched',
      })
      const detectedRun = await pagesClient.waitForRun(offRun)
      state = await persist(state, {
        pagesOffRunId: String(detectedRun.id),
      })
      const run = await pagesClient.watchRun(detectedRun.id)
      state = await persist(state, {
        pagesOffRunId: String(run.id),
      })
      await pagesClient.waitForManifest({
        commitSha: state.mainSha,
        mode: 'manual-off',
        sessionId: offId,
        importEnabled: false,
        diagnosticsEnabled: false,
      })
      state = await persist(state, {
        phase: 'pages-off-verified',
      })
    } catch (error) {
      failures.push(error)
    }

    try {
      const worker = await workerClient.restoreExactVersion(
        state.initialWorkerVersionId,
      )
      state = await persist(state, {
        phase: 'worker-restored',
        restoredWorkerDeploymentId: worker.deploymentId,
        restoredWorkerVersionId: worker.versionId,
      })
    } catch (error) {
      failures.push(error)
    }

    try {
      await verifyVariablesUnchanged(state.initialRepositoryVariables)
      const worker = await workerClient.getActiveWorker()
      if (
        worker.versionId !== state.initialWorkerVersionId ||
        worker.diagnosticMode !== 'false' ||
        worker.allowedOrigin !== MANUAL_TEST_ALLOWED_ORIGIN
      ) {
        throw new ManualTestOrchestrationError(
          'Final Worker state does not match the saved safe version.',
          'WORKER_FINAL_STATE_INVALID',
        )
      }
    } catch (error) {
      failures.push(error)
    }

    if (failures.length > 0) {
      state = await persist(state, {
        phase: 'recovery-required',
        recoveryStatus: `failed:${reason}`,
      })
      throw new ManualTestOrchestrationError(
        'Automatic recovery did not complete. Run the recover command.',
        'RECOVERY_FAILED',
      )
    }

    state = await persist(state, {
      phase: 'complete',
      recoveryStatus,
      completedAt: new Date(now()).toISOString(),
    })
    return state
  }

  async function recoverActiveSession(reason = 'interrupted') {
    if (!activeRecoveryPromise) {
      activeRecoveryPromise = activeState
        ? recoverState(activeState, {
            recoveryStatus: `recovered-after-${reason}`,
            reason,
          })
        : stop({ recover: true })
    }
    return activeRecoveryPromise
  }

  async function start({
    ref = 'main',
    injectFailure,
  } = {}) {
    interruptionReason = undefined
    const sessionId = createSessionId()
    const release = await acquireLock(lockPath, { sessionId })
    try {
      const context = await preflight({ ref, forStart: true })
      assertNotInterrupted()
      const startedAt = now()
      let state = {
        schemaVersion: MANUAL_TEST_STATE_SCHEMA_VERSION,
        sessionId,
        phase: 'prepared',
        startTime: new Date(startedAt).toISOString(),
        expirationTime: new Date(
          startedAt + MANUAL_TEST_DURATION_MS,
        ).toISOString(),
        repository: MANUAL_TEST_REPOSITORY,
        ref: context.ref,
        mainSha: context.mainSha,
        actor: context.actor,
        initialRepositoryVariables: context.variables,
        initialWorkerDeploymentId: context.worker.deploymentId,
        initialWorkerVersionId: context.worker.versionId,
        diagnosticWorkerDeploymentId: null,
        diagnosticWorkerVersionId: null,
        pagesOnRunId: null,
        pagesOffRunId: null,
        pagesOffSessionId: offSessionId(sessionId),
        manualURL: createManualUrl(sessionId),
        recoveryStatus: 'not-required',
      }
      await writeState(statePath, state)
      activeState = state
      activeRecoveryPromise = undefined

      try {
        state = await persist(state, {
          phase: 'worker-diagnostics-deploying',
        })
        const diagnosticWorker =
          await workerClient.deployDiagnosticsEnabled()
        assertNotInterrupted()
        state = await persist(state, {
          phase: 'worker-diagnostics-enabled',
          diagnosticWorkerDeploymentId:
            diagnosticWorker.deploymentId,
          diagnosticWorkerVersionId: diagnosticWorker.versionId,
        })

        const onRun = await pagesClient.dispatchAndWait(
          {
            ref: state.ref,
            mode: 'manual-on',
            sessionId: state.sessionId,
            headSha: state.mainSha,
            actor: state.actor,
          },
          {
            onDispatched: async () => {
              state = await persist(state, {
                phase: 'pages-on-dispatched',
              })
            },
            onRunDetected: async (run) => {
              state = await persist(state, {
                pagesOnRunId: String(run.id),
              })
            },
          },
        )
        assertNotInterrupted()
        state = await persist(state, {
          pagesOnRunId: String(onRun.id),
        })

        if (injectFailure === 'before-on-manifest') {
          throw new ManualTestOrchestrationError(
            'Injected failure before ON manifest verification.',
            'INJECTED_FAILURE',
          )
        }

        const manifest = await pagesClient.waitForManifest({
          commitSha: state.mainSha,
          mode: 'manual-on',
          sessionId: state.sessionId,
          importEnabled: true,
          diagnosticsEnabled: true,
        })
        assertNotInterrupted()
        state = await persist(state, {
          phase: 'pages-on-verified',
          expirationTime: manifest.expiresAt,
        })
        state = await persist(state, {
          phase: 'active',
        })
        assertNotInterrupted()
        activeState = undefined
        return state
      } catch (error) {
        state = await persist(state, {
          phase: 'recovery-required',
          recoveryStatus: 'required-after-start-failure',
        })
        activeState = state
        try {
          await recoverActiveSession('start-failure')
        } catch (recoveryError) {
          logger.error(
            recoveryError instanceof Error
              ? recoveryError.message
              : 'Automatic recovery failed.',
          )
        }
        throw error
      } finally {
        activeState = undefined
        activeRecoveryPromise = undefined
      }
    } finally {
      await release()
    }
  }

  async function createMissingStateRecovery(ref) {
    const context = await preflight({ ref, forStart: false })
    const sessionId = createSessionId()
    const startedAt = now()
    const state = {
      schemaVersion: MANUAL_TEST_STATE_SCHEMA_VERSION,
      sessionId,
      phase: 'recovery-required',
      startTime: new Date(startedAt).toISOString(),
      expirationTime: new Date(
        startedAt + MANUAL_TEST_DURATION_MS,
      ).toISOString(),
      repository: MANUAL_TEST_REPOSITORY,
      ref: context.ref,
      mainSha: context.mainSha,
      actor: context.actor,
      initialRepositoryVariables: context.variables,
      initialWorkerDeploymentId: context.worker.deploymentId,
      initialWorkerVersionId: context.worker.versionId,
      diagnosticWorkerDeploymentId: null,
      diagnosticWorkerVersionId: null,
      pagesOnRunId: null,
      pagesOffRunId: null,
      pagesOffSessionId: offSessionId(sessionId),
      manualURL: createManualUrl(sessionId),
      recoveryStatus: 'created-without-prior-state',
    }
    await writeState(statePath, state)
    return state
  }

  async function stop({ ref = 'main', recover = false } = {}) {
    const release = await acquireLock(lockPath, {
      sessionId: recover ? 'recover' : 'stop',
    })
    try {
      let state = await readState(statePath)
      if (!state) {
        state = await createMissingStateRecovery(ref)
      }
      if (state.phase === 'complete') {
        await verifyVariablesUnchanged(state.initialRepositoryVariables)
        const worker = await workerClient.getActiveWorker()
        if (
          worker.versionId !== state.initialWorkerVersionId ||
          worker.diagnosticMode !== 'false'
        ) {
          throw new ManualTestOrchestrationError(
            'Completed state does not match the active Worker.',
            'COMPLETED_STATE_MISMATCH',
          )
        }
        return state
      }
      return recoverState(state, {
        recoveryStatus: recover ? 'recovered' : 'stopped',
        reason: recover ? 'recover' : 'stop',
      })
    } finally {
      await release()
    }
  }

  async function status() {
    const state = await readState(statePath)
    const variables = await getRepositoryVariables()
    const worker = await workerClient.getActiveWorker()
    return {
      state: state
        ? {
            schemaVersion: state.schemaVersion,
            sessionId: state.sessionId,
            phase: state.phase,
            ref: state.ref,
            mainSha: state.mainSha,
            pagesOnRunId: state.pagesOnRunId,
            pagesOffRunId: state.pagesOffRunId,
            recoveryStatus: state.recoveryStatus,
          }
        : null,
      repositoryVariables: {
        importEnabled: variables.summary.importEnabled,
        diagnosticsEnabled: variables.summary.diagnosticsEnabled,
        endpointConfigured: variables.summary.endpointConfigured,
        turnstileSiteKeyConfigured:
          variables.summary.turnstileSiteKeyConfigured,
      },
      worker: {
        deploymentId: worker.deploymentId,
        versionId: worker.versionId,
        diagnosticMode: worker.diagnosticMode,
        allowedOrigin: worker.allowedOrigin,
      },
      lockPresent: await readFile(lockPath, 'utf8')
        .then(() => true)
        .catch((error) => {
          if (error?.code === 'ENOENT') {
            return false
          }
          throw error
        }),
    }
  }

  return {
    preflight,
    start,
    stop,
    recover: (options) => stop({ ...options, recover: true }),
    status,
    requestInterruption,
    recoverActiveSession,
    paths: { statePath, lockPath },
  }
}
