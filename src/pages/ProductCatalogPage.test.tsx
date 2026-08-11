// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_CATALOG_RECOVERY_JSON_BYTES,
  MAX_CATALOG_RECOVERY_JSON_CHARS,
  MAX_HOUSEHOLD_PRODUCTS,
} from '../constants/requestLimits'
import { products } from '../data/products'
import type { HouseholdCatalogV1 } from '../types/householdCatalog'
import {
  CATALOG_BACKUP_RECEIPT_KEY,
  HOUSEHOLD_CATALOG_KEY,
  saveHouseholdCatalog,
} from '../utils/catalogStorage'
import { createCatalogRecoveryBundle } from '../utils/catalogRecovery'
import {
  createEmptyHouseholdCatalog,
  updateBaseProduct,
} from '../utils/householdCatalog'
import { ProductCatalogPage } from './ProductCatalogPage'

function setNativeInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set
  if (!setter) {
    throw new Error('HTMLInputElement.value setter is unavailable')
  }
  setter.call(input, value)
}

describe('ProductCatalogPage', () => {
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
    delete (window as unknown as Record<string, unknown>).confirm
    delete (navigator as unknown as { share?: unknown }).share
    vi.restoreAllMocks()
  })

  async function renderPage() {
    await act(async () => {
      root.render(<ProductCatalogPage onBackHome={() => undefined} />)
      await Promise.resolve()
    })
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

  function recoveryFileInput(): HTMLInputElement {
    const input = container.querySelector<HTMLInputElement>(
      'input[type="file"]',
    )
    if (!input) {
      throw new Error('JSON file input was not rendered')
    }
    return input
  }

  async function selectRecoveryFile(file?: File) {
    const input = recoveryFileInput()
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: file ? [file] : [],
    })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  async function inputText(selector: string, value: string) {
    const input = container.querySelector<HTMLInputElement>(selector)
    if (!input) {
      throw new Error(`Input was not rendered: ${selector}`)
    }
    await act(async () => {
      setNativeInputValue(input, value)
      input.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: value,
          inputType: 'insertText',
        }),
      )
      await Promise.resolve()
    })
  }

  async function selectCategory(value: string) {
    const select = container.querySelector<HTMLSelectElement>(
      '.catalog-editor-fields select',
    )
    if (!select) {
      throw new Error('Category select was not rendered')
    }
    await act(async () => {
      select.value = value
      select.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })
  }

  function savedCatalog() {
    return JSON.parse(
      window.localStorage.getItem('otsukai:householdCatalog:v1') ?? '{}',
    ) as {
      overrides: Record<string, unknown>
      addedProducts: Array<{
        id: string
        name: string
        unit: string
        categoryId: string
        hidden: boolean
      }>
    }
  }

  it('opens product editing through an accessible dialog', async () => {
    await renderPage()
    expect(container.querySelector('h1')?.textContent).toBe(
      '商品リストを編集',
    )
    expect(container.textContent).toContain('変更済み 0件')
    await inputText('input[type="search"]', 'キャベツ')
    expect(container.querySelector('[aria-label="牛乳を編集"]')).toBeNull()

    const edit = container.querySelector<HTMLButtonElement>(
      '[aria-label="キャベツを編集"]',
    )
    if (!edit) {
      throw new Error('Cabbage edit button was not rendered')
    }
    await click(edit)
    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement?.textContent).toContain('キャベツを編集')
  })

  it('persists base edits, moves categories, hides and restores without changing IDs', async () => {
    await renderPage()
    const edit = container.querySelector<HTMLButtonElement>(
      '[aria-label="キャベツを編集"]',
    )
    if (!edit) {
      throw new Error('Cabbage edit button was not rendered')
    }
    await click(edit)
    await inputText(
      '[aria-describedby="catalog-product-name-count"]',
      '春キャベツ',
    )
    await inputText(
      '[aria-describedby="catalog-product-unit-count"]',
      '玉',
    )
    await selectCategory('fruits')
    await click(button('変更を保存'))

    expect(savedCatalog().overrides.cabbage).toEqual({
      name: '春キャベツ',
      unit: '玉',
      categoryId: 'fruits',
    })
    expect(container.textContent).toContain('変更済み 1件')
    const editedButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="春キャベツを編集"]',
    )
    if (!editedButton) {
      throw new Error('Edited product was not rendered')
    }
    await click(editedButton)
    await click(button('商品リストから外す'))
    expect(savedCatalog().overrides.cabbage).toEqual({
      name: '春キャベツ',
      unit: '玉',
      categoryId: 'fruits',
      hidden: true,
    })
    expect(container.textContent).toContain('非表示 1件')
    await click(button('リストに戻す'))
    expect(savedCatalog().overrides.cabbage).not.toHaveProperty('hidden')

    const restoredEdit = container.querySelector<HTMLButtonElement>(
      '[aria-label="春キャベツを編集"]',
    )
    if (!restoredEdit) {
      throw new Error('Restored product was not rendered')
    }
    await click(restoredEdit)
    await click(button('標準に戻す'))
    expect(savedCatalog().overrides).not.toHaveProperty('cabbage')
    expect(container.querySelector('[aria-label="キャベツを編集"]')).not.toBeNull()
  })

  it('adds a household product with a unique persistent ID and restores it after remount', async () => {
    await renderPage()
    await click(button('新しい商品を追加'))
    await inputText(
      '[aria-describedby="catalog-product-name-count"]',
      '麦茶パック',
    )
    await inputText(
      '[aria-describedby="catalog-product-unit-count"]',
      '袋',
    )
    await selectCategory('drinks')
    await click(button('商品を追加'))

    const added = savedCatalog().addedProducts[0]
    expect(added).toMatchObject({
      name: '麦茶パック',
      unit: '袋',
      categoryId: 'drinks',
      hidden: false,
    })
    expect(added.id).toMatch(/^household:[0-9a-f-]{36}$/)

    act(() => root.unmount())
    container.replaceChildren()
    root = createRoot(container)
    await renderPage()
    const edit = container.querySelector<HTMLButtonElement>(
      '[aria-label="麦茶パックを編集"]',
    )
    if (!edit) {
      throw new Error('Added product was not restored')
    }
    await click(edit)
    await inputText(
      '[aria-describedby="catalog-product-name-count"]',
      '水出し麦茶',
    )
    await click(button('変更を保存'))
    const edited = container.querySelector<HTMLButtonElement>(
      '[aria-label="水出し麦茶を編集"]',
    )
    if (!edited) {
      throw new Error('Edited household product was not rendered')
    }
    await click(edited)
    await click(button('商品リストから外す'))
    expect(savedCatalog().addedProducts[0].hidden).toBe(true)
    await click(button('リストに戻す'))
    expect(savedCatalog().addedProducts[0].hidden).toBe(false)
  })

  it('asks before changing the unit of a selected draft product', async () => {
    window.localStorage.setItem(
      'otsukai:createDraft',
      JSON.stringify({ milk: { quantity: 2, memo: '低脂肪' } }),
    )
    const confirm = vi
      .fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true)
    Object.defineProperty(window, 'confirm', {
      configurable: true,
      value: confirm,
    })
    await renderPage()
    const edit = container.querySelector<HTMLButtonElement>(
      '[aria-label="牛乳を編集"]',
    )
    if (!edit) {
      throw new Error('Milk edit button was not rendered')
    }
    await click(edit)
    await inputText(
      '[aria-describedby="catalog-product-unit-count"]',
      'パック',
    )
    await click(button('変更を保存'))
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    expect(savedCatalog().overrides?.milk).toBeUndefined()

    await click(button('変更を保存'))
    expect(confirm).toHaveBeenLastCalledWith(
      'この商品は作成中の依頼で2本選択されています。\n単位を「パック」に変更すると、2パックとして表示されます。',
    )
    expect(savedCatalog().overrides.milk).toEqual({ unit: 'パック' })
  })

  it('closes with Escape and restores focus to the opening control', async () => {
    await renderPage()
    const add = button('新しい商品を追加')
    add.focus()
    await click(add)
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )
      await Promise.resolve()
    })
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(add)
  })

  it('previews and restores a JSON backup through the shared recovery flow', async () => {
    const recoveredCatalog = updateBaseProduct(
      createEmptyHouseholdCatalog('2026-07-26T00:00:00.000Z'),
      'milk',
      {
        name: '復元した牛乳',
        unit: 'パック',
        categoryId: 'drinks',
        hidden: false,
      },
      '2026-07-26T01:00:00.000Z',
    )
    const bundle = createCatalogRecoveryBundle(
      'https://example.test/otsukai/',
      recoveredCatalog,
      '2026-07-26T02:00:00.000Z',
    )
    await renderPage()
    const file = new File([bundle.json], bundle.fileName, {
      type: 'application/json',
    })
    await selectRecoveryFile(file)

    expect(container.querySelector('h1')?.textContent).toBe(
      '商品リストを復元',
    )
    expect(container.textContent).toContain('名前変更')
    expect(window.localStorage.getItem('otsukai:householdCatalog:v1')).toBeNull()

    await click(button('この商品リストに置き換える'))
    expect(savedCatalog().overrides.milk).toEqual({
      name: '復元した牛乳',
      unit: 'パック',
      categoryId: 'drinks',
    })
    expect(container.querySelector('h1')?.textContent).toBe(
      '商品リストを編集',
    )
    expect(container.textContent).toContain(
      '復旧用JSONファイルから商品リストを復元しました。',
    )
    expect(
      JSON.parse(
        window.localStorage.getItem(CATALOG_BACKUP_RECEIPT_KEY) ?? '{}',
      ).catalogFingerprint,
    ).toMatch(/^catalog-v1-/)
  })

  it('ignores a JSON change event when no file is selected', async () => {
    await renderPage()

    await selectRecoveryFile()

    expect(container.querySelector('h1')?.textContent).toBe(
      '商品リストを編集',
    )
    expect(container.querySelector('.catalog-notice')).toBeNull()
  })

  it('rejects a JSON file above the byte safety limit before reading it', async () => {
    await renderPage()
    const file = new File(
      ['x'.repeat(MAX_CATALOG_RECOVERY_JSON_BYTES + 1)],
      'oversized.json',
      { type: 'application/json' },
    )
    const text = vi.spyOn(file, 'text')

    await selectRecoveryFile(file)

    expect(text).not.toHaveBeenCalled()
    expect(container.textContent).toContain(
      '商品リスト復旧データが大きすぎます。',
    )
  })

  it('reads a byte-safe file and then enforces the expanded character limit', async () => {
    await renderPage()
    const file = new File(
      ['x'.repeat(MAX_CATALOG_RECOVERY_JSON_CHARS + 1)],
      'too-many-characters.json',
      { type: 'application/json' },
    )
    const text = vi.spyOn(file, 'text')

    await selectRecoveryFile(file)

    expect(text).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain(
      '商品リスト復旧データが大きすぎます。',
    )
  })

  it('accepts a valid recovery JSON whose UTF-8 bytes exceed its character count', async () => {
    const now = '2026-07-26T00:00:00.000Z'
    const familyEmoji = '👨‍👩‍👧‍👦'
    const catalog: HouseholdCatalogV1 = {
      schemaVersion: 1,
      revision: 1,
      updatedAt: now,
      overrides: Object.fromEntries(
        products.map((product) => [
          product.id,
          {
            name: familyEmoji.repeat(30),
            unit: familyEmoji.repeat(10),
            categoryId: 'other',
            hidden: true,
          },
        ]),
      ),
      addedProducts: Array.from(
        { length: MAX_HOUSEHOLD_PRODUCTS },
        (_, index) => ({
          id: `household:00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
          name: familyEmoji.repeat(30),
          unit: familyEmoji.repeat(10),
          categoryId: 'other',
          hidden: true,
          createdAt: now,
          updatedAt: now,
        }),
      ),
    }
    const bundle = createCatalogRecoveryBundle(
      'https://example.test/otsukai/',
      catalog,
      now,
    )
    const file = new File([bundle.json], bundle.fileName, {
      type: 'application/json',
    })
    expect(bundle.json.length).toBeLessThanOrEqual(
      MAX_CATALOG_RECOVERY_JSON_CHARS,
    )
    expect(file.size).toBeGreaterThan(MAX_CATALOG_RECOVERY_JSON_CHARS)
    await renderPage()

    await selectRecoveryFile(file)

    expect(container.querySelector('h1')?.textContent).toBe(
      '商品リストを復元',
    )
    expect(container.textContent).not.toContain(
      '商品リスト復旧データが大きすぎます。',
    )
  })

  it('shows a safe notice when reading the JSON file fails', async () => {
    await renderPage()
    const file = new File(['{}'], 'unreadable.json', {
      type: 'application/json',
    })
    vi.spyOn(file, 'text').mockRejectedValue(
      new Error('ファイルを読み込めませんでした。'),
    )

    await selectRecoveryFile(file)

    expect(container.textContent).toContain(
      'ファイルを読み込めませんでした。',
    )
    expect(container.querySelector('h1')?.textContent).toBe(
      '商品リストを編集',
    )
  })

  it.each([
    {
      label: 'invalid JSON',
      json: '{broken',
      expected: '商品リスト復旧JSONの形式が正しくありません。',
    },
    {
      label: 'unsupported version',
      json: JSON.stringify({
        version: 2,
        createdAt: '2026-07-26T02:00:00.000Z',
        catalog: createEmptyHouseholdCatalog(
          '2026-07-26T01:00:00.000Z',
        ),
      }),
      expected: '商品リスト復旧データの形式が正しくありません。',
    },
    {
      label: 'dangerous object key',
      json: `{"version":1,"createdAt":"2026-07-26T02:00:00.000Z","catalog":{"schemaVersion":1,"revision":1,"updatedAt":"2026-07-26T01:00:00.000Z","overrides":{"__proto__":{"hidden":true}},"addedProducts":[]}}`,
      expected: '商品リスト復旧データの形式が正しくありません。',
    },
  ])('rejects $label without opening a recovery preview', async ({ json, expected }) => {
    await renderPage()

    await selectRecoveryFile(
      new File([json], 'invalid.json', { type: 'application/json' }),
    )

    expect(container.textContent).toContain(expected)
    expect(container.querySelector('h1')?.textContent).toBe(
      '商品リストを編集',
    )
  })

  it('warns for older JSON data and cancels without replacing the current catalog', async () => {
    const currentCatalog = updateBaseProduct(
      createEmptyHouseholdCatalog('2026-07-27T00:00:00.000Z'),
      'milk',
      {
        name: '現在の牛乳',
        unit: '本',
        categoryId: 'eggs-dairy',
        hidden: false,
      },
      '2026-07-27T01:00:00.000Z',
    )
    const recoveredCatalog = updateBaseProduct(
      createEmptyHouseholdCatalog('2026-07-25T00:00:00.000Z'),
      'milk',
      {
        name: '古い牛乳',
        unit: 'パック',
        categoryId: 'drinks',
        hidden: false,
      },
      '2026-07-25T01:00:00.000Z',
    )
    expect(saveHouseholdCatalog(currentCatalog).ok).toBe(true)
    const bundle = createCatalogRecoveryBundle(
      'https://example.test/otsukai/',
      recoveredCatalog,
      '2026-07-25T02:00:00.000Z',
    )
    await renderPage()

    await selectRecoveryFile(
      new File([bundle.json], bundle.fileName, {
        type: 'application/json',
      }),
    )

    expect(container.textContent).toContain(
      'この復旧データは、現在の商品リストより古い可能性があります。',
    )
    await click(button('キャンセル'))
    expect(container.querySelector('h1')?.textContent).toBe(
      '商品リストを編集',
    )
    expect(
      JSON.parse(
        window.localStorage.getItem(HOUSEHOLD_CATALOG_KEY) ?? '{}',
      ),
    ).toEqual(currentCatalog)
  })

  it('keeps the current catalog on screen when JSON recovery persistence fails', async () => {
    const currentCatalog = updateBaseProduct(
      createEmptyHouseholdCatalog('2026-07-26T00:00:00.000Z'),
      'milk',
      {
        name: '現在の牛乳',
        unit: '本',
        categoryId: 'eggs-dairy',
        hidden: false,
      },
      '2026-07-26T01:00:00.000Z',
    )
    const recoveredCatalog = updateBaseProduct(
      createEmptyHouseholdCatalog('2026-07-26T00:00:00.000Z'),
      'milk',
      {
        name: '復元対象の牛乳',
        unit: 'パック',
        categoryId: 'drinks',
        hidden: false,
      },
      '2026-07-26T02:00:00.000Z',
    )
    expect(saveHouseholdCatalog(currentCatalog).ok).toBe(true)
    const bundle = createCatalogRecoveryBundle(
      'https://example.test/otsukai/',
      recoveredCatalog,
      '2026-07-26T03:00:00.000Z',
    )
    await renderPage()
    await selectRecoveryFile(
      new File([bundle.json], bundle.fileName, {
        type: 'application/json',
      }),
    )
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
    ).toEqual(currentCatalog)
    expect(
      window.localStorage.getItem(CATALOG_BACKUP_RECEIPT_KEY),
    ).toBeNull()
  })

  it('restores the catalog but keeps it unbacked when the receipt write fails', async () => {
    const recoveredCatalog = updateBaseProduct(
      createEmptyHouseholdCatalog('2026-07-26T00:00:00.000Z'),
      'milk',
      {
        name: '復元した牛乳',
        unit: 'パック',
        categoryId: 'drinks',
        hidden: false,
      },
      '2026-07-26T02:00:00.000Z',
    )
    const bundle = createCatalogRecoveryBundle(
      'https://example.test/otsukai/',
      recoveredCatalog,
      '2026-07-26T03:00:00.000Z',
    )
    await renderPage()
    await selectRecoveryFile(
      new File([bundle.json], bundle.fileName, {
        type: 'application/json',
      }),
    )
    const originalSetItem = window.localStorage.setItem.bind(
      window.localStorage,
    )
    const setItem = vi.spyOn(window.localStorage, 'setItem').mockImplementation(
      (key: string, value: string) => {
        if (key === CATALOG_BACKUP_RECEIPT_KEY) {
          throw new DOMException('storage full', 'QuotaExceededError')
        }
        originalSetItem(key, value)
      },
    )

    await click(button('この商品リストに置き換える'))
    setItem.mockRestore()

    expect(savedCatalog()).toEqual(recoveredCatalog)
    expect(
      window.localStorage.getItem(CATALOG_BACKUP_RECEIPT_KEY),
    ).toBeNull()
    expect(container.textContent).toContain(
      '商品リストに未バックアップの変更があります',
    )
  })

  it('records a backup receipt only after the user confirms saving the link', async () => {
    const changed = updateBaseProduct(
      createEmptyHouseholdCatalog('2026-07-26T00:00:00.000Z'),
      'milk',
      {
        name: 'いつもの牛乳',
        unit: '本',
        categoryId: 'eggs-dairy',
        hidden: false,
      },
      '2026-07-26T01:00:00.000Z',
    )
    window.localStorage.setItem(
      'otsukai:householdCatalog:v1',
      JSON.stringify(changed),
    )
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    })
    await renderPage()

    await click(button('復旧リンクを保存'))
    expect(
      window.localStorage.getItem('otsukai:catalogBackupReceipt:v1'),
    ).toBeNull()
    await click(button('保存した'))
    expect(
      JSON.parse(
        window.localStorage.getItem(
          'otsukai:catalogBackupReceipt:v1',
        ) ?? '{}',
      ).catalogFingerprint,
    ).toMatch(/^catalog-v1-/)
    expect(container.textContent).toContain(
      '現在の変更はバックアップ済みです。',
    )
  })
})
