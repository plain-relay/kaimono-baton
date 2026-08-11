// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { PUBLISHED_V3_REQUEST_FIXTURE } from '../testFixtures/publishedFormats'
import type { CheckedStateMap, ItemIssueMap } from '../types/shopping'
import { decodeCompactRequestV3 } from '../utils/compactRequestV3'

describe('v3 request to completed shopping journey', () => {
  let container: HTMLDivElement
  let root: Root
  let rootIsMounted: boolean

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true
    window.localStorage.clear()
    window.history.replaceState(
      {},
      '',
      `/#/l/${PUBLISHED_V3_REQUEST_FIXTURE}`,
    )
    window.localStorage.setItem(
      'otsukai:householdCatalog:v1',
      JSON.stringify({
        schemaVersion: 1,
        revision: 1,
        updatedAt: '2026-07-26T04:00:00.000Z',
        overrides: {
          milk: {
            name: '受信側でだけ使う牛乳名',
            unit: '本',
            categoryId: 'eggs-dairy',
          },
        },
        addedProducts: [],
      }),
    )
    Object.defineProperty(window.navigator, 'share', {
      configurable: true,
      value: vi.fn(async () => undefined),
    })
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => undefined) },
    })
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(
      (callback: FrameRequestCallback) => {
        callback(0)
        return 1
      },
    )
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
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

  async function renderApp() {
    await act(async () => {
      root.render(<App />)
      await Promise.resolve()
      await Promise.resolve()
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
  }

  async function clickAndFlush(element: Element) {
    await act(async () => {
      if (element instanceof HTMLElement) {
        element.click()
      } else {
        element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      }
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  function button(label: string): HTMLButtonElement {
    const found = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((candidate) => candidate.textContent?.trim() === label)
    if (!found) {
      throw new Error(`Button was not rendered: ${label}`)
    }
    return found
  }

  function itemArticle(name: string): HTMLElement {
    const found = [...container.querySelectorAll<HTMLElement>('article')].find(
      (article) =>
        [...article.querySelectorAll('strong')].some(
          (strong) => strong.textContent === name,
        ),
    )
    if (!found) {
      throw new Error(`Shopping item was not rendered: ${name}`)
    }
    return found
  }

  function itemButton(name: string, label: string): HTMLButtonElement {
    const found = [...itemArticle(name).querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.trim() === label,
    )
    if (!found) {
      throw new Error(`Button was not rendered for ${name}: ${label}`)
    }
    return found
  }

  async function confirmQuantityAndCondition(
    name: string,
    cartButtonLabel: string,
  ) {
    const cartButton = itemButton(name, cartButtonLabel)
    expect(cartButton.disabled).toBe(false)
    await clickAndFlush(cartButton)
    expect(container.textContent).toContain('数量の確認')
    const checks = container.querySelectorAll<HTMLInputElement>(
      '[role="dialog"] input[type="checkbox"]',
    )
    expect(checks).toHaveLength(2)
    await clickAndFlush(checks[0])
    await clickAndFlush(checks[1])
    await clickAndFlush(button('確認してかご済みにする'))
  }

  it('keeps URL snapshots and persisted state through checkout and result sharing', async () => {
    const firstDecode = decodeCompactRequestV3(
      PUBLISHED_V3_REQUEST_FIXTURE,
    )
    const secondDecode = decodeCompactRequestV3(
      PUBLISHED_V3_REQUEST_FIXTURE,
    )
    expect(secondDecode.requestId).toBe(firstDecode.requestId)
    expect(secondDecode.items.map((item) => item.id)).toEqual(
      firstDecode.items.map((item) => item.id),
    )
    await renderApp()

    expect(container.textContent).toContain('送信側の牛乳')
    expect(container.textContent).not.toContain('受信側でだけ使う牛乳名')
    expect(container.textContent).toContain('家庭の洗剤😀')
    expect(container.textContent).toContain('一回だけの商品')

    await confirmQuantityAndCondition('キャベツ', '2個をかごに入れる')
    await confirmQuantityAndCondition(
      '送信側の牛乳',
      '2ケースをかごに入れる',
    )

    await clickAndFlush(itemButton('家庭の洗剤😀', '相談する'))
    await clickAndFlush(
      container.querySelector<HTMLInputElement>(
        'input[type="radio"][value="soldOut"]',
      )!,
    )
    await clickAndFlush(button('今回は買わない'))
    await clickAndFlush(itemButton('一回だけの商品', 'かごに入れる'))

    const checkedBeforeRemount = JSON.parse(
      window.localStorage.getItem(
        `otsukai:checked:${firstDecode.requestId}`,
      ) ?? '{}',
    ) as CheckedStateMap
    const issuesBeforeRemount = JSON.parse(
      window.localStorage.getItem(
        `otsukai:itemIssues:${firstDecode.requestId}`,
      ) ?? '{}',
    ) as ItemIssueMap
    expect(checkedBeforeRemount).toEqual({
      [firstDecode.items[0].id]: 'verified',
      [firstDecode.items[1].id]: 'verified',
      [firstDecode.items[2].id]: 'notBuying',
      [firstDecode.items[3].id]: 'inCart',
    })
    expect(issuesBeforeRemount[firstDecode.items[2].id]).toEqual({
      reason: 'soldOut',
    })

    act(() => root.unmount())
    rootIsMounted = false
    root = createRoot(container)
    rootIsMounted = true
    await renderApp()

    expect(itemArticle('キャベツ').textContent).toContain(
      '購入時に条件確認済み',
    )
    expect(itemArticle('送信側の牛乳').textContent).toContain(
      '購入時に条件確認済み',
    )
    expect(itemArticle('家庭の洗剤😀').textContent).toContain(
      '今回は買わない',
    )
    expect(itemArticle('一回だけの商品').textContent).toContain(
      'かご済み',
    )
    expect(container.textContent).toContain('会計前チェック')

    await clickAndFlush(button('買い物を終了する'))
    expect(container.textContent).toContain('おつかい終了')
    await clickAndFlush(button('結果を共有'))

    const share = window.navigator.share as ReturnType<typeof vi.fn>
    expect(share).toHaveBeenCalledTimes(1)
    const sharedData = share.mock.calls[0][0] as ShareData
    expect(sharedData.title).toBe('おつかい結果')
    expect(sharedData.text).toContain('購入：3件')
    expect(sharedData.text).toContain('買えなかった商品：1件')
    expect(sharedData.text).toContain('家庭の洗剤😀')
    expect(Object.keys(sharedData).sort()).toEqual(['text', 'title'])
  })
})
