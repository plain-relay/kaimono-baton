import { compressToEncodedURIComponent } from 'lz-string'
import { describe, expect, it } from 'vitest'
import { MAX_SHARE_URL_LENGTH } from '../constants/requestLimits'
import { products } from '../data/products'
import { PUBLISHED_V1_REQUEST_FIXTURE, PUBLISHED_V2_REQUEST_FIXTURE, PUBLISHED_V3_REQUEST_FIXTURE } from '../testFixtures/publishedFormats'
import type { SelectedRequestItem } from './selectedRequestItems'
import {
  buildCompactRequestV4Payload,
  buildCompactRequestV4UrlFromInput,
  decodeCompactRequestV4,
  decodeCompactRequestV4Payload,
  encodeCompactRequestV4,
} from './compactRequestV4'
import { decodeShoppingRequest } from './encodeRequest'
import { decodeCompactRequest } from './compactRequest'
import { decodeCompactRequestV3 } from './compactRequestV3'

const token = 'p1_AAECAwQFBgcICQoLDA0ODxAREhMUFRYX'
const secondToken = 'p1_AQECAwQFBgcICQoLDA0ODxAREhMUFRYX'

function selected(productId: string): SelectedRequestItem {
  const product = products.find((candidate) => candidate.id === productId)
  if (!product) {
    throw new Error(`Missing test product: ${productId}`)
  }
  return {
    productId: product.id,
    name: product.name,
    unit: product.unit,
    categoryId: product.categoryId,
    sortOrder: product.sortOrder,
    quantity: 1,
    memo: product.memo ?? '',
    icon: product.icon,
    hidden: false,
  }
}

describe('compact request v4', () => {
  it('reuses unchanged v3 item tuples and attaches sparse photo refs', () => {
    const input = {
      requestKey: 'm1234567-abcd',
      title: 'おつかい依頼',
      items: [selected('milk'), selected('eggs')],
      photoRefs: [[1, token] as [number, string]],
    }
    const payload = buildCompactRequestV4Payload(input)

    expect(payload[0]).toBe(4)
    expect(payload[3]).toEqual([
      [0, expect.any(Number), '1'],
      [0, expect.any(Number), '1'],
    ])
    expect(payload[4]).toEqual([[1, token]])

    const first = decodeCompactRequestV4(encodeCompactRequestV4(payload))
    const second = decodeCompactRequestV4(encodeCompactRequestV4(payload))
    expect(first).toEqual(second)
    expect(first.requestId).toBe('v4-m1234567-abcd')
    expect(first.items.map((item) => item.id)).toEqual([
      'v4-m1234567-abcd-0',
      'v4-m1234567-abcd-1',
    ])
    expect(first.items[1].photoToken).toBe(token)
  })

  it('rejects duplicate indexes, duplicate tokens, invalid tokens, and empty refs when encoding', () => {
    const items = [selected('milk'), selected('eggs')]
    const invalidRefs = [
      [],
      [[0, token], [0, secondToken]],
      [[0, token], [1, token]],
      [[0, 'not-a-token']],
      [[2, token]],
    ]

    for (const photoRefs of invalidRefs) {
      expect(() =>
        buildCompactRequestV4Payload({
          requestKey: 'm1234567-abcd',
          title: 'おつかい依頼',
          items,
          photoRefs: photoRefs as Array<[number, string]>,
        }),
      ).toThrow()
    }
  })

  it('keeps the product list when photo refs are malformed', () => {
    const core = buildCompactRequestV4Payload({
      requestKey: 'm1234567-abcd',
      title: 'おつかい依頼',
      items: [selected('milk'), selected('eggs')],
      photoRefs: [[0, token]],
    })
    const malformedRefs: unknown[] = [
      'bad',
      [[99, token]],
      [[0, 'bad-token']],
      [[0, token], [0, secondToken]],
      [[0, token], [1, secondToken], [0, secondToken], [1, token]],
    ]

    for (const refs of malformedRefs) {
      const decoded = decodeCompactRequestV4Payload([
        core[0],
        core[1],
        core[2],
        core[3],
        refs,
      ])
      expect(decoded.items).toHaveLength(2)
      expect(decoded.items.every((item) => !item.photoToken)).toBe(true)
    }

    const missingRefs = decodeCompactRequestV4Payload([
      core[0],
      core[1],
      core[2],
      core[3],
    ])
    expect(missingRefs.items).toHaveLength(2)
    expect(missingRefs.items.every((item) => !item.photoToken)).toBe(true)
  })

  it('keeps valid refs while ignoring an unrelated invalid tuple', () => {
    const core = buildCompactRequestV4Payload({
      requestKey: 'm1234567-abcd',
      title: 'おつかい依頼',
      items: [selected('milk'), selected('eggs')],
      photoRefs: [[0, token]],
    })
    const decoded = decodeCompactRequestV4Payload([
      core[0],
      core[1],
      core[2],
      core[3],
      [[0, token], ['bad-index', secondToken]],
    ])

    expect(decoded.items[0].photoToken).toBe(token)
    expect(decoded.items[1].photoToken).toBeUndefined()
  })

  it('honors the existing 2,200-character share URL limit', () => {
    const url = buildCompactRequestV4UrlFromInput(
      'https://plain-relay.github.io/kaimono-baton/',
      {
        requestKey: 'm1234567-abcd',
        title: 'おつかい依頼',
        items: [selected('milk')],
        photoRefs: [[0, token]],
      },
    )
    expect(url.length).toBeLessThanOrEqual(MAX_SHARE_URL_LENGTH)
  })

  it('preserves the validation session query in a gated v4 URL', () => {
    const validationToken = `mv1_${'V'.repeat(32)}`
    const url = buildCompactRequestV4UrlFromInput(
      `https://plain-relay.github.io/kaimono-baton/?manualValidationSessionId=${validationToken}`,
      {
        requestKey: 'm1234567-abcd',
        title: 'request',
        items: [selected('milk')],
        photoRefs: [[0, token]],
      },
    )
    expect(url).toContain(
      `manualValidationSessionId=${validationToken}#/l/`,
    )
  })

  it('does not change published v1, v2, or v3 fixtures', () => {
    expect(decodeShoppingRequest(PUBLISHED_V1_REQUEST_FIXTURE).items.length).toBeGreaterThan(0)
    expect(decodeCompactRequest(PUBLISHED_V2_REQUEST_FIXTURE).items.length).toBeGreaterThan(0)
    expect(decodeCompactRequestV3(PUBLISHED_V3_REQUEST_FIXTURE).items.length).toBeGreaterThan(0)
    expect(() =>
      decodeCompactRequestV4(
        compressToEncodedURIComponent(JSON.stringify([3, 'key', '', []])),
      ),
    ).toThrow()
  })
})
