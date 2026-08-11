import { describe, expect, it, vi } from 'vitest'
import {
  PhotoObject,
  type SavePhotoInput,
} from '../src/photoObject'

const DAY_MS = 24 * 60 * 60 * 1_000
const createdAt = Date.UTC(2026, 7, 1)
const expiresAt = createdAt + 14 * DAY_MS

type StoredRow = {
  jpeg: ArrayBuffer
  content_hash: string
  created_at: number
  expires_at: number
}

function cursor<T extends Record<string, SqlStorageValue>>(
  rows: T[],
): SqlStorageCursor<T> {
  return {
    toArray: () => rows,
  } as SqlStorageCursor<T>
}

class FakePhotoStorage {
  row: StoredRow | undefined
  alarmTime: number | undefined
  deleteAllError: Error | undefined
  readonly setAlarm = vi.fn(async (time: number | Date) => {
    this.alarmTime = typeof time === 'number' ? time : time.getTime()
  })
  readonly deleteAlarm = vi.fn(async () => {
    this.alarmTime = undefined
  })
  readonly deleteAll = vi.fn(async () => {
    if (this.deleteAllError) {
      throw this.deleteAllError
    }
    this.row = undefined
    this.alarmTime = undefined
  })
  readonly sql = {
    exec: <T extends Record<string, SqlStorageValue>>(
      query: string,
      ...bindings: SqlStorageValue[]
    ): SqlStorageCursor<T> => {
      const normalized = query.replace(/\s+/gu, ' ').trim().toUpperCase()
      if (normalized.startsWith('CREATE TABLE')) {
        return cursor<T>([])
      }
      if (normalized.startsWith('SELECT')) {
        return cursor<T>(this.row ? [this.row as unknown as T] : [])
      }
      if (normalized.startsWith('INSERT INTO PHOTO')) {
        this.row = {
          jpeg: bindings[0] as ArrayBuffer,
          content_hash: bindings[1] as string,
          created_at: bindings[2] as number,
          expires_at: bindings[3] as number,
        }
        return cursor<T>([])
      }
      throw new Error('Unexpected SQL in test')
    },
  }
}

function createObject(storage = new FakePhotoStorage()) {
  const state = {
    storage: storage as unknown as DurableObjectStorage,
  } as DurableObjectState
  return {
    object: new PhotoObject(state, {}),
    storage,
  }
}

function saveInput(
  overrides: Partial<SavePhotoInput> = {},
): SavePhotoInput {
  return {
    jpeg: new Uint8Array([1, 2, 3]).buffer,
    contentHash: 'a'.repeat(64),
    createdAt,
    expiresAt,
    ...overrides,
  }
}

describe('PhotoObject', () => {
  it('stores one photo and schedules its fixed 14-day alarm', async () => {
    const { object, storage } = createObject()

    await expect(object.savePhoto(saveInput())).resolves.toEqual({
      status: 'created',
    })
    expect(storage.row).toMatchObject({
      content_hash: 'a'.repeat(64),
      created_at: createdAt,
      expires_at: expiresAt,
    })
    expect(storage.setAlarm).toHaveBeenCalledWith(expiresAt)
  })

  it('treats identical content as idempotent and rejects overwrite', async () => {
    const { object, storage } = createObject()
    await object.savePhoto(saveInput())
    const originalRow = storage.row

    await expect(
      object.savePhoto(
        saveInput({
          createdAt: createdAt + DAY_MS,
          expiresAt: expiresAt + DAY_MS,
        }),
      ),
    ).resolves.toEqual({
      status: 'existing',
    })
    await expect(
      object.savePhoto(saveInput({ contentHash: 'b'.repeat(64) })),
    ).resolves.toEqual({ status: 'conflict' })
    expect(storage.row).toBe(originalRow)
    expect(storage.setAlarm).toHaveBeenLastCalledWith(expiresAt)
  })

  it('returns data before expiry and deletes it at expiry', async () => {
    const { object, storage } = createObject()
    await object.savePhoto(saveInput())

    await expect(object.getPhoto(expiresAt - 1)).resolves.toMatchObject({
      status: 'found',
      expiresAt,
    })
    await expect(object.getPhoto(expiresAt)).resolves.toEqual({
      status: 'expired',
    })
    expect(storage.deleteAll).toHaveBeenCalledTimes(1)
    await expect(object.getPhoto(expiresAt + 1)).resolves.toEqual({
      status: 'missing',
    })
  })

  it('deletes all data idempotently when its alarm runs', async () => {
    const { object, storage } = createObject()
    await object.savePhoto(saveInput())

    await object.alarm()
    await object.alarm()

    expect(storage.deleteAll).toHaveBeenCalledTimes(2)
    await expect(object.getPhoto(expiresAt - 1)).resolves.toEqual({
      status: 'missing',
    })
  })

  it('retains the expiry alarm when atomic deletion fails', async () => {
    const { object, storage } = createObject()
    await object.savePhoto(saveInput())
    storage.deleteAllError = new Error('synthetic atomic delete failure')

    await expect(object.deletePhoto()).rejects.toThrow(
      'synthetic atomic delete failure',
    )
    expect(storage.row).toBeDefined()
    expect(storage.alarmTime).toBe(expiresAt)
    expect(storage.deleteAlarm).not.toHaveBeenCalled()
  })

  it('rejects storage input without the fixed retention contract', async () => {
    const { object, storage } = createObject()

    await expect(
      object.savePhoto(saveInput({ expiresAt: createdAt + 15 * DAY_MS })),
    ).rejects.toThrow('Invalid photo storage input')
    expect(storage.setAlarm).not.toHaveBeenCalled()
    expect(storage.row).toBeUndefined()
  })
})
