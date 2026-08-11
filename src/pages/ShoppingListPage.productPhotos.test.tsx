// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { products } from '../data/products'
import {
  buildCompactRequestV4Payload,
  encodeCompactRequestV4,
} from '../utils/compactRequestV4'
import type { SelectedRequestItem } from '../utils/selectedRequestItems'
import { ShoppingListPage } from './ShoppingListPage'

const photoToken = 'p1_AAECAwQFBgcICQoLDA0ODxAREhMUFRYX'

function selectedMilk(): SelectedRequestItem {
  const product = products.find((candidate) => candidate.id === 'milk')!
  return {
    productId: product.id,
    name: product.name,
    unit: product.unit,
    categoryId: product.categoryId,
    sortOrder: product.sortOrder,
    quantity: 1,
    memo: product.memo ?? '',
    icon: product.icon,
    hidden: false,
  }
}

describe('ShoppingListPage product photo isolation', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true
    window.localStorage.clear()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    window.localStorage.clear()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('keeps the product and purchase controls usable when photo retrieval fails', async () => {
    const encoded = encodeCompactRequestV4(
      buildCompactRequestV4Payload({
        requestKey: 'photo-failure-flow',
        title: 'おつかいリスト',
        items: [selectedMilk()],
        photoRefs: [[0, photoToken]],
      }),
    )
    const fetchImplementation = vi.fn(async () =>
      Response.json({ code: 'SERVICE_UNAVAILABLE' }, { status: 503 }),
    )
    vi.stubGlobal('fetch', fetchImplementation)

    await act(async () => {
      root.render(
        <ShoppingListPage
          encodedPayload={encoded}
          payloadCodec="compact-path"
          onBackHome={() => undefined}
          onError={(title, description) => {
            throw new Error(`${title}: ${description}`)
          }}
          productPhotoConfig={{
            enabled: true,
            endpoint: 'https://worker.example/',
            turnstileSiteKey: 'public-site-key',
          }}
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(fetchImplementation).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('写真を取得できませんでした')
    expect(container.textContent).toContain('牛乳')
    const cart = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (candidate) => candidate.textContent?.trim() === 'かごに入れる',
    )
    expect(cart).toBeDefined()

    await act(async () => {
      cart?.click()
      await Promise.resolve()
    })
    expect(container.textContent).toContain('かご済み')
    expect(container.textContent).toContain('写真を取得できませんでした')
  })

  it('does not request photos while the public flag is off', async () => {
    const encoded = encodeCompactRequestV4(
      buildCompactRequestV4Payload({
        requestKey: 'photo-off-flow',
        title: 'おつかいリスト',
        items: [selectedMilk()],
        photoRefs: [[0, photoToken]],
      }),
    )
    const fetchImplementation = vi.fn()
    vi.stubGlobal('fetch', fetchImplementation)

    await act(async () => {
      root.render(
        <ShoppingListPage
          encodedPayload={encoded}
          payloadCodec="compact-path"
          onBackHome={() => undefined}
          onError={() => undefined}
          productPhotoConfig={{
            enabled: false,
            endpoint: '',
            turnstileSiteKey: '',
          }}
        />,
      )
      await Promise.resolve()
    })

    expect(fetchImplementation).not.toHaveBeenCalled()
    expect(container.textContent).toContain('牛乳')
    expect(container.querySelector('.shopping-photo')).toBeNull()
  })
})
