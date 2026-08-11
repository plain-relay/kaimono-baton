// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CATALOG_BACKUP_RECEIPT_KEY,
  HOUSEHOLD_CATALOG_KEY,
  HOUSEHOLD_CATALOG_PREVIOUS_KEY,
  saveHouseholdCatalog,
} from '../utils/catalogStorage'
import { createCatalogRecoveryBundle } from '../utils/catalogRecovery'
import {
  createEmptyHouseholdCatalog,
  updateBaseProduct,
} from '../utils/householdCatalog'
import { CatalogRecoveryPage } from './CatalogRecoveryPage'

const NOW = '2026-07-26T00:00:00.000Z'

function changedCatalog(
  name: string,
  updatedAt: string,
) {
  return updateBaseProduct(
    createEmptyHouseholdCatalog(NOW),
    'milk',
    {
      name,
      unit: 'パック',
      categoryId: 'drinks',
      hidden: true,
    },
    updatedAt,
  )
}

describe('CatalogRecoveryPage', () => {
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
    vi.restoreAllMocks()
  })

  async function renderPage(
    encoded: string,
    onBackHome = vi.fn(),
    onOpenProducts = vi.fn(),
  ) {
    await act(async () => {
      root.render(
        <CatalogRecoveryPage
          encoded={encoded}
          onBackHome={onBackHome}
          onOpenProducts={onOpenProducts}
        />,
      )
    })
    return { onBackHome, onOpenProducts }
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

  it('previews without saving, warns about an older link, then replaces with a previous generation', async () => {
    const current = changedCatalog(
      '現在の牛乳',
      '2026-07-27T00:00:00.000Z',
    )
    const recovered = changedCatalog(
      '復元した牛乳',
      '2026-07-25T00:00:00.000Z',
    )
    expect(saveHouseholdCatalog(current).ok).toBe(true)
    const bundle = createCatalogRecoveryBundle(
      'https://example.test/otsukai/',
      recovered,
      '2026-07-25T01:00:00.000Z',
    )

    await renderPage(bundle.encoded)
    expect(container.querySelector('h1')?.textContent).toBe(
      '商品リストを復元',
    )
    expect(document.activeElement).toBe(container.querySelector('h1'))
    expect(container.textContent).toContain('名前変更')
    expect(container.textContent).toContain('単位変更')
    expect(container.textContent).toContain('カテゴリ変更')
    expect(container.textContent).toContain('非表示')
    expect(container.textContent).toContain('現在の商品リストより古い可能性')
    expect(
      JSON.parse(
        window.localStorage.getItem(HOUSEHOLD_CATALOG_KEY) ?? '{}',
      ),
    ).toEqual(current)
    expect(
      window.localStorage.getItem(CATALOG_BACKUP_RECEIPT_KEY),
    ).toBeNull()

    await click(button('この商品リストに置き換える'))
    expect(container.textContent).toContain('商品リストを置き換えました')
    expect(
      JSON.parse(
        window.localStorage.getItem(HOUSEHOLD_CATALOG_KEY) ?? '{}',
      ),
    ).toEqual(recovered)
    expect(
      JSON.parse(
        window.localStorage.getItem(HOUSEHOLD_CATALOG_PREVIOUS_KEY) ?? '{}',
      ),
    ).toEqual(current)
    expect(
      JSON.parse(
        window.localStorage.getItem(CATALOG_BACKUP_RECEIPT_KEY) ?? '{}',
      ).catalogFingerprint,
    ).toBe(bundle.fingerprint)
  })

  it('uses cancel as a safe operation without replacing the current catalog', async () => {
    const current = changedCatalog(
      '現在の牛乳',
      '2026-07-27T00:00:00.000Z',
    )
    expect(saveHouseholdCatalog(current).ok).toBe(true)
    const bundle = createCatalogRecoveryBundle(
      'https://example.test/otsukai/',
      changedCatalog('古い牛乳', '2026-07-25T00:00:00.000Z'),
      '2026-07-25T01:00:00.000Z',
    )
    const { onBackHome } = await renderPage(bundle.encoded)

    await click(button('キャンセル'))
    expect(onBackHome).toHaveBeenCalledTimes(1)
    expect(
      JSON.parse(
        window.localStorage.getItem(HOUSEHOLD_CATALOG_KEY) ?? '{}',
      ),
    ).toEqual(current)
  })

  it('keeps the preview and current catalog when recovery persistence fails', async () => {
    const current = changedCatalog(
      '現在の牛乳',
      '2026-07-27T00:00:00.000Z',
    )
    const recovered = changedCatalog(
      '復元対象の牛乳',
      '2026-07-25T00:00:00.000Z',
    )
    expect(saveHouseholdCatalog(current).ok).toBe(true)
    const bundle = createCatalogRecoveryBundle(
      'https://example.test/otsukai/',
      recovered,
      '2026-07-25T01:00:00.000Z',
    )
    await renderPage(bundle.encoded)
    const originalSetItem = window.localStorage.setItem.bind(
      window.localStorage,
    )
    const setItem = vi.spyOn(window.localStorage, 'setItem').mockImplementation(
      (key: string, value: string) => {
        if (key === HOUSEHOLD_CATALOG_KEY) {
          throw new DOMException('storage full', 'QuotaExceededError')
        }
        originalSetItem(key, value)
      },
    )

    await click(button('この商品リストに置き換える'))
    setItem.mockRestore()

    expect(container.querySelector('h1')?.textContent).toBe(
      '商品リストを復元',
    )
    expect(container.textContent).toContain(
      '商品リストを復元できませんでした。',
    )
    expect(
      JSON.parse(
        window.localStorage.getItem(HOUSEHOLD_CATALOG_KEY) ?? '{}',
      ),
    ).toEqual(current)
    expect(
      window.localStorage.getItem(CATALOG_BACKUP_RECEIPT_KEY),
    ).toBeNull()
  })

  it('shows a safe error for a broken recovery link', async () => {
    await renderPage('broken-data')
    expect(container.textContent).toContain('復旧データを確認できません')
    expect(container.textContent).toContain('復元できませんでした')
    expect(container.querySelector('button')?.textContent).toContain(
      'ホームへ',
    )
  })
})
