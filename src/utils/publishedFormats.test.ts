import { describe, expect, it } from 'vitest'
import {
  PUBLISHED_CATALOG_RECOVERY_FIXTURE,
  PUBLISHED_CATALOG_RECOVERY_JSON_FIXTURE,
  PUBLISHED_V2_REQUEST_FIXTURE,
  PUBLISHED_V3_REQUEST_FIXTURE,
} from '../testFixtures/publishedFormats'
import {
  decodeCatalogRecoveryPayload,
  parseCatalogRecoveryJson,
} from './catalogRecovery'
import { decodeCompactRequest } from './compactRequest'
import {
  decodeCompactRequestV2OrV3,
  decodeCompactRequestV3,
} from './compactRequestV3'

describe('published format golden fixtures', () => {
  it('decodes the fixed v2 fixture without changing published identities', () => {
    const payload = decodeCompactRequest(PUBLISHED_V2_REQUEST_FIXTURE)

    expect(payload).toMatchObject({
      requestId: 'v2-golden-v2-20260726',
      title: '公開v2依頼',
      createdAt: '1970-01-12T16:12:46.751Z',
      items: [
        {
          id: 'v2-golden-v2-20260726-0',
          productId: 'cabbage',
          productNameSnapshot: 'キャベツ',
          categoryIdSnapshot: 'vegetables',
          quantity: 2,
          unit: '個',
          memo: '半玉',
          sortOrderSnapshot: 101,
        },
        {
          id: 'v2-golden-v2-20260726-custom-0',
          productId: 'custom:0',
          productNameSnapshot: '電池',
          categoryIdSnapshot: 'other',
          quantity: 2,
          unit: '本',
          memo: '単3',
          sortOrderSnapshot: 10_000,
        },
      ],
    })
    expect(
      decodeCompactRequestV2OrV3(PUBLISHED_V2_REQUEST_FIXTURE),
    ).toEqual(payload)
  })

  it('decodes the fixed v3 fixture independently of current encoders', () => {
    const payload = decodeCompactRequestV3(PUBLISHED_V3_REQUEST_FIXTURE)

    expect(payload).toMatchObject({
      requestId: 'v3-golden-v3-20260726',
      title: 'おつかいリスト',
      createdAt: '1970-01-12T16:12:46.751Z',
      items: [
        {
          id: 'v3-golden-v3-20260726-0',
          productId: 'cabbage',
          productNameSnapshot: 'キャベツ',
          categoryIdSnapshot: 'vegetables',
          quantity: 2,
          unit: '個',
          memo: '半玉',
          sortOrderSnapshot: 1_000,
        },
        {
          id: 'v3-golden-v3-20260726-1',
          productId: 'milk',
          productNameSnapshot: '送信側の牛乳',
          categoryIdSnapshot: 'drinks',
          quantity: 2,
          unit: 'ケース',
          memo: '低脂肪',
          sortOrderSnapshot: 11_001,
        },
        {
          id: 'v3-golden-v3-20260726-2',
          productId:
            'household:123e4567-e89b-42d3-a456-426614174000',
          productNameSnapshot: '家庭の洗剤😀',
          categoryIdSnapshot: 'daily',
          quantity: 3,
          unit: '袋',
          memo: '詰替用',
          sortOrderSnapshot: 12_002,
        },
        {
          id: 'v3-golden-v3-20260726-3',
          productId: 'custom:0',
          productNameSnapshot: '一回だけの商品',
          categoryIdSnapshot: 'other',
          quantity: 1,
          unit: '個',
          sortOrderSnapshot: 14_003,
        },
      ],
    })
    expect(
      decodeCompactRequestV2OrV3(PUBLISHED_V3_REQUEST_FIXTURE),
    ).toEqual(payload)
  })

  it('decodes fixed catalog recovery URL and JSON fixtures identically', () => {
    const fromLink = decodeCatalogRecoveryPayload(
      PUBLISHED_CATALOG_RECOVERY_FIXTURE,
    )
    const fromJson = parseCatalogRecoveryJson(
      PUBLISHED_CATALOG_RECOVERY_JSON_FIXTURE,
    )

    expect(fromLink).toEqual(fromJson)
    expect(fromLink).toEqual({
      version: 1,
      createdAt: '2026-07-26T03:00:00.000Z',
      catalog: {
        schemaVersion: 1,
        revision: 3,
        updatedAt: '2026-07-26T02:00:00.000Z',
        overrides: {
          milk: {
            name: 'いつもの牛乳',
            unit: 'パック',
            categoryId: 'drinks',
            hidden: true,
          },
        },
        addedProducts: [
          {
            id: 'household:123e4567-e89b-42d3-a456-426614174000',
            name: '家庭商品',
            unit: '袋',
            categoryId: 'daily',
            hidden: false,
            createdAt: '2026-07-26T01:00:00.000Z',
            updatedAt: '2026-07-26T02:00:00.000Z',
          },
        ],
      },
    })
  })
})
