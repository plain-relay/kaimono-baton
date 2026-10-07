import type {
  CatalogBackupReceipt,
  HouseholdCatalog,
} from '../types/householdCatalog'

export type CatalogBackupStatus = 'standard' | 'backed-up' | 'unbacked'

export function canonicalizeCatalogContent(catalog: HouseholdCatalog): string {
  const overrides = Object.keys(catalog.overrides)
    .sort()
    .map((productId) => {
      const override = catalog.overrides[productId]
      return [
        productId,
        override.name ?? null,
        override.unit ?? null,
        override.categoryId ?? null,
        override.hidden ?? null,
        override.defaultMemo ?? null,
      ]
    })
  const addedProducts = [...catalog.addedProducts]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((product) => [
      product.id,
      product.name,
      product.unit,
      product.categoryId,
      product.hidden,
      product.defaultMemo ?? null,
    ])
  return JSON.stringify([2, overrides, addedProducts])
}

function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index))
    hash = (hash * prime) & mask
  }
  return hash.toString(16).padStart(16, '0')
}

export function createCatalogFingerprint(catalog: HouseholdCatalog): string {
  return `catalog-v2-${fnv1a64(canonicalizeCatalogContent(catalog))}`
}

export function hasHouseholdCatalogChanges(
  catalog: HouseholdCatalog,
): boolean {
  return (
    Object.keys(catalog.overrides).length > 0 ||
    catalog.addedProducts.length > 0
  )
}

export function getCatalogBackupStatus(
  catalog: HouseholdCatalog,
  receipt: CatalogBackupReceipt | null,
): CatalogBackupStatus {
  if (!hasHouseholdCatalogChanges(catalog)) {
    return 'standard'
  }
  return receipt?.catalogFingerprint === createCatalogFingerprint(catalog)
    ? 'backed-up'
    : 'unbacked'
}
