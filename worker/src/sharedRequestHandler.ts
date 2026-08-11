import {
  hasSharedRequestConfiguration,
  isSharedRequestApiEnabled,
  type WorkerEnv,
} from './config'
import {
  SHARED_REQUEST_CREATE_ACTION,
  SHARED_REQUEST_RETENTION_MS,
  SHARED_REQUEST_TOKEN_PATTERN,
  SHARED_REQUEST_UPDATE_ACTION,
} from './sharedRequestConstants'
import type {
  SharedRequestObject,
  UpdateSharedRequestResult,
} from './sharedRequestObject'
import {
  createSharedRequestEditSecret,
  createSharedRequestToken,
  sha256Hex,
  type RandomValuesProvider,
} from './sharedRequestToken'
import type { SharedRequestSnapshot } from './sharedRequestTypes'
import {
  SharedRequestValidationError,
  validateSharedRequestCreateRequest,
  validateSharedRequestPatchRequest,
} from './sharedRequestValidation'
import { verifyTurnstileToken } from './turnstile'
import { parseAllowedOrigins } from './validation'
import {
  getManualValidationModeStatus,
  manualValidationErrorResponse,
  validateManualValidationSession,
} from './manualValidation'

export const SHARED_REQUEST_COLLECTION_PATH = '/v1/requests'
const SHARED_REQUEST_PATH_PATTERN =
  /^\/v1\/requests\/(r1_[A-Za-z0-9_-]{32})$/u
const DEFAULT_TIMEOUT_MS = 15_000
const MAX_TOKEN_ATTEMPTS = 3

type SharedRequestCreateResponse = {
  requestToken: string
  editSecret: string
  request: SharedRequestSnapshot
}

type SharedRequestErrorResponse = { code: string }

export type SharedRequestHandlerDependencies = {
  fetchImplementation?: typeof fetch
  now?: () => number
  timeoutMs?: number
  randomValues?: RandomValuesProvider
  digestImplementation?: (data: ArrayBuffer) => Promise<ArrayBuffer>
}

function corsHeaders(
  origin: string | undefined,
  etag?: string,
): HeadersInit {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...(etag ? { ETag: etag } : {}),
    ...(origin
      ? {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Expose-Headers': 'ETag',
          Vary: 'Origin',
        }
      : {}),
  }
}

function jsonResponse(
  body:
    | SharedRequestCreateResponse
    | SharedRequestSnapshot
    | SharedRequestErrorResponse,
  status: number,
  origin?: string,
  etag?: string,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(origin, etag),
  })
}

function notModifiedResponse(origin: string, etag: string): Response {
  return new Response(null, {
    status: 304,
    headers: corsHeaders(origin, etag),
  })
}

function etagForRevision(revision: number): string {
  return `"revision-${revision}"`
}

function parseIfMatch(value: string | null): number | undefined {
  const match = /^"revision-([1-9][0-9]*)"$/u.exec(value ?? '')
  if (!match) {
    return undefined
  }
  const revision = Number(match[1])
  return Number.isSafeInteger(revision) ? revision : undefined
}

function remoteIp(request: Request): string | undefined {
  const value = request.headers.get('CF-Connecting-IP')?.trim()
  return value || undefined
}

async function verifyTurnstile(
  request: Request,
  token: string,
  action: string,
  env: WorkerEnv & {
    TURNSTILE_SECRET_KEY: string
  },
  origin: string,
  signal: AbortSignal,
  dependencies: SharedRequestHandlerDependencies,
): Promise<boolean> {
  return verifyTurnstileToken({
    token,
    secret: env.TURNSTILE_SECRET_KEY,
    origin,
    remoteIp: remoteIp(request),
    fetchImplementation: dependencies.fetchImplementation ?? fetch,
    signal,
    expectedAction: action,
  })
}

