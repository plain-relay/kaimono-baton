import type { ShoppingRequestItemPayload } from '../types/shopping'

export const TRIAL_YAHATAHIGASHI_CATEGORY_ORDER = [
  'fruits',
  'soy',
  'vegetables',
  'fish',
  'seasonings-dry',
  'prepared',
  'meat',
  'eggs-dairy',
  'bread',
  'drinks',
  'daily',
  'baby',
  'other',
  'frozen',
] as const

const CATEGORY_ORDER = new Map<string, number>(
  TRIAL_YAHATAHIGASHI_CATEGORY_ORDER.map((categoryId, index) => [categoryId, index]),
)

const OTHER_CATEGORY_ORDER = CATEGORY_ORDER.get('other') ?? 0

export function getStoreCategoryOrder(categoryId: string): number {
  return CATEGORY_ORDER.get(categoryId) ?? OTHER_CATEGORY_ORDER
}

export function compareItemsByStoreOrder(
  a: ShoppingRequestItemPayload,
  b: ShoppingRequestItemPayload,
): number {
  const categoryDifference =
    getStoreCategoryOrder(a.categoryIdSnapshot) - getStoreCategoryOrder(b.categoryIdSnapshot)

  if (categoryDifference !== 0) {
    return categoryDifference
  }

  const sortOrderDifference = a.sortOrderSnapshot - b.sortOrderSnapshot
  if (sortOrderDifference !== 0) {
    return sortOrderDifference
  }

  return a.productNameSnapshot.localeCompare(b.productNameSnapshot, 'ja')
}
