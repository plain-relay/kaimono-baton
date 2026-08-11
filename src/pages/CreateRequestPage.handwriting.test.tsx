// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HandwritingImportError } from '../features/handwriting/errors'
import type { HandwritingImportProvider } from '../features/handwriting/types'
import { CreateRequestPage } from './CreateRequestPage'

const config = {
  enabled: true,
  diagnosticsEnabled: false,
  endpoint: 'https://import.example.test/',
  turnstileSiteKey: 'site-key',
}
const preparedImage = new Blob(
  [new Uint8Array([0xff, 0xd8, 0xff, 0xe0])],
  { type: 'image/jpeg' },
)

describe('CreateRequestPage handwriting import integration', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true
    window.localStorage.clear()
    window.history.replaceState({}, '', '/#/create')
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    window.localStorage.clear()
    window.history.replaceState({}, '', '/')
    vi.restoreAllMocks()
  })

  async function renderPage(provider: HandwritingImportProvider) {
    await act(async () => {
      root.render(
        <CreateRequestPage
          onBackHome={() => undefined}
          handwritingImportConfig={config}
          handwritingImportProvider={provider}
          preprocessHandwritingImage={vi.fn(async () => preparedImage)}
        />,
      )
      await Promise.resolve()
    })
  }

  async function chooseImage(start = true) {
    const input = container.querySelector<HTMLInputElement>(
      'input[type="file"][aria-label="端末の写真を選ぶ"]',
    )
    if (!input) {
      throw new Error('Handwriting file input was not rendered')
    }
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [
        new File([new Uint8Array([0xff, 0xd8, 0xff])], 'memo.jpg', {
          type: 'image/jpeg',
        }),
      ],
    })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })
    const previewImage = container.querySelector<HTMLImageElement>(
      'img[alt="選択した手書きメモのプレビュー"]',
    )
    if (!previewImage) {
      throw new Error('Handwriting preview was not rendered')
    }
    Object.defineProperty(previewImage, 'naturalWidth', {
      configurable: true,
      value: 1200,
    })
    Object.defineProperty(previewImage, 'naturalHeight', {
      configurable: true,
      value: 1600,
    })
    await act(async () => {
      previewImage.dispatchEvent(new Event('load'))
      await Promise.resolve()
    })
    if (start) {
      await click(button('読み取りを開始'))
    }
  }

  function button(label: string): HTMLButtonElement {
    const found = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (candidate) => candidate.textContent?.trim() === label,
    )
    if (!found) {
      throw new Error(`Button was not rendered: ${label}`)
    }
    return found
  }

  async function click(element: Element) {
    await act(async () => {
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })
  }

  it('does not change the draft before confirmation and applies only afterward', async () => {
    await renderPage({
      analyze: vi.fn(async () => ({
        version: 1 as const,
        items: [
          {
            sourceText: '牛乳',
            status: 'matched' as const,
            productId: 'milk',
            candidateProductIds: [],
          },
        ],
      })),
    })
    await chooseImage()
    await vi.waitFor(() =>
      expect(container.querySelector('[role="dialog"]')).not.toBeNull(),
    )

    expect(
      container.querySelector('article[aria-label^="牛乳、未選択"]'),
    ).not.toBeNull()
    expect(
      JSON.parse(window.localStorage.getItem('otsukai:createDraft') ?? '{}')
        .milk.quantity,
    ).toBe(0)

    await click(button('選択した商品を追加'))
    expect(
      container.querySelector(
        'article[aria-label="牛乳、選択済み、数量1本"]',
      ),
    ).not.toBeNull()
    expect(
      JSON.parse(window.localStorage.getItem('otsukai:createDraft') ?? '{}')
        .milk.quantity,
    ).toBe(1)
  })

  it('keeps the draft unchanged when the local preview is cancelled', async () => {
    const analyze = vi.fn(async () => ({
      version: 1 as const,
      items: [],
    }))
    await renderPage({ analyze })
    await chooseImage(false)

    expect(
      JSON.parse(window.localStorage.getItem('otsukai:createDraft') ?? '{}')
        .milk.quantity,
    ).toBe(0)
    expect(analyze).not.toHaveBeenCalled()

    await click(button('キャンセル'))
    expect(
      JSON.parse(window.localStorage.getItem('otsukai:createDraft') ?? '{}')
        .milk.quantity,
    ).toBe(0)
    expect(analyze).not.toHaveBeenCalled()
  })

  it('keeps ordinary product input usable after analysis failure', async () => {
    await renderPage({
      analyze: vi.fn(async () => {
        throw new HandwritingImportError('service-unavailable')
      }),
    })
    await chooseImage()
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        '手書きメモ解析サービスへ接続できません。',
      ),
    )

    const increase = container.querySelector<HTMLButtonElement>(
      '[aria-label^="牛乳を1本増やす"]',
    )
    if (!increase) {
      throw new Error('Regular product input was not rendered')
    }
    await click(increase)
    expect(
      container.querySelector(
        'article[aria-label="牛乳、選択済み、数量1本"]',
      ),
    ).not.toBeNull()
  })
})
