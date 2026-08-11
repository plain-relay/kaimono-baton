import { describe, expect, it } from 'vitest'
import type {
  CheckedItemStatus,
  CheckedStateMap,
  ItemIssue,
  ShoppingRequestItemPayload,
} from '../types/shopping'
import {
  addToCartOrder,
  applyShoppingStateChange,
  createCheckedStatusChange,
  createShoppingStateChange,
  getCartItemsForCheckout,
  getCartItemsInCartOrder,
  getItemStatus,
  getShoppingCompletionState,
  normalizeCartOrder,
  normalizeCheckedState,
  normalizeItemIssues,
  reconcileCheckedStateWithIssues,
  reconcileItemIssues,
  removeFromCartOrder,
  updateCartOrderForStatusChange,
} from './shoppingState'

const createItem = (
  id: string,
  memo?: string,
  sortOrderSnapshot = 1,
): ShoppingRequestItemPayload => ({
  id,
  productId: id,
  productNameSnapshot: id,
  categoryIdSnapshot: 'category',
  categoryNameSnapshot: 'Category',
  quantity: 1,
  unit: '個',
  memo,
  iconSnapshot: '🛒',
  sortOrderSnapshot,
})

const CHECKED_STATUSES: CheckedItemStatus[] = [
  'pending',
  'inCart',
  'verified',
  'consulting',
  'notBuying',
]

describe('shopping state normalization', () => {
  it('keeps legacy and new checked statuses', () => {
    const raw = {
      milk: 'pending',
      bread: 'inCart',
      eggs: 'verified',
      apple: 'consulting',
      fish: 'notBuying',
    }

    expect(normalizeCheckedState(raw)).toEqual(raw)
  })

  it('omits invalid checked statuses and treats them as pending when read', () => {
    expect(
      normalizeCheckedState({
        milk: 'lost',
        bread: true,
        eggs: 'verified',
      }),
    ).toEqual({ eggs: 'verified' })
    expect(getItemStatus({}, 'milk')).toBe('pending')
    expect(getItemStatus({ milk: 'lost' } as unknown as CheckedStateMap, 'milk')).toBe('pending')
  })

  it('normalizes valid issues and omits invalid issue data', () => {
    expect(
      normalizeItemIssues({
        milk: { reason: 'soldOut' },
        apple: { reason: 'other', note: '  傷が多い  ' },
        bread: { reason: 'notFound', note: 123 },
        invalidReason: { reason: 'closed' },
        invalidValue: 'soldOut',
        invalidArray: [{ reason: 'soldOut' }],
      }),
    ).toEqual({
      milk: { reason: 'soldOut' },
      apple: { reason: 'other', note: '傷が多い' },
      bread: { reason: 'notFound' },
    })
    expect(normalizeItemIssues(null)).toEqual({})
    expect(normalizeItemIssues([])).toEqual({})
  })

  it('keeps issues only for consulting and notBuying items when reconciled', () => {
    expect(
      reconcileItemIssues(
        {
          milk: { reason: 'soldOut' },
          apple: { reason: 'conditionMismatch' },
          bread: { reason: 'notFound' },
          fish: { reason: 'poorCondition' },
        },
        {
          milk: 'consulting',
          apple: 'notBuying',
          bread: 'pending',
          fish: 'inCart',
        },
      ),
    ).toEqual({
      milk: { reason: 'soldOut' },
      apple: { reason: 'conditionMismatch' },
    })
  })

  it('returns issue-dependent statuses to pending when their issue is missing', () => {
    expect(
      reconcileCheckedStateWithIssues(
        {
          milk: 'consulting',
          apple: 'notBuying',
          bread: 'inCart',
          eggs: 'verified',
        },
        {
          apple: { reason: 'conditionMismatch' },
        },
      ),
    ).toEqual({
      apple: 'notBuying',
      bread: 'inCart',
      eggs: 'verified',
    })
  })

  it('normalizes cart order by keeping strings once in first-seen order', () => {
    expect(normalizeCartOrder('milk')).toEqual([])
    expect(normalizeCartOrder(['milk', 1, 'bread', 'milk', true, 'eggs'])).toEqual([
      'milk',
      'bread',
      'eggs',
    ])
  })
})

