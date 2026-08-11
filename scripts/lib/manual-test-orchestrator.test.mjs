import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MANUAL_TEST_ALLOWED_ORIGIN,
  createManualTestOrchestrator,
} from './manual-test-orchestrator.mjs'
import {
  readManualTestState,
  resolveStatePaths,
  writeManualTestStateAtomic,
} from './manual-test-state.mjs'

const sha = 'd'.repeat(40)
const initialVersion = 'a4d01088-76b4-4176-8b08-86542147e5be'
const diagnosticVersion = 'b4d01088-76b4-4176-8b08-86542147e5be'
const initialDeployment = '11111111-1111-4111-8111-111111111111'
const diagnosticDeployment = '22222222-2222-4222-8222-222222222222'
const restoredDeployment = '33333333-3333-4333-8333-333333333333'
const initialVariables = [
  {
    name: 'VITE_HANDWRITING_IMPORT_ENABLED',
    value: 'false',
  },
  {
    name: 'VITE_HANDWRITING_DIAGNOSTICS_ENABLED',
    value: 'false',
  },
  {
    name: 'VITE_HANDWRITING_IMPORT_ENDPOINT',
    value: 'https://worker-secret-location.example/',
  },
  {
    name: 'VITE_TURNSTILE_SITE_KEY',
    value: 'public-site-key-sentinel',
  },
]
const temporaryDirectories = []

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'kaimono-baton-orchestrator-'))
  temporaryDirectories.push(root)
  await mkdir(join(root, 'worker'), { recursive: true })
  await writeFile(
    join(root, 'worker', 'wrangler.toml'),
    [
      'name = "kaimono-baton-handwriting-import"',
      'ALLOWED_ORIGINS = "https://plain-relay.github.io"',
      '',
    ].join('\n'),
    'utf8',
  )

  const commandCalls = []
  let repositoryVariables = structuredClone(initialVariables)
  const runCaptured = vi.fn(async (command, args) => {
    commandCalls.push({ command, args })
    if (command === 'git') {
      if (args[0] === 'branch') {
        return result('main')
      }
      if (args[0] === 'status') {
        return result('')
      }
      if (args[0] === 'ls-remote') {
        return result(`${sha}\trefs/heads/main`)
      }
      if (args[0] === 'rev-parse') {
        return result(sha)
      }
    }
    if (command === 'gh' && args[0] === 'variable') {
      return result(JSON.stringify(repositoryVariables))
    }
    throw new Error(`Unexpected captured command: ${command} ${args}`)
  })
  const runInteractive = vi.fn(async () => 0)
  const pageOperations = []
  let nextRun = 100
  let pendingRun
  const pagesClient = {
    getAuthenticatedActor: vi.fn(async () => 'kouhei'),
    verifyDeploymentRefAllowed: vi.fn(async () => {}),
    dispatch: vi.fn(async (options) => {
      pageOperations.push(options)
      pendingRun = { id: nextRun }
      nextRun += 1
    }),
    waitForRun: vi.fn(async () => pendingRun),
    watchRun: vi.fn(async () => pendingRun),
    dispatchAndWait: vi.fn(async (options, callbacks = {}) => {
      pageOperations.push(options)
      await callbacks.onDispatched?.()
      const run = { id: nextRun }
      nextRun += 1
      await callbacks.onRunDetected?.(run)
      return run
    }),
    waitForManifest: vi.fn(async (expected) => ({
      schemaVersion: 1,
      commitSha: expected.commitSha,
      manualTestMode: expected.mode,
      manualTestSessionId: expected.sessionId,
      handwritingImportEnabled: expected.importEnabled,
      diagnosticsEnabled: expected.diagnosticsEnabled,
      productPhotosEnabled: false,
      liveRequestsEnabled: false,
      manualValidationEnabled: false,
      endpointConfigured: true,
      turnstileSiteKeyConfigured: true,
      builtAt: '2026-07-28T00:00:00.000Z',
      expiresAt:
        expected.mode === 'manual-on'
          ? '2026-07-28T00:45:00.000Z'
          : null,
    })),
  }
  let activeWorker = {
    deploymentId: initialDeployment,
    versionId: initialVersion,
    diagnosticMode: 'false',
    allowedOrigin: MANUAL_TEST_ALLOWED_ORIGIN,
  }
  const workerClient = {
    getActiveWorker: vi.fn(async () => ({ ...activeWorker })),
    verifyPreflightResources: vi.fn(async () => {}),
    deployDiagnosticsEnabled: vi.fn(async () => {
      activeWorker = {
        deploymentId: diagnosticDeployment,
        versionId: diagnosticVersion,
        diagnosticMode: 'true',
        allowedOrigin: MANUAL_TEST_ALLOWED_ORIGIN,
      }
      return { ...activeWorker }
    }),
    restoreExactVersion: vi.fn(async (versionId) => {
      activeWorker = {
        deploymentId: restoredDeployment,
        versionId,
        diagnosticMode: 'false',
        allowedOrigin: MANUAL_TEST_ALLOWED_ORIGIN,
      }
      return { ...activeWorker }
    }),
  }

  let recoveryAttempt = 0
  function createOrchestrator(overrides = {}) {
    return createManualTestOrchestrator({
      repositoryRoot: root,
      pagesClient,
      workerClient,
      runCaptured,
      runInteractive,
      now: () => Date.parse('2026-07-28T00:00:00.000Z'),
      createSessionId: () => 'session-123',
      createAttemptId: () => {
        recoveryAttempt += 1
        return `attempt${String(recoveryAttempt).padStart(5, '0')}`
      },
      logger: { error: vi.fn() },
      ...overrides,
    })
  }

  return {
    root,
    commandCalls,
    get repositoryVariables() {
      return repositoryVariables
    },
    set repositoryVariables(value) {
      repositoryVariables = value
    },
    get activeWorker() {
      return activeWorker
    },
    pageOperations,
    pagesClient,
    workerClient,
    runCaptured,
    runInteractive,
    createOrchestrator,
  }
}

