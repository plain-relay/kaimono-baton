import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { shareText, type NativeShareResult } from '../utils/shareText'
import type { ConsultationShareLock } from './useConsultationWorkflow'

export type ShareNotice = {
  kind: 'success' | 'error' | 'info'
  message: string
}

function getResultShareNotice(result: NativeShareResult): ShareNotice {
  if (result === 'shared') {
    return {
      kind: 'success',
      message:
        '共有画面を開きました。\nLINEを選択して結果を送信してください。',
    }
  }

  if (result === 'copied') {
    return {
      kind: 'success',
      message:
        'OS共有を利用できなかったため、結果をコピーしました。\nLINEへ貼り付けるか、外部ブラウザで開いて共有してください。',
    }
  }

  if (result === 'cancelled') {
    return {
      kind: 'info',
      message:
        '結果の共有をキャンセルしました。買い物結果はそのまま残っています。',
    }
  }

  return {
    kind: 'error',
    message:
      '結果を共有またはコピーできませんでした。\n買い物結果はそのまま残っています。外部ブラウザで開いてもう一度お試しください。',
  }
}

export function useShoppingResultSharing(setShareNotice: (notice: ShareNotice | null) => void) {
  const [isSharingResult, setIsSharingResult] = useState(false)
  const activeShareRef = useRef(false)
  const resultShareGenerationRef = useRef(0)
  const shouldPublishResultNoticeRef = useRef(false)
  const consultationShareLock = useMemo<ConsultationShareLock>(
    () => ({
      tryAcquire: () => {
        if (activeShareRef.current) {
          return false
        }
        activeShareRef.current = true
        return true
      },
      release: () => {
        activeShareRef.current = false
      },
    }),
    [],
  )


  const invalidateResultSharing = useCallback(() => {
    resultShareGenerationRef.current += 1
    shouldPublishResultNoticeRef.current = false
    activeShareRef.current = false
  }, [])
  const resetResultSharing = useCallback(() => {
    invalidateResultSharing()
    setIsSharingResult(false)
  }, [invalidateResultSharing])
  const cancelResultShareNotice = useCallback(() => {
    shouldPublishResultNoticeRef.current = false
  }, [])
  useEffect(() => invalidateResultSharing, [invalidateResultSharing])
  const shareResult = async (text: string) => {
    if (activeShareRef.current) {
      return
    }

    const shareGeneration = resultShareGenerationRef.current
    activeShareRef.current = true
    shouldPublishResultNoticeRef.current = true
    setIsSharingResult(true)
    try {
      const result = await shareText({
        title: 'おつかい結果',
        text,
      })
      if (
        shareGeneration !== resultShareGenerationRef.current ||
        !shouldPublishResultNoticeRef.current
      ) {
        return
      }

      setShareNotice(getResultShareNotice(result))
    } finally {
      if (shareGeneration === resultShareGenerationRef.current) {
        shouldPublishResultNoticeRef.current = false
        activeShareRef.current = false
        setIsSharingResult(false)
      }
    }
  }


  return { isSharingResult, shareResult, consultationShareLock, resetResultSharing, cancelResultShareNotice }
}
