import { compressToEncodedURIComponent } from 'lz-string'
import {
  MAX_CUSTOM_ITEMS,
  MAX_CUSTOM_ITEM_NAME_CHARS,
  MAX_CUSTOM_ITEM_UNIT_CHARS,
  MAX_HOUSEHOLD_PRODUCTS,
  MAX_ITEM_CONDITION_CHARS,
  MAX_ITEM_QUANTITY,
  MAX_TITLE_CHARS,
  MAX_TOTAL_CONDITION_CHARS,
} from '../constants/requestLimits'
import { categories } from '../data/categories'
import { CATEGORY_IDS_V3 } from '../data/categoryIdsV3'
import { products } from '../data/products'
import { SHARE_PRODUCT_IDS_V2 } from '../data/shareProductIdsV2'
import type { Category, Product } from '../types/product'
import type { ShoppingRequestPayload } from '../types/shopping'
import {
  buildCompactRequestUrl,
  decodeCompactRequestPayload,
  decodeQuantityCode,
  encodeQuantityCode,
} from './compactRequest'
import { isHouseholdProductId } from './householdCatalog'
import type { SelectedRequestItem } from './selectedRequestItems'
import { decodeCompressedRequestJson } from './requestPayloadDecoder'
import { countUserCharacters, truncateUserCharacters } from './textLength'

export type V3BaseItem = [0, number, string, string?]
export type V3SnapshotItem = [
  1,
  string,
  string,
  string,
  string,
  number,
  string?,
]
export type CompactRequestV3 = [
  3,
  string,
  string,
  Array<V3BaseItem | V3SnapshotItem>,
]

export type CompactRequestV3Input = {
  requestKey: string
  title: string
  items: readonly SelectedRequestItem[]
}

const MAX_V3_ITEMS =
  SHARE_PRODUCT_IDS_V2.length + MAX_HOUSEHOLD_PRODUCTS + MAX_CUSTOM_ITEMS
const DEFAULT_REQUEST_TITLE = 'おつかい依頼'
const SNAPSHOT_ICON = '🛒'

function assertTextLimit(value: string, limit: number, label: string) {
  if (countUserCharacters(value) > limit) {
    throw new Error(`${label}が入力上限を超えています。`)
  }
}

function assertSelectedQuantity(quantity: number) {
  if (
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > MAX_ITEM_QUANTITY
  ) {
    throw new Error('数量が入力上限を超えています。')
  }
}

function validateProductId(productId: string) {
  if (
    !productId ||
    productId.length > 128 ||
    (productId.startsWith('household:') && !isHouseholdProductId(productId))
  ) {
    throw new Error('商品IDの形式が正しくありません。')
  }
}

function createV3Item(
  item: SelectedRequestItem,
  baseProductsById: ReadonlyMap<string, Product>,
  baseIndexesById: ReadonlyMap<string, number>,
  categoryIndexesById: ReadonlyMap<string, number>,
): V3BaseItem | V3SnapshotItem {
  const name = item.name.trim()
  const unit = item.unit.trim() || '個'
  const memo = item.memo.trim()
  validateProductId(item.productId)
  if (!name) {
    throw new Error('商品名が必要です。')
  }
  assertTextLimit(name, MAX_CUSTOM_ITEM_NAME_CHARS, '商品名')
  assertTextLimit(unit, MAX_CUSTOM_ITEM_UNIT_CHARS, '商品の単位')
  assertTextLimit(memo, MAX_ITEM_CONDITION_CHARS, '商品の条件')
  assertSelectedQuantity(item.quantity)

  const baseProduct = baseProductsById.get(item.productId)
  const baseIndex = baseIndexesById.get(item.productId)
  const isUnchangedBase =
    baseProduct &&
    typeof baseIndex === 'number' &&
    baseProduct.name === name &&
    baseProduct.unit === unit &&
    baseProduct.categoryId === item.categoryId &&
    !item.hidden

  if (isUnchangedBase) {
    const compact: V3BaseItem = [0, baseIndex, encodeQuantityCode(item.quantity)]
    if (memo) {
      compact.push(memo)
    }
    return compact
  }

  const categoryIndex = categoryIndexesById.get(item.categoryId)
  if (typeof categoryIndex !== 'number') {
    throw new Error('商品のカテゴリが正しくありません。')
  }
  const compact: V3SnapshotItem = [
    1,
    item.productId,
    name,
    encodeQuantityCode(item.quantity),
    unit,
    categoryIndex,
  ]
  if (memo) {
    compact.push(memo)
  }
  return compact
}

