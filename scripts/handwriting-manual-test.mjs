import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import {
  createCloudflareWorkerClient,
} from './lib/cloudflare-worker.mjs'
import { createGitHubPagesClient } from './lib/github-pages.mjs'
import {
  MANUAL_TEST_ALLOWED_ORIGIN,
  MANUAL_TEST_PUBLIC_URL,
  MANUAL_TEST_REPOSITORY,
  MANUAL_TEST_TURNSTILE_HOSTNAME,
  MANUAL_TEST_WORKER_NAME,
  createManualTestOrchestrator,
} from './lib/manual-test-orchestrator.mjs'
import {
  runCaptured,
  runInteractive,
  resolveNpxInvocation,
} from './lib/native-command.mjs'

const scriptPath = fileURLToPath(import.meta.url)
const repositoryRoot = resolve(dirname(scriptPath), '..')
const workerConfig = join(repositoryRoot, 'worker', 'wrangler.toml')

export function parseArguments(args) {
  const [command, ...rest] = args
  const options = {}
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index]
    if (argument === '--ref') {
      if (!rest[index + 1]) {
        throw new Error('--ref requires a value.')
      }
      options.ref = rest[index + 1]
      index += 1
    } else if (argument === '--inject-failure') {
      if (!rest[index + 1]) {
        throw new Error('--inject-failure requires a value.')
      }
      options.injectFailure = rest[index + 1]
      index += 1
    } else {
      throw new Error(`Unknown argument: ${argument}`)
    }
  }
  if (
    options.ref &&
    !/^[A-Za-z0-9._/-]{1,128}$/u.test(options.ref)
  ) {
    throw new Error('The requested ref is invalid.')
  }
  if (
    options.injectFailure &&
    options.injectFailure !== 'before-on-manifest'
  ) {
    throw new Error('The failure injection value is invalid.')
  }
  return { command, options }
}

export function createOneShotRecovery(orchestrator) {
  let recoveryPromise
  return {
    run(reason) {
      if (!recoveryPromise) {
        recoveryPromise = Promise.resolve().then(() =>
          orchestrator.recoverActiveSession(reason),
        )
      }
      return recoveryPromise
    },
    current() {
      return recoveryPromise
    },
  }
}

export function createProductionOrchestrator() {
  const npxInvocation = resolveNpxInvocation()
  const workerClient = createCloudflareWorkerClient({
    repositoryRoot,
    workerConfig,
    workerName: MANUAL_TEST_WORKER_NAME,
    allowedOrigin: MANUAL_TEST_ALLOWED_ORIGIN,
    expectedHostname: MANUAL_TEST_TURNSTILE_HOSTNAME,
    runCaptured,
    runInteractive,
    npxCommand: npxInvocation.command,
    npxArgsPrefix: npxInvocation.argsPrefix,
  })
  const pagesClient = createGitHubPagesClient({
    repository: MANUAL_TEST_REPOSITORY,
    repositoryRoot,
    runCaptured,
    runInteractive,
    publicBaseUrl: MANUAL_TEST_PUBLIC_URL,
  })
  return createManualTestOrchestrator({
    repositoryRoot,
    workerConfig,
    pagesClient,
    workerClient,
    runCaptured,
    runInteractive,
    wranglerInvocation: npxInvocation,
  })
}

function printStartResult(state) {
  const tailCommand = [
    `npx.cmd wrangler tail ${MANUAL_TEST_WORKER_NAME} \``,
    '  --config worker/wrangler.toml `',
    '  --format pretty `',
    '  --method POST `',
    `  --version-id ${state.diagnosticWorkerVersionId}`,
  ].join('\n')
  console.log('')
  console.log('MANUAL TEST IS ENABLED')
  console.log(`Worker deployment ID: ${state.diagnosticWorkerDeploymentId}`)
  console.log(`Worker version: ${state.diagnosticWorkerVersionId}`)
  console.log(`Pages run: ${state.pagesOnRunId}`)
  console.log(`Manual verification URL: ${state.manualURL}`)
  console.log('')
  console.log('Start Worker tail in a separate terminal:')
  console.log(tailCommand)
  console.log('')
  console.log('MANDATORY OFF RESTORE COMMAND:')
  console.log('npm run manual:handwriting:stop')
}

