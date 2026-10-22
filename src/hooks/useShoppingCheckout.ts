import { useRef, useState } from 'react'
import type { useLiveRequestSync } from '../features/liveRequests/useLiveRequestSync'
import type { ConsultationMap, ShoppingRequestItemPayload } from '../types/shopping'
import { getShoppingCheckoutDecision } from '../utils/shoppingCheckout'
import type { ShoppingStateSnapshot } from '../utils/shoppingState'
import type { ShareNotice } from './useShoppingResultSharing'

export function useShoppingCheckout({ requestId, getItems, liveRequestToken, liveSync, getCurrentShoppingState, getCurrentConsultations, setShareNotice }: {
  requestId?: string
  getItems: () => ShoppingRequestItemPayload[]
  liveRequestToken?: string
  liveSync: ReturnType<typeof useLiveRequestSync>
  getCurrentShoppingState: () => ShoppingStateSnapshot
  getCurrentConsultations: () => ConsultationMap
  setShareNotice: (notice: ShareNotice | null) => void
}) {
  const [isCheckoutReviewOpen, setIsCheckoutReviewOpen] = useState(false)
  const [isCompletionView, setIsCompletionView] = useState(false)
  const [isCheckingCheckout, setIsCheckingCheckout] = useState(false)
  const [showOfflineFinishChoice, setShowOfflineFinishChoice] = useState(false)
  const checkoutCheckRef = useRef(false)
  const checkoutReviewRef = useRef<HTMLElement | null>(null)
  const completionHeadingRef = useRef<HTMLHeadingElement | null>(null)
  const handleOpenCheckoutReview = async () => {
    setIsCheckoutReviewOpen(true)
    window.requestAnimationFrame(() => {
      checkoutReviewRef.current?.focus()
      checkoutReviewRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    })
    if (liveRequestToken && !checkoutCheckRef.current) {
      checkoutCheckRef.current = true
      setIsCheckingCheckout(true)
      setShowOfflineFinishChoice(false)
      try {
        await liveSync.refresh()
      } finally {
        checkoutCheckRef.current = false
        setIsCheckingCheckout(false)
      }
    }
  }

  const finishWithCurrentList = () => {
    const current = liveSync.getCurrentState()
    const decision = getShoppingCheckoutDecision({
      requestId: requestId,
      items: getItems(),
      checkedState: getCurrentShoppingState().checkedState,
      consultations: getCurrentConsultations(),
      live: liveRequestToken ? current : undefined,
      // Called after a successful freshness check or an explicit offline choice.
      allowUnconfirmedLive: true,
    })
    if (decision.outcome !== 'finish') {
      return
    }

    setShareNotice(!decision.latestConfirmed
      ? { kind: 'info', message: '最新の依頼は未確認です。保存済みのリストで買い物を終了しました。' }
      : null)
    setIsCompletionView(true)
    window.requestAnimationFrame(() => {
      completionHeadingRef.current?.focus()
      window.scrollTo({ top: 0, behavior: 'smooth' })
    })
  }

  const handleFinishShopping = async () => {
    if (!liveRequestToken) {
      finishWithCurrentList()
      return
    }
    if (checkoutCheckRef.current) return
    const expectedRequestId = requestId
    checkoutCheckRef.current = true
    setIsCheckingCheckout(true)
    setShowOfflineFinishChoice(false)
    try {
      const current = await liveSync.refresh()
      const decision = getShoppingCheckoutDecision({
        requestId: expectedRequestId,
        items: getItems(),
        checkedState: getCurrentShoppingState().checkedState,
        consultations: getCurrentConsultations(),
        live: current,
      })
      if (decision.outcome === 'blocked') {
        if (decision.reason === 'changes-pending') {
          setShareNotice({kind: 'info', message: '新しい変更があります。内容を確認してから終了してください。'})
        }
        return
      }
      if (decision.outcome === 'offline-confirmation-required') {
        setShowOfflineFinishChoice(true)
        return
      }
      finishWithCurrentList()
    } finally {
      checkoutCheckRef.current = false
      setIsCheckingCheckout(false)
    }
  }


  return { isCheckoutReviewOpen, setIsCheckoutReviewOpen, isCompletionView, setIsCompletionView,
    isCheckingCheckout, showOfflineFinishChoice, setShowOfflineFinishChoice,
    checkoutReviewRef, completionHeadingRef, handleOpenCheckoutReview, handleFinishShopping, finishWithCurrentList }
}
