import { useMemo, useState } from 'react'
import { products } from '../data/products'
import type {
  CatalogRecoveryPayloadV1,
  HouseholdCatalogV1,
} from '../types/householdCatalog'
import {
  loadCatalogBackupReceipt,
  loadHouseholdCatalog,
  saveCatalogBackupReceipt,
  saveHouseholdCatalog,
} from '../utils/catalogStorage'
import {
  createCatalogFingerprint,
  getCatalogBackupStatus,
} from '../utils/catalogFingerprint'
import {
  buildAllEffectiveProductCatalog,
  buildEffectiveProductCatalog,
} from '../utils/householdCatalog'

export function useHouseholdCatalog() {
  const [catalog, setCatalog] = useState(
    () => loadHouseholdCatalog().catalog,
  )
  const [backupReceipt, setBackupReceipt] = useState(
    loadCatalogBackupReceipt,
  )
  const effectiveProducts = useMemo(
    () => buildAllEffectiveProductCatalog(products, catalog),
    [catalog],
  )
  const visibleProducts = useMemo(
    () => buildEffectiveProductCatalog(products, catalog),
    [catalog],
  )
  const backupStatus = useMemo(
    () => getCatalogBackupStatus(catalog, backupReceipt),
    [backupReceipt, catalog],
  )

  const updateCatalog = (nextCatalog: HouseholdCatalogV1): boolean => {
    const result = saveHouseholdCatalog(nextCatalog)
    if (!result.ok) {
      return false
    }
    setCatalog(result.catalog)
    return true
  }

  const confirmCatalogBackup = (
    catalogFingerprint = createCatalogFingerprint(catalog),
    confirmedAt = new Date().toISOString(),
  ): boolean => {
    const receipt = { catalogFingerprint, confirmedAt }
    if (!saveCatalogBackupReceipt(receipt)) {
      return false
    }
    setBackupReceipt(receipt)
    return true
  }

  const replaceCatalogFromRecovery = (
    payload: CatalogRecoveryPayloadV1,
  ): boolean => {
    const result = saveHouseholdCatalog(payload.catalog)
    if (!result.ok) {
      return false
    }
    setCatalog(result.catalog)
    confirmCatalogBackup(createCatalogFingerprint(result.catalog))
    return true
  }

  return {
    catalog,
    effectiveProducts,
    visibleProducts,
    backupStatus,
    updateCatalog,
    confirmCatalogBackup,
    replaceCatalogFromRecovery,
  }
}
