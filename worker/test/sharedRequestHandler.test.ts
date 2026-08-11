import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkerEnv } from '../src/config'
import {
  SHARED_REQUEST_CREATE_ACTION,
  SHARED_REQUEST_EDIT_SECRET_PATTERN,
  SHARED_REQUEST_TOKEN_PATTERN,
  SHARED_REQUEST_UPDATE_ACTION,
} from '../src/sharedRequestConstants'
import {
  handleSharedRequestApiRequest,
  type SharedRequestHandlerDependencies,
} from '../src/sharedRequestHandler'
import type {
  CreateSharedRequestInput,
  CreateSharedRequestResult,
  ReadSharedRequestResult,
  SharedRequestObject,
  UpdateSharedRequestInput,
  UpdateSharedRequestResult,
} from '../src/sharedRequestObject'
import type {
  SharedRequestNewItem,
  SharedRequestSnapshot,
} from '../src/sharedRequestTypes'

const allowedOrigin = 'https://plain-relay.github.io'
const requestToken = `r1_${'R'.repeat(32)}`
const editSecret = `e1_${'E'.repeat(43)}`
const now = Date.UTC(2026, 7, 1)
const manualValidationToken = `mv1_${'M'.repeat(32)}`

async function sha256(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  )
  return [...digest]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

const realDigest = (data: ArrayBuffer) =>
  crypto.subtle.digest('SHA-256', data)

function newItem(index = 0): SharedRequestNewItem {
  return {
    itemId: `item-${index}`,
    productId: `product-${index}`,
    productNameSnapshot: `商品${index}`,
    categoryIdSnapshot: 'other',
    categoryNameSnapshot: 'その他',
    quantity: 1,
    unit: '個',
    memo: '国産',
    iconSnapshot: '🛒',
    sortOrderSnapshot: index,
  }
}

function snapshot(revision = 1): SharedRequestSnapshot {
  return {
    schemaVersion: 1,
    requestId: `v5-${requestToken}`,
    revision,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 14 * 24 * 60 * 60 * 1_000).toISOString(),
    updatesCount: revision - 1,
    items: [
      {
        ...newItem(),
        lifecycle: 'active',
        createdRevision: 1,
        updatedRevision: revision,
      },
    ],
  }
}

class FakeSharedRequestStub {
  createResult: CreateSharedRequestResult = {
    status: 'created',
    request: snapshot(),
  }
  readResult: ReadSharedRequestResult = {
    status: 'found',
    request: snapshot(),
  }
  updateResult: UpdateSharedRequestResult = {
    status: 'updated',
    request: snapshot(2),
  }
  readonly createRequest = vi.fn(
    async (_input: CreateSharedRequestInput) => this.createResult,
  )
  readonly getRequest = vi.fn(async (_now: number) => this.readResult)
  readonly updateRequest = vi.fn(
    async (_input: UpdateSharedRequestInput) => this.updateResult,
  )
}

class FakeSharedRequestNamespace {
  readonly stubs = new Map<string, FakeSharedRequestStub>()
  readonly getByName = vi.fn((name: string) => {
    let stub = this.stubs.get(name)
    if (!stub) {
      stub = new FakeSharedRequestStub()
      this.stubs.set(name, stub)
    }
    return stub as unknown as DurableObjectStub<SharedRequestObject>
  })
}

function sharedEnv(namespace = new FakeSharedRequestNamespace()): {
  env: WorkerEnv
  namespace: FakeSharedRequestNamespace
} {
  return {
    env: {
      SHARED_REQUEST_API_ENABLED: 'true',
      PHOTO_API_ENABLED: 'false',
      TURNSTILE_SECRET_KEY: 'turnstile-secret-value',
      ALLOWED_ORIGINS: allowedOrigin,
      SHARED_REQUEST_OBJECTS:
        namespace as unknown as DurableObjectNamespace<SharedRequestObject>,
    },
    namespace,
  }
}

