import {
  countTextCharacters,
  MAX_PRODUCT_NAME_CHARACTERS,
  sanitizeText,
} from './text'
import { resolveRequestId } from './requestId'
import type { ImportProductCandidate } from './types'

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024
export const MAX_PRODUCTS_JSON_BYTES = 128 * 1024
export const MAX_REQUEST_BYTES =
  MAX_IMAGE_BYTES + MAX_PRODUCTS_JSON_BYTES + 64 * 1024
export const MAX_TURNSTILE_TOKEN_LENGTH = 2_048
export const MAX_PRODUCT_CANDIDATES = 200
export const MAX_PRODUCT_ID_CHARACTERS = 128
export const MAX_PRODUCT_ALIASES = 10

export type SupportedImageMime =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'

export type ValidatedHandwritingImportRequest = {
  image: File
  turnstileToken: string
  products: ImportProductCandidate[]
  requestId: string
  origin: string
  remoteIp?: string
}

export class RequestValidationError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code)
    this.name = 'RequestValidationError'
  }
}

const SUPPORTED_MIME_TYPES = new Set<SupportedImageMime>([
  'image/jpeg',
  'image/png',
  'image/webp',
])
const PRODUCT_KEYS = ['aliases', 'id', 'name'] as const
const DANGEROUS_KEYS = new Set([
  '__proto__',
  'prototype',
  'constructor',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFile(value: FormDataEntryValue): value is File {
  return typeof value !== 'string'
}

function isJpeg(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
}

function isPng(bytes: Uint8Array): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  return (
    bytes.length >= signature.length &&
    signature.every((value, index) => bytes[index] === value)
  )
}

function isWebp(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  )
}

function hasDangerousObjectKey(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(hasDangerousObjectKey)
  }
  if (!isRecord(value)) {
    return false
  }
  return Object.keys(value).some(
    (key) =>
      DANGEROUS_KEYS.has(key) ||
      hasDangerousObjectKey(value[key]),
  )
}

function hasExactProductKeys(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value).sort()
  return (
    keys.length === PRODUCT_KEYS.length &&
    PRODUCT_KEYS.every((key, index) => keys[index] === key)
  )
}

function validateProductsJson(value: string): ImportProductCandidate[] {
  if (
    !value ||
    new TextEncoder().encode(value).byteLength >
      MAX_PRODUCTS_JSON_BYTES
  ) {
    throw new RequestValidationError(400, 'INVALID_PRODUCTS')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(value) as unknown
  } catch {
    throw new RequestValidationError(400, 'INVALID_PRODUCTS')
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.length > MAX_PRODUCT_CANDIDATES ||
    hasDangerousObjectKey(parsed)
  ) {
    throw new RequestValidationError(400, 'INVALID_PRODUCTS')
  }

  const products: ImportProductCandidate[] = []
  const seenIds = new Set<string>()
  for (const rawProduct of parsed) {
    if (
      !isRecord(rawProduct) ||
      !hasExactProductKeys(rawProduct) ||
      typeof rawProduct.id !== 'string' ||
      typeof rawProduct.name !== 'string' ||
      !Array.isArray(rawProduct.aliases)
    ) {
      throw new RequestValidationError(400, 'INVALID_PRODUCTS')
    }

    const id = rawProduct.id
    const name = sanitizeText(
      rawProduct.name,
      MAX_PRODUCT_NAME_CHARACTERS,
    )
    if (
      !id ||
      id !== id.trim() ||
      id.length > MAX_PRODUCT_ID_CHARACTERS ||
      seenIds.has(id) ||
      !name ||
      countTextCharacters(rawProduct.name) >
        MAX_PRODUCT_NAME_CHARACTERS ||
      rawProduct.aliases.length > MAX_PRODUCT_ALIASES
    ) {
      throw new RequestValidationError(400, 'INVALID_PRODUCTS')
    }

    const aliases: string[] = []
    const seenAliases = new Set([name.toLocaleLowerCase('ja-JP')])
    for (const rawAlias of rawProduct.aliases) {
      if (
        typeof rawAlias !== 'string' ||
        countTextCharacters(rawAlias) > MAX_PRODUCT_NAME_CHARACTERS
      ) {
        throw new RequestValidationError(400, 'INVALID_PRODUCTS')
      }
      const alias = sanitizeText(
        rawAlias,
        MAX_PRODUCT_NAME_CHARACTERS,
      )
      if (!alias) {
        throw new RequestValidationError(400, 'INVALID_PRODUCTS')
      }
      const aliasKey = alias.toLocaleLowerCase('ja-JP')
      if (!seenAliases.has(aliasKey)) {
        seenAliases.add(aliasKey)
        aliases.push(alias)
      }
    }

    seenIds.add(id)
    products.push({ id, name, aliases })
  }
  return products
}

