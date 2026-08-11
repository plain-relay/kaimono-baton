import {
  MAX_PHOTO_BATCH_BYTES,
  MAX_PHOTO_BYTES,
  MAX_PHOTO_DIMENSION,
  MAX_PHOTOS_PER_BATCH,
  PHOTO_TOKEN_PATTERN,
} from './photoConstants'
import {
  isManualValidationSessionToken,
  MANUAL_VALIDATION_SESSION_HEADER,
} from './manualValidation'

export {
  MAX_PHOTO_BATCH_BYTES,
  MAX_PHOTO_BYTES,
  MAX_PHOTO_DIMENSION,
  MAX_PHOTOS_PER_BATCH,
  PHOTO_TOKEN_PATTERN,
} from './photoConstants'

export const MAX_PHOTO_METADATA_BYTES = 16 * 1024
export const MAX_PHOTO_REQUEST_BYTES =
  MAX_PHOTO_BATCH_BYTES + MAX_PHOTO_METADATA_BYTES + 64 * 1024

const ITEM_KEY_PATTERN = /^[A-Za-z0-9:_-]+$/
const MAX_ITEM_KEY_LENGTH = 128
const PHOTO_METADATA_KEYS = ['itemKey', 'token'] as const
const SOF_MARKERS = new Set([
  0xc0,
  0xc1,
  0xc2,
  0xc3,
  0xc5,
  0xc6,
  0xc7,
  0xc9,
  0xca,
  0xcb,
  0xcd,
  0xce,
  0xcf,
])

export type PhotoBatchMetadata = {
  token: string
  itemKey: string
}

export type ValidatedPhotoUpload = PhotoBatchMetadata & {
  jpeg: ArrayBuffer
  width: number
  height: number
}

export type ValidatedPhotoBatchRequest = {
  turnstileToken: string
  validationSessionToken?: string
  photos: ValidatedPhotoUpload[]
  origin: string
  remoteIp?: string
}

export type ParsedPhotoBatchRequest = Omit<
  ValidatedPhotoBatchRequest,
  'photos'
> & {
  metadata: PhotoBatchMetadata[]
  files: File[]
}

export class PhotoRequestValidationError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code)
    this.name = 'PhotoRequestValidationError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFile(value: FormDataEntryValue): value is File {
  return typeof value !== 'string'
}

function hasExactMetadataKeys(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value).sort()
  return (
    keys.length === PHOTO_METADATA_KEYS.length &&
    PHOTO_METADATA_KEYS.every((key, index) => keys[index] === key)
  )
}

function resolveValidationSessionToken(
  request: Request,
  entries: FormDataEntryValue[],
): string | undefined {
  if (entries.length > 1) {
    throw new PhotoRequestValidationError(
      403,
      'VALIDATION_SESSION_INVALID',
    )
  }
  const formToken = entries[0]
  const headerToken =
    request.headers.get(MANUAL_VALIDATION_SESSION_HEADER) ?? undefined
  if (
    (formToken !== undefined && typeof formToken !== 'string') ||
    (typeof formToken === 'string' &&
      headerToken !== undefined &&
      formToken !== headerToken)
  ) {
    throw new PhotoRequestValidationError(
      403,
      'VALIDATION_SESSION_INVALID',
    )
  }
  const token =
    typeof formToken === 'string' ? formToken : headerToken
  if (token !== undefined && !isManualValidationSessionToken(token)) {
    throw new PhotoRequestValidationError(
      403,
      'VALIDATION_SESSION_INVALID',
    )
  }
  return token
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1]
}

