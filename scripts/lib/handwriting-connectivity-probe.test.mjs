import { describe, expect, it, vi } from 'vitest'
import {
  HANDWRITING_PROBE_ORIGIN,
  HANDWRITING_PROBE_REQUEST_ID_HEADER,
  HANDWRITING_PROBE_VARIABLE,
  HANDWRITING_PROBE_WORKER_ORIGIN,
  HandwritingConnectivityProbeError,
  probeHandwritingConnectivity,
  readHandwritingProbeEndpoint,
  validateHandwritingProbeEndpoint,
} from './handwriting-connectivity-probe.mjs'

const endpoint = `${HANDWRITING_PROBE_WORKER_ORIGIN}/`
const requestId = '12345678-1234-4234-8234-123456789abc'

function response({
  status = 400,
  body = { code: 'REQUEST_INVALID' },
  headers = {},
} = {}) {
  const responseHeaders = new Headers({
    'Access-Control-Allow-Origin': HANDWRITING_PROBE_ORIGIN,
    'Access-Control-Expose-Headers':
      HANDWRITING_PROBE_REQUEST_ID_HEADER,
    [HANDWRITING_PROBE_REQUEST_ID_HEADER]: requestId,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  for (const [name, value] of Object.entries(headers)) {
    if (value === '') {
      responseHeaders.delete(name)
    } else {
      responseHeaders.set(name, value)
    }
  }
  return new Response(
    typeof body === 'string' ? body : JSON.stringify(body),
    {
      status,
      headers: responseHeaders,
    },
  )
}

async function expectReason(promise, reason) {
  await expect(promise).rejects.toEqual(
    expect.objectContaining({
      name: 'HandwritingConnectivityProbeError',
      reason,
    }),
  )
}

describe('validateHandwritingProbeEndpoint', () => {
  it('normalizes only the exact production Worker origin', () => {
    expect(
      validateHandwritingProbeEndpoint(
        HANDWRITING_PROBE_WORKER_ORIGIN,
      ),
    ).toBe(endpoint)
    expect(validateHandwritingProbeEndpoint(endpoint)).toBe(endpoint)
  })

  it.each([
    ['', 'empty'],
    [' ', 'whitespace'],
    [
      'https://handwriting-import.example.workers.dev/\nignored',
      'embedded newline',
    ],
    [
      'http://handwriting-import.example.workers.dev/',
      'non-HTTPS',
    ],
    ['https://example.workers.dev/', 'different hostname'],
    [
      'https://handwriting-import.example.workers.dev:8443/',
      'different origin port',
    ],
    [`${endpoint}nested`, 'non-root path'],
    [`${endpoint}?mode=probe`, 'query'],
    [`${endpoint}?`, 'empty query'],
    [`${endpoint}#probe`, 'hash'],
    [`${endpoint}#`, 'empty hash'],
    [
      'https://user:password@handwriting-import.example.workers.dev/',
      'credentials',
    ],
    ['https://localhost/', 'localhost'],
  ])('rejects an endpoint with %s (%s)', (value) => {
    expect(() => validateHandwritingProbeEndpoint(value)).toThrow(
      expect.objectContaining({ reason: 'endpoint-invalid' }),
    )
  })
})

describe('readHandwritingProbeEndpoint', () => {
  it('reads only the public Endpoint Repository Variable', async () => {
    const runCaptured = vi.fn(async () => ({
      stdout: `${endpoint}\n`,
      stderr: 'safe warning',
      exitCode: 0,
    }))

    await expect(
      readHandwritingProbeEndpoint({ runCaptured }),
    ).resolves.toBe(endpoint)
    expect(runCaptured).toHaveBeenCalledTimes(1)
    expect(runCaptured).toHaveBeenCalledWith('gh', [
      'variable',
      'get',
      HANDWRITING_PROBE_VARIABLE,
      '--repo',
      'plain-relay/kaimono-baton',
    ])
    const command = JSON.stringify(runCaptured.mock.calls)
    expect(command).not.toContain('secret')
    expect(command).not.toContain('wrangler')
    expect(command).not.toContain('workflow')
    expect(command).not.toContain('TURNSTILE_SITE_KEY')
  })

  it.each([
    {
      label: 'empty output',
      result: { stdout: '', stderr: '', exitCode: 0 },
      reason: 'endpoint-invalid',
    },
    {
      label: 'nonzero exit',
      result: { stdout: '', stderr: 'credential detail', exitCode: 1 },
      reason: 'endpoint-unavailable',
    },
  ])('rejects $label without exposing command output', async ({
    result,
    reason,
  }) => {
    await expectReason(
      readHandwritingProbeEndpoint({
        runCaptured: vi.fn(async () => result),
      }),
      reason,
    )
  })
})

describe('probeHandwritingConnectivity', () => {
  it('accepts only the expected safe rejection and sends an empty form', async () => {
    const fetchImplementation = vi.fn(async (_url, init) => {
      expect(_url).toBe(endpoint)
      expect(init.method).toBe('POST')
      expect(init.redirect).toBe('manual')
      expect(init.signal).toBeInstanceOf(AbortSignal)
      expect(new Headers(init.headers).get('Origin')).toBe(
        HANDWRITING_PROBE_ORIGIN,
      )
      expect(new Headers(init.headers).has('Content-Type')).toBe(false)
      expect(init.body).toBeInstanceOf(FormData)
      expect([...init.body.entries()]).toEqual([])
      const browserLikeRequest = new Request(_url, init)
      expect(browserLikeRequest.headers.get('Content-Type')).toMatch(
        /^multipart\/form-data;\s*boundary=/iu,
      )
      expect([
        ...(await browserLikeRequest.formData()).entries(),
      ]).toEqual([])
      return response({
        headers: {
          'access-control-expose-headers':
            `Other-Header, ${HANDWRITING_PROBE_REQUEST_ID_HEADER}`,
          'x-otsukai-request-id': requestId,
        },
      })
    })

    await expect(
      probeHandwritingConnectivity(endpoint, {
        fetchImplementation,
        now: vi
          .fn()
          .mockReturnValueOnce(100)
          .mockReturnValueOnce(125),
      }),
    ).resolves.toEqual({
      endpoint,
      httpStatus: 400,
      corsOrigin: HANDWRITING_PROBE_ORIGIN,
      requestIdHeaderExposed: true,
      responseCode: 'REQUEST_INVALID',
      elapsedMs: 25,
    })
    expect(fetchImplementation).toHaveBeenCalledTimes(1)
  })

  it('maps network rejection to a finite reason', async () => {
    await expectReason(
      probeHandwritingConnectivity(endpoint, {
        fetchImplementation: vi.fn(async () => {
          throw new Error('raw network detail')
        }),
      }),
      'network-unavailable',
    )
  })

  it('aborts a timed-out fetch and clears its timer', async () => {
    const clearTimeoutImplementation = vi.fn()
    const fetchImplementation = vi.fn(
      async (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener(
            'abort',
            () => reject(new DOMException('raw timeout', 'AbortError')),
            { once: true },
          )
        }),
    )

    await expectReason(
      probeHandwritingConnectivity(endpoint, {
        fetchImplementation,
        setTimeoutImplementation: (callback) => {
          queueMicrotask(callback)
          return 42
        },
        clearTimeoutImplementation,
      }),
      'timeout',
    )
    expect(clearTimeoutImplementation).toHaveBeenCalledWith(42)
    expect(fetchImplementation.mock.calls[0][1].signal.aborted).toBe(true)
  })

  it('clears the timeout after a successful response', async () => {
    const clearTimeoutImplementation = vi.fn()
    await probeHandwritingConnectivity(endpoint, {
      fetchImplementation: vi.fn(async () => response()),
      setTimeoutImplementation: vi.fn(() => 24),
      clearTimeoutImplementation,
    })
    expect(clearTimeoutImplementation).toHaveBeenCalledWith(24)
  })

  it('rejects redirects without following them', async () => {
    await expectReason(
      probeHandwritingConnectivity(endpoint, {
        fetchImplementation: vi.fn(async () =>
          response({ status: 302 }),
        ),
      }),
      'redirect',
    )
  })

  it.each([200, 401, 403, 404, 429, 500, 502, 503])(
    'rejects unexpected HTTP status %s',
    async (status) => {
      await expectReason(
        probeHandwritingConnectivity(endpoint, {
          fetchImplementation: vi.fn(async () =>
            response({ status }),
          ),
        }),
        'unexpected-status',
      )
    },
  )

  it.each([
    {
      label: 'missing CORS origin',
      headers: { 'Access-Control-Allow-Origin': '' },
      reason: 'cors-origin-missing',
    },
    {
      label: 'different CORS origin',
      headers: { 'Access-Control-Allow-Origin': 'https://example.com' },
      reason: 'cors-origin-mismatch',
    },
    {
      label: 'multiple CORS origins',
      headers: {
        'Access-Control-Allow-Origin':
          `${HANDWRITING_PROBE_ORIGIN}, https://example.com`,
      },
      reason: 'cors-origin-mismatch',
    },
    {
      label: 'missing exposed header',
      headers: { 'Access-Control-Expose-Headers': '' },
      reason: 'expose-header-missing',
    },
    {
      label: 'different exposed header',
      headers: { 'Access-Control-Expose-Headers': 'Other-Header' },
      reason: 'expose-header-missing',
    },
    {
      label: 'missing request ID',
      headers: { [HANDWRITING_PROBE_REQUEST_ID_HEADER]: '' },
      reason: 'request-id-invalid',
    },
    {
      label: 'invalid request ID',
      headers: {
        [HANDWRITING_PROBE_REQUEST_ID_HEADER]: 'bad id',
      },
      reason: 'request-id-invalid',
    },
    {
      label: 'wrong content type',
      headers: { 'Content-Type': 'text/html' },
      reason: 'content-type-invalid',
    },
    {
      label: 'missing cache control',
      headers: { 'Cache-Control': '' },
      reason: 'cache-control-invalid',
    },
  ])('rejects $label', async ({ headers, reason }) => {
    await expectReason(
      probeHandwritingConnectivity(endpoint, {
        fetchImplementation: vi.fn(async () => response({ headers })),
      }),
      reason,
    )
  })

  it.each([
    ['not-json', 'non-JSON'],
    [[], 'array'],
    [{ code: 'REQUEST_INVALID', detail: 'extra' }, 'extra key'],
    [{ code: 'AUTH_FAILED' }, 'different code'],
  ])('rejects a response body that is %s (%s)', async (body) => {
    await expectReason(
      probeHandwritingConnectivity(endpoint, {
        fetchImplementation: vi.fn(async () =>
          response({
            body:
              body === 'not-json'
                ? '<html>not json</html>'
                : body,
          }),
        ),
      }),
      'response-body-invalid',
    )
  })

  it('uses a finite error type with no response body or stack data', () => {
    const error = new HandwritingConnectivityProbeError(
      'response-body-invalid',
    )
    expect(error.reason).toBe('response-body-invalid')
    expect(error.message).toBe('response-body-invalid')
    expect(JSON.stringify(error)).not.toContain('REQUEST_INVALID')
    expect(new HandwritingConnectivityProbeError('raw detail').reason).toBe(
      'unexpected-failure',
    )
  })
})
