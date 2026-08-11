import { compressToEncodedURIComponent } from 'lz-string'
import { categories } from '../data/categories'
import { products } from '../data/products'
import { PRODUCT_PHOTO_TOKEN_PATTERN } from '../features/productPhotos/photoToken'
import type { Category, Product } from '../types/product'
import type { ShoppingRequestPayload } from '../types/shopping'
import { buildCompactRequestUrl } from './compactRequest'
import {
  buildCompactRequestV3Payload,
  decodeCompactRequestV3Payload,
  type CompactRequestV3Input,
  type V3BaseItem,
  type V3SnapshotItem,
} from './compactRequestV3'
import { decodeCompressedRequestJson } from './requestPayloadDecoder'

export const MAX_V4_PHOTO_REFS = 3

export type CompactPhotoRef = [itemIndex: number, photoToken: string]

export type CompactRequestV4 = [
  4,
  requestKey: string,
  title: string,
  items: Array<V3BaseItem | V3SnapshotItem>,
  photoRefs: CompactPhotoRef[],
]

export type CompactRequestV4Input = CompactRequestV3Input & {
  photoRefs: readonly CompactPhotoRef[]
}

function validatePhotoRefs(
  refs: readonly CompactPhotoRef[],
  itemCount: number,
): CompactPhotoRef[] {
  if (refs.length < 1 || refs.length > MAX_V4_PHOTO_REFS) {
    throw new Error('写真参照は1件から3件までです。')
  }

  const itemIndexes = new Set<number>()
  const tokens = new Set<string>()
  return refs.map((ref) => {
    if (
      !Array.isArray(ref) ||
      ref.length !== 2 ||
      !Number.isInteger(ref[0]) ||
      ref[0] < 0 ||
      ref[0] >= itemCount ||
      typeof ref[1] !== 'string' ||
      !PRODUCT_PHOTO_TOKEN_PATTERN.test(ref[1]) ||
      itemIndexes.has(ref[0]) ||
      tokens.has(ref[1])
    ) {
      throw new Error('写真参照の形式が正しくありません。')
    }
    itemIndexes.add(ref[0])
    tokens.add(ref[1])
    return [ref[0], ref[1]]
  })
}

export function buildCompactRequestV4Payload(
  input: CompactRequestV4Input,
  baseProducts: readonly Product[] = products,
  categoryList: readonly Category[] = categories,
): CompactRequestV4 {
  const v3 = buildCompactRequestV3Payload(
    {
      requestKey: input.requestKey,
      title: input.title,
      items: input.items,
    },
    baseProducts,
    categoryList,
  )
  const photoRefs = validatePhotoRefs(input.photoRefs, v3[3].length)
  return [4, v3[1], v3[2], v3[3], photoRefs]
}

export function encodeCompactRequestV4(payload: CompactRequestV4): string {
  return compressToEncodedURIComponent(JSON.stringify(payload))
}

export function buildCompactRequestV4UrlFromInput(
  baseUrl: string,
  input: CompactRequestV4Input,
): string {
  return buildCompactRequestUrl(
    baseUrl,
    encodeCompactRequestV4(buildCompactRequestV4Payload(input)),
  )
}

function safePhotoRefs(
  value: unknown,
  itemCount: number,
): CompactPhotoRef[] {
  if (!Array.isArray(value) || value.length > MAX_V4_PHOTO_REFS) {
    return []
  }

  const itemIndexes = new Set<number>()
  const tokens = new Set<string>()
  const refs: CompactPhotoRef[] = []
  for (const candidate of value) {
    const candidateIndex = Array.isArray(candidate) ? candidate[0] : undefined
    const candidateToken = Array.isArray(candidate) ? candidate[1] : undefined
    if (
      typeof candidateIndex === 'number' &&
      Number.isInteger(candidateIndex) &&
      typeof candidateToken === 'string' &&
      PRODUCT_PHOTO_TOKEN_PATTERN.test(candidateToken) &&
      (itemIndexes.has(candidateIndex) || tokens.has(candidateToken))
    ) {
      return []
    }
    if (
      !Array.isArray(candidate) ||
      candidate.length !== 2 ||
      !Number.isInteger(candidate[0]) ||
      candidate[0] < 0 ||
      candidate[0] >= itemCount ||
      typeof candidate[1] !== 'string' ||
      !PRODUCT_PHOTO_TOKEN_PATTERN.test(candidate[1]) ||
      itemIndexes.has(candidate[0]) ||
      tokens.has(candidate[1])
    ) {
      continue
    }
    itemIndexes.add(candidate[0])
    tokens.add(candidate[1])
    refs.push([candidate[0], candidate[1]])
  }
  return refs
}

export function decodeCompactRequestV4Payload(
  value: unknown,
  baseProducts: readonly Product[] = products,
  categoryList: readonly Category[] = categories,
): ShoppingRequestPayload {
  if (
    !Array.isArray(value) ||
    (value.length !== 4 && value.length !== 5) ||
    value[0] !== 4
  ) {
    throw new Error('v4共有URLの形式が正しくありません。')
  }

  const v3Payload = decodeCompactRequestV3Payload(
    [3, value[1], value[2], value[3]],
    baseProducts,
    categoryList,
  )
  const requestKey = (value[1] as string).trim()
  const requestId = `v4-${requestKey}`
  const refs = new Map(safePhotoRefs(value[4], v3Payload.items.length))

  return {
    ...v3Payload,
    requestId,
    items: v3Payload.items.map((item, itemIndex) => ({
      ...item,
      id: `${requestId}-${itemIndex}`,
      ...(refs.get(itemIndex)
        ? { photoToken: refs.get(itemIndex) }
        : {}),
    })),
  }
}

export function decodeCompactRequestV4(
  encoded: string,
  baseProducts: readonly Product[] = products,
  categoryList: readonly Category[] = categories,
): ShoppingRequestPayload {
  try {
    return decodeCompactRequestV4Payload(
      decodeCompressedRequestJson(
        encoded,
        'v4共有URLの復元に失敗しました。',
      ),
      baseProducts,
      categoryList,
    )
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'v4共有URLの復元に失敗しました。'
    throw new Error(message)
  }
}
