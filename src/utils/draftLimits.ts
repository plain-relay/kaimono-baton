import {
  MAX_CUSTOM_ITEMS,
  MAX_CUSTOM_ITEM_NAME_CHARS,
  MAX_CUSTOM_ITEM_UNIT_CHARS,
  MAX_ITEM_CONDITION_CHARS,
  MAX_ITEM_QUANTITY,
  MAX_SHARE_URL_LENGTH,
  MAX_TITLE_CHARS,
  MAX_TOTAL_CONDITION_CHARS,
} from '../constants/requestLimits'
import {
  calculateRequestBudget,
  countTotalConditionCharacters,
  getEffectiveProducts,
  type CustomRequestDraftItem,
  type DraftLimitReason,
  type RequestBudgetContext,
  type RequestDraftData,
} from './requestBudget'
import {
  countUserCharacters,
  splitUserCharacters,
  truncateUserCharacters,
} from './textLength'

export type DraftChangeResult<T> = {
  accepted: boolean
  value: T
  reason?: DraftLimitReason
}

export type ConditionTarget =
  | { kind: 'product'; productId: string }
  | { kind: 'custom'; index: number }

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

export function normalizeRegularQuantity(value: unknown): number {
  const quantity = toFiniteNumber(value)
  if (typeof quantity === 'undefined') {
    return 0
  }
  return Math.min(MAX_ITEM_QUANTITY, Math.max(0, Math.trunc(quantity)))
}

export function normalizeCustomQuantity(value: unknown): number {
  const quantity = toFiniteNumber(value)
  if (typeof quantity === 'undefined') {
    return 1
  }
  return Math.min(MAX_ITEM_QUANTITY, Math.max(1, Math.trunc(quantity)))
}

function normalizeCustomItem(item: CustomRequestDraftItem): CustomRequestDraftItem {
  return {
    id: item.id,
    name: truncateUserCharacters(item.name, MAX_CUSTOM_ITEM_NAME_CHARS),
    quantity: normalizeCustomQuantity(item.quantity),
    unit: truncateUserCharacters(item.unit, MAX_CUSTOM_ITEM_UNIT_CHARS),
    memo: truncateUserCharacters(item.memo, MAX_ITEM_CONDITION_CHARS),
  }
}

export function normalizeRequestDraftData(data: RequestDraftData): {
  value: RequestDraftData
  normalized: boolean
} {
  const draft = Object.fromEntries(
    Object.entries(data.draft).map(([productId, item]) => [
      productId,
      {
        quantity: normalizeRegularQuantity(item?.quantity),
        memo: truncateUserCharacters(
          typeof item?.memo === 'string' ? item.memo : '',
          MAX_ITEM_CONDITION_CHARS,
        ),
      },
    ]),
  )
  const customItems = data.customItems
    .slice(0, MAX_CUSTOM_ITEMS)
    .map(normalizeCustomItem)
    .filter((item) => item.name.trim())
  let remainingConditionCharacters = MAX_TOTAL_CONDITION_CHARS

  for (const product of getEffectiveProducts(data)) {
    const productId = product.id
    const item = draft[productId]
    if (!item || item.quantity <= 0) {
      continue
    }
    item.memo = truncateUserCharacters(item.memo, remainingConditionCharacters)
    remainingConditionCharacters -= countUserCharacters(item.memo)
  }
  for (const item of customItems) {
    item.memo = truncateUserCharacters(item.memo, remainingConditionCharacters)
    remainingConditionCharacters -= countUserCharacters(item.memo)
  }

  const value: RequestDraftData = {
    title: truncateUserCharacters(data.title, MAX_TITLE_CHARS),
    draft,
    customItems,
    effectiveProducts: data.effectiveProducts,
  }
  return {
    value,
    normalized: JSON.stringify(value) !== JSON.stringify(data),
  }
}

function isUrlWithinLimit(data: RequestDraftData, context: RequestBudgetContext): boolean {
  try {
    return calculateRequestBudget(data, context).urlLength <= MAX_SHARE_URL_LENGTH
  } catch {
    return false
  }
}

