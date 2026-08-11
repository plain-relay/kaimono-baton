// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { products } from '../data/products'
import type {
  LiveRequestApi,
  LiveRequestNewItem,
  LiveRequestSnapshot,
} from '../features/liveRequests/types'
import { decodeShoppingSessionPayload } from '../utils/shoppingSession'
import { CreateRequestPage } from './CreateRequestPage'

const requestToken = `r1_${'A'.repeat(32)}`
const editSecret = `e1_${'B'.repeat(43)}`
const milk = products.find((product) => product.id === 'milk')!

const enabledLiveConfig = {
  enabled: true,
  endpoint: 'https://worker.example/',
  turnstileSiteKey: 'public-site-key',
} as const

const disabledLiveConfig = {
  enabled: false,
  endpoint: '',
  turnstileSiteKey: '',
} as const

const disabledPhotoConfig = {
  enabled: false,
  endpoint: '',
  turnstileSiteKey: '',
} as const

function createdSnapshot(): LiveRequestSnapshot {
  return {
    schemaVersion: 1,
    requestId: `v5-${requestToken}`,
    revision: 1,
    createdAt: '2026-08-01T00:00:00.000Z',
    expiresAt: '2026-08-15T00:00:00.000Z',
    updatesCount: 0,
    items: [],
  }
}

