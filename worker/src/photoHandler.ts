import {
  hasPhotoConfiguration,
  isPhotoApiEnabled,
  type WorkerEnv,
} from './config'
import type { PhotoObject } from './photoObject'
import {
  PHOTO_RETENTION_MS,
  PHOTO_TOKEN_PATTERN,
  PHOTO_TURNSTILE_ACTION,
} from './photoConstants'
import {
  parsePhotoBatchRequest,
  PhotoRequestValidationError,
  validateParsedPhotoBatchRequest,
} from './photoValidation'
import {
  verifyTurnstileTokenDetailed,
  type TurnstileVerificationResult,
} from './turnstile'
import { parseAllowedOrigins } from './validation'
import { isWorkerDiagnosticsEnabled } from './diagnostics'
import {
  createPhotoDiagnostics,
  type PhotoDiagnosticErrorClass,
  type PhotoDiagnostics,
} from './photoDiagnostics'
import {
  createWorkerRequestId,
  isValidRequestId,
  WORKER_REQUEST_ID_HEADER,
} from './requestId'
import {
  getManualValidationModeStatus,
  manualValidationErrorResponse,
  validateManualValidationSessionToken,
} from './manualValidation'

export const PHOTO_BATCH_PATH = '/v1/photos/batch'
export { PHOTO_RETENTION_MS, PHOTO_TURNSTILE_ACTION } from './photoConstants'

const DEFAULT_TIMEOUT_MS = 15_000
const PHOTO_PATH_PATTERN = /^\/v1\/photos\/(p1_[A-Za-z0-9_-]{32})$/

type PhotoSuccessResponse = {
  photos: Array<{ token: string; itemKey: string }>
}

type PhotoErrorResponse = { code: string }

export type PhotoHandlerDependencies = {
  fetchImplementation?: typeof fetch
  now?: () => number
  timeoutMs?: number
  digestImplementation?: (data: ArrayBuffer) => Promise<ArrayBuffer>
  logImplementation?: (message: string) => void
  createRequestId?: () => string
}

function withCorrelationHeaders(
  response: Response,
  requestId: string,
): Response {
  const headers = new Headers(response.headers)
  headers.set(WORKER_REQUEST_ID_HEADER, requestId)
  if (headers.has('Access-Control-Allow-Origin')) {
    headers.set('Access-Control-Expose-Headers', WORKER_REQUEST_ID_HEADER)
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function turnstileErrorClass(
  result: Exclude<TurnstileVerificationResult, 'verified'>,
): PhotoDiagnosticErrorClass {
  switch (result) {
    case 'action-mismatch':
      return 'turnstile-action-mismatch'
    case 'hostname-mismatch':
      return 'turnstile-hostname-mismatch'
    case 'response-invalid':
      return 'turnstile-response-invalid'
    case 'unavailable':
      return 'turnstile-unavailable'
    default:
      return 'turnstile-failed'
  }
}

function corsHeaders(origin: string | undefined): HeadersInit {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...(origin
      ? {
          'Access-Control-Allow-Origin': origin,
          Vary: 'Origin',
        }
      : {}),
  }
}

function jsonResponse(
  body: PhotoSuccessResponse | PhotoErrorResponse,
  status: number,
  origin?: string,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(origin),
  })
}

function matchPhotoToken(pathname: string): string | undefined {
  return PHOTO_PATH_PATTERN.exec(pathname)?.[1]
}

export function isPhotoApiRoute(pathname: string): boolean {
  return pathname === PHOTO_BATCH_PATH || pathname.startsWith('/v1/photos/')
}

