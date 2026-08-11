// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CheckedItemStatus,
  ConsultationMap,
  ItemIssue,
} from '../types/shopping'
import {
  isCartStatus,
  keepsItemIssue,
  type ShoppingStateSnapshot,
} from '../utils/shoppingState'
import { usePersistedShoppingSession } from './usePersistedShoppingSession'

const EMPTY_SHOPPING_STATE: ShoppingStateSnapshot = {
  checkedState: {},
  itemIssues: {},
  cartOrder: [],
}

const CHECKED_STATUSES: CheckedItemStatus[] = [
  'pending',
  'inCart',
  'verified',
  'consulting',
  'notBuying',
]

const STATUS_TRANSITIONS = CHECKED_STATUSES.flatMap((previousStatus) =>
  CHECKED_STATUSES.filter(
    (nextStatus) => nextStatus !== previousStatus,
  ).map((nextStatus) => ({ previousStatus, nextStatus })),
)

function issueForStatus(
  status: CheckedItemStatus,
  note: string,
): ItemIssue | undefined {
  return keepsItemIssue(status)
    ? { reason: 'conditionMismatch', note }
    : undefined
}

function readStored(key: string): unknown {
  const value = window.localStorage.getItem(key)
  return value ? JSON.parse(value) : null
}

describe('usePersistedShoppingSession', () => {
  let container: HTMLDivElement
  let root: Root
  let session: ReturnType<typeof usePersistedShoppingSession>
  let renderCount: number

  function HookHarness() {
    session = usePersistedShoppingSession()
    renderCount += 1
    return null
  }

  function replaceSession(
    requestId: string,
    shoppingState: ShoppingStateSnapshot = EMPTY_SHOPPING_STATE,
    consultations: ConsultationMap = {},
  ) {
    act(() => {
      session.replaceSession({
        requestId,
        shoppingState,
        consultations,
      })
    })
  }

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true
    window.localStorage.clear()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    renderCount = 0
    act(() => root.render(<HookHarness />))
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('replaces the initial session and persists all four stored values', () => {
    const shoppingState: ShoppingStateSnapshot = {
      checkedState: { milk: 'inCart', eggs: 'notBuying' },
      itemIssues: { eggs: { reason: 'soldOut' } },
      cartOrder: ['milk'],
    }
    const consultations: ConsultationMap = {
      milk: {
        itemId: 'milk',
        reason: 'notFound',
        status: 'queued',
      },
    }

    replaceSession('request-a', shoppingState, consultations)

    expect(session.shoppingState).toBe(shoppingState)
    expect(session.consultations).toBe(consultations)
    expect(session.getCurrentShoppingState()).toBe(shoppingState)
    expect(session.getCurrentConsultations()).toBe(consultations)
    expect(readStored('otsukai:checked:request-a')).toEqual(
      shoppingState.checkedState,
    )
    expect(readStored('otsukai:itemIssues:request-a')).toEqual(
      shoppingState.itemIssues,
    )
    expect(readStored('otsukai:cartOrder:request-a')).toEqual(
      shoppingState.cartOrder,
    )
    expect(readStored('otsukai:consultations:request-a')).toEqual(
      consultations,
    )
  })

  it('fully replaces one request with another without retaining prior state', () => {
    replaceSession(
      'request-a',
      {
        checkedState: { milk: 'inCart' },
        itemIssues: {},
        cartOrder: ['milk'],
      },
      {
        milk: {
          itemId: 'milk',
          reason: 'notFound',
          status: 'queued',
        },
      },
    )

    replaceSession('request-b')

    expect(session.shoppingState).toEqual(EMPTY_SHOPPING_STATE)
    expect(session.consultations).toEqual({})
    expect(readStored('otsukai:checked:request-b')).toEqual({})
    expect(readStored('otsukai:itemIssues:request-b')).toEqual({})
    expect(readStored('otsukai:cartOrder:request-b')).toEqual([])
    expect(readStored('otsukai:consultations:request-b')).toEqual({})
  })

  it('uses the synchronous latest state for consecutive shopping changes', () => {
    replaceSession('request-a')

    let firstCommit: ReturnType<typeof session.commitShoppingChange>
    let secondCommit: ReturnType<typeof session.commitShoppingChange>
    act(() => {
      firstCommit = session.commitShoppingChange('milk', 'inCart')
      secondCommit = session.commitShoppingChange(
        'eggs',
        'notBuying',
        { reason: 'soldOut', note: '棚になし' },
      )
    })

    expect(firstCommit!).toMatchObject({
      change: {
        itemId: 'milk',
        previousStatus: 'pending',
        nextStatus: 'inCart',
      },
      previousCartOrder: [],
    })
    expect(secondCommit!).toMatchObject({
      change: {
        itemId: 'eggs',
        previousStatus: 'pending',
        nextStatus: 'notBuying',
      },
      previousCartOrder: ['milk'],
    })
    expect(session.getCurrentShoppingState()).toEqual(session.shoppingState)
    expect(session.shoppingState).toEqual({
      checkedState: {
        milk: 'inCart',
        eggs: 'notBuying',
      },
      itemIssues: {
        eggs: { reason: 'soldOut', note: '棚になし' },
      },
      cartOrder: ['milk'],
    })
  })

  it('does not update state when the requested shopping change is identical', () => {
    replaceSession('request-a')
    const stateBefore = session.shoppingState
    const rendersBefore = renderCount
    let result: ReturnType<typeof session.commitShoppingChange>

    act(() => {
      result = session.commitShoppingChange('milk', 'pending')
    })

    expect(result!).toBeNull()
    expect(session.shoppingState).toBe(stateBefore)
    expect(renderCount).toBe(rendersBefore)
  })

  it('bases consecutive consultation updates on the latest value and persists it', () => {
    replaceSession('request-a')

    act(() => {
      session.updateConsultations((current) => ({
        ...current,
        milk: {
          itemId: 'milk',
          reason: 'notFound',
          status: 'queued',
        },
      }))
      session.updateConsultations((current) => ({
        ...current,
        eggs: {
          itemId: 'eggs',
          reason: 'soldOut',
          status: 'shared',
        },
      }))
    })

    expect(session.consultations).toEqual({
      milk: {
        itemId: 'milk',
        reason: 'notFound',
        status: 'queued',
      },
      eggs: {
        itemId: 'eggs',
        reason: 'soldOut',
        status: 'shared',
      },
    })
    expect(session.getCurrentConsultations()).toEqual(
      session.consultations,
    )
    expect(readStored('otsukai:consultations:request-a')).toEqual(
      session.consultations,
    )
  })

  it('returns and restores the exact previous cart order for Undo', () => {
    replaceSession('request-a', {
      checkedState: { milk: 'inCart' },
      itemIssues: {},
      cartOrder: ['milk'],
    })
    let committed: ReturnType<typeof session.commitShoppingChange>

    act(() => {
      committed = session.commitShoppingChange('eggs', 'inCart')
    })
    expect(committed!.previousCartOrder).toEqual(['milk'])
    expect(session.shoppingState.cartOrder).toEqual(['milk', 'eggs'])

    act(() => {
      session.undoShoppingChange(
        committed!.change,
        committed!.previousCartOrder,
      )
    })

    expect(session.shoppingState.checkedState.eggs).toBe('pending')
    expect(session.shoppingState.cartOrder).toEqual(['milk'])
    expect(readStored('otsukai:cartOrder:request-a')).toEqual(['milk'])
  })

  it.each(STATUS_TRANSITIONS)(
    'preserves state invariants across $previousStatus -> $nextStatus and Undo',
    ({ previousStatus, nextStatus }) => {
      const itemId = 'subject'
      const previousIssue = issueForStatus(
        previousStatus,
        'before transition',
      )
      const nextIssue = issueForStatus(nextStatus, 'after transition')
      const previousCartOrder = isCartStatus(previousStatus)
        ? ['before', itemId, 'after']
        : ['before', 'after']
      const initialState: ShoppingStateSnapshot = {
        checkedState: {
          before: 'inCart',
          [itemId]: previousStatus,
          after: 'verified',
        },
        itemIssues: previousIssue
          ? { [itemId]: previousIssue }
          : {},
        cartOrder: previousCartOrder,
      }
      replaceSession('transition-request', initialState)

      let committed: ReturnType<typeof session.commitShoppingChange>
      act(() => {
        committed = session.commitShoppingChange(
          itemId,
          nextStatus,
          nextIssue,
        )
      })

      expect(committed!).not.toBeNull()
      expect(session.shoppingState.checkedState[itemId]).toBe(nextStatus)
      expect(
        session.shoppingState.cartOrder.filter((id) => id === itemId),
      ).toHaveLength(isCartStatus(nextStatus) ? 1 : 0)
      expect(session.shoppingState.itemIssues[itemId]).toEqual(nextIssue)

      act(() => {
        session.undoShoppingChange(
          committed!.change,
          committed!.previousCartOrder,
        )
      })

      expect(session.shoppingState.checkedState[itemId]).toBe(
        previousStatus,
      )
      expect(session.shoppingState.itemIssues[itemId]).toEqual(
        previousIssue,
      )
      expect(session.shoppingState.cartOrder).toEqual(previousCartOrder)
    },
  )

  it('does not save later changes under a replaced request ID', () => {
    replaceSession('request-a')
    act(() => {
      session.commitShoppingChange('milk', 'inCart')
    })
    const firstRequestState = readStored('otsukai:checked:request-a')

    replaceSession('request-b')
    act(() => {
      session.commitShoppingChange(
        'eggs',
        'notBuying',
        { reason: 'soldOut' },
      )
    })

    expect(readStored('otsukai:checked:request-a')).toEqual(
      firstRequestState,
    )
    expect(readStored('otsukai:checked:request-b')).toEqual({
      eggs: 'notBuying',
    })
    expect(readStored('otsukai:itemIssues:request-b')).toEqual({
      eggs: { reason: 'soldOut' },
    })
  })

  it('documents last-writer storage behavior for concurrent sessions', () => {
    act(() => root.unmount())
    root = createRoot(container)
    let firstSession: ReturnType<typeof usePersistedShoppingSession>
    let secondSession: ReturnType<typeof usePersistedShoppingSession>

    function FirstSessionHarness() {
      firstSession = usePersistedShoppingSession()
      return null
    }

    function SecondSessionHarness() {
      secondSession = usePersistedShoppingSession()
      return null
    }

    act(() => {
      root.render(
        <>
          <FirstSessionHarness />
          <SecondSessionHarness />
        </>,
      )
    })
    act(() => {
      firstSession!.replaceSession({
        requestId: 'shared-request',
        shoppingState: EMPTY_SHOPPING_STATE,
        consultations: {},
      })
      secondSession!.replaceSession({
        requestId: 'shared-request',
        shoppingState: EMPTY_SHOPPING_STATE,
        consultations: {},
      })
    })
    act(() => {
      firstSession!.commitShoppingChange('milk', 'inCart')
    })
    expect(readStored('otsukai:checked:shared-request')).toEqual({
      milk: 'inCart',
    })

    act(() => {
      secondSession!.commitShoppingChange(
        'eggs',
        'notBuying',
        { reason: 'soldOut' },
      )
    })

    expect(readStored('otsukai:checked:shared-request')).toEqual({
      eggs: 'notBuying',
    })
  })

  it.each(['QuotaExceededError', 'SecurityError'])(
    'keeps state after a %s write failure and clears the error after the target saves',
    (errorName) => {
      const warn = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined)
      const originalSetItem = window.localStorage.setItem.bind(
        window.localStorage,
      )
      let failCheckedState = true
      vi.spyOn(window.localStorage, 'setItem').mockImplementation(
        (key: string, value: string) => {
          if (
            failCheckedState &&
            key === 'otsukai:checked:request-failure'
          ) {
            throw new DOMException('storage unavailable', errorName)
          }
          originalSetItem(key, value)
        },
      )

      replaceSession('request-failure')

      expect(session.hasPersistenceError).toBe(true)
      expect(session.shoppingState).toEqual(EMPTY_SHOPPING_STATE)
      expect(readStored('otsukai:itemIssues:request-failure')).toEqual({})
      expect(readStored('otsukai:cartOrder:request-failure')).toEqual([])
      expect(readStored('otsukai:consultations:request-failure')).toEqual({})
      expect(warn).toHaveBeenCalledTimes(1)

      failCheckedState = false
      act(() => {
        session.commitShoppingChange('milk', 'inCart')
      })

      expect(session.hasPersistenceError).toBe(false)
      expect(session.shoppingState.checkedState.milk).toBe('inCart')
      expect(readStored('otsukai:checked:request-failure')).toEqual({
        milk: 'inCart',
      })
    },
  )

  it('keeps the warning until every failed persistence target recovers', () => {
    const warn = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined)
    const originalSetItem = window.localStorage.setItem.bind(
      window.localStorage,
    )
    const failedTargets = new Set(['checked', 'consultations'])
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(
      (key: string, value: string) => {
        if (
          [...failedTargets].some((target) =>
            key.startsWith(`otsukai:${target}:request-failure`),
          )
        ) {
          throw new DOMException('storage unavailable', 'QuotaExceededError')
        }
        originalSetItem(key, value)
      },
    )

    replaceSession('request-failure')
    expect(session.hasPersistenceError).toBe(true)

    failedTargets.delete('checked')
    act(() => {
      session.commitShoppingChange('milk', 'inCart')
    })
    expect(session.hasPersistenceError).toBe(true)
    expect(readStored('otsukai:checked:request-failure')).toEqual({
      milk: 'inCart',
    })

    failedTargets.delete('consultations')
    act(() => {
      session.updateConsultations(() => ({
        milk: {
          itemId: 'milk',
          reason: 'notFound',
          status: 'queued',
        },
      }))
    })
    expect(session.hasPersistenceError).toBe(false)
    expect(readStored('otsukai:consultations:request-failure')).toEqual({
      milk: {
        itemId: 'milk',
        reason: 'notFound',
        status: 'queued',
      },
    })
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('clears a persistence error when the request is replaced', () => {
    const warn = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined)
    const originalSetItem = window.localStorage.setItem.bind(
      window.localStorage,
    )
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(
      (key: string, value: string) => {
        if (key === 'otsukai:consultations:request-a') {
          throw new DOMException('storage full', 'QuotaExceededError')
        }
        originalSetItem(key, value)
      },
    )

    replaceSession('request-a')
    expect(session.hasPersistenceError).toBe(true)

    replaceSession('request-b')
    expect(session.hasPersistenceError).toBe(false)
    expect(readStored('otsukai:consultations:request-b')).toEqual({})
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