function result(stdout, stderr = '', exitCode = 0) {
  return { stdout, stderr, exitCode }
}

afterEach(async () => {
  for (const path of temporaryDirectories.splice(0)) {
    await rm(path, { recursive: true, force: true })
  }
})

describe('manual-test orchestration', () => {
  it('performs start and stop without changing Repository Variables', async () => {
    const fixture = await createFixture()
    const before = structuredClone(fixture.repositoryVariables)
    const orchestrator = fixture.createOrchestrator()

    const active = await orchestrator.start()
    const complete = await orchestrator.stop()

    expect(active).toMatchObject({
      phase: 'active',
      sessionId: 'session-123',
      diagnosticWorkerVersionId: diagnosticVersion,
      manualURL:
        'https://plain-relay.github.io/kaimono-baton/?handwritingDiagnostics=1&manualTestSessionId=session-123#/create',
    })
    expect(complete).toMatchObject({
      phase: 'complete',
      recoveryStatus: 'stopped',
    })
    expect(fixture.pageOperations.map(({ mode }) => mode)).toEqual([
      'manual-on',
      'manual-off',
    ])
    expect(fixture.workerClient.restoreExactVersion).toHaveBeenCalledWith(
      initialVersion,
    )
    expect(fixture.repositoryVariables).toEqual(before)
    expect(
      fixture.commandCalls.some(
        ({ command, args }) =>
          command === 'gh' &&
          args[0] === 'variable' &&
          args.includes('set'),
      ),
    ).toBe(false)
    await expect(readFile(orchestrator.paths.lockPath, 'utf8')).rejects
      .toMatchObject({ code: 'ENOENT' })
  })

  it('stores no Endpoint, Site Key, product, image, token, or model data', async () => {
    const fixture = await createFixture()
    const orchestrator = fixture.createOrchestrator()
    await orchestrator.start()
    const serialized = await readFile(orchestrator.paths.statePath, 'utf8')

    for (const forbidden of [
      'worker-secret-location.example',
      'public-site-key-sentinel',
      'data:image/jpeg;base64,',
      'PRODUCT_NAME_SENTINEL',
      'ALIAS_SENTINEL',
      'PRODUCT_ID_SENTINEL',
      'SOURCE_TEXT_SENTINEL',
      'TURNSTILE_TOKEN_SENTINEL',
      'GEMINI_OUTPUT_SENTINEL',
      'API_KEY_SENTINEL',
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it('recovers Pages and the exact Worker version after injected failure', async () => {
    const fixture = await createFixture()
    const orchestrator = fixture.createOrchestrator()

    await expect(
      orchestrator.start({
        injectFailure: 'before-on-manifest',
      }),
    ).rejects.toMatchObject({ code: 'INJECTED_FAILURE' })

    const state = await readManualTestState(
      resolveStatePaths(fixture.root).statePath,
    )
    expect(state).toMatchObject({
      phase: 'complete',
      recoveryStatus: 'recovered-after-start-failure',
    })
    expect(fixture.pageOperations.map(({ mode }) => mode)).toEqual([
      'manual-on',
      'manual-off',
    ])
    expect(fixture.activeWorker).toMatchObject({
      versionId: initialVersion,
      diagnosticMode: 'false',
    })
    expect(fixture.repositoryVariables).toEqual(initialVariables)
  })

  it('detects an unfinished session before performing another start', async () => {
    const fixture = await createFixture()
    const orchestrator = fixture.createOrchestrator()
    await orchestrator.start()
    const deployCount =
      fixture.workerClient.deployDiagnosticsEnabled.mock.calls.length

    await expect(orchestrator.start()).rejects.toMatchObject({
      code: 'UNFINISHED_SESSION',
    })
    expect(
      fixture.workerClient.deployDiagnosticsEnabled.mock.calls,
    ).toHaveLength(deployCount)
  })

  it('recovers an active session after a new process starts', async () => {
    const fixture = await createFixture()
    await fixture.createOrchestrator().start()
    fixture.pagesClient.dispatchAndWait.mockRejectedValue(
      new Error('start-only helper is unavailable'),
    )

    const recovered = await fixture.createOrchestrator().recover()
    const repeated = await fixture.createOrchestrator().recover()

    expect(recovered).toMatchObject({
      phase: 'complete',
      recoveryStatus: 'recovered',
    })
    expect(repeated).toMatchObject({
      phase: 'complete',
      recoveryStatus: 'recovered',
    })
    expect(fixture.pageOperations.map(({ mode }) => mode)).toEqual([
      'manual-on',
      'manual-off',
    ])
    expect(fixture.pagesClient.dispatch).toHaveBeenCalledTimes(1)
    expect(fixture.pagesClient.waitForRun).toHaveBeenCalledTimes(1)
    expect(fixture.pagesClient.watchRun).toHaveBeenCalledTimes(1)
  })

  it('recovers once when interrupted after the diagnostics Worker deploys', async () => {
    const fixture = await createFixture()
    let finishDeploy
    const originalDeploy =
      fixture.workerClient.deployDiagnosticsEnabled
    fixture.workerClient.deployDiagnosticsEnabled = vi.fn(
      () =>
        new Promise((resolve) => {
          finishDeploy = async () => resolve(await originalDeploy())
        }),
    )
    const orchestrator = fixture.createOrchestrator()
    const startPromise = orchestrator.start()
    await vi.waitFor(() => {
      expect(finishDeploy).toBeTypeOf('function')
    })

    orchestrator.requestInterruption('sigint')
    await finishDeploy()

    await expect(startPromise).rejects.toMatchObject({
      code: 'INTERRUPTED',
    })
    expect(fixture.pageOperations.map(({ mode }) => mode)).toEqual([
      'manual-off',
    ])
    expect(fixture.workerClient.restoreExactVersion).toHaveBeenCalledTimes(
      1,
    )
    expect(
      await readManualTestState(resolveStatePaths(fixture.root).statePath),
    ).toMatchObject({
      phase: 'complete',
      recoveryStatus: 'recovered-after-start-failure',
    })
  })

  it('performs a safe OFF recovery when no state file exists', async () => {
    const fixture = await createFixture()
    const state = await fixture.createOrchestrator().recover()

    expect(state.phase).toBe('complete')
    expect(fixture.pageOperations).toHaveLength(1)
    expect(fixture.pageOperations[0].mode).toBe('manual-off')
    expect(fixture.workerClient.restoreExactVersion).toHaveBeenCalledWith(
      initialVersion,
    )
  })

  it('uses a new OFF attempt after a crash immediately following dispatch', async () => {
    const fixture = await createFixture()
    await fixture.createOrchestrator().start()
    const { statePath } = resolveStatePaths(fixture.root)
    const active = await readManualTestState(statePath)
    await writeManualTestStateAtomic(statePath, {
      ...active,
      phase: 'stop-requested',
      pagesOffSessionId: `${active.sessionId}-off`,
      pagesOffRunId: null,
      recoveryStatus: 'in-progress:stop',
    })

    const recovered = await fixture.createOrchestrator().recover()

    expect(recovered.phase).toBe('complete')
    const offOperation = fixture.pageOperations.find(
      ({ mode }) => mode === 'manual-off',
    )
    expect(offOperation.sessionId).not.toBe(
      `${active.sessionId}-off`,
    )
  })

  it('refuses a corrupt state file without changing external state', async () => {
    const fixture = await createFixture()
    const { statePath } = resolveStatePaths(fixture.root)
    await mkdir(join(fixture.root, '.manual-test'), { recursive: true })
    await writeFile(statePath, '{', 'utf8')

    await expect(
      fixture.createOrchestrator().recover(),
    ).rejects.toMatchObject({ code: 'CORRUPT_STATE' })
    expect(fixture.pagesClient.dispatchAndWait).not.toHaveBeenCalled()
    expect(fixture.workerClient.restoreExactVersion).not.toHaveBeenCalled()
  })

  it('marks recovery-required when an independent recovery step fails', async () => {
    const fixture = await createFixture()
    await fixture.createOrchestrator().start()
    fixture.pagesClient.waitForManifest.mockRejectedValueOnce(
      new Error('manifest mismatch'),
    )

    await expect(
      fixture.createOrchestrator().recover(),
    ).rejects.toMatchObject({ code: 'RECOVERY_FAILED' })
    expect(
      await readManualTestState(resolveStatePaths(fixture.root).statePath),
    ).toMatchObject({
      phase: 'recovery-required',
      recoveryStatus: 'failed:recover',
    })
    expect(fixture.workerClient.restoreExactVersion).toHaveBeenCalledWith(
      initialVersion,
    )

    const recovered = await fixture.createOrchestrator().recover()
    expect(recovered).toMatchObject({
      phase: 'complete',
      recoveryStatus: 'recovered',
    })
    const offSessions = fixture.pageOperations
      .filter(({ mode }) => mode === 'manual-off')
      .map(({ sessionId }) => sessionId)
    expect(offSessions).toHaveLength(2)
    expect(new Set(offSessions).size).toBe(2)
  })
})