async function handleCreate(
  request: Request,
  env: WorkerEnv & {
    TURNSTILE_SECRET_KEY: string
    SHARED_REQUEST_OBJECTS: DurableObjectNamespace<SharedRequestObject>
  },
  origin: string,
  signal: AbortSignal,
  dependencies: SharedRequestHandlerDependencies,
): Promise<Response> {
  const body = await validateSharedRequestCreateRequest(request)
  if (
    !(await verifyTurnstile(
      request,
      body.turnstileToken,
      SHARED_REQUEST_CREATE_ACTION,
      env,
      origin,
      signal,
      dependencies,
    ))
  ) {
    return jsonResponse({ code: 'AUTH_FAILED' }, 403, origin)
  }
  if (signal.aborted) {
    throw new DOMException('aborted', 'AbortError')
  }

  const randomValues = dependencies.randomValues ?? crypto
  const now = (dependencies.now ?? Date.now)()
  for (let attempt = 0; attempt < MAX_TOKEN_ATTEMPTS; attempt += 1) {
    const requestToken = createSharedRequestToken(randomValues)
    const editSecret = createSharedRequestEditSecret(randomValues)
    const editSecretHash = await sha256Hex(
      editSecret,
      dependencies.digestImplementation,
    )
    const result = await env.SHARED_REQUEST_OBJECTS.getByName(
      requestToken,
    ).createRequest({
      requestId: `v5-${requestToken}`,
      editSecretHash,
      createdAt: now,
      expiresAt: now + SHARED_REQUEST_RETENTION_MS,
      items: body.items,
    })
    if (result.status === 'created') {
      const etag = etagForRevision(result.request.revision)
      return jsonResponse(
        {
          requestToken,
          editSecret,
          request: result.request,
        },
        201,
        origin,
        etag,
      )
    }
  }
  return jsonResponse({ code: 'SERVICE_UNAVAILABLE' }, 503, origin)
}

async function handleGet(
  request: Request,
  env: WorkerEnv & {
    SHARED_REQUEST_OBJECTS: DurableObjectNamespace<SharedRequestObject>
  },
  origin: string,
  requestToken: string,
  dependencies: SharedRequestHandlerDependencies,
): Promise<Response> {
  const result = await env.SHARED_REQUEST_OBJECTS.getByName(
    requestToken,
  ).getRequest((dependencies.now ?? Date.now)())
  if (result.status === 'missing') {
    return jsonResponse({ code: 'REQUEST_NOT_FOUND' }, 404, origin)
  }
  if (result.status === 'expired') {
    return jsonResponse({ code: 'REQUEST_EXPIRED' }, 410, origin)
  }
  const etag = etagForRevision(result.request.revision)
  if (request.headers.get('If-None-Match') === etag) {
    return notModifiedResponse(origin, etag)
  }
  return jsonResponse(result.request, 200, origin, etag)
}

function updateErrorResponse(
  result: Exclude<UpdateSharedRequestResult, { status: 'updated' }>,
  origin: string,
): Response {
  switch (result.status) {
    case 'missing':
      return jsonResponse({ code: 'REQUEST_NOT_FOUND' }, 404, origin)
    case 'expired':
      return jsonResponse({ code: 'REQUEST_EXPIRED' }, 410, origin)
    case 'forbidden':
      return jsonResponse({ code: 'EDIT_SECRET_INVALID' }, 403, origin)
    case 'precondition-failed':
      return jsonResponse(
        { code: 'REVISION_MISMATCH' },
        412,
        origin,
        etagForRevision(result.revision),
      )
    case 'update-limit':
      return jsonResponse({ code: 'UPDATE_LIMIT' }, 429, origin)
    case 'operation-invalid':
      return jsonResponse({ code: 'OPERATION_INVALID' }, 409, origin)
  }
}

async function handlePatch(
  request: Request,
  env: WorkerEnv & {
    TURNSTILE_SECRET_KEY: string
    SHARED_REQUEST_OBJECTS: DurableObjectNamespace<SharedRequestObject>
  },
  origin: string,
  requestToken: string,
  signal: AbortSignal,
  dependencies: SharedRequestHandlerDependencies,
): Promise<Response> {
  const expectedRevision = parseIfMatch(request.headers.get('If-Match'))
  if (!expectedRevision) {
    return jsonResponse({ code: 'IF_MATCH_REQUIRED' }, 428, origin)
  }
  const body = await validateSharedRequestPatchRequest(request)
  if (
    !(await verifyTurnstile(
      request,
      body.turnstileToken,
      SHARED_REQUEST_UPDATE_ACTION,
      env,
      origin,
      signal,
      dependencies,
    ))
  ) {
    return jsonResponse({ code: 'AUTH_FAILED' }, 403, origin)
  }
  if (signal.aborted) {
    throw new DOMException('aborted', 'AbortError')
  }
  const editSecretHash = await sha256Hex(
    body.editSecret,
    dependencies.digestImplementation,
  )
  const result = await env.SHARED_REQUEST_OBJECTS.getByName(
    requestToken,
  ).updateRequest({
    now: (dependencies.now ?? Date.now)(),
    expectedRevision,
    editSecretHash,
    operations: body.operations,
  })
  if (result.status !== 'updated') {
    return updateErrorResponse(result, origin)
  }
  return jsonResponse(
    result.request,
    200,
    origin,
    etagForRevision(result.request.revision),
  )
}

