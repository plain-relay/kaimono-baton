import { afterEach, describe, expect, it, vi } from 'vitest'
import { GeminiAnalysisError } from '../src/gemini'
import { PHOTO_TURNSTILE_ACTION } from '../src/photoHandler'
import type { PhotoObject } from '../src/photoObject'
import { SHARED_REQUEST_CREATE_ACTION } from '../src/sharedRequestConstants'
import type {
  CreateSharedRequestInput,
  SharedRequestObject,
} from '../src/sharedRequestObject'
import {
  HANDWRITING_REQUEST_ID_HEADER,
  hasHandwritingConfiguration,
  hasPhotoConfiguration,
  hasSharedRequestConfiguration,
  handleRequest,
  routeRequest,
  type WorkerDependencies,
  type WorkerEnv,
} from '../src/index'
import {
  MAX_IMAGE_BYTES,
  MAX_PRODUCT_CANDIDATES,
} from '../src/validation'
import { photoBatchRequest } from './photoTestHelpers'

const allowedOrigin = 'https://plain-relay.github.io'
const env: WorkerEnv = {
  GEMINI_API_KEY: 'gemini-secret-value',
  TURNSTILE_SECRET_KEY: 'turnstile-secret-value',
  ALLOWED_ORIGINS: allowedOrigin,
  DIAGNOSTIC_MODE: 'false',
}
const products = [
  {
    id: 'eggs',
    name: '卵',
    aliases: ['たまご', '玉子'],
  },
  {
    id: 'milk',
    name: '牛乳',
    aliases: [],
  },
]

function jpegFile(size = 4, mime = 'image/jpeg'): File {
  const bytes = new Uint8Array(Math.max(size, 4))
  bytes.set([0xff, 0xd8, 0xff, 0xe0])
  return new File([bytes], 'memo.jpg', { type: mime })
}

function importRequest(
  options: {
    origin?: string
    file?: File
    token?: string
    method?: string
    productsJson?: string
    requestId?: string
    omitRequestId?: boolean
    extraField?: [string, string]
    pathname?: string
  } = {},
): Request {
  const formData = new FormData()
  formData.append('image', options.file ?? jpegFile())
  formData.append('turnstileToken', options.token ?? 'single-use-token')
  formData.append(
    'products',
    options.productsJson ?? JSON.stringify(products),
  )
  if (!options.omitRequestId) {
    formData.append(
      'requestId',
      options.requestId ?? 'client-request-123',
    )
  }
  if (options.extraField) {
    formData.append(...options.extraField)
  }
  return new Request(
    `https://import.example.workers.dev${options.pathname ?? '/'}`,
    {
      method: options.method ?? 'POST',
      headers: {
        Origin: options.origin ?? allowedOrigin,
      },
      ...(options.method === 'GET' ? {} : { body: formData }),
    },
  )
}

function successfulTurnstileFetch() {
  return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    expect(init?.method).toBe('POST')
    expect(String(init?.body)).toContain('response=single-use-token')
    return Response.json({
      success: true,
      action: 'handwriting_import',
      hostname: 'plain-relay.github.io',
    })
  }) as typeof fetch
}

