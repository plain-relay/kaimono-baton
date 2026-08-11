import { describe, expect, it } from 'vitest'
import {
  cancelledItemMessage,
  describeLiveRequestChange,
  liveRequestToShoppingPayload,
} from './shopping'
import type { LiveRequestSnapshot } from './types'

describe('live request shopping projection', () => {
  it('projects lifecycle metadata without changing item identity', () => {
    const snapshot: LiveRequestSnapshot = {
      schemaVersion: 1,
      requestId: `v5-r1_${'A'.repeat(32)}`,
      revision: 2,
      createdAt: '2026-08-01T00:00:00.000Z',
      expiresAt: '2026-08-15T00:00:00.000Z',
      updatesCount: 1,
      items: [
        {
          itemId: 'item-1',
          productId: 'milk',
          productNameSnapshot: '牛乳',
          categoryIdSnapshot: 'drinks',
          categoryNameSnapshot: '飲料',
          quantity: 2,
          unit: '本',
          iconSnapshot: '🥛',
          sortOrderSnapshot: 1,
          lifecycle: 'cancelled-by-requester',
          createdRevision: 1,
          updatedRevision: 2,
          cancelledRevision: 2,
        },
      ],
    }
    expect(liveRequestToShoppingPayload(snapshot)).toMatchObject({
      requestId: snapshot.requestId,
      items: [
        {
          id: 'item-1',
          liveLifecycle: 'cancelled-by-requester',
          liveUpdatedRevision: 2,
        },
      ],
    })
  })

  it('uses progress-specific cancellation wording', () => {
    expect(cancelledItemMessage('pending')).toBe('依頼者が取り消しました')
    expect(cancelledItemMessage('inCart')).toContain('かごに入れた後')
    expect(cancelledItemMessage('verified')).toContain('購入確認後')
    expect(cancelledItemMessage('consulting')).toContain('相談中')
    expect(cancelledItemMessage('pending', true)).toContain('相談中')
    expect(cancelledItemMessage('notBuying')).toContain('履歴')
  })

  it('describes quantity and condition changes without a reason field', () => {
    expect(
      describeLiveRequestChange({
        kind: 'changed',
        itemId: 'item-1',
        revision: 2,
        previousQuantity: 1,
        nextQuantity: 2,
        previousMemo: '',
        nextMemo: '低脂肪',
      }),
    ).toBe('数量 1 → 2 / 条件「なし」→「低脂肪」')
  })
})
