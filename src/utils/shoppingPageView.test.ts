import { describe, expect, it } from 'vitest'
import type {
  CheckedStateMap,
  ConsultationMap,
  ShoppingRequestItemPayload,
} from '../types/shopping'
import {
  groupVisibleItems,
  selectShoppingPageView,
} from './shoppingPageView'

function createItem(
  id: string,
  categoryIdSnapshot: string,
  categoryNameSnapshot: string,
  sortOrderSnapshot: number,
  memo = '',
): ShoppingRequestItemPayload {
  return {
    id,
    productId: id,
    productNameSnapshot: id,
    categoryIdSnapshot,
    categoryNameSnapshot,
    quantity: 1,
    unit: '個',
    ...(memo ? { memo } : {}),
    iconSnapshot: '🛒',
    sortOrderSnapshot,
  }
}

const pendingItem = createItem('pending', 'fruits', '果物', 50)
const consultingItem = createItem('consulting', 'vegetables', '野菜', 10)
const notBuyingItem = createItem('not-buying', 'other', 'その他', 40)
const cartItem = createItem('cart', 'frozen', '冷凍食品', 30, '条件あり')
const verifiedItem = createItem('verified', 'soy', '大豆製品', 20)

const sourceItems = [
  cartItem,
  notBuyingItem,
  pendingItem,
  consultingItem,
  verifiedItem,
]

const checkedState: CheckedStateMap = {
  [consultingItem.id]: 'consulting',
  [notBuyingItem.id]: 'notBuying',
  [cartItem.id]: 'inCart',
  [verifiedItem.id]: 'verified',
}
const consultations: ConsultationMap = {
  [consultingItem.id]: {
    itemId: consultingItem.id,
    reason: 'notFound',
    status: 'queued',
  },
}

describe('shopping page view selectors', () => {
  it('derives snapshot order, sales-floor order, status groups, checkout order, and counts', () => {
    const originalIds = sourceItems.map((item) => item.id)

    const view = selectShoppingPageView({
      items: sourceItems,
      checkedState,
      consultations,
      cartOrder: [verifiedItem.id, cartItem.id],
      filterMode: 'all',
    })

    expect(view.sortedItems.map((item) => item.id)).toEqual([
      consultingItem.id,
      verifiedItem.id,
      cartItem.id,
      notBuyingItem.id,
      pendingItem.id,
    ])
    expect(view.storeOrderedItems.map((item) => item.id)).toEqual([
      pendingItem.id,
      verifiedItem.id,
      consultingItem.id,
      notBuyingItem.id,
      cartItem.id,
    ])
    expect(view.remainingItems.map((item) => item.id)).toEqual([
      pendingItem.id,
      consultingItem.id,
    ])
    expect(view.cartItems.map((item) => item.id)).toEqual([
      cartItem.id,
      verifiedItem.id,
    ])
    expect(view.consultationItems.map(({ item }) => item.id)).toEqual([
      consultingItem.id,
    ])
    expect(view.notBuyingItems.map((item) => item.id)).toEqual([
      notBuyingItem.id,
    ])
    expect(view.visibleItems.map((item) => item.id)).toEqual(
      view.storeOrderedItems.map((item) => item.id),
    )
    expect(view.completionState).toEqual({
      pendingCount: 1,
      consultingCount: 1,
      needsVerificationCount: 1,
      purchasedCount: 2,
      notBuyingCount: 1,
      canFinish: false,
    })
    expect(view.unresolvedCount).toBe(3)
    expect(sourceItems.map((item) => item.id)).toEqual(originalIds)
  })

  it('shows and groups only pending and consulting items in remaining mode', () => {
    const view = selectShoppingPageView({
      items: sourceItems,
      checkedState,
      consultations,
      cartOrder: [],
      filterMode: 'remaining',
    })

    expect(view.visibleItems.map((item) => item.id)).toEqual([
      pendingItem.id,
      consultingItem.id,
    ])
    expect(view.groupedVisibleItems).toEqual([
      { id: 'fruits', name: '果物', items: [pendingItem] },
      { id: 'vegetables', name: '野菜', items: [consultingItem] },
    ])
  })

  it('keeps a purchased item visible in remaining mode while its consultation is unresolved', () => {
    const view = selectShoppingPageView({
      items: [verifiedItem],
      checkedState: { [verifiedItem.id]: 'verified' },
      consultations: {
        [verifiedItem.id]: {
          itemId: verifiedItem.id,
          reason: 'notFound',
          status: 'shared',
        },
      },
      cartOrder: [verifiedItem.id],
      filterMode: 'remaining',
    })

    expect(view.remainingItems).toEqual([verifiedItem])
    expect(view.completionState.purchasedCount).toBe(1)
    expect(view.completionState.consultingCount).toBe(1)
    expect(view.unresolvedCount).toBe(1)
  })

  it('keeps same-category items together and reports a fully resolved request', () => {
    const secondFruit = createItem('second-fruit', 'fruits', '果物', 60)
    expect(groupVisibleItems([pendingItem, secondFruit])).toEqual([
      {
        id: 'fruits',
        name: '果物',
        items: [pendingItem, secondFruit],
      },
    ])

    const resolvedState: CheckedStateMap = {
      [pendingItem.id]: 'notBuying',
      [consultingItem.id]: 'notBuying',
      [notBuyingItem.id]: 'notBuying',
      [cartItem.id]: 'verified',
      [verifiedItem.id]: 'verified',
    }
    const resolvedView = selectShoppingPageView({
      items: sourceItems,
      checkedState: resolvedState,
      cartOrder: [cartItem.id, verifiedItem.id],
      filterMode: 'remaining',
    })

    expect(resolvedView.remainingItems).toEqual([])
    expect(resolvedView.groupedVisibleItems).toEqual([])
    expect(resolvedView.unresolvedCount).toBe(0)
    expect(resolvedView.completionState.canFinish).toBe(true)
  })
})
