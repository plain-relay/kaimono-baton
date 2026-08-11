import { compressToEncodedURIComponent } from 'lz-string'
import type { ShoppingRequestPayload } from '../types/shopping'
import { decodeCompressedRequestJson } from './requestPayloadDecoder'

const MAX_LEGACY_REQUEST_ITEMS = 500

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim())
}

function isValidShoppingRequestItem(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const item = value as Record<string, unknown>

  return (
    isNonEmptyString(item.id) &&
    isNonEmptyString(item.productId) &&
    isNonEmptyString(item.productNameSnapshot) &&
    typeof item.categoryIdSnapshot === 'string' &&
    typeof item.categoryNameSnapshot === 'string' &&
    typeof item.quantity === 'number' &&
    Number.isSafeInteger(item.quantity) &&
    item.quantity > 0 &&
    isNonEmptyString(item.unit) &&
    (typeof item.memo === 'undefined' || typeof item.memo === 'string') &&
    typeof item.iconSnapshot === 'string' &&
    typeof item.sortOrderSnapshot === 'number' &&
    Number.isFinite(item.sortOrderSnapshot)
  )
}

function isValidPayload(value: unknown): value is ShoppingRequestPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const payload = value as Partial<ShoppingRequestPayload>
  if (!isNonEmptyString(payload.requestId)) {
    return false
  }
  if (
    typeof payload.title !== 'string' ||
    typeof payload.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(payload.createdAt)) ||
    !Array.isArray(payload.items) ||
    payload.items.length > MAX_LEGACY_REQUEST_ITEMS ||
    !payload.items.every((item) => isValidShoppingRequestItem(item))
  ) {
    return false
  }

  const itemIds = new Set<string>()
  const productIds = new Set<string>()
  for (const item of payload.items) {
    if (itemIds.has(item.id) || productIds.has(item.productId)) {
      return false
    }
    itemIds.add(item.id)
    productIds.add(item.productId)
  }
  return true
}

export function encodeShoppingRequest(payload: ShoppingRequestPayload): string {
  if (!isValidPayload(payload)) {
    throw new Error('共有URLの形式が正しくありません。')
  }
  const json = JSON.stringify(payload)
  return compressToEncodedURIComponent(json)
}

export function decodeShoppingRequest(encoded: string): ShoppingRequestPayload {
  try {
    const parsed = decodeCompressedRequestJson(
      encoded,
      '共有URLの復元に失敗しました。',
    )

    if (!isValidPayload(parsed)) {
      throw new Error('共有URLの形式が正しくありません。')
    }

    return parsed
  } catch (error) {
    const message = error instanceof Error ? error.message : '共有URLの復元に失敗しました。'
    throw new Error(message)
  }
}
