import { describe, expect, it } from 'vitest'
import { categories } from '../data/categories'
import { products } from '../data/products'
import {
  addHouseholdProduct,
  buildAllEffectiveProductCatalog,
  buildEffectiveProductCatalog,
  createEmptyHouseholdCatalog,
  normalizeHouseholdCatalog,
  resetBaseProduct,
  setCatalogProductHidden,
  updateBaseProduct,
  updateHouseholdProduct,
} from './householdCatalog'

const NOW = '2026-07-26T00:00:00.000Z'
const LATER = '2026-07-26T01:00:00.000Z'
const HOUSEHOLD_ID = 'household:123e4567-e89b-42d3-a456-426614174000'

describe('household catalog domain', () => {
  it('applies base name, unit, and category changes as minimal overrides', () => {
    const changed = updateBaseProduct(
      createEmptyHouseholdCatalog(NOW),
      'milk',
      {
        name: 'いつもの牛乳',
        unit: 'パック',
        categoryId: 'drinks',
        hidden: false,
      },
      LATER,
    )

    expect(changed.revision).toBe(1)
    expect(changed.overrides.milk).toEqual({
      name: 'いつもの牛乳',
      unit: 'パック',
      categoryId: 'drinks',
    })
    expect(
      buildEffectiveProductCatalog(products, changed).find(
        (product) => product.id === 'milk',
      ),
    ).toMatchObject({
      name: 'いつもの牛乳',
      unit: 'パック',
      categoryId: 'drinks',
    })
  })

  it('removes fields equal to the base value and drops an empty override', () => {
    const changed = updateBaseProduct(
      createEmptyHouseholdCatalog(NOW),
      'milk',
      {
        name: 'いつもの牛乳',
        unit: '本',
        categoryId: 'eggs-dairy',
        hidden: false,
      },
      LATER,
    )
    const restored = updateBaseProduct(
      changed,
      'milk',
      {
        name: '牛乳',
        unit: '本',
        categoryId: 'eggs-dairy',
        hidden: false,
      },
      '2026-07-26T02:00:00.000Z',
    )

    expect(restored.overrides).toEqual({})
    expect(restored.revision).toBe(2)
  })

  it('hides, restores, and resets a base product without changing its ID', () => {
    const hidden = setCatalogProductHidden(
      createEmptyHouseholdCatalog(NOW),
      'cabbage',
      true,
      LATER,
    )
    expect(buildEffectiveProductCatalog(products, hidden)).not.toContainEqual(
      expect.objectContaining({ id: 'cabbage' }),
    )
    expect(
      buildAllEffectiveProductCatalog(products, hidden).find(
        (product) => product.id === 'cabbage',
      ),
    ).toMatchObject({ id: 'cabbage', hidden: true })

    const visible = setCatalogProductHidden(
      hidden,
      'cabbage',
      false,
      '2026-07-26T02:00:00.000Z',
    )
    expect(visible.overrides).toEqual({})
    expect(buildEffectiveProductCatalog(products, visible)).toContainEqual(
      expect.objectContaining({ id: 'cabbage', hidden: false }),
    )

    const customized = updateBaseProduct(
      visible,
      'cabbage',
      {
        name: '春キャベツ',
        unit: '玉',
        categoryId: 'vegetables',
        hidden: true,
      },
      '2026-07-26T03:00:00.000Z',
    )
    expect(
      resetBaseProduct(
        customized,
        'cabbage',
        '2026-07-26T04:00:00.000Z',
      ).overrides,
    ).toEqual({})
  })

  it('adds and edits a household product while preserving its internal ID', () => {
    const added = addHouseholdProduct(
      createEmptyHouseholdCatalog(NOW),
      { name: '麦茶パック', unit: '', categoryId: 'drinks' },
      LATER,
      products,
      categories,
      HOUSEHOLD_ID,
    )
    expect(added.addedProducts[0]).toMatchObject({
      id: HOUSEHOLD_ID,
      name: '麦茶パック',
      unit: '個',
      categoryId: 'drinks',
      hidden: false,
    })

    const edited = updateHouseholdProduct(
      added,
      HOUSEHOLD_ID,
      { name: '水出し麦茶', unit: '袋', categoryId: 'seasonings-dry' },
      '2026-07-26T02:00:00.000Z',
    )
    expect(edited.addedProducts[0]).toMatchObject({
      id: HOUSEHOLD_ID,
      name: '水出し麦茶',
      unit: '袋',
      categoryId: 'seasonings-dry',
    })
  })

  it('does not advance revision or timestamps when a household edit changes no content', () => {
    const added = addHouseholdProduct(
      createEmptyHouseholdCatalog(NOW),
      {
        name: '麦茶パック',
        unit: '袋',
        categoryId: 'drinks',
        hidden: false,
      },
      LATER,
      products,
      categories,
      HOUSEHOLD_ID,
    )

    const unchanged = updateHouseholdProduct(
      added,
      HOUSEHOLD_ID,
      {
        name: '麦茶パック',
        unit: '袋',
        categoryId: 'drinks',
        hidden: false,
      },
      '2026-07-26T02:00:00.000Z',
    )

    expect(unchanged).toEqual(added)
    expect(unchanged.revision).toBe(added.revision)
    expect(unchanged.updatedAt).toBe(added.updatedAt)
    expect(unchanged.addedProducts[0].updatedAt).toBe(
      added.addedProducts[0].updatedAt,
    )
  })

  it('rejects duplicate IDs, invalid categories, overlong fields, and empty names', () => {
    const empty = createEmptyHouseholdCatalog(NOW)
    expect(() =>
      addHouseholdProduct(
        empty,
        { name: '重複', unit: '個', categoryId: 'other' },
        LATER,
        products,
        categories,
        'milk',
      ),
    ).toThrow()
    expect(() =>
      addHouseholdProduct(
        empty,
        { name: '商品', unit: '個', categoryId: 'unknown' },
        LATER,
        products,
        categories,
        HOUSEHOLD_ID,
      ),
    ).toThrow()
    expect(() =>
      addHouseholdProduct(
        empty,
        { name: 'あ'.repeat(31), unit: '個', categoryId: 'other' },
        LATER,
        products,
        categories,
        HOUSEHOLD_ID,
      ),
    ).toThrow()
    expect(() =>
      addHouseholdProduct(
        empty,
        { name: ' ', unit: '個', categoryId: 'other' },
        LATER,
        products,
        categories,
        HOUSEHOLD_ID,
      ),
    ).toThrow()
  })

  it('rejects dangerous keys and duplicate added IDs during normalization', () => {
    const dangerous = JSON.parse(
      `{"schemaVersion":1,"revision":0,"updatedAt":"${NOW}","overrides":{"__proto__":{"hidden":true}},"addedProducts":[]}`,
    ) as unknown
    expect(normalizeHouseholdCatalog(dangerous)).toBeNull()

    const product = {
      id: HOUSEHOLD_ID,
      name: '商品',
      unit: '個',
      categoryId: 'other',
      hidden: false,
      createdAt: NOW,
      updatedAt: NOW,
    }
    expect(
      normalizeHouseholdCatalog({
        ...createEmptyHouseholdCatalog(NOW),
        addedProducts: [product, { ...product }],
      }),
    ).toBeNull()
  })

  it('keeps base order and appends moved and added products stably', () => {
    let catalog = updateBaseProduct(
      createEmptyHouseholdCatalog(NOW),
      'milk',
      {
        name: '牛乳',
        unit: '本',
        categoryId: 'drinks',
        hidden: false,
      },
      LATER,
    )
    catalog = addHouseholdProduct(
      catalog,
      { name: '家庭の飲み物', unit: '本', categoryId: 'drinks' },
      '2026-07-26T02:00:00.000Z',
      products,
      categories,
      HOUSEHOLD_ID,
    )

    const first = buildAllEffectiveProductCatalog(products, catalog)
    const second = buildAllEffectiveProductCatalog(
      products,
      JSON.parse(JSON.stringify(catalog)) as typeof catalog,
    )
    const drinkIds = first
      .filter((product) => product.categoryId === 'drinks')
      .map((product) => product.id)
    expect(drinkIds.slice(-2)).toEqual(['milk', HOUSEHOLD_ID])
    expect(second).toEqual(first)
    expect(first.find((product) => product.id === 'water')?.sortOrder).toBe(1101)
  })
})
