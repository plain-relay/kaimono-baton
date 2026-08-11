import {
  NativeCommandError,
  parseJsonStdout,
} from './native-command.mjs'

export class CloudflareWorkerError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'CloudflareWorkerError'
    this.code = code
  }
}

function selectActiveVersion(deployment) {
  const version = Array.isArray(deployment?.versions)
    ? deployment.versions.find((candidate) => candidate.percentage === 100)
    : undefined
  if (
    typeof deployment?.id !== 'string' ||
    typeof version?.version_id !== 'string'
  ) {
    throw new CloudflareWorkerError(
      'The active Worker deployment is invalid.',
      'INVALID_WORKER_DEPLOYMENT',
    )
  }
  return {
    deploymentId: deployment.id,
    versionId: version.version_id,
  }
}

function plainTextBinding(version, name) {
  const binding = Array.isArray(version?.resources?.bindings)
    ? version.resources.bindings.find(
        (candidate) =>
          candidate?.name === name && candidate?.type === 'plain_text',
      )
    : undefined
  return typeof binding?.text === 'string' ? binding.text : undefined
}

export function createCloudflareWorkerClient({
  repositoryRoot,
  workerConfig,
  workerName,
  allowedOrigin,
  expectedHostname,
  runCaptured,
  runInteractive,
  npxCommand = 'npx',
  npxArgsPrefix = [],
}) {
  async function captureWranglerJson(args) {
    const result = await runCaptured(
      npxCommand,
      [...npxArgsPrefix, 'wrangler', ...args],
      { cwd: repositoryRoot },
    )
    return parseJsonStdout(npxCommand, result)
  }

  async function getDeploymentStatus() {
    return captureWranglerJson([
      'deployments',
      'status',
      '--config',
      workerConfig,
      '--json',
    ])
  }

  async function getVersion(versionId) {
    return captureWranglerJson([
      'versions',
      'view',
      versionId,
      '--name',
      workerName,
      '--json',
    ])
  }

  async function getActiveWorker() {
    const active = selectActiveVersion(await getDeploymentStatus())
    const version = await getVersion(active.versionId)
    return {
      ...active,
      diagnosticMode: plainTextBinding(version, 'DIAGNOSTIC_MODE'),
      allowedOrigin: plainTextBinding(version, 'ALLOWED_ORIGINS'),
    }
  }

  async function verifyPreflightResources() {
    const secretList = await captureWranglerJson([
      'secret',
      'list',
      '--config',
      workerConfig,
    ])
    const secretNames = Array.isArray(secretList)
      ? secretList.map((secret) => secret?.name)
      : []
    for (const requiredSecret of [
      'GEMINI_API_KEY',
      'TURNSTILE_SECRET_KEY',
    ]) {
      if (!secretNames.includes(requiredSecret)) {
        throw new CloudflareWorkerError(
          `Required Worker Secret is missing: ${requiredSecret}`,
          'WORKER_SECRET_MISSING',
        )
      }
    }

    const widgets = await captureWranglerJson([
      'turnstile',
      'widget',
      'list',
      '--json',
    ])
    const widget = Array.isArray(widgets)
      ? widgets.find((candidate) => candidate?.name === workerName)
      : undefined
    if (
      !widget ||
      !Array.isArray(widget.domains) ||
      widget.domains.length !== 1 ||
      widget.domains[0] !== expectedHostname
    ) {
      throw new CloudflareWorkerError(
        `Turnstile hostname must be exactly ${expectedHostname}.`,
        'TURNSTILE_HOSTNAME_INVALID',
      )
    }
  }

  async function deployDiagnosticsEnabled() {
    const exitCode = await runInteractive(
      npxCommand,
      [
        ...npxArgsPrefix,
        'wrangler',
        'deploy',
        '--config',
        workerConfig,
        '--var',
        `ALLOWED_ORIGINS:${allowedOrigin}`,
        '--var',
        'DIAGNOSTIC_MODE:true',
        '--strict',
      ],
      { cwd: repositoryRoot },
    )
    if (exitCode !== 0) {
      throw new CloudflareWorkerError(
        'The diagnostics Worker deployment failed.',
        'WORKER_DEPLOY_FAILED',
      )
    }
    const active = await getActiveWorker()
    if (
      active.diagnosticMode !== 'true' ||
      active.allowedOrigin !== allowedOrigin
    ) {
      throw new CloudflareWorkerError(
        'The diagnostics Worker version is not configured safely.',
        'WORKER_DIAGNOSTICS_NOT_ENABLED',
      )
    }
    return active
  }

  async function restoreExactVersion(versionId) {
    if (!/^[0-9a-f-]{36}$/u.test(versionId)) {
      throw new CloudflareWorkerError(
        'The saved Worker version ID is invalid.',
        'INVALID_WORKER_VERSION_ID',
      )
    }
    const exitCode = await runInteractive(
      npxCommand,
      [
        ...npxArgsPrefix,
        'wrangler',
        'versions',
        'deploy',
        `${versionId}@100`,
        '--config',
        workerConfig,
        '--yes',
      ],
      { cwd: repositoryRoot },
    )
    if (exitCode !== 0) {
      throw new CloudflareWorkerError(
        'The exact Worker version rollback failed.',
        'WORKER_ROLLBACK_FAILED',
      )
    }
    const active = await getActiveWorker()
    if (active.versionId !== versionId) {
      throw new CloudflareWorkerError(
        'Worker traffic was not restored to the saved version.',
        'WORKER_ROLLBACK_MISMATCH',
      )
    }
    return active
  }

  return {
    getDeploymentStatus,
    getVersion,
    getActiveWorker,
    verifyPreflightResources,
    deployDiagnosticsEnabled,
    restoreExactVersion,
  }
}

export function toSafeWorkerError(error) {
  if (error instanceof CloudflareWorkerError) {
    return { code: error.code, message: error.message }
  }
  if (error instanceof NativeCommandError) {
    return { code: error.code, message: error.message }
  }
  return {
    code: 'WORKER_UNKNOWN_ERROR',
    message: 'The Worker operation failed.',
  }
}
