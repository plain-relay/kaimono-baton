import { decompressFromEncodedURIComponent } from 'lz-string'

// Public request URLs are limited to 2,200 characters. These decoder limits
// deliberately leave compatibility headroom while bounding compressed input
// and the JSON materialized before parsing.
export const MAX_REQUEST_ENCODED_CHARS = 64_000
export const MAX_REQUEST_JSON_CHARS = 200_000

const OVERSIZED_REQUEST_ERROR = '共有URLデータが大きすぎます。'

export function assertEncodedRequestSize(encoded: string): void {
  if (encoded.length > MAX_REQUEST_ENCODED_CHARS) {
    throw new Error(OVERSIZED_REQUEST_ERROR)
  }
}

export function assertExpandedRequestSize(json: string): void {
  if (json.length > MAX_REQUEST_JSON_CHARS) {
    throw new Error(OVERSIZED_REQUEST_ERROR)
  }
}

export function decodeCompressedRequestJson(
  encoded: string,
  restoreErrorMessage: string,
): unknown {
  assertEncodedRequestSize(encoded)
  const json = decompressFromEncodedURIComponent(encoded)
  if (!json) {
    throw new Error(restoreErrorMessage)
  }
  assertExpandedRequestSize(json)
  return JSON.parse(json) as unknown
}
