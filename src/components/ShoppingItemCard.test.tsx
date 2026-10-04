import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ShoppingRequestItemPayload } from '../types/shopping'
import { ShoppingItemCard } from './ShoppingItemCard'

describe('ShoppingItemCard information order', () => {
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
