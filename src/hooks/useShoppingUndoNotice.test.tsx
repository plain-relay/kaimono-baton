// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useShoppingUndoNotice,
  type ShoppingUndoNoticeState,
} from './useShoppingUndoNotice'

const firstNotice: ShoppingUndoNoticeState = {
  change: {
    itemId: 'item-1',
    previousStatus: 'pending',
    nextStatus: 'inCart',
  },
  message: '牛乳をかご済みにしました',
  previousCartOrder: [],
}

const secondNotice: ShoppingUndoNoticeState = {
  change: {
    itemId: 'item-2',
    previousStatus: 'pending',
    nextStatus: 'notBuying',
    nextIssue: { reason: 'soldOut' },
  },
  message: '卵を今回は買わないにしました',
  previousCartOrder: ['item-1'],
}

describe('useShoppingUndoNotice', () => {
  let container: HTMLDivElement
  let root: Root
  let isMounted: boolean
  let undo: ReturnType<typeof useShoppingUndoNotice>

  function HookHarness() {
    undo = useShoppingUndoNotice()
    return null
  }

  beforeEach(() => {
    vi.useFakeTimers()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    isMounted = true
    act(() => root.render(<HookHarness />))
  })

  afterEach(() => {
    if (isMounted) {
      act(() => root.unmount())
    }
    container.remove()
    vi.useRealTimers()
  })

  it('shows the latest notice for exactly five seconds', () => {
    act(() => undo.showUndoNotice(firstNotice))
    expect(undo.undoNotice).toBe(firstNotice)

    act(() => vi.advanceTimersByTime(4_999))
    expect(undo.undoNotice).toBe(firstNotice)

    act(() => vi.advanceTimersByTime(1))
    expect(undo.undoNotice).toBeNull()
  })

  it('replaces the previous notice and restarts the timer', () => {
    act(() => undo.showUndoNotice(firstNotice))
    act(() => vi.advanceTimersByTime(3_000))
    act(() => undo.showUndoNotice(secondNotice))

    act(() => vi.advanceTimersByTime(2_000))
    expect(undo.undoNotice).toBe(secondNotice)

    act(() => vi.advanceTimersByTime(2_999))
    expect(undo.undoNotice).toBe(secondNotice)

    act(() => vi.advanceTimersByTime(1))
    expect(undo.undoNotice).toBeNull()
  })

  it('consumes only the latest notice and does not create another undo', () => {
    act(() => undo.showUndoNotice(firstNotice))
    act(() => undo.showUndoNotice(secondNotice))

    let consumed: ShoppingUndoNoticeState | null = null
    act(() => {
      consumed = undo.consumeUndoNotice()
    })

    expect(consumed).toBe(secondNotice)
    expect(undo.undoNotice).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears the current notice and timer for a request change or reset', () => {
    act(() => undo.showUndoNotice(firstNotice))
    act(() => undo.clearUndoNotice())

    expect(undo.undoNotice).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears the timer when the component unmounts', () => {
    const clearTimeout = vi.spyOn(window, 'clearTimeout')
    act(() => undo.showUndoNotice(firstNotice))

    act(() => root.unmount())
    isMounted = false

    expect(clearTimeout).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
