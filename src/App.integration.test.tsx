// @vitest-environment happy-dom

import { StrictMode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { compressToEncodedURIComponent } from 'lz-string'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import {
  PUBLISHED_V1_REQUEST_FIXTURE,
  PUBLISHED_V2_REQUEST_FIXTURE,
  PUBLISHED_V3_REQUEST_FIXTURE,
} from './testFixtures/publishedFormats'
import { decodeCompactRequestV3 } from './utils/compactRequestV3'

const REQUEST_B_FIXTURE = compressToEncodedURIComponent(
  JSON.stringify([
    3,
    'mounted-route-b',
    'おつかいリスト',
    [[1, 'custom:route-b', '別依頼の商品', '1', '個', 13]],
  ]),
)

describe('mounted App hash routing', () => {
  let container: HTMLDivElement
  let root: Root
  let rootIsMounted: boolean
  let scrollTo: ReturnType<typeof vi.fn>

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true
    window.localStorage.clear()
    window.history.replaceState({}, '', '/#/')
    scrollTo = vi.fn()
    Object.defineProperty(window, 'scrollTo', {
      configurable: true,
      value: scrollTo,
    })
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(
      (callback: FrameRequestCallback) => {
        callback(0)
        return 1
      },
    )
    Object.defineProperty(window.navigator, 'share', {
      configurable: true,
      value: vi.fn(async () => undefined),
    })
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => undefined) },
    })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    rootIsMounted = true
  })

  afterEach(() => {
    if (rootIsMounted) {
      act(() => root.unmount())
    }
    container.remove()
    document.body.style.overflow = ''
    window.localStorage.clear()
    window.history.replaceState({}, '', '/#/')
    delete (window.navigator as unknown as Record<string, unknown>).share
    delete (window.navigator as unknown as Record<string, unknown>)
      .clipboard
    vi.restoreAllMocks()
  })

  async function renderApp(strict = false) {
    await act(async () => {
      root.render(
        strict ? (
          <StrictMode>
            <App />
          </StrictMode>
        ) : (
          <App />
        ),
      )
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  async function changeHash(hashPath: string, replace = false) {
    const nextUrl = `/#${hashPath}`
    if (replace) {
      window.history.replaceState({}, '', nextUrl)
    } else {
      window.history.pushState({}, '', nextUrl)
    }
    await act(async () => {
      window.dispatchEvent(new HashChangeEvent('hashchange'))
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  function buttons(label: string): HTMLButtonElement[] {
    return [...container.querySelectorAll<HTMLButtonElement>('button')].filter(
      (candidate) => candidate.textContent?.trim() === label,
    )
  }

  function button(label: string): HTMLButtonElement {
    const found = buttons(label)[0]
    if (!found) {
      throw new Error(`Button was not rendered: ${label}`)
    }
    return found
  }

  async function clickAndFlush(element: Element) {
    await act(async () => {
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  it('navigates home to create and compact v3, resetting scroll on hashchange', async () => {
    await renderApp()
    expect(container.querySelector('h1')?.textContent).toBe('買いものバトン')

    await clickAndFlush(button('＋ 新しい買いものリストを作る'))
    if (window.location.hash !== '#/create') {
      await changeHash('/create')
    }
    expect(container.querySelector('h1')?.textContent).toBe('商品を選ぶ')

    await changeHash(`/l/${PUBLISHED_V3_REQUEST_FIXTURE}`)
    expect(container.querySelector('h1')?.textContent).toBe(
      'おつかいリスト',
    )
    expect(container.textContent).toContain('送信側の牛乳')
    expect(scrollTo).toHaveBeenLastCalledWith({
      top: 0,
      behavior: 'auto',
    })
  })

  it('routes the secondary Home actions to products and about', async () => {
    await renderApp()

    await clickAndFlush(button('商品リストを編集'))
    expect(window.location.hash).toBe('#/products')
    await changeHash('/products', true)
    expect(container.querySelector('h1')?.textContent).toBe(
      '商品リストを編集',
    )

    await changeHash('/')
    await clickAndFlush(button('このアプリについて'))
    expect(window.location.hash).toBe('#/about')
    await changeHash('/about', true)
    expect(container.querySelector('h1')?.textContent).toBe(
      'このアプリについて',
    )
  })

  it('handles request A/B, invalid/valid, and backward/forward hashchange equivalents', async () => {
    await renderApp()

    await changeHash(`/list?data=${PUBLISHED_V1_REQUEST_FIXTURE}`)
    expect(container.textContent).toContain('牛乳')

    await changeHash(`/l/${PUBLISHED_V2_REQUEST_FIXTURE}`)
    expect(container.textContent).toContain('電池')

    await changeHash(`/l/${REQUEST_B_FIXTURE}`)
    expect(container.textContent).toContain('別依頼の商品')
    expect(container.textContent).not.toContain('電池')

    await changeHash('/l/broken-data')
    expect(container.querySelector('h1')?.textContent).toBe(
      '共有URLを開けませんでした',
    )

    await changeHash(`/l/${PUBLISHED_V3_REQUEST_FIXTURE}`)
    expect(container.textContent).toContain('家庭の洗剤😀')

    await changeHash(`/l/${REQUEST_B_FIXTURE}`, true)
    expect(container.textContent).toContain('別依頼の商品')
    await changeHash(`/l/${PUBLISHED_V3_REQUEST_FIXTURE}`, true)
    expect(container.textContent).toContain('家庭の洗剤😀')
  })

  it('keeps direct v5 capability routes unavailable while the feature flag is off', async () => {
    const requestToken = `r1_${'A'.repeat(32)}`
    const editSecret = `e1_${'B'.repeat(43)}`
    await renderApp()

    await changeHash(`/r/${requestToken}`)
    expect(container.querySelector('h1')?.textContent).toBe(
      '更新可能な依頼は現在利用できません',
    )

    await changeHash(`/manage/${requestToken}/${editSecret}`)
    expect(container.querySelector('h1')?.textContent).toBe(
      '依頼の管理機能は現在利用できません',
    )

    await changeHash(`/l/${PUBLISHED_V3_REQUEST_FIXTURE}`)
    expect(container.textContent).toContain('家庭の洗剤😀')
  })

  it('renders browser history back and forward destinations after hashchange', async () => {
    await renderApp()
    await changeHash('/create')
    await changeHash('/about')
    expect(container.querySelector('h1')?.textContent).toBe(
      'このアプリについて',
    )

    window.history.back()
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0))
      window.dispatchEvent(new HashChangeEvent('hashchange'))
      await Promise.resolve()
    })
    expect(window.location.hash).toBe('#/create')
    expect(container.querySelector('h1')?.textContent).toBe('商品を選ぶ')

    window.history.forward()
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0))
      window.dispatchEvent(new HashChangeEvent('hashchange'))
      await Promise.resolve()
    })
    expect(window.location.hash).toBe('#/about')
    expect(container.querySelector('h1')?.textContent).toBe(
      'このアプリについて',
    )
  })

  it('clears request-scoped Undo, dialog, completion, and share notice', async () => {
    await renderApp()
    await changeHash(`/l/${PUBLISHED_V3_REQUEST_FIXTURE}`)

    await clickAndFlush(button('かごに入れる'))
    expect(container.textContent).toContain('元に戻す')
    await clickAndFlush(buttons('相談する')[0])
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()

    const requestB = decodeCompactRequestV3(REQUEST_B_FIXTURE)
    const requestBItem = requestB.items[0]
    window.localStorage.setItem(
      `otsukai:checked:${requestB.requestId}`,
      JSON.stringify({ [requestBItem.id]: 'inCart' }),
    )
    window.localStorage.setItem(
      `otsukai:cartOrder:${requestB.requestId}`,
      JSON.stringify([requestBItem.id]),
    )
    await changeHash(`/l/${REQUEST_B_FIXTURE}`)

    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(container.textContent).not.toContain('元に戻す')
    await clickAndFlush(button('買い物を終了する'))
    expect(container.textContent).toContain('おつかい完了')
    await clickAndFlush(button('結果を共有'))
    expect(container.textContent).toContain(
      'LINEを選択して結果を送信してください。',
    )

    await changeHash(`/l/${PUBLISHED_V3_REQUEST_FIXTURE}`)
    expect(container.textContent).not.toContain('おつかい完了')
    expect(container.textContent).not.toContain(
      'LINEを選択して結果を送信してください。',
    )
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('ignores a pending create share after leaving the route and can share after revisiting', async () => {
    let resolveFirstShare: () => void = () => undefined
    const firstShare = new Promise<void>((resolve) => {
      resolveFirstShare = resolve
    })
    const share = vi
      .fn<(data: ShareData) => Promise<void>>()
      .mockImplementationOnce(() => firstShare)
      .mockResolvedValue(undefined)
    Object.defineProperty(window.navigator, 'share', {
      configurable: true,
      value: share,
    })
    const error = vi.spyOn(console, 'error')
    await renderApp()
    await changeHash('/create')
    const increase = container.querySelector<HTMLButtonElement>(
      'button[aria-label*="増やす（現在0"]',
    )
    if (!increase) {
      throw new Error('Product increment was not rendered')
    }
    await clickAndFlush(increase)
    await clickAndFlush(button('確認へ'))
    act(() => {
      button('LINEで送る').dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      )
    })
    expect(share).toHaveBeenCalledTimes(1)

    await changeHash('/')
    await act(async () => {
      resolveFirstShare()
      await firstShare
      await Promise.resolve()
    })
    expect(container.querySelector('h1')?.textContent).toBe(
      '買いものバトン',
    )

    await changeHash('/create')
    expect(container.textContent).not.toContain(
      '共有画面を開きました。LINEを選択して送信してください。',
    )
    await clickAndFlush(button('確認へ'))
    await clickAndFlush(button('LINEで送る'))
    expect(share).toHaveBeenCalledTimes(2)
    expect(error).not.toHaveBeenCalled()
  })

  it('removes the hashchange listener on unmount', async () => {
    await renderApp()
    scrollTo.mockClear()

    act(() => root.unmount())
    rootIsMounted = false
    await changeHash('/create')

    expect(container.textContent).toBe('')
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('does not duplicate a cart save or result share in React StrictMode', async () => {
    window.history.replaceState(
      {},
      '',
      `/#/l/${REQUEST_B_FIXTURE}`,
    )
    const originalSetItem = window.localStorage.setItem.bind(
      window.localStorage,
    )
    const setItem = vi
      .spyOn(window.localStorage, 'setItem')
      .mockImplementation((key: string, value: string) => {
        originalSetItem(key, value)
      })
    const share = window.navigator.share as ReturnType<typeof vi.fn>

    await renderApp(true)
    await clickAndFlush(button('かごに入れる'))
    await clickAndFlush(button('買い物を終了する'))
    await clickAndFlush(button('結果を共有'))

    const persistedCartChanges = setItem.mock.calls.filter(
      ([key, value]) =>
        key.startsWith('otsukai:checked:') &&
        value.includes('"inCart"'),
    )
    expect(persistedCartChanges).toHaveLength(1)
    expect(share).toHaveBeenCalledTimes(1)
  })
})
