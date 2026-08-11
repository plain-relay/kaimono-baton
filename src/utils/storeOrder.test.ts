import { describe, expect, it } from 'vitest'
import type { ShoppingRequestItemPayload } from '../types/shopping'
import {
  compareItemsByStoreOrder,
  getStoreCategoryOrder,
  TRIAL_YAHATAHIGASHI_CATEGORY_ORDER,
} from './storeOrder'

const createItem = (
  id: string,
  categoryIdSnapshot: string,
  sortOrderSnapshot = 1,
  productNameSnapshot = id,
): ShoppingRequestItemPayload => ({
  id,
  productId: id,
  productNameSnapshot,
  categoryIdSnapshot,
  categoryNameSnapshot: categoryIdSnapshot,
  quantity: 1,
  unit: '個',
  iconSnapshot: '🛒',
  sortOrderSnapshot,
})

describe('Trial Yahatahigashi store order', () => {
  it('defines every category in the requested sales-floor order', () => {
    expect(TRIAL_YAHATAHIGASHI_CATEGORY_ORDER).toEqual([
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
    ])
  })

  it('sorts categories with fruits first, soy second, vegetables third, and frozen last', () => {
    const items = [...TRIAL_YAHATAHIGASHI_CATEGORY_ORDER]
      .reverse()
      .map((categoryId) => createItem(categoryId, categoryId))

    expect(items.sort(compareItemsByStoreOrder).map((item) => item.categoryIdSnapshot)).toEqual(
      TRIAL_YAHATAHIGASHI_CATEGORY_ORDER,
    )
  })

  it('keeps items in sortOrderSnapshot order within a category', () => {
    const items = [
      createItem('third', 'fish', 30),
      createItem('first', 'fish', 10),
      createItem('second', 'fish', 20),
    ]

    expect(items.sort(compareItemsByStoreOrder).map((item) => item.id)).toEqual([
      'first',
      'second',
      'third',
    ])
  })

  it('uses the product name as a stable final comparison', () => {
    const items = [
      createItem('banana', 'fruits', 10, 'バナナ'),
      createItem('apple', 'fruits', 10, 'りんご'),
    ]

    expect(items.sort(compareItemsByStoreOrder).map((item) => item.productNameSnapshot)).toEqual([
      'バナナ',
      'りんご',
    ])
  })

  it('treats unknown legacy categories like other and always keeps frozen after them', () => {
    const unknownOrder = getStoreCategoryOrder('legacy-custom-category')
    expect(unknownOrder).toBe(getStoreCategoryOrder('other'))

    const items = [
      createItem('frozen', 'frozen', 1),
      createItem('unknown', 'legacy-custom-category', 2),
      createItem('other', 'other', 1),
      createItem('baby', 'baby', 100),
    ]

    expect(items.sort(compareItemsByStoreOrder).map((item) => item.id)).toEqual([
      'baby',
      'other',
      'unknown',
      'frozen',
    ])
  })

  it('uses category snapshots from existing payloads without requiring current master data', () => {
    const legacyPayloadItems = [
      createItem('legacy-frozen', 'frozen', 1, '旧URLの冷凍食品'),
      createItem('legacy-fruit', 'fruits', 9999, '旧URLの果物'),
      createItem('legacy-soy', 'soy', 500, '旧URLの大豆製品'),
    ]

    expect(
      legacyPayloadItems.sort(compareItemsByStoreOrder).map((item) => item.productNameSnapshot),
    ).toEqual(['旧URLの果物', '旧URLの大豆製品', '旧URLの冷凍食品'])
  })
})
