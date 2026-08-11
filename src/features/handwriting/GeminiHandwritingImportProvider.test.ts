import { describe, expect, it, vi } from 'vitest'
import { HandwritingImportError } from './errors'
import {
  GeminiHandwritingImportProvider,
  MAX_IMPORT_PRODUCT_CANDIDATES,
} from './GeminiHandwritingImportProvider'
import type { TurnstileTokenProvider } from './turnstile'
import type { ImportProductCandidate } from './types'

const products: ImportProductCandidate[] = [
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
const image = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], {
  type: 'image/jpeg',
})

function turnstile(): TurnstileTokenProvider {
  return {
    getToken: vi.fn(async () => 'fresh-token'),
    reset: vi.fn(),
    dispose: vi.fn(),
  }
}

function successBody() {
  return {
    version: 1,
    items: [
      {
        sourceText: 'たまご',
        status: 'matched',
        productId: 'eggs',
        candidateProductIds: [],
      },
    ],
  }
}

describe('GeminiHandwritingImportProvider', () => {
  it('sends one image, one fresh token, and current products with aliases', async () => {
    const tokenProvider = turnstile()
    const record = vi.fn()
    const adoptRequestId = vi.fn()
    const fetchImplementation = vi.fn(async (_url, init) => {
      expect(init?.method).toBe('POST')
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      const form = init?.body as FormData
      expect(form.getAll('image')).toHaveLength(1)
      expect(form.get('turnstileToken')).toBe('fresh-token')
      expect(JSON.parse(String(form.get('products')))).toEqual(products)
      expect(form.get('requestId')).toBe('client-request-123')
      return Response.json(successBody(), {
        headers: {
          'X-Otsukai-Request-Id': 'client-request-123',
        },
      })
    }) as typeof fetch
    const provider = new GeminiHandwritingImportProvider(
      'https://import.example.test/',
      tokenProvider,
      fetchImplementation,
      {
        enabled: true,
        record,
        adoptRequestId,
      },
    )
    const controller = new AbortController()

    await expect(
      provider.analyze(image, products, {
        signal: controller.signal,
        requestId: 'client-request-123',
      }),
    ).resolves.toEqual(successBody())
    expect(tokenProvider.getToken).toHaveBeenCalledWith({
      signal: controller.signal,
    })
    expect(tokenProvider.reset).toHaveBeenCalledTimes(1)
    expect(adoptRequestId).toHaveBeenCalledWith('client-request-123')
    expect(record.mock.calls.map(([stage]) => stage)).toEqual([
      'worker-request-started',
      'worker-response-received',
      'worker-response-validated',
    ])
    expect(record).toHaveBeenLastCalledWith(
      'worker-response-validated',
      {
        resultItemCount: 1,
        matchedCount: 1,
        ambiguousCount: 0,
        unknownCount: 0,
      },
    )
  })

  it('rejects a response containing an unknown product ID', async () => {
    const provider = new GeminiHandwritingImportProvider(
      'https://import.example.test/',
      turnstile(),
      vi.fn(async () =>
        Response.json({
          version: 1,
          items: [
            {
              sourceText: '架空',
              status: 'matched',
              productId: 'invented',
              candidateProductIds: [],
            },
          ],
        }),
      ) as typeof fetch,
    )
    await expect(provider.analyze(image, products)).rejects.toMatchObject({
      code: 'invalid-analysis-response',
    })
  })

  it('reports an empty valid result as no products detected', async () => {
    const provider = new GeminiHandwritingImportProvider(
      'https://import.example.test/',
      turnstile(),
      vi.fn(async () => Response.json({ version: 1, items: [] })) as typeof fetch,
    )
    await expect(provider.analyze(image, products)).rejects.toMatchObject({
      code: 'no-products-detected',
    })
  })

  it.each([
    [403, 'AUTH_FAILED', 'auth-failed'],
    [429, 'ANALYSIS_LIMIT', 'analysis-limit'],
    [413, 'IMAGE_TOO_LARGE', 'image-too-large'],
    [504, 'TIMEOUT', 'timeout'],
    [422, 'SAFETY_BLOCKED', 'safety-blocked'],
    [502, 'INVALID_ANALYSIS_RESPONSE', 'invalid-analysis-response'],
    [400, 'INVALID_PRODUCTS', 'request-invalid'],
    [502, 'SERVICE_UNAVAILABLE', 'service-unavailable'],
  ])('maps status %s and %s to %s', async (status, endpointCode, code) => {
    const provider = new GeminiHandwritingImportProvider(
      'https://import.example.test/',
      turnstile(),
      vi.fn(async () =>
        Response.json({ code: endpointCode }, { status }),
      ) as typeof fetch,
    )
    await expect(provider.analyze(image, products)).rejects.toMatchObject({
      code,
    })
  })

  it('maps an aborted request and always resets the token', async () => {
    const tokenProvider = turnstile()
    const controller = new AbortController()
    const provider = new GeminiHandwritingImportProvider(
      'https://import.example.test/',
      tokenProvider,
      vi.fn(
        async (_url: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('cancelled', 'AbortError')),
              { once: true },
            )
            controller.abort()
          }),
      ) as typeof fetch,
    )
    await expect(
      provider.analyze(image, products, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'cancelled' })
    expect(tokenProvider.reset).toHaveBeenCalledTimes(1)
  })

  it('rejects more than 200 candidates before requesting a token', async () => {
    const tokenProvider = turnstile()
    const provider = new GeminiHandwritingImportProvider(
      'https://import.example.test/',
      tokenProvider,
      vi.fn() as unknown as typeof fetch,
    )
    const tooMany = Array.from(
      { length: MAX_IMPORT_PRODUCT_CANDIDATES + 1 },
      (_, index) => ({
        id: `product-${index}`,
        name: `商品${index}`,
        aliases: [],
      }),
    )
    await expect(provider.analyze(image, tooMany)).rejects.toBeInstanceOf(
      HandwritingImportError,
    )
    expect(tokenProvider.getToken).not.toHaveBeenCalled()
  })

  it('rejects duplicate candidate IDs before requesting a token', async () => {
    const tokenProvider = turnstile()
    const provider = new GeminiHandwritingImportProvider(
      'https://import.example.test/',
      tokenProvider,
      vi.fn() as unknown as typeof fetch,
    )
    await expect(
      provider.analyze(image, [products[0], products[0]]),
    ).rejects.toMatchObject({ code: 'request-invalid' })
    expect(tokenProvider.getToken).not.toHaveBeenCalled()
  })
})
