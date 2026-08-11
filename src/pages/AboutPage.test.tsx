// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  saveCatalogBackupReceipt,
  saveHouseholdCatalog,
} from '../utils/catalogStorage'
import { createCatalogFingerprint } from '../utils/catalogFingerprint'
import {
  createEmptyHouseholdCatalog,
  updateBaseProduct,
} from '../utils/householdCatalog'
import { AboutPage } from './AboutPage'
import { HomePage } from './HomePage'

describe('home and about pages', () => {
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
  })

  it('keeps the create action on home, adds the about action, and removes technical cards', () => {
    const onStartCreate = vi.fn()
    const onOpenProducts = vi.fn()
    const onOpenAbout = vi.fn()
    act(() => root.render(
      <HomePage
        onStartCreate={onStartCreate}
        onOpenProducts={onOpenProducts}
        onOpenAbout={onOpenAbout}
      />,
    ))

    expect(container.textContent).toContain('依頼を作る')
    expect(container.textContent).toContain('商品リストを編集')
    expect(container.textContent).toContain('このアプリについて')
    expect(container.textContent).toContain('外部試験版（Beta）')
    expect(container.textContent).toContain('試験公開中')
    expect(container.textContent).not.toContain('サーバーや外部DB')
    expect(container.textContent).not.toContain('localStorage')
    expect(container.textContent).not.toContain('未バックアップの変更')

    const productsButton = [...container.querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.trim() === '商品リストを編集',
    )
    act(() => productsButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onOpenProducts).toHaveBeenCalledTimes(1)

    const aboutButton = [...container.querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.trim() === 'このアプリについて',
    )
    act(() => aboutButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onOpenAbout).toHaveBeenCalledTimes(1)
    expect(onStartCreate).not.toHaveBeenCalled()
  })

  it('explains beta, capability URL, safety, feature, and data boundaries', () => {
    const onBackHome = vi.fn()
    act(() => root.render(<AboutPage onBackHome={onBackHome} />))

    expect(container.querySelector('h1')?.textContent).toBe('このアプリについて')
    expect(container.textContent).toContain('外部試験公開中')
    expect(container.textContent).toContain('不具合がある場合があります')
    expect(container.textContent).toContain('依頼内容は共有URLに含まれています。')
    expect(container.textContent).toMatch(
      /共有URLを知っている人は、依頼内容を見ることができます/,
    )
    expect(container.textContent).toMatch(
      /パスワード、個人情報、その他の秘密にしたい情報は書かない/,
    )
    expect(container.textContent).toMatch(
      /医療やアレルギー.*このアプリの情報だけに頼らず、購入者と直接確認/,
    )
    expect(container.textContent).toMatch(
      /写真、更新可能な依頼.*手書き取り込み.*提供対象外/,
    )
    expect(container.textContent).toMatch(
      /商品名・条件・共有URL.*アクセス解析.*自動収集しません/,
    )
    expect(container.textContent).not.toContain('共有時から14日間だけ保存')
    expect(container.textContent).toContain(
      '買い物の進捗は、操作している端末とブラウザ内',
    )
    expect(container.textContent).toContain(
      '別の端末や別のブラウザでは、進捗が引き継がれない場合があります。',
    )
    expect(container.textContent).toContain(
      'アカウント登録やサーバーへの進捗保存は使用していません。',
    )
    expect(container.textContent).toContain('LINE内ブラウザとChrome・Safari')

    const homeButton = container.querySelector('button')
    act(() => homeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onBackHome).toHaveBeenCalledTimes(1)
  })

  it('explains fixed and live request storage only when live requests are enabled', () => {
    act(() =>
      root.render(
        <AboutPage
          onBackHome={() => undefined}
          liveRequestsEnabled={true}
        />,
      ),
    )

    expect(container.textContent).toContain(
      '通常の固定依頼は、依頼内容が共有URLに含まれています。',
    )
    expect(container.textContent).toContain(
      '共有URLを知っている人は、依頼内容を見ることができます。',
    )
    expect(container.textContent).toContain('秘密にしたい情報は書かないでください。')
    expect(container.textContent).toContain('共有時から14日間だけ保存')
    expect(container.textContent).toContain('提供対象外です。')
  })

  it('shows a subdued recovery-link reminder only for unbacked catalog changes', () => {
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
    expect(saveHouseholdCatalog(changed).ok).toBe(true)

    act(() =>
      root.render(
        <HomePage
          onStartCreate={() => undefined}
          onOpenProducts={() => undefined}
          onOpenAbout={() => undefined}
        />,
      ),
    )

    expect(container.textContent).toContain(
      '商品リストに未バックアップの変更があります。',
    )
    expect(container.textContent).toContain('復旧リンクを保存')
  })

  it('does not show the home reminder after the same catalog is confirmed as backed up', () => {
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
    expect(saveHouseholdCatalog(changed).ok).toBe(true)
    expect(
      saveCatalogBackupReceipt({
        catalogFingerprint: createCatalogFingerprint(changed),
        confirmedAt: '2026-07-26T02:00:00.000Z',
      }),
    ).toBe(true)

    act(() =>
      root.render(
        <HomePage
          onStartCreate={() => undefined}
          onOpenProducts={() => undefined}
          onOpenAbout={() => undefined}
        />,
      ),
    )

    expect(container.textContent).not.toContain('未バックアップの変更')
    expect(container.textContent).not.toContain('復旧リンクを保存')
  })
})