function successfulOutput(): string {
  return JSON.stringify({
    version: 1,
    items: [
      {
        sourceText: 'たまご',
        status: 'matched',
        productId: 'eggs',
        candidateProductIds: [],
      },
      {
        sourceText: '電池',
        status: 'unknown',
        productId: null,
        candidateProductIds: [],
      },
    ],
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Worker routing and feature configuration', () => {
  it.each(['/', '/v1/handwriting/analyze'])(
    'routes POST %s through the same handwriting handler',
    async (pathname) => {
      const analyzeImplementation = vi.fn(async () => successfulOutput())
      const response = await routeRequest(
        importRequest({ pathname }),
        env,
        {
          fetchImplementation: successfulTurnstileFetch(),
          analyzeImplementation,
        },
      )

      expect(response.status).toBe(200)
      expect(analyzeImplementation).toHaveBeenCalledTimes(1)
      await expect(response.json()).resolves.toEqual(
        JSON.parse(successfulOutput()),
      )
    },
  )

  it('answers an allowed CORS preflight without invoking handwriting services', async () => {
    const analyzeImplementation = vi.fn(async () => successfulOutput())
    const fetchImplementation = vi.fn() as typeof fetch
    const response = await routeRequest(
      new Request('https://import.example.workers.dev/v1/future-route', {
        method: 'OPTIONS',
        headers: { Origin: allowedOrigin },
      }),
      env,
      {
        analyzeImplementation,
        fetchImplementation,
        createRequestId: () => 'worker-preflight-id',
      },
    )

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      allowedOrigin,
    )
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe(
      'GET, POST, PATCH, OPTIONS',
    )
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe(
      'Content-Type, If-Match, If-None-Match, X-Otsukai-Validation-Session',
    )
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('X-Otsukai-Request-Id')).toBe(
      'worker-preflight-id',
    )
    expect(response.headers.get('Access-Control-Expose-Headers')).toBe(
      'X-Otsukai-Request-Id',
    )
    expect(analyzeImplementation).not.toHaveBeenCalled()
    expect(fetchImplementation).not.toHaveBeenCalled()
  })

  it('rejects a preflight from an unlisted origin', async () => {
    const response = await routeRequest(
      new Request('https://import.example.workers.dev/', {
        method: 'OPTIONS',
        headers: { Origin: 'https://attacker.example' },
      }),
      env,
      { createRequestId: () => 'worker-preflight-id' },
    )

    expect(response.status).toBe(403)
    expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false)
    await expect(response.json()).resolves.toEqual({
      code: 'ORIGIN_NOT_ALLOWED',
    })
  })

  it('returns a safe 404 for routes that are not published', async () => {
    const response = await routeRequest(
      importRequest({ pathname: '/v1/photos/batch' }),
      env,
      { createRequestId: () => 'worker-not-found-id' },
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ code: 'NOT_FOUND' })
  })

  it('routes an enabled photo upload without invoking Gemini', async () => {
    const analyzeImplementation = vi.fn(async () => {
      throw new Error('Gemini must not be called by photo routes')
    })
    const savePhoto = vi.fn(async () => ({ status: 'created' as const }))
    const photoObjects = {
      getByName: vi.fn(() => ({
        savePhoto,
        deletePhoto: vi.fn(),
      })),
    } as unknown as DurableObjectNamespace<PhotoObject>
    const response = await routeRequest(
      photoBatchRequest(),
      {
        TURNSTILE_SECRET_KEY: 'turnstile-secret-value',
        ALLOWED_ORIGINS: allowedOrigin,
        PHOTO_API_ENABLED: 'true',
        PHOTO_OBJECTS: photoObjects,
      },
      {
        analyzeImplementation,
        photoDependencies: {
          fetchImplementation: vi.fn(async () =>
            Response.json({
              success: true,
              action: PHOTO_TURNSTILE_ACTION,
              hostname: 'plain-relay.github.io',
            }),
          ) as typeof fetch,
        },
      },
    )

    expect(response.status).toBe(200)
    expect(savePhoto).toHaveBeenCalledTimes(1)
    expect(analyzeImplementation).not.toHaveBeenCalled()
  })

  it('routes an enabled shared request create without Gemini or photo bindings', async () => {
    const analyzeImplementation = vi.fn(async () => {
      throw new Error('Gemini must not be called by shared request routes')
    })
    const createRequest = vi.fn(async (input: CreateSharedRequestInput) => ({
      status: 'created' as const,
      request: {
        schemaVersion: 1 as const,
        requestId: input.requestId,
        revision: 1,
        createdAt: new Date(input.createdAt).toISOString(),
        expiresAt: new Date(input.expiresAt).toISOString(),
        updatesCount: 0,
        items: input.items.map((item) => ({
          ...item,
          lifecycle: 'active' as const,
          createdRevision: 1,
          updatedRevision: 1,
        })),
      },
    }))
    const sharedObjects = {
      getByName: vi.fn(() => ({ createRequest })),
    } as unknown as DurableObjectNamespace<SharedRequestObject>
    const response = await routeRequest(
      new Request('https://import.example.workers.dev/v1/requests', {
        method: 'POST',
        headers: {
          Origin: allowedOrigin,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          turnstileToken: 'single-use-token',
          items: [
            {
              itemId: 'item-milk',
              productId: 'milk',
              productNameSnapshot: '牛乳',
              categoryIdSnapshot: 'dairy',
              categoryNameSnapshot: '乳製品',
              quantity: 1,
              unit: '本',
              iconSnapshot: '🥛',
              sortOrderSnapshot: 1,
            },
          ],
        }),
      }),
      {
        TURNSTILE_SECRET_KEY: 'turnstile-secret-value',
        ALLOWED_ORIGINS: allowedOrigin,
        SHARED_REQUEST_API_ENABLED: 'true',
        SHARED_REQUEST_OBJECTS: sharedObjects,
      },
      {
        analyzeImplementation,
        sharedRequestDependencies: {
          fetchImplementation: vi.fn(async () =>
            Response.json({
              success: true,
              action: SHARED_REQUEST_CREATE_ACTION,
              hostname: 'plain-relay.github.io',
            }),
          ) as typeof fetch,
        },
      },
    )

    expect(response.status).toBe(201)
    expect(createRequest).toHaveBeenCalledTimes(1)
    expect(analyzeImplementation).not.toHaveBeenCalled()
  })

  it('keeps feature configuration independent from Gemini', () => {
    const withoutGemini = {
      ...env,
      GEMINI_API_KEY: undefined,
      PHOTO_API_ENABLED: 'true',
      SHARED_REQUEST_API_ENABLED: 'true',
      PHOTO_OBJECTS: {} as NonNullable<WorkerEnv['PHOTO_OBJECTS']>,
      SHARED_REQUEST_OBJECTS:
        {} as NonNullable<WorkerEnv['SHARED_REQUEST_OBJECTS']>,
    }

    expect(hasHandwritingConfiguration(withoutGemini)).toBe(false)
    expect(hasPhotoConfiguration(withoutGemini)).toBe(true)
    expect(hasSharedRequestConfiguration(withoutGemini)).toBe(true)
  })

  it('treats missing or non-true feature flags as off', () => {
    expect(hasPhotoConfiguration(env)).toBe(false)
    expect(hasSharedRequestConfiguration(env)).toBe(false)
    expect(
      hasPhotoConfiguration({ ...env, PHOTO_API_ENABLED: '1' }),
    ).toBe(false)
    expect(
      hasSharedRequestConfiguration({
        ...env,
        SHARED_REQUEST_API_ENABLED: 'false',
      }),
    ).toBe(false)
  })

  it('requires only shared API prerequisites for each disabled service boundary', () => {
    expect(
      hasPhotoConfiguration({
        ...env,
        PHOTO_API_ENABLED: 'true',
        TURNSTILE_SECRET_KEY: '',
      }),
    ).toBe(false)
    expect(
      hasSharedRequestConfiguration({
        ...env,
        SHARED_REQUEST_API_ENABLED: 'true',
        ALLOWED_ORIGINS: '',
        SHARED_REQUEST_OBJECTS:
          {} as NonNullable<WorkerEnv['SHARED_REQUEST_OBJECTS']>,
      }),
    ).toBe(false)
  })
})

