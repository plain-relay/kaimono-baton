// @vitest-environment happy-dom

import { compressToEncodedURIComponent } from 'lz-string'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ShoppingRequestItemPayload,
  ShoppingRequestPayload,
} from '../types/shopping'
import { encodeShoppingRequest } from './encodeRequest'
import { MAX_REQUEST_ENCODED_CHARS } from './requestPayloadDecoder'
import {
  decodeShoppingSessionPayload,
  loadShoppingSession,
  reconcileShoppingSession,
  restoreShoppingSession,
} from './shoppingSession'

function createItem(
  id: string,
  productNameSnapshot: string,
  sortOrderSnapshot: number,
): ShoppingRequestItemPayload {
  return {
    id,
    productId: id,
    productNameSnapshot,
    categoryIdSnapshot: 'other',
    categoryNameSnapshot: 'その他',
    quantity: 1,
    unit: '個',
    iconSnapshot: '🛒',
    sortOrderSnapshot,
  }
}

function createPayload(requestId = 'session-request'): ShoppingRequestPayload {
  return {
    requestId,
    title: '互換テスト',
    createdAt: '2026-07-26T00:00:00.000Z',
    items: [
      createItem(`${requestId}-first`, '牛乳', 1),
      createItem(`${requestId}-second`, '卵', 2),
      createItem(`${requestId}-third`, 'パン', 3),
    ],
  }
}

function compact(value: unknown): string {
  return compressToEncodedURIComponent(JSON.stringify(value))
}

