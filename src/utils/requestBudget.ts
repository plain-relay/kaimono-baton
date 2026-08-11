import {
  MAX_CUSTOM_ITEMS,
  MAX_CUSTOM_ITEM_NAME_CHARS,
  MAX_CUSTOM_ITEM_UNIT_CHARS,
  MAX_ITEM_CONDITION_CHARS,
  MAX_ITEM_QUANTITY,
  MAX_SHARE_URL_LENGTH,
  SHARE_URL_WARNING_THRESHOLD,
  MAX_TITLE_CHARS,
  MAX_TOTAL_CONDITION_CHARS,
  TOTAL_CONDITION_WARNING_THRESHOLD,
} from '../constants/requestLimits'
import { products } from '../data/products'
import type { EffectiveProduct } from '../types/householdCatalog'
import type { CreateDraftState } from '../types/shopping'
import {
  buildCompactRequestV3Payload,
  encodeCompactRequestV3,
} from './compactRequestV3'
import { buildCompactRequestUrl, type CompactCustomItemInput } from './compactRequest'
import { buildLineDeliveryRequestUrl } from './lineDeliveryUrl'
import { buildSelectedRequestItems } from './selectedRequestItems'
import { countUserCharacters } from './textLength'

export type CustomRequestDraftItem = CompactCustomItemInput & { id: string }

export type RequestDraftData = {
  title: string
  draft: CreateDraftState
  customItems: readonly CustomRequestDraftItem[]
  effectiveProducts?: readonly EffectiveProduct[]
}
export type RequestBudgetContext = {
  baseUrl: string
  requestKey: string
}

export type DraftLimitReason =
  | 'item-condition-limit'
  | 'total-condition-limit'
  | 'quantity-limit'
  | 'custom-item-limit'
  | 'custom-name-limit'
  | 'custom-unit-limit'
  | 'title-limit'
  | 'url-limit'
  | 'no-items'

export type RequestBudget = {
  url: string
  urlLength: number
  remaining: number
}

export type DraftValidationResult =
  | ({ valid: true } & RequestBudget)
  | { valid: false; reason: DraftLimitReason; url?: string; urlLength?: number }

export function isTotalConditionWarning(characterCount: number): boolean {
  return characterCount >= TOTAL_CONDITION_WARNING_THRESHOLD
}

export function isShareUrlWarning(urlLength: number): boolean {
  return urlLength >= SHARE_URL_WARNING_THRESHOLD
}

export function countTotalConditionCharacters(data: RequestDraftData): number {
  return buildSelectedRequestItems(
    getEffectiveProducts(data),
    data.draft,
    data.customItems,
  ).reduce(
    (total, item) => total + countUserCharacters(item.memo.trim()),
    0,
  )
}

export function hasSelectedRequestItems(data: RequestDraftData): boolean {
  return (
    buildSelectedRequestItems(
      getEffectiveProducts(data),
      data.draft,
      data.customItems,
    ).length > 0
  )
}

const DEFAULT_EFFECTIVE_PRODUCTS: readonly EffectiveProduct[] = products.map(
  (product) => ({
    ...product,
    source: 'base',
    hidden: false,
    isCustomized: false,
  }),
)

export function getEffectiveProducts(
  data: RequestDraftData,
): readonly EffectiveProduct[] {
  return data.effectiveProducts ?? DEFAULT_EFFECTIVE_PRODUCTS
}

export function calculateRequestBudget(
  data: RequestDraftData,
  context: RequestBudgetContext,
): RequestBudget {
  const payload = buildCompactRequestV3Payload({
    requestKey: context.requestKey,
    title: data.title,
    items: buildSelectedRequestItems(
      getEffectiveProducts(data),
      data.draft,
      data.customItems,
    ),
  })
  const compactUrl = buildCompactRequestUrl(
    context.baseUrl,
    encodeCompactRequestV3(payload),
  )
  const url = buildLineDeliveryRequestUrl(compactUrl)
  return {
    url,
    urlLength: url.length,
    remaining: MAX_SHARE_URL_LENGTH - url.length,
  }
}

export function validateDraftLimits(
  data: RequestDraftData,
  context: RequestBudgetContext,
  requireItems = false,
): DraftValidationResult {
  if (countUserCharacters(data.title.trim()) > MAX_TITLE_CHARS) {
    return { valid: false, reason: 'title-limit' }
  }

  for (const product of getEffectiveProducts(data)) {
    const productId = product.id
    const item = data.draft[productId]
    if (!item) {
      continue
    }
    if (
      !Number.isInteger(item.quantity) ||
      item.quantity < 0 ||
      item.quantity > MAX_ITEM_QUANTITY
    ) {
      return { valid: false, reason: 'quantity-limit' }
    }
    if (countUserCharacters(item.memo) > MAX_ITEM_CONDITION_CHARS) {
      return { valid: false, reason: 'item-condition-limit' }
    }
  }

  if (data.customItems.length > MAX_CUSTOM_ITEMS) {
    return { valid: false, reason: 'custom-item-limit' }
  }
  for (const item of data.customItems) {
    if (
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > MAX_ITEM_QUANTITY
    ) {
      return { valid: false, reason: 'quantity-limit' }
    }
    if (!item.name.trim() || countUserCharacters(item.name.trim()) > MAX_CUSTOM_ITEM_NAME_CHARS) {
      return { valid: false, reason: 'custom-name-limit' }
    }
    if (countUserCharacters(item.unit.trim() || '個') > MAX_CUSTOM_ITEM_UNIT_CHARS) {
      return { valid: false, reason: 'custom-unit-limit' }
    }
    if (countUserCharacters(item.memo) > MAX_ITEM_CONDITION_CHARS) {
      return { valid: false, reason: 'item-condition-limit' }
    }
  }

  if (countTotalConditionCharacters(data) > MAX_TOTAL_CONDITION_CHARS) {
    return { valid: false, reason: 'total-condition-limit' }
  }
  if (requireItems && !hasSelectedRequestItems(data)) {
    return { valid: false, reason: 'no-items' }
  }

  try {
    const budget = calculateRequestBudget(data, context)
    return budget.urlLength <= MAX_SHARE_URL_LENGTH
      ? { valid: true, ...budget }
      : { valid: false, reason: 'url-limit', ...budget }
  } catch {
    return { valid: false, reason: 'url-limit' }
  }
}
