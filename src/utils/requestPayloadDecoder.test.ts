import { compressToEncodedURIComponent } from 'lz-string'
import { describe, expect, it, vi } from 'vitest'
import {
  MAX_CUSTOM_ITEMS,
  MAX_HOUSEHOLD_PRODUCTS,
  MAX_TOTAL_CONDITION_CHARS,
} from '../constants/requestLimits'
import { SHARE_PRODUCT_IDS_V2 } from '../data/shareProductIdsV2'
import {
  decodeCompactRequestV3,
  encodeCompactRequestV3,
  type CompactRequestV3,
  type V3SnapshotItem,
} from './compactRequestV3'
import {
  assertEncodedRequestSize,
  assertExpandedRequestSize,
  decodeCompressedRequestJson,
  MAX_REQUEST_ENCODED_CHARS,
  MAX_REQUEST_JSON_CHARS,
} from './requestPayloadDecoder'

describe('compressed request decoder limits', () => {
  it('accepts the encoded boundary and rejects boundary plus one', () => {
    expect(() =>
      assertEncodedRequestSize('x'.repeat(MAX_REQUEST_ENCODED_CHARS)),
    ).not.toThrow()
    expect(() =>
      assertEncodedRequestSize('x'.repeat(MAX_REQUEST_ENCODED_CHARS + 1)),
    ).toThrow('共有URLデータが大きすぎます。')
  })

  it('accepts the expanded boundary and rejects boundary plus one', () => {
    expect(() =>
      assertExpandedRequestSize('x'.repeat(MAX_REQUEST_JSON_CHARS)),
    ).not.toThrow()
    expect(() =>
      assertExpandedRequestSize('x'.repeat(MAX_REQUEST_JSON_CHARS + 1)),
    ).toThrow('共有URLデータが大きすぎます。')
  })

  it('rejects a small compressed expansion bomb before JSON.parse', () => {
    const encoded = compressToEncodedURIComponent(
      JSON.stringify('x'.repeat(MAX_REQUEST_JSON_CHARS + 1)),
    )
    const parse = vi.spyOn(JSON, 'parse')

    expect(encoded.length).toBeLessThan(MAX_REQUEST_ENCODED_CHARS)
    expect(() =>
      decodeCompressedRequestJson(encoded, '復元できませんでした。'),
    ).toThrow('共有URLデータが大きすぎます。')
    expect(parse).not.toHaveBeenCalled()
  })

  it('accepts a measured maximum-structure v3 payload with compatibility headroom', () => {
    let seed = 123_456_789
    const next = (alphabet: readonly string[]) => {
      seed = (seed * 1_664_525 + 1_013_904_223) >>> 0
      return alphabet[seed % alphabet.length]
    }
    const randomText = (alphabet: readonly string[], length: number) =>
      Array.from({ length }, () => next(alphabet)).join('')
    const ascii = [...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789']
    const japanese = [
      ...'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん漢字商品単位条件',
    ]
    const itemCount =
      SHARE_PRODUCT_IDS_V2.length +
      MAX_HOUSEHOLD_PRODUCTS +
      MAX_CUSTOM_ITEMS
    let conditionCharactersRemaining = MAX_TOTAL_CONDITION_CHARS
    const items: V3SnapshotItem[] = Array.from(
      { length: itemCount },
      (_, index) => {
        const idPrefix = `snapshot-${index}-`
        const productId =
          idPrefix + randomText(ascii, 128 - idPrefix.length)
        const memoLength = Math.min(30, conditionCharactersRemaining)
        conditionCharactersRemaining -= memoLength
        const item: V3SnapshotItem = [
          1,
          productId,
          randomText(japanese, 30),
          'k',
          randomText(japanese, 10),
          0,
        ]
        if (memoLength > 0) {
          item.push(randomText(japanese, memoLength))
        }
        return item
      },
    )
    const payload: CompactRequestV3 = [
      3,
      randomText(ascii, 64),
      randomText(japanese, 30),
      items,
    ]
    const json = JSON.stringify(payload)
    const encoded = encodeCompactRequestV3(payload)

    expect(conditionCharactersRemaining).toBe(0)
    expect(json.length).toBeGreaterThan(50_000)
    expect(json.length).toBeLessThanOrEqual(MAX_REQUEST_JSON_CHARS)
    expect(encoded.length).toBeGreaterThan(2_200)
    expect(encoded.length).toBeLessThanOrEqual(MAX_REQUEST_ENCODED_CHARS)
    expect(decodeCompactRequestV3(encoded).items).toHaveLength(itemCount)
  })
})
