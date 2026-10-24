import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ShoppingRequestItemPayload } from '../types/shopping'
import { ShoppingItemCard } from './ShoppingItemCard'

describe('ShoppingItemCard information order', () => {
  it.each([
    ['pending', '', false, false, false],
    ['notBuying', '', false, false, false],
    ['consulting', '', false, false, false],
    ['inCart', '国産', false, false, false],
    ['inCart', '', false, false, true],
    ['verified', '国産', false, false, true],
    ['verified', '', true, false, false],
    ['verified', '', false, true, false],
  ] as const)('compacts %s only when confirmation, consultation and change notices permit it', (status, memo, unresolved, changed, compact) => {
    const item: ShoppingRequestItemPayload = { id: 'test', productId: 'test', productNameSnapshot: '合成商品',
      quantity: 2, unit: '個', memo, categoryIdSnapshot: 'other', categoryNameSnapshot: 'その他', iconSnapshot: '', sortOrderSnapshot: 1 }
    const markup = renderToStaticMarkup(<ShoppingItemCard item={item} status={status}
      consultation={unresolved ? { itemId: item.id, reason: 'other', note: '確認？', status: 'shared' } : undefined}
      changeNotice={changed ? <span>未確認変更</span> : undefined}
      isPurchaseLocked={false} isConsultationLocked={false} onAddToCart={() => undefined}
      onOpenConditionConfirmation={() => undefined} onOpenConsultation={() => undefined} onReset={() => undefined} />)
    expect(markup.includes(' is-compact')).toBe(compact)
    if (compact) expect(markup).toContain('aria-expanded="false"')
    if (changed) expect(markup).toContain('未確認変更')
  })

  it.each([[1, '玉'], [1, '袋'], [2, '個']] as const)(
    'keeps quantity %s and unit %s together in the title and purchase action',
    (quantity, unit) => {
      const item: ShoppingRequestItemPayload = {
        id: 'apple', productId: 'apple', productNameSnapshot: 'りんご',
        categoryIdSnapshot: 'fruits', categoryNameSnapshot: '果物',
        quantity, unit, memo: '国産・傷のないもの', iconSnapshot: '🍎', sortOrderSnapshot: 1,
      }
      const markup = renderToStaticMarkup(
        <ShoppingItemCard
          item={item} status="pending" isPurchaseLocked={false} isConsultationLocked={false}
          onAddToCart={() => undefined} onOpenConditionConfirmation={() => undefined}
          onOpenConsultation={() => undefined} onReset={() => undefined}
          photoContent={<span>参考写真</span>}
        />,
      )
      expect(markup).toContain(`必要数量 ${quantity}${unit}`)
      expect(markup).toContain(`>${quantity}${unit}</span>`)
      expect(markup).toContain(`>${quantity}${unit}をかごに入れる</button>`)
      expect(markup.indexOf('りんご')).toBeLessThan(markup.indexOf('必要数量'))
      expect(markup.indexOf('条件: 国産・傷のないもの')).toBeLessThan(markup.indexOf('参考写真'))
      expect(markup).not.toContain('条件あり')
    },
  )
})
