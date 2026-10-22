import {
  type WorkerEnv
} from './config'
import {
  handleManualValidationSessionRequest,
  MANUAL_VALIDATION_SESSION_HEADER,
  MANUAL_VALIDATION_SESSION_PATH,
} from './manualValidation'
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
  handleSharedRequestApiRequest,
  isSharedRequestApiRoute,
  type SharedRequestHandlerDependencies,
} from './sharedRequestHandler'
import {
  parseAllowedOrigins
} from './validation'

import { handleRequest, type HandwritingHandlerDependencies } from './handwritingHandler'
import { handwritingJsonResponse as jsonResponse } from './handwritingResponse'

export { handleRequest } from './handwritingHandler'
export { HANDWRITING_REQUEST_ID_HEADER } from './handwritingResponse'

export {
  hasHandwritingConfiguration,
  hasPhotoConfiguration,
  hasSharedRequestConfiguration,
  isPhotoApiEnabled,
  isSharedRequestApiEnabled
} from './config'
export type { WorkerEnv } from './config'
export { PhotoObject } from './photoObject'
export { SharedRequestObject } from './sharedRequestObject'

export type WorkerDependencies = HandwritingHandlerDependencies & {
  photoDependencies?: PhotoHandlerDependencies
  sharedRequestDependencies?: SharedRequestHandlerDependencies
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
