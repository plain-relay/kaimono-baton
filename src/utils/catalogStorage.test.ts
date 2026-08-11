import { describe, expect, it } from 'vitest'
import {
  CATALOG_BACKUP_RECEIPT_KEY,
  HOUSEHOLD_CATALOG_KEY,
  HOUSEHOLD_CATALOG_PREVIOUS_KEY,
  loadCatalogBackupReceipt,
  loadHouseholdCatalog,
  saveCatalogBackupReceipt,
  saveHouseholdCatalog,
} from './catalogStorage'
import {
  createEmptyHouseholdCatalog,
  updateBaseProduct,
} from './householdCatalog'

const NOW = '2026-07-26T00:00:00.000Z'

class MemoryStorage implements Storage {
  protected values = new Map<string, string>()

  get length() {
    return this.values.size
  }

  clear() {
    this.values.clear()
  }

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string) {
    this.values.delete(key)
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

class FailOnceStorage extends MemoryStorage {
  failNextCurrentWrite = false

  override setItem(key: string, value: string) {
    if (key === HOUSEHOLD_CATALOG_KEY && this.failNextCurrentWrite) {
      this.failNextCurrentWrite = false
      throw new Error('quota')
    }
    super.setItem(key, value)
  }
}

describe('household catalog storage', () => {
  it('saves the current catalog, preserves the previous generation, and verifies the write', () => {
    const storage = new MemoryStorage()
    const empty = createEmptyHouseholdCatalog(NOW)
    expect(saveHouseholdCatalog(empty, storage)).toMatchObject({ ok: true })

    const changed = updateBaseProduct(
      empty,
      'milk',
      {
        name: 'いつもの牛乳',
        unit: '本',
        categoryId: 'eggs-dairy',
        hidden: false,
      },
      '2026-07-26T01:00:00.000Z',
    )
    const result = saveHouseholdCatalog(changed, storage)
    expect(result).toMatchObject({ ok: true, catalog: changed })
    expect(
      JSON.parse(storage.getItem(HOUSEHOLD_CATALOG_PREVIOUS_KEY) ?? ''),
    ).toEqual(empty)
    expect(loadHouseholdCatalog(storage)).toEqual({
      catalog: changed,
      source: 'current',
      recovered: false,
    })
  })

  it('restores a valid previous generation when the current value is corrupt', () => {
    const storage = new MemoryStorage()
    const previous = createEmptyHouseholdCatalog(NOW)
    storage.setItem(HOUSEHOLD_CATALOG_KEY, '{broken')
    storage.setItem(
      HOUSEHOLD_CATALOG_PREVIOUS_KEY,
      JSON.stringify(previous),
    )

    expect(loadHouseholdCatalog(storage)).toEqual({
      catalog: previous,
      source: 'previous',
      recovered: true,
    })
    expect(JSON.parse(storage.getItem(HOUSEHOLD_CATALOG_KEY) ?? '')).toEqual(
      previous,
    )
  })

  it('uses whichever valid generation can still be read when one key throws', () => {
    const current = createEmptyHouseholdCatalog(NOW)
    const previous = updateBaseProduct(
      current,
      'milk',
      {
        name: '以前の牛乳',
        unit: '本',
        categoryId: 'eggs-dairy',
        hidden: false,
      },
      '2026-07-25T00:00:00.000Z',
    )

    const currentReadable = new MemoryStorage()
    currentReadable.setItem(HOUSEHOLD_CATALOG_KEY, JSON.stringify(current))
    currentReadable.setItem(
      HOUSEHOLD_CATALOG_PREVIOUS_KEY,
      JSON.stringify(previous),
    )
    const currentGet = currentReadable.getItem.bind(currentReadable)
    currentReadable.getItem = (key: string) => {
      if (key === HOUSEHOLD_CATALOG_PREVIOUS_KEY) {
        throw new DOMException('blocked', 'SecurityError')
      }
      return currentGet(key)
    }
    expect(loadHouseholdCatalog(currentReadable)).toEqual({
      catalog: current,
      source: 'current',
      recovered: false,
    })

    const previousReadable = new MemoryStorage()
    previousReadable.setItem(HOUSEHOLD_CATALOG_KEY, JSON.stringify(current))
    previousReadable.setItem(
      HOUSEHOLD_CATALOG_PREVIOUS_KEY,
      JSON.stringify(previous),
    )
    const previousGet = previousReadable.getItem.bind(previousReadable)
    previousReadable.getItem = (key: string) => {
      if (key === HOUSEHOLD_CATALOG_KEY) {
        throw new DOMException('blocked', 'SecurityError')
      }
      return previousGet(key)
    }
    expect(loadHouseholdCatalog(previousReadable)).toEqual({
      catalog: previous,
      source: 'previous',
      recovered: true,
    })
  })

  it('falls back to the base catalog when both generations are absent or invalid', () => {
    const storage = new MemoryStorage()
    storage.setItem(
      HOUSEHOLD_CATALOG_KEY,
      JSON.stringify({ schemaVersion: 2 }),
    )
    storage.setItem(
      HOUSEHOLD_CATALOG_PREVIOUS_KEY,
      JSON.stringify({
        ...createEmptyHouseholdCatalog(NOW),
        overrides: { milk: { categoryId: 'unknown' } },
      }),
    )
    expect(loadHouseholdCatalog(storage, undefined, undefined, NOW)).toEqual({
      catalog: createEmptyHouseholdCatalog(NOW),
      source: 'default',
      recovered: false,
    })
  })

  it('rejects unsafe shapes and does not replace screen state after a failed write', () => {
    const storage = new FailOnceStorage()
    const empty = createEmptyHouseholdCatalog(NOW)
    expect(saveHouseholdCatalog(empty, storage).ok).toBe(true)
    const changed = updateBaseProduct(
      empty,
      'milk',
      {
        name: '変更',
        unit: '本',
        categoryId: 'eggs-dairy',
        hidden: false,
      },
      '2026-07-26T01:00:00.000Z',
    )
    storage.failNextCurrentWrite = true
    expect(saveHouseholdCatalog(changed, storage)).toMatchObject({ ok: false })
    expect(loadHouseholdCatalog(storage).catalog).toEqual(empty)

    const dangerous = JSON.parse(
      `{"schemaVersion":1,"revision":0,"updatedAt":"${NOW}","overrides":{"constructor":{"hidden":true}},"addedProducts":[]}`,
    )
    expect(saveHouseholdCatalog(dangerous, storage)).toMatchObject({ ok: false })
  })

  it('returns the original save failure even when rollback storage also fails', () => {
    const storage = new MemoryStorage()
    const empty = createEmptyHouseholdCatalog(NOW)
    expect(saveHouseholdCatalog(empty, storage).ok).toBe(true)
    const changed = updateBaseProduct(
      empty,
      'milk',
      {
        name: '変更後',
        unit: '本',
        categoryId: 'eggs-dairy',
        hidden: false,
      },
      '2026-07-26T01:00:00.000Z',
    )
    const originalSetItem = storage.setItem.bind(storage)
    let currentWriteAttempts = 0
    storage.setItem = (key: string, value: string) => {
      if (key === HOUSEHOLD_CATALOG_KEY) {
        currentWriteAttempts += 1
        throw new DOMException('storage unavailable', 'SecurityError')
      }
      originalSetItem(key, value)
    }

    expect(saveHouseholdCatalog(changed, storage)).toMatchObject({
      ok: false,
      error: expect.objectContaining({
        name: 'SecurityError',
      }),
    })
    expect(currentWriteAttempts).toBe(2)
  })

  it('rolls back when the saved current generation cannot be verified', () => {
    const storage = new MemoryStorage()
    const empty = createEmptyHouseholdCatalog(NOW)
    expect(saveHouseholdCatalog(empty, storage).ok).toBe(true)
    const changed = updateBaseProduct(
      empty,
      'milk',
      {
        name: '検証対象',
        unit: '本',
        categoryId: 'eggs-dairy',
        hidden: false,
      },
      '2026-07-26T01:00:00.000Z',
    )
    const originalGetItem = storage.getItem.bind(storage)
    let currentReads = 0
    storage.getItem = (key: string) => {
      if (key === HOUSEHOLD_CATALOG_KEY) {
        currentReads += 1
        if (currentReads === 2) {
          return '{broken'
        }
      }
      return originalGetItem(key)
    }

    expect(saveHouseholdCatalog(changed, storage)).toMatchObject({
      ok: false,
      error: expect.objectContaining({
        message: '保存した商品リストを確認できませんでした。',
      }),
    })
    storage.getItem = originalGetItem
    expect(loadHouseholdCatalog(storage).catalog).toEqual(empty)
  })

  it('stores only a valid explicit backup confirmation receipt', () => {
    const storage = new MemoryStorage()
    const receipt = {
      catalogFingerprint: 'catalog-v1-0123456789abcdef',
      confirmedAt: NOW,
    }
    expect(loadCatalogBackupReceipt(storage)).toBeNull()
    expect(saveCatalogBackupReceipt(receipt, storage)).toBe(true)
    expect(loadCatalogBackupReceipt(storage)).toEqual(receipt)

    storage.setItem(
      CATALOG_BACKUP_RECEIPT_KEY,
      JSON.stringify({ ...receipt, constructor: 'unsafe' }),
    )
    expect(loadCatalogBackupReceipt(storage)).toBeNull()
  })
})