function request(
  options: {
    method?: string
    pathname?: string
    origin?: string
    body?: unknown
    headers?: Record<string, string>
  } = {},
): Request {
  const method = options.method ?? 'POST'
  return new Request(
    `https://worker.example${options.pathname ?? '/v1/requests'}`,
    {
      method,
      headers: {
        Origin: options.origin ?? allowedOrigin,
        ...(method === 'GET'
          ? {}
          : { 'Content-Type': 'application/json' }),
        ...options.headers,
      },
      ...(method === 'GET'
        ? {}
        : {
            body: JSON.stringify(
              options.body ?? {
                turnstileToken: 'single-use-token',
                items: [newItem()],
              },
            ),
          }),
    },
  )
}

function successfulTurnstile(action: string) {
  return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    expect(init?.method).toBe('POST')
    expect(String(init?.body)).toContain('response=single-use-token')
    return Response.json({
      success: true,
      action,
      hostname: 'plain-relay.github.io',
    })
  }) as typeof fetch
}

const digestImplementation = vi.fn(async () =>
  new Uint8Array(32).fill(0xab).buffer,
)

const deterministicRandom = {
  counter: 0,
  getRandomValues(bytes: Uint8Array) {
    bytes.fill(this.counter)
    this.counter += 1
    return bytes
  },
}

afterEach(() => {
  deterministicRandom.counter = 0
  digestImplementation.mockClear()
  vi.restoreAllMocks()
})

