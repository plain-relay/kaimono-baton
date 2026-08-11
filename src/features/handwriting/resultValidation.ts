import { MAX_CUSTOM_ITEM_NAME_CHARS } from '../../constants/requestLimits'
import {
  isWithinHandwritingTextLimit,
  sanitizeHandwritingText,
  toHandwritingDedupeKey,
} from './textSanitization'
import type {
  HandwritingAnalyzedItem,
  HandwritingImportResult,
  ImportProductCandidate,
} from './types'

export const MAX_HANDWRITING_RESULT_ITEMS = 20

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value)
  return (
    keys.length === expected.length &&
    expected.every((key) =>
      Object.prototype.hasOwnProperty.call(value, key),
    )
  )
}

function parseItem(
  value: unknown,
  allowedProductIds: ReadonlySet<string>,
): HandwritingAnalyzedItem | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'sourceText',
      'status',
      'productId',
      'candidateProductIds',
    ]) ||
    typeof value.sourceText !== 'string' ||
    !isWithinHandwritingTextLimit(
      value.sourceText,
      MAX_CUSTOM_ITEM_NAME_CHARS,
    ) ||
    !Array.isArray(value.candidateProductIds)
  ) {
    return undefined
  }

  const sourceText = sanitizeHandwritingText(value.sourceText)
  const candidateProductIds = value.candidateProductIds
  if (
    !sourceText ||
    candidateProductIds.length > 3 ||
    candidateProductIds.some(
      (id) => typeof id !== 'string' || !allowedProductIds.has(id),
    ) ||
    new Set(candidateProductIds).size !== candidateProductIds.length
  ) {
    return undefined
  }

  if (
    value.status === 'matched' &&
    typeof value.productId === 'string' &&
    allowedProductIds.has(value.productId) &&
    candidateProductIds.length === 0
  ) {
    return {
      sourceText,
      status: 'matched',
      productId: value.productId,
      candidateProductIds: [],
    }
  }
  if (
    value.status === 'ambiguous' &&
    value.productId === null &&
    candidateProductIds.length >= 1
  ) {
    return {
      sourceText,
      status: 'ambiguous',
      productId: null,
      candidateProductIds: [...candidateProductIds],
    }
  }
  if (
    value.status === 'unknown' &&
    value.productId === null &&
    candidateProductIds.length === 0
  ) {
    return {
      sourceText,
      status: 'unknown',
      productId: null,
      candidateProductIds: [],
    }
  }
  return undefined
}

export function parseHandwritingImportResult(
  value: unknown,
  products: readonly ImportProductCandidate[],
): HandwritingImportResult | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['version', 'items']) ||
    value.version !== 1 ||
    !Array.isArray(value.items) ||
    value.items.length > MAX_HANDWRITING_RESULT_ITEMS
  ) {
    return undefined
  }

  const allowedProductIds = new Set(products.map((product) => product.id))
  if (allowedProductIds.size !== products.length) {
    return undefined
  }

  const items: HandwritingAnalyzedItem[] = []
  const matchedProductIds = new Set<string>()
  const sourceTexts = new Set<string>()
  for (const rawItem of value.items) {
    const item = parseItem(rawItem, allowedProductIds)
    if (!item) {
      return undefined
    }
    const sourceKey = toHandwritingDedupeKey(item.sourceText)
    if (
      sourceTexts.has(sourceKey) ||
      (item.productId !== null && matchedProductIds.has(item.productId))
    ) {
      continue
    }
    sourceTexts.add(sourceKey)
    if (item.productId !== null) {
      matchedProductIds.add(item.productId)
    }
    items.push(item)
  }

  return { version: 1, items }
}
