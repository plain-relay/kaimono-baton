import type {
  CartOrderList,
  CheckedItemStatus,
  CheckedStateMap,
  CheckedStatusChange,
  ConsultationMap,
  ItemIssue,
  ItemIssueMap,
  ShoppingRequestItemPayload,
  ShoppingStateChange,
  UnavailableReason,
} from '../types/shopping'

const VALID_CHECKED_STATUSES = new Set<CheckedItemStatus>([
  'pending',
  'inCart',
  'verified',
  'consulting',
  'notBuying',
])

const VALID_UNAVAILABLE_REASONS = new Set<UnavailableReason>([
  'soldOut',
  'notFound',
  'conditionMismatch',
  'poorCondition',
  'other',
])

export type ShoppingCompletionState = {
  pendingCount: number
  consultingCount: number
  needsVerificationCount: number
  purchasedCount: number
  notBuyingCount: number
  canFinish: boolean
}

export type ShoppingStateSnapshot = {
  checkedState: CheckedStateMap
  itemIssues: ItemIssueMap
  cartOrder: CartOrderList
}

export type ShoppingStateChangeDirection = 'forward' | 'undo'

export function isCheckedItemStatus(value: unknown): value is CheckedItemStatus {
  return typeof value === 'string' && VALID_CHECKED_STATUSES.has(value as CheckedItemStatus)
}

export function isUnavailableReason(value: unknown): value is UnavailableReason {
  return typeof value === 'string' && VALID_UNAVAILABLE_REASONS.has(value as UnavailableReason)
}

export function isCartStatus(status: CheckedItemStatus): boolean {
  return status === 'inCart' || status === 'verified'
}

export function keepsItemIssue(status: CheckedItemStatus): boolean {
  return status === 'consulting' || status === 'notBuying'
}

export function normalizeCheckedState(value: unknown): CheckedStateMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  const normalized: CheckedStateMap = {}
  for (const [itemId, status] of Object.entries(value)) {
    if (isCheckedItemStatus(status)) {
      normalized[itemId] = status
    }
  }

  return normalized
}

export function normalizeItemIssue(value: unknown): ItemIssue | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  const { reason, note } = value as { reason?: unknown; note?: unknown }
  if (!isUnavailableReason(reason)) {
    return undefined
  }

  const normalizedNote = typeof note === 'string' ? note.trim() : ''
  return normalizedNote ? { reason, note: normalizedNote } : { reason }
}

export function normalizeItemIssues(value: unknown): ItemIssueMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  const normalized: ItemIssueMap = {}
  for (const [itemId, issue] of Object.entries(value)) {
    const normalizedIssue = normalizeItemIssue(issue)
    if (normalizedIssue) {
      normalized[itemId] = normalizedIssue
    }
  }

  return normalized
}

export function reconcileItemIssues(
  itemIssues: ItemIssueMap,
  checkedState: CheckedStateMap,
): ItemIssueMap {
  const normalizedIssues = normalizeItemIssues(itemIssues)
  const normalized: ItemIssueMap = {}

  for (const [itemId, issue] of Object.entries(normalizedIssues)) {
    if (keepsItemIssue(getItemStatus(checkedState, itemId))) {
      normalized[itemId] = issue
    }
  }

  return normalized
}

export function reconcileCheckedStateWithIssues(
  checkedState: CheckedStateMap,
  itemIssues: ItemIssueMap,
): CheckedStateMap {
  const normalizedCheckedState = normalizeCheckedState(checkedState)
  const normalizedIssues = normalizeItemIssues(itemIssues)
  const reconciled: CheckedStateMap = {}

  for (const [itemId, status] of Object.entries(normalizedCheckedState)) {
    if (keepsItemIssue(status) && !normalizedIssues[itemId]) {
      continue
    }

    reconciled[itemId] = status
  }

  return reconciled
}

