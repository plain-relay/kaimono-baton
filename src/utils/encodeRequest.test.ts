import { compressToEncodedURIComponent } from 'lz-string'
import { describe, expect, it } from 'vitest'
import { PUBLISHED_V1_REQUEST_FIXTURE } from '../testFixtures/publishedFormats'
import type { ShoppingRequestPayload } from '../types/shopping'
import { decodeShoppingRequest, encodeShoppingRequest } from './encodeRequest'

const LEGACY_PAYLOAD: ShoppingRequestPayload = {
  requestId: 'legacy-request',
  title: '以前の依頼',
  createdAt: '2026-07-01T00:00:00.000Z',
  items: [
    {
      id: 'legacy-item',
      productId: 'milk',
      productNameSnapshot: '牛乳',
      categoryIdSnapshot: 'eggs-dairy',
      categoryNameSnapshot: '卵・乳製品',
      quantity: 1,
      unit: '本',
      memo: '低脂肪',
      iconSnapshot: '🥛',
      sortOrderSnapshot: 701,
    },
  ],
}

function encodeRawPayload(value: unknown): string {
  return compressToEncodedURIComponent(JSON.stringify(value))
}

describe('shopping request URL compatibility', () => {
  it('decodes a payload produced by the existing memo-based URL format', () => {
    expect(decodeShoppingRequest(PUBLISHED_V1_REQUEST_FIXTURE)).toEqual(
      LEGACY_PAYLOAD,
    )
  })

  it('keeps the existing compressed payload format unchanged', () => {
    expect(encodeShoppingRequest(LEGACY_PAYLOAD)).toBe(
      PUBLISHED_V1_REQUEST_FIXTURE,
    )
  })

  it('preserves legacy quantities above the new creation limit and custom snapshots', () => {
    const legacyWithOldValues: ShoppingRequestPayload = {
      ...LEGACY_PAYLOAD,
      items: [
        { ...LEGACY_PAYLOAD.items[0], quantity: 25 },
        {
          id: 'legacy-custom',
          productId: 'custom:old',
          productNameSnapshot: '昔の自由商品',
          categoryIdSnapshot: 'other',
          categoryNameSnapshot: 'その他',
          quantity: 21,
          unit: '袋',
          memo: '旧URLの条件',
          iconSnapshot: '🛒',
          sortOrderSnapshot: 10000,
        },
      ],
    }

    expect(decodeShoppingRequest(encodeShoppingRequest(legacyWithOldValues))).toEqual(
      legacyWithOldValues,
    )
  })

  it('rejects an invalid encoded payload', () => {
    expect(() => decodeShoppingRequest('not-a-valid-request')).toThrow()
  })

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
  ])('rejects a %s legacy quantity while preserving old positive integers', (_, quantity) => {
    expect(() =>
      decodeShoppingRequest(
        encodeRawPayload({
          ...LEGACY_PAYLOAD,
          items: [{ ...LEGACY_PAYLOAD.items[0], quantity }],
        }),
      ),
    ).toThrow('形式が正しくありません')
  })

  it.each([
    {
      label: 'empty request ID',
      payload: { ...LEGACY_PAYLOAD, requestId: '   ' },
    },
    {
      label: 'invalid createdAt',
      payload: { ...LEGACY_PAYLOAD, createdAt: 'not-a-date' },
    },
    {
      label: 'empty item ID',
      payload: {
        ...LEGACY_PAYLOAD,
        items: [{ ...LEGACY_PAYLOAD.items[0], id: '' }],
      },
    },
    {
      label: 'empty product ID',
      payload: {
        ...LEGACY_PAYLOAD,
        items: [{ ...LEGACY_PAYLOAD.items[0], productId: ' ' }],
      },
    },
    {
      label: 'duplicate item IDs',
      payload: {
        ...LEGACY_PAYLOAD,
        items: [
          LEGACY_PAYLOAD.items[0],
          {
            ...LEGACY_PAYLOAD.items[0],
            productId: 'eggs',
          },
        ],
      },
    },
    {
      label: 'duplicate product IDs',
      payload: {
        ...LEGACY_PAYLOAD,
        items: [
          LEGACY_PAYLOAD.items[0],
          {
            ...LEGACY_PAYLOAD.items[0],
            id: 'legacy-item-2',
          },
        ],
      },
    },
    {
      label: 'array payload shape',
      payload: [],
    },
    {
      label: 'array item shape',
      payload: {
        ...LEGACY_PAYLOAD,
        items: [[]],
      },
    },
  ])('rejects a legacy payload with $label', ({ payload }) => {
    expect(() =>
      decodeShoppingRequest(encodeRawPayload(payload)),
    ).toThrow('形式が正しくありません')
  })

  it('bounds the number of legacy items without rejecting realistic old requests', () => {
    const items = Array.from({ length: 500 }, (_, index) => ({
      ...LEGACY_PAYLOAD.items[0],
      id: `legacy-item-${index}`,
      productId: `legacy-product-${index}`,
    }))

    expect(
      decodeShoppingRequest(
        encodeRawPayload({ ...LEGACY_PAYLOAD, items }),
      ).items,
    ).toHaveLength(500)
    expect(() =>
      decodeShoppingRequest(
        encodeRawPayload({
          ...LEGACY_PAYLOAD,
          items: [
            ...items,
            {
              ...LEGACY_PAYLOAD.items[0],
              id: 'legacy-item-500',
              productId: 'legacy-product-500',
            },
          ],
        }),
      ),
    ).toThrow('形式が正しくありません')
  })

  it('applies the same semantic validation when producing a v1 payload', () => {
    expect(() =>
      encodeShoppingRequest({
        ...LEGACY_PAYLOAD,
        items: [{ ...LEGACY_PAYLOAD.items[0], quantity: 0 }],
      }),
    ).toThrow('形式が正しくありません')
  })
})
