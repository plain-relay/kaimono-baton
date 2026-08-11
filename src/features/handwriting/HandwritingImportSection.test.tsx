// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { products } from '../../data/products'
import type { EffectiveProduct } from '../../types/householdCatalog'
import { HandwritingImportError } from './errors'
import { HandwritingImportSection } from './HandwritingImportSection'
import { HANDWRITING_DIAGNOSTICS_STORAGE_KEY } from './diagnostics'
import type {
  HandwritingImportProvider,
  HandwritingImportResult,
  HandwritingImportSelection,
  ImportProductCandidate,
} from './types'

const config = {
  enabled: true,
  diagnosticsEnabled: false,
  endpoint: 'https://import.example.test/',
  turnstileSiteKey: 'site-key',
}
const effectiveProducts: EffectiveProduct[] = products.map((product) => ({
  ...product,
  source: 'base',
  hidden: false,
  isCustomized: false,
}))
const preparedImage = new Blob(
  [new Uint8Array([0xff, 0xd8, 0xff, 0xe0])],
  { type: 'image/jpeg' },
)

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  let reject: (error: unknown) => void = () => undefined
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

function result(
  items: HandwritingImportResult['items'],
): HandwritingImportResult {
  return { version: 1, items }
}

describe('HandwritingImportSection', () => {
  let container: HTMLDivElement
  let root: Root
  let previewSequence: number

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true
    window.localStorage.clear()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    previewSequence = 0
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    window.localStorage.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  async function renderSection({
    provider,
    preprocessImage = vi.fn(async () => preparedImage),
    onApplySelections = vi.fn(() => ({
      accepted: true,
      changedItemCount: 1,
    })),
    enabled = true,
    diagnosticsEnabled = false,
    productsForView = effectiveProducts,
    createPreviewUrl = vi.fn(
      () => `blob:handwriting-preview-${++previewSequence}`,
    ),
    revokePreviewUrl = vi.fn(),
  }: {
    provider?: HandwritingImportProvider
    preprocessImage?: (
      file: File,
      options?: { signal?: AbortSignal },
    ) => Promise<Blob>
    onApplySelections?: (
      selections: readonly HandwritingImportSelection[],
    ) => {
      accepted: boolean
      changedItemCount: number
      reason?:
        | 'url-limit'
        | 'custom-item-limit'
        | 'invalid-selection'
    }
    enabled?: boolean
    diagnosticsEnabled?: boolean
    productsForView?: EffectiveProduct[]
    createPreviewUrl?: (file: File) => string
    revokePreviewUrl?: (url: string) => void
  }) {
    await act(async () => {
      root.render(
        <HandwritingImportSection
          config={{ ...config, enabled, diagnosticsEnabled }}
          effectiveProducts={productsForView}
          importProvider={provider}
          preprocessImage={preprocessImage}
          onApplySelections={onApplySelections}
          createCustomItemId={() => 'custom:test'}
          createPreviewUrl={createPreviewUrl}
          revokePreviewUrl={revokePreviewUrl}
        />,
      )
      await Promise.resolve()
    })
    return {
      preprocessImage,
      onApplySelections,
      createPreviewUrl,
      revokePreviewUrl,
    }
  }

  async function chooseImage({
    inputLabel = '写真を撮る',
    file = new File(
      [new Uint8Array([0xff, 0xd8, 0xff, 0xe0])],
      'memo.jpg',
      { type: 'image/jpeg' },
    ),
    start = true,
    loadPreview = true,
    width = 1200,
    height = 1600,
  }: {
    inputLabel?:
      | '写真を撮る'
      | '端末の写真を選ぶ'
      | '撮り直す'
      | '選び直す'
    file?: File
    start?: boolean
    loadPreview?: boolean
    width?: number
    height?: number
  } = {}) {
    const input = container.querySelector<HTMLInputElement>(
      `input[type="file"][aria-label="${inputLabel}"]`,
    )
    if (!input) {
      throw new Error('File input was not rendered')
    }
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [file],
    })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })
    const previewImage =
      container.querySelector<HTMLImageElement>(
        'img[alt="選択した手書きメモのプレビュー"]',
      )
    if (previewImage && loadPreview) {
      Object.defineProperty(previewImage, 'naturalWidth', {
        configurable: true,
        value: width,
      })
      Object.defineProperty(previewImage, 'naturalHeight', {
        configurable: true,
        value: height,
      })
      await act(async () => {
        previewImage.dispatchEvent(new Event('load'))
        await Promise.resolve()
      })
    }
    if (start) {
      await click(button('読み取りを開始'))
    }
    return { input, file, previewImage }
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

  it('renders separate camera and photo-library inputs plus the form link', async () => {
    await renderSection({
      provider: { analyze: vi.fn(async () => result([])) },
    })
    const cameraInput = container.querySelector<HTMLInputElement>(
      'input[type="file"][aria-label="写真を撮る"]',
    )
    const libraryInput = container.querySelector<HTMLInputElement>(
      'input[type="file"][aria-label="端末の写真を選ぶ"]',
    )
    expect(container.textContent).toContain('手書きメモから追加')
    expect(container.textContent).toContain('画像と商品候補をGoogle Geminiへ送信')
    expect(container.textContent).toContain('サービス改善に使用される場合があります')
    expect(cameraInput?.accept).toBe('image/*')
    expect(cameraInput?.getAttribute('capture')).toBe('environment')
    expect(libraryInput?.accept).toBe('image/*')
    expect(libraryInput?.hasAttribute('capture')).toBe(false)
    expect(cameraInput?.closest('label')).not.toBe(
      libraryInput?.closest('label'),
    )
    expect(
      container.querySelector<HTMLAnchorElement>(
        'a[href$="handwriting-form-v1.html"]',
      )?.textContent,
    ).toContain('印刷用フォームを開く')
  })

  it('shows a safe preview without preprocessing, analysis, or draft changes', async () => {
    const analyze = vi.fn(async () => result([]))
    const rendered = await renderSection({ provider: { analyze } })

    await chooseImage({
      inputLabel: '端末の写真を選ぶ',
      start: false,
      width: 3024,
      height: 4032,
    })

    expect(container.textContent).toContain('image/jpeg')
    expect(container.textContent).toContain('4 B')
    expect(container.textContent).toContain('3024 × 4032 px')
    expect(container.textContent).not.toContain('memo.jpg')
    expect(
      container.querySelector(
        'input[type="file"][aria-label="撮り直す"]',
      ),
    ).not.toBeNull()
    expect(
      container.querySelector(
        'input[type="file"][aria-label="選び直す"]',
      ),
    ).not.toBeNull()
    expect(
      container.querySelector('[data-handwriting-phase="previewing"]'),
    ).not.toBeNull()
    expect(rendered.preprocessImage).not.toHaveBeenCalled()
    expect(analyze).not.toHaveBeenCalled()
    expect(rendered.onApplySelections).not.toHaveBeenCalled()
  })

  it('does not execute Turnstile or fetch when a file is only selected', async () => {
    const fetchImplementation = vi.fn()
    vi.stubGlobal('fetch', fetchImplementation)
    const originalTurnstile = window.turnstile
    const turnstile = {
      render: vi.fn(() => 'widget-id'),
      execute: vi.fn(),
      reset: vi.fn(),
      remove: vi.fn(),
    }
    window.turnstile = turnstile

    await renderSection({})
    await chooseImage({ start: false })

    expect(turnstile.render).not.toHaveBeenCalled()
    expect(turnstile.execute).not.toHaveBeenCalled()
    expect(fetchImplementation).not.toHaveBeenCalled()
    window.turnstile = originalTurnstile
  })

  it('cancels a preview without analysis and revokes its object URL', async () => {
    const analyze = vi.fn(async () => result([]))
    const rendered = await renderSection({ provider: { analyze } })
    await chooseImage({ start: false })

    await click(button('キャンセル'))

    expect(rendered.revokePreviewUrl).toHaveBeenCalledWith(
      'blob:handwriting-preview-1',
    )
    expect(rendered.preprocessImage).not.toHaveBeenCalled()
    expect(analyze).not.toHaveBeenCalled()
    expect(
      container.querySelector('[data-handwriting-phase="idle"]'),
    ).not.toBeNull()
    expect(
      container.querySelector(
        'img[alt="選択した手書きメモのプレビュー"]',
      ),
    ).toBeNull()
  })

  it('reselects through either input and analyzes only the newest file', async () => {
    const analyze = vi.fn(async () => result([]))
    const preprocessImage = vi.fn(async () => preparedImage)
    const rendered = await renderSection({
      provider: { analyze },
      preprocessImage,
    })
    const firstFile = new File([new Uint8Array([1])], 'first.jpg', {
      type: 'image/jpeg',
    })
    const secondFile = new File([new Uint8Array([2])], 'second.png', {
      type: 'image/png',
    })
    await chooseImage({
      inputLabel: '端末の写真を選ぶ',
      file: firstFile,
      start: false,
    })
    await chooseImage({
      inputLabel: '撮り直す',
      file: secondFile,
      start: false,
    })

    expect(rendered.revokePreviewUrl).toHaveBeenCalledWith(
      'blob:handwriting-preview-1',
    )
    await click(button('読み取りを開始'))
    await vi.waitFor(() => expect(analyze).toHaveBeenCalledTimes(1))
    expect(preprocessImage).toHaveBeenCalledWith(
      secondFile,
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    )
    expect(rendered.revokePreviewUrl).toHaveBeenCalledWith(
      'blob:handwriting-preview-2',
    )
  })

  it('revokes a selected preview when the component unmounts', async () => {
    const rendered = await renderSection({
      provider: { analyze: vi.fn(async () => result([])) },
    })
    await chooseImage({ start: false })

    act(() => root.unmount())
    root = createRoot(container)

    expect(rendered.revokePreviewUrl).toHaveBeenCalledWith(
      'blob:handwriting-preview-1',
    )
  })

  it('rejects unsupported selected formats without external processing', async () => {
    const analyze = vi.fn(async () => result([]))
    const rendered = await renderSection({ provider: { analyze } })
    await chooseImage({
      file: new File([new Uint8Array([0, 0, 0, 0])], 'photo.heic', {
        type: 'image/heic',
      }),
      start: false,
      loadPreview: false,
    })

    expect(container.textContent).toContain(
      '対応していない画像形式です。JPEG、PNG、WebPを選んでください。',
    )
    expect(
      container.querySelector('[data-handwriting-phase="failed"]'),
    ).not.toBeNull()
    expect(rendered.preprocessImage).not.toHaveBeenCalled()
    expect(analyze).not.toHaveBeenCalled()
  })

  it('does not start processing when the local preview cannot decode', async () => {
    const analyze = vi.fn(async () => result([]))
    const rendered = await renderSection({ provider: { analyze } })
    const { previewImage } = await chooseImage({
      start: false,
      loadPreview: false,
    })
    if (!previewImage) {
      throw new Error('Preview image was not rendered')
    }

    await act(async () => {
      previewImage.dispatchEvent(new Event('error'))
      await Promise.resolve()
    })

    expect(container.textContent).toContain('画像をプレビューできません。')
    expect(button('読み取りを開始').disabled).toBe(true)
    expect(rendered.preprocessImage).not.toHaveBeenCalled()
    expect(analyze).not.toHaveBeenCalled()
  })

  it('begins diagnostics only after the user starts reading', async () => {
    const preparation = deferred<Blob>()
    await renderSection({
      provider: { analyze: vi.fn(async () => result([])) },
      preprocessImage: vi.fn(() => preparation.promise),
      diagnosticsEnabled: true,
    })
    await chooseImage({ start: false })

    expect(
      window.localStorage.getItem(HANDWRITING_DIAGNOSTICS_STORAGE_KEY),
    ).toBeNull()

    await click(button('読み取りを開始'))
    expect(
      window.localStorage.getItem(HANDWRITING_DIAGNOSTICS_STORAGE_KEY),
    ).toContain('file-selected')
    await act(async () => {
      preparation.resolve(preparedImage)
      await preparation.promise
      await Promise.resolve()
    })
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        '商品名を検出できませんでした。',
      ),
    )
  })

  it('allows another image to be selected after analysis fails', async () => {
    const analyze = vi
      .fn()
      .mockRejectedValueOnce(
        new HandwritingImportError('service-unavailable'),
      )
      .mockResolvedValueOnce(
        result([
          {
            sourceText: '牛乳',
            status: 'matched',
            productId: 'milk',
            candidateProductIds: [],
          },
        ]),
      )
    await renderSection({ provider: { analyze } })
    await chooseImage()
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        '手書きメモ解析サービスへ接続できません。',
      ),
    )

    await chooseImage({
      inputLabel: '端末の写真を選ぶ',
      start: false,
    })
    expect(
      container.querySelector('[data-handwriting-phase="previewing"]'),
    ).not.toBeNull()
    expect(container.textContent).not.toContain(
      '手書きメモ解析サービスへ接続できません。',
    )
    await click(button('読み取りを開始'))
    await vi.waitFor(() =>
      expect(container.querySelector('[role="dialog"]')).not.toBeNull(),
    )
    expect(analyze).toHaveBeenCalledTimes(2)
  })

  it('sends visible current products and aliases, but no hidden product', async () => {
    let sentProducts: readonly ImportProductCandidate[] = []
    const analyze = vi.fn(
      async (
        _image: Blob,
        candidates: readonly ImportProductCandidate[],
      ) => {
        sentProducts = candidates
        return result([
        {
          sourceText: 'たまご',
          status: 'matched',
          productId: 'eggs',
          candidateProductIds: [],
        },
        ])
      },
    )
    await renderSection({
      provider: { analyze },
      productsForView: [
        ...effectiveProducts,
        {
          ...effectiveProducts[0],
          id: 'hidden-product',
          name: '非表示',
          hidden: true,
        },
      ],
    })
    await chooseImage()
    await vi.waitFor(() => expect(analyze).toHaveBeenCalledTimes(1))
    expect(sentProducts.find((product) => product.id === 'eggs')).toEqual(
      expect.objectContaining({
        name: '卵',
        aliases: ['たまご', '玉子'],
      }),
    )
    expect(
      sentProducts.some((product) => product.id === 'hidden-product'),
    ).toBe(false)
  })

  it('shows preparing and analyzing states and prevents a second run', async () => {
    const preparation = deferred<Blob>()
    const analysis = deferred<HandwritingImportResult>()
    const preprocessImage = vi.fn(() => preparation.promise)
    const analyze = vi.fn(() => analysis.promise)
    await renderSection({
      provider: { analyze },
      preprocessImage,
    })

    const { input } = await chooseImage()
    expect(container.textContent).toContain('画像を準備中')
    expect(input.disabled).toBe(true)

    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [
        new File([new Uint8Array([0xff, 0xd8, 0xff])], 'second.jpg', {
          type: 'image/jpeg',
        }),
      ],
    })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })
    expect(preprocessImage).toHaveBeenCalledTimes(1)

    await act(async () => {
      preparation.resolve(preparedImage)
      await preparation.promise
      await Promise.resolve()
    })
    expect(container.textContent).toContain('メモを分析中')
    expect(analyze).toHaveBeenCalledTimes(1)

    await act(async () => {
      analysis.resolve(
        result([
          {
            sourceText: '牛乳',
            status: 'matched',
            productId: 'milk',
            candidateProductIds: [],
          },
        ]),
      )
      await analysis.promise
      await Promise.resolve()
    })
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
  })

  it('cancels an in-flight analysis with AbortController', async () => {
    const analyze = vi.fn(
      (
        _image: Blob,
        _products: readonly unknown[],
        options?: { signal?: AbortSignal },
      ) =>
        new Promise<HandwritingImportResult>((_resolve, reject) => {
          options?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('cancelled', 'AbortError')),
            { once: true },
          )
        }),
    )
    await renderSection({ provider: { analyze } })
    await chooseImage()
    await vi.waitFor(() =>
      expect(container.textContent).toContain('メモを分析中'),
    )
    await click(button('キャンセル'))
    await vi.waitFor(() =>
      expect(container.textContent).toContain('処理をキャンセルしました。'),
    )
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('selects matched only and requires a choice for ambiguous and unknown items', async () => {
    const onApplySelections = vi.fn(() => ({
      accepted: true,
      changedItemCount: 2,
    }))
    await renderSection({
      provider: {
        analyze: vi.fn(async () =>
          result([
            {
              sourceText: '牛乳',
              status: 'matched',
              productId: 'milk',
              candidateProductIds: [],
            },
            {
              sourceText: 'とうふ',
              status: 'ambiguous',
              productId: null,
              candidateProductIds: ['tofu', 'three-pack-tofu'],
            },
            {
              sourceText: '電池',
              status: 'unknown',
              productId: null,
              candidateProductIds: [],
            },
          ]),
        ),
      },
      onApplySelections,
    })
    await chooseImage()
    await vi.waitFor(() =>
      expect(container.querySelector('[role="dialog"]')).not.toBeNull(),
    )

    const matched = container.querySelector<HTMLSelectElement>(
      '[aria-label="牛乳の候補を選択"]',
    )
    const ambiguous = container.querySelector<HTMLSelectElement>(
      '[aria-label="とうふの候補を選択"]',
    )
    const unknown = container.querySelector<HTMLSelectElement>(
      '[aria-label="電池の候補を選択"]',
    )
    expect(matched?.value).toBe('product:milk')
    expect(ambiguous?.value).toBe('ignore')
    expect(ambiguous?.closest('article')?.textContent).toContain(
      '豆腐、三連豆腐',
    )
    expect(unknown?.value).toBe('ignore')
    expect(onApplySelections).not.toHaveBeenCalled()

    await act(async () => {
      if (!ambiguous || !unknown) {
        throw new Error('Expected selects were not rendered')
      }
      ambiguous.value = 'product:tofu'
      ambiguous.dispatchEvent(new Event('change', { bubbles: true }))
      unknown.value = 'custom'
      unknown.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })
    expect(container.textContent).toContain(
      '単位は仮に個です。追加後に変更できます。',
    )
    expect(onApplySelections).not.toHaveBeenCalled()

    await click(button('選択した商品を追加'))
    expect(onApplySelections).toHaveBeenCalledWith([
      {
        itemId: 'analysis-item-1',
        kind: 'product',
        productId: 'milk',
      },
      {
        itemId: 'analysis-item-2',
        kind: 'product',
        productId: 'tofu',
      },
      {
        itemId: 'analysis-item-3',
        kind: 'custom',
        name: '電池',
        customItemId: 'custom:test',
      },
    ])
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('allows a matched item to be changed or ignored before applying', async () => {
    const onApplySelections = vi.fn(() => ({
      accepted: true,
      changedItemCount: 1,
    }))
    await renderSection({
      provider: {
        analyze: vi.fn(async () =>
          result([
            {
              sourceText: '牛乳',
              status: 'matched',
              productId: 'milk',
              candidateProductIds: [],
            },
          ]),
        ),
      },
      onApplySelections,
    })
    await chooseImage()
    await vi.waitFor(() =>
      expect(container.querySelector('[role="dialog"]')).not.toBeNull(),
    )
    const select = container.querySelector<HTMLSelectElement>(
      '[aria-label="牛乳の候補を選択"]',
    )
    await act(async () => {
      if (!select) {
        throw new Error('Select not found')
      }
      select.value = 'product:eggs'
      select.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })
    await click(button('選択した商品を追加'))
    expect(onApplySelections).toHaveBeenCalledWith([
      {
        itemId: 'analysis-item-1',
        kind: 'product',
        productId: 'eggs',
      },
    ])
  })

  it('keeps confirmation open and reports an atomic apply failure', async () => {
    await renderSection({
      provider: {
        analyze: vi.fn(async () =>
          result([
            {
              sourceText: '牛乳',
              status: 'matched',
              productId: 'milk',
              candidateProductIds: [],
            },
          ]),
        ),
      },
      onApplySelections: vi.fn(() => ({
        accepted: false,
        changedItemCount: 0,
        reason: 'url-limit' as const,
      })),
    })
    await chooseImage()
    await vi.waitFor(() =>
      expect(container.querySelector('[role="dialog"]')).not.toBeNull(),
    )
    await click(button('選択した商品を追加'))
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    expect(container.textContent).toContain('依頼上限により追加できません。')
  })

  it('rejects a malformed provider result before opening confirmation', async () => {
    await renderSection({
      provider: {
        analyze: vi.fn(async () =>
          ({
            version: 1,
            items: [
              {
                sourceText: '架空',
                status: 'matched',
                productId: 'invented',
                candidateProductIds: [],
              },
            ],
          }) as HandwritingImportResult,
        ),
      },
    })
    await chooseImage()
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        '読み取り結果を安全に確認できませんでした。',
      ),
    )
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('shows a safe failure boundary without changing ordinary input', async () => {
    await renderSection({
      provider: {
        analyze: vi.fn(async () => {
          throw new HandwritingImportError('service-unavailable')
        }),
      },
      diagnosticsEnabled: true,
    })
    await chooseImage()
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        '手書きメモ解析サービスへ接続できません。',
      ),
    )
    expect(container.querySelector('input[type="file"]')).not.toBeNull()
    expect(container.textContent).toContain('失敗直前ファイル選択')
    expect(
      JSON.parse(
        window.localStorage.getItem(
          HANDWRITING_DIAGNOSTICS_STORAGE_KEY,
        ) ?? '{}',
      ),
    ).toEqual(
      expect.objectContaining({
        stage: 'failed',
        failedAfterStage: 'file-selected',
        errorCode: 'service-unavailable',
      }),
    )
  })

  it('does not render or initialize the feature when the flag is off', async () => {
    const analyze = vi.fn(async () => result([]))
    await renderSection({
      provider: { analyze },
      enabled: false,
    })
    expect(container.textContent).not.toContain('手書きメモから追加')
    expect(container.querySelector('input[type="file"]')).toBeNull()
    expect(
      container.querySelector('a[href$="handwriting-form-v1.html"]'),
    ).toBeNull()
    expect(analyze).not.toHaveBeenCalled()
  })

  it('does not render or persist diagnostics when diagnostics are off', async () => {
    await renderSection({
      provider: {
        analyze: vi.fn(async () =>
          result([
            {
              sourceText: '迚帑ｹｳ',
              status: 'matched',
              productId: 'milk',
              candidateProductIds: [],
            },
          ]),
        ),
      },
    })
    await chooseImage()
    await vi.waitFor(() =>
      expect(container.querySelector('[role="dialog"]')).not.toBeNull(),
    )

    expect(
      container.querySelector('.handwriting-diagnostics-panel'),
    ).toBeNull()
    expect(
      window.localStorage.getItem(HANDWRITING_DIAGNOSTICS_STORAGE_KEY),
    ).toBeNull()
  })

  it('shows safe diagnostic stages, copies them, and clears them at 390px', async () => {
    container.style.width = '390px'
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(
      navigator,
      'clipboard',
    )
    const writeText = vi.fn(
      async (_text: string): Promise<void> => undefined,
    )
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const analyze = vi.fn(async () =>
      result([
        {
          sourceText: '迚帑ｹｳ',
          status: 'matched',
          productId: 'milk',
          candidateProductIds: [],
        },
        {
          sourceText: '髮ｻ豎',
          status: 'unknown',
          productId: null,
          candidateProductIds: [],
        },
      ]),
    )
    await renderSection({
      provider: { analyze },
      diagnosticsEnabled: true,
    })
    await chooseImage()
    await vi.waitFor(() =>
      expect(container.textContent).toContain('confirmation-rendered'),
    )

    const panel = container.querySelector<HTMLElement>(
      '.handwriting-diagnostics-panel',
    )
    expect(panel).not.toBeNull()
    expect(panel?.textContent).toContain(
      '2件（matched 1 / ambiguous 0 / unknown 1）',
    )
    expect(analyze).toHaveBeenCalledWith(
      preparedImage,
      expect.any(Array),
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        requestId: expect.stringMatching(/^[A-Za-z0-9-]{1,64}$/u),
      }),
    )

    const persisted =
      window.localStorage.getItem(HANDWRITING_DIAGNOSTICS_STORAGE_KEY) ?? ''
    expect(persisted).toContain('confirmation-rendered')
    expect(persisted).not.toContain('memo.jpg')
    expect(persisted).not.toContain('sourceText')
    expect(persisted).not.toContain('productId')

    await click(button('診断情報をコピー'))
    expect(writeText).toHaveBeenCalledTimes(1)
    const copied = String(writeText.mock.calls[0][0])
    expect(copied).not.toContain('sourceText')
    expect(copied).not.toContain('productId')

    await click(button('診断情報を消去'))
    expect(
      window.localStorage.getItem(HANDWRITING_DIAGNOSTICS_STORAGE_KEY),
    ).toBeNull()
    expect(panel?.textContent).toContain('idle')
    if (clipboardDescriptor) {
      Object.defineProperty(
        navigator,
        'clipboard',
        clipboardDescriptor,
      )
    } else {
      Reflect.deleteProperty(navigator, 'clipboard')
    }
  })

  it('shows the previous session final stage without exposing prior input', async () => {
    window.localStorage.setItem(
      HANDWRITING_DIAGNOSTICS_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 1,
        requestId: 'previous-safe-request',
        stage: 'decode-started',
        timestamp: '2026-07-28T00:00:00.000Z',
        elapsedMs: 25,
        browser: {
          name: 'Safari',
          version: '19.0',
          online: true,
        },
      }),
    )
    await renderSection({
      provider: { analyze: vi.fn(async () => result([])) },
      diagnosticsEnabled: true,
    })

    const panel = container.querySelector(
      '.handwriting-diagnostics-panel',
    )
    expect(panel?.textContent).toContain('decode-started')
    expect(panel?.textContent).not.toContain('sourceText')
  })
})
