// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  LiveRequestApi,
  LiveRequestGetResult,
  LiveRequestSnapshot,
} from '../features/liveRequests/types'
import { ShoppingListPage } from './ShoppingListPage'

const requestToken = `r1_${'A'.repeat(32)}`
const requestId = `v5-${requestToken}`

function snapshot(input: {
  revision?: number
  quantity?: number
  memo?: string
  lifecycle?: 'active' | 'cancelled-by-requester'
  photoToken?: string
} = {}): LiveRequestSnapshot {
  const revision = input.revision ?? 1
  const lifecycle = input.lifecycle ?? 'active'
  return {
    schemaVersion: 1,
    requestId,
    revision,
    createdAt: '2026-08-01T00:00:00.000Z',
    expiresAt: '2026-08-15T00:00:00.000Z',
    updatesCount: revision - 1,
    items: [
      {
        itemId: 'item-1',
        productId: 'milk',
        productNameSnapshot: '牛乳',
        categoryIdSnapshot: 'dairy',
        categoryNameSnapshot: '乳製品',
        quantity: input.quantity ?? 1,
        unit: '本',
        ...(input.memo ? { memo: input.memo } : {}),
        iconSnapshot: '🥛',
        sortOrderSnapshot: 1,
        ...(input.photoToken ? { photoToken: input.photoToken } : {}),
        lifecycle,
        createdRevision: 1,
        updatedRevision: revision,
        ...(lifecycle === 'cancelled-by-requester'
          ? { cancelledRevision: revision }
          : {}),
      },
    ],
  }
}