async function sha256Hex(
  value: ArrayBuffer,
  digestImplementation: (data: ArrayBuffer) => Promise<ArrayBuffer>,
): Promise<string> {
  const digest = new Uint8Array(await digestImplementation(value))
  return [...digest]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function handlePhotoBatch(
  request: Request,
  env: WorkerEnv & {
    TURNSTILE_SECRET_KEY: string
    ALLOWED_ORIGINS: string
    PHOTO_OBJECTS: DurableObjectNamespace<PhotoObject>
  },
  origin: string,
  dependencies: PhotoHandlerDependencies,
  diagnostics: PhotoDiagnostics,
  requiresManualValidation: boolean,
): Promise<Response> {
  if (request.method !== 'POST') {
    diagnostics.record('request-rejected', {
      httpStatus: 405,
      errorClass: 'method-not-allowed',
    })
    return jsonResponse({ code: 'METHOD_NOT_ALLOWED' }, 405, origin)
  }

  const controller = new AbortController()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const abortForClient = () => controller.abort()
  request.signal.addEventListener('abort', abortForClient, { once: true })
  let failureClass: PhotoDiagnosticErrorClass = 'photo-preparation'

  try {
    const parsed = await parsePhotoBatchRequest(
      request,
      parseAllowedOrigins(env.ALLOWED_ORIGINS),
    )
    if (requiresManualValidation) {
      const validationStatus =
        await validateManualValidationSessionToken(
          parsed.validationSessionToken ?? '',
          env,
          dependencies,
        )
      if (validationStatus !== 'valid') {
        diagnostics.record('request-rejected', {
          httpStatus: validationStatus === 'expired' ? 410 : 403,
          errorClass: 'validation-session',
        })
        return manualValidationErrorResponse(validationStatus, origin)
      }
    }
    const validated = await validateParsedPhotoBatchRequest(parsed)
    diagnostics.record('request-validated', {
      photoCount: validated.photos.length,
      imageBytes: validated.photos.reduce(
        (total, photo) => total + photo.jpeg.byteLength,
        0,
      ),
    })
    diagnostics.record('turnstile-verification-started')
    const verification = await verifyTurnstileTokenDetailed({
      token: validated.turnstileToken,
      secret: env.TURNSTILE_SECRET_KEY,
      origin: validated.origin,
      remoteIp: validated.remoteIp,
      fetchImplementation: dependencies.fetchImplementation ?? fetch,
      signal: controller.signal,
      expectedAction: PHOTO_TURNSTILE_ACTION,
    })
    if (verification !== 'verified') {
      diagnostics.record('request-rejected', {
        httpStatus: 403,
        errorClass: turnstileErrorClass(verification),
      })
      return jsonResponse({ code: 'AUTH_FAILED' }, 403, origin)
    }
    diagnostics.record('turnstile-verified')

    const createdAt = (dependencies.now ?? Date.now)()
    const expiresAt = createdAt + PHOTO_RETENTION_MS
    const digestImplementation =
      dependencies.digestImplementation ??
      ((data: ArrayBuffer) => crypto.subtle.digest('SHA-256', data))

    diagnostics.record('photo-save-started', {
      photoCount: validated.photos.length,
    })
    for (const photo of validated.photos) {
      const contentHash = await sha256Hex(
        photo.jpeg,
        digestImplementation,
      )
      failureClass = 'photo-storage'
      const stub = env.PHOTO_OBJECTS.getByName(photo.token)
      const result = await stub.savePhoto({
        jpeg: photo.jpeg,
        contentHash,
        createdAt,
        expiresAt,
      })
      if (result.status === 'conflict') {
        throw new PhotoRequestValidationError(
          409,
          'PHOTO_TOKEN_CONFLICT',
        )
      }
      failureClass = 'photo-preparation'
    }
    diagnostics.record('photo-save-completed', {
      photoCount: validated.photos.length,
    })

    return jsonResponse(
      {
        photos: validated.photos.map(({ token, itemKey }) => ({
          token,
          itemKey,
        })),
      },
      200,
      origin,
    )
  } catch (error) {
    // A response-less client retry can overlap this attempt. Eagerly
    // deleting a photo created here could invalidate a successful retry
    // that adopted the same token and content. Unshared partial writes
    // remain capability-protected and are deleted by their fixed alarm.
    if (error instanceof PhotoRequestValidationError) {
      diagnostics.record('request-rejected', {
        httpStatus: error.status,
        errorClass: 'request-validation',
      })
      return jsonResponse({ code: error.code }, error.status, origin)
    }
    if (timedOut || controller.signal.aborted) {
      diagnostics.record('request-timed-out', {
        httpStatus: 504,
        errorClass: 'timeout',
      })
      return jsonResponse({ code: 'TIMEOUT' }, 504, origin)
    }
    diagnostics.record('request-failed', {
      httpStatus: 503,
      errorClass: failureClass,
    })
    return jsonResponse({ code: 'SERVICE_UNAVAILABLE' }, 503, origin)
  } finally {
    clearTimeout(timeout)
    request.signal.removeEventListener('abort', abortForClient)
  }
}

async function handlePhotoGet(
  request: Request,
  env: WorkerEnv & {
    PHOTO_OBJECTS: DurableObjectNamespace<PhotoObject>
  },
  origin: string,
  token: string,
  dependencies: PhotoHandlerDependencies,
): Promise<Response> {
  if (request.method !== 'GET') {
    return jsonResponse({ code: 'METHOD_NOT_ALLOWED' }, 405, origin)
  }
  if (!PHOTO_TOKEN_PATTERN.test(token)) {
    return jsonResponse({ code: 'PHOTO_REQUEST_INVALID' }, 400, origin)
  }

  try {
    const result = await env.PHOTO_OBJECTS.getByName(token).getPhoto(
      (dependencies.now ?? Date.now)(),
    )
    if (result.status === 'missing') {
      return jsonResponse({ code: 'PHOTO_NOT_FOUND' }, 404, origin)
    }
    if (result.status === 'expired') {
      return jsonResponse({ code: 'PHOTO_EXPIRED' }, 410, origin)
    }
    return new Response(result.jpeg, {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=300, must-revalidate',
        'Access-Control-Allow-Origin': origin,
        Vary: 'Origin',
      },
    })
  } catch {
    return jsonResponse({ code: 'SERVICE_UNAVAILABLE' }, 503, origin)
  }
}

