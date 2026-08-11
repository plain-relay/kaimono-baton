import { describe, expect, it } from 'vitest'
import type { CatalogBackupReceipt } from '../types/householdCatalog'
import {
  createCatalogFingerprint,
  getCatalogBackupStatus,
} from './catalogFingerprint'
import {
  addHouseholdProduct,
  createEmptyHouseholdCatalog,
  updateBaseProduct,
} from './householdCatalog'
import { products } from '../data/products'
import { categories } from '../data/categories'

const NOW = '2026-07-26T00:00:00.000Z'
const HOUSEHOLD_ID = 'household:123e4567-e89b-42d3-a456-426614174000'

describe('catalog fingerprint and backup status', () => {
  it('is stable across timestamps, revisions, override key order, and added array order', () => {
    const first = {
      schemaVersion: 1 as const,
      revision: 1,
      updatedAt: NOW,
      overrides: {
        milk: { name: 'いつもの牛乳' },
        cabbage: { hidden: true },
      },
      addedProducts: [
        {
          id: HOUSEHOLD_ID,
          name: '家庭商品',
          unit: '個',
          categoryId: 'other',
          hidden: false,
          createdAt: NOW,
          updatedAt: NOW,
        },
        {
          id: 'household:223e4567-e89b-42d3-a456-426614174000',
          name: '別の商品',
          unit: '袋',
          categoryId: 'daily',
          hidden: true,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
    }
    const second = {
      ...first,
      revision: 99,
      updatedAt: '2026-08-01T00:00:00.000Z',
      overrides: {
        cabbage: { hidden: true },
        milk: { name: 'いつもの牛乳' },
      },
      addedProducts: [...first.addedProducts].reverse().map((product) => ({
        ...product,
        updatedAt: '2026-08-01T00:00:00.000Z',
      })),
    }
    expect(createCatalogFingerprint(second)).toBe(
      createCatalogFingerprint(first),
    )
  })

  it('changes when user-controlled catalog content changes', () => {
    const empty = createEmptyHouseholdCatalog(NOW)
    const renamed = updateBaseProduct(
      empty,
      'milk',
      {
        name: 'いつもの牛乳',
        unit: '本',
        categoryId: 'eggs-dairy',
        hidden: false,
      },
      '2026-07-26T01:00:00.000Z',
    )
    expect(createCatalogFingerprint(renamed)).not.toBe(
      createCatalogFingerprint(empty),
    )
  })

  it('is unbacked until a matching confirmation receipt exists and becomes unbacked after editing', () => {
    const empty = createEmptyHouseholdCatalog(NOW)
    expect(getCatalogBackupStatus(empty, null)).toBe('standard')
    const added = addHouseholdProduct(
      empty,
      { name: '家庭商品', unit: '個', categoryId: 'other' },
      '2026-07-26T01:00:00.000Z',
      products,
      categories,
      HOUSEHOLD_ID,
    )
    expect(getCatalogBackupStatus(added, null)).toBe('unbacked')
    const receipt: CatalogBackupReceipt = {
      catalogFingerprint: createCatalogFingerprint(added),
      confirmedAt: '2026-07-26T02:00:00.000Z',
    }
    expect(getCatalogBackupStatus(added, receipt)).toBe('backed-up')

    const edited = updateBaseProduct(
      added,
      'milk',
      {
        name: '家庭の牛乳',
        unit: '本',
        categoryId: 'eggs-dairy',
        hidden: false,
      },
      '2026-07-26T03:00:00.000Z',
    )
    expect(getCatalogBackupStatus(edited, receipt)).toBe('unbacked')
  })
})
