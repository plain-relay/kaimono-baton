import { describe, expect, it, vi } from 'vitest'
import type { TurnstileTokenProvider } from '../handwriting/turnstile'
import { LiveRequestApiError, WorkerLiveRequestApi } from './api'

const requestToken = `r1_${'A'.repeat(32)}`
const editSecret = `e1_${'B'.repeat(43)}`

function snapshot(revision = 1) {
  return {
    schemaVersion: 1,
    requestId: `v5-${requestToken}`,
    revision,
    createdAt: '2026-08-01T00:00:00.000Z',
    expiresAt: '2026-08-15T00:00:00.000Z',
    updatesCount: revision - 1,
    items: [
      {
        itemId: 'item-1',
        productId: 'milk',
        productNameSnapshot: '牛乳',
        categoryIdSnapshot: 'drinks',
        categoryNameSnapshot: '飲み物',
        quantity: 1,
        unit: '本',
        iconSnapshot: '🥛',
        sortOrderSnapshot: 1,
        lifecycle: 'active',
        createdRevision: 1,
        updatedRevision: revision,
      },
    ],
  }
}

function json(value: unknown, status = 200, revision = 1): Response {
  return Response.json(value, {
    status,
    headers: { ETag: `"revision-${revision}"` },
  })
}

function tokenProvider() {
  return {
    getToken: vi.fn(async () => 'one-time-token'),
    reset: vi.fn(),
    dispose: vi.fn(),
  } satisfies TurnstileTokenProvider
}