export function inspectPhotoJpeg(bytes: Uint8Array): {
  width: number
  height: number
} {
  if (
    bytes.length < 8 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[bytes.length - 2] !== 0xff ||
    bytes[bytes.length - 1] !== 0xd9
  ) {
    throw new PhotoRequestValidationError(415, 'PHOTO_INVALID')
  }

  let offset = 2
  let dimensions: { width: number; height: number } | undefined
  let sawStartOfScan = false
  while (offset < bytes.length - 2) {
    if (bytes[offset] !== 0xff) {
      throw new PhotoRequestValidationError(415, 'PHOTO_INVALID')
    }
    while (bytes[offset] === 0xff) {
      offset += 1
    }
    const marker = bytes[offset]
    offset += 1

    if (marker === 0xd9) {
      break
    }
    if (
      marker === 0x01 ||
      marker === 0xd8 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      continue
    }
    if (offset + 2 > bytes.length) {
      throw new PhotoRequestValidationError(415, 'PHOTO_INVALID')
    }
    const segmentLength = readUint16(bytes, offset)
    if (
      segmentLength < 2 ||
      offset + segmentLength > bytes.length
    ) {
      throw new PhotoRequestValidationError(415, 'PHOTO_INVALID')
    }
    if (marker === 0xe1) {
      throw new PhotoRequestValidationError(415, 'PHOTO_METADATA_PRESENT')
    }
    if (SOF_MARKERS.has(marker)) {
      if (segmentLength < 7) {
        throw new PhotoRequestValidationError(415, 'PHOTO_INVALID')
      }
      const height = readUint16(bytes, offset + 3)
      const width = readUint16(bytes, offset + 5)
      if (width < 1 || height < 1) {
        throw new PhotoRequestValidationError(415, 'PHOTO_INVALID')
      }
      if (width > MAX_PHOTO_DIMENSION || height > MAX_PHOTO_DIMENSION) {
        throw new PhotoRequestValidationError(
          413,
          'PHOTO_DIMENSIONS_TOO_LARGE',
        )
      }
      if (dimensions) {
        throw new PhotoRequestValidationError(415, 'PHOTO_INVALID')
      }
      dimensions = { width, height }
    }
    offset += segmentLength
    if (marker === 0xda) {
      sawStartOfScan = true
      break
    }
  }

  if (!dimensions || !sawStartOfScan) {
    throw new PhotoRequestValidationError(415, 'PHOTO_INVALID')
  }
  return dimensions
}

function parseMetadata(value: string): PhotoBatchMetadata[] {
  if (
    !value ||
    new TextEncoder().encode(value).byteLength > MAX_PHOTO_METADATA_BYTES
  ) {
    throw new PhotoRequestValidationError(400, 'PHOTO_REQUEST_INVALID')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(value) as unknown
  } catch {
    throw new PhotoRequestValidationError(400, 'PHOTO_REQUEST_INVALID')
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length < 1 ||
    parsed.length > MAX_PHOTOS_PER_BATCH
  ) {
    throw new PhotoRequestValidationError(400, 'PHOTO_REQUEST_INVALID')
  }

  const seenTokens = new Set<string>()
  const seenItemKeys = new Set<string>()
  return parsed.map((entry) => {
    if (
      !isRecord(entry) ||
      !hasExactMetadataKeys(entry) ||
      typeof entry.token !== 'string' ||
      typeof entry.itemKey !== 'string' ||
      !PHOTO_TOKEN_PATTERN.test(entry.token) ||
      !entry.itemKey ||
      entry.itemKey !== entry.itemKey.trim() ||
      entry.itemKey.length > MAX_ITEM_KEY_LENGTH ||
      !ITEM_KEY_PATTERN.test(entry.itemKey) ||
      seenTokens.has(entry.token) ||
      seenItemKeys.has(entry.itemKey)
    ) {
      throw new PhotoRequestValidationError(400, 'PHOTO_REQUEST_INVALID')
    }
    seenTokens.add(entry.token)
    seenItemKeys.add(entry.itemKey)
    return { token: entry.token, itemKey: entry.itemKey }
  })
}