describe('shopping completion state', () => {
  it('does not allow an empty request to finish', () => {
    expect(getShoppingCompletionState([], {})).toEqual({
      pendingCount: 0,
      consultingCount: 0,
      needsVerificationCount: 0,
      purchasedCount: 0,
      notBuyingCount: 0,
      canFinish: false,
    })
  })

  it('does not allow pending items to finish', () => {
    expect(getShoppingCompletionState([createItem('milk')], { milk: 'pending' }).canFinish).toBe(false)
  })

  it('does not allow consulting items to finish', () => {
    const result = getShoppingCompletionState([createItem('milk')], { milk: 'consulting' })
    expect(result.consultingCount).toBe(1)
    expect(result.canFinish).toBe(false)
  })

  it('blocks an unresolved consultation without replacing the purchase state', () => {
    const result = getShoppingCompletionState(
      [createItem('milk')],
      { milk: 'inCart' },
      {
        milk: {
          itemId: 'milk',
          reason: 'notFound',
          status: 'shared',
        },
      },
    )

    expect(result.purchasedCount).toBe(1)
    expect(result.consultingCount).toBe(1)
    expect(result.canFinish).toBe(false)
  })

  it('ignores resolved consultations when deciding whether shopping can finish', () => {
    const result = getShoppingCompletionState(
      [createItem('milk')],
      { milk: 'inCart' },
      {
        milk: {
          itemId: 'milk',
          reason: 'notFound',
          status: 'resolved',
        },
      },
    )

    expect(result.consultingCount).toBe(0)
    expect(result.canFinish).toBe(true)
  })

  it('does not allow an inCart item with a condition to finish', () => {
    const result = getShoppingCompletionState([createItem('milk', '低脂肪')], { milk: 'inCart' })
    expect(result.needsVerificationCount).toBe(1)
    expect(result.purchasedCount).toBe(1)
    expect(result.canFinish).toBe(false)
  })

  it('allows an inCart item without a condition to finish', () => {
    expect(getShoppingCompletionState([createItem('bread')], { bread: 'inCart' }).canFinish).toBe(true)
  })

  it('allows a verified item with a condition to finish', () => {
    expect(
      getShoppingCompletionState([createItem('milk', '低脂肪')], { milk: 'verified' }).canFinish,
    ).toBe(true)
  })

  it('treats notBuying as a terminal state', () => {
    const result = getShoppingCompletionState([createItem('milk', '低脂肪')], {
      milk: 'notBuying',
    })
    expect(result.notBuyingCount).toBe(1)
    expect(result.needsVerificationCount).toBe(0)
    expect(result.canFinish).toBe(true)
  })

  it('allows a mixed request when every item is in a terminal state', () => {
    const items = [createItem('milk', '低脂肪'), createItem('bread'), createItem('apple')]
    expect(
      getShoppingCompletionState(items, {
        milk: 'verified',
        bread: 'inCart',
        apple: 'notBuying',
      }),
    ).toEqual({
      pendingCount: 0,
      consultingCount: 0,
      needsVerificationCount: 0,
      purchasedCount: 2,
      notBuyingCount: 1,
      canFinish: true,
    })
  })
})