describe('CreateRequestPage live request sharing', () => {
  let container: HTMLDivElement
  let root: Root
  let share: ReturnType<typeof vi.fn<(data: ShareData) => Promise<void>>>
  let writeText: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>
  let api: LiveRequestApi

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true
    window.localStorage.clear()
    window.history.replaceState({}, '', '/#/create')
    share = vi.fn(async () => undefined)
    writeText = vi.fn(async () => undefined)
    Object.defineProperty(window.navigator, 'share', {
      configurable: true,
      value: share,
    })
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    api = {
      create: vi.fn(async (items: readonly LiveRequestNewItem[]) => ({
        requestToken,
        editSecret,
        request: { ...createdSnapshot(), items: items.map((item) => ({
          ...item,
          lifecycle: 'active' as const,
          createdRevision: 1,
          updatedRevision: 1,
        })) },
      })),
      get: vi.fn(),
      patch: vi.fn(),
    }
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    window.localStorage.clear()
    window.history.replaceState({}, '', '/')
    delete (window.navigator as unknown as Record<string, unknown>).share
    delete (window.navigator as unknown as Record<string, unknown>).clipboard
    vi.restoreAllMocks()
  })

  async function renderPage(enabled = true): Promise<void> {
    await act(async () => {
      root.render(
        <CreateRequestPage
          onBackHome={() => undefined}
          productPhotoConfig={disabledPhotoConfig}
          liveRequestConfig={enabled ? enabledLiveConfig : disabledLiveConfig}
          liveRequestApi={api}
          createLiveRequestItemId={() => 'live-item-1'}
        />,
      )
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

  async function selectMilk(): Promise<void> {
    const increase = container.querySelector<HTMLButtonElement>(
      `button[aria-label^="${milk.name}を1${milk.unit}増やす"]`,
    )
    if (!increase) throw new Error('Milk increase button was not rendered')
    await click(increase)
  }

  function sharedUrl(): string {
    return share.mock.calls[0]?.[0].text?.split('\n').at(-1) ?? ''
  }

  it('keeps the live choice hidden and shares v3 when the flag is off', async () => {
    await renderPage(false)
    expect(container.textContent).not.toContain('あとから追加・変更できる依頼')

    await selectMilk()
    await click(button('確認へ'))
    await click(button('LINEで送る'))

    expect(api.create).not.toHaveBeenCalled()
    const url = sharedUrl()
    expect(url).toContain('#/l/')
    expect(
      decodeShoppingSessionPayload({
        encodedPayload: new URL(url).hash.slice('#/l/'.length),
        codec: 'compact-path',
      }).requestId,
    ).toMatch(/^v3-/)
  })

  it('uses v5 only after explicit selection and never shares the edit secret', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(
      Date.parse('2026-08-01T00:00:00.000Z'),
    )
    await renderPage()
    const liveChoice = container.querySelector<HTMLInputElement>(
      'input[name="request-sharing-mode"][value="live"]',
    )
    if (!liveChoice) throw new Error('Live request choice was not rendered')
    await click(liveChoice)
    await selectMilk()
    await click(button('確認へ'))

    expect(api.create).not.toHaveBeenCalled()
    await click(button('更新可能な依頼をLINEで送る'))

    expect(api.create).toHaveBeenCalledTimes(1)
    expect(api.create).toHaveBeenCalledWith([
      expect.objectContaining({
        itemId: 'live-item-1',
        productId: 'milk',
        quantity: 1,
      }),
    ])
    expect(sharedUrl()).toContain(`#/r/${requestToken}`)
    expect(sharedUrl()).not.toContain(editSecret)
    expect(share.mock.calls[0][0].text).not.toContain('/manage/')

    const managementField = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="依頼者用の管理リンク"]',
    )
    expect(managementField?.value).toContain(
      `#/manage/${requestToken}/${editSecret}`,
    )
    await click(button('管理リンクをコピー'))
    expect(writeText).toHaveBeenCalledWith(managementField?.value)

    expect(JSON.stringify(window.history.state)).not.toContain(editSecret)
    const storedValues = Array.from(
      { length: window.localStorage.length },
      (_, index) => {
        const key = window.localStorage.key(index) ?? ''
        return `${key}:${window.localStorage.getItem(key) ?? ''}`
      },
    ).join('\n')
    expect(storedValues).not.toContain(editSecret)

    await click(button('更新可能な依頼をLINEで送る'))
    expect(api.create).toHaveBeenCalledTimes(1)
  })

  it('creates a new v5 request after reload because the management capability is not persisted', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(
      Date.parse('2026-08-01T00:00:00.000Z'),
    )
    await renderPage()
    const liveChoice = container.querySelector<HTMLInputElement>(
      'input[name="request-sharing-mode"][value="live"]',
    )!
    await click(liveChoice)
    await selectMilk()
    await click(button('確認へ'))
    await click(button('更新可能な依頼をLINEで送る'))
    expect(api.create).toHaveBeenCalledTimes(1)

    act(() => root.unmount())
    root = createRoot(container)
    await renderPage()
    expect(container.textContent).not.toContain('依頼者用の管理リンク')
    await click(button('修正する'))
    const restoredLiveChoice = container.querySelector<HTMLInputElement>(
      'input[name="request-sharing-mode"][value="live"]',
    )!
    await click(restoredLiveChoice)
    await click(button('確認へ'))
    await click(button('更新可能な依頼をLINEで送る'))

    expect(api.create).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('依頼者用の管理リンク')
  })

  it('does not reuse an expired v5 request in the same browser session', async () => {
    const now = vi
      .spyOn(Date, 'now')
      .mockReturnValue(Date.parse('2026-08-01T00:00:00.000Z'))
    await renderPage()
    const liveChoice = container.querySelector<HTMLInputElement>(
      'input[name="request-sharing-mode"][value="live"]',
    )!
    await click(liveChoice)
    await selectMilk()
    await click(button('確認へ'))
    await click(button('更新可能な依頼をLINEで送る'))
    expect(api.create).toHaveBeenCalledTimes(1)

    now.mockReturnValue(Date.parse('2026-08-15T00:00:00.000Z'))
    await click(button('更新可能な依頼をLINEで送る'))

    expect(api.create).toHaveBeenCalledTimes(2)
  })

  it('keeps fixed mode as the default even when live requests are configured', async () => {
    await renderPage()
    const fixedChoice = container.querySelector<HTMLInputElement>(
      'input[name="request-sharing-mode"][value="fixed"]',
    )
    expect(fixedChoice?.checked).toBe(true)

    await selectMilk()
    await click(button('確認へ'))
    await click(button('LINEで送る'))

    expect(api.create).not.toHaveBeenCalled()
    expect(sharedUrl()).toContain('#/l/')
  })
})