export async function parsePhotoBatchRequest(
  request: Request,
  allowedOrigins: ReadonlySet<string>,
): Promise<ParsedPhotoBatchRequest> {
  const origin = request.headers.get('Origin') ?? ''
  if (!origin || !allowedOrigins.has(origin)) {
    throw new PhotoRequestValidationError(403, 'ORIGIN_NOT_ALLOWED')
  }
  const contentType = request.headers.get('Content-Type') ?? ''
  if (!/^multipart\/form-data\s*;\s*boundary=/iu.test(contentType)) {
    throw new PhotoRequestValidationError(415, 'UNSUPPORTED_CONTENT_TYPE')
  }
  const contentLength = Number(request.headers.get('Content-Length'))
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_PHOTO_REQUEST_BYTES
  ) {
    throw new PhotoRequestValidationError(413, 'PHOTO_BATCH_TOO_LARGE')
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    throw new PhotoRequestValidationError(400, 'PHOTO_REQUEST_INVALID')
  }

  const entries = [...formData.entries()]
  const tokenEntries = formData.getAll('turnstileToken')
  const validationSessionEntries = formData.getAll(
    'validationSessionToken',
  )
  const metadataEntries = formData.getAll('metadata')
  const photoEntries = formData.getAll('photo')
  const validationSessionToken = resolveValidationSessionToken(
    request,
    validationSessionEntries,
  )
  if (
    tokenEntries.length !== 1 ||
    metadataEntries.length !== 1 ||
    typeof tokenEntries[0] !== 'string' ||
    typeof metadataEntries[0] !== 'string' ||
    photoEntries.length < 1 ||
    photoEntries.length > MAX_PHOTOS_PER_BATCH ||
    !photoEntries.every(isFile) ||
    entries.length !==
      photoEntries.length + 2 + validationSessionEntries.length ||
    entries.some(([key]) =>
      ![
        'validationSessionToken',
        'turnstileToken',
        'metadata',
        'photo',
      ].includes(key),
    )
  ) {
    throw new PhotoRequestValidationError(400, 'PHOTO_REQUEST_INVALID')
  }

  const turnstileToken = tokenEntries[0].trim()
  if (!turnstileToken || turnstileToken.length > 2_048) {
    throw new PhotoRequestValidationError(403, 'AUTH_FAILED')
  }
  const metadata = parseMetadata(metadataEntries[0])
  if (metadata.length !== photoEntries.length) {
    throw new PhotoRequestValidationError(400, 'PHOTO_REQUEST_INVALID')
  }

  const files = photoEntries as File[]
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
  if (totalBytes > MAX_PHOTO_BATCH_BYTES) {
    throw new PhotoRequestValidationError(413, 'PHOTO_BATCH_TOO_LARGE')
  }

  for (const file of files) {
    if (file.type !== 'image/jpeg') {
      throw new PhotoRequestValidationError(415, 'PHOTO_INVALID')
    }
    if (file.size < 1 || file.size > MAX_PHOTO_BYTES) {
      throw new PhotoRequestValidationError(
        file.size > MAX_PHOTO_BYTES ? 413 : 400,
        file.size > MAX_PHOTO_BYTES
          ? 'PHOTO_TOO_LARGE'
          : 'PHOTO_REQUEST_INVALID',
      )
    }
  }

  return {
    turnstileToken,
    ...(validationSessionToken ? { validationSessionToken } : {}),
    metadata,
    files,
    origin,
    ...(request.headers.get('CF-Connecting-IP')
      ? { remoteIp: request.headers.get('CF-Connecting-IP') ?? undefined }
      : {}),
  }
}

export async function validateParsedPhotoBatchRequest(
  parsed: ParsedPhotoBatchRequest,
): Promise<ValidatedPhotoBatchRequest> {
  const photos: ValidatedPhotoUpload[] = []
  for (let index = 0; index < parsed.files.length; index += 1) {
    const file = parsed.files[index]
    const jpeg = await file.arrayBuffer()
    const dimensions = inspectPhotoJpeg(new Uint8Array(jpeg))
    photos.push({ ...parsed.metadata[index], jpeg, ...dimensions })
  }

  return {
    turnstileToken: parsed.turnstileToken,
    ...(parsed.validationSessionToken
      ? { validationSessionToken: parsed.validationSessionToken }
      : {}),
    photos,
    origin: parsed.origin,
    ...(parsed.remoteIp
      ? { remoteIp: parsed.remoteIp }
      : {}),
  }
}

export async function validatePhotoBatchRequest(
  request: Request,
  allowedOrigins: ReadonlySet<string>,
): Promise<ValidatedPhotoBatchRequest> {
  return validateParsedPhotoBatchRequest(
    await parsePhotoBatchRequest(request, allowedOrigins),
  )
}
