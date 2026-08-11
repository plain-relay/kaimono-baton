import { describe, expect, it, vi } from 'vitest'
import { HandwritingImportError } from '../handwriting/errors'
import type { TurnstileTokenProvider } from '../handwriting/turnstile'
import {
  ProductPhotoUploadError,
  WorkerProductPhotoUploadProvider,
} from './ProductPhotoUploadProvider'
import type { PendingPhoto } from './types'

const token = 'p1_AAECAwQFBgcICQoLDA0ODxAREhMUFRYX'

function photo(): PendingPhoto {
  return {
    itemKey: 'milk',
    token,
    blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], {
      type: 'image/jpeg',
    }),
    previewUrl: 'blob:local-preview',
    width: 640,
    height: 480,
    bytes: 4,
    status: 'local',
  }
}

function turnstile(): TurnstileTokenProvider {
  return {
    getToken: vi.fn(async () => 'single-use-token'),
    reset: vi.fn(),
    dispose: vi.fn(),
  }
}

describe('WorkerProductPhotoUploadProvider', () => {
  it('gets one token and uploads a strict multipart batch', async () => {
    const challenge = turnstile()
    const record = vi.fn()
    const fetchImplementation = vi.fn(async (input, init) => {
      expect(String(input)).toBe('https://worker.example/v1/photos/batch')
      expect(init?.method).toBe('POST')
      expect(init?.headers).toBeUndefined()
      const body = init?.body as FormData
      expect(body.get('turnstileToken')).toBe('single-use-token')
      expect(body.get('metadata')).toBe(
        JSON.stringify([{ token, itemKey: 'milk' }]),
      )
      const uploaded = body.get('photo') as File
      expect(uploaded.type).toBe('image/jpeg')
      expect(uploaded.name).toBe('photo.jpg')
      return Response.json({ photos: [{ token, itemKey: 'milk' }] })
    }) as typeof fetch
    const provider = new WorkerProductPhotoUploadProvider(
      'https://worker.example/',
      challenge,
      fetchImplementation,
      undefined,
      { record },
    )

    await expect(provider.upload([photo()])).resolves.toBeUndefined()
    expect(challenge.getToken).toHaveBeenCalledTimes(1)
    expect(challenge.reset).toHaveBeenCalledTimes(1)
    expect(record.mock.calls).toEqual([
      ['photo-fetch-attempt-1-started'],
    ])
  })

  it('adds a verified validation session to FormData without a request header', async () => {
    const validationSessionToken = `mv1_${'A'.repeat(32)}`
    const fetchImplementation = vi.fn(async (_input, init) => {
      expect(init?.headers).toBeUndefined()
      const body = init?.body as FormData
      expect([...body.keys()]).toEqual([
        'validationSessionToken',
        'turnstileToken',
        'metadata',
        'photo',
      ])
      expect(body.get('validationSessionToken')).toBe(
        validationSessionToken,
      )
      return Response.json({ photos: [{ token, itemKey: 'milk' }] })
    }) as typeof fetch
    const provider = new WorkerProductPhotoUploadProvider(
      'https://worker.example/',
      turnstile(),
      fetchImplementation,
      validationSessionToken,
    )
    await expect(provider.upload([photo()])).resolves.toBeUndefined()
  })

  it('rejects invalid photos before Turnstile or fetch', async () => {
    const challenge = turnstile()
    const fetchImplementation = vi.fn()
    const provider = new WorkerProductPhotoUploadProvider(
      'https://worker.example/',
      challenge,
      fetchImplementation,
    )

    await expect(
      provider.upload([{ ...photo(), token: 'bad-token' }]),
    ).rejects.toBeInstanceOf(ProductPhotoUploadError)
    expect(challenge.getToken).not.toHaveBeenCalled()
    expect(fetchImplementation).not.toHaveBeenCalled()
  })

  it('classifies a Turnstile failure before fetch as auth-failed', async () => {
    const challenge = turnstile()
    vi.mocked(challenge.getToken).mockRejectedValue(
      new HandwritingImportError('auth-failed'),
    )
    const fetchImplementation = vi.fn()
    const provider = new WorkerProductPhotoUploadProvider(
      'https://worker.example/',
      challenge,
      fetchImplementation,
    )

    await expect(provider.upload([photo()])).rejects.toMatchObject({
      code: 'auth-failed',
      requestId: undefined,
    })
    expect(fetchImplementation).not.toHaveBeenCalled()
    expect(challenge.reset).toHaveBeenCalledTimes(1)
  })

  it('does not treat an AbortError as cancellation without an aborted signal', async () => {
    const challenge = turnstile()
    vi.mocked(challenge.getToken).mockRejectedValue(
      new DOMException('not user cancellation', 'AbortError'),
    )
    const fetchImplementation = vi.fn()
    const provider = new WorkerProductPhotoUploadProvider(
      'https://worker.example/',
      challenge,
      fetchImplementation,
    )

    await expect(provider.upload([photo()])).rejects.toMatchObject({
      code: 'auth-failed',
    })
    expect(fetchImplementation).not.toHaveBeenCalled()
  })

  it('retries one fetch rejection with a fresh challenge and FormData', async () => {
    const challenge = turnstile()
    vi.mocked(challenge.getToken)
      .mockResolvedValueOnce('first-single-use-token')
      .mockResolvedValueOnce('second-single-use-token')
    const bodies: FormData[] = []
    const fetchImplementation = vi.fn(async (_input, init) => {
      bodies.push(init?.body as FormData)
      if (bodies.length === 1) {
        throw new TypeError('private network detail')
      }
      return Response.json({ photos: [{ token, itemKey: 'milk' }] })
    }) as typeof fetch
    const record = vi.fn()
    const provider = new WorkerProductPhotoUploadProvider(
      'https://worker.example/',
      challenge,
      fetchImplementation,
      `mv1_${'A'.repeat(32)}`,
      { record },
    )

    await expect(provider.upload([photo()])).resolves.toBeUndefined()
    expect(challenge.getToken).toHaveBeenCalledTimes(2)
    expect(challenge.reset).toHaveBeenCalledTimes(2)
    expect(fetchImplementation).toHaveBeenCalledTimes(2)
    expect(bodies[0]).not.toBe(bodies[1])
    expect(bodies.map((body) => body.get('turnstileToken'))).toEqual([
      'first-single-use-token',
      'second-single-use-token',
    ])
    for (const body of bodies) {
      expect(body.get('metadata')).toBe(
        JSON.stringify([{ token, itemKey: 'milk' }]),
      )
      expect(body.get('photo')).toBeInstanceOf(File)
    }
    expect(
      new Uint8Array(
        await (bodies[0].get('photo') as File).arrayBuffer(),
      ),
    ).toEqual(
      new Uint8Array(
        await (bodies[1].get('photo') as File).arrayBuffer(),
      ),
    )
    expect(record.mock.calls).toEqual([
      ['photo-fetch-attempt-1-started'],
      ['photo-fetch-attempt-1-failed'],
      ['photo-fetch-retry-started'],
    ])
    expect(JSON.stringify(record.mock.calls)).not.toContain(
      'private network detail',
    )
  })

  it('reports network-failed only after both fetch attempts reject', async () => {
    const record = vi.fn()
    const challenge = turnstile()
    const fetchImplementation = vi.fn(async () => {
      throw new TypeError('private network detail')
    }) as typeof fetch
    const provider = new WorkerProductPhotoUploadProvider(
      'https://worker.example/',
      challenge,
      fetchImplementation,
      undefined,
      { record },
    )

    await expect(provider.upload([photo()])).rejects.toMatchObject({
      code: 'network-failed',
      requestId: undefined,
    })
    expect(fetchImplementation).toHaveBeenCalledTimes(2)
    expect(challenge.getToken).toHaveBeenCalledTimes(2)
    expect(challenge.reset).toHaveBeenCalledTimes(2)
    expect(record.mock.calls).toEqual([
      ['photo-fetch-attempt-1-started'],
      ['photo-fetch-attempt-1-failed'],
      ['photo-fetch-retry-started'],
      ['photo-fetch-retry-failed'],
    ])
    expect(JSON.stringify(record.mock.calls)).not.toContain(
      'private network detail',
    )
  })

  it('does not retry an AbortError-shaped fetch rejection', async () => {
    const record = vi.fn()
    const challenge = turnstile()
    const fetchImplementation = vi.fn(async () => {
      throw new DOMException('not user cancellation', 'AbortError')
    }) as typeof fetch
    const provider = new WorkerProductPhotoUploadProvider(
      'https://worker.example/',
      challenge,
      fetchImplementation,
      undefined,
      { record },
    )

    await expect(provider.upload([photo()])).rejects.toMatchObject({
      code: 'network-failed',
    })
    expect(fetchImplementation).toHaveBeenCalledTimes(1)
    expect(challenge.getToken).toHaveBeenCalledTimes(1)
    expect(challenge.reset).toHaveBeenCalledTimes(1)
    expect(record.mock.calls).toEqual([
      ['photo-fetch-attempt-1-started'],
      ['photo-fetch-attempt-1-failed'],
    ])
  })

  it('does not let a diagnostics reporter failure affect an upload', async () => {
    const provider = new WorkerProductPhotoUploadProvider(
      'https://worker.example/',
      turnstile(),
      vi.fn(async () =>
        Response.json({ photos: [{ token, itemKey: 'milk' }] }),
      ) as typeof fetch,
      undefined,
      {
        record: () => {
          throw new Error('diagnostics failure')
        },
      },
    )

    await expect(provider.upload([photo()])).resolves.toBeUndefined()
  })

  it.each([
    [403, 'AUTH_FAILED', 'auth-failed'],
    [403, 'VALIDATION_SESSION_INVALID', 'validation-session-invalid'],
    [410, 'VALIDATION_SESSION_EXPIRED', 'validation-session-expired'],
    [403, 'ORIGIN_NOT_ALLOWED', 'origin-not-allowed'],
    [400, 'PHOTO_REQUEST_INVALID', 'invalid-photo'],
    [409, 'PHOTO_TOKEN_CONFLICT', 'invalid-photo'],
    [413, 'PHOTO_TOO_LARGE', 'limit-reached'],
    [415, 'PHOTO_INVALID', 'invalid-photo'],
    [429, 'PHOTO_BATCH_TOO_LARGE', 'limit-reached'],
    [504, 'TIMEOUT', 'timeout'],
    [503, 'SERVICE_UNAVAILABLE', 'service-unavailable'],
  ] as const)('maps HTTP %s without exposing response content', async (status, code, expected) => {
    const requestId = 'safe-request-id-123'
    const challenge = turnstile()
    const fetchImplementation = vi.fn(async () => Response.json(
      { code },
      {
        status,
        headers: { 'X-Otsukai-Request-Id': requestId },
      },
    )) as typeof fetch
    const provider = new WorkerProductPhotoUploadProvider(
      'https://worker.example/',
      challenge,
      fetchImplementation,
    )

    await expect(provider.upload([photo()])).rejects.toMatchObject({
      code: expected,
      requestId,
    })
    expect(fetchImplementation).toHaveBeenCalledTimes(1)
    expect(challenge.getToken).toHaveBeenCalledTimes(1)
    expect(challenge.reset).toHaveBeenCalledTimes(1)
  })

  it('ignores malformed correlation IDs and unexpected response fields', async () => {
    const provider = new WorkerProductPhotoUploadProvider(
      'https://worker.example/',
      turnstile(),
      vi.fn(async () => Response.json(
        { code: 'VALIDATION_SESSION_INVALID', detail: 'must not escape' },
        {
          status: 403,
          headers: { 'X-Otsukai-Request-Id': 'bad id' },
        },
      )) as typeof fetch,
    )

    await expect(provider.upload([photo()])).rejects.toMatchObject({
      code: 'auth-failed',
      requestId: undefined,
    })
  })

  it('rejects a mismatched success response and resets the token', async () => {
    const challenge = turnstile()
    const requestId = 'safe-success-response-id'
    const provider = new WorkerProductPhotoUploadProvider(
      'https://worker.example/',
      challenge,
      vi.fn(async () => Response.json(
        { photos: [] },
        { headers: { 'X-Otsukai-Request-Id': requestId } },
      )) as typeof fetch,
    )

    await expect(provider.upload([photo()])).rejects.toMatchObject({
      code: 'service-unavailable',
      requestId,
    })
    expect(challenge.reset).toHaveBeenCalledTimes(1)
  })

  it('keeps the correlation ID when a successful response is not JSON', async () => {
    const requestId = 'safe-json-response-id'
    const challenge = turnstile()
    const fetchImplementation = vi.fn(async () => new Response('not-json', {
      headers: { 'X-Otsukai-Request-Id': requestId },
    })) as typeof fetch
    const provider = new WorkerProductPhotoUploadProvider(
      'https://worker.example/',
      challenge,
      fetchImplementation,
    )

    await expect(provider.upload([photo()])).rejects.toMatchObject({
      code: 'service-unavailable',
      requestId,
    })
    expect(fetchImplementation).toHaveBeenCalledTimes(1)
    expect(challenge.getToken).toHaveBeenCalledTimes(1)
    expect(challenge.reset).toHaveBeenCalledTimes(1)
  })

  it('does not retry when fetch aborts with the caller signal', async () => {
    const controller = new AbortController()
    const challenge = turnstile()
    const fetchImplementation = vi.fn(async () => {
      controller.abort()
      throw new DOMException('aborted', 'AbortError')
    }) as typeof fetch
    const provider = new WorkerProductPhotoUploadProvider(
      'https://worker.example/',
      challenge,
      fetchImplementation,
    )

    await expect(
      provider.upload([photo()], { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchImplementation).toHaveBeenCalledTimes(1)
    expect(challenge.getToken).toHaveBeenCalledTimes(1)
    expect(challenge.reset).toHaveBeenCalledTimes(1)
  })

  it('propagates cancellation without logging or retrying', async () => {
    const controller = new AbortController()
    controller.abort()
    const challenge = turnstile()
    vi.mocked(challenge.getToken).mockRejectedValue(
      new DOMException('aborted', 'AbortError'),
    )
    const provider = new WorkerProductPhotoUploadProvider(
      'https://worker.example/',
      challenge,
    )

    await expect(
      provider.upload([photo()], { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(challenge.reset).toHaveBeenCalledTimes(1)
  })
})
