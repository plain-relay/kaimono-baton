import type { Product } from './product'

export type HouseholdCatalogV1 = {
  schemaVersion: 1
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
}

export type HouseholdProduct = {
  id: string
  name: string
  unit: string
  categoryId: string
  hidden: boolean
  createdAt: string
  updatedAt: string
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

export type CatalogRecoveryPayloadV1 = {
  version: 1
  createdAt: string
  catalog: HouseholdCatalogV1
}
