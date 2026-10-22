import {
  hasHandwritingConfiguration,
  type WorkerEnv,
} from './config'
import {
  createWorkerDiagnostics,
  isWorkerDiagnosticsEnabled,
  type WorkerDiagnosticErrorClass,
} from './diagnostics'
import {
  analyzeHandwritingWithGemini,
  GeminiAnalysisError,
} from './gemini'
import { createWorkerRequestId } from './requestId'
import { parseGeminiHandwritingResult } from './resultValidation'
import { verifyTurnstileToken } from './turnstile'
import type { HandwritingImportResult } from './types'
import {
  parseAllowedOrigins,
  RequestValidationError,
  type SupportedImageMime,
  validateHandwritingImportRequest,
} from './validation'

import { handwritingJsonResponse as jsonResponse } from './handwritingResponse'

export type HandwritingHandlerDependencies = {
  fetchImplementation?: typeof fetch
  analyzeImplementation?: typeof analyzeHandwritingWithGemini
  timeoutMs?: number
  now?: () => number
  logImplementation?: (message: string) => void
  createRequestId?: () => string
}

const DEFAULT_TIMEOUT_MS = 15_000

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
  dependencies: HandwritingHandlerDependencies = {},
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
