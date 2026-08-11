import { compressToEncodedURIComponent } from 'lz-string'
import {
  MAX_CUSTOM_ITEMS,
  MAX_CUSTOM_ITEM_NAME_CHARS,
  MAX_CUSTOM_ITEM_UNIT_CHARS,
  MAX_ITEM_CONDITION_CHARS,
  MAX_ITEM_QUANTITY,
  MAX_TITLE_CHARS,
  MAX_TOTAL_CONDITION_CHARS,
} from '../constants/requestLimits'
import { categories } from '../data/categories'
import { products } from '../data/products'
import { SHARE_PRODUCT_IDS_V2 } from '../data/shareProductIdsV2'
import type { Category, Product } from '../types/product'
import type { CreateDraftState, ShoppingRequestPayload } from '../types/shopping'
import { decodeCompressedRequestJson } from './requestPayloadDecoder'
import { countUserCharacters, truncateUserCharacters } from './textLength'

const QUANTITY_CODES = '0123456789abcdefghijk'
const DEFAULT_REQUEST_TITLE = 'おつかい依頼'
const DEFAULT_CUSTOM_UNIT = '個'
const OTHER_CATEGORY_ID = 'other'
const OTHER_CATEGORY_NAME = 'その他'
const CUSTOM_ITEM_SORT_ORDER = 10000

export type CompactConditionData =
  | 0
  | [0, ...string[]]
  | [1, ...Array<[number, string]>]

export type CompactCustomItem = [string, string, string?, string?]

export type CompactRequestV2 = [
  2,
  string,
  string,
  string,
  CompactConditionData,
  CompactCustomItem[]?,
]

export type CompactCustomItemInput = {
  name: string
  quantity: number
  unit: string
  memo: string
}
export type CompactRequestInput = {
  requestKey: string
  title: string
  draft: CreateDraftState
  customItems: readonly CompactCustomItemInput[]
}

function assertTextLimit(value: string, limit: number, label: string) {
  if (countUserCharacters(value) > limit) {
    throw new Error(`${label}が入力上限を超えています。`)
  }
}

function assertRegularQuantity(quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > MAX_ITEM_QUANTITY) {
    throw new Error('数量が入力上限を超えています。')
  }
}

function assertCustomQuantity(quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_ITEM_QUANTITY) {
    throw new Error('自由追加商品の数量が入力上限を超えています。')
  }
}

export function encodeQuantityCode(quantity: number): string {
  assertRegularQuantity(quantity)
  return QUANTITY_CODES[quantity]
}

export function decodeQuantityCode(code: string): number {
  if (code.length !== 1) {
    return 0
  }

  const quantity = QUANTITY_CODES.indexOf(code)
  return quantity >= 0 && quantity <= MAX_ITEM_QUANTITY ? quantity : 0
}

export function createRequestKey(
  now = Date.now(),
  random = Math.random(),
): string {
  const safeTime = Number.isFinite(now) && now >= 0 ? Math.floor(now) : 0
  const safeRandom = Number.isFinite(random)
    ? Math.min(Math.max(random, 0), 0.999999999999)
    : 0
  const timePart = safeTime.toString(36).padStart(8, '0')
  const randomPart = Math.floor(safeRandom * 36 ** 4)
    .toString(36)
    .padStart(4, '0')
  return `${timePart}-${randomPart}`
}

function trimTrailingEmptyValues(values: string[]): string[] {
  let end = values.length
  while (end > 0 && values[end - 1] === '') {
    end -= 1
  }
  return values.slice(0, end)
}

function compressedJsonLength(value: unknown): number {
  return compressToEncodedURIComponent(JSON.stringify(value)).length
}

export function chooseCompactConditionData(
  conditions: ReadonlyMap<number, string>,
): CompactConditionData {
  if (conditions.size === 0) {
    return 0
  }

  const lastIndex = Math.max(...conditions.keys())
  const denseValues = Array.from({ length: lastIndex + 1 }, (_, index) =>
    conditions.get(index) ?? '',
  )
  const dense: CompactConditionData = [0, ...trimTrailingEmptyValues(denseValues)]
  const sparsePairs = [...conditions.entries()].sort(([left], [right]) => left - right)
  const sparse: CompactConditionData = [1, ...sparsePairs]

  return compressedJsonLength(dense) <= compressedJsonLength(sparse) ? dense : sparse
}

export function getCompactConditionMode(
  data: CompactConditionData,
): 'none' | 'dense' | 'sparse' {
  if (data === 0) {
    return 'none'
  }
  return data[0] === 0 ? 'dense' : 'sparse'
}

function encodeCustomItem(item: CompactCustomItemInput): CompactCustomItem {
  const name = item.name.trim()
  const unit = item.unit.trim() || DEFAULT_CUSTOM_UNIT
  const memo = item.memo.trim()

  if (!name) {
    throw new Error('自由追加商品には商品名が必要です。')
  }
  assertTextLimit(name, MAX_CUSTOM_ITEM_NAME_CHARS, '自由追加商品名')
  assertTextLimit(unit, MAX_CUSTOM_ITEM_UNIT_CHARS, '自由追加商品の単位')
  assertTextLimit(memo, MAX_ITEM_CONDITION_CHARS, '自由追加商品の条件')
  assertCustomQuantity(item.quantity)

  const encoded: CompactCustomItem = [name, encodeQuantityCode(item.quantity)]
  if (unit !== DEFAULT_CUSTOM_UNIT || memo) {
    encoded.push(unit === DEFAULT_CUSTOM_UNIT ? '' : unit)
  }
  if (memo) {
    encoded.push(memo)
  }
  return encoded
}

