// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  LiveRequestApi,
  LiveRequestGetResult,
  LiveRequestSnapshot,
} from './types'
import { useLiveRequestSync } from './useLiveRequestSync'

const token = `r1_${'A'.repeat(32)}`
let currentTime = Date.parse('2026-08-01T00:02:00.000Z')
const fixedNow = () => currentTime

function snapshot(
  revision: number,
  quantity = 1,
  requestToken = token,
): LiveRequestSnapshot {
  return {
    schemaVersion: 1,
    requestId: `v5-${requestToken}`,
    revision,
    createdAt: '2026-08-01T00:00:00.000Z',
    expiresAt: '2026-08-15T00:00:00.000Z',
    updatesCount: revision - 1,
    items: [
      {
        itemId: 'item-1',
        productId: 'milk',
        productNameSnapshot: '牛乳',
        categoryIdSnapshot: 'drinks',
        categoryNameSnapshot: '飲料',
        quantity,
        unit: '本',
        iconSnapshot: '🥛',
        sortOrderSnapshot: 1,
        lifecycle: 'active',
        createdRevision: 1,
        updatedRevision: revision,
      },
    ],
  }
}

describe('useLiveRequestSync', () => {
  let root: Root
  let container: HTMLDivElement
  let sync: ReturnType<typeof useLiveRequestSync>
  let api: LiveRequestApi
  let requestToken: string
  let storage: Storage

  function Harness() {
    sync = useLiveRequestSync({
      enabled: true,
      requestToken,
      api,
      pollIntervalMs: 45_000,
      now: fixedNow,
      storage,
    })
    return null
  }

  beforeEach(() => {
    vi.useFakeTimers()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true
    window.localStorage.clear()
    storage = {
      getItem: (key: string) => window.localStorage.getItem(key),
      setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
    } as Storage
    currentTime = Date.parse('2026-08-01T00:02:00.000Z')
    requestToken = token
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
    api = {
      create: vi.fn(),
      patch: vi.fn(),
      get: vi.fn(
        async (): Promise<LiveRequestGetResult> => ({
          status: 'found',
          request: snapshot(1),
          etag: '"revision-1"',
        }),
      ),
    }
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    window.localStorage.clear()
    vi.useRealTimers()
  })

  async function mount() {
    await act(async () => {
      root.render(<Harness />)
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  it('stores the last successful snapshot and keeps it on fetch failure', async () => {
    await mount()
    expect(sync.status).toBe('current')
    expect(sync.snapshot?.revision).toBe(1)
    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'))

    await act(async () => sync.refresh())

    expect(sync.status).toBe('stale')
    expect(sync.snapshot?.items[0].productNameSnapshot).toBe('牛乳')
  })

  it('polls every 45 seconds, stops while hidden, and refreshes on visible/focus', async () => {
    await mount()
    expect(api.get).toHaveBeenCalledTimes(1)
    await act(async () => vi.advanceTimersByTimeAsync(45_000))
    expect(api.get).toHaveBeenCalledTimes(2)

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    await act(async () => vi.advanceTimersByTimeAsync(90_000))
    expect(api.get).toHaveBeenCalledTimes(2)

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
    await act(async () =>
      document.dispatchEvent(new Event('visibilitychange')),
    )
    expect(api.get).toHaveBeenCalledTimes(3)
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(api.get).toHaveBeenCalledTimes(4)
  })

  it('retains changes until explicit acknowledgement and uses 304', async () => {
    await mount()
    vi.mocked(api.get).mockResolvedValueOnce({
      status: 'found',
      request: snapshot(2, 2),
      etag: '"revision-2"',
    })
    await act(async () => sync.refresh())
    expect(sync.pendingChanges).toHaveLength(1)
    expect(sync.pendingChanges[0].kind).toBe('changed')

    act(() => sync.acknowledgeChanges())
    expect(sync.pendingChanges).toEqual([])
    vi.mocked(api.get).mockResolvedValueOnce({
      status: 'not-modified',
      etag: '"revision-2"',
    })
    await act(async () => sync.refresh())
    expect(api.get).toHaveBeenLastCalledWith(token, {
      etag: '"revision-2"',
      signal: expect.any(AbortSignal),
    })
  })

  it('retains a cached snapshot after expiry', async () => {
    await mount()
    vi.mocked(api.get).mockResolvedValueOnce({ status: 'expired' })
    await act(async () => sync.refresh())
    expect(sync.status).toBe('expired')
    expect(sync.snapshot?.revision).toBe(1)
  })

  it('reports an expired cached snapshot when an alarm-deleted request returns missing', async () => {
    await mount()
    currentTime = Date.parse('2026-08-15T00:00:00.000Z')
    vi.mocked(api.get).mockResolvedValueOnce({ status: 'missing' })

    await act(async () => sync.refresh())

    expect(sync.status).toBe('expired')
    expect(sync.snapshot?.revision).toBe(1)
  })

  it('reports an expired cached snapshot when transport fails after expiry', async () => {
    await mount()
    currentTime = Date.parse('2026-08-15T00:00:00.000Z')
    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'))

    await act(async () => sync.refresh())

    expect(sync.status).toBe('expired')
    expect(sync.snapshot?.revision).toBe(1)
  })

  it('drops the previous request snapshot and ETag when the token changes', async () => {
    await mount()
    const nextToken = `r1_${'B'.repeat(32)}`
    vi.mocked(api.get).mockImplementation(async (receivedToken, options) => {
      expect(receivedToken).toBe(nextToken)
      expect(options?.etag).toBeUndefined()
      return {
        status: 'found',
        request: snapshot(1, 2, nextToken),
        etag: '"revision-1"',
      }
    })

    requestToken = nextToken
    await act(async () => {
      root.render(<Harness />)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(sync.snapshot?.requestId).toBe(`v5-${nextToken}`)
    expect(sync.snapshot?.items[0].quantity).toBe(2)
  })

  it('returns the fresh state and shares an in-flight refresh', async () => {
    await mount()
    let resolve!: (value: LiveRequestGetResult) => void
    vi.mocked(api.get).mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    let first!: ReturnType<typeof sync.refresh>
    let second!: ReturnType<typeof sync.refresh>
    act(() => {
      first = sync.refresh()
      second = sync.refresh()
    })
    expect(second).toBe(first)
    await act(async () => {
      resolve({status: 'found', request: snapshot(2, 2), etag: '"revision-2"'})
      const result = await first
      expect(result.snapshot?.revision).toBe(2)
      expect(result.pendingChanges).toHaveLength(1)
      expect(result.status).toBe('current')
    })
    expect(api.get).toHaveBeenCalledTimes(2)
  })

  it('acknowledges only the selected item through the reviewed revision', async () => {
    await mount()
    const next = snapshot(2, 2)
    next.items.push({ ...next.items[0], itemId: 'item-2', productId: 'eggs',
      createdRevision: 2, updatedRevision: 2 })
    vi.mocked(api.get).mockResolvedValueOnce({status: 'found', request: next, etag: '"revision-2"'})
    await act(async () => { await sync.refresh() })
    act(() => sync.acknowledgeChanges('item-1', 1))
    expect(sync.pendingChanges).toHaveLength(2)
    act(() => sync.acknowledgeChanges('item-1', 2))
    expect(sync.pendingChanges.map((change) => change.itemId)).toEqual(['item-2'])
    const cache = JSON.parse(window.localStorage.getItem(`otsukai:liveRequest:v1:${token}`)!)
    expect(cache.pendingChanges.map((change: {itemId: string}) => change.itemId)).toEqual(['item-2'])
  })

  it('retains the reminder when acknowledgement cannot be persisted', async () => {
    await mount()
    vi.mocked(api.get).mockResolvedValueOnce({status: 'found', request: snapshot(2, 2), etag: '"revision-2"'})
    await act(async () => { await sync.refresh() })
    const spy = vi.spyOn(storage, 'setItem').mockImplementation(() => { throw new Error('full') })
    try {
      act(() => sync.acknowledgeChanges('item-1', 2))
      expect(sync.pendingChanges).toHaveLength(1)
      expect(sync.cachePersistenceFailed).toBe(true)
    } finally {
      spy.mockRestore()
    }
  })

  it('times out a stalled check, preserves progress data and ignores its late response', async () => {
    await mount()
    let resolve!: (value: LiveRequestGetResult) => void
    vi.mocked(api.get).mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    let checking!: ReturnType<typeof sync.refresh>
    act(() => { checking = sync.refresh() })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
      const result = await checking
      expect(result.status).toBe('stale')
      expect(result.snapshot?.revision).toBe(1)
    })
    await act(async () => resolve({status: 'found', request: snapshot(2, 2), etag: '"revision-2"'}))
    expect(sync.snapshot?.revision).toBe(1)
    expect(sync.getCurrentState().status).toBe('stale')
  })
})