export function buildCompactRequestV3Payload(
  input: CompactRequestV3Input,
  baseProducts: readonly Product[] = products,
  categoryList: readonly Category[] = categories,
): CompactRequestV3 {
  const requestKey = input.requestKey.trim()
  const title = input.title.trim() || DEFAULT_REQUEST_TITLE
  if (!requestKey || requestKey.length > 64) {
    throw new Error('依頼キーの形式が正しくありません。')
  }
  assertTextLimit(title, MAX_TITLE_CHARS, '依頼タイトル')
  if (input.items.length > MAX_V3_ITEMS) {
    throw new Error('依頼商品が入力上限を超えています。')
  }

  const categoryIds = new Set(categoryList.map((category) => category.id))
  if (
    CATEGORY_IDS_V3.some((categoryId) => !categoryIds.has(categoryId)) ||
    categoryList.some(
      (category) =>
        !CATEGORY_IDS_V3.includes(
          category.id as (typeof CATEGORY_IDS_V3)[number],
        ),
    )
  ) {
    throw new Error('v3カテゴリ番号表とカテゴリ一覧が一致しません。')
  }

  const baseProductsById = new Map(baseProducts.map((product) => [product.id, product]))
  const baseIndexesById = new Map(
    SHARE_PRODUCT_IDS_V2.map((productId, index) => [productId, index]),
  )
  const categoryIndexesById = new Map(
    CATEGORY_IDS_V3.map((categoryId, index) => [categoryId, index]),
  )
  const seenProductIds = new Set<string>()
  let totalConditionCharacters = 0
  const items = input.items.map((item) => {
    if (seenProductIds.has(item.productId)) {
      throw new Error('同じ商品が重複しています。')
    }
    seenProductIds.add(item.productId)
    totalConditionCharacters += countUserCharacters(item.memo.trim())
    return createV3Item(
      item,
      baseProductsById,
      baseIndexesById,
      categoryIndexesById,
    )
  })
  if (totalConditionCharacters > MAX_TOTAL_CONDITION_CHARS) {
    throw new Error('条件の合計が入力上限を超えています。')
  }
  return [3, requestKey, title, items]
}

export function encodeCompactRequestV3(payload: CompactRequestV3): string {
  return compressToEncodedURIComponent(JSON.stringify(payload))
}

export function buildCompactRequestV3UrlFromInput(
  baseUrl: string,
  input: CompactRequestV3Input,
): string {
  return buildCompactRequestUrl(
    baseUrl,
    encodeCompactRequestV3(buildCompactRequestV3Payload(input)),
  )
}

function getCreatedAt(requestKey: string): string {
  const timestamp = Number.parseInt(requestKey.split('-', 1)[0], 36)
  if (
    !Number.isFinite(timestamp) ||
    timestamp < 0 ||
    timestamp > 8_640_000_000_000_000
  ) {
    return new Date(0).toISOString()
  }
  return new Date(timestamp).toISOString()
}

function decodeMemo(value: unknown): string | undefined {
  if (typeof value === 'undefined') {
    return undefined
  }
  if (
    typeof value !== 'string' ||
    countUserCharacters(value.trim()) > MAX_ITEM_CONDITION_CHARS
  ) {
    throw new Error('v3共有URLの条件データが正しくありません。')
  }
  return value.trim() || undefined
}

