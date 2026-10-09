import { describe, expect, it } from 'vitest'
import type { LiveRequestSnapshot } from '../features/liveRequests/types'
import type { ShoppingRequestItemPayload } from '../types/shopping'
import { getShoppingCheckoutDecision } from './shoppingCheckout'

const item: ShoppingRequestItemPayload = {
  id: 'fixture-item', productId: 'fixture-product', productNameSnapshot: '検証商品',
  categoryIdSnapshot: 'other', categoryNameSnapshot: 'その他', quantity: 1,
  unit: '個', iconSnapshot: '🛒', sortOrderSnapshot: 1,
}
const requestId = 'fixture-request'
const fixedInput = {
  requestId, items: [item], checkedState: { [item.id]: 'inCart' as const }, consultations: {},
}
const snapshot: LiveRequestSnapshot = {
  schemaVersion: 1, requestId, revision: 1, updatesCount: 0,
  createdAt: '2026-08-01T00:00:00.000Z', expiresAt: '2026-08-15T00:00:00.000Z',
  items: [{
    itemId: item.id, productId: item.productId, productNameSnapshot: item.productNameSnapshot,
    categoryIdSnapshot: item.categoryIdSnapshot, categoryNameSnapshot: item.categoryNameSnapshot,
    quantity: item.quantity, unit: item.unit, iconSnapshot: item.iconSnapshot,
    sortOrderSnapshot: item.sortOrderSnapshot, lifecycle: 'active',
    createdRevision: 1, updatedRevision: 1,
  }],
}
const live = { snapshot, status: 'current' as const, pendingChanges: [] }

describe('shopping checkout decision', () => {
  it('finishes fixed purchases using supplied current progress without Live state', () => {
    expect(getShoppingCheckoutDecision(fixedInput)).toEqual({ outcome: 'finish', latestConfirmed: true })
    expect(getShoppingCheckoutDecision({ ...fixedInput, checkedState: {} })).toEqual({
      outcome: 'blocked', reason: 'items-unresolved',
    })
    expect(getShoppingCheckoutDecision({ ...fixedInput, items: [] }).outcome).toBe('blocked')
  })

  it('requires unresolved consultations to be handled even when the item is already in the cart', () => {
    expect(getShoppingCheckoutDecision({
      ...fixedInput,
      consultations: { [item.id]: { itemId: item.id, reason: 'soldOut', status: 'shared' } },
    })).toEqual({ outcome: 'blocked', reason: 'items-unresolved' })
  })

  it('finishes a current Live list and reports freshness', () => {
    expect(getShoppingCheckoutDecision({ ...fixedInput, live })).toEqual({
      outcome: 'finish', latestConfirmed: true,
    })
  })

  it('uses additions in the latest snapshot rather than the older displayed items', () => {
    const next = { ...snapshot, revision: 2, items: [
      ...snapshot.items,
      { ...snapshot.items[0], itemId: 'fixture-added', createdRevision: 2, updatedRevision: 2 },
    ] }
    expect(getShoppingCheckoutDecision({ ...fixedInput, live: { ...live, snapshot: next } })).toEqual({
      outcome: 'blocked', reason: 'items-unresolved',
    })
    expect(snapshot.items).toHaveLength(1)
  })

  it('uses the latest condition and purchase verification rather than an older condition-free item', () => {
    const next = { ...snapshot, revision: 2, items: [
      { ...snapshot.items[0], memo: '最新の条件', updatedRevision: 2 },
    ] }
    const input = { ...fixedInput, live: { ...live, snapshot: next } }
    expect(getShoppingCheckoutDecision(input)).toEqual({ outcome: 'blocked', reason: 'items-unresolved' })
    expect(getShoppingCheckoutDecision({ ...input, checkedState: { [item.id]: 'verified' } })).toEqual({
      outcome: 'finish', latestConfirmed: true,
    })
  })

  it('ignores reviewed cancellations but cannot finish an entirely cancelled list', () => {
    const cancelled = { ...snapshot.items[0], itemId: 'fixture-cancelled', lifecycle: 'cancelled-by-requester' as const }
    expect(getShoppingCheckoutDecision({
      ...fixedInput, live: { ...live, snapshot: { ...snapshot, items: [...snapshot.items, cancelled] } },
    })).toEqual({ outcome: 'finish', latestConfirmed: true })
    expect(getShoppingCheckoutDecision({
      ...fixedInput, live: { ...live, snapshot: { ...snapshot, items: [cancelled] } },
    })).toEqual({ outcome: 'blocked', reason: 'items-unresolved' })
  })

  it.each(['stale', 'expired', 'missing'] as const)(
    'requires explicit unconfirmed finish consent for a cached %s list', (status) => {
      const input = { ...fixedInput, live: { ...live, status } }
      expect(getShoppingCheckoutDecision(input)).toEqual({ outcome: 'offline-confirmation-required' })
      expect(getShoppingCheckoutDecision({ ...input, allowUnconfirmedLive: true })).toEqual({
        outcome: 'finish', latestConfirmed: false,
      })
      expect(getShoppingCheckoutDecision({ ...input, allowUnconfirmedLive: true, checkedState: {} })).toEqual({
        outcome: 'blocked', reason: 'items-unresolved',
      })
    },
  )

  it('keeps the offline prompt decision before the purchase-completion check', () => {
    expect(getShoppingCheckoutDecision({ ...fixedInput, checkedState: {}, live: { ...live, status: 'stale' } }))
      .toEqual({ outcome: 'offline-confirmation-required' })
  })

  it.each(['checking', 'loading'] as const)('blocks unconfirmed finish while %s', (status) => {
    expect(getShoppingCheckoutDecision({ ...fixedInput, live: { ...live, status }, allowUnconfirmedLive: true }))
      .toEqual({ outcome: 'blocked', reason: 'sync-in-progress' })
  })

  it.each(['added', 'cancelled'] as const)('blocks an unreviewed %s change even with offline consent', (kind) => {
    expect(getShoppingCheckoutDecision({
      ...fixedInput, allowUnconfirmedLive: true,
      live: { ...live, status: 'stale', pendingChanges: [{ kind, itemId: item.id, revision: 2 }] },
    })).toEqual({ outcome: 'blocked', reason: 'changes-pending' })
  })

  it('rejects another request or an absent snapshot instead of falling back to the displayed list', () => {
    for (const latest of [{ ...snapshot, requestId: 'other-fixture-request' }, undefined]) {
      expect(getShoppingCheckoutDecision({
        ...fixedInput, live: { ...live, snapshot: latest }, allowUnconfirmedLive: true,
      })).toEqual({ outcome: 'blocked', reason: 'request-changed' })
    }
  })
})
