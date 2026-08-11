// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiveRequestApiError } from '../features/liveRequests/api'
import type {
  LiveRequestApi,
  LiveRequestOperation,
  LiveRequestSnapshot,
} from '../features/liveRequests/types'
import { LiveRequestManagePage } from './LiveRequestManagePage'

const requestToken = `r1_${'A'.repeat(32)}`
const editSecret = `e1_${'B'.repeat(43)}`
const enabledConfig = {
  enabled: true,
  endpoint: 'https://worker.example/',
  turnstileSiteKey: 'public-site-key',
} as const

function snapshot(
  revision = 1,
  quantity = 1,
  memo = '',
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
        categoryIdSnapshot: 'dairy',
        categoryNameSnapshot: '乳製品',
        quantity,
        unit: '本',
        ...(memo ? { memo } : {}),
        iconSnapshot: '🥛',
        sortOrderSnapshot: 1,
        lifecycle: 'active',
        createdRevision: 1,
        updatedRevision: revision,
      },
    ],
  }
}

describe('LiveRequestManagePage', () => {
  let container: HTMLDivElement
  let root: Root
  let api: LiveRequestApi
  let onError: ReturnType<
    typeof vi.fn<(title: string, description: string) => void>
  >

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true
    window.localStorage.clear()
    onError = vi.fn()
    api = {
      create: vi.fn(),
      get: vi.fn(async () => ({
        status: 'found' as const,
        request: snapshot(),
        etag: '"revision-1"',
      })),
      patch: vi.fn(async (_token, _secret, _revision, operations) => ({
        request: applyOperations(snapshot(2), operations),
        etag: '"revision-2"',
      })),
    }
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    window.localStorage.clear()
    delete (window as unknown as Record<string, unknown>).confirm
    vi.restoreAllMocks()
  })

  function applyOperations(
    base: LiveRequestSnapshot,
    operations: readonly LiveRequestOperation[],
  ): LiveRequestSnapshot {
    const operation = operations[0]
    if (!operation) return base
    if (operation.type === 'add') {
      return { ...base, items: [...base.items, {
        ...operation.item,
        lifecycle: 'active',
        createdRevision: base.revision,
        updatedRevision: base.revision,
      }] }
    }
    return {
      ...base,
      items: base.items.map((item) => {
        if (item.itemId !== operation.itemId) return item
        if (operation.type === 'set-quantity') {
          return { ...item, quantity: operation.quantity }
        }
        if (operation.type === 'set-memo') {
          return { ...item, memo: operation.memo || undefined }
        }
        return {
          ...item,
          lifecycle: 'cancelled-by-requester' as const,
          cancelledRevision: base.revision,
        }
      }),
    }
  }

  async function renderPage(enabled = true): Promise<void> {
    await act(async () => {
      root.render(
        <LiveRequestManagePage
          requestToken={requestToken}
          editSecret={editSecret}
          onBackHome={() => undefined}
          onError={onError}
          liveRequestConfig={
            enabled
              ? enabledConfig
              : { enabled: false, endpoint: '', turnstileSiteKey: '' }
          }
          liveRequestApi={api}
          createItemId={() => 'new-item'}
        />,
      )
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

  async function changeInput(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set
    if (!setter) throw new Error('Input setter unavailable')
    await act(async () => {
      setter.call(input, value)
      input.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }))
      await Promise.resolve()
    })
  }

  it('loads the current revision and submits explicit quantity and memo operations', async () => {
    await renderPage()
    expect(container.textContent).toContain('revision 1')

    const quantity = container.querySelector<HTMLInputElement>(
      'input[aria-label="牛乳の新しい数量"]',
    )!
    await changeInput(quantity, '2.9')
    expect(quantity.value).toBe('2')
    await click(button('数量を変更'))
    expect(api.patch).toHaveBeenLastCalledWith(
      requestToken,
      editSecret,
      1,
      [{ type: 'set-quantity', itemId: 'item-1', quantity: 2 }],
    )

    const memo = container.querySelector<HTMLInputElement>(
      'input[aria-label="牛乳の新しい条件"]',
    )!
    await changeInput(memo, '低脂肪')
    await click(button('条件を変更'))
    expect(api.patch).toHaveBeenLastCalledWith(
      requestToken,
      editSecret,
      2,
      [{ type: 'set-memo', itemId: 'item-1', memo: '低脂肪' }],
    )
  })

  it('adds an available catalog product with a new item ID', async () => {
    await renderPage()
    const select = container.querySelector<HTMLSelectElement>('select')!
    const option = [...select.options].find((candidate) => candidate.value)
    if (!option) throw new Error('No catalog item was available')
    await act(async () => {
      select.value = option.value
      select.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })
    const addQuantity = container.querySelector<HTMLInputElement>(
      '.live-request-add-card input[type="number"]',
    )!
    await changeInput(addQuantity, '3.8')
    expect(addQuantity.value).toBe('3')
    await click(button('商品を追加'))

    const operations = vi.mocked(api.patch).mock.calls[0][3]
    expect(operations[0]).toMatchObject({
      type: 'add',
      item: { itemId: 'new-item', productId: option.value, quantity: 3 },
    })
  })

  it('keeps an add selection when the update request fails', async () => {
    vi.mocked(api.patch).mockRejectedValueOnce(new Error('offline'))
    await renderPage()
    const select = container.querySelector<HTMLSelectElement>('select')!
    const option = [...select.options].find((candidate) => candidate.value)
    if (!option) throw new Error('No catalog item was available')
    await act(async () => {
      select.value = option.value
      select.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })

    await click(button('商品を追加'))

    expect(select.value).toBe(option.value)
    expect(container.textContent).toContain('更新サービスへ接続できません')
  })

  it('disables one-time item addition at the existing ten-item ceiling', async () => {
    const maximumCustomItems = Array.from({ length: 10 }, (_, index) => ({
      ...snapshot().items[0],
      itemId: `custom-item-${index}`,
      productId: `custom:one-time-${index}`,
      productNameSnapshot: `自由商品${index}`,
    }))
    vi.mocked(api.get).mockResolvedValueOnce({
      status: 'found',
      request: { ...snapshot(), items: maximumCustomItems },
      etag: '"revision-1"',
    })
    await renderPage()
    const customMode = container.querySelectorAll<HTMLInputElement>(
      'input[name="live-add-mode"]',
    )[1]
    await click(customMode)

    expect(container.textContent).toContain(
      'リストにない商品は10件までです',
    )
    expect(button('商品を追加').disabled).toBe(true)
    expect(api.patch).not.toHaveBeenCalled()
  })

  it('uses a tombstone operation only after the required confirmation', async () => {
    const confirm = vi.fn(() => true)
    Object.defineProperty(window, 'confirm', {
      configurable: true,
      value: confirm,
    })
    await renderPage()
    await click(button('依頼から取り消す'))

    expect(confirm).toHaveBeenCalledWith(
      'すでに購入中または購入済みの可能性があります。依頼から取り消しますか？',
    )
    expect(api.patch).toHaveBeenCalledWith(
      requestToken,
      editSecret,
      1,
      [{ type: 'cancel', itemId: 'item-1' }],
    )
  })

  it('refetches a revision conflict without discarding the pending input', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({
        status: 'found',
        request: snapshot(),
        etag: '"revision-1"',
      })
      .mockResolvedValueOnce({
        status: 'found',
        request: snapshot(2, 2),
        etag: '"revision-2"',
      })
    vi.mocked(api.patch).mockRejectedValueOnce(
      new LiveRequestApiError('conflict', 412),
    )
    await renderPage()
    const quantity = container.querySelector<HTMLInputElement>(
      'input[aria-label="牛乳の新しい数量"]',
    )!
    await changeInput(quantity, '7')
    await click(button('数量を変更'))

    expect(api.get).toHaveBeenCalledTimes(2)
    expect(quantity.value).toBe('7')
    expect(container.textContent).toContain('現在: 2本')
    expect(container.textContent).toContain('最新内容を再取得しました')
  })

  it('does not claim a successful conflict refresh when the refetch fails', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({
        status: 'found',
        request: snapshot(),
        etag: '"revision-1"',
      })
      .mockRejectedValueOnce(new Error('offline'))
    vi.mocked(api.patch).mockRejectedValueOnce(
      new LiveRequestApiError('conflict', 412),
    )
    await renderPage()
    const quantity = container.querySelector<HTMLInputElement>(
      'input[aria-label="牛乳の新しい数量"]',
    )!
    await changeInput(quantity, '7')
    await click(button('数量を変更'))

    expect(quantity.value).toBe('7')
    expect(container.textContent).toContain('更新サービスへ接続できません')
    expect(container.textContent).not.toContain('最新内容を再取得しました')
  })

  it('keeps the management route unavailable while the public flag is off', async () => {
    await renderPage(false)
    expect(api.get).not.toHaveBeenCalled()
    expect(container.textContent).toBe('')
    expect(onError).toHaveBeenCalledWith(
      '依頼の管理機能は現在利用できません',
      expect.stringContaining('通常の固定依頼'),
    )
  })
})