export function isSharedRequestApiRoute(pathname: string): boolean {
  return (
    pathname === SHARED_REQUEST_COLLECTION_PATH ||
    pathname.startsWith(`${SHARED_REQUEST_COLLECTION_PATH}/`)
  )
}

export async function handleSharedRequestApiRequest(
  request: Request,
  env: WorkerEnv,
  dependencies: SharedRequestHandlerDependencies = {},
): Promise<Response> {
  const publiclyEnabled = isSharedRequestApiEnabled(env)
  const modeStatus = publiclyEnabled
    ? 'disabled'
    : getManualValidationModeStatus(
        env,
        (dependencies.now ?? Date.now)(),
      )
  if (!publiclyEnabled && modeStatus === 'disabled') {
    return manualValidationErrorResponse('disabled')
  }
  const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS ?? '')
  const requestOrigin = request.headers.get('Origin') ?? ''
  const origin = allowedOrigins.has(requestOrigin)
    ? requestOrigin
    : undefined
  if (!origin) {
    return jsonResponse({ code: 'ORIGIN_NOT_ALLOWED' }, 403)
  }
  if (!publiclyEnabled) {
    if (modeStatus === 'expired') {
      return manualValidationErrorResponse('expired', origin)
    }
    if (request.method === 'POST' || request.method === 'PATCH') {
      const validationStatus = await validateManualValidationSession(
        request,
        env,
        dependencies,
      )
      if (validationStatus !== 'valid') {
        return manualValidationErrorResponse(validationStatus, origin)
      }
    }
  }
  if (!hasSharedRequestConfiguration(env)) {
    return jsonResponse({ code: 'SERVICE_UNAVAILABLE' }, 503, origin)
  }

  const pathname = new URL(request.url).pathname
  const requestToken = SHARED_REQUEST_PATH_PATTERN.exec(pathname)?.[1]
  if (
    pathname !== SHARED_REQUEST_COLLECTION_PATH &&
    (!requestToken || !SHARED_REQUEST_TOKEN_PATTERN.test(requestToken))
  ) {
    return jsonResponse({ code: 'REQUEST_INVALID' }, 400, origin)
  }
  if (
    pathname === SHARED_REQUEST_COLLECTION_PATH &&
    request.method !== 'POST'
  ) {
    return jsonResponse({ code: 'METHOD_NOT_ALLOWED' }, 405, origin)
  }
  if (
    requestToken &&
    request.method !== 'GET' &&
    request.method !== 'PATCH'
  ) {
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
  try {
    if (request.method === 'POST') {
      return await handleCreate(
        request,
        env,
        origin,
        controller.signal,
        dependencies,
      )
    }
    if (request.method === 'GET' && requestToken) {
      return await handleGet(
        request,
        env,
        origin,
        requestToken,
        dependencies,
      )
    }
    if (requestToken) {
      return await handlePatch(
        request,
        env,
        origin,
        requestToken,
        controller.signal,
        dependencies,
      )
    }
    return jsonResponse({ code: 'METHOD_NOT_ALLOWED' }, 405, origin)
  } catch (error) {
    if (error instanceof SharedRequestValidationError) {
      return jsonResponse({ code: error.code }, error.status, origin)
    }
    if (timedOut || controller.signal.aborted) {
      return jsonResponse({ code: 'TIMEOUT' }, 504, origin)
    }
    return jsonResponse({ code: 'SERVICE_UNAVAILABLE' }, 503, origin)
  } finally {
    clearTimeout(timeout)
    request.signal.removeEventListener('abort', abortForClient)
  }
}
