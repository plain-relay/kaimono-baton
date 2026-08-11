import type { TurnstileTokenProvider } from '../handwriting/turnstile'
import type {
  LiveRequestApi,
  LiveRequestCreateResponse,
  LiveRequestGetResult,
  LiveRequestNewItem,
  LiveRequestOperation,
} from './types'
import {
  isLiveRequestEditSecret,
  isLiveRequestToken,
  parseLiveRequestCreateResponse,
  parseLiveRequestEtag,
  parseLiveRequestSnapshot,
} from './validation'

const MAX_LIVE_REQUEST_RESPONSE_BYTES = 1_048_576

export const LIVE_REQUEST_CREATE_TURNSTILE_ACTION =
  'shared_request_create'
export const LIVE_REQUEST_UPDATE_TURNSTILE_ACTION =
  'shared_request_update'

export type LiveRequestApiErrorCode =
  | 'auth-failed'
  | 'conflict'
  | 'expired'
  | 'invalid-request'
  | 'invalid-response'
  | 'limit-reached'
  | 'service-unavailable'
  | 'timeout'

export class LiveRequestApiError extends Error {
  constructor(
    readonly code: LiveRequestApiErrorCode,
    readonly status?: number,
  ) {
    super(code)
    this.name = 'LiveRequestApiError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function endpointUrl(endpoint: string, path: string): string {
  const base = endpoint.endsWith('/') ? endpoint : `${endpoint}/`
  return new URL(path.replace(/^\//u, ''), base).toString()
}

async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new LiveRequestApiError('invalid-response', response.status)
  }
  try {
    const text = await response.text()
    if (
      text.length > MAX_LIVE_REQUEST_RESPONSE_BYTES ||
      new TextEncoder().encode(text).byteLength >
        MAX_LIVE_REQUEST_RESPONSE_BYTES
    ) {
      throw new LiveRequestApiError('invalid-response', response.status)
    }
    return JSON.parse(text) as unknown
  } catch {
    throw new LiveRequestApiError('invalid-response', response.status)
  }
}

async function readErrorCode(response: Response): Promise<string | undefined> {
  try {
    const value = await readJson(response)
    return isRecord(value) &&
      Object.keys(value).length === 1 &&
      typeof value.code === 'string'
      ? value.code
      : undefined
  } catch {
    return undefined
  }
}

function mapFailure(status: number, code?: string): LiveRequestApiError {
  if (status === 401 || status === 403 || code === 'AUTH_FAILED') {
    return new LiveRequestApiError('auth-failed', status)
  }
  if (status === 408 || status === 504 || code === 'TIMEOUT') {
    return new LiveRequestApiError('timeout', status)
  }
  if (status === 412 || code === 'REVISION_MISMATCH') {
    return new LiveRequestApiError('conflict', status)
  }
  if (status === 410 || code === 'REQUEST_EXPIRED') {
    return new LiveRequestApiError('expired', status)
  }
  if (
    status === 413 ||
    status === 429 ||
    code === 'UPDATE_LIMIT'
  ) {
    return new LiveRequestApiError('limit-reached', status)
  }
  if (status === 400 || status === 409 || status === 415 || status === 428) {
    return new LiveRequestApiError('invalid-request', status)
  }
  return new LiveRequestApiError('service-unavailable', status)
}

function requestInit(
  init: RequestInit,
  signal?: AbortSignal,
): RequestInit {
  return {
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    ...init,
    signal,
  }
}

export class WorkerLiveRequestApi implements LiveRequestApi {
  constructor(
    private readonly endpoint: string,
    private readonly turnstile?: TurnstileTokenProvider,
    private readonly fetchImplementation: typeof fetch = fetch,
    private readonly validationSessionToken?: string,
  ) {}

  private headers(values: Record<string, string> = {}): HeadersInit {
    return this.validationSessionToken
      ? {
          ...values,
          'X-Otsukai-Validation-Session': this.validationSessionToken,
        }
      : values
  }

  private async token(signal?: AbortSignal): Promise<string> {
    if (!this.turnstile) {
      throw new LiveRequestApiError('auth-failed')
    }
    return this.turnstile.getToken({ signal })
  }

