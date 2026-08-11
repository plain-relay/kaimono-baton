import type {
  TurnstileClientDiagnosticStage,
  TurnstileTokenProvider,
} from '../handwriting/turnstile'
import { isAbortError } from '../handwriting/errors'
import {
  MAX_PRODUCT_PHOTO_BYTES,
} from './imageProcessing'
import { isProductPhotoToken } from './photoToken'
import type { PendingPhoto } from './types'

export const PRODUCT_PHOTO_TURNSTILE_ACTION = 'product_photo_upload'

export type ProductPhotoUploadErrorCode =
  | 'auth-failed'
  | 'validation-session-invalid'
  | 'validation-session-expired'
  | 'origin-not-allowed'
  | 'invalid-photo'
  | 'limit-reached'
  | 'network-failed'
  | 'timeout'
  | 'service-unavailable'

export type ProductPhotoClientDiagnosticStage =
  | TurnstileClientDiagnosticStage
  | 'photo-fetch-attempt-1-started'
  | 'photo-fetch-attempt-1-failed'
  | 'photo-fetch-retry-started'
  | 'photo-fetch-retry-failed'

export interface ProductPhotoClientDiagnosticsReporter {
  record(stage: ProductPhotoClientDiagnosticStage): void
}

export class ProductPhotoUploadError extends Error {
  constructor(
    readonly code: ProductPhotoUploadErrorCode,
    readonly requestId?: string,
  ) {
    super(code)
    this.name = 'ProductPhotoUploadError'
  }
}

export interface ProductPhotoUploadProvider {
  upload(
    photos: readonly PendingPhoto[],
    options?: { signal?: AbortSignal },
  ): Promise<void>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function uploadUrl(endpoint: string): string {
  const base = endpoint.endsWith('/') ? endpoint : `${endpoint}/`
  return new URL('v1/photos/batch', base).toString()
}

const WORKER_REQUEST_ID_HEADER = 'X-Otsukai-Request-Id'
const SAFE_WORKER_ERROR_CODES = new Set([
  'AUTH_FAILED',
  'VALIDATION_SESSION_INVALID',
  'VALIDATION_SESSION_EXPIRED',
  'ORIGIN_NOT_ALLOWED',
  'PHOTO_REQUEST_INVALID',
  'PHOTO_BATCH_TOO_LARGE',
  'PHOTO_INVALID',
  'PHOTO_METADATA_PRESENT',
  'PHOTO_DIMENSIONS_TOO_LARGE',
  'PHOTO_TOKEN_CONFLICT',
  'UNSUPPORTED_CONTENT_TYPE',
  'SERVICE_UNAVAILABLE',
  'TIMEOUT',
])

function safeRequestId(response: Response): string | undefined {
  const value = response.headers.get(WORKER_REQUEST_ID_HEADER) ?? ''
  return /^[A-Za-z0-9-]{1,64}$/u.test(value) ? value : undefined
}

async function readErrorCode(response: Response): Promise<string | undefined> {
  try {
    const value: unknown = await response.json()
    return isRecord(value) &&
      Object.keys(value).length === 1 &&
      typeof value.code === 'string' &&
      SAFE_WORKER_ERROR_CODES.has(value.code)
      ? value.code
      : undefined
  } catch {
    return undefined
  }
}

function mapUploadFailure(
  status: number,
  code?: string,
  requestId?: string,
): ProductPhotoUploadError {
  if (code === 'VALIDATION_SESSION_INVALID') {
    return new ProductPhotoUploadError(
      'validation-session-invalid',
      requestId,
    )
  }
  if (code === 'VALIDATION_SESSION_EXPIRED') {
    return new ProductPhotoUploadError(
      'validation-session-expired',
      requestId,
    )
  }
  if (code === 'ORIGIN_NOT_ALLOWED') {
    return new ProductPhotoUploadError('origin-not-allowed', requestId)
  }
  if (status === 401 || status === 403 || code === 'AUTH_FAILED') {
    return new ProductPhotoUploadError('auth-failed', requestId)
  }
  if (status === 408 || status === 504 || code === 'TIMEOUT') {
    return new ProductPhotoUploadError('timeout', requestId)
  }
  if (status === 413 || status === 429) {
    return new ProductPhotoUploadError('limit-reached', requestId)
  }
  if (status === 400 || status === 409 || status === 415) {
    return new ProductPhotoUploadError('invalid-photo', requestId)
  }
  return new ProductPhotoUploadError('service-unavailable', requestId)
}

function validatePhotos(photos: readonly PendingPhoto[]): void {
  const tokens = new Set<string>()
  const itemKeys = new Set<string>()
  if (photos.length < 1 || photos.length > 3) {
    throw new ProductPhotoUploadError('invalid-photo')
  }
  for (const photo of photos) {
    if (
      !photo.itemKey ||
      photo.itemKey.length > 128 ||
      !/^[A-Za-z0-9:_-]+$/u.test(photo.itemKey) ||
      !isProductPhotoToken(photo.token) ||
      tokens.has(photo.token) ||
      itemKeys.has(photo.itemKey) ||
      photo.blob.type !== 'image/jpeg' ||
      photo.blob.size < 1 ||
      photo.blob.size > MAX_PRODUCT_PHOTO_BYTES
    ) {
      throw new ProductPhotoUploadError('invalid-photo')
    }
    tokens.add(photo.token)
    itemKeys.add(photo.itemKey)
  }
}

function createUploadBody(
  photos: readonly PendingPhoto[],
  turnstileToken: string,
  validationSessionToken?: string,
): FormData {
  const body = new FormData()
  if (validationSessionToken) {
    body.append('validationSessionToken', validationSessionToken)
  }
  body.append('turnstileToken', turnstileToken)
  body.append(
    'metadata',
    JSON.stringify(
      photos.map((photo) => ({
        token: photo.token,
        itemKey: photo.itemKey,
      })),
    ),
  )
  for (const photo of photos) {
    body.append('photo', photo.blob, 'photo.jpg')
  }
  return body
}

function validateSuccess(value: unknown, photos: readonly PendingPhoto[]): boolean {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !Array.isArray(value.photos)) {
    return false
  }
  if (value.photos.length !== photos.length) {
    return false
  }
  return value.photos.every((entry, index) => {
    const expected = photos[index]
    return (
      isRecord(entry) &&
      Object.keys(entry).sort().join(',') === 'itemKey,token' &&
      entry.itemKey === expected.itemKey &&
      entry.token === expected.token
    )
  })
}