describe('cart order', () => {
  it('adds entries without duplicates and removes entries', () => {
    expect(addToCartOrder(['milk'], 'bread')).toEqual(['milk', 'bread'])
    expect(addToCartOrder(['milk', 'bread'], 'milk')).toEqual(['milk', 'bread'])
    expect(removeFromCartOrder(['milk', 'bread', 'eggs'], 'bread')).toEqual(['milk', 'eggs'])
    expect(removeFromCartOrder(['milk', 'bread'], 'tomato')).toEqual(['milk', 'bread'])
  })

  it('appends pending and consulting items when they enter the cart', () => {
    expect(updateCartOrderForStatusChange(['milk'], 'bread', 'pending', 'inCart')).toEqual([
      'milk',
      'bread',
    ])
    expect(updateCartOrderForStatusChange(['milk'], 'apple', 'consulting', 'inCart')).toEqual([
      'milk',
      'apple',
    ])
  })

  it('keeps order between inCart and verified', () => {
    expect(updateCartOrderForStatusChange(['milk', 'bread'], 'milk', 'inCart', 'verified')).toEqual([
      'milk',
      'bread',
    ])
    expect(updateCartOrderForStatusChange(['milk', 'bread'], 'milk', 'verified', 'inCart')).toEqual([
      'milk',
      'bread',
    ])
    expect(updateCartOrderForStatusChange(['bread'], 'milk', 'inCart', 'verified')).toEqual([
      'bread',
    ])
  })

  it('removes items when they become pending or notBuying', () => {
    expect(updateCartOrderForStatusChange(['milk', 'bread'], 'milk', 'inCart', 'pending')).toEqual([
      'bread',
    ])
    expect(
      updateCartOrderForStatusChange(['milk', 'bread'], 'bread', 'verified', 'notBuying'),
    ).toEqual(['milk'])
  })

  it('shows persisted cart items newest first and fallback items in sales-floor order', () => {
    const items = [
      createItem('milk', undefined, 30),
      createItem('tomato', undefined, 10),
      createItem('bread', undefined, 20),
      createItem('eggs', undefined, 40),
      createItem('apple', undefined, 5),
      createItem('fish', undefined, 6),
    ]
    const checkedState: CheckedStateMap = {
      milk: 'inCart',
      tomato: 'verified',
      bread: 'inCart',
      eggs: 'pending',
      apple: 'consulting',
      fish: 'notBuying',
    }
    const storedOrder = ['missing', 'tomato', 'tomato', 'milk', 'apple', 'fish']

    expect(getCartItemsInCartOrder(items, checkedState, storedOrder).map((item) => item.id)).toEqual([
      'tomato',
      'milk',
      'bread',
    ])
    expect(getCartItemsForCheckout(items, checkedState, storedOrder).map((item) => item.id)).toEqual([
      'milk',
      'tomato',
      'bread',
    ])
    expect(storedOrder).toEqual(['missing', 'tomato', 'tomato', 'milk', 'apple', 'fish'])
  })

  it('uses sales-floor order when legacy cartOrder is missing', () => {
    const items = [
      createItem('milk', undefined, 30),
      createItem('tomato', undefined, 10),
      createItem('bread', undefined, 20),
    ]

    expect(
      getCartItemsForCheckout(
        items,
        { milk: 'inCart', tomato: 'verified', bread: 'inCart' },
        [],
      ).map((item) => item.id),
    ).toEqual(['tomato', 'bread', 'milk'])
  })
})