  async create(
    items: readonly LiveRequestNewItem[],
    options: { signal?: AbortSignal } = {},
  ): Promise<LiveRequestCreateResponse> {
    try {
      const turnstileToken = await this.token(options.signal)
      const response = await this.fetchImplementation(
        endpointUrl(this.endpoint, '/v1/requests'),
        requestInit(
          {
            method: 'POST',
            headers: this.headers({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ turnstileToken, items }),
          },
          options.signal,
        ),
      )
      if (!response.ok) {
        throw mapFailure(response.status, await readErrorCode(response))
      }
      const value = parseLiveRequestCreateResponse(await readJson(response))
      const etag = parseLiveRequestEtag(
        response.headers.get('ETag'),
        value?.request.revision,
      )
      if (!value || !etag || response.status !== 201) {
        throw new LiveRequestApiError('invalid-response', response.status)
      }
      return value
    } catch (error) {
      if (options.signal?.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError')
      }
      if (error instanceof LiveRequestApiError) {
        throw error
      }
      throw new LiveRequestApiError('service-unavailable')
    } finally {
      this.turnstile?.reset()
    }
  }

  async get(
    requestToken: string,
    options: { etag?: string; signal?: AbortSignal } = {},
  ): Promise<LiveRequestGetResult> {
    if (!isLiveRequestToken(requestToken)) {
      throw new LiveRequestApiError('invalid-request')
    }
    try {
      const response = await this.fetchImplementation(
        endpointUrl(this.endpoint, `/v1/requests/${requestToken}`),
        requestInit(
          {
            method: 'GET',
            headers: this.headers(
              options.etag ? { 'If-None-Match': options.etag } : {},
            ),
          },
          options.signal,
        ),
      )
      if (response.status === 304) {
        const etag = parseLiveRequestEtag(response.headers.get('ETag'))
        if (!options.etag || !etag || etag !== options.etag) {
          throw new LiveRequestApiError('invalid-response', 304)
        }
        return { status: 'not-modified', etag }
      }
      if (response.status === 404) {
        return { status: 'missing' }
      }
      if (response.status === 410) {
        return { status: 'expired' }
      }
      if (!response.ok) {
        throw mapFailure(response.status, await readErrorCode(response))
      }
      if (response.status !== 200) {
        throw new LiveRequestApiError('invalid-response', response.status)
      }
      const request = parseLiveRequestSnapshot(
        await readJson(response),
        requestToken,
      )
      const etag = parseLiveRequestEtag(
        response.headers.get('ETag'),
        request?.revision,
      )
      if (!request || !etag) {
        throw new LiveRequestApiError('invalid-response', response.status)
      }
      return { status: 'found', request, etag }
    } catch (error) {
      if (options.signal?.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError')
      }
      if (error instanceof LiveRequestApiError) {
        throw error
      }
      throw new LiveRequestApiError('service-unavailable')
    }
  }

  async patch(
    requestToken: string,
    editSecret: string,
    revision: number,
    operations: readonly LiveRequestOperation[],
    options: { signal?: AbortSignal } = {},
  ): Promise<{ request: import('./types').LiveRequestSnapshot; etag: string }> {
    if (
      !isLiveRequestToken(requestToken) ||
      !isLiveRequestEditSecret(editSecret) ||
      !Number.isSafeInteger(revision) ||
      revision < 1
    ) {
      throw new LiveRequestApiError('invalid-request')
    }
    try {
      const turnstileToken = await this.token(options.signal)
      const response = await this.fetchImplementation(
        endpointUrl(this.endpoint, `/v1/requests/${requestToken}`),
        requestInit(
          {
            method: 'PATCH',
            headers: this.headers({
              'Content-Type': 'application/json',
              'If-Match': `"revision-${revision}"`,
            }),
            body: JSON.stringify({
              turnstileToken,
              editSecret,
              operations,
            }),
          },
          options.signal,
        ),
      )
      if (!response.ok) {
        throw mapFailure(response.status, await readErrorCode(response))
      }
      if (response.status !== 200) {
        throw new LiveRequestApiError('invalid-response', response.status)
      }
      const request = parseLiveRequestSnapshot(
        await readJson(response),
        requestToken,
      )
      const etag = parseLiveRequestEtag(
        response.headers.get('ETag'),
        request?.revision,
      )
      if (!request || !etag) {
        throw new LiveRequestApiError('invalid-response', response.status)
      }
      return { request, etag }
    } catch (error) {
      if (options.signal?.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError')
      }
      if (error instanceof LiveRequestApiError) {
        throw error
      }
      throw new LiveRequestApiError('service-unavailable')
    } finally {
      this.turnstile?.reset()
    }
  }
}
