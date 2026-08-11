import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Product } from '../types/product'
import { ProductCard } from './ProductCard'

const product: Product = {
  id: 'milk',
  name: '牛乳',
  categoryId: 'eggs-dairy',
  defaultQuantity: 1,
  unit: '本',
  icon: '🥛',
  sortOrder: 1,
}

function render(quantity: number, memo = ''): string {
  return renderToStaticMarkup(
    <ProductCard
      product={product}
      draft={{ quantity, memo }}
      isExpanded
      onIncrease={() => undefined}
      onDecrease={() => undefined}
      onToggleDetails={() => undefined}
      onMemoCommit={(value) => ({ value, accepted: true })}
    />,
  )
}

describe('ProductCard limits', () => {
  it('disables plus at 20 and displays the quantity limit', () => {
    const markup = render(20)
    expect(markup).toContain('数量は20個までです。')
    expect(markup).toMatch(/disabled=""[^>]*aria-label="牛乳を1本増やす/)
  })

  it('re-enables plus after returning to 19', () => {
    const markup = render(19)
    expect(markup).not.toContain('数量は20個までです。')
    expect(markup).not.toMatch(/disabled=""[^>]*aria-label="牛乳を1本増やす/)
  })

  it('connects the 30-character counter to the condition input', () => {
    const markup = render(1, '低脂肪')
    expect(markup).not.toContain('maxLength=')
    expect(markup).toContain('aria-describedby="product-condition-milk-count"')
    expect(markup).toContain('id="product-condition-milk-count"')
    expect(markup).toContain('3 / 30')
  })
})
