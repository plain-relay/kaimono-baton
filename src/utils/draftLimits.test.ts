import { describe, expect, it } from 'vitest'
import {
  MAX_CUSTOM_ITEMS,
  MAX_SHARE_URL_LENGTH,
  MAX_TOTAL_CONDITION_CHARS,
} from '../constants/requestLimits'
import { products } from '../data/products'
import type { CreateDraftState } from '../types/shopping'
import {
  applyConditionChange,
  applyCustomItemAdd,
  applyCustomItemDelete,
  applyCustomItemUpdate,
  applyCustomQuantityChange,
  applyQuantityChange,
  applyTitleChange,
  normalizeCustomQuantity,
  normalizeRegularQuantity,
  normalizeRequestDraftData,
} from './draftLimits'
import {
  calculateRequestBudget,
  countTotalConditionCharacters,
  validateDraftLimits,
  type RequestBudgetContext,
  type RequestDraftData,
} from './requestBudget'
import { countUserCharacters } from './textLength'

const standardContext: RequestBudgetContext = {
  baseUrl: 'https://plain-relay.github.io/kaimono-baton',
  requestKey: 'm1234567-abcd',
}

function createDraft(): CreateDraftState {
  return Object.fromEntries(
    products.map((product) => [product.id, { quantity: 0, memo: '' }]),
  )
}

function createData(): RequestDraftData {
  return { title: '今日のおつかい', draft: createDraft(), customItems: [] }
}

function fillRegularConditions(
  data: RequestDraftData,
  totalCharacters: number,
  startIndex = 0,
): RequestDraftData {
  const draft = { ...data.draft }
  let remaining = totalCharacters
  for (let index = startIndex; remaining > 0; index += 1) {
    const product = products[index]
    const length = Math.min(30, remaining)
    draft[product.id] = { quantity: 1, memo: '条'.repeat(length) }
    remaining -= length
  }
  return { ...data, draft }
}

function contextWithUrlLength(
  data: RequestDraftData,
  targetLength: number,
): RequestBudgetContext {
  const initial = calculateRequestBudget(data, standardContext)
  const paddingLength = targetLength - initial.urlLength
  if (paddingLength < 0) {
    throw new Error('The test base URL is already longer than its target.')
  }
  return {
    ...standardContext,
    baseUrl: `${standardContext.baseUrl}${'x'.repeat(paddingLength)}`,
  }
}