describe('shopping state changes and undo', () => {
  it.each(CHECKED_STATUSES)(
    'treats an identical %s status and issue as a no-op',
    (status) => {
      const issue = status === 'consulting' || status === 'notBuying'
        ? { reason: 'soldOut' as const, note: 'same issue' }
        : undefined

      expect(
        createShoppingStateChange(
          { subject: status },
          issue ? { subject: issue } : {},
          'subject',
          status,
          issue,
        ),
      ).toBeNull()
    },
  )

  it.each(['consulting', 'notBuying'] as const)(
    'creates a %s change when only the issue changes',
    (status) => {
      const change = createShoppingStateChange(
        { subject: status },
        { subject: { reason: 'soldOut', note: 'before' } },
        'subject',
        status,
        { reason: 'notFound', note: 'after' },
      )

      expect(change).toMatchObject({
        previousStatus: status,
        nextStatus: status,
        previousIssue: { reason: 'soldOut', note: 'before' },
        nextIssue: { reason: 'notFound', note: 'after' },
      })
    },
  )

  it('does not save an invalid issue in an applied change', () => {
    const invalidIssue = {
      reason: 'not-a-reason',
      note: 'must not persist',
    } as unknown as ItemIssue
    const change = createShoppingStateChange(
      {},
      {},
      'subject',
      'notBuying',
      invalidIssue,
    )
    if (!change) {
      throw new Error('Expected a status change')
    }

    const applied = applyShoppingStateChange(
      { checkedState: {}, itemIssues: {}, cartOrder: [] },
      change,
    )

    expect(change.nextIssue).toBeUndefined()
    expect(applied.itemIssues).toEqual({})
  })

  it('keeps the legacy status-only change helper', () => {
    expect(createCheckedStatusChange({}, 'milk', 'inCart')).toEqual({
      itemId: 'milk',
      previousStatus: 'pending',
      nextStatus: 'inCart',
    })
    expect(createCheckedStatusChange({ milk: 'inCart' }, 'milk', 'inCart')).toBeNull()
  })

  it('applies and undoes a consultation with its issue', () => {
    const change = createShoppingStateChange({}, {}, 'apple', 'consulting', {
      reason: 'conditionMismatch',
    })
    expect(change).toEqual({
      itemId: 'apple',
      previousStatus: 'pending',
      nextStatus: 'consulting',
      nextIssue: { reason: 'conditionMismatch' },
    })
    if (!change) {
      throw new Error('Expected a state change')
    }

    const applied = applyShoppingStateChange(
      { checkedState: {}, itemIssues: {}, cartOrder: [] },
      change,
    )
    expect(applied).toEqual({
      checkedState: { apple: 'consulting' },
      itemIssues: { apple: { reason: 'conditionMismatch' } },
      cartOrder: [],
    })
    expect(applyShoppingStateChange(applied, change, 'undo')).toEqual({
      checkedState: { apple: 'pending' },
      itemIssues: {},
      cartOrder: [],
    })
  })

  it('clears an issue on purchase and restores it when undone', () => {
    const issue = { reason: 'soldOut' } as const
    const change = createShoppingStateChange(
      { milk: 'consulting' },
      { milk: issue },
      'milk',
      'inCart',
    )
    if (!change) {
      throw new Error('Expected a state change')
    }

    const applied = applyShoppingStateChange(
      {
        checkedState: { milk: 'consulting' },
        itemIssues: { milk: issue },
        cartOrder: [],
      },
      change,
    )
    expect(applied).toEqual({
      checkedState: { milk: 'inCart' },
      itemIssues: {},
      cartOrder: ['milk'],
    })
    expect(applyShoppingStateChange(applied, change, 'undo')).toEqual({
      checkedState: { milk: 'consulting' },
      itemIssues: { milk: issue },
      cartOrder: [],
    })
  })

  it('preserves the issue between consulting and notBuying', () => {
    const issue = { reason: 'poorCondition', note: '傷みあり' } as const
    const change = createShoppingStateChange(
      { fish: 'consulting' },
      { fish: issue },
      'fish',
      'notBuying',
    )
    expect(change?.nextIssue).toEqual(issue)
  })

  it('restores a cart status at the end of cartOrder when undoing a reset', () => {
    const change = createShoppingStateChange({ milk: 'inCart' }, {}, 'milk', 'pending')
    if (!change) {
      throw new Error('Expected a state change')
    }

    const applied = applyShoppingStateChange(
      {
        checkedState: { milk: 'inCart', bread: 'inCart' },
        itemIssues: {},
        cartOrder: ['milk', 'bread'],
      },
      change,
    )
    expect(applied.cartOrder).toEqual(['bread'])
    expect(applyShoppingStateChange(applied, change, 'undo').cartOrder).toEqual(['bread', 'milk'])
  })

  it('repairs missing cartOrder data when undo returns to a cart status', () => {
    const change = createShoppingStateChange({ milk: 'inCart' }, {}, 'milk', 'verified')
    if (!change) {
      throw new Error('Expected a state change')
    }

    const verified = applyShoppingStateChange(
      { checkedState: { milk: 'inCart' }, itemIssues: {}, cartOrder: [] },
      change,
    )
    expect(verified.cartOrder).toEqual([])

    const undone = applyShoppingStateChange(
      { ...verified, cartOrder: [] },
      change,
      'undo',
    )
    expect(undone.checkedState).toEqual({ milk: 'inCart' })
    expect(undone.cartOrder).toEqual(['milk'])
  })
})
