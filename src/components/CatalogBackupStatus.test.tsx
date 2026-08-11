// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HouseholdCatalogV1 } from '../types/householdCatalog'
import {
  createEmptyHouseholdCatalog,
  updateBaseProduct,
} from '../utils/householdCatalog'
import { CatalogBackupStatus } from './CatalogBackupStatus'

const NOW = '2026-07-26T00:00:00.000Z'

function createChangedCatalog(): HouseholdCatalogV1 {
  return updateBaseProduct(
    createEmptyHouseholdCatalog(NOW),
    'milk',
    {
      name: 'いつもの牛乳',
      unit: 'パック',
      categoryId: 'eggs-dairy',
      hidden: false,
    },
    '2026-07-26T01:00:00.000Z',
  )
}

function createOversizedCatalog(): HouseholdCatalogV1 {
  return {
    schemaVersion: 1,
    revision: 200,
    updatedAt: NOW,
    overrides: {},
    addedProducts: Array.from({ length: 200 }, (_, index) => {
      const prefix = index.toString(16).padStart(8, '0')
      const suffix = (index * 7919).toString(16).padStart(12, '0')
      return {
        id: `household:${prefix}-1234-4abc-8def-${suffix}`,
        name: `家庭商品${index}-${(index * 104729).toString(36)}`,
        unit: `袋${index % 10}`,
        categoryId: index % 2 === 0 ? 'daily' : 'other',
        hidden: index % 5 === 0,
        createdAt: NOW,
        updatedAt: NOW,
      }
    }),
  }
}

describe('CatalogBackupStatus', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true
    window.history.replaceState({}, '', '/otsukai/#/products')
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    delete (navigator as unknown as { share?: unknown }).share
    delete (navigator as unknown as { clipboard?: unknown }).clipboard
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

  async function click(element: Element) {
    await act(async () => {
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  it('requires explicit confirmation after opening the share sheet', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    const onConfirmBackup = vi.fn().mockReturnValue(true)
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: share,
    })
    await act(async () => {
      root.render(
        <CatalogBackupStatus
          catalog={createChangedCatalog()}
          backupStatus="unbacked"
          onConfirmBackup={onConfirmBackup}
        />,
      )
    })

    await click(button('復旧リンクを保存'))
    expect(share).toHaveBeenCalledTimes(1)
    expect(share.mock.calls[0][0]).toMatchObject({
      title: '買いものバトンの商品リスト復旧用リンク',
    })
    expect(share.mock.calls[0][0].text).toContain(
      'http://localhost:3000/otsukai/#/catalog/restore/',
    )
    expect(container.textContent).toContain(
      '復旧リンクをLINEやメモへ保存しましたか？',
    )
    expect(onConfirmBackup).not.toHaveBeenCalled()

    await click(button('まだ保存していない'))
    expect(onConfirmBackup).not.toHaveBeenCalled()
    expect(container.textContent).toContain('未バックアップのままです')

    await click(button('復旧リンクを保存'))
    await click(button('保存した'))
    expect(onConfirmBackup).toHaveBeenCalledTimes(1)
    expect(onConfirmBackup.mock.calls[0][0]).toMatch(/^catalog-v1-/)
  })

  it('keeps the catalog unbacked when native sharing is cancelled', async () => {
    const onConfirmBackup = vi.fn().mockReturnValue(true)
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: vi
        .fn()
        .mockRejectedValue(new DOMException('cancelled', 'AbortError')),
    })
    await act(async () => {
      root.render(
        <CatalogBackupStatus
          catalog={createChangedCatalog()}
          backupStatus="unbacked"
          onConfirmBackup={onConfirmBackup}
        />,
      )
    })

    await click(button('復旧リンクを保存'))
    expect(container.textContent).toContain('共有をキャンセルしました')
    expect(container.textContent).not.toContain(
      '復旧リンクをLINEやメモへ保存しましたか？',
    )
    expect(onConfirmBackup).not.toHaveBeenCalled()
  })

  it('uses the existing clipboard fallback before asking for confirmation', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    await act(async () => {
      root.render(
        <CatalogBackupStatus
          catalog={createChangedCatalog()}
          backupStatus="unbacked"
          onConfirmBackup={() => true}
        />,
      )
    })

    await click(button('復旧リンクを保存'))
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('復旧リンクをコピーしました')
    expect(container.textContent).toContain(
      '復旧リンクをLINEやメモへ保存しましたか？',
    )
  })

  it('exports the complete JSON when the recovery URL exceeds 2,200 characters', async () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:recovery')
    const revokeObjectURL = vi.fn()
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    })
    const onConfirmBackup = vi.fn().mockReturnValue(true)
    await act(async () => {
      root.render(
        <CatalogBackupStatus
          catalog={createOversizedCatalog()}
          backupStatus="unbacked"
          onConfirmBackup={onConfirmBackup}
        />,
      )
    })

    await click(button('復旧リンクを保存'))
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(anchorClick).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:recovery')
    expect(container.textContent).toContain('2,200文字を超えるため')
    expect(container.textContent).toContain(
      '復旧用JSONファイルを安全な場所へ保存しましたか？',
    )
    expect(onConfirmBackup).not.toHaveBeenCalled()

    await click(button('保存した'))
    expect(onConfirmBackup).toHaveBeenCalledTimes(1)
  })
})
