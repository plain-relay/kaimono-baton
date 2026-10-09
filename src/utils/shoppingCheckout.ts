import type {
  LiveRequestPendingChange,
  LiveRequestSnapshot,
} from '../features/liveRequests/types'
import type { LiveRequestSyncStatus } from '../features/liveRequests/useLiveRequestSync'
import { liveRequestToShoppingPayload } from '../features/liveRequests/shopping'
import type {
  CheckedStateMap,
  ConsultationMap,
  ShoppingRequestItemPayload,
} from '../types/shopping'
import { getShoppingCompletionState } from './shoppingState'

type LiveCheckoutState = {
  snapshot?: LiveRequestSnapshot
  status: LiveRequestSyncStatus
  pendingChanges: readonly LiveRequestPendingChange[]
}

type ShoppingCheckoutInput = {
  requestId: string | undefined
  items: ShoppingRequestItemPayload[]
  checkedState: CheckedStateMap
  consultations: ConsultationMap
  live?: LiveCheckoutState
  allowUnconfirmedLive?: boolean
}

export type ShoppingCheckoutDecision =
  | {
      outcome: 'blocked'
      reason: 'request-changed' | 'changes-pending' | 'sync-in-progress' | 'items-unresolved'
    }
  | { outcome: 'offline-confirmation-required' }
  | { outcome: 'finish'; latestConfirmed: boolean }

// Reads supplied snapshots only. Refreshing and explicit offline consent belong
// to the page; the caller must provide current purchase progress after refresh.
export function getShoppingCheckoutDecision({
  requestId,
  items,
  checkedState,
  consultations,
  live,
  allowUnconfirmedLive = false,
}: ShoppingCheckoutInput): ShoppingCheckoutDecision {
  if (live) {
    if (live.snapshot?.requestId !== requestId) {
      return { outcome: 'blocked', reason: 'request-changed' }
    }
    if (live.pendingChanges.length > 0) {
      return { outcome: 'blocked', reason: 'changes-pending' }
    }
    // Preserve the refresh path's prompt before evaluating purchase progress.
    if (!allowUnconfirmedLive && live.status !== 'current') {
      return { outcome: 'offline-confirmation-required' }
    }
    if (live.status === 'checking' || live.status === 'loading') {
      return { outcome: 'blocked', reason: 'sync-in-progress' }
    }
  }

  const latestItems = live?.snapshot
    ? liveRequestToShoppingPayload(live.snapshot).items.filter(
        (item) => item.liveLifecycle !== 'cancelled-by-requester',
      )
    : items
  if (!getShoppingCompletionState(latestItems, checkedState, consultations).canFinish) {
    return { outcome: 'blocked', reason: 'items-unresolved' }
  }
  return { outcome: 'finish', latestConfirmed: !live || live.status === 'current' }
}
