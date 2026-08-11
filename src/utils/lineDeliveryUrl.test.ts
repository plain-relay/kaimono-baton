import { describe, expect, it } from 'vitest'
import { parseHashRoute } from '../App'
import {
  buildCompactRequestUrl,
  decodeCompactRequest,
  encodeCompactRequest,
  type CompactRequestV2,
} from './compactRequest'
import {
  LINE_EXTERNAL_BROWSER_PARAMETER,
  addLineExternalBrowserHint,
  buildLineDeliveryRequestUrl,
} from './lineDeliveryUrl'

const payload: CompactRequestV2 = [
  2,
  'm1234567-abcd',
  '外部ブラウザ確認',
  '1',
  0,
]
const encoded = encodeCompactRequest(payload)
const compactUrl = buildCompactRequestUrl(
  'https://plain-relay.github.io/kaimono-baton/',
  encoded,
)

describe('LINE delivery request URL', () => {
  it('places openExternalBrowser=1 before the unchanged v2 hash data', () => {
    const deliveryUrl = buildLineDeliveryRequestUrl(compactUrl)
    const parsed = new URL(deliveryUrl)

    expect(deliveryUrl).toBe(
      `https://plain-relay.github.io/kaimono-baton/?openExternalBrowser=1#/l/${encoded}`,
    )
    expect(deliveryUrl.indexOf('?openExternalBrowser=1')).toBeLessThan(
      deliveryUrl.indexOf('#/l/'),
    )
    expect(parsed.hash).toBe(`#/l/${encoded}`)
    expect(parsed.hash.slice('#/l/'.length)).toBe(encoded)
  })

  it('does not duplicate the hint and preserves existing query parameters', () => {
    const once = addLineExternalBrowserHint(
      `https://example.com/otsukai/?source=line&openExternalBrowser=0#/l/${encoded}`,
    )
    const twice = addLineExternalBrowserHint(once)
    const parsed = new URL(twice)

    expect(twice).toBe(once)
    expect(parsed.searchParams.get('source')).toBe('line')
    expect(parsed.searchParams.get(LINE_EXTERNAL_BROWSER_PARAMETER)).toBe('1')
    expect(parsed.searchParams.getAll(LINE_EXTERNAL_BROWSER_PARAMETER)).toEqual(['1'])
    expect(parsed.hash).toBe(`#/l/${encoded}`)
  })

  it('does not encode or alter URL-safe compressed hash characters', () => {
    const rawHash = '#/l/raw+value-$?marker&part'
    const result = addLineExternalBrowserHint(
      `https://example.com/otsukai/${rawHash}`,
    )

    expect(new URL(result).hash).toBe(rawHash)
    expect(result.endsWith(rawHash)).toBe(true)
  })

  it('decodes to the same request and stable IDs with or without the hint', () => {
    const deliveryUrl = buildLineDeliveryRequestUrl(compactUrl)
    const compactDecoded = decodeCompactRequest(
      new URL(compactUrl).hash.slice('#/l/'.length),
    )
    const deliveryDecoded = decodeCompactRequest(
      new URL(deliveryUrl).hash.slice('#/l/'.length),
    )

    expect(deliveryDecoded).toEqual(compactDecoded)
    expect(deliveryDecoded.requestId).toBe('v2-m1234567-abcd')
    expect(deliveryDecoded.items[0].id).toBe(compactDecoded.items[0].id)
    expect(parseHashRoute(new URL(deliveryUrl).hash)).toEqual({
      page: 'list',
      encoded,
      codec: 'compact-path',
    })
  })

  it('preserves a legacy v1 hash route when adding the hint', () => {
    const v1Url = 'https://example.com/otsukai/#/list?data=legacy-data'
    const deliveryUrl = addLineExternalBrowserHint(v1Url)

    expect(new URL(deliveryUrl).hash).toBe('#/list?data=legacy-data')
    expect(parseHashRoute(new URL(deliveryUrl).hash)).toEqual({
      page: 'list',
      encoded: 'legacy-data',
      codec: 'legacy-query',
    })
  })
})
