import { describe, expect, it, vi } from 'vitest'
import type { LiveRequestCachedState } from './types'
import {
  liveRequestCacheKey,
  loadLiveRequestCachedState,
  parseLiveRequestCachedState,
  saveLiveRequestCachedState,
} from './storage'

const token = `r1_${'A'.repeat(32)}`

function cachedState(): LiveRequestCachedState {
  return {
    schemaVersion: 1,
    requestToken: token,
    etag: '"revision-1"',
    savedAt: '2026-08-01T00:01:00.000Z',
    pendingChanges: [
      { kind: 'added', itemId: 'item-1', revision: 1 },
    ],
    snapshot: {
      schemaVersion: 1,
      requestId: `v5-${token}`,
      revision: 1,
      createdAt: '2026-08-01T00:00:00.000Z',
      expiresAt: '2026-08-15T00:00:00.000Z',
      updatesCount: 0,
      items: [
        {
          itemId: 'item-1',
          productId: 'milk',
          productNameSnapshot: '牛乳',
          categoryIdSnapshot: 'drinks',
          categoryNameSnapshot: '飲料',
          quantity: 1,
          unit: '本',
          iconSnapshot: '🥛',
          sortOrderSnapshot: 1,
          lifecycle: 'active',
          createdRevision: 1,
          updatedRevision: 1,
        },
      ],
    },
  }
}

describe('live request cache', () => {
  it('round-trips one strict last-known-good snapshot', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    }
    expect(saveLiveRequestCachedState(cachedState(), storage)).toBe(true)
    expect(loadLiveRequestCachedState(token, storage)).toEqual(cachedState())
    expect(values.has(liveRequestCacheKey(token))).toBe(true)
  })

  it('round-trips the maximum 403 one-change-per-item entries', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    }
    const base = cachedState()
    const items = Array.from({ length: 403 }, (_, index) =>
      index < 100
        ? {
            ...base.snapshot.items[0],
            itemId: `item-${index}`,
            lifecycle: 'cancelled-by-requester' as const,
            updatedRevision: index + 2,
            cancelledRevision: index + 2,
          }
        : {
            ...base.snapshot.items[0],
            itemId: `item-${index}`,
          },
    )
    const maximumState: LiveRequestCachedState = {
      ...base,
      etag: '"revision-101"',
      snapshot: {
        ...base.snapshot,
        revision: 101,
        updatesCount: 100,
        items,
      },
      pendingChanges: items.map((item, index) =>
        index < 100
          ? {
              kind: 'cancelled' as const,
              itemId: item.itemId,
              revision: index + 2,
            }
          : {
              kind: 'added' as const,
              itemId: item.itemId,
              revision: 1,
            },
      ),
    }

    expect(saveLiveRequestCachedState(maximumState, storage)).toBe(true)
    expect(loadLiveRequestCachedState(token, storage)).toEqual(maximumState)
  })

  it('rejects corruption, stale ETag, extra keys, and changes for unknown items', () => {
    expect(parseLiveRequestCachedState({}, token)).toBeUndefined()
    expect(
      parseLiveRequestCachedState(
        { ...cachedState(), etag: '"revision-2"' },
        token,
      ),
    ).toBeUndefined()
    expect(
      parseLiveRequestCachedState(
        { ...cachedState(), secret: 'must-not-persist' },
        token,
      ),
    ).toBeUndefined()
    expect(
      parseLiveRequestCachedState(
        {
          ...cachedState(),
          pendingChanges: [
            { kind: 'added', itemId: 'missing', revision: 1 },
          ],
        },
        token,
      ),
    ).toBeUndefined()
    expect(
      parseLiveRequestCachedState(
        {
          ...cachedState(),
          pendingChanges: [
            {
              kind: 'changed',
              itemId: 'item-1',
              revision: 1,
              previousQuantity: 0,
              nextQuantity: 21,
              previousMemo: '',
              nextMemo: 'x'.repeat(31),
            },
          ],
        },
        token,
      ),
    ).toBeUndefined()
  })

  it('fails closed without logging storage errors or contents', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(
      saveLiveRequestCachedState(cachedState(), {
        setItem: () => {
          throw new Error('quota')
        },
      }),
    ).toBe(false)
    expect(
      loadLiveRequestCachedState(token, {
        getItem: () => '{bad-json',
      }),
    ).toBeUndefined()
    expect(
      loadLiveRequestCachedState(token, {
        getItem: () => 'x'.repeat(1_200_001),
      }),
    ).toBeUndefined()
    expect(log).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })
})