describe('quantity normalization', () => {
  it('normalizes regular quantities from every unsafe input shape into 0 through 20', () => {
    expect(normalizeRegularQuantity(20)).toBe(20)
    expect(normalizeRegularQuantity(99)).toBe(20)
    expect(normalizeRegularQuantity('19')).toBe(19)
    expect(normalizeRegularQuantity(2.9)).toBe(2)
    expect(normalizeRegularQuantity(-3)).toBe(0)
    expect(normalizeRegularQuantity('NaN')).toBe(0)
    expect(normalizeRegularQuantity(Number.NaN)).toBe(0)
    expect(normalizeRegularQuantity(Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('normalizes custom quantities into 1 through 20', () => {
    expect(normalizeCustomQuantity(0)).toBe(1)
    expect(normalizeCustomQuantity(-1)).toBe(1)
    expect(normalizeCustomQuantity('20')).toBe(20)
    expect(normalizeCustomQuantity(99)).toBe(20)
    expect(normalizeCustomQuantity(3.8)).toBe(3)
    expect(normalizeCustomQuantity('Infinity')).toBe(1)
  })

  it('allows 20, rejects a 21st increase, and re-allows changes after 19', () => {
    const data = createData()
    const atTwenty = applyQuantityChange(data, 'cabbage', 20, standardContext)
    expect(atTwenty.accepted).toBe(true)
    expect(atTwenty.value.draft.cabbage.quantity).toBe(20)

    const over = applyQuantityChange(atTwenty.value, 'cabbage', 21, standardContext)
    expect(over.accepted).toBe(false)
    expect(over.reason).toBe('quantity-limit')
    expect(over.value.draft.cabbage.quantity).toBe(20)

    const atNineteen = applyQuantityChange(atTwenty.value, 'cabbage', 19, standardContext)
    expect(atNineteen.accepted).toBe(true)
    expect(
      applyQuantityChange(atNineteen.value, 'cabbage', 20, standardContext).accepted,
    ).toBe(true)
  })

  it('applies the same 1 through 20 controls to a custom item', () => {
    const data: RequestDraftData = {
      ...createData(),
      customItems: [
        { id: 'custom-1', name: '電池', quantity: 1, unit: '個', memo: '' },
      ],
    }
    expect(applyCustomQuantityChange(data, 0, 20, standardContext).value.customItems[0].quantity).toBe(20)
    const over = applyCustomQuantityChange(data, 0, 99, standardContext)
    expect(over.value.customItems[0].quantity).toBe(20)
    expect(over.reason).toBe('quantity-limit')
  })
})

describe('grapheme-aware draft text limits', () => {
  it('keeps a 30-character title and truncates the 31st character', () => {
    const data = createData()
    const result = applyTitleChange(data, '😀'.repeat(31), standardContext)
    expect(countUserCharacters(result.value.title)).toBe(30)
    expect(result.reason).toBe('title-limit')
  })

  it('keeps a 30-character condition and truncates pasted overflow at a grapheme boundary', () => {
    const data = createData()
    data.draft.cabbage = { quantity: 1, memo: '' }
    const result = applyConditionChange(
      data,
      { kind: 'product', productId: 'cabbage' },
      'e\u0301'.repeat(31),
      standardContext,
    )
    expect(countUserCharacters(result.value.draft.cabbage.memo)).toBe(30)
    expect(result.value.draft.cabbage.memo).toBe('e\u0301'.repeat(30))
    expect(result.reason).toBe('item-condition-limit')
  })

  it('accepts only the remaining 8 characters of a longer paste at the total limit', () => {
    let data = fillRegularConditions(createData(), 992)
    const target = products[34].id
    data = {
      ...data,
      draft: { ...data.draft, [target]: { quantity: 1, memo: '' } },
    }
    const result = applyConditionChange(
      data,
      { kind: 'product', productId: target },
      'あ'.repeat(20),
      standardContext,
    )
    expect(result.value.draft[target].memo).toBe('あ'.repeat(8))
    expect(countTotalConditionCharacters(result.value)).toBe(1000)
    expect(result.reason).toBe('total-condition-limit')
  })

  it('does not retain the 1,001st condition character', () => {
    const data = fillRegularConditions(createData(), 1000)
    const target = products[33].id
    const result = applyConditionChange(
      data,
      { kind: 'product', productId: target },
      `${data.draft[target].memo}追`,
      standardContext,
    )
    expect(result.accepted).toBe(false)
    expect(result.reason).toBe('total-condition-limit')
    expect(countTotalConditionCharacters(result.value)).toBe(1000)
  })

  it('returns total-condition budget after deselection and after deleting a condition', () => {
    const data = fillRegularConditions(createData(), 1000)
    const target = products[0].id
    const deselected = applyQuantityChange(data, target, 0, standardContext)
    expect(deselected.accepted).toBe(true)
    expect(countTotalConditionCharacters(deselected.value)).toBe(970)

    const cleared = applyConditionChange(
      data,
      { kind: 'product', productId: target },
      '',
      standardContext,
    )
    expect(cleared.accepted).toBe(true)
    expect(countTotalConditionCharacters(cleared.value)).toBe(970)
  })

  it('does not count an unselected regular product condition', () => {
    const data = createData()
    data.draft.cabbage = { quantity: 0, memo: '選択前の条件' }
    expect(countTotalConditionCharacters(data)).toBe(0)
  })
})

describe('custom item limits', () => {
  it('allows at most 10 custom items and preserves the old state on the 11th', () => {
    let data = createData()
    for (let index = 0; index < MAX_CUSTOM_ITEMS; index += 1) {
      const result = applyCustomItemAdd(
        data,
        {
          id: `custom-${index}`,
          name: `商品${index}`,
          quantity: 1,
          unit: '個',
          memo: '',
        },
        standardContext,
      )
      expect(result.accepted).toBe(true)
      data = result.value
    }
    const rejected = applyCustomItemAdd(
      data,
      { id: 'custom-10', name: '11件目', quantity: 1, unit: '個', memo: '' },
      standardContext,
    )
    expect(rejected.accepted).toBe(false)
    expect(rejected.reason).toBe('custom-item-limit')
    expect(rejected.value.customItems).toHaveLength(10)
  })

  it('normalizes name, unit, condition, quantity, and old total condition values', () => {
    const data = fillRegularConditions(createData(), MAX_TOTAL_CONDITION_CHARS)
    const normalized = normalizeRequestDraftData({
      ...data,
      title: '題'.repeat(40),
      customItems: [
        {
          id: 'custom-1',
          name: '名'.repeat(40),
          quantity: 99,
          unit: '単'.repeat(20),
          memo: '追'.repeat(40),
        },
      ],
    })
    expect(normalized.normalized).toBe(true)
    expect(countUserCharacters(normalized.value.title)).toBe(30)
    expect(countUserCharacters(normalized.value.customItems[0].name)).toBe(30)
    expect(countUserCharacters(normalized.value.customItems[0].unit)).toBe(10)
    expect(normalized.value.customItems[0].quantity).toBe(20)
    expect(normalized.value.customItems[0].memo).toBe('')
    expect(countTotalConditionCharacters(normalized.value)).toBe(1000)
  })

  it('returns condition budget after deleting a custom item', () => {
    const data: RequestDraftData = {
      ...createData(),
      customItems: [
        { id: 'custom-1', name: '電池', quantity: 1, unit: '個', memo: '単三' },
      ],
    }
    const deleted = applyCustomItemDelete(data, 0)
    expect(deleted.accepted).toBe(true)
    expect(countTotalConditionCharacters(deleted.value)).toBe(0)
  })

  it('applies the same limits when editing a custom item', () => {
    const data: RequestDraftData = {
      ...createData(),
      customItems: [
        { id: 'custom-1', name: '電池', quantity: 1, unit: '個', memo: '' },
      ],
    }
    const updated = applyCustomItemUpdate(
      data,
      0,
      {
        id: 'custom-1',
        name: '充電池',
        quantity: 20,
        unit: 'パック',
        memo: '単三を優先',
      },
      standardContext,
    )
    expect(updated.accepted).toBe(true)
    expect(updated.value.customItems[0]).toEqual({
      id: 'custom-1',
      name: '充電池',
      quantity: 20,
      unit: 'パック',
      memo: '単三を優先',
    })
  })
})

describe('actual compact URL budget', () => {
  it('accepts a URL of exactly 2,200 characters', () => {
    const data = createData()
    data.draft.cabbage = { quantity: 1, memo: '' }
    const context = contextWithUrlLength(data, MAX_SHARE_URL_LENGTH)
    expect(calculateRequestBudget(data, context).urlLength).toBe(2200)
    expect(validateDraftLimits(data, context, true)).toMatchObject({ valid: true })
  })

  it('rejects a title change that would make an exact 2,201-character URL and keeps old state', () => {
    const current = createData()
    current.draft.cabbage = { quantity: 1, memo: '' }
    current.title = '依頼'
    const proposedTitle = '依頼X'
    const candidate = { ...current, title: proposedTitle }
    const context = contextWithUrlLength(candidate, 2201)
    expect(calculateRequestBudget(current, context).urlLength).toBeLessThanOrEqual(2200)
    expect(
      calculateRequestBudget(candidate, context).urlLength,
    ).toBe(2201)
    const result = applyTitleChange(current, proposedTitle, context)
    expect(result.accepted).toBe(false)
    expect(result.reason).toBe('url-limit')
    expect(result.value).toEqual(current)
  })

  it('rejects a product selection that crosses the URL budget', () => {
    const data = createData()
    const candidate = {
      ...data,
      draft: { ...data.draft, cabbage: { quantity: 1, memo: '半玉' } },
    }
    const context = contextWithUrlLength(candidate, 2201)
    expect(calculateRequestBudget(data, context).urlLength).toBeLessThanOrEqual(2200)
    expect(calculateRequestBudget(candidate, context).urlLength).toBe(2201)
    const result = applyQuantityChange(
      { ...data, draft: { ...data.draft, cabbage: { quantity: 0, memo: '半玉' } } },
      'cabbage',
      1,
      context,
    )
    expect(result.accepted).toBe(false)
    expect(result.reason).toBe('url-limit')
    expect(result.value.draft.cabbage.quantity).toBe(0)
  })

  it('uses the same URL budget when custom items are included', () => {
    const data = createData()
    const item = {
      id: 'custom-1',
      name: '圧縮しにくいCustom-123!😀',
      quantity: 20,
      unit: 'パック',
      memo: '条件ABC-123!😀',
    }
    const candidate = { ...data, customItems: [item] }
    const context = contextWithUrlLength(candidate, 2201)
    const result = applyCustomItemAdd(data, item, context)
    expect(result.accepted).toBe(false)
    expect(result.reason).toBe('url-limit')
    expect(result.value.customItems).toHaveLength(0)
  })
})
