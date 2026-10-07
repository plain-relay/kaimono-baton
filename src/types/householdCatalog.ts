import type { Product } from './product'

// Runtime validation accepts legacy V1 without defaultMemo and current V2.
// New catalogs and persistence/export always use V2.
export type HouseholdCatalog = {
  schemaVersion: 1 | 2
  revision: number
  updatedAt: string
  overrides: Record<string, BaseProductOverride>
  addedProducts: HouseholdProduct[]
}

export type BaseProductOverride = {
  name?: string
  unit?: string
  categoryId?: string
  hidden?: boolean
  defaultMemo?: string
}

export type HouseholdProduct = {
  id: string
  name: string
  unit: string
  categoryId: string
  hidden: boolean
  createdAt: string
  updatedAt: string
  defaultMemo?: string
}

export type EffectiveProduct = Product & {
  source: 'base' | 'household'
  hidden: boolean
  isCustomized: boolean
}

export type CatalogBackupReceipt = {
  catalogFingerprint: string
  confirmedAt: string
}

export type CatalogRecoveryPayload = {
  version: 1 | 2
  createdAt: string
  catalog: HouseholdCatalog
}