export function buildCompactRequestPayload(input: CompactRequestInput): CompactRequestV2 {
  const requestKey = input.requestKey.trim()
  const title = input.title.trim() || DEFAULT_REQUEST_TITLE

  if (!requestKey || requestKey.length > 64) {
    throw new Error('依頼キーの形式が正しくありません。')
  }
  assertTextLimit(title, MAX_TITLE_CHARS, '依頼タイトル')
  if (input.customItems.length > MAX_CUSTOM_ITEMS) {
    throw new Error('自由追加商品が入力上限を超えています。')
  }

  const quantityCodes: string[] = []
  const conditions = new Map<number, string>()
  let totalConditionCharacters = 0

  SHARE_PRODUCT_IDS_V2.forEach((productId, productIndex) => {
    const item = input.draft[productId]
    const quantity = item?.quantity ?? 0
    assertRegularQuantity(quantity)
    quantityCodes.push(encodeQuantityCode(quantity))

    const memo = item?.memo.trim() ?? ''
    assertTextLimit(memo, MAX_ITEM_CONDITION_CHARS, '商品の条件')
    if (quantity > 0 && memo) {
      conditions.set(productIndex, memo)
      totalConditionCharacters += countUserCharacters(memo)
    }
  })

  while (quantityCodes.at(-1) === '0') {
    quantityCodes.pop()
  }

  const customItems = input.customItems.map((item) => {
    const encoded = encodeCustomItem(item)
    totalConditionCharacters += countUserCharacters(item.memo.trim())
    return encoded
  })

  if (totalConditionCharacters > MAX_TOTAL_CONDITION_CHARS) {
    throw new Error('条件の合計が入力上限を超えています。')
  }

  const payload: CompactRequestV2 = [
    2,
    requestKey,
    title,
    quantityCodes.join(''),
    chooseCompactConditionData(conditions),
  ]
  if (customItems.length > 0) {
    payload.push(customItems)
  }
  return payload
}

export function encodeCompactRequest(payload: CompactRequestV2): string {
  return compressToEncodedURIComponent(JSON.stringify(payload))
}

export function buildCompactRequestUrl(baseUrl: string, encoded: string): string {
  const withoutHash = baseUrl.split('#', 1)[0].replace(/\/$/, '')
  return withoutHash.includes('?')
    ? `${withoutHash}#/l/${encoded}`
    : `${withoutHash}/#/l/${encoded}`
}

export function buildCompactRequestUrlFromInput(
  baseUrl: string,
  input: CompactRequestInput,
): string {
  return buildCompactRequestUrl(baseUrl, encodeCompactRequest(buildCompactRequestPayload(input)))
}

function decodeConditionData(value: unknown): Map<number, string> {
  const conditions = new Map<number, string>()
  if (value === 0) {
    return conditions
  }
  if (!Array.isArray(value) || (value[0] !== 0 && value[0] !== 1)) {
    throw new Error('v2共有URLの条件データが正しくありません。')
  }

  if (value[0] === 0) {
    value.slice(1).forEach((condition, index) => {
      if (typeof condition !== 'string') {
        throw new Error('v2共有URLの条件データが正しくありません。')
      }
      if (condition) {
        conditions.set(index, truncateUserCharacters(condition, MAX_ITEM_CONDITION_CHARS))
      }
    })
    return conditions
  }

  for (const pair of value.slice(1)) {
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      !Number.isInteger(pair[0]) ||
      pair[0] < 0 ||
      typeof pair[1] !== 'string'
    ) {
      throw new Error('v2共有URLの条件データが正しくありません。')
    }
    if (pair[1]) {
      conditions.set(pair[0], truncateUserCharacters(pair[1], MAX_ITEM_CONDITION_CHARS))
    }
  }
  return conditions
}

function getCreatedAt(requestKey: string): string {
  const timestamp = Number.parseInt(requestKey.split('-', 1)[0], 36)
  if (!Number.isFinite(timestamp) || timestamp < 0 || timestamp > 8_640_000_000_000_000) {
    return new Date(0).toISOString()
  }
  return new Date(timestamp).toISOString()
}

function createFallbackProduct(productId: string, productIndex: number): Product {
  return {
    id: productId,
    name: `不明な商品 (${productId})`,
    categoryId: OTHER_CATEGORY_ID,
    defaultQuantity: 1,
    unit: DEFAULT_CUSTOM_UNIT,
    icon: '❓',
    sortOrder: CUSTOM_ITEM_SORT_ORDER + productIndex,
  }
}

