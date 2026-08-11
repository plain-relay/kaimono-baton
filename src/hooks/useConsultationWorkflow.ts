import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ConsultationMap,
  ItemIssue,
  ShoppingRequestItemPayload,
  UnavailableReason,
} from '../types/shopping'
import {
  createConsultationEntry,
  getConsultationIssue,
} from '../utils/consultationState'
import {
  buildBulkConsultationMessage,
  buildIndividualConsultationMessage,
} from '../utils/shoppingMessages'
import type {
  NativeShareInput,
  NativeShareResult,
} from '../utils/shareText'

export type ConsultationDraft = {
  itemId: string
  reason?: UnavailableReason
  note: string
}

export type ConsultationShareNotice = {
  kind: 'success' | 'error' | 'info'
  message: string
}

export type ConsultationShareLock = {
  tryAcquire: () => boolean
  release: () => void
}

type ConsultationShareEntry = {
  item: ShoppingRequestItemPayload
  issue: ItemIssue
}

type ConsultationShareFunction = (
  input: NativeShareInput,
) => Promise<NativeShareResult>

type UseConsultationWorkflowInput = {
  sessionKey: string
  items: readonly ShoppingRequestItemPayload[]
  updateConsultations: (
    updater: (current: ConsultationMap) => ConsultationMap,
  ) => void
  getCurrentConsultations: () => ConsultationMap
  getItemIssue: (itemId: string) => ItemIssue | undefined
  share: ConsultationShareFunction
  shareLock: ConsultationShareLock
  onNotice: (notice: ConsultationShareNotice) => void
}

function createIssue(reason: UnavailableReason, note: string): ItemIssue {
  const trimmedNote = note.trim()
  return trimmedNote ? { reason, note: trimmedNote } : { reason }
}

function getConsultationShareNotice(
  result: NativeShareResult,
): ConsultationShareNotice {
  if (result === 'shared') {
    return {
      kind: 'success',
      message:
        '共有画面を開きました。\nLINEを選択して送信してください。',
    }
  }

  if (result === 'copied') {
    return {
      kind: 'success',
      message:
        'OS共有を利用できなかったため、相談文をコピーしました。\nLINEへ貼り付けるか、外部ブラウザで開いて共有してください。',
    }
  }

  if (result === 'cancelled') {
    return {
      kind: 'info',
      message: '共有をキャンセルしました。相談内容はそのまま残しています。',
    }
  }

  return {
    kind: 'error',
    message:
      '共有またはコピーができませんでした。\n相談内容はそのまま残しています。外部ブラウザで開いてもう一度お試しください。',
  }
}