describe('shopping session loading', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    window.localStorage.clear()
  })

  it('decodes legacy v1 data through the legacy query codec', () => {
    const payload = createPayload('legacy-session')

    expect(
      decodeShoppingSessionPayload({
        encodedPayload: encodeShoppingRequest(payload),
        codec: 'legacy-query',
      }),
    ).toEqual(payload)
  })

  it('decodes both v2 and v3 through the same compact path codec', () => {
    const v2Encoded = compact([2, 'session-v2', '既存v2', '1', 0])
    const v3Encoded = compact([
      3,
      'session-v3',
      '現行v3',
      [[0, 0, '1']],
    ])

    const v2 = decodeShoppingSessionPayload({
      encodedPayload: v2Encoded,
      codec: 'compact-path',
    })
    const v3 = decodeShoppingSessionPayload({
      encodedPayload: v3Encoded,
      codec: 'compact-path',
    })

    expect(v2.requestId).toBe('v2-session-v2')
    expect(v3.requestId).toBe('v3-session-v3')
    expect(v2.items[0].productId).toBe(v3.items[0].productId)
  })

  it('produces stable request and item IDs when the same compact URL is loaded again', () => {
    const encodedPayload = compact([
      3,
      'stable-session',
      '現行v3',
      [
        [0, 0, '1'],
        [0, 1, '2'],
      ],
    ])
    const input = { encodedPayload, codec: 'compact-path' as const }

    const first = loadShoppingSession(input)
    const second = loadShoppingSession(input)

    expect(second.payload.requestId).toBe(first.payload.requestId)
    expect(second.payload.items.map((item) => item.id)).toEqual(
      first.payload.items.map((item) => item.id),
    )
  })

  it('migrates legacy consultations and reconciles issues, consultations, and cart order', () => {
    const payload = createPayload()
    const [first, second, third] = payload.items
    window.localStorage.setItem(
      `otsukai:checked:${payload.requestId}`,
      JSON.stringify({
        [first.id]: 'consulting',
        [second.id]: 'notBuying',
        [third.id]: 'inCart',
      }),
    )
    window.localStorage.setItem(
      `otsukai:itemIssues:${payload.requestId}`,
      JSON.stringify({
        [first.id]: { reason: 'notFound', note: '別容量あり' },
      }),
    )
    window.localStorage.setItem(
      `otsukai:consultations:${payload.requestId}`,
      JSON.stringify({
        [second.id]: {
          itemId: second.id,
          reason: 'soldOut',
          status: 'shared',
        },
        stale: {
          itemId: 'stale',
          reason: 'poorCondition',
          status: 'queued',
        },
        broken: {
          itemId: 42,
          reason: 'unknown',
          status: 'waiting',
        },
      }),
    )
    window.localStorage.setItem(
      `otsukai:cartOrder:${payload.requestId}`,
      JSON.stringify([third.id, first.id, second.id, 'not-in-state']),
    )

    const session = restoreShoppingSession(payload)

    expect(session.shoppingState.checkedState).toEqual({
      [first.id]: 'pending',
      [third.id]: 'inCart',
    })
    expect(session.shoppingState.itemIssues).toEqual({})
    expect(session.shoppingState.cartOrder).toEqual([third.id])
    expect(session.consultations).toEqual({
      [first.id]: {
        itemId: first.id,
        reason: 'notFound',
        note: '別容量あり',
        status: 'queued',
      },
      [second.id]: {
        itemId: second.id,
        reason: 'soldOut',
        status: 'shared',
      },
    })
  })

  it('drops shopping data for item IDs that are not part of the request', () => {
    const payload = createPayload('stale-item-session')
    const validItemId = payload.items[0].id
    window.localStorage.setItem(
      `otsukai:checked:${payload.requestId}`,
      JSON.stringify({
        [validItemId]: 'inCart',
        'stale-cart-item': 'inCart',
        'stale-issue-item': 'notBuying',
      }),
    )
    window.localStorage.setItem(
      `otsukai:itemIssues:${payload.requestId}`,
      JSON.stringify({
        'stale-issue-item': { reason: 'soldOut' },
      }),
    )
    window.localStorage.setItem(
      `otsukai:cartOrder:${payload.requestId}`,
      JSON.stringify(['stale-cart-item', validItemId]),
    )

    const session = restoreShoppingSession(payload)

    expect(session.shoppingState).toEqual({
      checkedState: { [validItemId]: 'inCart' },
      itemIssues: {},
      cartOrder: [validItemId],
    })
  })

  it('falls back safely when every shopping storage value is malformed', () => {
    const payload = createPayload('broken-storage')
    for (const key of [
      'checked',
      'itemIssues',
      'consultations',
      'cartOrder',
    ]) {
      window.localStorage.setItem(
        `otsukai:${key}:${payload.requestId}`,
        '{broken',
      )
    }

    expect(restoreShoppingSession(payload)).toEqual({
      payload,
      shoppingState: {
        checkedState: {},
        itemIssues: {},
        cartOrder: [],
      },
      consultations: {},
    })
  })

  it('rejects invalid data with the established decoder error', () => {
    expect(() =>
      loadShoppingSession({
        encodedPayload: 'broken-data',
        codec: 'compact-path',
      }),
    ).toThrow('共有URLの復元に失敗しました。')
  })

  it.each(['legacy-query', 'compact-path'] as const)(
    'rejects an oversized encoded %s request before decompression',
    (codec) => {
      expect(() =>
        decodeShoppingSessionPayload({
          encodedPayload: 'x'.repeat(MAX_REQUEST_ENCODED_CHARS + 1),
          codec,
        }),
      ).toThrow('共有URLデータが大きすぎます。')
    },
  )

  it.each(['legacy-query', 'compact-path'] as const)(
    'rejects an oversized expanded %s request before JSON.parse',
    (codec) => {
      const parse = vi.spyOn(JSON, 'parse')
      const encodedPayload = compressToEncodedURIComponent(
        JSON.stringify('x'.repeat(200_001)),
      )

      expect(() =>
        decodeShoppingSessionPayload({ encodedPayload, codec }),
      ).toThrow('共有URLデータが大きすぎます。')
      expect(parse).not.toHaveBeenCalled()
    },
  )

  it('loads a replacement request without retaining the previous session', () => {
    const firstPayload = createPayload('first-session')
    const secondPayload = createPayload('second-session')
    window.localStorage.setItem(
      `otsukai:checked:${firstPayload.requestId}`,
      JSON.stringify({ [firstPayload.items[0].id]: 'inCart' }),
    )

    const first = loadShoppingSession({
      encodedPayload: encodeShoppingRequest(firstPayload),
      codec: 'legacy-query',
    })
    const second = loadShoppingSession({
      encodedPayload: encodeShoppingRequest(secondPayload),
      codec: 'legacy-query',
    })

    expect(first.shoppingState.checkedState).toEqual({
      [firstPayload.items[0].id]: 'inCart',
    })
    expect(second.shoppingState.checkedState).toEqual({})
    expect(second.payload.requestId).toBe('second-session')
  })

  it('reconciles a live revision without overwriting existing progress or conditions', () => {
    const original = createPayload('v5-r1-live-session')
    const updated: ShoppingRequestPayload = {
      ...original,
      items: [
        { ...original.items[0], quantity: 3, memo: '低脂肪' },
        original.items[1],
        createItem('new-item', '追加商品', 4),
      ],
    }
    const reconciled = reconcileShoppingSession(
      updated,
      {
        checkedState: {
          [original.items[0].id]: 'inCart',
          [original.items[1].id]: 'verified',
          [original.items[2].id]: 'notBuying',
        },
        itemIssues: {},
        cartOrder: [original.items[0].id, original.items[1].id],
      },
      {},
    )

    expect(reconciled.payload.items[0]).toMatchObject({
      quantity: 3,
      memo: '低脂肪',
    })
    expect(reconciled.shoppingState.checkedState).toEqual({
      [original.items[0].id]: 'inCart',
      [original.items[1].id]: 'verified',
    })
    expect(reconciled.shoppingState.cartOrder).toEqual([
      original.items[0].id,
      original.items[1].id,
    ])
    expect(reconciled.shoppingState.checkedState['new-item']).toBeUndefined()
  })
})