export function normalizeCartOrder(value: unknown): CartOrderList {
  if (!Array.isArray(value)) {
    return []
  }

  const seen = new Set<string>()
  const normalized: CartOrderList = []

  for (const itemId of value) {
    if (typeof itemId === 'string' && !seen.has(itemId)) {
      seen.add(itemId)
      normalized.push(itemId)
    }
  }

  return normalized
}

export function addToCartOrder(order: CartOrderList, itemId: string): CartOrderList {
  const normalized = normalizeCartOrder(order)
  return normalized.includes(itemId) ? normalized : [...normalized, itemId]
}

export function removeFromCartOrder(order: CartOrderList, itemId: string): CartOrderList {
  return normalizeCartOrder(order).filter((currentItemId) => currentItemId !== itemId)
}

export function updateCartOrderForStatusChange(
  order: CartOrderList,
  itemId: string,
  previousStatus: CheckedItemStatus,
  nextStatus: CheckedItemStatus,
): CartOrderList {
  if (isCartStatus(nextStatus)) {
    return isCartStatus(previousStatus) ? normalizeCartOrder(order) : addToCartOrder(order, itemId)
  }

  return removeFromCartOrder(order, itemId)
}

export function getItemStatus(
  checkedState: CheckedStateMap,
  itemId: string,
): CheckedItemStatus {
  const status = checkedState[itemId]
  return isCheckedItemStatus(status) ? status : 'pending'
}

export function createCheckedStatusChange(
  checkedState: CheckedStateMap,
  itemId: string,
  nextStatus: CheckedItemStatus,
): CheckedStatusChange | null {
  const previousStatus = getItemStatus(checkedState, itemId)
  if (previousStatus === nextStatus) {
    return null
  }

  return { itemId, previousStatus, nextStatus }
}

function issuesEqual(first?: ItemIssue, second?: ItemIssue): boolean {
  return first?.reason === second?.reason && first?.note === second?.note
}

export function createShoppingStateChange(
  checkedState: CheckedStateMap,
  itemIssues: ItemIssueMap,
  itemId: string,
  nextStatus: CheckedItemStatus,
  nextIssue?: ItemIssue,
): ShoppingStateChange | null {
  const previousStatus = getItemStatus(checkedState, itemId)
  const previousIssue = normalizeItemIssue(itemIssues[itemId])
  const suppliedNextIssue = normalizeItemIssue(nextIssue)
  const resolvedNextIssue = keepsItemIssue(nextStatus)
    ? suppliedNextIssue ?? (keepsItemIssue(previousStatus) ? previousIssue : undefined)
    : undefined

  if (previousStatus === nextStatus && issuesEqual(previousIssue, resolvedNextIssue)) {
    return null
  }

  return {
    itemId,
    previousStatus,
    nextStatus,
    ...(previousIssue ? { previousIssue } : {}),
    ...(resolvedNextIssue ? { nextIssue: resolvedNextIssue } : {}),
  }
}

export function applyShoppingStateChange(
  state: ShoppingStateSnapshot,
  change: ShoppingStateChange,
  direction: ShoppingStateChangeDirection = 'forward',
): ShoppingStateSnapshot {
  const usePrevious = direction === 'undo'
  const sourceStatus = usePrevious ? change.nextStatus : change.previousStatus
  const targetStatus = usePrevious ? change.previousStatus : change.nextStatus
  const targetIssue = normalizeItemIssue(usePrevious ? change.previousIssue : change.nextIssue)
  const checkedState = {
    ...normalizeCheckedState(state.checkedState),
    [change.itemId]: targetStatus,
  }
  const itemIssues = { ...normalizeItemIssues(state.itemIssues) }

  if (keepsItemIssue(targetStatus) && targetIssue) {
    itemIssues[change.itemId] = targetIssue
  } else {
    delete itemIssues[change.itemId]
  }

  let nextCartOrder = updateCartOrderForStatusChange(
    state.cartOrder,
    change.itemId,
    sourceStatus,
    targetStatus,
  )

  if (
    direction === 'undo' &&
    isCartStatus(targetStatus) &&
    !nextCartOrder.includes(change.itemId)
  ) {
    nextCartOrder = addToCartOrder(nextCartOrder, change.itemId)
  }

  return {
    checkedState,
    itemIssues,
    cartOrder: nextCartOrder,
  }
}

