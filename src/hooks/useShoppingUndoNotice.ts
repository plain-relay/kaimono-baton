import { useCallback, useEffect, useRef, useState } from 'react'
import type { ShoppingStateChange } from '../types/shopping'

export type ShoppingUndoNoticeState = {
  change: ShoppingStateChange
  message: string
  previousCartOrder: string[]
}

const UNDO_NOTICE_DURATION_MS = 5_000

export function useShoppingUndoNotice() {
  const [undoNotice, setUndoNotice] =
    useState<ShoppingUndoNoticeState | null>(null)
  const undoNoticeRef = useRef<ShoppingUndoNoticeState | null>(null)
  const undoTimerRef = useRef<number | null>(null)

  const clearTimer = useCallback(() => {
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current)
      undoTimerRef.current = null
    }
  }, [])

  const clearUndoNotice = useCallback(() => {
    clearTimer()
    undoNoticeRef.current = null
    setUndoNotice(null)
  }, [clearTimer])

  const showUndoNotice = useCallback(
    (nextUndoNotice: ShoppingUndoNoticeState) => {
      clearTimer()
      undoNoticeRef.current = nextUndoNotice
      setUndoNotice(nextUndoNotice)

      const timerId = window.setTimeout(() => {
        if (undoNoticeRef.current === nextUndoNotice) {
          undoNoticeRef.current = null
          setUndoNotice(null)
        }
        if (undoTimerRef.current === timerId) {
          undoTimerRef.current = null
        }
      }, UNDO_NOTICE_DURATION_MS)
      undoTimerRef.current = timerId
    },
    [clearTimer],
  )

  const consumeUndoNotice = useCallback(() => {
    const currentUndoNotice = undoNoticeRef.current
    clearUndoNotice()
    return currentUndoNotice
  }, [clearUndoNotice])

  useEffect(
    () => () => {
      clearTimer()
      undoNoticeRef.current = null
    },
    [clearTimer],
  )

  return {
    undoNotice,
    showUndoNotice,
    consumeUndoNotice,
    clearUndoNotice,
  }
}
