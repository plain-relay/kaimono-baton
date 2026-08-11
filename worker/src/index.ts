import {
  analyzeHandwritingWithGemini,
  GeminiAnalysisError,
} from './gemini'
import {
  createWorkerDiagnostics,
  isWorkerDiagnosticsEnabled,
  type WorkerDiagnosticErrorClass,
} from './diagnostics'
import {
  hasHandwritingConfiguration,
  type WorkerEnv,
} from './config'
import {
  handlePhotoApiRequest,
  isPhotoApiRoute,
  type PhotoHandlerDependencies,
} from './photoHandler'
import {
  createWorkerRequestId,
  WORKER_REQUEST_ID_HEADER,
} from './requestId'
import {
  handleManualValidationSessionRequest,
  MANUAL_VALIDATION_SESSION_HEADER,
  MANUAL_VALIDATION_SESSION_PATH,
} from './manualValidation'
import { parseGeminiHandwritingResult } from './resultValidation'
import {
  handleSharedRequestApiRequest,
  isSharedRequestApiRoute,
  type SharedRequestHandlerDependencies,
} from './sharedRequestHandler'
import { verifyTurnstileToken } from './turnstile'
import type { HandwritingImportResult } from './types'
import {
  parseAllowedOrigins,
  RequestValidationError,
  type SupportedImageMime,
  validateHandwritingImportRequest,
} from './validation'

export const HANDWRITING_REQUEST_ID_HEADER = WORKER_REQUEST_ID_HEADER

export {
  hasHandwritingConfiguration,
  hasPhotoConfiguration,
  hasSharedRequestConfiguration,
  isPhotoApiEnabled,
  isSharedRequestApiEnabled,
} from './config'
export type { WorkerEnv } from './config'
export { PhotoObject } from './photoObject'
export { SharedRequestObject } from './sharedRequestObject'

export type WorkerDependencies = {
  fetchImplementation?: typeof fetch
  analyzeImplementation?: typeof analyzeHandwritingWithGemini
  timeoutMs?: number
  now?: () => number
  logImplementation?: (message: string) => void
  createRequestId?: () => string
  photoDependencies?: PhotoHandlerDependencies
  sharedRequestDependencies?: SharedRequestHandlerDependencies
}

const DEFAULT_TIMEOUT_MS = 15_000

function corsHeaders(
  origin: string | undefined,
  requestId: string,
): HeadersInit {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    [HANDWRITING_REQUEST_ID_HEADER]: requestId,
    ...(origin
      ? {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Expose-Headers':
            HANDWRITING_REQUEST_ID_HEADER,
          Vary: 'Origin',
        }
      : {}),
  }
}

function jsonResponse(
  body: HandwritingImportResult | { code: string },
  status: number,
  requestId: string,
  origin?: string,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(origin, requestId),
  })
}

type ErrorResponse = {
  code: string
  status: number
  errorClass: WorkerDiagnosticErrorClass
}

function geminiErrorDetails(
  error: GeminiAnalysisError,
): ErrorResponse {
  switch (error.kind) {
    case 'analysis-limit':
      return {
        code: 'ANALYSIS_LIMIT',
        status: 429,
        errorClass: 'analysis-limit',
      }
    case 'invalid-response':
      return {
        code: 'INVALID_ANALYSIS_RESPONSE',
        status: 502,
        errorClass: 'invalid-response',
      }
    case 'safety-blocked':
      return {
        code: 'SAFETY_BLOCKED',
        status: 422,
        errorClass: 'safety-blocked',
      }
    case 'unavailable':
      return {
        code: 'SERVICE_UNAVAILABLE',
        status: 502,
        errorClass: 'gemini-unavailable',
      }
  }
}

