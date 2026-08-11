import { describe, expect, it } from 'vitest'
import type { LiveRequestSnapshot } from './types'
import { diffLiveRequestSnapshots } from './snapshot'

function snapshot(revision: number): LiveRequestSnapshot {
  return {
    schemaVersion: 1,
    requestId: `v5-r1_${'A'.repeat(32)}`,
    revision,
    createdAt: '2026-08-01T00:00:00.000Z',
    expiresAt: '2026-08-15T00:00:00.000Z',
    updatesCount: revision - 1,
    items: [
      {
        itemId: 'milk-item',
        productId: 'milk',
        productNameSnapshot: '牛乳',
        categoryIdSnapshot: 'drinks',
        categoryNameSnapshot: '飲料',
        quantity: 1,
        unit: '本',
        memo: '低脂肪',
        iconSnapshot: '🥛',
        sortOrderSnapshot: 1,
        lifecycle: 'active',
        createdRevision: 1,
        updatedRevision: 1,
      },
    ],
  }
}

describe('live request snapshot diff', () => {
  it('records added and changed items without moving them from store order', () => {
    const previous = snapshot(1)
    const next = snapshot(2)
    next.items[0] = {
      ...next.items[0],
      quantity: 2,
      memo: '無脂肪',
      updatedRevision: 2,
    }
    next.items.push({
      ...next.items[0],
      itemId: 'eggs-item',
      productId: 'eggs',
      productNameSnapshot: '卵',
      createdRevision: 2,
      updatedRevision: 2,
    })

    expect(diffLiveRequestSnapshots(previous, next)).toEqual([
      {
        kind: 'added',
        itemId: 'eggs-item',
        revision: 2,
      },
      {
        kind: 'changed',
        itemId: 'milk-item',
        revision: 2,
        previousQuantity: 1,
        nextQuantity: 2,
        previousMemo: '低脂肪',
        nextMemo: '無脂肪',
      },
    ])
  })

  it('keeps an unacknowledged change and turns later cancellation into one tombstone change', () => {
    const previous = snapshot(2)
    previous.items[0].quantity = 2
    previous.items[0].updatedRevision = 2
    const next = snapshot(3)
    next.items[0] = {
      ...previous.items[0],
      lifecycle: 'cancelled-by-requester',
      updatedRevision: 3,
      cancelledRevision: 3,
    }

    expect(
      diffLiveRequestSnapshots(previous, next, [
        {
          kind: 'changed',
          itemId: 'milk-item',
          revision: 2,
          previousQuantity: 1,
          nextQuantity: 2,
          previousMemo: '低脂肪',
          nextMemo: '低脂肪',
        },
      ]),
    ).toEqual([
      {
        kind: 'cancelled',
        itemId: 'milk-item',
        revision: 3,
      },
    ])
  })

  it('keeps a newly added item as one pending addition after later edits', () => {
    const previous = snapshot(2)
    const next = snapshot(3)
    next.items[0] = {
      ...next.items[0],
      quantity: 2,
      updatedRevision: 3,
    }

    expect(
      diffLiveRequestSnapshots(previous, next, [
        { kind: 'added', itemId: 'milk-item', revision: 2 },
      ]),
    ).toEqual([
      { kind: 'added', itemId: 'milk-item', revision: 2 },
    ])
  })

  it('ignores equal or older revisions', () => {
    const pending = [
      { kind: 'added' as const, itemId: 'milk-item', revision: 1 },
    ]
    expect(diffLiveRequestSnapshots(snapshot(2), snapshot(2), pending)).toEqual(
      pending,
    )
  })
})
