// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { products } from '../data/products'
import {
  ProductPhotoProcessingError,
  type ProcessedProductPhoto,
} from '../features/productPhotos/imageProcessing'
import {
  ProductPhotoUploadError,
  type ProductPhotoUploadProvider,
} from '../features/productPhotos/ProductPhotoUploadProvider'
import type { TurnstileApi } from '../features/handwriting/turnstile'
import {
  createEmptyHouseholdCatalog,
  updateBaseProduct,
} from '../utils/householdCatalog'
import { decodeShoppingSessionPayload } from '../utils/shoppingSession'
import { CreateRequestPage } from './CreateRequestPage'

const photoConfig = {
  enabled: true,
  endpoint: 'https://worker.example/',
  turnstileSiteKey: 'public-site-key',
} as const

const disabledPhotoConfig = {
  enabled: false,
  endpoint: '',
  turnstileSiteKey: '',
} as const

const milk = products.find((product) => product.id === 'milk')!

function processedPhoto(): ProcessedProductPhoto {
  const blob = new Blob(['compressed-jpeg'], { type: 'image/jpeg' })
  return {
    blob,
    width: 960,
    height: 720,
    bytes: blob.size,
  }
}

describe('CreateRequestPage product photo sharing', () => {
  let container: HTMLDivElement
  let root: Root
  let share: ReturnType<typeof vi.fn<(data: ShareData) => Promise<void>>>
  let revokePreviewUrl: ReturnType<typeof vi.fn<(url: string) => void>>

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true
    window.localStorage.clear()
    window.history.replaceState({}, '', '/#/create')
    share = vi.fn(async () => undefined)
    revokePreviewUrl = vi.fn()
    Object.defineProperty(window.navigator, 'share', {
      configurable: true,
      value: share,
    })
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => undefined) },
    })
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
    delete window.turnstile
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function button(label: string): HTMLButtonElement {
    const found = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (candidate) => candidate.textContent?.trim() === label,
    )
    if (!found) {
      throw new Error(`Button was not rendered: ${label}`)
    }
    return found
  }

  async function click(element: Element): Promise<void> {
    await act(async () => {
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  function increaseMilkButton(): HTMLButtonElement {
    const found = container.querySelector<HTMLButtonElement>(
      `button[aria-label^="${milk.name}を1${milk.unit}増やす"]`,
    )
    if (!found) throw new Error('Milk increase button was not rendered')
    return found
  }

  function decreaseMilkButton(): HTMLButtonElement {
    const found = container.querySelector<HTMLButtonElement>(
      `button[aria-label^="${milk.name}を1${milk.unit}減らす"]`,
    )
    if (!found) throw new Error('Milk decrease button was not rendered')
    return found
  }

  async function selectMilkPhoto(file = new File(['source'], 'private.jpg', {
    type: 'image/jpeg',
  })): Promise<void> {
    await click(increaseMilkButton())
    const details = container.querySelector<HTMLButtonElement>(
      `button[aria-label^="${milk.name}の条件を開く"]`,
    )
    if (!details) throw new Error('Milk details button was not rendered')
    await click(details)
    const input = container.querySelector<HTMLInputElement>(
      `input[aria-label="${milk.name}の端末写真を選ぶ"]`,
    )
    if (!input) throw new Error('Photo library input was not rendered')
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [file],
    })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  function sharedPayload() {
    const requestUrl = sharedRequestUrl()
    return decodeShoppingSessionPayload({
      encodedPayload: new URL(requestUrl).hash.slice('#/l/'.length),
      codec: 'compact-path',
    })
  }

  function sharedRequestUrl(): string {
    const text = share.mock.calls[0]?.[0].text ?? ''
    return text.split('\n').at(-1) ?? ''
  }

  async function renderPage(input: {
    processPhoto?: () => Promise<ProcessedProductPhoto>
    upload?: ProductPhotoUploadProvider['upload']
    enabled?: boolean
    validationSessionToken?: string
    useDefaultUploader?: boolean
  } = {}): Promise<void> {
    const uploader: ProductPhotoUploadProvider = {
      upload: input.upload ?? vi.fn(async () => undefined),
    }
    await act(async () => {
      root.render(
        <CreateRequestPage
          onBackHome={() => undefined}
          productPhotoConfig={
            input.enabled === false
              ? disabledPhotoConfig
              : {
                  ...photoConfig,
                  ...(input.validationSessionToken
                    ? {
                        validationSessionToken:
                          input.validationSessionToken,
                      }
                    : {}),
                }
          }
          productPhotoUploadProvider={
            input.useDefaultUploader ? undefined : uploader
          }
          processProductPhoto={input.processPhoto ?? (async () => processedPhoto())}
          createProductPhotoPreviewUrl={() => 'blob:compressed-preview'}
          revokeProductPhotoPreviewUrl={revokePreviewUrl}
        />,
      )
      await Promise.resolve()
    })
  }

  it('keeps the feature hidden and normal sharing on v3 when the flag is off', async () => {
    const upload = vi.fn<ProductPhotoUploadProvider['upload']>(
      async () => undefined,
    )
    await renderPage({ enabled: false, upload })

    expect(container.querySelector('input[type="file"]')).toBeNull()
    await click(increaseMilkButton())
    await click(button('確認へ'))
    await click(button('LINEで送る'))

    expect(upload).not.toHaveBeenCalled()
    expect(sharedPayload().requestId).toMatch(/^v3-/)
  })

  it('does not put the validation capability on a photo-free v3 share', async () => {
    const validationSessionToken = `mv1_${'V'.repeat(32)}`
    await renderPage({ validationSessionToken })
    await click(increaseMilkButton())
    await click(button('確認へ'))
    await click(button('LINEで送る'))

    expect(sharedPayload().requestId).toMatch(/^v3-/)
    expect(sharedRequestUrl()).not.toContain(validationSessionToken)
  })

  it('puts the validation capability on a gated v4 share', async () => {
    const validationSessionToken = `mv1_${'V'.repeat(32)}`
    await renderPage({ validationSessionToken })
    await selectMilkPhoto()
    await click(button('確認へ'))
    await click(button('LINEで送る'))

    expect(sharedPayload().requestId).toMatch(/^v4-/)
    expect(new URL(sharedRequestUrl()).searchParams.get(
      'manualValidationSessionId',
    )).toBe(validationSessionToken)
  })

  it('processes locally, uploads before OS share, and creates v4 only after confirmation', async () => {
    const events: string[] = []
    const processPhoto = vi.fn(async () => {
      events.push('process')
      return processedPhoto()
    })
    const upload = vi.fn<ProductPhotoUploadProvider['upload']>(async () => {
      events.push('upload')
    })
    share.mockImplementation(async () => {
      events.push('share')
    })
    await renderPage({ processPhoto, upload })

    await selectMilkPhoto()

    expect(processPhoto).toHaveBeenCalledTimes(1)
    expect(upload).not.toHaveBeenCalled()
    expect(share).not.toHaveBeenCalled()
    expect(container.textContent).toContain('共有前の端末内プレビュー')

    await click(button('確認へ'))
    expect(container.querySelector('img[alt="牛乳の参考写真"]')).not.toBeNull()
    expect(upload).not.toHaveBeenCalled()

    await click(button('LINEで送る'))

    expect(events).toEqual(['process', 'upload', 'share'])
    expect(upload).toHaveBeenCalledTimes(1)
    const uploadedPhotos = upload.mock.calls[0][0]
    expect(uploadedPhotos).toHaveLength(1)
    expect(uploadedPhotos[0]).toMatchObject({
      itemKey: 'milk',
      blob: expect.any(Blob),
    })
    const payload = sharedPayload()
    expect(payload.requestId).toMatch(/^v4-/)
    expect(payload.items.find((item) => item.productId === 'milk')?.photoToken).toBe(
      uploadedPhotos[0].token,
    )
  })

  it('keeps a failed photo and shares v3 only after the explicit fallback choice', async () => {
    const upload = vi.fn<ProductPhotoUploadProvider['upload']>(async () => {
      throw new ProductPhotoUploadError('service-unavailable')
    })
    await renderPage({ upload })
    await selectMilkPhoto()
    await click(button('確認へ'))

    await click(button('LINEで送る'))

    expect(upload).toHaveBeenCalledTimes(1)
    expect(share).not.toHaveBeenCalled()
    expect(container.textContent).toContain(
      '写真保存サービスで問題が発生しました',
    )
    expect(container.querySelector('img[alt="牛乳の参考写真"]')).not.toBeNull()

    await click(button('写真を外してv3で共有'))

    expect(share).toHaveBeenCalledTimes(1)
    expect(sharedPayload().requestId).toMatch(/^v3-/)
    expect(revokePreviewUrl).toHaveBeenCalledWith('blob:compressed-preview')
  })

  it.each([
    [
      'auth-failed',
      '写真保存の認証確認に失敗しました。',
    ],
    [
      'validation-session-invalid',
      '限定検証セッションを確認できませんでした。',
    ],
    [
      'validation-session-expired',
      '限定検証セッションの有効期限が切れています。',
    ],
    [
      'invalid-photo',
      '写真の形式または容量を確認できませんでした。',
    ],
    [
      'service-unavailable',
      '写真保存サービスで問題が発生しました。',
    ],
    [
      'timeout',
      '写真の保存が時間内に完了しませんでした。',
    ],
  ] as const)('shows a safe %s upload failure with only its correlation ID', async (
    code,
    expectedMessage,
  ) => {
    const upload = vi.fn<ProductPhotoUploadProvider['upload']>(async () => {
      throw new ProductPhotoUploadError(code, 'safe-photo-request-123')
    })
    await renderPage({ upload })
    await selectMilkPhoto()
    await click(button('確認へ'))
    await click(button('LINEで送る'))

    expect(container.textContent).toContain(expectedMessage)
    expect(container.textContent).toContain(`エラー分類: ${code}`)
    expect(container.textContent).toContain(
      '問い合わせID: safe-photo-request-123',
    )
    expect(container.textContent).not.toContain('SERVICE_UNAVAILABLE')
    expect(share).not.toHaveBeenCalled()
  })

  it('shows auth-failed and the safe client stage when Turnstile returns an error', async () => {
    const validationSessionToken = `mv1_${'V'.repeat(32)}`
    let renderOptions: Parameters<TurnstileApi['render']>[1] | undefined
    const fetchImplementation = vi.fn()
    vi.stubGlobal('fetch', fetchImplementation)
    window.turnstile = {
      render: vi.fn((_container, options) => {
        renderOptions = options
        return 'photo-widget'
      }),
      execute: vi.fn(() => renderOptions?.['error-callback']()),
      reset: vi.fn(),
      remove: vi.fn(),
    }
    await renderPage({
      useDefaultUploader: true,
      validationSessionToken,
    })
    await selectMilkPhoto()
    await click(button('確認へ'))
    await click(button('LINEで送る'))

    expect(
      container.querySelector('[aria-label="写真共有の認証確認"]'),
    ).not.toBeNull()
    expect(renderOptions).toMatchObject({
      action: 'product_photo_upload',
      sitekey: 'public-site-key',
    })
    expect(fetchImplementation).not.toHaveBeenCalled()
    expect(container.textContent).toContain('エラー分類: auth-failed')
    expect(container.textContent).toContain(
      '処理段階: turnstile-token-failed',
    )
    expect(container.textContent).not.toContain('問い合わせID:')
    expect(container.textContent).not.toContain(validationSessionToken)
    expect(container.textContent).not.toContain('public-site-key')
  })

  it('shows network-failed after a token is received but fetch rejects', async () => {
    const validationSessionToken = `mv1_${'V'.repeat(32)}`
    let renderOptions: Parameters<TurnstileApi['render']>[1] | undefined
    const fetchImplementation = vi.fn(async () => {
      throw new TypeError('private network detail')
    })
    vi.stubGlobal('fetch', fetchImplementation)
    window.turnstile = {
      render: vi.fn((_container, options) => {
        renderOptions = options
        return 'photo-widget'
      }),
      execute: vi.fn(() => renderOptions?.callback('private-token')),
      reset: vi.fn(),
      remove: vi.fn(),
    }
    await renderPage({
      useDefaultUploader: true,
      validationSessionToken,
    })
    await selectMilkPhoto()
    await click(button('確認へ'))
    await click(button('LINEで送る'))

    expect(fetchImplementation).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('エラー分類: network-failed')
    expect(container.textContent).toContain(
      '処理段階: photo-fetch-retry-failed',
    )
    expect(container.textContent).not.toContain('問い合わせID:')
    expect(container.textContent).not.toContain('private-token')
    expect(container.textContent).not.toContain('private network detail')
    expect(container.textContent).not.toContain(validationSessionToken)
    expect(container.textContent).not.toContain('public-site-key')
  })

  it('continues sharing without showing the first retriable network failure', async () => {
    const validationSessionToken = `mv1_${'V'.repeat(32)}`
    let renderOptions: Parameters<TurnstileApi['render']>[1] | undefined
    let finishRetry: ((response: Response) => void) | undefined
    const retryResponse = new Promise<Response>((resolve) => {
      finishRetry = resolve
    })
    let retryMetadata: Array<{ token: string; itemKey: string }> = []
    const fetchImplementation = vi.fn(async (_input, init) => {
      if (fetchImplementation.mock.calls.length === 1) {
        throw new TypeError('private first-attempt detail')
      }
      retryMetadata = JSON.parse(
        String((init?.body as FormData).get('metadata')),
      ) as Array<{ token: string; itemKey: string }>
      return retryResponse
    })
    vi.stubGlobal('fetch', fetchImplementation)
    window.turnstile = {
      render: vi.fn((_container, options) => {
        renderOptions = options
        return 'photo-widget'
      }),
      execute: vi.fn(() => renderOptions?.callback('private-token')),
      reset: vi.fn(),
      remove: vi.fn(),
    }
    await renderPage({
      useDefaultUploader: true,
      validationSessionToken,
    })
    await selectMilkPhoto()
    await click(button('確認へ'))
    await click(button('LINEで送る'))

    expect(fetchImplementation).toHaveBeenCalledTimes(2)
    expect(share).not.toHaveBeenCalled()
    expect(container.textContent).not.toContain('エラー分類:')

    await act(async () => {
      finishRetry?.(Response.json({ photos: retryMetadata }))
      await retryResponse
      await Promise.resolve()
    })

    expect(share).toHaveBeenCalledTimes(1)
    expect(sharedPayload().requestId).toMatch(/^v4-/)
    expect(container.textContent).not.toContain('エラー分類:')
    expect(container.textContent).not.toContain(
      'private first-attempt detail',
    )
    expect(container.textContent).not.toContain(validationSessionToken)
  })

  it('clears a previous correlation ID while an upload retry is running', async () => {
    let finishRetry: (() => void) | undefined
    const retry = new Promise<void>((resolve) => {
      finishRetry = resolve
    })
    const upload = vi.fn<ProductPhotoUploadProvider['upload']>()
      .mockRejectedValueOnce(
        new ProductPhotoUploadError(
          'service-unavailable',
          'previous-request-id',
        ),
      )
      .mockImplementationOnce(async () => retry)
    await renderPage({ upload })
    await selectMilkPhoto()
    await click(button('確認へ'))
    await click(button('LINEで送る'))
    expect(container.textContent).toContain('previous-request-id')

    await click(button('写真付き共有を再試行'))
    expect(container.textContent).not.toContain('previous-request-id')

    await act(async () => {
      finishRetry?.()
      await retry
      await Promise.resolve()
    })
  })

  it('blocks review while compression is pending and never uploads a rejected source', async () => {
    let resolveProcessing: ((value: ProcessedProductPhoto) => void) | undefined
    const pending = new Promise<ProcessedProductPhoto>((resolve) => {
      resolveProcessing = resolve
    })
    const upload = vi.fn<ProductPhotoUploadProvider['upload']>(
      async () => undefined,
    )
    await renderPage({ processPhoto: () => pending, upload })

    await selectMilkPhoto()

    expect(button('確認へ').disabled).toBe(true)
    expect(container.textContent).toContain('写真の圧縮が終わるまで')
    expect(upload).not.toHaveBeenCalled()

    await act(async () => {
      resolveProcessing?.(processedPhoto())
      await pending
      await Promise.resolve()
    })
    expect(button('確認へ').disabled).toBe(false)

    act(() => root.unmount())
    container.replaceChildren()
    root = createRoot(container)
    const rejectedUpload = vi.fn(async () => undefined)
    await renderPage({
      processPhoto: async () => {
        throw new ProductPhotoProcessingError('decode-failed')
      },
      upload: rejectedUpload,
    })
    await selectMilkPhoto(
      new File(['unsupported'], 'private.heic', { type: 'image/heic' }),
    )

    expect(container.textContent).toContain('この端末では写真を読み込めません')
    expect(rejectedUpload).not.toHaveBeenCalled()
    expect(share).not.toHaveBeenCalled()
  })

  it('retains a local preview at quantity zero but excludes it from sharing', async () => {
    const upload = vi.fn<ProductPhotoUploadProvider['upload']>(
      async () => undefined,
    )
    await renderPage({ upload })
    await selectMilkPhoto()

    await click(decreaseMilkButton())
    expect(container.textContent).toContain('数量0のため共有対象外')
    expect(upload).not.toHaveBeenCalled()

    await click(increaseMilkButton())
    expect(container.querySelector('img[alt="牛乳の参考写真プレビュー"]')).not.toBeNull()
  })

  it('keeps a hidden quantity-zero item reachable while its local photo is retained', async () => {
    const catalog = updateBaseProduct(
      createEmptyHouseholdCatalog('2026-08-01T00:00:00.000Z'),
      'milk',
      {
        name: milk.name,
        unit: milk.unit,
        categoryId: milk.categoryId,
        hidden: true,
      },
      '2026-08-01T00:01:00.000Z',
    )
    window.localStorage.setItem(
      'otsukai:householdCatalog:v1',
      JSON.stringify(catalog),
    )
    window.localStorage.setItem(
      'otsukai:createDraft',
      JSON.stringify({ milk: { quantity: 1, memo: '' } }),
    )
    await renderPage()

    const details = container.querySelector<HTMLButtonElement>(
      `button[aria-label^="${milk.name}の条件を開く"]`,
    )
    if (!details) throw new Error('Hidden milk details button was not rendered')
    await click(details)
    const input = container.querySelector<HTMLInputElement>(
      `input[aria-label="${milk.name}の端末写真を選ぶ"]`,
    )
    if (!input) throw new Error('Hidden milk photo input was not rendered')
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['source'], 'private.jpg', { type: 'image/jpeg' })],
    })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    await click(decreaseMilkButton())

    expect(container.textContent).toContain('写真の再利用・削除ができるように表示')
    expect(container.textContent).toContain('数量0の商品と写真は共有対象外')
    expect(container.querySelector('img[alt="牛乳の参考写真プレビュー"]')).not.toBeNull()
    expect(button('削除')).toBeDefined()
  })
})