export async function handleRequest(
  request: Request,
  env: WorkerEnv,
  dependencies: WorkerDependencies = {},
): Promise<Response> {
  const now = dependencies.now ?? Date.now
  const startedAt = now()
  let requestId = (
    dependencies.createRequestId ?? createWorkerRequestId
  )()
  const diagnostics = createWorkerDiagnostics({
    enabled: isWorkerDiagnosticsEnabled(env.DIAGNOSTIC_MODE),
    requestId,
    startedAt,
    now,
    ...(dependencies.logImplementation
      ? { log: dependencies.logImplementation }
      : {}),
  })
  const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS ?? '')
  const requestOrigin = request.headers.get('Origin') ?? ''
  const responseOrigin = allowedOrigins.has(requestOrigin)
    ? requestOrigin
    : undefined
  const respond = (
    body: HandwritingImportResult | { code: string },
    status: number,
    origin?: string,
  ) => {
    diagnostics.record('response-sent', { httpStatus: status })
    return jsonResponse(body, status, requestId, origin)
  }

  diagnostics.record('request-received')
  if (request.method !== 'POST') {
    diagnostics.record('request-rejected', {
      httpStatus: 405,
      errorClass: 'method-not-allowed',
    })
    return respond({ code: 'METHOD_NOT_ALLOWED' }, 405, responseOrigin)
  }
  if (!responseOrigin) {
    diagnostics.record('request-rejected', {
      httpStatus: 403,
      errorClass: 'origin-not-allowed',
    })
    return respond({ code: 'ORIGIN_NOT_ALLOWED' }, 403)
  }
  if (!hasHandwritingConfiguration(env)) {
    diagnostics.record('request-rejected', {
      httpStatus: 503,
      errorClass: 'configuration',
    })
    return respond(
      { code: 'SERVICE_UNAVAILABLE' },
      503,
      responseOrigin,
    )
  }

  const controller = new AbortController()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const abortForClient = () => controller.abort()
  request.signal.addEventListener('abort', abortForClient, { once: true })
  const fetchImplementation = dependencies.fetchImplementation ?? fetch
  const analyzeImplementation =
    dependencies.analyzeImplementation ?? analyzeHandwritingWithGemini

  try {
    const validated = await validateHandwritingImportRequest(
      request,
      allowedOrigins,
      requestId,
    )
    requestId = validated.requestId
    diagnostics.setRequestId(requestId)
    diagnostics.record('request-validated', {
      imageBytes: validated.image.size,
      productCandidateCount: validated.products.length,
    })
    diagnostics.record('turnstile-verification-started')
    const verified = await verifyTurnstileToken({
      token: validated.turnstileToken,
      secret: env.TURNSTILE_SECRET_KEY,
      origin: validated.origin,
      remoteIp: validated.remoteIp,
      fetchImplementation,
      signal: controller.signal,
    })
    if (!verified) {
      diagnostics.record('request-rejected', {
        httpStatus: 403,
        errorClass: 'turnstile',
      })
      return respond(
        { code: 'AUTH_FAILED' },
        403,
        validated.origin,
      )
    }
    diagnostics.record('turnstile-verified')

    diagnostics.record('gemini-request-started')
    const outputText = await analyzeImplementation({
      image: validated.image,
      mimeType: validated.image.type as SupportedImageMime,
      products: validated.products,
      apiKey: env.GEMINI_API_KEY,
      signal: controller.signal,
    })
    diagnostics.record('gemini-request-completed')
    const result = parseGeminiHandwritingResult(
      outputText,
      validated.products,
    )
    diagnostics.record('result-validated', {
      resultItemCount: result.items.length,
      matchedCount: result.items.filter(
        (item) => item.status === 'matched',
      ).length,
      ambiguousCount: result.items.filter(
        (item) => item.status === 'ambiguous',
      ).length,
      unknownCount: result.items.filter(
        (item) => item.status === 'unknown',
      ).length,
    })
    return respond(result, 200, validated.origin)
  } catch (error) {
    if (error instanceof RequestValidationError) {
      diagnostics.record('request-rejected', {
        httpStatus: error.status,
        errorClass: 'request-validation',
      })
      return respond(
        { code: error.code },
        error.status,
        responseOrigin,
      )
    }
    if (timedOut || controller.signal.aborted) {
      diagnostics.record('request-timed-out', {
        httpStatus: 504,
        errorClass: 'timeout',
      })
      return respond({ code: 'TIMEOUT' }, 504, responseOrigin)
    }
    if (error instanceof GeminiAnalysisError) {
      const details = geminiErrorDetails(error)
      diagnostics.record('request-failed', {
        httpStatus: details.status,
        errorClass: details.errorClass,
      })
      return respond(
        { code: details.code },
        details.status,
        responseOrigin,
      )
    }
    diagnostics.record('request-failed', {
      httpStatus: 500,
      errorClass: 'unexpected',
    })
    return respond(
      { code: 'SERVICE_UNAVAILABLE' },
      500,
      responseOrigin,
    )
  } finally {
    clearTimeout(timeout)
    request.signal.removeEventListener('abort', abortForClient)
  }
}

function preflightResponse(
  origin: string | undefined,
  requestId: string,
): Response {
  if (!origin) {
    return jsonResponse({ code: 'ORIGIN_NOT_ALLOWED' }, 403, requestId)
  }

  return new Response(null, {
    status: 204,
    headers: {
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
      'Access-Control-Allow-Headers':
        `Content-Type, If-Match, If-None-Match, ${MANUAL_VALIDATION_SESSION_HEADER}`,
      'Access-Control-Expose-Headers': WORKER_REQUEST_ID_HEADER,
      [WORKER_REQUEST_ID_HEADER]: requestId,
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    },
  })
}

export function routeRequest(
  request: Request,
  env: WorkerEnv,
  dependencies: WorkerDependencies = {},
): Promise<Response> | Response {
  const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS ?? '')
  const requestOrigin = request.headers.get('Origin') ?? ''
  const responseOrigin = allowedOrigins.has(requestOrigin)
    ? requestOrigin
    : undefined

  if (request.method === 'OPTIONS') {
    const requestId = (
      dependencies.createRequestId ?? createWorkerRequestId
    )()
    return preflightResponse(responseOrigin, requestId)
  }

  const pathname = new URL(request.url).pathname
  if (pathname === MANUAL_VALIDATION_SESSION_PATH) {
    return handleManualValidationSessionRequest(request, env, {
      now: dependencies.now,
    })
  }
  if (isPhotoApiRoute(pathname)) {
    return handlePhotoApiRequest(
      request,
      env,
      dependencies.photoDependencies ?? {
        fetchImplementation: dependencies.fetchImplementation,
        timeoutMs: dependencies.timeoutMs,
        now: dependencies.now,
        logImplementation: dependencies.logImplementation,
        createRequestId: dependencies.createRequestId,
      },
    )
  }
  if (isSharedRequestApiRoute(pathname)) {
    return handleSharedRequestApiRequest(
      request,
      env,
      dependencies.sharedRequestDependencies ?? {
        fetchImplementation: dependencies.fetchImplementation,
        timeoutMs: dependencies.timeoutMs,
        now: dependencies.now,
      },
    )
  }
  if (pathname === '/' || pathname === '/v1/handwriting/analyze') {
    return handleRequest(request, env, dependencies)
  }

  const requestId = (
    dependencies.createRequestId ?? createWorkerRequestId
  )()
  return jsonResponse(
    { code: 'NOT_FOUND' },
    404,
    requestId,
    responseOrigin,
  )
}

export default {
  fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return Promise.resolve(routeRequest(request, env))
  },
}
