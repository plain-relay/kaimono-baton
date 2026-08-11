import type {
  CatalogBackupReceipt,
  HouseholdCatalogV1,
} from '../types/householdCatalog'

export type CatalogBackupStatus = 'standard' | 'backed-up' | 'unbacked'

export function canonicalizeCatalogContent(catalog: HouseholdCatalogV1): string {
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
    ])
  return JSON.stringify([1, overrides, addedProducts])
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

export function createCatalogFingerprint(catalog: HouseholdCatalogV1): string {
  return `catalog-v1-${fnv1a64(canonicalizeCatalogContent(catalog))}`
}

export function hasHouseholdCatalogChanges(
  catalog: HouseholdCatalogV1,
): boolean {
  return (
    Object.keys(catalog.overrides).length > 0 ||
    catalog.addedProducts.length > 0
  )
}

export function getCatalogBackupStatus(
  catalog: HouseholdCatalogV1,
  receipt: CatalogBackupReceipt | null,
): CatalogBackupStatus {
  if (!hasHouseholdCatalogChanges(catalog)) {
    return 'standard'
  }
  return receipt?.catalogFingerprint === createCatalogFingerprint(catalog)
    ? 'backed-up'
    : 'unbacked'
}
