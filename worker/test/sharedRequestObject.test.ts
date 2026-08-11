import { describe, expect, it, vi } from 'vitest'
import {
  MAX_SHARED_REQUEST_CUSTOM_ITEMS,
  MAX_SHARED_REQUEST_UPDATES,
  SHARED_REQUEST_RETENTION_MS,
} from '../src/sharedRequestConstants'
import {
  SharedRequestObject,
  type CreateSharedRequestInput,
} from '../src/sharedRequestObject'
import type { SharedRequestNewItem } from '../src/sharedRequestTypes'

type StoredRow = {
  request_id: string
  revision: number
  created_at: number
  expires_at: number
  edit_secret_hash: string
  updates_count: number
  items_json: string
}

function cursor<T extends Record<string, SqlStorageValue>>(
  rows: T[],
): SqlStorageCursor<T> {
  return { toArray: () => rows } as SqlStorageCursor<T>
}

class FakeSharedRequestStorage {
  row: StoredRow | undefined
  alarmTime: number | undefined
  readonly setAlarm = vi.fn(async (time: number | Date) => {
    this.alarmTime = typeof time === 'number' ? time : time.getTime()
  })
  readonly deleteAll = vi.fn(async () => {
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
      if (normalized.startsWith('INSERT INTO SHARED_REQUEST')) {
        this.row = {
          request_id: bindings[0] as string,
          revision: 1,
          created_at: bindings[1] as number,
          expires_at: bindings[2] as number,
          edit_secret_hash: bindings[3] as string,
          updates_count: 0,
          items_json: bindings[4] as string,
        }
        return cursor<T>([])
      }
      if (normalized.startsWith('UPDATE SHARED_REQUEST')) {
        if (!this.row) {
          throw new Error('No request row')
        }
        this.row = {
          ...this.row,
          revision: bindings[0] as number,
          updates_count: bindings[1] as number,
          items_json: bindings[2] as string,
        }
        return cursor<T>([])
      }
      throw new Error(`Unexpected SQL in test: ${normalized}`)
    },
  }
}

function newItem(
  index = 0,
  overrides: Partial<SharedRequestNewItem> = {},
): SharedRequestNewItem {
  return {
    itemId: `item-${index}`,
    productId: `product-${index}`,
    productNameSnapshot: `商品${index}`,
    categoryIdSnapshot: 'other',
    categoryNameSnapshot: 'その他',
    quantity: 1,
    unit: '個',
    memo: '国産',
    iconSnapshot: '🛒',
    sortOrderSnapshot: index,
    ...overrides,
  }
}

const createdAt = Date.UTC(2026, 7, 1)
const editSecretHash = 'a'.repeat(64)

function createInput(
  overrides: Partial<CreateSharedRequestInput> = {},
): CreateSharedRequestInput {
  return {
    requestId: `v5-r1_${'A'.repeat(32)}`,
    editSecretHash,
    createdAt,
    expiresAt: createdAt + SHARED_REQUEST_RETENTION_MS,
    items: [
      newItem(0, { photoToken: `p1_${'P'.repeat(32)}` }),
      newItem(1),
    ],
    ...overrides,
  }
}

function createObject(storage = new FakeSharedRequestStorage()) {
  const state = {
    storage: storage as unknown as DurableObjectStorage,
  } as DurableObjectState
  return {
    object: new SharedRequestObject(state, {}),
    storage,
  }
}

