import { compressToEncodedURIComponent } from 'lz-string'
import { describe, expect, it } from 'vitest'
import { MAX_SHARE_URL_LENGTH } from '../constants/requestLimits'
import { CATEGORY_IDS_V3 } from '../data/categoryIdsV3'
import { products } from '../data/products'
import type { CreateDraftState } from '../types/shopping'
import {
  buildCompactRequestPayload,
  encodeCompactRequest,
} from './compactRequest'
import {
  buildCompactRequestV3Payload,
  buildCompactRequestV3UrlFromInput,
  decodeCompactRequestV2OrV3,
  decodeCompactRequestV3,
  encodeCompactRequestV3,
  type CompactRequestV3Input,
  type V3BaseItem,
} from './compactRequestV3'
import { buildLineDeliveryRequestUrl } from './lineDeliveryUrl'
import type { SelectedRequestItem } from './selectedRequestItems'

const REQUEST_KEY = 'm1234567-abcd'

function fromBase(
  productId: string,
  overrides: Partial<SelectedRequestItem> = {},
): SelectedRequestItem {
  const product = products.find((entry) => entry.id === productId)
  if (!product) {
    throw new Error('test product missing')
  }
  return {
    productId: product.id,
    name: product.name,
    unit: product.unit,
    categoryId: product.categoryId,
    sortOrder: product.sortOrder,
    quantity: 1,
    memo: '',
    icon: product.icon,
    hidden: false,
    ...overrides,
  }
}

function createInput(
  items: readonly SelectedRequestItem[],
): CompactRequestV3Input {
  return {
    requestKey: REQUEST_KEY,
    title: 'おつかいリスト',
    items,
  }
}

