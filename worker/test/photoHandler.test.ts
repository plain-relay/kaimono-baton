import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkerEnv } from '../src/config'
import {
  handlePhotoApiRequest,
  PHOTO_RETENTION_MS,
  PHOTO_TURNSTILE_ACTION,
} from '../src/photoHandler'
import type {
  PhotoObject,
  ReadPhotoResult,
  SavePhotoInput,
  SavePhotoResult,
} from '../src/photoObject'
import {
  allowedOrigin,
  createJpegBytes,
  photoBatchRequest,
  validPhotoTokens,
} from './photoTestHelpers'

const manualValidationToken = `mv1_${'M'.repeat(32)}`

async function sha256(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  )
  return [...digest]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

class FakePhotoStub {
  saveResult: SavePhotoResult = { status: 'created' }
  readResult: ReadPhotoResult = { status: 'missing' }
  saveError: Error | undefined
  readonly savePhoto = vi.fn(async (_input: SavePhotoInput) => {
    if (this.saveError) {
      throw this.saveError
    }
    return this.saveResult
  })
  readonly getPhoto = vi.fn(async (_now: number) => this.readResult)
  readonly deletePhoto = vi.fn(async () => undefined)
}

class FakePhotoNamespace {
  readonly stubs = new Map<string, FakePhotoStub>()
  readonly getByName = vi.fn((name: string) => {
    let stub = this.stubs.get(name)
    if (!stub) {
      stub = new FakePhotoStub()
      this.stubs.set(name, stub)
    }
    return stub as unknown as DurableObjectStub<PhotoObject>
  })
}

function photoEnv(namespace = new FakePhotoNamespace()): {
  env: WorkerEnv
  namespace: FakePhotoNamespace
} {
  return {
    env: {
      PHOTO_API_ENABLED: 'true',
      SHARED_REQUEST_API_ENABLED: 'false',
      TURNSTILE_SECRET_KEY: 'turnstile-secret-value',
      ALLOWED_ORIGINS: allowedOrigin,
      PHOTO_OBJECTS:
        namespace as unknown as DurableObjectNamespace<PhotoObject>,
    },
    namespace,
  }
}

