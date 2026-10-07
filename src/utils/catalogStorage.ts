import { categories } from '../data/categories'
import { products } from '../data/products'
import type {
  CatalogBackupReceipt,
  HouseholdCatalog,
} from '../types/householdCatalog'
import type { Category, Product } from '../types/product'
import {
  createEmptyHouseholdCatalog,
  hasDangerousObjectKeys,
  normalizeHouseholdCatalog,
} from './householdCatalog'

export const LEGACY_HOUSEHOLD_CATALOG_KEY = 'otsukai:householdCatalog:v1'
export const LEGACY_HOUSEHOLD_CATALOG_PREVIOUS_KEY =
  'otsukai:householdCatalogPrevious:v1'
export const HOUSEHOLD_CATALOG_KEY = 'otsukai:householdCatalog:v2'
export const HOUSEHOLD_CATALOG_PREVIOUS_KEY =
  'otsukai:householdCatalogPrevious:v2'
export const CATALOG_BACKUP_RECEIPT_KEY = 'otsukai:catalogBackupReceipt:v1'

export type CatalogLoadSource = 'current' | 'previous' | 'legacy' | 'default'

export type CatalogLoadResult = {
  catalog: HouseholdCatalog
  source: CatalogLoadSource
  recovered: boolean
}

export type CatalogSaveResult =
  | { ok: true; catalog: HouseholdCatalog }
  | { ok: false; error: Error }

function getDefaultStorage(): Storage {
  return window.localStorage
}

function parseCatalog(
  raw: string | null,
  baseProducts: readonly Product[],
  categoryList: readonly Category[],
  version: 1 | 2 = 2,
): HouseholdCatalog | null {
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    const catalog = normalizeHouseholdCatalog(parsed, baseProducts, categoryList)
    return catalog?.schemaVersion === version ? catalog : null
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
  let v2Readable = true
  try {
    currentRaw = storage.getItem(HOUSEHOLD_CATALOG_KEY)
  } catch {
    v2Readable = false
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
    v2Readable = false
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

  // Legacy tabs only touch V1. Never re-import their edits after V2 exists.
  if (v2Readable && currentRaw === null && previousRaw === null) {
    for (const key of [
      LEGACY_HOUSEHOLD_CATALOG_KEY,
      LEGACY_HOUSEHOLD_CATALOG_PREVIOUS_KEY,
    ]) {
      try {
        const legacy = parseCatalog(
          storage.getItem(key), baseProducts, categoryList, 1,
        )
        if (legacy) {
          return {
            catalog: { ...legacy, schemaVersion: 2 },
            source: 'legacy',
            recovered: key === LEGACY_HOUSEHOLD_CATALOG_PREVIOUS_KEY,
          }
        }
      } catch {
        // Continue to the previous legacy generation when storage is blocked.
      }
    }
  }

  return {
    catalog: createEmptyHouseholdCatalog(now),
    source: 'default',
    recovered: false,
  }
}

export function saveHouseholdCatalog(
  value: HouseholdCatalog,
  storage: Storage = getDefaultStorage(),
  baseProducts: readonly Product[] = products,
  categoryList: readonly Category[] = categories,
): CatalogSaveResult {
  const validated = normalizeHouseholdCatalog(value, baseProducts, categoryList)
  if (!validated) {
    return {
      ok: false,
      error: new Error('商品リストの形式が正しくありません。'),
    }
  }
  const normalized: HouseholdCatalog = { ...validated, schemaVersion: 2 }

  let currentRaw: string | null = null
  let previousRaw: string | null = null
  let writesStarted = false
  try {
    currentRaw = storage.getItem(HOUSEHOLD_CATALOG_KEY)
    previousRaw = storage.getItem(HOUSEHOLD_CATALOG_PREVIOUS_KEY)
    writesStarted = true
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
      // A failed read must never become a deletion of an unknown saved value.
      if (writesStarted) {
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
