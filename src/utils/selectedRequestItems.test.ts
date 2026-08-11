import { describe, expect, it } from 'vitest'
import type { EffectiveProduct } from '../types/householdCatalog'
import {
  buildSelectedRequestItems,
  toStableCustomProductId,
} from './selectedRequestItems'

const products: EffectiveProduct[] = [
  {
    id: 'visible',
    name: '表示商品',
    categoryId: 'vegetables',
    defaultQuantity: 1,
    unit: '個',
    icon: '🛒',
    sortOrder: 2,
    source: 'base',
    hidden: false,
    isCustomized: false,
  },
  {
    id: 'hidden',
    name: '非表示商品',
    categoryId: 'other',
    defaultQuantity: 1,
    unit: '袋',
    icon: '🛒',
    sortOrder: 1,
    source: 'base',
    hidden: true,
    isCustomized: true,
  },
]

describe('selected request item projection', () => {
  it('keeps hidden selected products, stable catalog order, and visible snapshots', () => {
    expect(
      buildSelectedRequestItems(
        products,
        {
          visible: { quantity: 1, memo: '' },
          hidden: { quantity: 2, memo: '条件' },
        },
        [],
      ),
    ).toEqual([
      {
        productId: 'hidden',
        name: '非表示商品',
        unit: '袋',
        categoryId: 'other',
        sortOrder: 1,
        quantity: 2,
        memo: '条件',
        icon: '🛒',
        hidden: true,
      },
      {
        productId: 'visible',
        name: '表示商品',
        unit: '個',
        categoryId: 'vegetables',
        sortOrder: 2,
        quantity: 1,
        memo: '',
        icon: '🛒',
        hidden: false,
      },
    ])
  })

  it('drops a hidden product only after its quantity reaches zero', () => {
    expect(
      buildSelectedRequestItems(
        products,
        {
          visible: { quantity: 0, memo: '' },
          hidden: { quantity: 0, memo: '保持される下書き条件' },
        },
        [],
      ),
    ).toEqual([])
  })

  it('adds one-time custom items as v3 snapshot candidates', () => {
    expect(
      buildSelectedRequestItems(
        [],
        {},
        [
          {
            id: 'custom-item-123',
            name: ' 一回商品 ',
            quantity: 3,
            unit: '',
            memo: ' 条件 ',
          },
        ],
      ),
    ).toEqual([
      {
        productId: 'custom:custom-item-123',
        name: '一回商品',
        unit: '個',
        categoryId: 'other',
        sortOrder: 10_000,
        quantity: 3,
        memo: '条件',
        icon: '🛒',
        hidden: false,
      },
    ])
  })

  it('keeps custom product IDs stable across edits and array reordering', () => {
    const first = {
      id: 'first-id',
      name: '電池',
      quantity: 1,
      unit: '個',
      memo: '',
    }
    const second = {
      id: 'second-id',
      name: 'ラップ',
      quantity: 1,
      unit: '個',
      memo: '',
    }

    const initial = buildSelectedRequestItems([], {}, [first, second])
    const reordered = buildSelectedRequestItems([], {}, [
      { ...second, name: '食品用ラップ' },
      first,
    ])
    const afterDeletion = buildSelectedRequestItems([], {}, [second])

    expect(initial.map((item) => item.productId)).toEqual([
      'custom:first-id',
      'custom:second-id',
    ])
    expect(reordered.map((item) => item.productId)).toEqual([
      'custom:second-id',
      'custom:first-id',
    ])
    expect(afterDeletion[0].productId).toBe('custom:second-id')
  })

  it('does not duplicate the custom namespace and rejects unsafe IDs', () => {
    expect(toStableCustomProductId('custom:existing-id')).toBe(
      'custom:existing-id',
    )
    expect(() => toStableCustomProductId('')).toThrow(
      'Invalid custom item ID',
    )
    expect(() => toStableCustomProductId('contains whitespace')).toThrow(
      'Invalid custom item ID',
    )
  })
})
