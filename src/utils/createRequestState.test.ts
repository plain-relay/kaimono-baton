import { describe, expect, it } from 'vitest'
import type { Product } from '../types/product'
import {
  canReuseSharedRequestUrl,
  createRequestContentSnapshot,
  createDraftState,
  createEmptyDraftState,
  createInitialCreateRequestState,
  decreaseQuantity,
  getSavedExpandedProductIds,
  hasAnyCreateRequestInput,
  increaseQuantity,
  resolveSharedRequestUrl,
  toggleExpandedProductId,
} from './createRequestState'

const productList: Product[] = [
  {
    id: 'apple',
    name: 'りんご',
    categoryId: 'fruits',
    defaultQuantity: 2,
    unit: '玉',
    memo: '王林かフジ',
    icon: '🍎',
    sortOrder: 1,
  },
  {
    id: 'milk',
    name: '牛乳',
    categoryId: 'dairy',
    defaultQuantity: 1,
    unit: '本',
    icon: '🥛',
    sortOrder: 2,
  },
]

describe('create request draft state', () => {
  it('restores valid quantities and conditions while filling missing products', () => {
    expect(
      createDraftState(
        {
          apple: { quantity: 3, memo: '安い方でOK' },
        },
        productList,
      ),
    ).toEqual({
      apple: { quantity: 3, memo: '安い方でOK' },
      milk: { quantity: 0, memo: '' },
    })
  })

  it('normalizes invalid draft values without crashing', () => {
    expect(createDraftState(null, productList)).toEqual({
      apple: { quantity: 0, memo: '王林かフジ' },
      milk: { quantity: 0, memo: '' },
    })

    expect(
      createDraftState(
        {
          apple: { quantity: '2', memo: 10 },
          milk: { quantity: -1, memo: [] },
        },
        productList,
      ),
    ).toEqual({
      apple: { quantity: 2, memo: '王林かフジ' },
      milk: { quantity: 0, memo: '' },
    })
  })

  it('creates a completely empty reset draft without master conditions', () => {
    expect(createEmptyDraftState(productList)).toEqual({
      apple: { quantity: 0, memo: '' },
      milk: { quantity: 0, memo: '' },
    })
  })

  it('normalizes an old saved quantity 99 and an overlong condition on load', () => {
    const result = createInitialCreateRequestState(
      {
        milk: { quantity: 99, memo: '長'.repeat(31) },
      },
      productList,
    )

    expect(result.draft.milk).toEqual({ quantity: 20, memo: '長'.repeat(30) })
    expect(result.wasNormalized).toBe(true)
  })

  it('opens only products with non-empty saved conditions', () => {
    const saved = {
      apple: { quantity: 0, memo: '王林かフジ' },
      milk: { quantity: 1, memo: '低脂肪' },
      unknown: { quantity: 1, memo: '対象外' },
    }

    expect([...getSavedExpandedProductIds(saved, productList)]).toEqual(['apple', 'milk'])
    expect([...createInitialCreateRequestState(saved, productList).expandedProductIds]).toEqual([
      'apple',
      'milk',
    ])
    expect([
      ...getSavedExpandedProductIds({ apple: { quantity: 0, memo: '   ' } }, productList),
    ]).toEqual([])
  })
})

describe('create request quantity changes', () => {
  it('always increases one at a time regardless of master default quantity', () => {
    const quantities = [0]
    for (let index = 0; index < 4; index += 1) {
      quantities.push(increaseQuantity(quantities[quantities.length - 1]))
    }

    expect(quantities).toEqual([0, 1, 2, 3, 4])
  })

  it('decreases one at a time without going below zero', () => {
    const quantities = [4]
    for (let index = 0; index < 5; index += 1) {
      quantities.push(decreaseQuantity(quantities[quantities.length - 1]))
    }

    expect(quantities).toEqual([4, 3, 2, 1, 0, 0])
  })

  it('stops increasing at the shared quantity limit', () => {
    expect(increaseQuantity(19)).toBe(20)
    expect(increaseQuantity(20)).toBe(20)
    expect(increaseQuantity(99)).toBe(20)
  })
})

