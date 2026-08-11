import { compressToEncodedURIComponent } from 'lz-string'
import { describe, expect, it } from 'vitest'
import { MAX_SHARE_URL_LENGTH } from '../constants/requestLimits'
import { products } from '../data/products'
import { SHARE_PRODUCT_IDS_V2 } from '../data/shareProductIdsV2'
import type { CreateDraftState } from '../types/shopping'
import {
  buildCompactRequestPayload,
  buildCompactRequestUrlFromInput,
  chooseCompactConditionData,
  createRequestKey,
  decodeCompactRequest,
  decodeQuantityCode,
  encodeCompactRequest,
  encodeQuantityCode,
  getCompactConditionMode,
  type CompactRequestInput,
  type CompactRequestV2,
} from './compactRequest'
import { countUserCharacters } from './textLength'
import { buildLineDeliveryRequestUrl } from './lineDeliveryUrl'

function createDraft(): CreateDraftState {
  return Object.fromEntries(
    products.map((product) => [product.id, { quantity: 0, memo: '' }]),
  )
}

function createInput(
  overrides: Partial<CompactRequestInput> = {},
): CompactRequestInput {
  return {
    requestKey: 'm1234567-abcd',
    title: '今日のおつかい',
    draft: createDraft(),
    customItems: [],
    ...overrides,
  }
}

function createVariedConditions(totalCharacters: number): string[] {
  const alphabet = Array.from(
    '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!$%()*,:;=@[]^_{}~あいうえおカキクケコ',
  )
  let seed = 0x6d2b79f5
  let remaining = totalCharacters
  return products.map((_, productIndex) => {
    const remainingProducts = products.length - productIndex
    const length = Math.min(30, Math.ceil(remaining / remainingProducts))
    let condition = ''
    for (let index = 0; index < length; index += 1) {
      seed = (Math.imul(seed ^ (seed >>> 15), 1 | seed) + productIndex + index) | 0
      condition += alphabet[Math.abs(seed) % alphabet.length]
    }
    remaining -= length
    return condition
  })
}

describe('v2 fixed product numbers', () => {
  it('contains every current master product once and locks the published order', () => {
    expect(new Set(SHARE_PRODUCT_IDS_V2)).toEqual(
      new Set(products.map((product) => product.id)),
    )
    expect(new Set(SHARE_PRODUCT_IDS_V2).size).toBe(SHARE_PRODUCT_IDS_V2.length)

    let orderChecksum = 2_166_136_261
    for (const character of SHARE_PRODUCT_IDS_V2.join('|')) {
      orderChecksum ^= character.charCodeAt(0)
      orderChecksum = Math.imul(orderChecksum, 16_777_619)
    }
    expect(orderChecksum >>> 0).toBe(972_434_876)
  })
})

describe('v2 quantity codes', () => {
  it.each([
    [0, '0'],
    [1, '1'],
    [9, '9'],
    [10, 'a'],
    [19, 'j'],
    [20, 'k'],
  ])('round-trips quantity %i', (quantity, code) => {
    expect(encodeQuantityCode(quantity)).toBe(code)
    expect(decodeQuantityCode(code)).toBe(quantity)
  })

  it('rejects unsafe encode values and safely treats invalid decode codes as zero', () => {
    expect(() => encodeQuantityCode(21)).toThrow()
    expect(() => encodeQuantityCode(1.5)).toThrow()
    expect(decodeQuantityCode('z')).toBe(0)
    expect(decodeQuantityCode('10')).toBe(0)
  })
})

describe('v2 compact condition selection', () => {
  it('uses sparse data for a small number of conditions far apart', () => {
    const conditions = new Map<number, string>([
      [2, '小さめ'],
      [90, '無香料'],
    ])
    expect(getCompactConditionMode(chooseCompactConditionData(conditions))).toBe('sparse')
  })

  it('uses dense data when conditions are distributed across many products', () => {
    const conditions = new Map<number, string>(
      Array.from({ length: 60 }, (_, index) => [index, `条件${index % 7}`]),
    )
    expect(getCompactConditionMode(chooseCompactConditionData(conditions))).toBe('dense')
  })
})