async function handlePhotoApiRequestInternal(
  request: Request,
  env: WorkerEnv,
  dependencies: PhotoHandlerDependencies,
  diagnostics: PhotoDiagnostics,
): Promise<Response> {
  const publiclyEnabled = isPhotoApiEnabled(env)
  const modeStatus = publiclyEnabled
    ? 'disabled'
    : getManualValidationModeStatus(
        env,
        (dependencies.now ?? Date.now)(),
      )
  if (!publiclyEnabled && modeStatus === 'disabled') {
    diagnostics.record('request-rejected', {
      httpStatus: 404,
      errorClass: 'configuration',
    })
    return manualValidationErrorResponse('disabled')
  }
  const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS ?? '')
  const requestOrigin = request.headers.get('Origin') ?? ''
  const origin = allowedOrigins.has(requestOrigin)
    ? requestOrigin
    : undefined
  if (!origin) {
    diagnostics.record('request-rejected', {
      httpStatus: 403,
      errorClass: 'origin-not-allowed',
    })
    return jsonResponse({ code: 'ORIGIN_NOT_ALLOWED' }, 403)
  }
  const pathname = new URL(request.url).pathname
  if (!publiclyEnabled) {
    if (modeStatus === 'expired') {
      diagnostics.record('request-rejected', {
        httpStatus: 410,
        errorClass: 'validation-session',
      })
      return manualValidationErrorResponse('expired', origin)
    }
  }
  if (!hasPhotoConfiguration(env)) {
    diagnostics.record('request-failed', {
      httpStatus: 503,
      errorClass: 'configuration',
    })
    return jsonResponse({ code: 'SERVICE_UNAVAILABLE' }, 503, origin)
  }

  if (pathname === PHOTO_BATCH_PATH) {
    return handlePhotoBatch(
      request,
      env,
      origin,
      dependencies,
      diagnostics,
      !publiclyEnabled,
    )
  }
  const token = matchPhotoToken(pathname)
  if (!token) {
    return jsonResponse({ code: 'PHOTO_REQUEST_INVALID' }, 400, origin)
  }
  return handlePhotoGet(request, env, origin, token, dependencies)
}

export async function handlePhotoApiRequest(
  request: Request,
  env: WorkerEnv,
  dependencies: PhotoHandlerDependencies = {},
): Promise<Response> {
  const startedAt = (dependencies.now ?? Date.now)()
  const generatedRequestId = (
    dependencies.createRequestId ?? createWorkerRequestId
  )()
  const requestId = isValidRequestId(generatedRequestId)
    ? generatedRequestId
    : createWorkerRequestId()
  const diagnostics = createPhotoDiagnostics({
    enabled: isWorkerDiagnosticsEnabled(env.DIAGNOSTIC_MODE),
    requestId,
    startedAt,
    now: dependencies.now,
    log: dependencies.logImplementation,
  })
  const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS ?? '')
  const requestOrigin = request.headers.get('Origin') ?? ''
  const responseOrigin = allowedOrigins.has(requestOrigin)
    ? requestOrigin
    : undefined
  diagnostics.record('request-received')
  try {
    const response = await handlePhotoApiRequestInternal(
      request,
      env,
      dependencies,
      diagnostics,
    )
    diagnostics.record('response-sent', { httpStatus: response.status })
    return withCorrelationHeaders(response, requestId)
  } catch {
    diagnostics.record('request-failed', {
      httpStatus: 503,
      errorClass: 'configuration',
    })
    return withCorrelationHeaders(
      jsonResponse(
        { code: 'SERVICE_UNAVAILABLE' },
        503,
        responseOrigin,
      ),
      requestId,
    )
  }
}
