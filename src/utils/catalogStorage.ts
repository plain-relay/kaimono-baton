import { categories } from '../data/categories'
import { products } from '../data/products'
import type {
  CatalogBackupReceipt,
  HouseholdCatalogV1,
} from '../types/householdCatalog'
import type { Category, Product } from '../types/product'
import {
  createEmptyHouseholdCatalog,
  hasDangerousObjectKeys,
  normalizeHouseholdCatalog,
} from './householdCatalog'

export const HOUSEHOLD_CATALOG_KEY = 'otsukai:householdCatalog:v1'
export const HOUSEHOLD_CATALOG_PREVIOUS_KEY =
  'otsukai:householdCatalogPrevious:v1'
export const CATALOG_BACKUP_RECEIPT_KEY = 'otsukai:catalogBackupReceipt:v1'

export type CatalogLoadSource = 'current' | 'previous' | 'default'

export type CatalogLoadResult = {
  catalog: HouseholdCatalogV1
  source: CatalogLoadSource
  recovered: boolean
}

export type CatalogSaveResult =
  | { ok: true; catalog: HouseholdCatalogV1 }
  | { ok: false; error: Error }

function getDefaultStorage(): Storage {
  return window.localStorage
}

function parseCatalog(
  raw: string | null,
  baseProducts: readonly Product[],
  categoryList: readonly Category[],
): HouseholdCatalogV1 | null {
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    return normalizeHouseholdCatalog(parsed, baseProducts, categoryList)
  } catch {
    return null
  }
}

export function loadHouseholdCatalog(
  storage: Storage = getDefaultStorage(),
  baseProducts: readonly Product[] = products,
  categoryList: readonly Category[] = categories,
  now = new Date().toISOString(),
): CatalogLoadResult {
  let currentRaw: string | null = null
  try {
    currentRaw = storage.getItem(HOUSEHOLD_CATALOG_KEY)
  } catch {
    // A storage implementation can fail for one key while another remains
    // readable, so continue to the previous generation.
  }

  const current = parseCatalog(currentRaw, baseProducts, categoryList)
  if (current) {
    return { catalog: current, source: 'current', recovered: false }
  }

  let previousRaw: string | null = null
  try {
    previousRaw = storage.getItem(HOUSEHOLD_CATALOG_PREVIOUS_KEY)
  } catch {
    // Fall through to the base catalog when neither generation is readable.
  }
  const previous = parseCatalog(previousRaw, baseProducts, categoryList)
  if (previous) {
    try {
      storage.setItem(HOUSEHOLD_CATALOG_KEY, JSON.stringify(previous))
    } catch {
      // The validated previous value is still safe for this session.
    }
    return { catalog: previous, source: 'previous', recovered: true }
  }

  return {
    catalog: createEmptyHouseholdCatalog(now),
    source: 'default',
    recovered: false,
  }
}

export function saveHouseholdCatalog(
  value: HouseholdCatalogV1,
  storage: Storage = getDefaultStorage(),
  baseProducts: readonly Product[] = products,
  categoryList: readonly Category[] = categories,
): CatalogSaveResult {
  const normalized = normalizeHouseholdCatalog(value, baseProducts, categoryList)
  if (!normalized) {
    return {
      ok: false,
      error: new Error('商品リストの形式が正しくありません。'),
    }
  }

  let currentRaw: string | null = null
  let previousRaw: string | null = null
  try {
    currentRaw = storage.getItem(HOUSEHOLD_CATALOG_KEY)
    previousRaw = storage.getItem(HOUSEHOLD_CATALOG_PREVIOUS_KEY)
    if (currentRaw !== null) {
      storage.setItem(HOUSEHOLD_CATALOG_PREVIOUS_KEY, currentRaw)
    }
    storage.setItem(HOUSEHOLD_CATALOG_KEY, JSON.stringify(normalized))

    const verified = parseCatalog(
      storage.getItem(HOUSEHOLD_CATALOG_KEY),
      baseProducts,
      categoryList,
    )
    if (!verified || JSON.stringify(verified) !== JSON.stringify(normalized)) {
      throw new Error('保存した商品リストを確認できませんでした。')
    }
    return { ok: true, catalog: verified }
  } catch (error) {
    try {
      if (currentRaw === null) {
        storage.removeItem(HOUSEHOLD_CATALOG_KEY)
      } else {
        storage.setItem(HOUSEHOLD_CATALOG_KEY, currentRaw)
      }
      if (previousRaw === null) {
        storage.removeItem(HOUSEHOLD_CATALOG_PREVIOUS_KEY)
      } else {
        storage.setItem(HOUSEHOLD_CATALOG_PREVIOUS_KEY, previousRaw)
      }
    } catch {
      // Preserve the original failure; callers must not update screen state.
    }
    return {
      ok: false,
      error:
        error instanceof Error
          ? error
          : new Error('商品リストを保存できませんでした。'),
    }
  }
}

function normalizeBackupReceipt(value: unknown): CatalogBackupReceipt | null {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    hasDangerousObjectKeys(value)
  ) {
    return null
  }
  const receipt = value as Record<string, unknown>
  if (
    Object.keys(receipt).some(
      (key) => key !== 'catalogFingerprint' && key !== 'confirmedAt',
    ) ||
    typeof receipt.catalogFingerprint !== 'string' ||
    !receipt.catalogFingerprint ||
    typeof receipt.confirmedAt !== 'string' ||
    !Number.isFinite(Date.parse(receipt.confirmedAt))
  ) {
    return null
  }
  return {
    catalogFingerprint: receipt.catalogFingerprint,
    confirmedAt: new Date(receipt.confirmedAt).toISOString(),
  }
}

export function loadCatalogBackupReceipt(
  storage: Storage = getDefaultStorage(),
): CatalogBackupReceipt | null {
  try {
    const raw = storage.getItem(CATALOG_BACKUP_RECEIPT_KEY)
    return raw
      ? normalizeBackupReceipt(JSON.parse(raw) as unknown)
      : null
  } catch {
    return null
  }
}

export function saveCatalogBackupReceipt(
  receipt: CatalogBackupReceipt,
  storage: Storage = getDefaultStorage(),
): boolean {
  const normalized = normalizeBackupReceipt(receipt)
  if (!normalized) {
    return false
  }
  try {
    storage.setItem(CATALOG_BACKUP_RECEIPT_KEY, JSON.stringify(normalized))
    const raw = storage.getItem(CATALOG_BACKUP_RECEIPT_KEY)
    return Boolean(
      raw &&
        JSON.stringify(normalizeBackupReceipt(JSON.parse(raw) as unknown)) ===
          JSON.stringify(normalized),
    )
  } catch {
    return false
  }
}
