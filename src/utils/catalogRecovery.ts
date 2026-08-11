import {
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} from 'lz-string'
import {
  MAX_CATALOG_RECOVERY_JSON_CHARS,
  MAX_CATALOG_RECOVERY_URL_LENGTH,
} from '../constants/requestLimits'
import { categories } from '../data/categories'
import { products } from '../data/products'
import type {
  CatalogRecoveryPayloadV1,
  HouseholdCatalogV1,
} from '../types/householdCatalog'
import type { Category, Product } from '../types/product'
import { createCatalogFingerprint } from './catalogFingerprint'
import {
  hasDangerousObjectKeys,
  normalizeHouseholdCatalog,
} from './householdCatalog'

const RECOVERY_PAYLOAD_KEYS = new Set(['version', 'createdAt', 'catalog'])
const MAX_ENCODED_RECOVERY_CHARS = 50_000

export type CatalogRecoveryBundle = {
  payload: CatalogRecoveryPayloadV1
  encoded: string
  url: string
  urlLength: number
  isWithinUrlLimit: boolean
  json: string
  fileName: string
  fingerprint: string
}

export type CatalogRecoveryPreview = {
  renamed: number
  unitChanged: number
  categoryChanged: number
  hidden: number
  added: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeCreatedAt(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null
  }
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

function parseRecoveryPayloadValue(
  value: unknown,
  baseProducts: readonly Product[] = products,
  categoryList: readonly Category[] = categories,
): CatalogRecoveryPayloadV1 {
  if (
    !isRecord(value) ||
    hasDangerousObjectKeys(value) ||
    Object.keys(value).some((key) => !RECOVERY_PAYLOAD_KEYS.has(key)) ||
    value.version !== 1
  ) {
    throw new Error('商品リスト復旧データの形式が正しくありません。')
  }
  const createdAt = normalizeCreatedAt(value.createdAt)
  const catalog = normalizeHouseholdCatalog(
    value.catalog,
    baseProducts,
    categoryList,
  )
  if (!createdAt || !catalog) {
    throw new Error('商品リスト復旧データの形式が正しくありません。')
  }
  return { version: 1, createdAt, catalog }
}

export function createCatalogRecoveryPayload(
  catalog: HouseholdCatalogV1,
  createdAt = new Date().toISOString(),
  baseProducts: readonly Product[] = products,
  categoryList: readonly Category[] = categories,
): CatalogRecoveryPayloadV1 {
  const normalizedCatalog = normalizeHouseholdCatalog(
    catalog,
    baseProducts,
    categoryList,
  )
  const normalizedCreatedAt = normalizeCreatedAt(createdAt)
  if (!normalizedCatalog || !normalizedCreatedAt) {
    throw new Error('商品リスト復旧データを作成できませんでした。')
  }
  return {
    version: 1,
    createdAt: normalizedCreatedAt,
    catalog: normalizedCatalog,
  }
}

export function encodeCatalogRecoveryPayload(
  payload: CatalogRecoveryPayloadV1,
): string {
  return compressToEncodedURIComponent(JSON.stringify(payload))
}

export function buildCatalogRecoveryUrl(
  baseUrl: string,
  encoded: string,
): string {
  const withoutHash = baseUrl.split('#', 1)[0].replace(/\/$/, '')
  return `${withoutHash}/#/catalog/restore/${encoded}`
}

export function createCatalogRecoveryBundle(
  baseUrl: string,
  catalog: HouseholdCatalogV1,
  createdAt = new Date().toISOString(),
): CatalogRecoveryBundle {
  const payload = createCatalogRecoveryPayload(catalog, createdAt)
  const json = JSON.stringify(payload, null, 2)
  if (json.length > MAX_CATALOG_RECOVERY_JSON_CHARS) {
    throw new Error('商品リスト復旧データが大きすぎます。')
  }
  const encoded = encodeCatalogRecoveryPayload(payload)
  const url = buildCatalogRecoveryUrl(baseUrl, encoded)
  const date = payload.createdAt.slice(0, 10)
  return {
    payload,
    encoded,
    url,
    urlLength: url.length,
    isWithinUrlLimit: url.length <= MAX_CATALOG_RECOVERY_URL_LENGTH,
    json,
    fileName: `kaimono-baton-product-list-${date}.json`,
    fingerprint: createCatalogFingerprint(payload.catalog),
  }
}

export function decodeCatalogRecoveryPayload(
  encoded: string,
  baseProducts: readonly Product[] = products,
  categoryList: readonly Category[] = categories,
): CatalogRecoveryPayloadV1 {
  if (!encoded || encoded.length > MAX_ENCODED_RECOVERY_CHARS) {
    throw new Error('商品リスト復旧データが大きすぎます。')
  }
  const json = decompressFromEncodedURIComponent(encoded)
  if (!json) {
    throw new Error('商品リスト復旧データを復元できませんでした。')
  }
  if (json.length > MAX_CATALOG_RECOVERY_JSON_CHARS) {
    throw new Error('商品リスト復旧データが大きすぎます。')
  }
  try {
    return parseRecoveryPayloadValue(
      JSON.parse(json) as unknown,
      baseProducts,
      categoryList,
    )
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('商品リスト復旧データを復元できませんでした。')
    }
    throw error
  }
}

export function parseCatalogRecoveryJson(
  json: string,
  baseProducts: readonly Product[] = products,
  categoryList: readonly Category[] = categories,
): CatalogRecoveryPayloadV1 {
  if (!json || json.length > MAX_CATALOG_RECOVERY_JSON_CHARS) {
    throw new Error('商品リスト復旧データが大きすぎます。')
  }
  try {
    return parseRecoveryPayloadValue(
      JSON.parse(json) as unknown,
      baseProducts,
      categoryList,
    )
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('商品リスト復旧JSONの形式が正しくありません。')
    }
    throw error
  }
}

export function createCatalogRecoveryPreview(
  payload: CatalogRecoveryPayloadV1,
): CatalogRecoveryPreview {
  const overrides = Object.values(payload.catalog.overrides)
  return {
    renamed: overrides.filter((override) => typeof override.name === 'string')
      .length,
    unitChanged: overrides.filter(
      (override) => typeof override.unit === 'string',
    ).length,
    categoryChanged: overrides.filter(
      (override) => typeof override.categoryId === 'string',
    ).length,
    hidden:
      overrides.filter((override) => override.hidden === true).length +
      payload.catalog.addedProducts.filter((product) => product.hidden).length,
    added: payload.catalog.addedProducts.length,
  }
}

export function isRecoveryPayloadOlderThanCatalog(
  payload: CatalogRecoveryPayloadV1,
  currentCatalog: HouseholdCatalogV1,
): boolean {
  return Date.parse(currentCatalog.updatedAt) > Date.parse(payload.createdAt)
}
