import { describe, expect, it } from 'vitest'
import { MAX_CUSTOM_ITEMS, MAX_SHARE_URL_LENGTH } from '../../constants/requestLimits'
import { products } from '../../data/products'
import type { EffectiveProduct } from '../../types/householdCatalog'
import {
  calculateRequestBudget,
  type RequestBudgetContext,
  type RequestDraftData,
} from '../../utils/requestBudget'
import {
  applyHandwritingImportSelections,
  type HandwritingImportApplyResult,
} from './applyImport'
import type { HandwritingImportSelection } from './types'

const effectiveProducts: EffectiveProduct[] = products.map((product) => ({
  ...product,
  source: 'base',
  hidden: false,
  isCustomized: false,
}))
const defaultContext: RequestBudgetContext = {
  baseUrl: 'https://example.test/',
  requestKey: 'test-key',
}

function requestData(
  overrides: Partial<RequestDraftData> = {},
): RequestDraftData {
  return {
    title: 'おつかいリスト',
    draft: Object.fromEntries(
      effectiveProducts.map((product) => [
        product.id,
        { quantity: 0, memo: '' },
      ]),
    ),
    customItems: [],
    effectiveProducts,
    ...overrides,
  }
}

function productSelection(
  productId: string,
  itemId = productId,
): HandwritingImportSelection {
  return { itemId, kind: 'product', productId }
}

function customSelection(
  name: string,
  index = 0,
): HandwritingImportSelection {
  return {
    itemId: `custom-item-${index}`,
    kind: 'custom',
    name,
    customItemId: `custom:import-${index}`,
  }
}

function findUrlBoundaryContext(current: RequestDraftData): RequestBudgetContext {
  for (let padding = 1_900; padding <= 2_200; padding += 1) {
    const context = {
      baseUrl: `https://example.test/${'a'.repeat(padding)}`,
      requestKey: 'test-key',
    }
    const before = calculateRequestBudget(current, context).urlLength
    const withMilk = calculateRequestBudget(
      {
        ...current,
        draft: {
          ...current.draft,
          milk: { quantity: 1, memo: '' },
        },
      },
      context,
    ).urlLength
    if (before <= MAX_SHARE_URL_LENGTH && withMilk > MAX_SHARE_URL_LENGTH) {
      return context
    }
  }
  throw new Error('Could not create URL-limit test boundary')
}

function expectRejectedWithoutMutation(
  result: HandwritingImportApplyResult,
  original: RequestDraftData,
) {
  expect(result.accepted).toBe(false)
  expect(result.value).toBe(original)
  expect(result.changedItemCount).toBe(0)
}

describe('applyHandwritingImportSelections', () => {
  it('sets a quantity-zero product to one', () => {
    const current = requestData()
    const result = applyHandwritingImportSelections(
      current,
      [productSelection('milk')],
      defaultContext,
    )
    expect(result.accepted).toBe(true)
    expect(result.value.draft.milk.quantity).toBe(1)
  })

  it('preserves an existing quantity greater than one', () => {
    const current = requestData({
      draft: {
        ...requestData().draft,
        milk: { quantity: 3, memo: '' },
      },
    })
    const result = applyHandwritingImportSelections(
      current,
      [productSelection('milk')],
      defaultContext,
    )
    expect(result.accepted).toBe(true)
    expect(result.changedItemCount).toBe(0)
    expect(result.value.draft.milk.quantity).toBe(3)
  })

  it('preserves an existing condition when changing quantity', () => {
    const current = requestData({
      draft: {
        ...requestData().draft,
        milk: { quantity: 0, memo: '低脂肪' },
      },
    })
    const result = applyHandwritingImportSelections(
      current,
      [productSelection('milk')],
      defaultContext,
    )
    expect(result.value.draft.milk).toEqual({
      quantity: 1,
      memo: '低脂肪',
    })
  })

  it('does not add the same product more than once from repeated lines', () => {
    const current = requestData()
    const result = applyHandwritingImportSelections(
      current,
      [
        productSelection('milk', 'line-1'),
        productSelection('milk', 'line-2'),
      ],
      defaultContext,
    )
    expect(result.accepted).toBe(true)
    expect(result.changedItemCount).toBe(1)
    expect(result.value.draft.milk.quantity).toBe(1)
  })

  it('adds an unknown handwritten item as quantity one, unit 個, and no condition', () => {
    const current = requestData()
    const result = applyHandwritingImportSelections(
      current,
      [customSelection('  電池  ')],
      defaultContext,
    )
    expect(result.accepted).toBe(true)
    expect(result.value.customItems).toEqual([
      {
        id: 'custom:import-0',
        name: '電池',
        quantity: 1,
        unit: '個',
        memo: '',
      },
    ])
  })

  it('rejects the full transaction at the custom-item limit', () => {
    const fullCustomItems = Array.from(
      { length: MAX_CUSTOM_ITEMS },
      (_, index) => ({
        id: `custom:${index}`,
        name: `商品${index}`,
        quantity: 1,
        unit: '個',
        memo: '',
      }),
    )
    const current = requestData({ customItems: fullCustomItems })
    const result = applyHandwritingImportSelections(
      current,
      [productSelection('milk'), customSelection('追加商品')],
      defaultContext,
    )
    expectRejectedWithoutMutation(result, current)
    expect(result.reason).toBe('custom-item-limit')
    expect(current.draft.milk.quantity).toBe(0)
  })

  it('rejects the full transaction at the URL limit', () => {
    const current = requestData()
    const result = applyHandwritingImportSelections(
      current,
      [productSelection('milk')],
      findUrlBoundaryContext(current),
    )
    expectRejectedWithoutMutation(result, current)
    expect(result.reason).toBe('url-limit')
  })

  it('applies every selected item when the whole transaction succeeds', () => {
    const current = requestData()
    const result = applyHandwritingImportSelections(
      current,
      [
        productSelection('milk'),
        productSelection('eggs'),
        customSelection('電池'),
      ],
      defaultContext,
    )
    expect(result.accepted).toBe(true)
    expect(result.changedItemCount).toBe(3)
    expect(result.value.draft.milk.quantity).toBe(1)
    expect(result.value.draft.eggs.quantity).toBe(1)
    expect(result.value.customItems[0]).toMatchObject({
      name: '電池',
      quantity: 1,
      unit: '個',
    })
  })

  it('does not mutate the original state when a later selection fails', () => {
    const current = requestData()
    const snapshot = structuredClone(current)
    const result = applyHandwritingImportSelections(
      current,
      [
        productSelection('milk'),
        productSelection('missing-product'),
      ],
      defaultContext,
    )
    expectRejectedWithoutMutation(result, current)
    expect(result.reason).toBe('invalid-selection')
    expect(current).toEqual(snapshot)
  })
})
