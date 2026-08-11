import { describe, expect, it } from 'vitest'
import { createInitialCreateRequestState } from '../utils/createRequestState'
import { products } from './products'

describe('meat product defaults', () => {
  it('keeps the established product metadata and defaults both meat conditions to domestic', () => {
    expect(products.find((product) => product.id === 'pork-koma')).toEqual({
      id: 'pork-koma',
      name: '豚小間肉',
      categoryId: 'meat',
      defaultQuantity: 3,
      unit: 'パック',
      memo: '国産',
      icon: '🥩',
      sortOrder: 401,
    })
    expect(products.find((product) => product.id === 'ground-chicken')).toEqual({
      id: 'ground-chicken',
      name: 'とりひき肉',
      categoryId: 'meat',
      defaultQuantity: 1,
      unit: 'パック',
      memo: '国産',
      icon: '🍗',
      sortOrder: 402,
    })
  })

  it('places the domestic condition in a new request draft without selecting either product', () => {
    const { draft } = createInitialCreateRequestState(undefined, products)

    expect(draft['pork-koma']).toEqual({ quantity: 0, memo: '国産' })
    expect(draft['ground-chicken']).toEqual({ quantity: 0, memo: '国産' })
  })
})
