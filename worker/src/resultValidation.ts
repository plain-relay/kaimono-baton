import {
  MAX_GEMINI_OUTPUT_BYTES,
  GeminiAnalysisError,
} from './gemini'
import {
  countTextCharacters,
  MAX_SOURCE_TEXT_CHARACTERS,
  sanitizeText,
  toTextDedupeKey,
} from './text'
import type {
  HandwritingAnalyzedItem,
  HandwritingImportResult,
  ImportProductCandidate,
} from './types'

const ITEM_KEYS = [
  'candidateProductIds',
  'productId',
  'sourceText',
  'status',
] as const
const RESULT_KEYS = ['items', 'version'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort()
  return (
    keys.length === expected.length &&
    expected.every((key, index) => keys[index] === key)
  )
}

function safeCandidateIds(
  value: readonly unknown[],
  allowedProductIds: ReadonlySet<string>,
): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const candidate of value) {
    if (
      typeof candidate !== 'string' ||
      !allowedProductIds.has(candidate) ||
      seen.has(candidate)
    ) {
      continue
    }
    seen.add(candidate)
    result.push(candidate)
    if (result.length === 3) {
      break
    }
  }
  return result
}

function validateItemShape(
  value: unknown,
): value is Record<string, unknown> & {
  sourceText: string
  candidateProductIds: unknown[]
} {
  return (
    isRecord(value) &&
    hasExactKeys(value, ITEM_KEYS) &&
    typeof value.sourceText === 'string' &&
    Array.isArray(value.candidateProductIds)
  )
}

function normalizeItem(
  value: Record<string, unknown> & {
    sourceText: string
    candidateProductIds: unknown[]
  },
  allowedProductIds: ReadonlySet<string>,
): HandwritingAnalyzedItem {
  if (
    countTextCharacters(value.sourceText) >
    MAX_SOURCE_TEXT_CHARACTERS * 4
  ) {
    throw new GeminiAnalysisError('invalid-response')
  }
  const sourceText = sanitizeText(
    value.sourceText,
    MAX_SOURCE_TEXT_CHARACTERS,
  )
  if (!sourceText) {
    throw new GeminiAnalysisError('invalid-response')
  }

  if (
    value.status === 'matched' &&
    typeof value.productId === 'string' &&
    allowedProductIds.has(value.productId)
  ) {
    return {
      sourceText,
      status: 'matched',
      productId: value.productId,
      candidateProductIds: [],
    }
  }

  if (value.status === 'ambiguous') {
    const candidateProductIds = safeCandidateIds(
      value.candidateProductIds,
      allowedProductIds,
    )
    if (candidateProductIds.length > 0) {
      return {
        sourceText,
        status: 'ambiguous',
        productId: null,
        candidateProductIds,
      }
    }
  }

  if (
    value.status !== 'matched' &&
    value.status !== 'ambiguous' &&
    value.status !== 'unknown'
  ) {
    throw new GeminiAnalysisError('invalid-response')
  }

  return {
    sourceText,
    status: 'unknown',
    productId: null,
    candidateProductIds: [],
  }
}

export function parseGeminiHandwritingResult(
  text: string,
  products: readonly ImportProductCandidate[],
): HandwritingImportResult {
  if (
    new TextEncoder().encode(text).byteLength > MAX_GEMINI_OUTPUT_BYTES
  ) {
    throw new GeminiAnalysisError('invalid-response')
  }

  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch {
    throw new GeminiAnalysisError('invalid-response')
  }
  if (
    !isRecord(value) ||
    !hasExactKeys(value, RESULT_KEYS) ||
    value.version !== 1 ||
    !Array.isArray(value.items) ||
    value.items.length > 20
  ) {
    throw new GeminiAnalysisError('invalid-response')
  }

  const allowedProductIds = new Set(products.map((product) => product.id))
  const items: HandwritingAnalyzedItem[] = []
  const matchedProductIds = new Set<string>()
  const sourceTexts = new Set<string>()

  for (const rawItem of value.items) {
    if (!validateItemShape(rawItem)) {
      throw new GeminiAnalysisError('invalid-response')
    }
    const item = normalizeItem(rawItem, allowedProductIds)
    const sourceKey = toTextDedupeKey(item.sourceText)
    if (
      sourceTexts.has(sourceKey) ||
      (item.productId !== null &&
        matchedProductIds.has(item.productId))
    ) {
      continue
    }
    sourceTexts.add(sourceKey)
    if (item.productId !== null) {
      matchedProductIds.add(item.productId)
    }
    items.push(item)
  }

  const result: HandwritingImportResult = { version: 1, items }
  if (
    new TextEncoder().encode(JSON.stringify(result)).byteLength >
    MAX_GEMINI_OUTPUT_BYTES
  ) {
    throw new GeminiAnalysisError('invalid-response')
  }
  return result
}
