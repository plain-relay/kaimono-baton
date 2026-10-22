import { useEffect, useState } from 'react'
import { liveRequestToShoppingPayload } from '../features/liveRequests/shopping'
import type { useLiveRequestSync } from '../features/liveRequests/useLiveRequestSync'
import type { CheckedItemStatus, ItemIssue, ShoppingRequestItemPayload, ShoppingRequestPayload } from '../types/shopping'
import type { ShoppingStateSnapshot } from '../utils/shoppingState'
import { getItemStatus, hasCondition } from '../utils/shoppingState'
import type { ShareNotice } from './useShoppingResultSharing'

type CartConfirmationState = {
  itemId: string
  needsQuantityConfirmation: boolean
  needsConditionConfirmation: boolean
  quantityConfirmed: boolean
  conditionConfirmed: boolean
  isConditionFollowUp: boolean
  itemSnapshot: string
  isLiveChangeReview: boolean
}

export function confirmationSnapshot(item: ShoppingRequestItemPayload): string {
  return JSON.stringify([item.id, item.quantity, item.memo ?? '', item.liveLifecycle, item.liveUpdatedRevision])
}


export function useCartConfirmation({ payload, liveRequestToken, liveSync, getCurrentShoppingState, commitShoppingChange, closeConsultation, setShareNotice }: {
  payload: ShoppingRequestPayload | null
  liveRequestToken?: string
  liveSync: ReturnType<typeof useLiveRequestSync>
  getCurrentShoppingState: () => ShoppingStateSnapshot
  commitShoppingChange: (itemId: string, status: CheckedItemStatus, issue?: ItemIssue) => boolean
  closeConsultation: () => void
  setShareNotice: (notice: ShareNotice | null) => void
}) {
  const [cartConfirmation, setCartConfirmation] = useState<CartConfirmationState | null>(null)
  useEffect(() => {
    if (!liveRequestToken || !liveSync.snapshot || !cartConfirmation) return
    const item = liveRequestToShoppingPayload(liveSync.snapshot).items.find(
      (candidate) => candidate.id === cartConfirmation.itemId,
    )
    if (!item || item.liveLifecycle === 'cancelled-by-requester' ||
        confirmationSnapshot(item) !== cartConfirmation.itemSnapshot) {
      setCartConfirmation(null)
      setShareNotice({kind: 'info', message: '確認中の商品が変更・取消されました。最新の内容を確認してください。'})
    }
  }, [cartConfirmation, liveRequestToken, liveSync.snapshot])

  const handleOpenCartConfirmation = (
    item: ShoppingRequestItemPayload,
    isConditionFollowUp = false,
  ) => {
    const isLiveChangeReview = Boolean(liveRequestToken) &&
      liveSync.getCurrentState().pendingChanges.some((change) =>
        change.itemId === item.id,
      ) && (getItemStatus(getCurrentShoppingState().checkedState, item.id) === 'inCart' ||
        getItemStatus(getCurrentShoppingState().checkedState, item.id) === 'verified')
    const needsQuantityConfirmation =
      isLiveChangeReview || (!isConditionFollowUp && item.quantity >= 2)
    const needsConditionConfirmation = hasCondition(item)

    if (!needsQuantityConfirmation && !needsConditionConfirmation) {
      commitShoppingChange(item.id, 'inCart')
      liveSync.acknowledgeChanges(item.id, item.liveUpdatedRevision)
      return
    }

    closeConsultation()
    setShareNotice(null)
    setCartConfirmation({
      itemId: item.id,
      needsQuantityConfirmation,
      needsConditionConfirmation,
      quantityConfirmed: false,
      conditionConfirmed: false,
      isConditionFollowUp,
      itemSnapshot: confirmationSnapshot(item),
      isLiveChangeReview,
    })
  }

  const handleConfirmCart = () => {
    if (!cartConfirmation) {
      return
    }
    if (liveRequestToken) {
      const snapshot = liveSync.getCurrentState().snapshot
      const item = snapshot ? liveRequestToShoppingPayload(snapshot).items.find(
        (candidate) => candidate.id === cartConfirmation.itemId,
      ) : undefined
      if (!item || item.liveLifecycle === 'cancelled-by-requester' ||
          confirmationSnapshot(item) !== cartConfirmation.itemSnapshot) {
        setCartConfirmation(null)
        return
      }
    }
    if (
      (cartConfirmation.needsQuantityConfirmation &&
        !cartConfirmation.quantityConfirmed) ||
      (cartConfirmation.needsConditionConfirmation &&
        !cartConfirmation.conditionConfirmed)
    ) {
      return
    }

    commitShoppingChange(
      cartConfirmation.itemId,
      cartConfirmation.needsConditionConfirmation ? 'verified' : 'inCart',
    )
    const item = payload?.items.find((candidate) => candidate.id === cartConfirmation.itemId)
    liveSync.acknowledgeChanges(cartConfirmation.itemId, item?.liveUpdatedRevision)
    setCartConfirmation(null)
  }


  return { cartConfirmation, setCartConfirmation, handleOpenCartConfirmation, handleConfirmCart }
}
