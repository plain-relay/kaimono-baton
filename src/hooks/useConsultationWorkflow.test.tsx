// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import type {
  ConsultationMap,
  ItemIssueMap,
  ShoppingRequestItemPayload,
} from '../types/shopping'
import type {
  NativeShareInput,
  NativeShareResult,
} from '../utils/shareText'
import {
  useConsultationWorkflow,
  type ConsultationShareLock,
  type ConsultationShareNotice,
} from './useConsultationWorkflow'

function createItem(
  id: string,
  name: string,
  sortOrderSnapshot: number,
): ShoppingRequestItemPayload {
  return {
    id,
    productId: id,
    productNameSnapshot: name,
    categoryIdSnapshot: 'other',
    categoryNameSnapshot: 'その他',
    quantity: sortOrderSnapshot,
    unit: '個',
    memo: sortOrderSnapshot === 1 ? '国産' : undefined,
    iconSnapshot: '🛒',
    sortOrderSnapshot,
  }
}

const ITEMS = [
  createItem('milk', '牛乳', 1),
  createItem('eggs', '卵', 2),
  createItem('bread', 'パン', 3),
  createItem('apple', 'りんご', 4),
]

describe('useConsultationWorkflow', () => {
  let container: HTMLDivElement
  let root: Root
  let isMounted: boolean
  let workflow: ReturnType<typeof useConsultationWorkflow>
  let consultations: ConsultationMap
  let itemIssues: ItemIssueMap
  let notices: ConsultationShareNotice[]
  let shareMock: ReturnType<
    typeof vi.fn<(input: NativeShareInput) => Promise<NativeShareResult>>
  >
  let lockActive: boolean
  let shareLock: ConsultationShareLock
  let updateConsultations: (
    updater: (current: ConsultationMap) => ConsultationMap,
  ) => void
  let getCurrentConsultations: () => ConsultationMap
  let getItemIssue: (itemId: string) => ItemIssueMap[string] | undefined
  let share: (input: NativeShareInput) => Promise<NativeShareResult>
  let onNotice: (notice: ConsultationShareNotice) => void

  function HookHarness({ sessionKey }: { sessionKey: string }) {
    workflow = useConsultationWorkflow({
      sessionKey,
      items: ITEMS,
      updateConsultations,
      getCurrentConsultations,
      getItemIssue,
      share,
      shareLock,
      onNotice,
    })
    return null
  }

  function renderSession(sessionKey = 'request-a') {
    act(() => root.render(<HookHarness sessionKey={sessionKey} />))
  }

  function openWithReason(
    itemId = 'milk',
    reason: 'soldOut' | 'notFound' = 'soldOut',
    note = '',
  ) {
    act(() => {
      workflow.openConsultation(itemId)
      workflow.setReason(reason)
      if (note) {
        workflow.setNote(note)
      }
    })
  }

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true
    consultations = {}
    itemIssues = {}
    notices = []
    shareMock = vi.fn(async () => 'shared' as const)
    lockActive = false
    shareLock = {
      tryAcquire: () => {
        if (lockActive) {
          return false
        }
        lockActive = true
        return true
      },
      release: () => {
        lockActive = false
      },
    }
    updateConsultations = (updater) => {
      consultations = updater(consultations)
    }
    getCurrentConsultations = () => consultations
    getItemIssue = (itemId) => itemIssues[itemId]
    share = (input) => shareMock(input)
    onNotice = (notice) => {
      notices.push(notice)
    }
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    isMounted = true
    renderSession()
  })

  afterEach(() => {
    if (isMounted) {
      act(() => root.unmount())
    }
    container.remove()
  })

  it('opens a new consultation draft', () => {
    act(() => workflow.openConsultation('milk'))

    expect(workflow.consultationDraft).toEqual({
      itemId: 'milk',
      reason: undefined,
      note: '',
    })
  })

  it('restores an existing consultation and falls back to a legacy item issue', () => {
    consultations.milk = {
      itemId: 'milk',
      reason: 'notFound',
      note: '別容量あり',
      status: 'shared',
    }
    itemIssues.eggs = {
      reason: 'poorCondition',
      note: '傷あり',
    }

    act(() => workflow.openConsultation('milk'))
    expect(workflow.consultationDraft).toMatchObject({
      itemId: 'milk',
      reason: 'notFound',
      note: '別容量あり',
    })

    act(() => workflow.openConsultation('eggs'))
    expect(workflow.consultationDraft).toMatchObject({
      itemId: 'eggs',
      reason: 'poorCondition',
      note: '傷あり',
    })
  })

  it('does not add a queue entry until a reason is selected', () => {
    act(() => {
      workflow.openConsultation('milk')
      workflow.addToQueue()
    })

    expect(consultations).toEqual({})
    expect(notices).toEqual([])
    expect(workflow.consultationDraft?.itemId).toBe('milk')
  })

  it('adds and updates one queue entry without duplicating the item', () => {
    openWithReason('milk', 'soldOut', '最初の補足')
    act(() => workflow.addToQueue())
    expect(consultations.milk).toMatchObject({
      reason: 'soldOut',
      note: '最初の補足',
      status: 'queued',
    })

    openWithReason('milk', 'notFound', '更新後')
    act(() => workflow.addToQueue())

    expect(Object.keys(consultations)).toEqual(['milk'])
    expect(consultations.milk).toMatchObject({
      reason: 'notFound',
      note: '更新後',
      status: 'queued',
    })
    expect(notices.at(-1)).toEqual({
      kind: 'info',
      message: 'まとめ相談に追加しました。',
    })
  })

  it('persists queued input before an immediate share and marks shared on success', async () => {
    let resolveShare: (result: NativeShareResult) => void = () => {}
    shareMock = vi.fn(
      () =>
        new Promise<NativeShareResult>((resolve) => {
          resolveShare = resolve
        }),
    )
    openWithReason('milk', 'notFound', '別容量あり')
    let sharePromise: Promise<void>

    act(() => {
      sharePromise = workflow.shareDraftImmediately()
    })

    expect(consultations.milk).toMatchObject({
      reason: 'notFound',
      note: '別容量あり',
      status: 'queued',
    })
    expect(shareMock).toHaveBeenCalledTimes(1)
    expect(shareMock.mock.calls[0][0]).toMatchObject({
      title: 'おつかい相談',
    })
    expect(shareMock.mock.calls[0][0].text).toContain('商品：牛乳')
    expect(shareMock.mock.calls[0][0].text).toContain('数量：1個')
    expect(shareMock.mock.calls[0][0].text).toContain('条件：国産')

    await act(async () => {
      resolveShare('shared')
      await sharePromise!
    })

    expect(consultations.milk.status).toBe('shared')
    expect(workflow.consultationDraft).toBeNull()
    expect(notices.at(-1)?.message).toContain(
      'LINEを選択して送信してください。',
    )
  })

  it('treats copied consultation text as a completed share', async () => {
    shareMock.mockResolvedValue('copied')
    openWithReason()

    await act(async () => workflow.shareDraftImmediately())

    expect(consultations.milk.status).toBe('shared')
    expect(notices.at(-1)?.message).toContain('相談文をコピーしました。')
  })

  it.each(['cancelled', 'failed'] as const)(
    'keeps queued input and the draft when sharing is %s',
    async (result) => {
      shareMock.mockResolvedValue(result)
      openWithReason('milk', 'soldOut', '保持する補足')

      await act(async () => workflow.shareDraftImmediately())

      expect(consultations.milk).toMatchObject({
        reason: 'soldOut',
        note: '保持する補足',
        status: 'queued',
      })
      expect(workflow.consultationDraft).toMatchObject({
        itemId: 'milk',
        reason: 'soldOut',
        note: '保持する補足',
      })
      expect(notices.at(-1)?.message).toContain(
        '相談内容はそのまま残しています。',
      )
    },
  )

  it('shares an existing unresolved consultation individually', async () => {
    consultations.eggs = {
      itemId: 'eggs',
      reason: 'notFound',
      status: 'queued',
    }

    await act(async () => workflow.shareIndividual('eggs'))

    expect(shareMock).toHaveBeenCalledTimes(1)
    expect(shareMock.mock.calls[0][0].text).toContain('商品：卵')
    expect(shareMock.mock.calls[0][0].text).not.toContain('商品：牛乳')
    expect(consultations.eggs.status).toBe('shared')
  })

  it('bulk shares queued consultations only and skips shared or resolved entries', async () => {
    consultations = {
      milk: {
        itemId: 'milk',
        reason: 'soldOut',
        status: 'queued',
      },
      eggs: {
        itemId: 'eggs',
        reason: 'notFound',
        status: 'queued',
      },
      bread: {
        itemId: 'bread',
        reason: 'poorCondition',
        status: 'shared',
      },
      apple: {
        itemId: 'apple',
        reason: 'other',
        status: 'resolved',
      },
    }

    await act(async () => workflow.shareQueued())

    const text = shareMock.mock.calls[0][0].text
    expect(text).toContain('牛乳')
    expect(text).toContain('卵')
    expect(text).not.toContain('パン')
    expect(text).not.toContain('りんご')
    expect(consultations.milk.status).toBe('shared')
    expect(consultations.eggs.status).toBe('shared')
    expect(consultations.bread.status).toBe('shared')
    expect(consultations.apple.status).toBe('resolved')
  })

  it('removes and resolves consultations without touching other entries', () => {
    consultations = {
      milk: {
        itemId: 'milk',
        reason: 'soldOut',
        status: 'queued',
      },
      eggs: {
        itemId: 'eggs',
        reason: 'notFound',
        status: 'shared',
      },
    }

    act(() => workflow.resolveConsultation('milk'))
    expect(consultations.milk.status).toBe('resolved')
    expect(consultations.eggs.status).toBe('shared')

    act(() => workflow.removeConsultation('eggs'))
    expect(consultations.eggs).toBeUndefined()
    expect(consultations.milk.status).toBe('resolved')
  })

  it('prevents duplicate share execution and holds the shared lock while active', async () => {
    let resolveShare: (result: NativeShareResult) => void = () => {}
    shareMock = vi.fn(
      () =>
        new Promise<NativeShareResult>((resolve) => {
          resolveShare = resolve
        }),
    )
    openWithReason()
    let firstPromise: Promise<void>
    let secondPromise: Promise<void>

    act(() => {
      firstPromise = workflow.shareDraftImmediately()
      secondPromise = workflow.shareDraftImmediately()
    })

    expect(shareMock).toHaveBeenCalledTimes(1)
    expect(lockActive).toBe(true)
    expect(shareLock.tryAcquire()).toBe(false)

    await act(async () => {
      resolveShare('shared')
      await Promise.all([firstPromise!, secondPromise!])
    })
    expect(lockActive).toBe(false)
  })

  it('does not start consultation sharing while the result-share lock is active', async () => {
    lockActive = true
    openWithReason()

    await act(async () => workflow.shareDraftImmediately())

    expect(shareMock).not.toHaveBeenCalled()
    expect(consultations.milk.status).toBe('queued')
    expect(workflow.isSharingConsultation).toBe(false)
    expect(notices.at(-1)).toEqual({
      kind: 'info',
      message:
        '別の共有処理が進行中です。完了してからもう一度お試しください。',
    })
  })

  it('ignores an old share result after the request changes', async () => {
    let resolveShare: (result: NativeShareResult) => void = () => {}
    shareMock = vi.fn(
      () =>
        new Promise<NativeShareResult>((resolve) => {
          resolveShare = resolve
        }),
    )
    openWithReason()
    let sharePromise: Promise<void>
    act(() => {
      sharePromise = workflow.shareDraftImmediately()
    })

    renderSession('request-b')
    expect(workflow.isSharingConsultation).toBe(false)
    expect(workflow.consultationDraft).toBeNull()
    expect(lockActive).toBe(false)

    await act(async () => {
      resolveShare('shared')
      await sharePromise!
    })

    expect(consultations.milk.status).toBe('queued')
    expect(notices).toEqual([])
  })

  it('ignores an old share result after unmount', async () => {
    let resolveShare: (result: NativeShareResult) => void = () => {}
    shareMock = vi.fn(
      () =>
        new Promise<NativeShareResult>((resolve) => {
          resolveShare = resolve
        }),
    )
    openWithReason()
    let sharePromise: Promise<void>
    act(() => {
      sharePromise = workflow.shareDraftImmediately()
      root.unmount()
    })
    isMounted = false
    expect(lockActive).toBe(false)

    resolveShare('shared')
    await sharePromise!

    expect(consultations.milk.status).toBe('queued')
    expect(notices).toEqual([])
  })

  it('never changes purchase state while managing consultations', async () => {
    const purchaseState = { milk: 'inCart' as const }
    openWithReason()

    await act(async () => workflow.shareDraftImmediately())
    act(() => workflow.resolveConsultation('milk'))

    expect(purchaseState).toEqual({ milk: 'inCart' })
  })
})
