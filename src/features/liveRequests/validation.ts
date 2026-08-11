import { MAX_CUSTOM_ITEMS } from '../../constants/requestLimits'
import { countUserCharacters } from '../../utils/textLength'
import { isProductPhotoToken } from '../productPhotos/photoToken'
import type {
  LiveRequestCreateResponse,
  LiveRequestItem,
  LiveRequestSnapshot,
} from './types'

export const LIVE_REQUEST_TOKEN_PATTERN = /^r1_[A-Za-z0-9_-]{32}$/u
export const LIVE_REQUEST_EDIT_SECRET_PATTERN =
  /^e1_[A-Za-z0-9_-]{43}$/u
export const LIVE_REQUEST_ETAG_PATTERN = /^"revision-([1-9][0-9]*)"$/u

const IDENTIFIER_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/u
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u
const MAX_STORED_ITEMS = 403
const MAX_ACTIVE_ITEMS = 303
const MAX_UPDATES = 100
const MAX_ACTIVE_MEMO_CHARACTERS = 1_000
const LIVE_REQUEST_RETENTION_MS = 14 * 24 * 60 * 60 * 1_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function owns(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional])
  const keys = Object.keys(value)
  return (
    required.every((key) => owns(value, key)) &&
    keys.every((key) => allowed.has(key))
  )
}