function decodeCustomItems(value: unknown, requestId: string) {
  if (typeof value === 'undefined') {
    return []
  }
  if (!Array.isArray(value) || value.length > MAX_CUSTOM_ITEMS) {
    throw new Error('v2共有URLの自由追加商品データが正しくありません。')
  }

  return value.map((rawItem, customIndex) => {
    if (
      !Array.isArray(rawItem) ||
      rawItem.length < 2 ||
      rawItem.length > 4 ||
      typeof rawItem[0] !== 'string' ||
      typeof rawItem[1] !== 'string' ||
      (typeof rawItem[2] !== 'undefined' && typeof rawItem[2] !== 'string') ||
      (typeof rawItem[3] !== 'undefined' && typeof rawItem[3] !== 'string')
    ) {
      throw new Error('v2共有URLの自由追加商品データが正しくありません。')
    }

    const name = truncateUserCharacters(rawItem[0].trim(), MAX_CUSTOM_ITEM_NAME_CHARS)
    const quantity = decodeQuantityCode(rawItem[1])
    const unit = truncateUserCharacters(
      rawItem[2]?.trim() || DEFAULT_CUSTOM_UNIT,
      MAX_CUSTOM_ITEM_UNIT_CHARS,
    )
    const memo = truncateUserCharacters(rawItem[3]?.trim() ?? '', MAX_ITEM_CONDITION_CHARS)
    if (!name || quantity < 1) {
      throw new Error('v2共有URLの自由追加商品データが正しくありません。')
    }

    return {
      id: `${requestId}-custom-${customIndex}`,
      productId: `custom:${customIndex}`,
      productNameSnapshot: name,
      categoryIdSnapshot: OTHER_CATEGORY_ID,
      categoryNameSnapshot: OTHER_CATEGORY_NAME,
      quantity,
      unit,
      memo: memo || undefined,
      iconSnapshot: '🛒',
      sortOrderSnapshot: CUSTOM_ITEM_SORT_ORDER + customIndex,
    }
  })
}

export function decodeCompactRequestPayload(
  value: unknown,
  productList: readonly Product[] = products,
  categoryList: readonly Category[] = categories,
): ShoppingRequestPayload {
  if (!Array.isArray(value) || value.length < 5 || value.length > 6) {
    throw new Error('v2共有URLの形式が正しくありません。')
  }
  if (value[0] !== 2) {
    throw new Error('対応していない共有URLのバージョンです。')
  }

  const [, requestKeyValue, titleValue, quantityCodesValue, conditionData, customData] = value
  if (
    typeof requestKeyValue !== 'string' ||
    !requestKeyValue.trim() ||
    requestKeyValue.trim().length > 64 ||
    typeof titleValue !== 'string' ||
    typeof quantityCodesValue !== 'string'
  ) {
    throw new Error('v2共有URLの形式が正しくありません。')
  }

  const requestKey = requestKeyValue.trim()
  const requestId = `v2-${requestKey}`
  const conditions = decodeConditionData(conditionData)
  const productsById = new Map(productList.map((product) => [product.id, product]))
  const categoriesById = new Map(categoryList.map((category) => [category.id, category]))
  const items = []

  for (
    let productIndex = 0;
    productIndex < Math.min(quantityCodesValue.length, SHARE_PRODUCT_IDS_V2.length);
    productIndex += 1
  ) {
    const quantity = decodeQuantityCode(quantityCodesValue[productIndex])
    if (quantity === 0) {
      continue
    }

    const productId = SHARE_PRODUCT_IDS_V2[productIndex]
    const product = productsById.get(productId) ?? createFallbackProduct(productId, productIndex)
    const category = categoriesById.get(product.categoryId)
    const memo = conditions.get(productIndex)?.trim() ?? ''
    items.push({
      id: `${requestId}-${productIndex}`,
      productId,
      productNameSnapshot: product.name,
      categoryIdSnapshot: product.categoryId,
      categoryNameSnapshot: category?.name ?? OTHER_CATEGORY_NAME,
      quantity,
      unit: product.unit,
      memo: memo || undefined,
      iconSnapshot: product.icon,
      sortOrderSnapshot: product.sortOrder,
    })
  }

  items.push(...decodeCustomItems(customData, requestId))
  const totalConditionCharacters = items.reduce(
    (total, item) =>
      total + countUserCharacters(item.memo?.trim() ?? ''),
    0,
  )
  if (totalConditionCharacters > MAX_TOTAL_CONDITION_CHARS) {
    throw new Error('v2共有URLの条件合計が入力上限を超えています。')
  }

  return {
    requestId,
    title: truncateUserCharacters(titleValue.trim() || DEFAULT_REQUEST_TITLE, MAX_TITLE_CHARS),
    createdAt: getCreatedAt(requestKey),
    items,
  }
}

export function decodeCompactRequest(
  encoded: string,
  productList: readonly Product[] = products,
  categoryList: readonly Category[] = categories,
): ShoppingRequestPayload {
  try {
    return decodeCompactRequestPayload(
      decodeCompressedRequestJson(
        encoded,
        'v2共有URLの復元に失敗しました。',
      ),
      productList,
      categoryList,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'v2共有URLの復元に失敗しました。'
    throw new Error(message)
  }
}