export function decodeCompactRequestV3Payload(
  value: unknown,
  baseProducts: readonly Product[] = products,
  categoryList: readonly Category[] = categories,
): ShoppingRequestPayload {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    value[0] !== 3 ||
    typeof value[1] !== 'string' ||
    !value[1].trim() ||
    value[1].length > 64 ||
    typeof value[2] !== 'string' ||
    countUserCharacters(value[2].trim()) > MAX_TITLE_CHARS ||
    !Array.isArray(value[3]) ||
    value[3].length > MAX_V3_ITEMS
  ) {
    throw new Error('v3共有URLの形式が正しくありません。')
  }

  const requestKey = value[1].trim()
  const requestId = `v3-${requestKey}`
  const productsById = new Map(baseProducts.map((product) => [product.id, product]))
  const categoriesById = new Map(categoryList.map((category) => [category.id, category]))
  const seenProductIds = new Set<string>()
  let totalConditionCharacters = 0

  const items = value[3].map((rawItem, itemIndex) => {
    if (!Array.isArray(rawItem) || (rawItem[0] !== 0 && rawItem[0] !== 1)) {
      throw new Error('v3共有URLの商品データが正しくありません。')
    }

    let productId: string
    let name: string
    let unit: string
    let categoryId: string
    let icon: string
    let quantityCode: unknown
    let memoValue: unknown

    if (rawItem[0] === 0) {
      if (
        (rawItem.length !== 3 && rawItem.length !== 4) ||
        !Number.isInteger(rawItem[1]) ||
        (rawItem[1] as number) < 0 ||
        (rawItem[1] as number) >= SHARE_PRODUCT_IDS_V2.length ||
        typeof rawItem[2] !== 'string'
      ) {
        throw new Error('v3共有URLの基準商品データが正しくありません。')
      }
      productId = SHARE_PRODUCT_IDS_V2[rawItem[1] as number]
      const baseProduct = productsById.get(productId)
      if (!baseProduct) {
        throw new Error('v3共有URLの基準商品が見つかりません。')
      }
      name = baseProduct.name
      unit = baseProduct.unit
      categoryId = baseProduct.categoryId
      icon = baseProduct.icon
      quantityCode = rawItem[2]
      memoValue = rawItem[3]
    } else {
      if (
        (rawItem.length !== 6 && rawItem.length !== 7) ||
        typeof rawItem[1] !== 'string' ||
        typeof rawItem[2] !== 'string' ||
        typeof rawItem[3] !== 'string' ||
        typeof rawItem[4] !== 'string' ||
        !Number.isInteger(rawItem[5]) ||
        (rawItem[5] as number) < 0 ||
        (rawItem[5] as number) >= CATEGORY_IDS_V3.length
      ) {
        throw new Error('v3共有URLのスナップショット商品データが正しくありません。')
      }
      productId = rawItem[1]
      name = rawItem[2].trim()
      unit = rawItem[4].trim()
      categoryId = CATEGORY_IDS_V3[rawItem[5] as number]
      icon = SNAPSHOT_ICON
      quantityCode = rawItem[3]
      memoValue = rawItem[6]
      validateProductId(productId)
      if (
        !name ||
        !unit ||
        countUserCharacters(name) > MAX_CUSTOM_ITEM_NAME_CHARS ||
        countUserCharacters(unit) > MAX_CUSTOM_ITEM_UNIT_CHARS
      ) {
        throw new Error('v3共有URLのスナップショット商品データが正しくありません。')
      }
    }

    if (seenProductIds.has(productId)) {
      throw new Error('v3共有URLの商品が重複しています。')
    }
    seenProductIds.add(productId)
    const quantity =
      typeof quantityCode === 'string' ? decodeQuantityCode(quantityCode) : 0
    if (quantity < 1) {
      throw new Error('v3共有URLの数量データが正しくありません。')
    }
    const memo = decodeMemo(memoValue)
    totalConditionCharacters += countUserCharacters(memo ?? '')
    const category = categoriesById.get(categoryId)
    if (!category) {
      throw new Error('v3共有URLのカテゴリが正しくありません。')
    }
    return {
      id: `${requestId}-${itemIndex}`,
      productId,
      productNameSnapshot: name,
      categoryIdSnapshot: categoryId,
      categoryNameSnapshot: category.name,
      quantity,
      unit,
      memo,
      iconSnapshot: icon,
      sortOrderSnapshot: category.sortOrder * 1_000 + itemIndex,
    }
  })

  if (totalConditionCharacters > MAX_TOTAL_CONDITION_CHARS) {
    throw new Error('v3共有URLの条件合計が入力上限を超えています。')
  }

  return {
    requestId,
    title: truncateUserCharacters(
      value[2].trim() || DEFAULT_REQUEST_TITLE,
      MAX_TITLE_CHARS,
    ),
    createdAt: getCreatedAt(requestKey),
    items,
  }
}

export function decodeCompactRequestV3(
  encoded: string,
  baseProducts: readonly Product[] = products,
  categoryList: readonly Category[] = categories,
): ShoppingRequestPayload {
  try {
    return decodeCompactRequestV3Payload(
      decodeCompressedRequestJson(
        encoded,
        'v3共有URLの復元に失敗しました。',
      ),
      baseProducts,
      categoryList,
    )
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'v3共有URLの復元に失敗しました。'
    throw new Error(message)
  }
}

export function decodeCompactRequestV2OrV3(
  encoded: string,
  baseProducts: readonly Product[] = products,
  categoryList: readonly Category[] = categories,
): ShoppingRequestPayload {
  try {
    const value = decodeCompressedRequestJson(
      encoded,
      '共有URLの復元に失敗しました。',
    )
    return Array.isArray(value) && value[0] === 3
      ? decodeCompactRequestV3Payload(value, baseProducts, categoryList)
      : decodeCompactRequestPayload(value, baseProducts, categoryList)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '共有URLの復元に失敗しました。'
    throw new Error(message)
  }
}
