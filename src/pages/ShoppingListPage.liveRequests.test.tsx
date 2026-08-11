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
    vi.restoreAllMocks()
  })

  async function renderPage(
    productPhotoConfig = {
      enabled: false,
      endpoint: '',
      turnstileSiteKey: '',
    },
  ): Promise<void> {
    await act(async () => {
      root.render(
        <ShoppingListPage
          encodedPayload={requestToken}
          payloadCodec="compact-path"
          onBackHome={() => undefined}
          onError={(title, description) => {
            throw new Error(`${title}: ${description}`)
          }}
          liveRequestToken={requestToken}
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

  it('shows additions and changes while preserving in-cart progress', async () => {
    await renderPage()
    expect(container.textContent).toContain('牛乳')
    await click(button('かごに入れる'))
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
    await click(button('かごに入れる'))
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
    await click(button('かごに入れる'))
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
    expect(button('かごに入れる').disabled).toBe(false)
  })
})