export function parseAllowedOrigins(value: string): Set<string> {
  return new Set(
    value
      .split(/[,\n]/u)
      .map((origin) => origin.trim())
      .filter((origin) => {
        try {
          const parsed = new URL(origin)
          return parsed.origin === origin
        } catch {
          return false
        }
      }),
  )
}

export async function detectImageMime(
  image: Blob,
): Promise<SupportedImageMime | undefined> {
  const bytes = new Uint8Array(await image.slice(0, 12).arrayBuffer())
  if (isJpeg(bytes)) {
    return 'image/jpeg'
  }
  if (isPng(bytes)) {
    return 'image/png'
  }
  if (isWebp(bytes)) {
    return 'image/webp'
  }
  return undefined
}

export async function validateHandwritingImportRequest(
  request: Request,
  allowedOrigins: ReadonlySet<string>,
  fallbackRequestId: string,
): Promise<ValidatedHandwritingImportRequest> {
  if (request.method !== 'POST') {
    throw new RequestValidationError(405, 'METHOD_NOT_ALLOWED')
  }

  const origin = request.headers.get('Origin') ?? ''
  if (!origin || !allowedOrigins.has(origin)) {
    throw new RequestValidationError(403, 'ORIGIN_NOT_ALLOWED')
  }

  const contentType = request.headers.get('Content-Type') ?? ''
  if (!/^multipart\/form-data\s*;\s*boundary=/iu.test(contentType)) {
    throw new RequestValidationError(415, 'UNSUPPORTED_CONTENT_TYPE')
  }

  const contentLength = Number(request.headers.get('Content-Length'))
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_REQUEST_BYTES
  ) {
    throw new RequestValidationError(413, 'IMAGE_TOO_LARGE')
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    throw new RequestValidationError(400, 'REQUEST_INVALID')
  }

  const entries = [...formData.entries()]
  const imageEntries = formData.getAll('image')
  const tokenEntries = formData.getAll('turnstileToken')
  const productEntries = formData.getAll('products')
  const requestIdEntries = formData.getAll('requestId')
  if (
    (entries.length !== 3 && entries.length !== 4) ||
    imageEntries.length !== 1 ||
    tokenEntries.length !== 1 ||
    productEntries.length !== 1 ||
    requestIdEntries.length > 1 ||
    !isFile(imageEntries[0]) ||
    typeof tokenEntries[0] !== 'string' ||
    typeof productEntries[0] !== 'string' ||
    (requestIdEntries.length === 1 &&
      typeof requestIdEntries[0] !== 'string') ||
    entries.some(
      ([key, entry]) =>
        ![
          'image',
          'turnstileToken',
          'products',
          'requestId',
        ].includes(key) ||
        (key !== 'image' && typeof entry !== 'string'),
    )
  ) {
    throw new RequestValidationError(400, 'REQUEST_INVALID')
  }

  const image = imageEntries[0]
  if (image.size === 0) {
    throw new RequestValidationError(400, 'REQUEST_INVALID')
  }
  if (image.size > MAX_IMAGE_BYTES) {
    throw new RequestValidationError(413, 'IMAGE_TOO_LARGE')
  }
  if (!SUPPORTED_MIME_TYPES.has(image.type as SupportedImageMime)) {
    throw new RequestValidationError(415, 'UNSUPPORTED_IMAGE_TYPE')
  }
  const detectedMime = await detectImageMime(image)
  if (!detectedMime || detectedMime !== image.type) {
    throw new RequestValidationError(415, 'UNSUPPORTED_IMAGE_TYPE')
  }

  const turnstileToken = tokenEntries[0].trim()
  if (
    !turnstileToken ||
    turnstileToken.length > MAX_TURNSTILE_TOKEN_LENGTH
  ) {
    throw new RequestValidationError(403, 'AUTH_FAILED')
  }

  return {
    image,
    turnstileToken,
    products: validateProductsJson(productEntries[0]),
    requestId: resolveRequestId(
      requestIdEntries[0],
      fallbackRequestId,
    ),
    origin,
    ...(request.headers.get('CF-Connecting-IP')
      ? { remoteIp: request.headers.get('CF-Connecting-IP') ?? undefined }
      : {}),
  }
}
