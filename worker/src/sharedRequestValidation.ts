import {
  MAX_SHARED_REQUEST_BODY_BYTES,
  MAX_SHARED_REQUEST_CUSTOM_ITEMS,
  MAX_SHARED_REQUEST_ITEMS,
  MAX_SHARED_REQUEST_PHOTOS,
  SHARED_REQUEST_EDIT_SECRET_PATTERN,
} from './sharedRequestConstants'
import type {
  SharedRequestCreateBody,
  SharedRequestItem,
  SharedRequestNewItem,
  SharedRequestOperation,
  SharedRequestPatchBody,
} from './sharedRequestTypes'
import { PHOTO_TOKEN_PATTERN } from './photoConstants'
import { countTextCharacters } from './text'

const IDENTIFIER_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u
const MAX_TURNSTILE_TOKEN_LENGTH = 2_048
const MAX_OPERATIONS_PER_PATCH = 50

export class SharedRequestValidationError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code)
    this.name = 'SharedRequestValidationError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value)
  const allowed = new Set([...required, ...optional])
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => allowed.has(key))
  )
}

function hasSafeText(
  value: unknown,
  maximumCharacters: number,
  allowEmpty = false,
): value is string {
  if (typeof value !== 'string' || CONTROL_CHARACTER_PATTERN.test(value)) {
    return false
  }
  const normalized = value.trim()
  return (
    (allowEmpty || normalized.length > 0) &&
    countTextCharacters(normalized) <= maximumCharacters
  )
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && IDENTIFIER_PATTERN.test(value)
}

function normalizeNewItem(
  value: unknown,
  allowPhoto: boolean,
): SharedRequestNewItem | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const optional = allowPhoto ? ['memo', 'photoToken'] : ['memo']
  if (
    !hasExactKeys(
      value,
      [
        'itemId',
        'productId',
        'productNameSnapshot',
        'categoryIdSnapshot',
        'categoryNameSnapshot',
        'quantity',
        'unit',
        'iconSnapshot',
        'sortOrderSnapshot',
      ],
      optional,
    ) ||
    !isIdentifier(value.itemId) ||
    !isIdentifier(value.productId) ||
    !hasSafeText(value.productNameSnapshot, 30) ||
    !isIdentifier(value.categoryIdSnapshot) ||
    !hasSafeText(value.categoryNameSnapshot, 30) ||
    !Number.isInteger(value.quantity) ||
    (value.quantity as number) < 1 ||
    (value.quantity as number) > 20 ||
    !hasSafeText(value.unit, 10) ||
    !hasSafeText(value.iconSnapshot, 16) ||
    !Number.isSafeInteger(value.sortOrderSnapshot) ||
    (value.sortOrderSnapshot as number) < 0 ||
    (value.sortOrderSnapshot as number) > 1_000_000 ||
    (Object.hasOwn(value, 'memo') && !hasSafeText(value.memo, 30, true)) ||
    (Object.hasOwn(value, 'photoToken') &&
      (typeof value.photoToken !== 'string' ||
        !PHOTO_TOKEN_PATTERN.test(value.photoToken)))
  ) {
    return undefined
  }

  return {
    itemId: value.itemId,
    productId: value.productId,
    productNameSnapshot: value.productNameSnapshot.trim(),
    categoryIdSnapshot: value.categoryIdSnapshot,
    categoryNameSnapshot: value.categoryNameSnapshot.trim(),
    quantity: value.quantity as number,
    unit: value.unit.trim(),
    ...(typeof value.memo === 'string' && value.memo.trim()
      ? { memo: value.memo.trim() }
      : {}),
    iconSnapshot: value.iconSnapshot.trim(),
    sortOrderSnapshot: value.sortOrderSnapshot as number,
    ...(allowPhoto && typeof value.photoToken === 'string'
      ? { photoToken: value.photoToken }
      : {}),
  }
}

function validateItemCollection(items: SharedRequestNewItem[]): boolean {
  if (items.length < 1 || items.length > MAX_SHARED_REQUEST_ITEMS) {
    return false
  }
  const itemIds = new Set<string>()
  const photoTokens = new Set<string>()
  let totalMemoCharacters = 0
  let customItems = 0
  for (const item of items) {
    if (itemIds.has(item.itemId)) {
      return false
    }
    itemIds.add(item.itemId)
    if (item.productId.startsWith('custom:')) {
      customItems += 1
      if (customItems > MAX_SHARED_REQUEST_CUSTOM_ITEMS) {
        return false
      }
    }
    totalMemoCharacters += countTextCharacters(item.memo ?? '')
    if (item.photoToken) {
      if (
        photoTokens.has(item.photoToken) ||
        photoTokens.size >= MAX_SHARED_REQUEST_PHOTOS
      ) {
        return false
      }
      photoTokens.add(item.photoToken)
    }
  }
  return totalMemoCharacters <= 1_000
}

async function parseJsonRequest(request: Request): Promise<unknown> {
  const contentType = request.headers.get('Content-Type') ?? ''
  if (contentType.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    throw new SharedRequestValidationError(
      415,
      'UNSUPPORTED_CONTENT_TYPE',
    )
  }
  const body = await request.text()
  if (
    body.length === 0 ||
    new TextEncoder().encode(body).byteLength >
      MAX_SHARED_REQUEST_BODY_BYTES
  ) {
    throw new SharedRequestValidationError(400, 'REQUEST_INVALID')
  }
  try {
    return JSON.parse(body) as unknown
  } catch {
    throw new SharedRequestValidationError(400, 'REQUEST_INVALID')
  }
}