export class WorkerProductPhotoUploadProvider
  implements ProductPhotoUploadProvider
{
  constructor(
    private readonly endpoint: string,
    private readonly turnstile: TurnstileTokenProvider,
    private readonly fetchImplementation: typeof fetch = fetch,
    private readonly validationSessionToken?: string,
    private readonly diagnostics?: ProductPhotoClientDiagnosticsReporter,
  ) {}

  private recordStage(stage: ProductPhotoClientDiagnosticStage): void {
    try {
      this.diagnostics?.record(stage)
    } catch {
      // Diagnostics must never change the upload flow.
    }
  }

  async upload(
    photos: readonly PendingPhoto[],
    options: { signal?: AbortSignal } = {},
  ): Promise<void> {
    validatePhotos(photos)
    try {
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          let token: string
          try {
            token = await this.turnstile.getToken({
              signal: options.signal,
            })
          } catch (error) {
            if (options.signal?.aborted) {
              throw new DOMException(
                'The operation was aborted.',
                'AbortError',
              )
            }
            throw new ProductPhotoUploadError('auth-failed')
          }
          const body = createUploadBody(
            photos,
            token,
            this.validationSessionToken,
          )
          const startedStage =
            attempt === 1
              ? 'photo-fetch-attempt-1-started'
              : 'photo-fetch-retry-started'
          const failedStage =
            attempt === 1
              ? 'photo-fetch-attempt-1-failed'
              : 'photo-fetch-retry-failed'
          let response: Response
          this.recordStage(startedStage)
          try {
            response = await this.fetchImplementation(
              uploadUrl(this.endpoint),
              {
                method: 'POST',
                body,
                signal: options.signal,
              },
            )
          } catch (error) {
            if (options.signal?.aborted) {
              throw new DOMException(
                'The operation was aborted.',
                'AbortError',
              )
            }
            this.recordStage(failedStage)
            if (attempt === 1 && !isAbortError(error)) {
              continue
            }
            throw new ProductPhotoUploadError('network-failed')
          }
          const requestId = safeRequestId(response)
          if (!response.ok) {
            throw mapUploadFailure(
              response.status,
              await readErrorCode(response),
              requestId,
            )
          }
          let responseValue: unknown
          try {
            responseValue = await response.json()
          } catch {
            throw new ProductPhotoUploadError(
              'service-unavailable',
              requestId,
            )
          }
          if (!validateSuccess(responseValue, photos)) {
            throw new ProductPhotoUploadError(
              'service-unavailable',
              requestId,
            )
          }
          return
        } finally {
          this.turnstile.reset()
        }
      }
    } catch (error) {
      if (options.signal?.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError')
      }
      if (error instanceof ProductPhotoUploadError) {
        throw error
      }
      throw new ProductPhotoUploadError('service-unavailable')
    }
  }
}
