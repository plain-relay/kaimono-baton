import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export const DEPLOYMENT_STATE_SCHEMA_VERSION = 1
export const MANUAL_TEST_DURATION_MS = 45 * 60 * 1000

const MODES = new Set(['repository', 'manual-on', 'manual-off'])
const SESSION_PATTERN = /^[A-Za-z0-9-]{1,64}$/u

function parseBoolean(value) {
  return String(value).trim().toLowerCase() === 'true'
}

export function createDeploymentBuildEnvironment({
  mode,
  sessionId,
  repositoryImportEnabled = 'false',
  repositoryDiagnosticsEnabled = 'false',
  now = Date.now(),
}) {
  if (!MODES.has(mode)) {
    throw new Error('Invalid manual-test deployment mode.')
  }
  if (
    mode !== 'repository' &&
    (typeof sessionId !== 'string' || !SESSION_PATTERN.test(sessionId))
  ) {
    throw new Error('A valid manual-test session ID is required.')
  }

  const builtAt = new Date(now).toISOString()
  const expiresAt =
    mode === 'manual-on'
      ? new Date(now + MANUAL_TEST_DURATION_MS).toISOString()
      : ''
  const importEnabled =
    mode === 'manual-on'
      ? 'true'
      : parseBoolean(repositoryImportEnabled)
        ? 'true'
        : 'false'
  const diagnosticsEnabled =
    mode === 'manual-on'
      ? 'true'
      : parseBoolean(repositoryDiagnosticsEnabled)
        ? 'true'
        : 'false'
  return {
    HANDWRITING_DEPLOYMENT_MODE: mode,
    HANDWRITING_DEPLOYMENT_SESSION_ID:
      mode === 'repository' ? '' : sessionId,
    HANDWRITING_DEPLOYMENT_BUILT_AT: builtAt,
    HANDWRITING_DEPLOYMENT_EXPIRES_AT: expiresAt,
    VITE_HANDWRITING_MANUAL_TEST_SESSION_ID:
      mode === 'manual-on' ? sessionId : '',
    VITE_HANDWRITING_MANUAL_TEST_EXPIRES_AT: expiresAt,
    VITE_HANDWRITING_IMPORT_ENABLED: importEnabled,
    VITE_HANDWRITING_DIAGNOSTICS_ENABLED: diagnosticsEnabled,
  }
}

export async function appendGitHubEnvironment(path, environment) {
  const lines = Object.entries(environment).map(([name, value]) => {
    if (!/^[A-Z0-9_]+$/u.test(name) || /[\r\n]/u.test(value)) {
      throw new Error('Invalid GitHub environment entry.')
    }
    return `${name}=${value}`
  })
  await appendFile(path, `${lines.join('\n')}\n`, 'utf8')
}

export function createDeploymentManifest(environment) {
  const mode = environment.HANDWRITING_DEPLOYMENT_MODE
  const sessionId = environment.HANDWRITING_DEPLOYMENT_SESSION_ID ?? ''
  const commitSha = environment.GITHUB_SHA ?? ''
  if (
    !MODES.has(mode) ||
    !/^[0-9a-f]{40}$/u.test(commitSha) ||
    (mode !== 'repository' && !SESSION_PATTERN.test(sessionId)) ||
    typeof environment.HANDWRITING_DEPLOYMENT_BUILT_AT !== 'string' ||
    Number.isNaN(Date.parse(environment.HANDWRITING_DEPLOYMENT_BUILT_AT))
  ) {
    throw new Error('Deployment manifest environment is invalid.')
  }

  const expiresAt =
    environment.HANDWRITING_DEPLOYMENT_EXPIRES_AT?.trim() || null
  if (
    mode === 'manual-on' &&
    (typeof expiresAt !== 'string' || Number.isNaN(Date.parse(expiresAt)))
  ) {
    throw new Error('Manual-on deployment expiration is invalid.')
  }

  return {
    schemaVersion: DEPLOYMENT_STATE_SCHEMA_VERSION,
    commitSha,
    manualTestMode: mode,
    manualTestSessionId: mode === 'repository' ? '' : sessionId,
    handwritingImportEnabled: parseBoolean(
      environment.VITE_HANDWRITING_IMPORT_ENABLED,
    ),
    diagnosticsEnabled: parseBoolean(
      environment.VITE_HANDWRITING_DIAGNOSTICS_ENABLED,
    ),
    productPhotosEnabled: parseBoolean(
      environment.VITE_PRODUCT_PHOTOS_ENABLED,
    ),
    liveRequestsEnabled: parseBoolean(
      environment.VITE_LIVE_REQUESTS_ENABLED,
    ),
    manualValidationEnabled: parseBoolean(
      environment.VITE_MANUAL_VALIDATION_ENABLED,
    ),
    endpointConfigured: Boolean(
      environment.VITE_HANDWRITING_IMPORT_ENDPOINT?.trim(),
    ),
    turnstileSiteKeyConfigured: Boolean(
      environment.VITE_TURNSTILE_SITE_KEY?.trim(),
    ),
    builtAt: environment.HANDWRITING_DEPLOYMENT_BUILT_AT,
    expiresAt,
  }
}

export async function writeDeploymentManifest(path, manifest) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}