describe('WorkerLiveRequestApi', () => {
  it('adds a verified validation session to create, read, and update requests', async () => {
    const validationSessionToken = `mv1_${'A'.repeat(32)}`
    const fetchImplementation = vi
      .fn(async (_url, init) => {
        expect(new Headers(init?.headers).get(
          'X-Otsukai-Validation-Session',
        )).toBe(validationSessionToken)
        if (init?.method === 'POST') {
          return json(
            { requestToken, editSecret, request: snapshot() },
            201,
          )
        }
        if (init?.method === 'PATCH') {
          return json(snapshot(2), 200, 2)
        }
        return json(snapshot(), 200)
      }) as typeof fetch
    const api = new WorkerLiveRequestApi(
      'https://worker.example/',
      tokenProvider(),
      fetchImplementation,
      validationSessionToken,
    )
    const item = {
      itemId: 'item-1',
      productId: 'milk',
      productNameSnapshot: 'milk',
      categoryIdSnapshot: 'drinks',
      categoryNameSnapshot: 'drinks',
      quantity: 1,
      unit: 'item',
      iconSnapshot: 'icon',
      sortOrderSnapshot: 1,
    }
    await api.create([item])
    await api.get(requestToken)
    await api.patch(requestToken, editSecret, 1, [
      { type: 'set-quantity', itemId: 'item-1', quantity: 2 },
    ])
    expect(fetchImplementation).toHaveBeenCalledTimes(3)
  })

  it('creates a v5 request with a fresh token and strict response', async () => {
    const turnstile = tokenProvider()
    const fetchImplementation = vi.fn(async (_url, init) => {
      expect(init?.method).toBe('POST')
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body.turnstileToken).toBe('one-time-token')
      expect(body.items).toHaveLength(1)
      return json(
        { requestToken, editSecret, request: snapshot() },
        201,
      )
    }) as typeof fetch
    const api = new WorkerLiveRequestApi(
      'https://worker.example/',
      turnstile,
      fetchImplementation,
    )

    await expect(
      api.create([
        {
          itemId: 'item-1',
          productId: 'milk',
          productNameSnapshot: '牛乳',
          categoryIdSnapshot: 'drinks',
          categoryNameSnapshot: '飲み物',
          quantity: 1,
          unit: '本',
          iconSnapshot: '🥛',
          sortOrderSnapshot: 1,
        },
      ]),
    ).resolves.toMatchObject({ requestToken, editSecret })
    expect(turnstile.getToken).toHaveBeenCalledTimes(1)
    expect(turnstile.reset).toHaveBeenCalledTimes(1)
  })

  it('uses ETag for GET and accepts 304 without reading a body', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(snapshot(), 200))
      .mockResolvedValueOnce(
        new Response(null, {
          status: 304,
          headers: { ETag: '"revision-1"' },
        }),
      )
    const fetchImplementation = fetchMock as typeof fetch
    const api = new WorkerLiveRequestApi(
      'https://worker.example/',
      undefined,
      fetchImplementation,
    )

    await expect(api.get(requestToken)).resolves.toMatchObject({
      status: 'found',
      etag: '"revision-1"',
    })
    await expect(
      api.get(requestToken, { etag: '"revision-1"' }),
    ).resolves.toEqual({
      status: 'not-modified',
      etag: '"revision-1"',
    })
    expect(fetchMock.mock.calls[1][1]?.headers).toEqual({
      'If-None-Match': '"revision-1"',
    })
  })

  it.each([
    ['without a sent validator', undefined, '"revision-1"'],
    ['with a mismatched response ETag', '"revision-1"', '"revision-2"'],
  ])('rejects 304 %s', async (_name, sentEtag, responseEtag) => {
    const api = new WorkerLiveRequestApi(
      'https://worker.example/',
      undefined,
      vi.fn(async () =>
        new Response(null, {
          status: 304,
          headers: { ETag: responseEtag },
        })) as typeof fetch,
    )

    await expect(
      api.get(requestToken, sentEtag ? { etag: sentEtag } : undefined),
    ).rejects.toMatchObject({
      code: 'invalid-response',
      status: 304,
    })
  })

  it('accepts only the exact successful GET and PATCH status codes', async () => {
    const responses = [
      json(snapshot(), 201),
      json(snapshot(2), 201, 2),
    ]
    const api = new WorkerLiveRequestApi(
      'https://worker.example/',
      tokenProvider(),
      vi.fn(async () => responses.shift() as Response) as typeof fetch,
    )

    await expect(api.get(requestToken)).rejects.toMatchObject({
      code: 'invalid-response',
      status: 201,
    })
    await expect(
      api.patch(requestToken, editSecret, 1, [
        { type: 'cancel', itemId: 'item-1' },
      ]),
    ).rejects.toMatchObject({
      code: 'invalid-response',
      status: 201,
    })
  })

  it('distinguishes missing, expired, and safe failure classes', async () => {
    const responses = [
      json({ code: 'REQUEST_NOT_FOUND' }, 404),
      json({ code: 'REQUEST_EXPIRED' }, 410),
      json({ code: 'REVISION_MISMATCH' }, 412),
    ]
    const api = new WorkerLiveRequestApi(
      'https://worker.example/',
      tokenProvider(),
      vi.fn(async () => responses.shift() as Response) as typeof fetch,
    )

    await expect(api.get(requestToken)).resolves.toEqual({ status: 'missing' })
    await expect(api.get(requestToken)).resolves.toEqual({ status: 'expired' })
    await expect(
      api.patch(requestToken, editSecret, 1, [
        { type: 'cancel', itemId: 'item-1' },
      ]),
    ).rejects.toMatchObject({ code: 'conflict', status: 412 })
  })

  it('rejects invalid capabilities and malformed successful output', async () => {
    const api = new WorkerLiveRequestApi(
      'https://worker.example/',
      tokenProvider(),
      vi.fn(async () => json({ ok: true }, 201)) as typeof fetch,
    )

    await expect(api.get('bad-token')).rejects.toBeInstanceOf(
      LiveRequestApiError,
    )
    await expect(api.create([])).rejects.toMatchObject({
      code: 'invalid-response',
    })
  })

  it('propagates cancellation without exposing the fetch error', async () => {
    const controller = new AbortController()
    controller.abort()
    const api = new WorkerLiveRequestApi(
      'https://worker.example/',
      tokenProvider(),
      vi.fn(async () => {
        throw new Error('sensitive transport detail')
      }) as typeof fetch,
    )

    await expect(
      api.get(requestToken, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('rejects an oversized successful response before JSON parsing', async () => {
    const api = new WorkerLiveRequestApi(
      'https://worker.example/',
      undefined,
      vi.fn(async () =>
        new Response(`{"padding":"${'x'.repeat(1_048_576)}"}`, {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            ETag: '"revision-1"',
          },
        })) as typeof fetch,
    )

    await expect(api.get(requestToken)).rejects.toMatchObject({
      code: 'invalid-response',
    })
  })
})
