import type { WorkerEnv } from './config'
import { parseAllowedOrigins } from './validation'

export const MANUAL_VALIDATION_SESSION_PATH =
  '/v1/manual-validation/session'
export const MANUAL_VALIDATION_SESSION_HEADER =
  'X-Otsukai-Validation-Session'

const SESSION_PATTERN = /^mv1_[A-Za-z0-9_-]{32}$/u
const HASH_PATTERN = /^[0-9a-f]{64}$/u

export type ManualValidationDependencies = {
  now?: () => number
  digestImplementation?: (data: ArrayBuffer) => Promise<ArrayBuffer>
}

export type ManualValidationStatus =
  | 'disabled'
  | 'expired'
  | 'invalid'
  | 'valid'

export type ManualValidationModeStatus =
  | 'disabled'
  | 'expired'
  | 'active'

function isEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true'
}

function configuredExpiry(env: WorkerEnv): number | undefined {
  const value = env.MANUAL_VALIDATION_EXPIRES_AT?.trim() ?? ''
  const parsed = Date.parse(value)
  return value && Number.isFinite(parsed) ? parsed : undefined
}

export function getManualValidationModeStatus(
  env: WorkerEnv,
  now: number = Date.now(),
): ManualValidationModeStatus {
  if (!isEnabled(env.MANUAL_VALIDATION_ENABLED)) {
    return 'disabled'
  }
  const configuredHash =
    env.MANUAL_VALIDATION_SESSION_SHA256?.trim().toLowerCase() ?? ''
  const expiresAt = configuredExpiry(env)
  if (!HASH_PATTERN.test(configuredHash) || expiresAt === undefined) {
    return 'disabled'
  }
  return now >= expiresAt ? 'expired' : 'active'
}

function bytesToHex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function equalHex(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false
  }
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}

export function isManualValidationSessionToken(value: string): boolean {
  return SESSION_PATTERN.test(value)
}

export async function validateManualValidationSessionToken(
  token: string,
  env: WorkerEnv,
  dependencies: ManualValidationDependencies = {},
): Promise<ManualValidationStatus> {
  const now = (dependencies.now ?? Date.now)()
  const modeStatus = getManualValidationModeStatus(env, now)
  if (modeStatus !== 'active') {
    return modeStatus
  }
  const configuredHash =
    env.MANUAL_VALIDATION_SESSION_SHA256?.trim().toLowerCase() ?? ''
  if (!isManualValidationSessionToken(token)) {
    return 'invalid'
  }
  const digest =
    dependencies.digestImplementation ??
    ((data: ArrayBuffer) => crypto.subtle.digest('SHA-256', data))
  const actualHash = bytesToHex(
    await digest(new TextEncoder().encode(token).buffer),
  )
  return equalHex(actualHash, configuredHash) ? 'valid' : 'invalid'
}

export async function validateManualValidationSession(
  request: Request,
  env: WorkerEnv,
  dependencies: ManualValidationDependencies = {},
): Promise<ManualValidationStatus> {
  return validateManualValidationSessionToken(
    request.headers.get(MANUAL_VALIDATION_SESSION_HEADER) ?? '',
    env,
    dependencies,
  )
}

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  origin?: string,
): Response {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(origin
        ? {
            'Access-Control-Allow-Origin': origin,
            Vary: 'Origin',
          }
        : {}),
    },
  })
}

export async function handleManualValidationSessionRequest(
  request: Request,
  env: WorkerEnv,
  dependencies: ManualValidationDependencies = {},
): Promise<Response> {
  if (request.method !== 'GET') {
    return jsonResponse({ code: 'METHOD_NOT_ALLOWED' }, 405)
  }
  const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS ?? '')
  const requestOrigin = request.headers.get('Origin') ?? ''
  const origin = allowedOrigins.has(requestOrigin) ? requestOrigin : undefined
  if (!origin) {
    return jsonResponse({ code: 'ORIGIN_NOT_ALLOWED' }, 403)
  }
  const status = await validateManualValidationSession(
    request,
    env,
    dependencies,
  )
  if (status === 'disabled') {
    return jsonResponse({ code: 'NOT_FOUND' }, 404, origin)
  }
  if (status === 'expired') {
    return jsonResponse({ code: 'VALIDATION_SESSION_EXPIRED' }, 410, origin)
  }
  if (status !== 'valid') {
    return jsonResponse({ code: 'VALIDATION_SESSION_INVALID' }, 403, origin)
  }
  return jsonResponse(
    {
      schemaVersion: 1,
      productPhotosEnabled: true,
      liveRequestsEnabled: true,
      expiresAt: env.MANUAL_VALIDATION_EXPIRES_AT?.trim(),
    },
    200,
    origin,
  )
}

export function manualValidationErrorResponse(
  status: Exclude<ManualValidationStatus, 'valid'>,
  origin?: string,
): Response {
  if (status === 'expired') {
    return jsonResponse({ code: 'VALIDATION_SESSION_EXPIRED' }, 410, origin)
  }
  if (status === 'invalid') {
    return jsonResponse({ code: 'VALIDATION_SESSION_INVALID' }, 403, origin)
  }
  return jsonResponse({ code: 'NOT_FOUND' }, 404, origin)
}
