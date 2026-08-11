import { describe, expect, it } from 'vitest'
import type { EffectiveProduct } from '../../types/householdCatalog'
import { buildImportProductCandidates } from './productCandidates'

function product(
  overrides: Partial<EffectiveProduct> = {},
): EffectiveProduct {
  return {
    id: 'eggs',
    name: '卵',
    categoryId: 'fresh',
    defaultQuantity: 0,
    unit: '個',
    icon: '🥚',
    sortOrder: 1,
    source: 'base',
    hidden: false,
    isCustomized: false,
    ...overrides,
  }
}

describe('buildImportProductCandidates', () => {
  it('uses the current household-renamed product name as canonical', () => {
    expect(
      buildImportProductCandidates([
        product({ name: '平飼い卵', isCustomized: true }),
      ])[0],
    ).toMatchObject({ id: 'eggs', name: '平飼い卵' })
  })

  it('includes a visible household-added product', () => {
    expect(
      buildImportProductCandidates([
        product({
          id: 'household:1',
          name: '猫砂',
          source: 'household',
        }),
      ]),
    ).toEqual([
      {
        id: 'household:1',
        name: '猫砂',
        aliases: [],
      },
    ])
  })

  it('adds registered aliases without sending unrelated product fields', () => {
    expect(buildImportProductCandidates([product()])).toEqual([
      {
        id: 'eggs',
        name: '卵',
        aliases: ['たまご', '玉子'],
      },
    ])
  })

  it('excludes hidden products', () => {
    expect(
      buildImportProductCandidates([product({ hidden: true })]),
    ).toEqual([])
  })

  it('does not send the same product ID twice', () => {
    expect(
      buildImportProductCandidates([
        product(),
        product({ name: '重複名' }),
      ]),
    ).toHaveLength(1)
  })

  it('normalizes and deduplicates aliases', () => {
    expect(
      buildImportProductCandidates(
        [product()],
        { eggs: ['  たまご ', 'たまご', '卵'] },
      )[0].aliases,
    ).toEqual(['たまご'])
  })
})