describe('v2 request encode and decode', () => {
  it('round-trips a minimal request with one product', () => {
    const draft = createDraft()
    draft.cabbage = { quantity: 1, memo: '' }
    const encoded = encodeCompactRequest(buildCompactRequestPayload(createInput({ draft })))
    const decoded = decodeCompactRequest(encoded)

    expect(decoded.requestId).toBe('v2-m1234567-abcd')
    expect(decoded.title).toBe('今日のおつかい')
    expect(decoded.items).toHaveLength(1)
    expect(decoded.items[0]).toMatchObject({
      id: 'v2-m1234567-abcd-0',
      productId: 'cabbage',
      productNameSnapshot: 'キャベツ',
      categoryIdSnapshot: 'vegetables',
      categoryNameSnapshot: '野菜',
      quantity: 1,
      unit: '個',
      iconSnapshot: '🥬',
      sortOrderSnapshot: 101,
    })
  })

  it('round-trips all quantity codes, Japanese, symbols, emoji, and custom items', () => {
    const draft = createDraft()
    ;[0, 1, 9, 10, 19, 20].forEach((quantity, index) => {
      const product = products[index]
      draft[product.id] = {
        quantity,
        memo: quantity > 0 ? `条件${index}😀 &+=?#` : '',
      }
    })
    const input = createInput({
      title: '週末🛍️ ABC & 123',
      draft,
      customItems: [
        { name: '洗濯ネット😀', quantity: 20, unit: '枚', memo: '大きめ & 白' },
        { name: '電池', quantity: 1, unit: '個', memo: '' },
      ],
    })
    const decoded = decodeCompactRequest(
      encodeCompactRequest(buildCompactRequestPayload(input)),
    )

    expect(decoded.title).toBe(input.title)
    expect(decoded.items.map((item) => item.quantity)).toEqual([1, 9, 10, 19, 20, 20, 1])
    expect(decoded.items.at(-2)).toMatchObject({
      id: 'v2-m1234567-abcd-custom-0',
      productNameSnapshot: '洗濯ネット😀',
      quantity: 20,
      unit: '枚',
      memo: '大きめ & 白',
    })
    expect(decoded.items.at(-1)).toMatchObject({ unit: '個', memo: undefined })
  })

  it('round-trips all current products with irregular quantities from 1 through 20', () => {
    const draft = createDraft()
    products.forEach((product, index) => {
      draft[product.id] = {
        quantity: (index % 20) + 1,
        memo: index % 4 === 0 ? `個別条件${index}` : '',
      }
    })
    const decoded = decodeCompactRequest(
      encodeCompactRequest(buildCompactRequestPayload(createInput({ draft }))),
    )
    expect(decoded.items).toHaveLength(products.length)
    expect(decoded.items.map((item) => item.quantity)).toEqual(
      products.map((_, index) => (index % 20) + 1),
    )
  })

  it('produces the same request and item IDs every time the same URL is decoded', () => {
    const draft = createDraft()
    draft.milk = { quantity: 2, memo: '低脂肪' }
    const encoded = encodeCompactRequest(buildCompactRequestPayload(createInput({ draft })))
    const first = decodeCompactRequest(encoded)
    const second = decodeCompactRequest(encoded)
    expect(second.requestId).toBe(first.requestId)
    expect(second.items.map((item) => item.id)).toEqual(first.items.map((item) => item.id))
  })

  it('uses a safe fallback when a published product is missing from the master', () => {
    const draft = createDraft()
    draft.cabbage = { quantity: 1, memo: '半玉' }
    const encoded = encodeCompactRequest(buildCompactRequestPayload(createInput({ draft })))
    const decoded = decodeCompactRequest(
      encoded,
      products.filter((product) => product.id !== 'cabbage'),
    )
    expect(decoded.items[0]).toMatchObject({
      productId: 'cabbage',
      productNameSnapshot: '不明な商品 (cabbage)',
      iconSnapshot: '❓',
      memo: '半玉',
    })
  })

  it('ignores unknown product-number tail data without hiding known products', () => {
    const quantities = `1${'0'.repeat(SHARE_PRODUCT_IDS_V2.length - 1)}k`
    const payload: CompactRequestV2 = [2, 'm1234567-abcd', '依頼', quantities, 0]
    const decoded = decodeCompactRequest(encodeCompactRequest(payload))
    expect(decoded.items).toHaveLength(1)
    expect(decoded.items[0].productId).toBe('cabbage')
  })

  it('rejects empty, broken, malformed, and unknown-version data', () => {
    expect(() => decodeCompactRequest('')).toThrow()
    expect(() => decodeCompactRequest('broken-data')).toThrow()
    expect(() =>
      decodeCompactRequest(compressToEncodedURIComponent(JSON.stringify([3, 'key', '', '', 0]))),
    ).toThrow('対応していない')
    expect(() =>
      decodeCompactRequest(compressToEncodedURIComponent(JSON.stringify([2, 'key', '', '', ['x']]))),
    ).toThrow()
    expect(
      decodeCompactRequest(
        compressToEncodedURIComponent(
          JSON.stringify([2, 'k'.repeat(64), '依頼', '', 0]),
        ),
      ).requestId,
    ).toBe(`v2-${'k'.repeat(64)}`)
    expect(() =>
      decodeCompactRequest(
        compressToEncodedURIComponent(
          JSON.stringify([2, 'k'.repeat(65), '依頼', '', 0]),
        ),
      ),
    ).toThrow('形式が正しくありません')
  })

  it('rejects decoded v2 conditions whose selected-item total exceeds 1,000 characters', () => {
    const selectedItemCount = 34
    const exactConditions = [
      ...Array.from(
        { length: selectedItemCount - 1 },
        () => '条'.repeat(30),
      ),
      '条'.repeat(10),
    ]
    const payload: CompactRequestV2 = [
      2,
      'phase4-condition-total',
      '依頼',
      '1'.repeat(selectedItemCount),
      [0, ...exactConditions],
    ]

    expect(
      decodeCompactRequest(encodeCompactRequest(payload)).items,
    ).toHaveLength(selectedItemCount)
    exactConditions[exactConditions.length - 1] += '追'
    const overPayload: CompactRequestV2 = [
      2,
      payload[1],
      payload[2],
      payload[3],
      [0, ...exactConditions],
    ]
    expect(() =>
      decodeCompactRequest(
        encodeCompactRequest(overPayload),
      ),
    ).toThrow('条件合計')
  })

  it('builds the published hash path without changing the compressed value', () => {
    const draft = createDraft()
    draft.cabbage = { quantity: 1, memo: '' }
    const input = createInput({ draft })
    const url = buildCompactRequestUrlFromInput(
      'https://plain-relay.github.io/kaimono-baton/',
      input,
    )
    expect(url).toMatch(
      /^https:\/\/plain-relay\.github\.io\/kaimono-baton\/#\/l\//,
    )
    expect(url).not.toContain('?data=')
  })

  it('creates a short deterministic-format request key from time plus random data', () => {
    const key = createRequestKey(1_700_000_000_000, 0.5)
    expect(key).toMatch(/^[0-9a-z]+-[0-9a-z]{4}$/)
    expect(createRequestKey(1_700_000_000_000, 0.5)).toBe(key)
  })
})

describe('v2 URL stress budget', () => {
  it('keeps all current products at quantity 20 with 1,000 varied condition characters under 2,200', () => {
    const conditions = createVariedConditions(1000)
    const draft = createDraft()
    products.forEach((product, index) => {
      draft[product.id] = { quantity: 20, memo: conditions[index] }
    })
    expect(conditions.reduce((total, condition) => total + countUserCharacters(condition), 0)).toBe(1000)
    expect(conditions.every((condition) => countUserCharacters(condition) <= 30)).toBe(true)

    const compactUrl = buildCompactRequestUrlFromInput(
      'https://plain-relay.github.io/kaimono-baton/',
      createInput({
        title: '全商品ストレス確認0123456789ABCDEFGHIJK',
        draft,
      }),
    )
    const url = buildLineDeliveryRequestUrl(compactUrl)
    expect(countUserCharacters('全商品ストレス確認0123456789ABCDEFGHIJK')).toBe(30)
    expect(url).toContain('?openExternalBrowser=1#/l/')
    expect(url.length).toBeLessThanOrEqual(MAX_SHARE_URL_LENGTH)
  })
})