export function useConsultationWorkflow({
  sessionKey,
  items,
  updateConsultations,
  getCurrentConsultations,
  getItemIssue,
  share,
  shareLock,
  onNotice,
}: UseConsultationWorkflowInput) {
  const [consultationDraft, setConsultationDraft] =
    useState<ConsultationDraft | null>(null)
  const [isSharingConsultation, setIsSharingConsultation] =
    useState(false)
  const [sharingConsultationItemId, setSharingConsultationItemId] =
    useState<string | null>(null)
  const draftRef = useRef<ConsultationDraft | null>(null)
  const itemsRef = useRef(items)
  const shareGenerationRef = useRef(0)
  const isShareActiveRef = useRef(false)
  const ownsShareLockRef = useRef(false)
  itemsRef.current = items

  const setCurrentDraft = useCallback(
    (nextDraft: ConsultationDraft | null) => {
      draftRef.current = nextDraft
      setConsultationDraft(nextDraft)
    },
    [],
  )

  const releaseOwnedShareLock = useCallback(() => {
    if (ownsShareLockRef.current) {
      ownsShareLockRef.current = false
      shareLock.release()
    }
  }, [shareLock])

  useEffect(() => {
    shareGenerationRef.current += 1
    isShareActiveRef.current = false
    releaseOwnedShareLock()
    setCurrentDraft(null)
    setIsSharingConsultation(false)
    setSharingConsultationItemId(null)
  }, [releaseOwnedShareLock, sessionKey, setCurrentDraft])

  useEffect(
    () => () => {
      shareGenerationRef.current += 1
      isShareActiveRef.current = false
      draftRef.current = null
      releaseOwnedShareLock()
    },
    [releaseOwnedShareLock],
  )

  const openConsultation = useCallback(
    (itemId: string) => {
      const consultationIssue = getConsultationIssue(
        getCurrentConsultations()[itemId],
      )
      const existingIssue = consultationIssue ?? getItemIssue(itemId)
      setCurrentDraft({
        itemId,
        reason: existingIssue?.reason,
        note: existingIssue?.note ?? '',
      })
    },
    [getCurrentConsultations, getItemIssue, setCurrentDraft],
  )

  const closeConsultation = useCallback(() => {
    setCurrentDraft(null)
  }, [setCurrentDraft])

  const setReason = useCallback(
    (reason: UnavailableReason) => {
      const currentDraft = draftRef.current
      if (currentDraft) {
        setCurrentDraft({ ...currentDraft, reason })
      }
    },
    [setCurrentDraft],
  )

  const setNote = useCallback(
    (note: string) => {
      const currentDraft = draftRef.current
      if (currentDraft) {
        setCurrentDraft({ ...currentDraft, note })
      }
    },
    [setCurrentDraft],
  )

  const getDraftIssue = useCallback(() => {
    const currentDraft = draftRef.current
    if (!currentDraft?.reason) {
      return null
    }

    return {
      itemId: currentDraft.itemId,
      issue: createIssue(currentDraft.reason, currentDraft.note),
    }
  }, [])

  const addToQueue = useCallback(() => {
    const draftIssue = getDraftIssue()
    if (!draftIssue) {
      return
    }

    updateConsultations((current) => ({
      ...current,
      [draftIssue.itemId]: createConsultationEntry(
        draftIssue.itemId,
        draftIssue.issue,
        'queued',
      ),
    }))
    setCurrentDraft(null)
    onNotice({
      kind: 'info',
      message: 'まとめ相談に追加しました。',
    })
  }, [getDraftIssue, onNotice, setCurrentDraft, updateConsultations])

  const performConsultationShare = useCallback(
    async (
      entries: ConsultationShareEntry[],
      mode: 'individual' | 'bulk',
    ) => {
      if (isShareActiveRef.current || entries.length === 0) {
        return
      }
      if (!shareLock.tryAcquire()) {
        onNotice({
          kind: 'info',
          message:
            '別の共有処理が進行中です。完了してからもう一度お試しください。',
        })
        return
      }

      const shareGeneration = shareGenerationRef.current
      const individualItemId =
        mode === 'individual' ? entries[0].item.id : null
      ownsShareLockRef.current = true
      isShareActiveRef.current = true
      setIsSharingConsultation(true)
      setSharingConsultationItemId(individualItemId)
      try {
        const consultationText =
          mode === 'individual'
            ? buildIndividualConsultationMessage(
                entries[0].item,
                entries[0].issue,
              )
            : buildBulkConsultationMessage(entries)
        const result = await share({
          title: 'おつかい相談',
          text: consultationText,
        })
        if (shareGeneration !== shareGenerationRef.current) {
          return
        }

        if (result === 'shared' || result === 'copied') {
          const sharedItemIds = new Set(
            entries.map(({ item }) => item.id),
          )
          updateConsultations((current) =>
            Object.fromEntries(
              Object.entries(current).map(
                ([itemId, consultation]) => [
                  itemId,
                  sharedItemIds.has(itemId)
                    ? { ...consultation, status: 'shared' as const }
                    : consultation,
                ],
              ),
            ),
          )
          if (draftRef.current?.itemId === individualItemId) {
            setCurrentDraft(null)
          }
        }

        onNotice(getConsultationShareNotice(result))
      } finally {
        if (shareGeneration === shareGenerationRef.current) {
          isShareActiveRef.current = false
          releaseOwnedShareLock()
          setIsSharingConsultation(false)
          setSharingConsultationItemId(null)
        }
      }
    },
    [
      onNotice,
      releaseOwnedShareLock,
      setCurrentDraft,
      share,
      shareLock,
      updateConsultations,
    ],
  )

  const shareDraftImmediately = useCallback(async () => {
    const draftIssue = getDraftIssue()
    if (!draftIssue) {
      return
    }

    const item = itemsRef.current.find(
      (currentItem) => currentItem.id === draftIssue.itemId,
    )
    if (!item) {
      return
    }

    updateConsultations((current) => ({
      ...current,
      [item.id]: createConsultationEntry(
        item.id,
        draftIssue.issue,
        'queued',
      ),
    }))
    await performConsultationShare(
      [{ item, issue: draftIssue.issue }],
      'individual',
    )
  }, [
    getDraftIssue,
    performConsultationShare,
    updateConsultations,
  ])

  const shareIndividual = useCallback(
    async (itemId: string) => {
      const entry = getCurrentConsultations()[itemId]
      const item = itemsRef.current.find(
        (currentItem) => currentItem.id === itemId,
      )
      const issue = getConsultationIssue(entry)
      if (!item || !issue || entry.status === 'resolved') {
        return
      }

      await performConsultationShare([{ item, issue }], 'individual')
    },
    [getCurrentConsultations, performConsultationShare],
  )

  const shareQueued = useCallback(async () => {
    const consultations = getCurrentConsultations()
    const entries = itemsRef.current.flatMap((item) => {
      const consultation = consultations[item.id]
      if (consultation?.status !== 'queued') {
        return []
      }
      const issue = getConsultationIssue(consultation)
      return issue ? [{ item, issue }] : []
    })
    await performConsultationShare(entries, 'bulk')
  }, [getCurrentConsultations, performConsultationShare])

  const removeConsultation = useCallback(
    (itemId: string) => {
      updateConsultations((current) => {
        const next = { ...current }
        delete next[itemId]
        return next
      })
      if (draftRef.current?.itemId === itemId) {
        setCurrentDraft(null)
      }
    },
    [setCurrentDraft, updateConsultations],
  )

  const resolveConsultation = useCallback(
    (itemId: string) => {
      updateConsultations((current) => {
        const consultation = current[itemId]
        return consultation
          ? {
              ...current,
              [itemId]: {
                ...consultation,
                status: 'resolved',
              },
            }
          : current
      })
      if (draftRef.current?.itemId === itemId) {
        setCurrentDraft(null)
      }
    },
    [setCurrentDraft, updateConsultations],
  )

  return {
    consultationDraft,
    isSharingConsultation,
    sharingConsultationItemId,
    openConsultation,
    closeConsultation,
    setReason,
    setNote,
    getDraftIssue,
    addToQueue,
    shareDraftImmediately,
    shareIndividual,
    shareQueued,
    removeConsultation,
    resolveConsultation,
  }
}