function isTurnstileToken(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_TURNSTILE_TOKEN_LENGTH &&
    !CONTROL_CHARACTER_PATTERN.test(value)
  )
}

export async function validateSharedRequestCreateRequest(
  request: Request,
): Promise<SharedRequestCreateBody> {
  const value = await parseJsonRequest(request)
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['turnstileToken', 'items']) ||
    !isTurnstileToken(value.turnstileToken) ||
    !Array.isArray(value.items)
  ) {
    throw new SharedRequestValidationError(400, 'REQUEST_INVALID')
  }
  const items = value.items.map((item) => normalizeNewItem(item, true))
  if (items.some((item) => !item)) {
    throw new SharedRequestValidationError(400, 'REQUEST_INVALID')
  }
  const normalizedItems = items.filter(
    (item): item is SharedRequestNewItem => Boolean(item),
  )
  if (!validateItemCollection(normalizedItems)) {
    throw new SharedRequestValidationError(400, 'REQUEST_INVALID')
  }
  return {
    turnstileToken: value.turnstileToken,
    items: normalizedItems,
  }
}

function normalizeOperation(value: unknown): SharedRequestOperation | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return undefined
  }
  switch (value.type) {
    case 'add': {
      if (!hasExactKeys(value, ['type', 'item'])) {
        return undefined
      }
      const item = normalizeNewItem(value.item, false)
      return item ? { type: 'add', item } : undefined
    }
    case 'set-quantity':
      return hasExactKeys(value, ['type', 'itemId', 'quantity']) &&
        isIdentifier(value.itemId) &&
        Number.isInteger(value.quantity) &&
        (value.quantity as number) >= 1 &&
        (value.quantity as number) <= 20
        ? {
            type: 'set-quantity',
            itemId: value.itemId,
            quantity: value.quantity as number,
          }
        : undefined
    case 'set-memo':
      return hasExactKeys(value, ['type', 'itemId', 'memo']) &&
        isIdentifier(value.itemId) &&
        hasSafeText(value.memo, 30, true)
        ? {
            type: 'set-memo',
            itemId: value.itemId,
            memo: value.memo.trim(),
          }
        : undefined
    case 'cancel':
      return hasExactKeys(value, ['type', 'itemId']) &&
        isIdentifier(value.itemId)
        ? { type: 'cancel', itemId: value.itemId }
        : undefined
    default:
      return undefined
  }
}

export async function validateSharedRequestPatchRequest(
  request: Request,
): Promise<SharedRequestPatchBody> {
  const value = await parseJsonRequest(request)
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'turnstileToken',
      'editSecret',
      'operations',
    ]) ||
    !isTurnstileToken(value.turnstileToken) ||
    typeof value.editSecret !== 'string' ||
    !SHARED_REQUEST_EDIT_SECRET_PATTERN.test(value.editSecret) ||
    !Array.isArray(value.operations) ||
    value.operations.length < 1 ||
    value.operations.length > MAX_OPERATIONS_PER_PATCH
  ) {
    throw new SharedRequestValidationError(400, 'REQUEST_INVALID')
  }
  const operations = value.operations.map(normalizeOperation)
  if (operations.some((operation) => !operation)) {
    throw new SharedRequestValidationError(400, 'REQUEST_INVALID')
  }
  return {
    turnstileToken: value.turnstileToken,
    editSecret: value.editSecret,
    operations: operations.filter(
      (operation): operation is SharedRequestOperation =>
        Boolean(operation),
    ),
  }
}

export function isStoredSharedRequestItem(
  value: unknown,
): value is SharedRequestItem {
  if (!isRecord(value)) {
    return false
  }
  const base = normalizeNewItem(
    {
      itemId: value.itemId,
      productId: value.productId,
      productNameSnapshot: value.productNameSnapshot,
      categoryIdSnapshot: value.categoryIdSnapshot,
      categoryNameSnapshot: value.categoryNameSnapshot,
      quantity: value.quantity,
      unit: value.unit,
      ...(Object.hasOwn(value, 'memo') ? { memo: value.memo } : {}),
      iconSnapshot: value.iconSnapshot,
      sortOrderSnapshot: value.sortOrderSnapshot,
      ...(Object.hasOwn(value, 'photoToken')
        ? { photoToken: value.photoToken }
        : {}),
    },
    true,
  )
  if (
    !base ||
    !hasExactKeys(
      value,
      [
        'itemId',
        'productId',
        'productNameSnapshot',
        'categoryIdSnapshot',
        'categoryNameSnapshot',
        'quantity',
        'unit',
        'iconSnapshot',
        'sortOrderSnapshot',
        'lifecycle',
        'createdRevision',
        'updatedRevision',
      ],
      ['memo', 'photoToken', 'cancelledRevision'],
    ) ||
    (value.lifecycle !== 'active' &&
      value.lifecycle !== 'cancelled-by-requester') ||
    !Number.isSafeInteger(value.createdRevision) ||
    !Number.isSafeInteger(value.updatedRevision) ||
    (Object.hasOwn(value, 'cancelledRevision') &&
      !Number.isSafeInteger(value.cancelledRevision))
  ) {
    return false
  }
  return (
    value.lifecycle === 'active'
      ? !Object.hasOwn(value, 'cancelledRevision')
      : Number.isSafeInteger(value.cancelledRevision)
  )
}
