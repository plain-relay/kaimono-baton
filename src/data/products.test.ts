import { describe, expect, it } from 'vitest'
import { MAX_SHARE_URL_LENGTH } from '../constants/requestLimits'
import { buildLiveRequestItems } from '../features/liveRequests/createItems'
import {
  buildCompactRequestV3Payload,
  buildCompactRequestV3UrlFromInput,
  decodeCompactRequestV3,
  encodeCompactRequestV3,
} from '../utils/compactRequestV3'
import { createInitialCreateRequestState } from '../utils/createRequestState'
import { buildLineDeliveryRequestUrl } from '../utils/lineDeliveryUrl'
import { categories } from './categories'
import { products } from './products'
import { SHARE_PRODUCT_IDS_V2 } from './shareProductIdsV2'

const addedProductNames = [
  'ベビーチーズ',
  'ラテトリートメント',
  'ウタマロ石けん',
  'サクレ',
  '1歳チーズ',
  'トイレクイックル',
  'ボディクリーム',
  'ケープ',
  '歯磨き粉',
  'ベビー麦茶',
  'ベビー食',
  '紙コップ',
  '冷凍唐揚げ',
  'かまぼこ ピンク',
  '鶏もも肉（2個入り）',
  'チョコレートジャム',
  'ベビーフード',
]

function getAddedProducts() {
  return addedProductNames.map((name) => {
    const product = products.find((candidate) => candidate.name === name)
    expect(product, `Missing master product: ${name}`).toBeDefined()
    return product!
  })
}

describe('previously one-time products', () => {
  it('adds every supplied name once without merging similar products', () => {
    expect(getAddedProducts()).toHaveLength(17)
    expect(new Set(products.map((product) => product.id)).size).toBe(products.length)
    for (const name of addedProductNames) {
      expect(products.filter((product) => product.name === name)).toHaveLength(1)
    }
    for (const product of getAddedProducts()) {
      expect(categories.some((category) => category.id === product.categoryId)).toBe(true)
      expect(product.defaultQuantity).toBe(1)
      expect(product.memo).toBeUndefined()
      expect(product.unit).not.toBe('')
    }
  })

  it('initializes added products as unselected without changing an existing draft', () => {
    const { draft } = createInitialCreateRequestState(
      { milk: { quantity: 2, memo: '今回の条件' } },
      products,
    )
    expect(draft.milk).toEqual({ quantity: 2, memo: '今回の条件' })
    for (const product of getAddedProducts()) {
      expect(draft[product.id]).toEqual({ quantity: 0, memo: '' })
    }
  })

  it('shares all additions as v3 snapshots readable with the pre-update master', () => {
    const items = getAddedProducts().map((product) => ({
      ...product,
      productId: product.id,
      quantity: 1,
      memo: '',
      hidden: false,
    }))
    const input = { requestKey: 'master-additions-test', title: 'おつかいリスト', items }
    const payload = buildCompactRequestV3Payload(input)
    expect(payload[3]).toHaveLength(17)
    expect(payload[3].every((item) => item[0] === 1)).toBe(true)

    const publishedIds = new Set<string>(SHARE_PRODUCT_IDS_V2)
    const previousMaster = products.filter((product) => publishedIds.has(product.id))
    expect(previousMaster).toHaveLength(93)
    const decoded = decodeCompactRequestV3(encodeCompactRequestV3(payload), previousMaster)
    expect(decoded.items).toMatchObject(items.map((item) => ({
      productId: item.productId,
      productNameSnapshot: item.name,
      categoryIdSnapshot: item.categoryId,
      unit: item.unit,
      quantity: item.quantity,
    })))

    const deliveryUrl = buildLineDeliveryRequestUrl(
      buildCompactRequestV3UrlFromInput('https://example.com/', input),
    )
    expect(deliveryUrl.length).toBeLessThanOrEqual(MAX_SHARE_URL_LENGTH)

    let itemNumber = 0
    const liveItems = buildLiveRequestItems(items, [], () => `item-${itemNumber++}`)
    expect(liveItems).toHaveLength(17)
    expect(liveItems.map((item) => item.productNameSnapshot)).toEqual(addedProductNames)
    expect(liveItems.every((item) => !item.productId.startsWith('custom:'))).toBe(true)
  })
})

describe('meat product defaults', () => {
  it('keeps the established product metadata and defaults both meat conditions to domestic', () => {
    expect(products.find((product) => product.id === 'pork-koma')).toEqual({
      id: 'pork-koma',
      name: '豚小間肉',
      categoryId: 'meat',
      defaultQuantity: 3,
      unit: 'パック',
      memo: '国産',
      icon: '🥩',
      sortOrder: 401,
    })
    expect(products.find((product) => product.id === 'ground-chicken')).toEqual({
      id: 'ground-chicken',
      name: 'とりひき肉',
      categoryId: 'meat',
      defaultQuantity: 1,
      unit: 'パック',
      memo: '国産',
      icon: '🍗',
      sortOrder: 402,
    })
  })

  it('places the domestic condition in a new request draft without selecting either product', () => {
    const { draft } = createInitialCreateRequestState(undefined, products)

    expect(draft['pork-koma']).toEqual({ quantity: 0, memo: '国産' })
    expect(draft['ground-chicken']).toEqual({ quantity: 0, memo: '国産' })
  })
})