function successfulTurnstileFetch() {
  return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    expect(init?.method).toBe('POST')
    expect(String(init?.body)).toContain('response=single-use-token')
    return Response.json({
      success: true,
      action: PHOTO_TURNSTILE_ACTION,
      hostname: 'plain-relay.github.io',
    })
  }) as typeof fetch
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('photo API handler', () => {
  it('validates Turnstile once and stores up to three photos without Gemini', async () => {
    const { env, namespace } = photoEnv()
    const fetchImplementation = successfulTurnstileFetch()
    const now = Date.UTC(2026, 7, 1)

    const response = await handlePhotoApiRequest(
      photoBatchRequest({ count: 3 }),
      env,
      { fetchImplementation, now: () => now },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      allowedOrigin,
    )
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('X-Otsukai-Request-Id')).toMatch(
      /^[A-Za-z0-9-]{1,64}$/u,
    )
    expect(response.headers.get('Access-Control-Expose-Headers')).toBe(
      'X-Otsukai-Request-Id',
    )
    await expect(response.json()).resolves.toEqual({
      photos: [0, 1, 2].map((index) => ({
        token: validPhotoTokens[index],
        itemKey: `item-${index}`,
      })),
    })
    expect(fetchImplementation).toHaveBeenCalledTimes(1)
    expect(env.GEMINI_API_KEY).toBeUndefined()
    for (const stub of namespace.stubs.values()) {
      expect(stub.savePhoto).toHaveBeenCalledTimes(1)
      expect(stub.savePhoto).toHaveBeenCalledWith(
        expect.objectContaining({
          createdAt: now,
          expiresAt: now + PHOTO_RETENTION_MS,
          contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      )
    }
  })

  it('rejects Turnstile failure before Durable Object storage', async () => {
    const { env, namespace } = photoEnv()
    const response = await handlePhotoApiRequest(
      photoBatchRequest(),
      env,
      {
        fetchImplementation: vi.fn(async () =>
          Response.json({
            success: false,
            action: PHOTO_TURNSTILE_ACTION,
            hostname: 'plain-relay.github.io',
          }),
        ) as typeof fetch,
      },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ code: 'AUTH_FAILED' })
    expect(namespace.getByName).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: 'action mismatch',
      action: 'wrong_action',
      hostname: 'plain-relay.github.io',
      errorClass: 'turnstile-action-mismatch',
    },
    {
      name: 'hostname mismatch',
      action: PHOTO_TURNSTILE_ACTION,
      hostname: 'attacker.example',
      errorClass: 'turnstile-hostname-mismatch',
    },
  ])('rejects Turnstile $name without storage access', async ({
    action,
    hostname,
    errorClass,
  }) => {
    const { env, namespace } = photoEnv()
    env.DIAGNOSTIC_MODE = 'true'
    const messages: string[] = []
    const response = await handlePhotoApiRequest(
      photoBatchRequest(),
      env,
      {
        createRequestId: () => 'safe-photo-request',
        logImplementation: (message) => messages.push(message),
        fetchImplementation: vi.fn(async () => Response.json({
          success: true,
          action,
          hostname,
        })) as typeof fetch,
      },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ code: 'AUTH_FAILED' })
    expect(namespace.getByName).not.toHaveBeenCalled()
    expect(messages.some((message) => (
      JSON.parse(message) as { errorClass?: string }
    ).errorClass === errorClass)).toBe(true)
  })

  it('times out a stalled Turnstile request without storage access', async () => {
    const { env, namespace } = photoEnv()
    const fetchImplementation = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          )
        }),
    ) as typeof fetch

    const response = await handlePhotoApiRequest(
      photoBatchRequest(),
      env,
      { fetchImplementation, timeoutMs: 1 },
    )

    expect(response.status).toBe(504)
    await expect(response.json()).resolves.toEqual({ code: 'TIMEOUT' })
    expect(namespace.getByName).not.toHaveBeenCalled()
  })

  it('treats an identical token upload as idempotent success', async () => {
    const { env, namespace } = photoEnv()
    const stub = new FakePhotoStub()
    stub.saveResult = { status: 'existing' }
    namespace.stubs.set(validPhotoTokens[0], stub)

    const response = await handlePhotoApiRequest(
      photoBatchRequest(),
      env,
      { fetchImplementation: successfulTurnstileFetch() },
    )

    expect(response.status).toBe(200)
    expect(stub.deletePhoto).not.toHaveBeenCalled()
  })

  it('rejects a different image for the same token without overwrite', async () => {
    const { env, namespace } = photoEnv()
    const stub = new FakePhotoStub()
    stub.saveResult = { status: 'conflict' }
    namespace.stubs.set(validPhotoTokens[0], stub)

    const response = await handlePhotoApiRequest(
      photoBatchRequest(),
      env,
      { fetchImplementation: successfulTurnstileFetch() },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      code: 'PHOTO_TOKEN_CONFLICT',
    })
    expect(stub.deletePhoto).not.toHaveBeenCalled()
  })

  it('keeps partial writes for an overlapping idempotent retry until fixed expiry', async () => {
    const { env, namespace } = photoEnv()
    const first = new FakePhotoStub()
    const second = new FakePhotoStub()
    second.saveError = new Error('synthetic storage failure')
    namespace.stubs.set(validPhotoTokens[0], first)
    namespace.stubs.set(validPhotoTokens[1], second)

    const response = await handlePhotoApiRequest(
      photoBatchRequest({ count: 2 }),
      env,
      { fetchImplementation: successfulTurnstileFetch() },
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      code: 'SERVICE_UNAVAILABLE',
    })
    expect(first.deletePhoto).not.toHaveBeenCalled()
    expect(second.deletePhoto).not.toHaveBeenCalled()
  })

  it('does not delete an earlier photo when a later token conflicts', async () => {
    const { env, namespace } = photoEnv()
    const first = new FakePhotoStub()
    const second = new FakePhotoStub()
    second.saveResult = { status: 'conflict' }
    namespace.stubs.set(validPhotoTokens[0], first)
    namespace.stubs.set(validPhotoTokens[1], second)

    const response = await handlePhotoApiRequest(
      photoBatchRequest({ count: 2 }),
      env,
      { fetchImplementation: successfulTurnstileFetch() },
    )

    expect(response.status).toBe(409)
    expect(first.deletePhoto).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual({
      code: 'PHOTO_TOKEN_CONFLICT',
    })
  })

  it('completes an idempotent retry after a partial first attempt', async () => {
    const { env, namespace } = photoEnv()
    const first = new FakePhotoStub()
    first.savePhoto
      .mockResolvedValueOnce({ status: 'created' })
      .mockResolvedValueOnce({ status: 'existing' })
    const second = new FakePhotoStub()
    second.savePhoto
      .mockRejectedValueOnce(new Error('synthetic first-attempt failure'))
      .mockResolvedValueOnce({ status: 'created' })
    namespace.stubs.set(validPhotoTokens[0], first)
    namespace.stubs.set(validPhotoTokens[1], second)

    const firstResponse = await handlePhotoApiRequest(
      photoBatchRequest({ count: 2 }),
      env,
      { fetchImplementation: successfulTurnstileFetch() },
    )
    const retryResponse = await handlePhotoApiRequest(
      photoBatchRequest({ count: 2 }),
      env,
      { fetchImplementation: successfulTurnstileFetch() },
    )

    expect(firstResponse.status).toBe(503)
    expect(retryResponse.status).toBe(200)
    expect(first.deletePhoto).not.toHaveBeenCalled()
    expect(second.deletePhoto).not.toHaveBeenCalled()
  })

  it.each([
    {
      result: { status: 'missing' } as ReadPhotoResult,
      status: 404,
      body: { code: 'PHOTO_NOT_FOUND' },
    },
    {
      result: { status: 'expired' } as ReadPhotoResult,
      status: 410,
      body: { code: 'PHOTO_EXPIRED' },
    },
  ])('returns a finite JSON response for $result.status', async ({
    result,
    status,
    body,
  }) => {
    const { env, namespace } = photoEnv()
    const stub = new FakePhotoStub()
    stub.readResult = result
    namespace.stubs.set(validPhotoTokens[0], stub)

    const response = await handlePhotoApiRequest(
      photoBatchRequest({
        method: 'GET',
        pathname: `/v1/photos/${validPhotoTokens[0]}`,
      }),
      env,
    )

    expect(response.status).toBe(status)
    await expect(response.json()).resolves.toEqual(body)
  })

  it('returns JPEG bytes with private short-lived caching', async () => {
    const { env, namespace } = photoEnv()
    const jpeg = createJpegBytes().buffer
    const stub = new FakePhotoStub()
    stub.readResult = {
      status: 'found',
      jpeg,
      expiresAt: Date.now() + PHOTO_RETENTION_MS,
    }
    namespace.stubs.set(validPhotoTokens[0], stub)

    const response = await handlePhotoApiRequest(
      photoBatchRequest({
        method: 'GET',
        pathname: `/v1/photos/${validPhotoTokens[0]}`,
      }),
      env,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/jpeg')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Cache-Control')).toBe(
      'private, max-age=300, must-revalidate',
    )
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array(jpeg),
    )
  })

  it('accepts a manual session from FormData or the legacy header while the public flag is off', async () => {
    const { env, namespace } = photoEnv()
    const gateNow = Date.UTC(2026, 7, 2)
    Object.assign(env, {
      PHOTO_API_ENABLED: 'false',
      MANUAL_VALIDATION_ENABLED: 'true',
      MANUAL_VALIDATION_SESSION_SHA256: await sha256(
        manualValidationToken,
      ),
      MANUAL_VALIDATION_EXPIRES_AT: new Date(
        gateNow + 60_000,
      ).toISOString(),
    })
    const fetchImplementation = successfulTurnstileFetch()

    const missingSession = await handlePhotoApiRequest(
      photoBatchRequest(),
      env,
      { fetchImplementation, now: () => gateNow },
    )
    expect(missingSession.status).toBe(403)
    expect(fetchImplementation).not.toHaveBeenCalled()
    expect(namespace.getByName).not.toHaveBeenCalled()

    for (const request of [
      photoBatchRequest({
        validationSessionToken: manualValidationToken,
      }),
      photoBatchRequest({
        validationSessionHeader: manualValidationToken,
      }),
      photoBatchRequest({
        validationSessionToken: manualValidationToken,
        validationSessionHeader: manualValidationToken,
      }),
    ]) {
      const response = await handlePhotoApiRequest(request, env, {
        fetchImplementation,
        now: () => gateNow,
      })
      expect(response.status).toBe(200)
    }
    expect(fetchImplementation).toHaveBeenCalledTimes(3)
    expect(namespace.getByName).toHaveBeenCalledTimes(3)
  })

  it('rejects mismatched FormData and legacy-header sessions before Turnstile', async () => {
    const { env, namespace } = photoEnv()
    const gateNow = Date.UTC(2026, 7, 2)
    Object.assign(env, {
      PHOTO_API_ENABLED: 'false',
      MANUAL_VALIDATION_ENABLED: 'true',
      MANUAL_VALIDATION_SESSION_SHA256: await sha256(
        manualValidationToken,
      ),
      MANUAL_VALIDATION_EXPIRES_AT: new Date(
        gateNow + 60_000,
      ).toISOString(),
    })
    const fetchImplementation = successfulTurnstileFetch()
    const response = await handlePhotoApiRequest(
      photoBatchRequest({
        validationSessionToken: manualValidationToken,
        validationSessionHeader: `mv1_${'X'.repeat(32)}`,
      }),
      env,
      { fetchImplementation, now: () => gateNow },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      code: 'VALIDATION_SESSION_INVALID',
    })
    expect(fetchImplementation).not.toHaveBeenCalled()
    expect(namespace.getByName).not.toHaveBeenCalled()
  })

  it('distinguishes invalid and expired manual validation sessions before Turnstile', async () => {
    const gateNow = Date.UTC(2026, 7, 2)
    const readPhotoBytes = vi.spyOn(File.prototype, 'arrayBuffer')
    const invalid = photoEnv()
    Object.assign(invalid.env, {
      PHOTO_API_ENABLED: 'false',
      MANUAL_VALIDATION_ENABLED: 'true',
      MANUAL_VALIDATION_SESSION_SHA256: await sha256(manualValidationToken),
      MANUAL_VALIDATION_EXPIRES_AT: new Date(gateNow + 60_000).toISOString(),
    })
    const invalidResponse = await handlePhotoApiRequest(
      photoBatchRequest({
        validationSessionHeader: `mv1_${'X'.repeat(32)}`,
      }),
      invalid.env,
      { now: () => gateNow },
    )
    expect(invalidResponse.status).toBe(403)
    await expect(invalidResponse.json()).resolves.toEqual({
      code: 'VALIDATION_SESSION_INVALID',
    })
    expect(invalid.namespace.getByName).not.toHaveBeenCalled()
    expect(readPhotoBytes).not.toHaveBeenCalled()

    const expired = photoEnv()
    Object.assign(expired.env, {
      PHOTO_API_ENABLED: 'false',
      MANUAL_VALIDATION_ENABLED: 'true',
      MANUAL_VALIDATION_SESSION_SHA256: await sha256(manualValidationToken),
      MANUAL_VALIDATION_EXPIRES_AT: new Date(gateNow).toISOString(),
    })
    const expiredResponse = await handlePhotoApiRequest(
      photoBatchRequest(),
      expired.env,
      { now: () => gateNow },
    )
    expect(expiredResponse.status).toBe(410)
    await expect(expiredResponse.json()).resolves.toEqual({
      code: 'VALIDATION_SESSION_EXPIRED',
    })
    expect(expired.namespace.getByName).not.toHaveBeenCalled()
  })

  it('allows capability photo reads during an unexpired manual session without a session header', async () => {
    const { env, namespace } = photoEnv()
    const gateNow = Date.UTC(2026, 7, 2)
    Object.assign(env, {
      PHOTO_API_ENABLED: 'false',
      MANUAL_VALIDATION_ENABLED: 'true',
      MANUAL_VALIDATION_SESSION_SHA256: await sha256(
        manualValidationToken,
      ),
      MANUAL_VALIDATION_EXPIRES_AT: new Date(
        gateNow + 60_000,
      ).toISOString(),
    })
    const response = await handlePhotoApiRequest(
      photoBatchRequest({
        method: 'GET',
        pathname: `/v1/photos/${validPhotoTokens[0]}`,
      }),
      env,
      { now: () => gateNow },
    )
    expect(response.status).toBe(404)
    expect(namespace.getByName).toHaveBeenCalledWith(validPhotoTokens[0])
  })

  it('keeps disabled or incomplete photo configuration safely unavailable', async () => {
    const disabled = await handlePhotoApiRequest(photoBatchRequest(), {
      PHOTO_API_ENABLED: 'false',
    })
    expect(disabled.status).toBe(404)

    const incomplete = await handlePhotoApiRequest(photoBatchRequest(), {
      PHOTO_API_ENABLED: 'true',
      ALLOWED_ORIGINS: allowedOrigin,
      TURNSTILE_SECRET_KEY: 'turnstile-secret-value',
    })
    expect(incomplete.status).toBe(503)
  })

  it('rejects an unlisted Origin without CORS or storage access', async () => {
    const { env, namespace } = photoEnv()
    const response = await handlePhotoApiRequest(
      photoBatchRequest({ origin: 'https://attacker.example' }),
      env,
    )

    expect(response.status).toBe(403)
    expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false)
    expect(namespace.getByName).not.toHaveBeenCalled()
  })

  it('does not write photo input or capability data to console logs', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { env } = photoEnv()

    const response = await handlePhotoApiRequest(
      photoBatchRequest(),
      env,
      { fetchImplementation: successfulTurnstileFetch() },
    )

    expect(response.status).toBe(200)
    expect(consoleLog).not.toHaveBeenCalled()
  })

  it('does not include either manual session value in diagnostics', async () => {
    const { env } = photoEnv()
    const gateNow = Date.UTC(2026, 7, 2)
    const otherToken = `mv1_${'X'.repeat(32)}`
    Object.assign(env, {
      PHOTO_API_ENABLED: 'false',
      MANUAL_VALIDATION_ENABLED: 'true',
      MANUAL_VALIDATION_SESSION_SHA256: await sha256(
        manualValidationToken,
      ),
      MANUAL_VALIDATION_EXPIRES_AT: new Date(
        gateNow + 60_000,
      ).toISOString(),
      DIAGNOSTIC_MODE: 'true',
    })
    const messages: string[] = []

    const response = await handlePhotoApiRequest(
      photoBatchRequest({
        validationSessionToken: manualValidationToken,
        validationSessionHeader: otherToken,
      }),
      env,
      {
        now: () => gateNow,
        logImplementation: (message) => messages.push(message),
      },
    )

    expect(response.status).toBe(403)
    expect(messages.join('\n')).not.toContain(manualValidationToken)
    expect(messages.join('\n')).not.toContain(otherToken)
  })

  it('emits only allowlisted photo stages when diagnostics are enabled', async () => {
    const { env, namespace } = photoEnv()
    env.DIAGNOSTIC_MODE = 'true'
    namespace.stubs.set(validPhotoTokens[0], Object.assign(
      new FakePhotoStub(),
      { saveError: new Error('raw storage detail') },
    ))
    const messages: string[] = []

    const response = await handlePhotoApiRequest(
      photoBatchRequest(),
      env,
      {
        createRequestId: () => 'safe-photo-request',
        logImplementation: (message) => messages.push(message),
        fetchImplementation: successfulTurnstileFetch(),
      },
    )

    expect(response.status).toBe(503)
    expect(response.headers.get('X-Otsukai-Request-Id')).toBe(
      'safe-photo-request',
    )
    expect(messages.length).toBeGreaterThan(0)
    const combined = messages.join('\n')
    expect(combined).toContain('"errorClass":"photo-storage"')
    expect(combined).not.toContain(validPhotoTokens[0])
    expect(combined).not.toContain('item-0')
    expect(combined).not.toContain('single-use-token')
    expect(combined).not.toContain('turnstile-secret-value')
    expect(combined).not.toContain('raw storage detail')
    const allowedKeys = new Set([
      'schemaVersion',
      'event',
      'requestId',
      'stage',
      'durationMs',
      'httpStatus',
      'errorClass',
      'photoCount',
      'imageBytes',
    ])
    for (const message of messages) {
      const entry = JSON.parse(message) as Record<string, unknown>
      expect(entry).toMatchObject({
        schemaVersion: 1,
        event: 'product_photo_api',
        requestId: 'safe-photo-request',
      })
      expect(Object.keys(entry).every((key) => allowedKeys.has(key))).toBe(true)
    }
  })

  it('classifies a Durable Object namespace lookup failure as storage', async () => {
    const { env, namespace } = photoEnv()
    env.DIAGNOSTIC_MODE = 'true'
    namespace.getByName.mockImplementationOnce(() => {
      throw new Error('raw namespace detail')
    })
    const messages: string[] = []

    const response = await handlePhotoApiRequest(
      photoBatchRequest(),
      env,
      {
        createRequestId: () => 'safe-namespace-request',
        logImplementation: (message) => messages.push(message),
        fetchImplementation: successfulTurnstileFetch(),
      },
    )

    expect(response.status).toBe(503)
    expect(messages.join('\n')).toContain(
      '"errorClass":"photo-storage"',
    )
    expect(messages.join('\n')).not.toContain('raw namespace detail')
  })
})