export async function main(
  args = process.argv.slice(2),
  { orchestrator = createProductionOrchestrator() } = {},
) {
  const { command, options } = parseArguments(args)
  if (
    !['preflight', 'start', 'stop', 'status', 'recover'].includes(command)
  ) {
    throw new Error(
      'Expected preflight, start, stop, status, or recover command.',
    )
  }

  let interrupted = false
  let fatalInterruption = false
  const recovery = createOneShotRecovery(orchestrator)
  const handleInterruption = (kind, { fatal = false } = {}) => {
    interrupted = true
    fatalInterruption ||= fatal
    console.error(`${kind} received; attempting one safe recovery.`)
    orchestrator.requestInterruption?.(kind.toLowerCase())
  }
  const sigintHandler = () => void handleInterruption('SIGINT')
  const sigtermHandler = () => void handleInterruption('SIGTERM')
  const uncaughtExceptionHandler = () =>
    void handleInterruption('uncaughtException', {
      fatal: true,
    })
  const unhandledRejectionHandler = () =>
    void handleInterruption('unhandledRejection', {
      fatal: true,
    })
  process.once('SIGINT', sigintHandler)
  process.once('SIGTERM', sigtermHandler)
  process.once('uncaughtException', uncaughtExceptionHandler)
  process.once('unhandledRejection', unhandledRejectionHandler)

  try {
    if (command === 'preflight') {
      const result = await orchestrator.preflight({
        ref: options.ref || 'main',
        forStart: true,
      })
      console.log('')
      console.log('MANUAL TEST PREFLIGHT PASSED')
      console.log(
        'No Worker, Repository Variable, or Pages state was changed.',
      )
      console.log(`Worker deployment ID: ${result.worker.deploymentId}`)
      console.log(`Worker version: ${result.worker.versionId}`)
      return 0
    }
    if (command === 'start') {
      let state
      try {
        state = await orchestrator.start({
          ref: options.ref || 'main',
          injectFailure: options.injectFailure,
        })
      } catch (error) {
        if (!interrupted) {
          throw error
        }
        if (!recovery.current()) {
          await recovery.run('interrupted')
        }
        return fatalInterruption ? 1 : 130
      }
      if (interrupted && !recovery.current()) {
        await recovery.run('interrupted')
      } else if (recovery.current()) {
        await recovery.current()
      }
      if (interrupted) {
        return fatalInterruption ? 1 : 130
      }
      printStartResult(state)
      return 0
    }
    if (command === 'stop' || command === 'recover') {
      const state =
        command === 'recover'
          ? await orchestrator.recover({ ref: options.ref || 'main' })
          : await orchestrator.stop({ ref: options.ref || 'main' })
      console.log('')
      console.log('MANUAL TEST IS OFF')
      console.log(`Pages OFF run: ${state.pagesOffRunId ?? 'already-safe'}`)
      console.log(`Worker version: ${state.initialWorkerVersionId}`)
      console.log('VITE_HANDWRITING_IMPORT_ENABLED=false')
      console.log('VITE_HANDWRITING_DIAGNOSTICS_ENABLED=false')
      return 0
    }
    console.log(JSON.stringify(await orchestrator.status(), null, 2))
    return 0
  } finally {
    process.removeListener('SIGINT', sigintHandler)
    process.removeListener('SIGTERM', sigtermHandler)
    process.removeListener(
      'uncaughtException',
      uncaughtExceptionHandler,
    )
    process.removeListener(
      'unhandledRejection',
      unhandledRejectionHandler,
    )
  }
}

if (process.argv[1] === scriptPath) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode
    })
    .catch((error) => {
      console.error(
        error instanceof Error ? error.message : 'Manual-test command failed.',
      )
      process.exitCode = 1
    })
}