export function hasCondition(item: ShoppingRequestItemPayload): boolean {
  return Boolean(item.memo?.trim())
}

export function getShoppingCompletionState(
  items: ShoppingRequestItemPayload[],
  checkedState: CheckedStateMap,
  consultations: ConsultationMap = {},
): ShoppingCompletionState {
  let pendingCount = 0
  let needsVerificationCount = 0
  let purchasedCount = 0
  let notBuyingCount = 0
  const itemIds = new Set(items.map((item) => item.id))
  const unresolvedConsultationIds = new Set(
    Object.entries(consultations)
      .filter(
        ([itemId, consultation]) =>
          itemIds.has(itemId) &&
          consultation.itemId === itemId &&
          (consultation.status === 'queued' || consultation.status === 'shared'),
      )
      .map(([itemId]) => itemId),
  )

  for (const item of items) {
    const status = getItemStatus(checkedState, item.id)

    if (status === 'pending') {
      pendingCount += 1
    } else if (status === 'consulting') {
      unresolvedConsultationIds.add(item.id)
    } else if (status === 'notBuying') {
      notBuyingCount += 1
    } else if (isCartStatus(status)) {
      purchasedCount += 1
    }

    if (status === 'inCart' && hasCondition(item)) {
      needsVerificationCount += 1
    }
  }

  return {
    pendingCount,
    consultingCount: unresolvedConsultationIds.size,
    needsVerificationCount,
    purchasedCount,
    notBuyingCount,
    canFinish:
      items.length > 0 &&
      pendingCount === 0 &&
      unresolvedConsultationIds.size === 0 &&
      needsVerificationCount === 0,
  }
}

function getCartItemGroups(
  items: ShoppingRequestItemPayload[],
  checkedState: CheckedStateMap,
  cartOrder: CartOrderList,
): {
  orderedItems: ShoppingRequestItemPayload[]
  fallbackItems: ShoppingRequestItemPayload[]
} {
  const itemById = new Map(items.map((item) => [item.id, item]))
  const orderedItemIds = normalizeCartOrder(cartOrder)
  const addedItemIds = new Set<string>()
  const orderedItems: ShoppingRequestItemPayload[] = []

  for (const itemId of orderedItemIds) {
    const item = itemById.get(itemId)
    if (!item || !isCartStatus(getItemStatus(checkedState, item.id))) {
      continue
    }

    addedItemIds.add(item.id)
    orderedItems.push(item)
  }

  const fallbackItems = items
    .filter(
      (item) =>
        isCartStatus(getItemStatus(checkedState, item.id)) && !addedItemIds.has(item.id),
    )
    .sort((a, b) => a.sortOrderSnapshot - b.sortOrderSnapshot)

  return { orderedItems, fallbackItems }
}

/** Returns purchased items in the persisted, oldest-first cart order. */
export function getCartItemsInCartOrder(
  items: ShoppingRequestItemPayload[],
  checkedState: CheckedStateMap,
  cartOrder: CartOrderList,
): ShoppingRequestItemPayload[] {
  const { orderedItems, fallbackItems } = getCartItemGroups(items, checkedState, cartOrder)
  return [...orderedItems, ...fallbackItems]
}

/**
 * Returns purchased items for checkout review. Persisted entries are newest first;
 * items missing from legacy cartOrder data keep the existing sales-floor sort order.
 */
export function getCartItemsForCheckout(
  items: ShoppingRequestItemPayload[],
  checkedState: CheckedStateMap,
  cartOrder: CartOrderList,
): ShoppingRequestItemPayload[] {
  const { orderedItems, fallbackItems } = getCartItemGroups(items, checkedState, cartOrder)
  return [...[...orderedItems].reverse(), ...fallbackItems]
}
