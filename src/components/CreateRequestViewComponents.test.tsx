// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { categories } from '../data/categories'
import { products } from '../data/products'
import { RequestLimitNotice } from './RequestLimitNotice'
import { RequestReviewView } from './RequestReviewView'

describe('create request presentational components', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('preserves warning text, status semantics, and error styling', () => {
    act(() =>
      root.render(
        <RequestLimitNotice
          hasError={false}
          isConditionWarning
          isShareUrlOverLimit={false}
          isShareUrlWarning
          limitMessage=""
          shareUrlLength={1_760}
          totalConditionCharacters={800}
        />,
      ),
    )

    const notice = container.querySelector('.request-limit-notice')
    expect(notice?.classList.contains('is-warning')).toBe(true)
    expect(notice?.getAttribute('role')).toBe('status')
    expect(notice?.getAttribute('aria-live')).toBe('polite')
    expect(notice?.textContent).toContain('現在 800 / 1,000文字です。')
    expect(notice?.textContent).toContain('現在 1,760 / 2,200文字です。')

    act(() =>
      root.render(
        <RequestLimitNotice
          hasError
          isConditionWarning={false}
          isShareUrlOverLimit={false}
          isShareUrlWarning={false}
          limitMessage="条件は30文字までです。"
          totalConditionCharacters={0}
        />,
      ),
    )

    expect(notice?.classList.contains('is-error')).toBe(true)
    expect(notice?.textContent).toContain('共有URLを生成できませんでした。')
    expect(notice?.textContent).toContain('条件は30文字までです。')
  })

  it('keeps the review DOM and share callbacks connected', () => {
    const product = products[0]
    const category = categories.find((item) => item.id === product.categoryId)
    if (!category) {
      throw new Error('Test product category is missing')
    }
    const onShareRequest = vi.fn()
    const onReturnToEdit = vi.fn()

    act(() =>
      root.render(
        <RequestReviewView
          customItems={[
            {
              id: 'custom-test',
              name: '追加商品',
              quantity: 2,
              unit: '袋',
              memo: '小さめ',
            },
          ]}
          draft={{ [product.id]: { quantity: 1, memo: '新鮮なもの' } }}
          groupedSelectedProducts={[{ category, items: [product] }]}
          isSharingRequest={false}
          onReturnToEdit={onReturnToEdit}
          onShareRequest={onShareRequest}
          selectedCount={2}
          shareMessage="共有をキャンセルしました。入力内容はそのまま残しています。"
          shareStatus="cancelled"
        />,
      ),
    )

    expect(container.querySelector('h1')?.textContent).toBe('依頼内容の確認')
    expect(container.textContent).toContain(`${product.name} 1${product.unit}`)
    expect(container.textContent).toContain('条件: 新鮮なもの')
    expect(container.textContent).toContain('追加商品 2袋')
    expect(container.querySelector('.copy-message')?.getAttribute('role')).toBe(
      'status',
    )

    const buttons = [...container.querySelectorAll('button')]
    act(() =>
      buttons
        .find((button) => button.textContent?.trim() === 'LINEで送る')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true })),
    )
    act(() =>
      buttons
        .find((button) => button.textContent?.trim() === '修正する')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true })),
    )

    expect(onShareRequest).toHaveBeenCalledTimes(1)
    expect(onReturnToEdit).toHaveBeenCalledTimes(1)
  })
})