describe('shared request API handler', () => {
  it('creates a capability request with hashed edit secret and no Gemini dependency', async () => {
    const { env, namespace } = sharedEnv()
    const dependencies: SharedRequestHandlerDependencies = {
      fetchImplementation: successfulTurnstile(
        SHARED_REQUEST_CREATE_ACTION,
      ),
      now: () => now,
      randomValues: deterministicRandom,
      digestImplementation,
    }

    const response = await handleSharedRequestApiRequest(
      request(),
      env,
      dependencies,
    )

    expect(response.status).toBe(201)
    expect(response.headers.get('ETag')).toBe('"revision-1"')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      allowedOrigin,
    )
    expect(response.headers.get('Access-Control-Expose-Headers')).toBe(
      'ETag',
    )
    const body = (await response.json()) as Record<string, unknown>
    expect(body.requestToken).toMatch(SHARED_REQUEST_TOKEN_PATTERN)
    expect(body.editSecret).toMatch(SHARED_REQUEST_EDIT_SECRET_PATTERN)
    expect(body).not.toHaveProperty('editSecretHash')
    expect(env.GEMINI_API_KEY).toBeUndefined()
    expect(env.PHOTO_OBJECTS).toBeUndefined()

    const stub = [...namespace.stubs.values()][0]
    expect(stub.createRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        editSecretHash: 'ab'.repeat(32),
        createdAt: now,
        expiresAt: now + 14 * 24 * 60 * 60 * 1_000,
      }),
    )
    const storedInput = stub.createRequest.mock.calls[0][0]
    expect(JSON.stringify(storedInput)).not.toContain(body.editSecret)
  })

  it('returns GET data with ETag and avoids a body on matching If-None-Match', async () => {
    const { env, namespace } = sharedEnv()
    const stub = new FakeSharedRequestStub()
    namespace.stubs.set(requestToken, stub)

    const response = await handleSharedRequestApiRequest(
      request({ method: 'GET', pathname: `/v1/requests/${requestToken}` }),
      env,
      { now: () => now },
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('ETag')).toBe('"revision-1"')
    await expect(response.json()).resolves.toEqual(snapshot())

    const notModified = await handleSharedRequestApiRequest(
      request({
        method: 'GET',
        pathname: `/v1/requests/${requestToken}`,
        headers: { 'If-None-Match': '"revision-1"' },
      }),
      env,
      { now: () => now },
    )
    expect(notModified.status).toBe(304)
    expect(await notModified.text()).toBe('')
    expect(stub.getRequest).toHaveBeenCalledTimes(2)
  })

  it('updates with If-Match, Turnstile, and an edit-secret hash', async () => {
    const { env, namespace } = sharedEnv()
    const stub = new FakeSharedRequestStub()
    namespace.stubs.set(requestToken, stub)
    const response = await handleSharedRequestApiRequest(
      request({
        method: 'PATCH',
        pathname: `/v1/requests/${requestToken}`,
        headers: { 'If-Match': '"revision-1"' },
        body: {
          turnstileToken: 'single-use-token',
          editSecret,
          operations: [
            { type: 'set-quantity', itemId: 'item-0', quantity: 2 },
          ],
        },
      }),
      env,
      {
        fetchImplementation: successfulTurnstile(
          SHARED_REQUEST_UPDATE_ACTION,
        ),
        now: () => now,
        digestImplementation,
      },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('ETag')).toBe('"revision-2"')
    expect(stub.updateRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevision: 1,
        editSecretHash: 'ab'.repeat(32),
      }),
    )
    expect(JSON.stringify(stub.updateRequest.mock.calls[0][0])).not.toContain(
      editSecret,
    )
  })

  it('requires If-Match before Turnstile or storage', async () => {
    const { env, namespace } = sharedEnv()
    const fetchImplementation = vi.fn() as unknown as typeof fetch
    const response = await handleSharedRequestApiRequest(
      request({
        method: 'PATCH',
        pathname: `/v1/requests/${requestToken}`,
        body: {
          turnstileToken: 'single-use-token',
          editSecret,
          operations: [{ type: 'cancel', itemId: 'item-0' }],
        },
      }),
      env,
      { fetchImplementation },
    )

    expect(response.status).toBe(428)
    await expect(response.json()).resolves.toEqual({
      code: 'IF_MATCH_REQUIRED',
    })
    expect(fetchImplementation).not.toHaveBeenCalled()
    expect(namespace.getByName).not.toHaveBeenCalled()
  })

  it('maps revision conflicts and expiry without discarding server state', async () => {
    const { env, namespace } = sharedEnv()
    const stub = new FakeSharedRequestStub()
    stub.updateResult = { status: 'precondition-failed', revision: 4 }
    namespace.stubs.set(requestToken, stub)
    const conflict = await handleSharedRequestApiRequest(
      request({
        method: 'PATCH',
        pathname: `/v1/requests/${requestToken}`,
        headers: { 'If-Match': '"revision-1"' },
        body: {
          turnstileToken: 'single-use-token',
          editSecret,
          operations: [{ type: 'cancel', itemId: 'item-0' }],
        },
      }),
      env,
      {
        fetchImplementation: successfulTurnstile(
          SHARED_REQUEST_UPDATE_ACTION,
        ),
        digestImplementation,
      },
    )
    expect(conflict.status).toBe(412)
    expect(conflict.headers.get('ETag')).toBe('"revision-4"')

    stub.readResult = { status: 'expired' }
    const expired = await handleSharedRequestApiRequest(
      request({ method: 'GET', pathname: `/v1/requests/${requestToken}` }),
      env,
    )
    expect(expired.status).toBe(410)
    await expect(expired.json()).resolves.toEqual({
      code: 'REQUEST_EXPIRED',
    })
  })

  it.each([
    [{ status: 'missing' } as UpdateSharedRequestResult, 404, 'REQUEST_NOT_FOUND'],
    [{ status: 'expired' } as UpdateSharedRequestResult, 410, 'REQUEST_EXPIRED'],
    [{ status: 'forbidden' } as UpdateSharedRequestResult, 403, 'EDIT_SECRET_INVALID'],
    [{ status: 'update-limit' } as UpdateSharedRequestResult, 429, 'UPDATE_LIMIT'],
    [{ status: 'operation-invalid' } as UpdateSharedRequestResult, 409, 'OPERATION_INVALID'],
  ] as const)(
    'maps $0 to finite HTTP $1 response',
    async (updateResult, expectedStatus, expectedCode) => {
      const { env, namespace } = sharedEnv()
      const stub = new FakeSharedRequestStub()
      stub.updateResult = updateResult
      namespace.stubs.set(requestToken, stub)

      const response = await handleSharedRequestApiRequest(
        request({
          method: 'PATCH',
          pathname: `/v1/requests/${requestToken}`,
          headers: { 'If-Match': '"revision-1"' },
          body: {
            turnstileToken: 'single-use-token',
            editSecret,
            operations: [{ type: 'cancel', itemId: 'item-0' }],
          },
        }),
        env,
        {
          fetchImplementation: successfulTurnstile(
            SHARED_REQUEST_UPDATE_ACTION,
          ),
          digestImplementation,
        },
      )

      expect(response.status).toBe(expectedStatus)
      await expect(response.json()).resolves.toEqual({
        code: expectedCode,
      })
    },
  )

  it('rejects an unlisted Origin and a failed Turnstile before storage', async () => {
    const { env, namespace } = sharedEnv()
    const originRejected = await handleSharedRequestApiRequest(
      request({ origin: 'https://attacker.example' }),
      env,
    )
    expect(originRejected.status).toBe(403)
    expect(originRejected.headers.has('Access-Control-Allow-Origin')).toBe(
      false,
    )

    const authRejected = await handleSharedRequestApiRequest(
      request(),
      env,
      {
        fetchImplementation: vi.fn(async () =>
          Response.json({
            success: false,
            action: SHARED_REQUEST_CREATE_ACTION,
            hostname: 'plain-relay.github.io',
          }),
        ) as typeof fetch,
      },
    )
    expect(authRejected.status).toBe(403)
    expect(namespace.getByName).not.toHaveBeenCalled()
  })

  it('times out stalled Turnstile verification without Durable Object access', async () => {
    const { env, namespace } = sharedEnv()
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
    const response = await handleSharedRequestApiRequest(request(), env, {
      fetchImplementation,
      timeoutMs: 1,
    })

    expect(response.status).toBe(504)
    await expect(response.json()).resolves.toEqual({ code: 'TIMEOUT' })
    expect(namespace.getByName).not.toHaveBeenCalled()
  })

  it('keeps disabled or incomplete configuration safely unavailable', async () => {
    const disabled = await handleSharedRequestApiRequest(request(), {
      SHARED_REQUEST_API_ENABLED: 'false',
    })
    expect(disabled.status).toBe(404)

    const incomplete = await handleSharedRequestApiRequest(request(), {
      SHARED_REQUEST_API_ENABLED: 'true',
      ALLOWED_ORIGINS: allowedOrigin,
      TURNSTILE_SECRET_KEY: 'turnstile-secret-value',
    })
    expect(incomplete.status).toBe(503)
  })

  it('gates create and PATCH writes by the validation session while allowing capability GET', async () => {
    const { env, namespace } = sharedEnv()
    Object.assign(env, {
      SHARED_REQUEST_API_ENABLED: 'false',
      MANUAL_VALIDATION_ENABLED: 'true',
      MANUAL_VALIDATION_SESSION_SHA256: await sha256(
        manualValidationToken,
      ),
      MANUAL_VALIDATION_EXPIRES_AT: new Date(now + 60_000).toISOString(),
    })
    const fetchImplementation = successfulTurnstile(
      SHARED_REQUEST_CREATE_ACTION,
    )
    const dependencies: SharedRequestHandlerDependencies = {
      fetchImplementation,
      now: () => now,
      randomValues: deterministicRandom,
      digestImplementation: realDigest,
    }

    const rejected = await handleSharedRequestApiRequest(
      request(),
      env,
      dependencies,
    )
    expect(rejected.status).toBe(403)
    expect(fetchImplementation).not.toHaveBeenCalled()
    expect(namespace.getByName).not.toHaveBeenCalled()

    const created = await handleSharedRequestApiRequest(
      request({
        headers: {
          'X-Otsukai-Validation-Session': manualValidationToken,
        },
      }),
      env,
      dependencies,
    )
    expect(created.status).toBe(201)
    const createdBody = (await created.json()) as { requestToken: string }

    const read = await handleSharedRequestApiRequest(
      request({
        method: 'GET',
        pathname: `/v1/requests/${createdBody.requestToken}`,
      }),
      env,
      { now: () => now },
    )
    expect(read.status).toBe(200)
  })

  it('never logs request data, capabilities, or secrets', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { env } = sharedEnv()

    const response = await handleSharedRequestApiRequest(request(), env, {
      fetchImplementation: successfulTurnstile(
        SHARED_REQUEST_CREATE_ACTION,
      ),
      randomValues: deterministicRandom,
      digestImplementation,
    })

    expect(response.status).toBe(201)
    expect(log).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })
})