describe('Cloudflare handwriting import Worker', () => {
  it('validates Turnstile, passes the image and candidates, and returns only validated data', async () => {
    const fetchImplementation = successfulTurnstileFetch()
    const analyzeImplementation = vi.fn(async (options) => {
      expect(options.image.type).toBe('image/jpeg')
      expect(options.products).toEqual(products)
      expect(options.products[0].aliases).toEqual(['たまご', '玉子'])
      expect(options.apiKey).toBe(env.GEMINI_API_KEY)
      expect(options.signal).toBeInstanceOf(AbortSignal)
      return successfulOutput()
    })
    const response = await handleRequest(importRequest(), env, {
      fetchImplementation,
      analyzeImplementation,
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      allowedOrigin,
    )
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get(HANDWRITING_REQUEST_ID_HEADER)).toBe(
      'client-request-123',
    )
    expect(
      response.headers.get('Access-Control-Expose-Headers'),
    ).toBe(HANDWRITING_REQUEST_ID_HEADER)
    await expect(response.json()).resolves.toEqual(
      JSON.parse(successfulOutput()),
    )
    expect(fetchImplementation).toHaveBeenCalledTimes(1)
    expect(analyzeImplementation).toHaveBeenCalledTimes(1)
  })

  it('replaces an invalid requestId with a safe Worker ID', async () => {
    const response = await handleRequest(
      importRequest({ requestId: 'bad id\nlog-injection' }),
      env,
      {
        fetchImplementation: successfulTurnstileFetch(),
        analyzeImplementation: vi.fn(async () => successfulOutput()),
        createRequestId: () => 'worker-safe-fallback',
      },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get(HANDWRITING_REQUEST_ID_HEADER)).toBe(
      'worker-safe-fallback',
    )
  })

  it('never uses an unsafe generated fallback as a response or log ID', async () => {
    const logImplementation = vi.fn()
    const response = await handleRequest(
      importRequest({ requestId: 'bad id\nlog-injection' }),
      { ...env, DIAGNOSTIC_MODE: 'true' },
      {
        fetchImplementation: successfulTurnstileFetch(),
        analyzeImplementation: vi.fn(async () => successfulOutput()),
        createRequestId: () => 'unsafe\nfallback',
        logImplementation,
      },
    )

    const responseRequestId = response.headers.get(
      HANDWRITING_REQUEST_ID_HEADER,
    )
    expect(response.status).toBe(200)
    expect(responseRequestId).toMatch(/^[A-Za-z0-9-]{1,64}$/u)
    expect(logImplementation.mock.calls.flat().join('\n')).not.toContain(
      'unsafe\nfallback',
    )
  })

  it('accepts an older request without requestId and returns a Worker ID', async () => {
    const response = await handleRequest(
      importRequest({ omitRequestId: true }),
      env,
      {
        fetchImplementation: successfulTurnstileFetch(),
        analyzeImplementation: vi.fn(async () => successfulOutput()),
        createRequestId: () => 'worker-generated-request',
      },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get(HANDWRITING_REQUEST_ID_HEADER)).toBe(
      'worker-generated-request',
    )
  })

  it('rejects Turnstile failure before analysis', async () => {
    const fetchImplementation = vi.fn(async () =>
      Response.json({
        success: false,
        action: 'handwriting_import',
        hostname: 'plain-relay.github.io',
      }),
    ) as typeof fetch
    const analyzeImplementation = vi.fn()
    const response = await handleRequest(importRequest(), env, {
      fetchImplementation,
      analyzeImplementation,
    })
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ code: 'AUTH_FAILED' })
    expect(analyzeImplementation).not.toHaveBeenCalled()
  })

  it.each([
    ['handwriting_import', 'attacker.example'],
    ['wrong_action', 'plain-relay.github.io'],
  ])(
    'rejects a token with action %s and hostname %s',
    async (action, hostname) => {
      const fetchImplementation = vi.fn(async () =>
        Response.json({ success: true, action, hostname }),
      ) as typeof fetch
      const analyzeImplementation = vi.fn()
      const response = await handleRequest(importRequest(), env, {
        fetchImplementation,
        analyzeImplementation,
      })
      expect(response.status).toBe(403)
      expect(analyzeImplementation).not.toHaveBeenCalled()
    },
  )

  it('rejects a disallowed Origin without CORS permission or external calls', async () => {
    const fetchImplementation = vi.fn() as unknown as typeof fetch
    const analyzeImplementation = vi.fn()
    const response = await handleRequest(
      importRequest({ origin: 'https://attacker.example' }),
      env,
      { fetchImplementation, analyzeImplementation },
    )
    expect(response.status).toBe(403)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
    await expect(response.json()).resolves.toEqual({
      code: 'ORIGIN_NOT_ALLOWED',
    })
    expect(fetchImplementation).not.toHaveBeenCalled()
    expect(analyzeImplementation).not.toHaveBeenCalled()
  })

  it('rejects non-POST methods before external calls', async () => {
    const fetchImplementation = vi.fn() as unknown as typeof fetch
    const response = await handleRequest(
      importRequest({ method: 'GET' }),
      env,
      { fetchImplementation },
    )
    expect(response.status).toBe(405)
    await expect(response.json()).resolves.toEqual({
      code: 'METHOD_NOT_ALLOWED',
    })
    expect(fetchImplementation).not.toHaveBeenCalled()
  })

  it('rejects an invalid multipart content type', async () => {
    const fetchImplementation = vi.fn() as unknown as typeof fetch
    const request = new Request('https://import.example.workers.dev/', {
      method: 'POST',
      headers: {
        Origin: allowedOrigin,
        'Content-Type': 'application/json',
      },
      body: '{}',
    })
    const response = await handleRequest(request, env, {
      fetchImplementation,
    })
    expect(response.status).toBe(415)
    await expect(response.json()).resolves.toEqual({
      code: 'UNSUPPORTED_CONTENT_TYPE',
    })
    expect(fetchImplementation).not.toHaveBeenCalled()
  })

  it('rejects a declared MIME that does not match image bytes', async () => {
    const fetchImplementation = vi.fn() as unknown as typeof fetch
    const response = await handleRequest(
      importRequest({ file: jpegFile(4, 'image/png') }),
      env,
      { fetchImplementation },
    )
    expect(response.status).toBe(415)
    await expect(response.json()).resolves.toEqual({
      code: 'UNSUPPORTED_IMAGE_TYPE',
    })
    expect(fetchImplementation).not.toHaveBeenCalled()
  })

  it('rejects an image over 2MB before external calls', async () => {
    const fetchImplementation = vi.fn() as unknown as typeof fetch
    const response = await handleRequest(
      importRequest({ file: jpegFile(MAX_IMAGE_BYTES + 1) }),
      env,
      { fetchImplementation },
    )
    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({
      code: 'IMAGE_TOO_LARGE',
    })
    expect(fetchImplementation).not.toHaveBeenCalled()
  })

  it('rejects unexpected multipart fields before external calls', async () => {
    const fetchImplementation = vi.fn() as unknown as typeof fetch
    const response = await handleRequest(
      importRequest({ extraField: ['unexpected', 'value'] }),
      env,
      { fetchImplementation },
    )
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      code: 'REQUEST_INVALID',
    })
    expect(fetchImplementation).not.toHaveBeenCalled()
  })

  it('rejects the empty connectivity probe before Turnstile or Gemini', async () => {
    const fetchImplementation = vi.fn() as unknown as typeof fetch
    const analyzeImplementation = vi.fn()
    const response = await handleRequest(
      new Request('https://worker.example.test/', {
        method: 'POST',
        headers: { Origin: allowedOrigin },
        body: new FormData(),
      }),
      env,
      {
        fetchImplementation,
        analyzeImplementation,
        createRequestId: () => 'worker-probe-request',
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      code: 'REQUEST_INVALID',
    })
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      allowedOrigin,
    )
    expect(response.headers.get('Access-Control-Expose-Headers')).toBe(
      HANDWRITING_REQUEST_ID_HEADER,
    )
    expect(response.headers.get(HANDWRITING_REQUEST_ID_HEADER)).toBe(
      'worker-probe-request',
    )
    expect(fetchImplementation).not.toHaveBeenCalled()
    expect(analyzeImplementation).not.toHaveBeenCalled()
  })

  it.each([
    ['not json'],
    [JSON.stringify([])],
    [
      JSON.stringify(
        Array.from(
          { length: MAX_PRODUCT_CANDIDATES + 1 },
          (_, index) => ({
            id: `product-${index}`,
            name: `商品${index}`,
            aliases: [],
          }),
        ),
      ),
    ],
    [
      JSON.stringify([
        products[0],
        { ...products[0], name: '重複ID' },
      ]),
    ],
    [JSON.stringify([{ id: 'empty', name: ' ', aliases: [] }])],
    [
      JSON.stringify([
        {
          id: 'too-many-aliases',
          name: '商品',
          aliases: Array.from({ length: 11 }, (_, index) => `別名${index}`),
        },
      ]),
    ],
    [
      JSON.stringify([
        {
          id: 'extra',
          name: '商品',
          aliases: [],
          categoryId: 'not-allowed',
        },
      ]),
    ],
    [
      '[{"id":"danger","name":"商品","aliases":[],"__proto__":{"polluted":true}}]',
    ],
  ])('rejects invalid product candidate JSON before external calls', async (productsJson) => {
    const fetchImplementation = vi.fn() as unknown as typeof fetch
    const analyzeImplementation = vi.fn()
    const response = await handleRequest(
      importRequest({ productsJson }),
      env,
      { fetchImplementation, analyzeImplementation },
    )
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      code: 'INVALID_PRODUCTS',
    })
    expect(fetchImplementation).not.toHaveBeenCalled()
    expect(analyzeImplementation).not.toHaveBeenCalled()
  })

  it('rejects an oversized product candidate JSON', async () => {
    const oversized = JSON.stringify(
      Array.from({ length: 200 }, (_, productIndex) => ({
        id: `product-${productIndex}-${'x'.repeat(100)}`,
        name: 'あ'.repeat(30),
        aliases: Array.from(
          { length: 10 },
          (_, aliasIndex) => `${aliasIndex}${'あ'.repeat(29)}`,
        ),
      })),
    )
    const fetchImplementation = vi.fn() as unknown as typeof fetch
    const response = await handleRequest(
      importRequest({ productsJson: oversized }),
      env,
      { fetchImplementation },
    )
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      code: 'INVALID_PRODUCTS',
    })
    expect(fetchImplementation).not.toHaveBeenCalled()
  })

  it.each([
    ['analysis-limit', 429, 'ANALYSIS_LIMIT'],
    ['invalid-response', 502, 'INVALID_ANALYSIS_RESPONSE'],
    ['safety-blocked', 422, 'SAFETY_BLOCKED'],
    ['unavailable', 502, 'SERVICE_UNAVAILABLE'],
  ] as const)(
    'maps Gemini %s without exposing provider details',
    async (kind, status, code) => {
      const response = await handleRequest(importRequest(), env, {
        fetchImplementation: successfulTurnstileFetch(),
        analyzeImplementation: vi.fn(async () => {
          throw new GeminiAnalysisError(kind)
        }),
      })
      expect(response.status).toBe(status)
      expect(await response.text()).toBe(JSON.stringify({ code }))
    },
  )

  it('rejects invalid model JSON after analysis', async () => {
    const response = await handleRequest(importRequest(), env, {
      fetchImplementation: successfulTurnstileFetch(),
      analyzeImplementation: vi.fn(async () => '{invalid'),
    })
    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      code: 'INVALID_ANALYSIS_RESPONSE',
    })
  })

  it('times out a stalled analysis and aborts its signal', async () => {
    const analyzeImplementation = vi.fn(
      async (options) =>
        new Promise<string>((_resolve, reject) => {
          options.signal.addEventListener(
            'abort',
            () => reject(new DOMException('timeout', 'AbortError')),
            { once: true },
          )
        }),
    )
    const dependencies: WorkerDependencies = {
      fetchImplementation: successfulTurnstileFetch(),
      analyzeImplementation,
      timeoutMs: 5,
    }
    const response = await handleRequest(
      importRequest(),
      env,
      dependencies,
    )
    expect(response.status).toBe(504)
    await expect(response.json()).resolves.toEqual({ code: 'TIMEOUT' })
  })

  it('does not log secrets, images, candidates, or model output', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const response = await handleRequest(importRequest(), env, {
      fetchImplementation: successfulTurnstileFetch(),
      analyzeImplementation: vi.fn(async () => successfulOutput()),
    })
    expect(response.status).toBe(200)
    expect(log).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it('logs only safe one-line diagnostic stages when explicitly enabled', async () => {
    const logImplementation = vi.fn()
    let currentTime = 1_000
    const response = await handleRequest(
      importRequest(),
      { ...env, DIAGNOSTIC_MODE: 'true' },
      {
        fetchImplementation: successfulTurnstileFetch(),
        analyzeImplementation: vi.fn(async () => successfulOutput()),
        createRequestId: () => 'worker-provisional-request',
        now: () => currentTime++,
        logImplementation,
      },
    )

    expect(response.status).toBe(200)
    const entries = logImplementation.mock.calls.map(([line]) =>
      JSON.parse(String(line)) as Record<string, unknown>,
    )
    expect(entries.map((entry) => entry.stage)).toEqual([
      'request-received',
      'request-validated',
      'turnstile-verification-started',
      'turnstile-verified',
      'gemini-request-started',
      'gemini-request-completed',
      'result-validated',
      'response-sent',
    ])
    expect(entries[1]).toEqual(
      expect.objectContaining({
        event: 'handwriting_import',
        requestId: 'client-request-123',
        imageBytes: 4,
        productCandidateCount: 2,
      }),
    )
    expect(entries[6]).toEqual(
      expect.objectContaining({
        resultItemCount: 2,
        matchedCount: 1,
        ambiguousCount: 0,
        unknownCount: 1,
      }),
    )
    const logged = logImplementation.mock.calls.flat().join('\n')
    expect(logged).not.toContain(env.GEMINI_API_KEY)
    expect(logged).not.toContain(env.TURNSTILE_SECRET_KEY)
    expect(logged).not.toContain('single-use-token')
    expect(logged).not.toContain(products[0].name)
    expect(logged).not.toContain(products[0].aliases[0])
    expect(logged).not.toContain(products[0].id)
    expect(logged).not.toContain(successfulOutput())
    expect(logged).not.toContain('sourceText')
    expect(logged).not.toContain('candidateProductIds')
  })

  it('logs a safe rejection class without request data', async () => {
    const logImplementation = vi.fn()
    const response = await handleRequest(
      importRequest({ token: '' }),
      { ...env, DIAGNOSTIC_MODE: 'true' },
      {
        logImplementation,
        createRequestId: () => 'worker-rejected-request',
      },
    )
    expect(response.status).toBe(403)
    const logged = logImplementation.mock.calls.flat().join('\n')
    expect(logged).toContain('"stage":"request-rejected"')
    expect(logged).toContain('"errorClass":"request-validation"')
    expect(logged).not.toContain(env.TURNSTILE_SECRET_KEY)
    expect(logged).not.toContain('single-use-token')
  })

  it('does not fail an import when the diagnostic logger is unavailable', async () => {
    const response = await handleRequest(
      importRequest(),
      { ...env, DIAGNOSTIC_MODE: 'true' },
      {
        fetchImplementation: successfulTurnstileFetch(),
        analyzeImplementation: vi.fn(async () => successfulOutput()),
        logImplementation: () => {
          throw new Error('logging unavailable')
        },
      },
    )

    expect(response.status).toBe(200)
  })

  it('fails safely when a required secret is missing', async () => {
    const response = await handleRequest(importRequest(), {
      ...env,
      GEMINI_API_KEY: '',
    })
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      code: 'SERVICE_UNAVAILABLE',
    })
  })
})