describe('create request reset confirmation', () => {
  const createInputState = () => ({
    title: '今日のおつかい',
    defaultTitle: '今日のおつかい',
    draft: createDraftState(undefined, productList),
    productList,
    customItemCount: 0,
    isCustomFormOpen: false,
    customName: '',
    customQuantity: 1,
    customUnit: '個',
    customMemo: '',
    sharedUrl: '',
    lastSharedUrl: '',
    mode: 'edit',
    copyMessage: '',
  })

  it('does not require confirmation for the untouched initial state', () => {
    expect(hasAnyCreateRequestInput(createInputState())).toBe(false)
  })

  it('requires confirmation when only a quantity is selected', () => {
    const state = createInputState()
    state.draft = {
      ...state.draft,
      milk: { ...state.draft.milk, quantity: 1 },
    }

    expect(hasAnyCreateRequestInput(state)).toBe(true)
  })

  it('requires confirmation for a user condition even when quantity is zero', () => {
    const state = createInputState()
    state.draft = {
      ...state.draft,
      milk: { quantity: 0, memo: '低脂肪' },
    }

    expect(hasAnyCreateRequestInput(state)).toBe(true)
  })

  it('requires confirmation when a master condition changes to another value', () => {
    const state = createInputState()
    state.draft = {
      ...state.draft,
      apple: { quantity: 0, memo: 'ふじのみ' },
    }

    expect(hasAnyCreateRequestInput(state)).toBe(true)
  })

  it('requires confirmation when only the title changes', () => {
    expect(
      hasAnyCreateRequestInput({ ...createInputState(), title: '週末のおつかい' }),
    ).toBe(true)
  })

  it.each([
    ['商品名', { customName: '洗濯ネット' }],
    ['条件', { customMemo: '大きめ' }],
    ['数量', { customQuantity: 2 }],
    ['単位', { customUnit: '袋' }],
  ])('requires confirmation for an in-progress custom item %s change', (_, change) => {
    expect(hasAnyCreateRequestInput({ ...createInputState(), ...change })).toBe(true)
  })

  it('requires confirmation when only the custom item form is open', () => {
    expect(
      hasAnyCreateRequestInput({ ...createInputState(), isCustomFormOpen: true }),
    ).toBe(true)
  })

  it('requires confirmation for an added custom item', () => {
    expect(hasAnyCreateRequestInput({ ...createInputState(), customItemCount: 1 })).toBe(true)
  })

  it('requires confirmation when a shared URL exists', () => {
    expect(
      hasAnyCreateRequestInput({ ...createInputState(), sharedUrl: 'https://example.com/list' }),
    ).toBe(true)
  })

  it('requires confirmation when only the last saved shared URL exists', () => {
    expect(
      hasAnyCreateRequestInput({
        ...createInputState(),
        lastSharedUrl: 'https://example.com/saved-list',
      }),
    ).toBe(true)
  })

  it('requires confirmation in review mode', () => {
    expect(hasAnyCreateRequestInput({ ...createInputState(), mode: 'review' })).toBe(true)
  })

  it('requires confirmation when a copy result message exists', () => {
    expect(
      hasAnyCreateRequestInput({ ...createInputState(), copyMessage: 'コピーしました' }),
    ).toBe(true)
  })

  it('ignores untouched product master conditions', () => {
    const state = createInputState()
    expect(state.draft.apple.memo).toBe('王林かフジ')
    expect(hasAnyCreateRequestInput(state)).toBe(false)
  })

  it('treats a completely empty reset draft as having no input', () => {
    expect(
      hasAnyCreateRequestInput({
        ...createInputState(),
        draft: createEmptyDraftState(productList),
      }),
    ).toBe(false)
  })
})