describe('SharedRequestObject', () => {
  it('creates one request with revision 1 and a fixed 14-day alarm', async () => {
    const { object, storage } = createObject()

    const result = await object.createRequest(createInput())

    expect(result).toMatchObject({
      status: 'created',
      request: {
        schemaVersion: 1,
        revision: 1,
        updatesCount: 0,
      },
    })
    expect(storage.alarmTime).toBe(
      createdAt + SHARED_REQUEST_RETENTION_MS,
    )
    expect(storage.row?.edit_secret_hash).toBe(editSecretHash)
    expect(JSON.stringify(storage.row)).not.toContain(`e1_${'S'.repeat(43)}`)
    await expect(object.createRequest(createInput())).resolves.toEqual({
      status: 'exists',
    })
  })

  it('reads before expiry and returns 410 semantics after atomic deletion', async () => {
    const { object, storage } = createObject()
    await object.createRequest(createInput())
    const expiresAt = createdAt + SHARED_REQUEST_RETENTION_MS

    await expect(object.getRequest(expiresAt - 1)).resolves.toMatchObject({
      status: 'found',
      request: { revision: 1 },
    })
    await expect(object.getRequest(expiresAt)).resolves.toEqual({
      status: 'expired',
    })
    expect(storage.deleteAll).toHaveBeenCalledTimes(1)
    await expect(object.getRequest(expiresAt + 1)).resolves.toEqual({
      status: 'missing',
    })
  })

  it('checks the fixed expiry before applying an update', async () => {
    const { object, storage } = createObject()
    await object.createRequest(createInput())
    const expiresAt = createdAt + SHARED_REQUEST_RETENTION_MS

    await expect(
      object.updateRequest({
        now: expiresAt,
        expectedRevision: 1,
        editSecretHash,
        operations: [{ type: 'cancel', itemId: 'item-0' }],
      }),
    ).resolves.toEqual({ status: 'expired' })
    expect(storage.deleteAll).toHaveBeenCalledTimes(1)
  })

  it('applies explicit operations atomically with a monotonic revision', async () => {
    const { object, storage } = createObject()
    await object.createRequest(createInput())
    const added = newItem(2)

    const result = await object.updateRequest({
      now: createdAt + 1,
      expectedRevision: 1,
      editSecretHash,
      operations: [
        { type: 'add', item: added },
        { type: 'set-quantity', itemId: 'item-0', quantity: 3 },
        { type: 'set-memo', itemId: 'item-0', memo: '薄切り' },
        { type: 'cancel', itemId: 'item-1' },
      ],
    })

    expect(result).toMatchObject({
      status: 'updated',
      request: { revision: 2, updatesCount: 1 },
    })
    if (result.status !== 'updated') {
      throw new Error('Expected an updated request')
    }
    expect(result.request.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          itemId: 'item-0',
          quantity: 3,
          memo: '薄切り',
          photoToken: `p1_${'P'.repeat(32)}`,
          updatedRevision: 2,
        }),
        expect.objectContaining({
          itemId: 'item-1',
          lifecycle: 'cancelled-by-requester',
          cancelledRevision: 2,
        }),
        expect.objectContaining({
          itemId: 'item-2',
          lifecycle: 'active',
          createdRevision: 2,
        }),
      ]),
    )
    expect(storage.setAlarm).toHaveBeenCalledTimes(1)
    expect(storage.row?.expires_at).toBe(
      createdAt + SHARED_REQUEST_RETENTION_MS,
    )
  })

  it('rejects bad secrets, stale revisions, invalid operations, and update exhaustion', async () => {
    const { object, storage } = createObject()
    await object.createRequest(createInput())
    const base = {
      now: createdAt + 1,
      expectedRevision: 1,
      editSecretHash,
      operations: [{ type: 'cancel' as const, itemId: 'item-1' }],
    }

    await expect(
      object.updateRequest({ ...base, editSecretHash: 'b'.repeat(64) }),
    ).resolves.toEqual({ status: 'forbidden' })
    await expect(
      object.updateRequest({ ...base, expectedRevision: 2 }),
    ).resolves.toEqual({ status: 'precondition-failed', revision: 1 })
    await expect(
      object.updateRequest({
        ...base,
        operations: [{ type: 'cancel', itemId: 'missing-item' }],
      }),
    ).resolves.toEqual({ status: 'operation-invalid' })

    if (!storage.row) {
      throw new Error('Expected stored request')
    }
    storage.row.updates_count = MAX_SHARED_REQUEST_UPDATES
    await expect(object.updateRequest(base)).resolves.toEqual({
      status: 'update-limit',
    })
    expect(storage.row.revision).toBe(1)
  })

  it('keeps tombstones and requires a new item ID for re-addition', async () => {
    const { object } = createObject()
    await object.createRequest(createInput())
    await object.updateRequest({
      now: createdAt + 1,
      expectedRevision: 1,
      editSecretHash,
      operations: [{ type: 'cancel', itemId: 'item-1' }],
    })

    await expect(
      object.updateRequest({
        now: createdAt + 2,
        expectedRevision: 2,
        editSecretHash,
        operations: [{ type: 'add', item: newItem(1) }],
      }),
    ).resolves.toEqual({ status: 'operation-invalid' })
    await expect(
      object.updateRequest({
        now: createdAt + 2,
        expectedRevision: 2,
        editSecretHash,
        operations: [
          {
            type: 'add',
            item: newItem(3, { productId: 'product-1' }),
          },
        ],
      }),
    ).resolves.toMatchObject({
      status: 'updated',
      request: { revision: 3 },
    })
  })

  it('limits active custom items and permits a replacement after tombstoning one', async () => {
    const tooManyCustomItems = Array.from(
      { length: MAX_SHARED_REQUEST_CUSTOM_ITEMS + 1 },
      (_, index) =>
        newItem(index, { productId: `custom:one-time-${index}` }),
    )
    const invalid = createObject()
    await expect(
      invalid.object.createRequest(
        createInput({ items: tooManyCustomItems }),
      ),
    ).rejects.toThrow('Invalid shared request storage input')

    const { object } = createObject()
    const maximumCustomItems = tooManyCustomItems.slice(
      0,
      MAX_SHARED_REQUEST_CUSTOM_ITEMS,
    )
    await object.createRequest(createInput({ items: maximumCustomItems }))
    await expect(
      object.updateRequest({
        now: createdAt + 1,
        expectedRevision: 1,
        editSecretHash,
        operations: [
          {
            type: 'add',
            item: newItem(MAX_SHARED_REQUEST_CUSTOM_ITEMS, {
              productId: `custom:one-time-${MAX_SHARED_REQUEST_CUSTOM_ITEMS}`,
            }),
          },
        ],
      }),
    ).resolves.toEqual({ status: 'operation-invalid' })

    await expect(
      object.updateRequest({
        now: createdAt + 2,
        expectedRevision: 1,
        editSecretHash,
        operations: [{ type: 'cancel', itemId: 'item-0' }],
      }),
    ).resolves.toMatchObject({
      status: 'updated',
      request: { revision: 2 },
    })
    await expect(
      object.updateRequest({
        now: createdAt + 3,
        expectedRevision: 2,
        editSecretHash,
        operations: [
          {
            type: 'add',
            item: newItem(MAX_SHARED_REQUEST_CUSTOM_ITEMS, {
              productId: `custom:one-time-${MAX_SHARED_REQUEST_CUSTOM_ITEMS}`,
            }),
          },
        ],
      }),
    ).resolves.toMatchObject({
      status: 'updated',
      request: { revision: 3 },
    })
  })

  it('does not count cancelled tombstone memos against the active limit', async () => {
    const { object } = createObject()
    const items = Array.from({ length: 34 }, (_, index) =>
      newItem(index, {
        memo: '条'.repeat(index < 33 ? 30 : 10),
      }),
    )
    await object.createRequest(createInput({ items }))

    await expect(
      object.updateRequest({
        now: createdAt + 1,
        expectedRevision: 1,
        editSecretHash,
        operations: [
          { type: 'cancel', itemId: 'item-0' },
          {
            type: 'add',
            item: newItem(34, { memo: '新'.repeat(30) }),
          },
        ],
      }),
    ).resolves.toMatchObject({
      status: 'updated',
      request: { revision: 2 },
    })
  })

  it('deletes all request data idempotently when its alarm runs', async () => {
    const { object, storage } = createObject()
    await object.createRequest(createInput())

    await object.alarm()
    await object.alarm()

    expect(storage.deleteAll).toHaveBeenCalledTimes(2)
    await expect(object.getRequest(createdAt + 1)).resolves.toEqual({
      status: 'missing',
    })
  })
})