function isSafeText(
  value: unknown,
  maximumCharacters: number,
  allowEmpty = false,
): value is string {
  if (typeof value !== 'string' || CONTROL_CHARACTER_PATTERN.test(value)) {
    return false
  }
  const trimmed = value.trim()
  return (
    (allowEmpty || trimmed.length > 0) &&
    countUserCharacters(trimmed) <= maximumCharacters
  )
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

function parseItem(value: unknown): LiveRequestItem | undefined {
  if (
    !isRecord(value) ||
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
    typeof value.itemId !== 'string' ||
    !IDENTIFIER_PATTERN.test(value.itemId) ||
    typeof value.productId !== 'string' ||
    !IDENTIFIER_PATTERN.test(value.productId) ||
    !isSafeText(value.productNameSnapshot, 30) ||
    typeof value.categoryIdSnapshot !== 'string' ||
    !IDENTIFIER_PATTERN.test(value.categoryIdSnapshot) ||
    !isSafeText(value.categoryNameSnapshot, 30) ||
    !Number.isInteger(value.quantity) ||
    (value.quantity as number) < 1 ||
    (value.quantity as number) > 20 ||
    !isSafeText(value.unit, 10) ||
    (owns(value, 'memo') &&
      !isSafeText(value.memo, 30, true)) ||
    !isSafeText(value.iconSnapshot, 16) ||
    !Number.isSafeInteger(value.sortOrderSnapshot) ||
    (value.sortOrderSnapshot as number) < 0 ||
    (value.sortOrderSnapshot as number) > 1_000_000 ||
    (owns(value, 'photoToken') &&
      (typeof value.photoToken !== 'string' ||
        !isProductPhotoToken(value.photoToken))) ||
    (value.lifecycle !== 'active' &&
      value.lifecycle !== 'cancelled-by-requester') ||
    !isPositiveInteger(value.createdRevision) ||
    !isPositiveInteger(value.updatedRevision) ||
    value.updatedRevision < value.createdRevision
  ) {
    return undefined
  }

  const cancelledRevision = value.cancelledRevision
  if (
    (value.lifecycle === 'active' && owns(value, 'cancelledRevision')) ||
    (value.lifecycle === 'cancelled-by-requester' &&
      (!isPositiveInteger(cancelledRevision) ||
        cancelledRevision !== value.updatedRevision))
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
    ...(typeof value.photoToken === 'string'
      ? { photoToken: value.photoToken }
      : {}),
    lifecycle: value.lifecycle,
    createdRevision: value.createdRevision,
    updatedRevision: value.updatedRevision,
    ...(typeof cancelledRevision === 'number'
      ? { cancelledRevision }
      : {}),
  }
}

export function isLiveRequestToken(value: string): boolean {
  return LIVE_REQUEST_TOKEN_PATTERN.test(value)
}

export function isLiveRequestEditSecret(value: string): boolean {
  return LIVE_REQUEST_EDIT_SECRET_PATTERN.test(value)
}

export function parseLiveRequestEtag(
  value: string | null,
  expectedRevision?: number,
): string | undefined {
  const match = LIVE_REQUEST_ETAG_PATTERN.exec(value ?? '')
  if (!match) {
    return undefined
  }
  const revision = Number(match[1])
  if (
    !Number.isSafeInteger(revision) ||
    (typeof expectedRevision === 'number' && revision !== expectedRevision)
  ) {
    return undefined
  }
  return value ?? undefined
}

export function parseLiveRequestSnapshot(
  value: unknown,
  expectedToken?: string,
): LiveRequestSnapshot | undefined {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'schemaVersion',
      'requestId',
      'revision',
      'createdAt',
      'expiresAt',
      'updatesCount',
      'items',
    ]) ||
    value.schemaVersion !== 1 ||
    typeof value.requestId !== 'string' ||
    !/^v5-r1_[A-Za-z0-9_-]{32}$/u.test(value.requestId) ||
    (expectedToken && value.requestId !== `v5-${expectedToken}`) ||
    !isPositiveInteger(value.revision) ||
    typeof value.createdAt !== 'string' ||
    Number.isNaN(Date.parse(value.createdAt)) ||
    typeof value.expiresAt !== 'string' ||
    Number.isNaN(Date.parse(value.expiresAt)) ||
    Date.parse(value.expiresAt) - Date.parse(value.createdAt) !==
      LIVE_REQUEST_RETENTION_MS ||
    !Number.isSafeInteger(value.updatesCount) ||
    (value.updatesCount as number) < 0 ||
    (value.updatesCount as number) > MAX_UPDATES ||
    value.updatesCount !== value.revision - 1 ||
    !Array.isArray(value.items) ||
    value.items.length < 1 ||
    value.items.length > MAX_STORED_ITEMS
  ) {
    return undefined
  }

  const items = value.items.map(parseItem)
  if (items.some((item) => !item)) {
    return undefined
  }
  const normalizedItems = items.filter(
    (item): item is LiveRequestItem => Boolean(item),
  )
  const itemIds = new Set<string>()
  const photoTokens = new Set<string>()
  let activeItems = 0
  let activeCustomItems = 0
  let activeMemoCharacters = 0
  for (const item of normalizedItems) {
    if (
      item.createdRevision > value.revision ||
      item.updatedRevision > value.revision ||
      (item.cancelledRevision ?? 0) > value.revision ||
      itemIds.has(item.itemId) ||
      (item.photoToken && photoTokens.has(item.photoToken))
    ) {
      return undefined
    }
    itemIds.add(item.itemId)
    if (item.lifecycle === 'active') {
      activeItems += 1
      activeMemoCharacters += countUserCharacters(item.memo ?? '')
      if (item.productId.startsWith('custom:')) {
        activeCustomItems += 1
      }
    }
    if (item.photoToken) {
      photoTokens.add(item.photoToken)
    }
  }
  if (photoTokens.size > 3) {
    return undefined
  }
  if (
    activeItems > MAX_ACTIVE_ITEMS ||
    activeCustomItems > MAX_CUSTOM_ITEMS ||
    activeMemoCharacters > MAX_ACTIVE_MEMO_CHARACTERS
  ) {
    return undefined
  }

  return {
    schemaVersion: 1,
    requestId: value.requestId,
    revision: value.revision,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
    updatesCount: value.updatesCount as number,
    items: normalizedItems,
  }
}

export function parseLiveRequestCreateResponse(
  value: unknown,
): LiveRequestCreateResponse | undefined {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['requestToken', 'editSecret', 'request']) ||
    typeof value.requestToken !== 'string' ||
    !isLiveRequestToken(value.requestToken) ||
    typeof value.editSecret !== 'string' ||
    !isLiveRequestEditSecret(value.editSecret)
  ) {
    return undefined
  }
  const request = parseLiveRequestSnapshot(
    value.request,
    value.requestToken,
  )
  return request
    ? {
        requestToken: value.requestToken,
        editSecret: value.editSecret,
        request,
      }
    : undefined
}