describe('shared request URL reuse', () => {
  const createSnapshot = (
    overrides: Partial<Parameters<typeof createRequestContentSnapshot>[0]> = {},
  ) =>
    createRequestContentSnapshot({
      title: '今日のおつかい',
      draft: {
        apple: { quantity: 2, memo: '王林かフジ' },
        milk: { quantity: 0, memo: '' },
      },
      productList,
      customItems: [
        {
          id: 'custom-default',
          name: '洗濯ネット',
          quantity: 1,
          unit: '個',
          memo: '大きめ',
        },
      ],
      ...overrides,
    })

  it('creates the same snapshot for the same request content', () => {
    expect(createSnapshot()).toBe(createSnapshot())
  })

  it('changes when a custom item identity changes even if visible content is unchanged', () => {
    const firstCustomItems = [
      { id: 'custom-random-a', name: '洗濯ネット', quantity: 1, unit: '個', memo: '大きめ' },
    ]
    const secondCustomItems = [
      { id: 'custom-random-b', name: '洗濯ネット', quantity: 1, unit: '個', memo: '大きめ' },
    ]

    expect(createSnapshot({ customItems: firstCustomItems })).not.toBe(
      createSnapshot({ customItems: secondCustomItems }),
    )
  })

  it.each([
    ['title', { title: '週末のおつかい' }],
    [
      'quantity',
      {
        draft: {
          apple: { quantity: 3, memo: '王林かフジ' },
          milk: { quantity: 0, memo: '' },
        },
      },
    ],
    [
      'condition',
      {
        draft: {
          apple: { quantity: 2, memo: 'ふじのみ' },
          milk: { quantity: 0, memo: '' },
        },
      },
    ],
    [
      'custom item',
      {
        customItems: [
          {
            id: 'custom-default',
            name: '洗濯ネット',
            quantity: 2,
            unit: '個',
            memo: '大きめ',
          },
        ],
      },
    ],
  ])('changes the snapshot after a %s change', (_, overrides) => {
    expect(createSnapshot(overrides)).not.toBe(createSnapshot())
  })

  it.each([
    ['name', { name: '家庭のりんご' }],
    ['unit', { unit: '袋' }],
    ['category', { categoryId: 'other' }],
    ['sort order', { sortOrder: 99 }],
  ])('changes the snapshot after selected product %s changes', (_, change) => {
    const changedProducts = productList.map((product) =>
      product.id === 'apple' ? { ...product, ...change } : product,
    )
    expect(createSnapshot({ productList: changedProducts })).not.toBe(
      createSnapshot(),
    )
  })

  it('reuses a URL only when both the URL and matching snapshot exist', () => {
    const snapshot = createSnapshot()

    expect(canReuseSharedRequestUrl(snapshot, snapshot, 'https://example.com/request')).toBe(true)
    expect(canReuseSharedRequestUrl(snapshot, `${snapshot}-changed`, 'https://example.com/request')).toBe(false)
    expect(canReuseSharedRequestUrl(snapshot, snapshot, '')).toBe(false)
  })

  it('keeps the same URL after cancellation while the request content is unchanged', () => {
    const snapshot = createSnapshot()
    let generatedCount = 0
    const resolution = resolveSharedRequestUrl(
      snapshot,
      snapshot,
      'https://example.com/original-request',
      () => {
        generatedCount += 1
        return 'https://example.com/new-request'
      },
    )

    expect(resolution).toEqual({
      url: 'https://example.com/original-request',
      snapshot,
      reused: true,
    })
    expect(generatedCount).toBe(0)
  })

  it('generates a new URL after the request content changes', () => {
    const originalSnapshot = createSnapshot()
    const changedSnapshot = createSnapshot({ title: '週末のおつかい' })

    expect(
      resolveSharedRequestUrl(
        changedSnapshot,
        originalSnapshot,
        'https://example.com/original-request',
        () => 'https://example.com/new-request',
      ),
    ).toEqual({
      url: 'https://example.com/new-request',
      snapshot: changedSnapshot,
      reused: false,
    })
  })
})

describe('create request condition expansion', () => {
  it('adds and removes one product without mutating the previous set', () => {
    const original = new Set(['apple'])
    const withMilk = toggleExpandedProductId(original, 'milk')
    const withoutApple = toggleExpandedProductId(withMilk, 'apple')

    expect([...original]).toEqual(['apple'])
    expect([...withMilk]).toEqual(['apple', 'milk'])
    expect([...withoutApple]).toEqual(['milk'])
    expect(withMilk).not.toBe(original)
    expect(withoutApple).not.toBe(withMilk)
  })
})