function findLongestFittingPrefix(
  value: string,
  createCandidate: (prefix: string) => RequestDraftData,
  context: RequestBudgetContext,
): { text: string; data: RequestDraftData } | undefined {
  const characters = splitUserCharacters(value)
  for (let length = characters.length; length >= 0; length -= 1) {
    const text = characters.slice(0, length).join('')
    const data = createCandidate(text)
    if (isUrlWithinLimit(data, context)) {
      return { text, data }
    }
  }
  return undefined
}

export function applyTitleChange(
  current: RequestDraftData,
  proposedTitle: string,
  context: RequestBudgetContext,
): DraftChangeResult<RequestDraftData> {
  const fieldLimited = truncateUserCharacters(proposedTitle, MAX_TITLE_CHARS)
  const result = findLongestFittingPrefix(
    fieldLimited,
    (title) => ({ ...current, title }),
    context,
  )
  if (!result) {
    return { accepted: false, value: current, reason: 'url-limit' }
  }

  const wasUrlLimited = result.text !== fieldLimited
  const wasFieldLimited = fieldLimited !== proposedTitle
  return {
    accepted: result.text !== current.title,
    value: result.data,
    reason: wasUrlLimited ? 'url-limit' : wasFieldLimited ? 'title-limit' : undefined,
  }
}

function setCondition(
  current: RequestDraftData,
  target: ConditionTarget,
  memo: string,
): RequestDraftData {
  if (target.kind === 'product') {
    const currentItem = current.draft[target.productId] ?? { quantity: 0, memo: '' }
    return {
      ...current,
      draft: {
        ...current.draft,
        [target.productId]: { ...currentItem, memo },
      },
    }
  }

  return {
    ...current,
    customItems: current.customItems.map((item, index) =>
      index === target.index ? { ...item, memo } : item,
    ),
  }
}

function getCondition(current: RequestDraftData, target: ConditionTarget): string {
  return target.kind === 'product'
    ? current.draft[target.productId]?.memo ?? ''
    : current.customItems[target.index]?.memo ?? ''
}

function conditionCountsTowardTotal(
  current: RequestDraftData,
  target: ConditionTarget,
): boolean {
  return target.kind === 'custom' || (current.draft[target.productId]?.quantity ?? 0) > 0
}

export function applyConditionChange(
  current: RequestDraftData,
  target: ConditionTarget,
  proposedCondition: string,
  context: RequestBudgetContext,
): DraftChangeResult<RequestDraftData> {
  const fieldLimited = truncateUserCharacters(
    proposedCondition,
    MAX_ITEM_CONDITION_CHARS,
  )
  const withoutCurrentCondition = setCondition(current, target, '')
  const remainingTotal = conditionCountsTowardTotal(current, target)
    ? Math.max(
        0,
        MAX_TOTAL_CONDITION_CHARS -
          countTotalConditionCharacters(withoutCurrentCondition),
      )
    : MAX_ITEM_CONDITION_CHARS
  const totalLimited = truncateUserCharacters(fieldLimited, remainingTotal)
  const result = findLongestFittingPrefix(
    totalLimited,
    (memo) => setCondition(current, target, memo),
    context,
  )
  if (!result) {
    return { accepted: false, value: current, reason: 'url-limit' }
  }

  const wasUrlLimited = result.text !== totalLimited
  const wasTotalLimited = totalLimited !== fieldLimited
  const wasFieldLimited = fieldLimited !== proposedCondition
  return {
    accepted: result.text !== getCondition(current, target),
    value: result.data,
    reason: wasUrlLimited
      ? 'url-limit'
      : wasTotalLimited
        ? 'total-condition-limit'
        : wasFieldLimited
          ? 'item-condition-limit'
          : undefined,
  }
}

