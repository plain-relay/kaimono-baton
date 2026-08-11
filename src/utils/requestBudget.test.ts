import { describe, expect, it } from 'vitest'
import { products } from '../data/products'
import type { CreateDraftState } from '../types/shopping'
import {
  isShareUrlWarning,
  isTotalConditionWarning,
  validateDraftLimits,
  type DraftLimitReason,
  type RequestDraftData,
} from './requestBudget'

const context = {
  baseUrl: 'https://plain-relay.github.io/kaimono-baton/',
  requestKey: 'phase4-contract',
}

function createData(): RequestDraftData {
  return {
    title: 'おつかいリスト',
    draft: {},
    customItems: [],
  }
}

describe('request limit warning thresholds', () => {
  it('starts the total-condition warning at exactly 800 characters', () => {
    expect(isTotalConditionWarning(799)).toBe(false)
    expect(isTotalConditionWarning(800)).toBe(true)
    expect(isTotalConditionWarning(1_000)).toBe(true)
  })

  it('starts the final share URL warning at exactly 1,760 characters', () => {
    expect(isShareUrlWarning(1_759)).toBe(false)
    expect(isShareUrlWarning(1_760)).toBe(true)
    expect(isShareUrlWarning(2_200)).toBe(true)
  })
})

describe('share-time draft validation', () => {
  it.each<{
    label: string
    expected: DraftLimitReason
    create: () => RequestDraftData
  }>([
    {
      label: 'overlong title',
      expected: 'title-limit',
      create: () => ({ ...createData(), title: '題'.repeat(31) }),
    },
    {
      label: 'invalid regular quantity',
      expected: 'quantity-limit',
      create: () => ({
        ...createData(),
        draft: { cabbage: { quantity: 21, memo: '' } },
      }),
    },
    {
      label: 'fractional regular quantity',
      expected: 'quantity-limit',
      create: () => ({
        ...createData(),
        draft: { cabbage: { quantity: 1.5, memo: '' } },
      }),
    },
    {
      label: 'overlong regular condition',
      expected: 'item-condition-limit',
      create: () => ({
        ...createData(),
        draft: {
          cabbage: { quantity: 1, memo: '条'.repeat(31) },
        },
      }),
    },
    {
      label: 'too many custom items',
      expected: 'custom-item-limit',
      create: () => ({
        ...createData(),
        customItems: Array.from({ length: 11 }, (_, index) => ({
          id: `custom-${index}`,
          name: `商品${index}`,
          quantity: 1,
          unit: '個',
          memo: '',
        })),
      }),
    },
    {
      label: 'invalid custom quantity',
      expected: 'quantity-limit',
      create: () => ({
        ...createData(),
        customItems: [
          {
            id: 'custom-1',
            name: '商品',
            quantity: 0,
            unit: '個',
            memo: '',
          },
        ],
      }),
    },
    {
      label: 'empty custom name',
      expected: 'custom-name-limit',
      create: () => ({
        ...createData(),
        customItems: [
          {
            id: 'custom-1',
            name: ' ',
            quantity: 1,
            unit: '個',
            memo: '',
          },
        ],
      }),
    },
    {
      label: 'overlong custom unit',
      expected: 'custom-unit-limit',
      create: () => ({
        ...createData(),
        customItems: [
          {
            id: 'custom-1',
            name: '商品',
            quantity: 1,
            unit: '単'.repeat(11),
            memo: '',
          },
        ],
      }),
    },
    {
      label: 'overlong custom condition',
      expected: 'item-condition-limit',
      create: () => ({
        ...createData(),
        customItems: [
          {
            id: 'custom-1',
            name: '商品',
            quantity: 1,
            unit: '個',
            memo: '条'.repeat(31),
          },
        ],
      }),
    },
    {
      label: 'condition total above 1,000',
      expected: 'total-condition-limit',
      create: () => {
        let remaining = 1_001
        const draft: CreateDraftState = {}
        for (const product of products) {
          if (remaining === 0) {
            break
          }
          const length = Math.min(30, remaining)
          draft[product.id] = {
            quantity: 1,
            memo: '条'.repeat(length),
          }
          remaining -= length
        }
        return { ...createData(), draft }
      },
    },
  ])('rejects $label before creating a share URL', ({ expected, create }) => {
    expect(validateDraftLimits(create(), context, true)).toEqual({
      valid: false,
      reason: expected,
    })
  })

  it('rejects an empty request only when sharing requires selected items', () => {
    expect(validateDraftLimits(createData(), context, true)).toEqual({
      valid: false,
      reason: 'no-items',
    })
    expect(validateDraftLimits(createData(), context, false).valid).toBe(true)
  })

  it('maps URL overflow and payload generation failures to the URL limit', () => {
    const data = {
      ...createData(),
      draft: { cabbage: { quantity: 1, memo: '' } },
    }
    expect(
      validateDraftLimits(
        data,
        {
          ...context,
          baseUrl: `https://example.test/${'x'.repeat(2_200)}`,
        },
        true,
      ),
    ).toMatchObject({ valid: false, reason: 'url-limit' })
    expect(
      validateDraftLimits(
        data,
        { ...context, requestKey: '' },
        true,
      ),
    ).toEqual({ valid: false, reason: 'url-limit' })
  })
})
