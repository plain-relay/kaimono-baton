import { compressToEncodedURIComponent } from 'lz-string'
import { describe, expect, it } from 'vitest'
import {
  MAX_CATALOG_RECOVERY_JSON_CHARS,
  MAX_CATALOG_RECOVERY_URL_LENGTH,
} from '../constants/requestLimits'
import { categories } from '../data/categories'
import { products } from '../data/products'
import {
  addHouseholdProduct,
  createEmptyHouseholdCatalog,
  updateBaseProduct,
} from './householdCatalog'
import {
  buildCatalogRecoveryUrl,
  createCatalogRecoveryBundle,
  createCatalogRecoveryPreview,
  decodeCatalogRecoveryPayload,
  isRecoveryPayloadOlderThanCatalog,
  parseCatalogRecoveryJson,
} from './catalogRecovery'

const NOW = '2026-07-26T00:00:00.000Z'
const LATER = '2026-07-26T01:00:00.000Z'
const HOUSEHOLD_ID = 'household:123e4567-e89b-42d3-a456-426614174000'

function createChangedCatalog() {
  let catalog = updateBaseProduct(
    createEmptyHouseholdCatalog(NOW),
    'milk',
    {
      name: 'いつもの牛乳',
      unit: 'パック',
      categoryId: 'drinks',
      hidden: true,
    },
    LATER,
  )
  catalog = addHouseholdProduct(
    catalog,
    { name: '家庭商品', unit: '袋', categoryId: 'daily', hidden: true },
    '2026-07-26T02:00:00.000Z',
    products,
    categories,
    HOUSEHOLD_ID,
  )
  return catalog
}

describe('catalog recovery data', () => {
  it('round-trips compressed links and JSON through the same validator', () => {
    const catalog = createChangedCatalog()
    const bundle = createCatalogRecoveryBundle(
      'https://plain-relay.github.io/kaimono-baton/',
      catalog,
      '2026-07-26T03:00:00.000Z',
    )
    expect(bundle.url).toBe(
      buildCatalogRecoveryUrl(
        'https://plain-relay.github.io/kaimono-baton/',
        bundle.encoded,
      ),
    )
    expect(decodeCatalogRecoveryPayload(bundle.encoded)).toEqual(bundle.payload)
    expect(parseCatalogRecoveryJson(bundle.json)).toEqual(bundle.payload)
    expect(bundle.fileName).toBe('kaimono-baton-product-list-2026-07-26.json')
  })

  it('rejects broken, unknown-version, oversized, and unsafe recovery data', () => {
    expect(() => decodeCatalogRecoveryPayload('broken')).toThrow()
    expect(() =>
      decodeCatalogRecoveryPayload(
        compressToEncodedURIComponent(
          JSON.stringify({
            version: 2,
            createdAt: NOW,
            catalog: createEmptyHouseholdCatalog(NOW),
          }),
        ),
      ),
    ).toThrow()
    expect(() =>
      decodeCatalogRecoveryPayload(
        compressToEncodedURIComponent(
          'x'.repeat(MAX_CATALOG_RECOVERY_JSON_CHARS + 1),
        ),
      ),
    ).toThrow('大きすぎ')
    const unsafeJson = `{"version":1,"createdAt":"${NOW}","catalog":{"schemaVersion":1,"revision":0,"updatedAt":"${NOW}","overrides":{"__proto__":{"hidden":true}},"addedProducts":[]}}`
    expect(() => parseCatalogRecoveryJson(unsafeJson)).toThrow()
  })

  it('rejects unknown base IDs, invalid categories, malformed added IDs, and duplicate IDs', () => {
    const basePayload = {
      version: 1,
      createdAt: NOW,
      catalog: createEmptyHouseholdCatalog(NOW),
    }
    const encode = (value: unknown) =>
      compressToEncodedURIComponent(JSON.stringify(value))

    expect(() =>
      decodeCatalogRecoveryPayload(
        encode({
          ...basePayload,
          catalog: {
            ...basePayload.catalog,
            overrides: { unknown: { hidden: true } },
          },
        }),
      ),
    ).toThrow()
    expect(() =>
      decodeCatalogRecoveryPayload(
        encode({
          ...basePayload,
          catalog: {
            ...basePayload.catalog,
            overrides: { milk: { categoryId: 'unknown' } },
          },
        }),
      ),
    ).toThrow()
    const invalidProduct = {
      id: 'household:not-a-uuid',
      name: '商品',
      unit: '個',
      categoryId: 'other',
      hidden: false,
      createdAt: NOW,
      updatedAt: NOW,
    }
    expect(() =>
      decodeCatalogRecoveryPayload(
        encode({
          ...basePayload,
          catalog: {
            ...basePayload.catalog,
            addedProducts: [invalidProduct],
          },
        }),
      ),
    ).toThrow()
    const validProduct = {
      ...invalidProduct,
      id: HOUSEHOLD_ID,
    }
    expect(() =>
      decodeCatalogRecoveryPayload(
        encode({
          ...basePayload,
          catalog: {
            ...basePayload.catalog,
            addedProducts: [validProduct, validProduct],
          },
        }),
      ),
    ).toThrow()
  })

  it('summarizes changes and warns when the current catalog is newer', () => {
    const bundle = createCatalogRecoveryBundle(
      'https://example.test/',
      createChangedCatalog(),
      '2026-07-26T03:00:00.000Z',
    )
    expect(createCatalogRecoveryPreview(bundle.payload)).toEqual({
      renamed: 1,
      unitChanged: 1,
      categoryChanged: 1,
      hidden: 2,
      added: 1,
    })
    expect(
      isRecoveryPayloadOlderThanCatalog(bundle.payload, {
        ...bundle.payload.catalog,
        updatedAt: '2026-07-27T00:00:00.000Z',
      }),
    ).toBe(true)
    expect(
      isRecoveryPayloadOlderThanCatalog(bundle.payload, {
        ...bundle.payload.catalog,
        updatedAt: bundle.payload.createdAt,
      }),
    ).toBe(false)
  })

  it('measures the actual final URL at the 2,200-character boundary without truncating data', () => {
    const catalog = createChangedCatalog()
    const probe = createCatalogRecoveryBundle('https://e.test', catalog, NOW)
    const suffixLength = probe.url.length - 'https://e.test'.length
    const basePrefix = 'https://e.test/'
    const exactBase = `${basePrefix}${'a'.repeat(
      MAX_CATALOG_RECOVERY_URL_LENGTH - suffixLength - basePrefix.length,
    )}`
    const exact = createCatalogRecoveryBundle(exactBase, catalog, NOW)
    const over = createCatalogRecoveryBundle(`${exactBase}a`, catalog, NOW)

    expect(exact.urlLength).toBe(MAX_CATALOG_RECOVERY_URL_LENGTH)
    expect(exact.isWithinUrlLimit).toBe(true)
    expect(over.urlLength).toBe(MAX_CATALOG_RECOVERY_URL_LENGTH + 1)
    expect(over.isWithinUrlLimit).toBe(false)
    expect(over.json).toBe(exact.json)
  })
})