describe('v3 compact request format', () => {
  it('locks the published category-number order', () => {
    let checksum = 2_166_136_261
    for (const character of CATEGORY_IDS_V3.join('|')) {
      checksum ^= character.charCodeAt(0)
      checksum = Math.imul(checksum, 16_777_619)
    }
    expect(checksum >>> 0).toBe(4_014_600_499)
  })

  it('uses a short base reference for an unchanged base product', () => {
    const payload = buildCompactRequestV3Payload(
      createInput([fromBase('cabbage', { quantity: 2, memo: '半玉' })]),
    )
    expect(payload[3]).toEqual([[0, 0, '2', '半玉']])

    const decoded = decodeCompactRequestV3(encodeCompactRequestV3(payload))
    expect(decoded).toMatchObject({
      requestId: `v3-${REQUEST_KEY}`,
      title: 'おつかいリスト',
      items: [
        {
          id: `v3-${REQUEST_KEY}-0`,
          productId: 'cabbage',
          productNameSnapshot: 'キャベツ',
          categoryIdSnapshot: 'vegetables',
          quantity: 2,
          unit: '個',
          memo: '半玉',
        },
      ],
    })
  })

  it('snapshots edited base, household, and one-time custom products', () => {
    const householdId =
      'household:123e4567-e89b-42d3-a456-426614174000'
    const items: SelectedRequestItem[] = [
      fromBase('milk', {
        name: 'いつもの牛乳🥛',
        unit: 'パック',
        categoryId: 'drinks',
        quantity: 2,
        memo: '低脂肪',
      }),
      {
        productId: householdId,
        name: '家庭の洗剤😀',
        unit: '袋',
        categoryId: 'daily',
        sortOrder: 1200,
        quantity: 3,
        memo: '詰替用',
        icon: '🛒',
        hidden: false,
      },
      {
        productId: 'custom:0',
        name: '一回だけの商品',
        unit: '個',
        categoryId: 'other',
        sortOrder: 10_000,
        quantity: 1,
        memo: '',
        icon: '🛒',
        hidden: false,
      },
    ]
    const payload = buildCompactRequestV3Payload(createInput(items))
    expect(payload[3].every((item) => item[0] === 1)).toBe(true)

    const decoded = decodeCompactRequestV3(encodeCompactRequestV3(payload))
    expect(decoded.items).toMatchObject([
      {
        productId: 'milk',
        productNameSnapshot: 'いつもの牛乳🥛',
        unit: 'パック',
        categoryIdSnapshot: 'drinks',
        quantity: 2,
        memo: '低脂肪',
      },
      {
        productId: householdId,
        productNameSnapshot: '家庭の洗剤😀',
        unit: '袋',
        categoryIdSnapshot: 'daily',
        quantity: 3,
      },
      {
        productId: 'custom:0',
        productNameSnapshot: '一回だけの商品',
        categoryIdSnapshot: 'other',
      },
    ])
  })

  it('uses URL snapshots instead of the receiving device catalog for edited products', () => {
    const payload = buildCompactRequestV3Payload(
      createInput([
        fromBase('milk', {
          name: '送信側の牛乳',
          unit: 'ケース',
          categoryId: 'drinks',
        }),
      ]),
    )
    const receivingBase = products.map((product) =>
      product.id === 'milk'
        ? { ...product, name: '受信側の別名', unit: '本' }
        : product,
    )
    const decoded = decodeCompactRequestV3(
      encodeCompactRequestV3(payload),
      receivingBase,
    )
    expect(decoded.items[0]).toMatchObject({
      productNameSnapshot: '送信側の牛乳',
      unit: 'ケース',
      categoryIdSnapshot: 'drinks',
    })
  })

  it('produces stable request and item IDs from the same URL', () => {
    const encoded = encodeCompactRequestV3(
      buildCompactRequestV3Payload(
        createInput([fromBase('milk'), fromBase('eggs')]),
      ),
    )
    const first = decodeCompactRequestV3(encoded)
    const second = decodeCompactRequestV3(encoded)
    expect(second.requestId).toBe(first.requestId)
    expect(second.items.map((item) => item.id)).toEqual(
      first.items.map((item) => item.id),
    )
  })

  it('dispatches v2 and v3 from the shared compact hash path without changing v2', () => {
    const draft: CreateDraftState = Object.fromEntries(
      products.map((product) => [
        product.id,
        { quantity: product.id === 'milk' ? 1 : 0, memo: '' },
      ]),
    )
    const v2 = encodeCompactRequest(
      buildCompactRequestPayload({
        requestKey: REQUEST_KEY,
        title: '既存v2',
        draft,
        customItems: [],
      }),
    )
    const v3 = encodeCompactRequestV3(
      buildCompactRequestV3Payload(createInput([fromBase('milk')])),
    )
    expect(decodeCompactRequestV2OrV3(v2).requestId).toBe(
      `v2-${REQUEST_KEY}`,
    )
    expect(decodeCompactRequestV2OrV3(v3).requestId).toBe(
      `v3-${REQUEST_KEY}`,
    )
  })

  it('rejects malformed versions, indexes, categories, quantities, IDs, and duplicates', () => {
    const encode = (value: unknown) =>
      compressToEncodedURIComponent(JSON.stringify(value))
    expect(() =>
      decodeCompactRequestV3(encode([4, REQUEST_KEY, '依頼', []])),
    ).toThrow()
    expect(() =>
      decodeCompactRequestV3(
        encode([3, REQUEST_KEY, '依頼', [[0, 9999, '1']]]),
      ),
    ).toThrow()
    expect(() =>
      decodeCompactRequestV3(
        encode([
          3,
          REQUEST_KEY,
          '依頼',
          [[1, 'custom:0', '商品', '1', '個', 99]],
        ]),
      ),
    ).toThrow()
    expect(() =>
      decodeCompactRequestV3(
        encode([3, REQUEST_KEY, '依頼', [[0, 0, '0']]]),
      ),
    ).toThrow()
    expect(() =>
      decodeCompactRequestV3(
        encode([
          3,
          REQUEST_KEY,
          '依頼',
          [[1, 'household:bad', '商品', '1', '個', 13]],
        ]),
      ),
    ).toThrow()
    expect(() =>
      decodeCompactRequestV3(
        encode([
          3,
          REQUEST_KEY,
          '依頼',
          [
            [0, 0, '1'],
            [0, 0, '2'],
          ],
        ]),
      ),
    ).toThrow('重複')
    const overConditionTotal = Array.from(
      { length: 34 },
      (_, index): V3BaseItem => [
        0,
        index,
        '1',
        '条'.repeat(index === 33 ? 11 : 30),
      ],
    )
    expect(() =>
      decodeCompactRequestV3(
        encode([3, REQUEST_KEY, '依頼', overConditionTotal]),
      ),
    ).toThrow('条件合計')
  })

  it('measures actual LINE delivery URLs and never truncates oversized snapshots', () => {
    const allBaseItems = products.map((product, index) =>
      fromBase(product.id, {
        quantity: 20,
        memo: index < 34 ? `条件${index}` : '',
      }),
    )
    const compactUrl = buildCompactRequestV3UrlFromInput(
      'https://plain-relay.github.io/kaimono-baton/',
      createInput(allBaseItems),
    )
    expect(buildLineDeliveryRequestUrl(compactUrl).length).toBeLessThanOrEqual(
      MAX_SHARE_URL_LENGTH,
    )

    const snapshotItems = products.map((product, index) =>
      fromBase(product.id, {
        name: `${product.name}${String(index).padStart(2, '0')}変更後`,
        memo: index < 33 ? '条件'.repeat(15) : '',
      }),
    )
    const oversizedCompactUrl = buildCompactRequestV3UrlFromInput(
      'https://plain-relay.github.io/kaimono-baton/',
      createInput(snapshotItems),
    )
    const oversized = buildLineDeliveryRequestUrl(oversizedCompactUrl)
    expect(oversized.length).toBeGreaterThan(MAX_SHARE_URL_LENGTH)
    expect(
      decodeCompactRequestV3(
        new URL(oversized).hash.slice('#/l/'.length),
      ).items,
    ).toHaveLength(products.length)
  })
})
