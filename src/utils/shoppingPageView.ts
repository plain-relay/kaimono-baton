import type {
  CartOrderList,
  CheckedStateMap,
  ConsultationEntry,
  ConsultationMap,
  ShoppingRequestItemPayload,
} from '../types/shopping'
import { isUnresolvedConsultation } from './consultationState'
import {
  getCartItemsForCheckout,
  getItemStatus,
  getShoppingCompletionState,
  hasCondition,
} from './shoppingState'
import { compareItemsByStoreOrder } from './storeOrder'

export type ShoppingFilterMode = 'remaining' | 'all'

export type ShoppingItemGroup = {
  id: string
  name: string
  items: ShoppingRequestItemPayload[]
}

export type ShoppingConsultationItem = {
  item: ShoppingRequestItemPayload
  consultation: ConsultationEntry
}

export function selectSnapshotSortedItems(
  items: readonly ShoppingRequestItemPayload[],
): ShoppingRequestItemPayload[] {
  return [...items].sort(
    (left, right) => left.sortOrderSnapshot - right.sortOrderSnapshot,
  )
}

export function selectStoreOrderedItems(
  items: readonly ShoppingRequestItemPayload[],
): ShoppingRequestItemPayload[] {
  return [...items].sort(compareItemsByStoreOrder)
}

export function selectRemainingItems(
  storeOrderedItems: readonly ShoppingRequestItemPayload[],
  checkedState: CheckedStateMap,
  consultations: ConsultationMap = {},
): ShoppingRequestItemPayload[] {
  return storeOrderedItems.filter((item) => {
    const status = getItemStatus(checkedState, item.id)
    return (
      status === 'pending' ||
      status === 'consulting' ||
      isUnresolvedConsultation(consultations[item.id])
    )
  })
}

export function selectItemsWithStatus(
  items: readonly ShoppingRequestItemPayload[],
  checkedState: CheckedStateMap,
  status: 'consulting' | 'notBuying',
): ShoppingRequestItemPayload[] {
  return items.filter((item) => getItemStatus(checkedState, item.id) === status)
}

export function selectConsultationItems(
  items: readonly ShoppingRequestItemPayload[],
  consultations: ConsultationMap,
): ShoppingConsultationItem[] {
  return items.flatMap((item) => {
    const consultation = consultations[item.id]
    return isUnresolvedConsultation(consultation)
      ? [{ item, consultation }]
      : []
  })
}

export function selectVisibleItems(
  filterMode: ShoppingFilterMode,
  storeOrderedItems: readonly ShoppingRequestItemPayload[],
  remainingItems: readonly ShoppingRequestItemPayload[],
): ShoppingRequestItemPayload[] {
  return [...(filterMode === 'all' ? storeOrderedItems : remainingItems)]
}

export function groupVisibleItems(
  visibleItems: readonly ShoppingRequestItemPayload[],
): ShoppingItemGroup[] {
  const groups = new Map<
    string,
    { name: string; items: ShoppingRequestItemPayload[] }
  >()

  for (const item of visibleItems) {
    const existing = groups.get(item.categoryIdSnapshot)

    if (existing) {
      existing.items.push(item)
    } else {
      groups.set(item.categoryIdSnapshot, {
        name: item.categoryNameSnapshot,
        items: [item],
      })
    }
  }

  return [...groups.entries()].map(([id, value]) => ({
    id,
    name: value.name,
    items: value.items,
  }))
}

type SelectShoppingPageViewInput = {
  items: readonly ShoppingRequestItemPayload[]
  checkedState: CheckedStateMap
  consultations?: ConsultationMap
  cartOrder: CartOrderList
  filterMode: ShoppingFilterMode
}

export function selectShoppingPageView({
  items,
  checkedState,
  consultations = {},
  cartOrder,
  filterMode,
}: SelectShoppingPageViewInput) {
  const sortedItems = selectSnapshotSortedItems(items)
  const storeOrderedItems = selectStoreOrderedItems(items)
  const remainingItems = selectRemainingItems(
    storeOrderedItems,
    checkedState,
    consultations,
  )
  const cartItems = getCartItemsForCheckout(
    sortedItems,
    checkedState,
    cartOrder,
  )
  const consultationItems = selectConsultationItems(sortedItems, consultations)
  const queuedConsultationItems = consultationItems.filter(
    ({ consultation }) => consultation.status === 'queued',
  )
  const notBuyingItems = selectItemsWithStatus(
    sortedItems,
    checkedState,
    'notBuying',
  )
  const visibleItems = selectVisibleItems(
    filterMode,
    storeOrderedItems,
    remainingItems,
  )
  const groupedVisibleItems = groupVisibleItems(visibleItems)
  const completionState = getShoppingCompletionState(
    sortedItems,
    checkedState,
    consultations,
  )
  const unresolvedItemIds = new Set(
    consultationItems.map(({ item }) => item.id),
  )
  for (const item of sortedItems) {
    const status = getItemStatus(checkedState, item.id)
    if (
      status === 'pending' ||
      status === 'consulting' ||
      (status === 'inCart' && hasCondition(item))
    ) {
      unresolvedItemIds.add(item.id)
    }
  }

  return {
    sortedItems,
    storeOrderedItems,
    remainingItems,
    cartItems,
    consultationItems,
    queuedConsultationItems,
    notBuyingItems,
    visibleItems,
    groupedVisibleItems,
    completionState,
    unresolvedCount: unresolvedItemIds.size,
  }
}