describe('ShoppingListPage live request synchronization', () => {
  let container: HTMLDivElement
  let root: Root
  let api: LiveRequestApi

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true
    vi.setSystemTime(new Date('2026-08-02T00:00:00.000Z'))
    window.localStorage.clear()
    Object.defineProperty(window.navigator, 'share', {
      configurable: true,
      value: undefined,
    })
    api = {
      create: vi.fn(),
      patch: vi.fn(),
      get: vi.fn(
        async (): Promise<LiveRequestGetResult> => ({
          status: 'found',
          request: snapshot(),
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
    delete (window.navigator as unknown as Record<string, unknown>).share
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  async function renderPage(
    productPhotoConfig = {
      enabled: false,
      endpoint: '',
      turnstileSiteKey: '',
    },
    currentRequestToken = requestToken,
  ): Promise<void> {
    await act(async () => {
      root.render(
        <ShoppingListPage
          encodedPayload={currentRequestToken}
          payloadCodec="compact-path"
          onBackHome={() => undefined}
          onError={(title, description) => {
            throw new Error(`${title}: ${description}`)
          }}
          liveRequestToken={currentRequestToken}
          liveRequestApi={api}
          productPhotoConfig={productPhotoConfig}
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  function button(label: string): HTMLButtonElement {
    const result = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (candidate) => candidate.textContent?.trim() === label,
    )
    if (!result) throw new Error(`Button was not rendered: ${label}`)
    return result
  }

  async function click(element: Element): Promise<void> {
    await act(async () => {
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  function storedProgress(): Record<string, string> {
    return JSON.parse(
      window.localStorage.getItem(`otsukai:checked:${requestId}`) ?? '{}',
    ) as Record<string, string>
  }

  function serveLatest(next: LiveRequestSnapshot) {
    vi.mocked(api.get).mockImplementation(async (_, options) =>
      options?.etag === `"revision-${next.revision}"`
        ? { status: 'not-modified', etag: `"revision-${next.revision}"` }
        : { status: 'found', request: next, etag: `"revision-${next.revision}"` },
    )
  }

  function reviewButton(): HTMLButtonElement {
    return container.querySelector<HTMLButtonElement>('button[aria-label="牛乳の変更内容を確認"]')!
  }

  async function confirmDialog() {
    const dialog = container.querySelector('[role="dialog"]')!
    for (const checkbox of dialog.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
      if (!checkbox.checked) await click(checkbox)
    }
    const confirm = [...dialog.querySelectorAll<HTMLButtonElement>('button')].find(
      (candidate) => candidate.textContent?.includes('かご済みにする'),
    )!
    expect(confirm.disabled).toBe(false)
    await click(confirm)
  }

  async function focusRefresh() {
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  it('shows additions and changes while preserving in-cart progress', async () => {
    await renderPage()
    expect(container.textContent).toContain('牛乳')
    await click(button('1本をかごに入れる'))
    expect(storedProgress()['item-1']).toBe('inCart')

    const next = snapshot({ revision: 2, quantity: 2, memo: '低脂肪' })
    next.items.push({
      ...next.items[0],
      itemId: 'item-2',
      productId: 'eggs',
      productNameSnapshot: '卵',
      quantity: 1,
      unit: 'パック',
      memo: undefined,
      iconSnapshot: '🥚',
      sortOrderSnapshot: 2,
      createdRevision: 2,
      updatedRevision: 2,
    })
    vi.mocked(api.get).mockResolvedValueOnce({
      status: 'found',
      request: next,
      etag: '"revision-2"',
    })
    await click(button('更新を確認'))

    expect(container.textContent).toContain('数量 1 → 2')
    expect(container.textContent).toContain('条件「なし」→「低脂肪」')
    expect(container.textContent).toContain('追加されました')
    expect(container.textContent).toContain('卵')
    expect(container.querySelector('.live-request-change.is-strong')).not.toBeNull()
    expect(storedProgress()['item-1']).toBe('inCart')
  })

  it('keeps a requester cancellation as history with progress-specific wording', async () => {
    await renderPage()
    await click(button('1本をかごに入れる'))
    vi.mocked(api.get).mockResolvedValueOnce({
      status: 'found',
      request: snapshot({
        revision: 2,
        lifecycle: 'cancelled-by-requester',
      }),
      etag: '"revision-2"',
    })
    await click(button('更新を確認'))

    expect(container.textContent).toContain('依頼者が取り消した商品（1件）')
    expect(container.textContent).toContain('かごに入れた後に取り消されました')
    expect(storedProgress()['item-1']).toBe('inCart')
    expect(container.textContent).toContain('表示できる商品がありません')
  })

  it('keeps the last snapshot usable after a network failure or expiry', async () => {
    await renderPage()
    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'))
    await click(button('更新を確認'))
    expect(container.textContent).toContain('最新状態を確認できません')
    expect(container.textContent).toContain('牛乳')

    vi.mocked(api.get).mockResolvedValueOnce({ status: 'expired' })
    await click(button('更新を確認'))
    expect(container.textContent).toContain('共有期限が切れました')
    expect(container.textContent).toContain('牛乳')
    await click(button('1本をかごに入れる'))
    expect(storedProgress()['item-1']).toBe('inCart')
  })

  it('continues live text synchronization when photo retrieval fails', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      status: 'found',
      request: snapshot({ photoToken: `p1_${'C'.repeat(32)}` }),
      etag: '"revision-1"',
    })
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('photo offline'))
    await renderPage({
      enabled: true,
      endpoint: 'https://worker.example/',
      turnstileSiteKey: 'public-site-key',
    })

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(container.textContent).toContain('写真を取得できませんでした')
    expect(container.textContent).toContain('牛乳')
    expect(button('1本をかごに入れる').disabled).toBe(false)
  })

  it('requires the latest quantity even when a previously verified item changes to one', async () => {
    serveLatest(snapshot({ memo: '低脂肪' }))
    await renderPage()
    await click(button('1本をかごに入れる'))
    await confirmDialog()
    expect(storedProgress()['item-1']).toBe('verified')

    serveLatest(snapshot({ revision: 2, quantity: 1, memo: '無脂肪' }))
    await click(button('更新を確認'))
    await click(button('会計前チェックへ'))
    expect(button('買い物を終了する').disabled).toBe(true)
    await click(reviewButton())
    expect(container.querySelectorAll('[role="dialog"] input[type="checkbox"]')).toHaveLength(2)
    await confirmDialog()
    expect(container.textContent).not.toContain('未確認の変更が')
    await click(button('買い物を終了する'))
    expect(container.textContent).toContain('おつかい完了')
  })

  it('does not let a quantity-only update reuse the cart state without checking', async () => {
    await renderPage()
    await click(button('1本をかごに入れる'))
    serveLatest(snapshot({ revision: 2, quantity: 3 }))
    await click(button('更新を確認'))
    await click(button('会計前チェックへ'))
    expect(button('買い物を終了する').disabled).toBe(true)
    await click(reviewButton())
    expect(button('3本をかご済みにする').disabled).toBe(true)
    await confirmDialog()
    expect(storedProgress()['item-1']).toBe('inCart')
    expect(button('買い物を終了する').disabled).toBe(false)
  })

  it('invalidates a checked dialog when its quantity or condition changes', async () => {
    serveLatest(snapshot({ quantity: 2, memo: '低脂肪' }))
    await renderPage()
    await click(button('2本をかごに入れる'))
    for (const checkbox of container.querySelectorAll<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')) {
      await click(checkbox)
    }
    serveLatest(snapshot({ revision: 2, quantity: 3, memo: '無脂肪' }))
    await focusRefresh()
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(storedProgress()['item-1']).toBeUndefined()
    await click(button('3本をかごに入れる'))
    expect(button('確認してかご済みにする').disabled).toBe(true)
    await confirmDialog()
    expect(storedProgress()['item-1']).toBe('verified')
  })

  it('invalidates a checked dialog on requester cancellation', async () => {
    serveLatest(snapshot({ quantity: 2 }))
    await renderPage()
    await click(button('2本をかごに入れる'))
    await click(container.querySelector('[role="dialog"] input[type="checkbox"]')!)
    serveLatest(snapshot({ revision: 2, quantity: 2, lifecycle: 'cancelled-by-requester' }))
    await focusRefresh()
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(storedProgress()['item-1']).toBeUndefined()
  })

  it('keeps confirmation checks for an unrelated addition and retains that new item reminder', async () => {
    const original = snapshot({ quantity: 2 })
    serveLatest(original)
    await renderPage()
    await click(button('2本をかごに入れる'))
    await click(container.querySelector('[role="dialog"] input[type="checkbox"]')!)
    const next = { ...original, revision: 2, updatesCount: 1, items: [
      original.items[0], { ...original.items[0], itemId: 'item-2', productId: 'eggs',
        productNameSnapshot: '卵', quantity: 1, createdRevision: 2, updatedRevision: 2 },
    ] }
    serveLatest(next)
    await focusRefresh()
    expect(container.querySelector<HTMLInputElement>('[role="dialog"] input')!.checked).toBe(true)
    await confirmDialog()
    expect(container.textContent).toContain('未確認の変更が1件')
    expect(storedProgress()['item-1']).toBe('inCart')
  })

  it('checks for new items when entering checkout and again immediately before finishing', async () => {
    await renderPage()
    await click(button('1本をかごに入れる'))
    serveLatest(snapshot())
    await click(button('会計前チェックへ'))
    expect(api.get).toHaveBeenCalledTimes(2)
    const next = snapshot({ revision: 2 })
    next.items[0].updatedRevision = 1
    next.items.push({ ...next.items[0], itemId: 'item-2', productId: 'eggs',
      productNameSnapshot: '卵', createdRevision: 2, updatedRevision: 2 })
    serveLatest(next)
    await click(button('買い物を終了する'))
    expect(container.textContent).not.toContain('おつかい完了')
    expect(container.textContent).toContain('卵')
    expect(container.textContent).toContain('未処理の商品')
    expect(storedProgress()['item-1']).toBe('inCart')
  })

  it('requires explicit cancellation handling for a cart item before completing other purchases', async () => {
    const original = snapshot()
    original.items.push({ ...original.items[0], itemId: 'item-2', productId: 'eggs',
      productNameSnapshot: '卵' })
    serveLatest(original)
    await renderPage()
    const cartButtons = [...container.querySelectorAll<HTMLButtonElement>('button')].filter(
      (candidate) => candidate.textContent === '1本をかごに入れる',
    )
    await click(cartButtons[0])
    await click(cartButtons[1])
    serveLatest({ ...original, revision: 2, updatesCount: 1, items: [
      { ...original.items[0], lifecycle: 'cancelled-by-requester', cancelledRevision: 2, updatedRevision: 2 },
      original.items[1],
    ] })
    await click(button('会計前チェックへ'))
    expect(button('買い物を終了する').disabled).toBe(true)
    await click(button('取消への対応を確認しました'))
    expect(storedProgress()['item-1']).toBe('inCart')
    await click(button('買い物を終了する'))
    expect(container.textContent).toContain('おつかい完了')
  })

  it('retains unresolved updates and cart progress after reload', async () => {
    await renderPage()
    await click(button('1本をかごに入れる'))
    serveLatest(snapshot({ revision: 2, quantity: 2 }))
    await click(button('更新を確認'))
    act(() => root.unmount())
    root = createRoot(container)
    await renderPage()
    expect(container.textContent).toContain('数量 1 → 2')
    expect(storedProgress()['item-1']).toBe('inCart')
    await click(button('会計前チェックへ'))
    expect(button('買い物を終了する').disabled).toBe(true)
  })

  it('keeps cart updates actionable under the remaining-only filter and never offers an offline bypass', async () => {
    await renderPage()
    await click(button('1本をかごに入れる'))
    await click(button('未購入・相談中だけ表示'))
    serveLatest(snapshot({ revision: 2, quantity: 2 }))
    await click(button('更新を確認'))
    expect(container.textContent).toContain('表示できる商品がありません')
    expect(reviewButton()).not.toBeNull()
    vi.mocked(api.get).mockRejectedValue(new Error('offline'))
    await click(button('会計前チェックへ'))
    expect(button('買い物を終了する').disabled).toBe(true)
    expect(container.textContent).not.toContain('最新未確認のまま保存済みのリストで終了する')
    await click(reviewButton())
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
  })

  it('requires quantity reconfirmation after a condition is removed from an already verified item', async () => {
    serveLatest(snapshot({ memo: '低脂肪' }))
    await renderPage()
    await click(button('1本をかごに入れる'))
    await confirmDialog()
    serveLatest(snapshot({ revision: 2 }))
    await click(button('更新を確認'))
    await click(reviewButton())
    expect(container.querySelectorAll('[role="dialog"] input[type="checkbox"]')).toHaveLength(1)
    expect(button('1本をかご済みにする').disabled).toBe(true)
    await confirmDialog()
    expect(container.textContent).not.toContain('未確認の変更が')
  })

  it('requires an explicit offline finish choice without erasing the snapshot or claiming freshness', async () => {
    await renderPage()
    await click(button('1本をかごに入れる'))
    vi.mocked(api.get).mockRejectedValue(new Error('offline'))
    await click(button('会計前チェックへ'))
    expect(container.textContent).toContain('最新状態を確認できません')
    expect(container.textContent).not.toContain('最新未確認のまま保存済みのリストで終了する')
    await click(button('買い物を終了する'))
    expect(container.textContent).not.toContain('おつかい完了')
    await click(button('最新未確認のまま保存済みのリストで終了する'))
    expect(container.textContent).toContain('おつかい完了')
    expect(container.textContent).toContain('最新の依頼は未確認です')
    expect(storedProgress()['item-1']).toBe('inCart')
  })

  it('cannot resurrect an older verified cart check by undoing a changed-item not-buying decision', async () => {
    serveLatest(snapshot({ memo: '低脂肪' }))
    await renderPage()
    await click(button('1本をかごに入れる'))
    await confirmDialog()
    serveLatest(snapshot({ revision: 2, quantity: 3, memo: '無脂肪' }))
    await click(button('更新を確認'))
    await click(reviewButton())
    await click(button('相談する'))
    await click(container.querySelector('input[value="soldOut"]')!)
    await click(button('今回は買わない'))
    expect(container.textContent).not.toContain('未確認の変更が')
    await click(button('元に戻す'))
    expect(storedProgress()['item-1']).toBe('pending')
    expect(container.textContent).toContain('最新の数量・条件を確認してください')
    await click(button('3本をかごに入れる'))
    expect(button('確認してかご済みにする').disabled).toBe(true)
    await confirmDialog()
    await click(button('会計前チェックへ'))
    await click(button('買い物を終了する'))
    expect(container.textContent).toContain('おつかい完了')
  })

  it('invalidates an older cart Undo even when the update was acknowledged after the decision', async () => {
    await renderPage()
    await click(button('1本をかごに入れる'))
    await click(button('質問・買わない'))
    await click(container.querySelector('input[value="soldOut"]')!)
    await click(button('今回は買わない'))
    serveLatest(snapshot({ revision: 2, quantity: 3 }))
    await click(button('更新を確認'))
    await click(reviewButton())
    await click(button('元に戻す'))
    expect(storedProgress()['item-1']).toBe('pending')
    await click(button('3本をかごに入れる'))
    expect(button('3本をかご済みにする').disabled).toBe(true)
  })

  it('preserves ordinary Undo for an unchanged live cart item', async () => {
    await renderPage()
    await click(button('1本をかごに入れる'))
    await click(button('質問・買わない'))
    await click(container.querySelector('input[value="soldOut"]')!)
    await click(button('今回は買わない'))
    await click(button('元に戻す'))
    expect(storedProgress()['item-1']).toBe('inCart')
  })

  it('blocks the finish button and merges double clicks into one in-flight checkout check', async () => {
    await renderPage()
    await click(button('1本をかごに入れる'))
    serveLatest(snapshot())
    await click(button('会計前チェックへ'))
    let resolve!: (value: LiveRequestGetResult) => void
    vi.mocked(api.get).mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    const finish = button('買い物を終了する')
    await act(async () => {
      finish.click()
      finish.click()
      await Promise.resolve()
    })
    expect(api.get).toHaveBeenCalledTimes(3)
    expect(button('買い物を終了する').disabled).toBe(true)
    await act(async () => resolve({ status: 'not-modified', etag: '"revision-1"' }))
    expect(container.textContent).toContain('おつかい完了')
  })

  it('returns from completion when a later request update arrives', async () => {
    await renderPage()
    await click(button('1本をかごに入れる'))
    serveLatest(snapshot())
    await click(button('会計前チェックへ'))
    await click(button('買い物を終了する'))
    expect(container.textContent).toContain('おつかい完了')
    serveLatest(snapshot({ revision: 2, quantity: 2 }))
    await focusRefresh()
    expect(container.textContent).not.toContain('おつかい完了')
    expect(container.textContent).toContain('数量 1 → 2')
  })

  it('does not complete another request when an older checkout refresh is interrupted by navigation', async () => {
    await renderPage()
    await click(button('1本をかごに入れる'))
    await click(button('会計前チェックへ'))
    let resolve!: (result: LiveRequestGetResult) => void
    vi.mocked(api.get).mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    await act(async () => {
      button('買い物を終了する').click()
      await Promise.resolve()
    })
    const nextToken = `r1_${'B'.repeat(32)}`
    const nextRequestId = `v5-${nextToken}`
    window.localStorage.setItem(`otsukai:checked:${nextRequestId}`, JSON.stringify({ 'item-1': 'inCart' }))
    vi.mocked(api.get).mockResolvedValue({
      status: 'found', request: { ...snapshot(), requestId: nextRequestId }, etag: '"revision-1"',
    })
    await renderPage(undefined, nextToken)
    await act(async () => {
      resolve({ status: 'not-modified', etag: '"revision-1"' })
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(container.textContent).not.toContain('おつかい完了')
    expect(JSON.parse(window.localStorage.getItem(`otsukai:checked:${nextRequestId}`)!)).toEqual({ 'item-1': 'inCart' })
    expect(storedProgress()['item-1']).toBe('inCart')
  })
})
