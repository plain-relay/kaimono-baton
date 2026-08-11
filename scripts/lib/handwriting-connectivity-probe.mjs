export const HANDWRITING_PROBE_REPOSITORY = 'plain-relay/kaimono-baton'
export const HANDWRITING_PROBE_VARIABLE =
  'VITE_HANDWRITING_IMPORT_ENDPOINT'
export const HANDWRITING_PROBE_ORIGIN =
  'https://plain-relay.github.io'
export const HANDWRITING_PROBE_WORKER_ORIGIN =
  'https://handwriting-import.example.workers.dev'
export const HANDWRITING_PROBE_REQUEST_ID_HEADER =
  'X-Otsukai-Request-Id'

const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/u
const DEFAULT_TIMEOUT_MS = 10_000
export const HANDWRITING_PROBE_FAILURE_REASONS = Object.freeze([
  'endpoint-invalid',
  'endpoint-unavailable',
  'network-unavailable',
  'timeout',
  'redirect',
  'unexpected-status',
  'cors-origin-missing',
  'cors-origin-mismatch',
  'expose-header-missing',
  'request-id-invalid',
  'content-type-invalid',
  'cache-control-invalid',
  'response-body-invalid',
  'unexpected-failure',
])
const FAILURE_REASONS = new Set(HANDWRITING_PROBE_FAILURE_REASONS)

export class HandwritingConnectivityProbeError extends Error {
  constructor(reason) {
    const safeReason = FAILURE_REASONS.has(reason)
      ? reason
      : 'unexpected-failure'
    super(safeReason)
    this.name = 'HandwritingConnectivityProbeError'
    this.reason = safeReason
  }
}

function fail(reason) {
  throw new HandwritingConnectivityProbeError(reason)
}

export function validateHandwritingProbeEndpoint(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    value !== value.trim() ||
    /\s/u.test(value)
  ) {
    fail('endpoint-invalid')
  }

  let endpoint
  try {
    endpoint = new URL(value)
  } catch {
    fail('endpoint-invalid')
  }

  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username ||
    endpoint.password ||
    value.includes('?') ||
    value.includes('#') ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.origin !== HANDWRITING_PROBE_WORKER_ORIGIN ||
    endpoint.pathname !== '/'
  ) {
    fail('endpoint-invalid')
  }

  return `${endpoint.origin}/`
}

export async function readHandwritingProbeEndpoint({
  runCaptured,
  repository = HANDWRITING_PROBE_REPOSITORY,
} = {}) {
  if (typeof runCaptured !== 'function') {
    fail('endpoint-unavailable')
  }

  let result
  try {
    result = await runCaptured('gh', [
      'variable',
      'get',
      HANDWRITING_PROBE_VARIABLE,
      '--repo',
      repository,
    ])
  } catch {
    fail('endpoint-unavailable')
  }

  if (
    !result ||
    result.exitCode !== 0 ||
    typeof result.stdout !== 'string'
  ) {
    fail('endpoint-unavailable')
  }

  return validateHandwritingProbeEndpoint(
    result.stdout.replace(/\r?\n$/u, ''),
  )
}

function hasExposedRequestId(headers) {
  const value = headers.get('Access-Control-Expose-Headers')
  if (!value) {
    return false
  }
  return value
    .split(',')
    .map((header) => header.trim().toLowerCase())
    .includes(HANDWRITING_PROBE_REQUEST_ID_HEADER.toLowerCase())
}

function isExactSafeResponseBody(value) {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value)
  ) {
    return false
  }
  const keys = Object.keys(value)
  return (
    keys.length === 1 &&
    keys[0] === 'code' &&
    value.code === 'REQUEST_INVALID'
  )
}

export async function probeHandwritingConnectivity(
  endpointValue,
  {
    fetchImplementation = fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    now = Date.now,
    setTimeoutImplementation = setTimeout,
    clearTimeoutImplementation = clearTimeout,
  } = {},
) {
  const endpoint = validateHandwritingProbeEndpoint(endpointValue)
  const controller = new AbortController()
  let timedOut = false
  const startedAt = now()
  const timeout = setTimeoutImplementation(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    let response
    try {
      response = await fetchImplementation(endpoint, {
        method: 'POST',
        headers: {
          Origin: HANDWRITING_PROBE_ORIGIN,
        },
        body: new FormData(),
        redirect: 'manual',
        signal: controller.signal,
      })
    } catch {
      fail(timedOut ? 'timeout' : 'network-unavailable')
    }

    if (response.status >= 300 && response.status < 400) {
      fail('redirect')
    }
    if (response.status !== 400) {
      fail('unexpected-status')
    }

    const corsOrigin = response.headers.get(
      'Access-Control-Allow-Origin',
    )
    if (!corsOrigin) {
      fail('cors-origin-missing')
    }
    if (corsOrigin !== HANDWRITING_PROBE_ORIGIN) {
      fail('cors-origin-mismatch')
    }
    if (!hasExposedRequestId(response.headers)) {
      fail('expose-header-missing')
    }

    const requestId = response.headers.get(
      HANDWRITING_PROBE_REQUEST_ID_HEADER,
    )
    if (!requestId || !REQUEST_ID_PATTERN.test(requestId)) {
      fail('request-id-invalid')
    }

    const contentType = response.headers.get('Content-Type')
    if (
      !contentType ||
      contentType.split(';', 1)[0].trim().toLowerCase() !==
        'application/json'
    ) {
      fail('content-type-invalid')
    }
    if (
      response.headers.get('Cache-Control')?.trim().toLowerCase() !==
      'no-store'
    ) {
      fail('cache-control-invalid')
    }

    let body
    try {
      body = await response.json()
    } catch {
      fail(timedOut ? 'timeout' : 'response-body-invalid')
    }
    if (!isExactSafeResponseBody(body)) {
      fail('response-body-invalid')
    }

    return {
      endpoint,
      httpStatus: response.status,
      corsOrigin,
      requestIdHeaderExposed: true,
      responseCode: body.code,
      elapsedMs: Math.max(0, Math.round(now() - startedAt)),
    }
  } finally {
    clearTimeoutImplementation(timeout)
  }
}
