import { MAX_CUSTOM_ITEM_NAME_CHARS } from '../../constants/requestLimits'
import type { EffectiveProduct } from '../../types/householdCatalog'
import { PRODUCT_ALIASES } from './productAliases'
import { sanitizeHandwritingText } from './textSanitization'
import type { ImportProductCandidate } from './types'

function sanitizeAliases(
  aliases: readonly string[],
  productName: string,
): string[] {
  const seen = new Set([productName.toLocaleLowerCase('ja-JP')])
  const result: string[] = []

  for (const alias of aliases) {
    const sanitized = sanitizeHandwritingText(
      alias,
      MAX_CUSTOM_ITEM_NAME_CHARS,
    )
    const key = sanitized.toLocaleLowerCase('ja-JP')
    if (!sanitized || seen.has(key)) {
      continue
    }
    seen.add(key)
    result.push(sanitized)
  }
  return result
}

export function buildImportProductCandidates(
  effectiveProducts: readonly EffectiveProduct[],
  aliases: Readonly<Record<string, readonly string[]>> = PRODUCT_ALIASES,
): ImportProductCandidate[] {
  const seenIds = new Set<string>()
  const candidates: ImportProductCandidate[] = []

  for (const product of effectiveProducts) {
    if (product.hidden || seenIds.has(product.id)) {
      continue
    }
    const id = product.id.trim()
    const name = sanitizeHandwritingText(
      product.name,
      MAX_CUSTOM_ITEM_NAME_CHARS,
    )
    if (!id || !name) {
      continue
    }
    seenIds.add(id)
    candidates.push({
      id,
      name,
      aliases: sanitizeAliases(aliases[product.id] ?? [], name),
    })
  }

  return candidates
}