export function applyQuantityChange(
  current: RequestDraftData,
  productId: string,
  proposedQuantity: unknown,
  context: RequestBudgetContext,
): DraftChangeResult<RequestDraftData> {
  const currentItem = current.draft[productId] ?? { quantity: 0, memo: '' }
  const quantity = normalizeRegularQuantity(proposedQuantity)
  const candidate = {
    ...current,
    draft: {
      ...current.draft,
      [productId]: { ...currentItem, quantity },
    },
  }
  const rawQuantity = toFiniteNumber(proposedQuantity)
  const wasQuantityLimited =
    typeof rawQuantity === 'undefined' ||
    !Number.isInteger(rawQuantity) ||
    rawQuantity < 0 ||
    rawQuantity > MAX_ITEM_QUANTITY

  if (countTotalConditionCharacters(candidate) > MAX_TOTAL_CONDITION_CHARS) {
    return { accepted: false, value: current, reason: 'total-condition-limit' }
  }
  if (!isUrlWithinLimit(candidate, context)) {
    return { accepted: false, value: current, reason: 'url-limit' }
  }
  return {
    accepted: quantity !== currentItem.quantity,
    value: candidate,
    reason: wasQuantityLimited ? 'quantity-limit' : undefined,
  }
}

export function applyCustomQuantityChange(
  current: RequestDraftData,
  index: number,
  proposedQuantity: unknown,
  context: RequestBudgetContext,
): DraftChangeResult<RequestDraftData> {
  const currentItem = current.customItems[index]
  if (!currentItem) {
    return { accepted: false, value: current }
  }
  const quantity = normalizeCustomQuantity(proposedQuantity)
  const candidate = {
    ...current,
    customItems: current.customItems.map((item, itemIndex) =>
      itemIndex === index ? { ...item, quantity } : item,
    ),
  }
  if (!isUrlWithinLimit(candidate, context)) {
    return { accepted: false, value: current, reason: 'url-limit' }
  }
  const rawQuantity = toFiniteNumber(proposedQuantity)
  const wasLimited =
    typeof rawQuantity === 'undefined' ||
    !Number.isInteger(rawQuantity) ||
    rawQuantity < 1 ||
    rawQuantity > MAX_ITEM_QUANTITY
  return {
    accepted: quantity !== currentItem.quantity,
    value: candidate,
    reason: wasLimited ? 'quantity-limit' : undefined,
  }
}

export function applyCustomItemAdd(
  current: RequestDraftData,
  proposedItem: CustomRequestDraftItem,
  context: RequestBudgetContext,
): DraftChangeResult<RequestDraftData> {
  if (current.customItems.length >= MAX_CUSTOM_ITEMS) {
    return { accepted: false, value: current, reason: 'custom-item-limit' }
  }
  const item = normalizeCustomItem(proposedItem)
  if (!item.name.trim()) {
    return { accepted: false, value: current, reason: 'custom-name-limit' }
  }
  const candidate = { ...current, customItems: [...current.customItems, item] }
  if (countTotalConditionCharacters(candidate) > MAX_TOTAL_CONDITION_CHARS) {
    return { accepted: false, value: current, reason: 'total-condition-limit' }
  }
  if (!isUrlWithinLimit(candidate, context)) {
    return { accepted: false, value: current, reason: 'url-limit' }
  }
  return { accepted: true, value: candidate }
}

export function applyCustomItemUpdate(
  current: RequestDraftData,
  index: number,
  proposedItem: CustomRequestDraftItem,
  context: RequestBudgetContext,
): DraftChangeResult<RequestDraftData> {
  if (!current.customItems[index]) {
    return { accepted: false, value: current }
  }
  const item = normalizeCustomItem(proposedItem)
  if (!item.name.trim()) {
    return { accepted: false, value: current, reason: 'custom-name-limit' }
  }
  const candidate = {
    ...current,
    customItems: current.customItems.map((currentItem, itemIndex) =>
      itemIndex === index ? item : currentItem,
    ),
  }
  if (countTotalConditionCharacters(candidate) > MAX_TOTAL_CONDITION_CHARS) {
    return { accepted: false, value: current, reason: 'total-condition-limit' }
  }
  if (!isUrlWithinLimit(candidate, context)) {
    return { accepted: false, value: current, reason: 'url-limit' }
  }
  return { accepted: true, value: candidate }
}

export function applyCustomItemDelete(
  current: RequestDraftData,
  index: number,
): DraftChangeResult<RequestDraftData> {
  if (!current.customItems[index]) {
    return { accepted: false, value: current }
  }
  return {
    accepted: true,
    value: {
      ...current,
      customItems: current.customItems.filter((_, itemIndex) => itemIndex !== index),
    },
  }
}
