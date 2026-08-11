import { DurableObject } from 'cloudflare:workers'
import type { WorkerEnv } from './config'
import {
  MAX_SHARED_REQUEST_CUSTOM_ITEMS,
  MAX_SHARED_REQUEST_ITEMS,
  MAX_SHARED_REQUEST_UPDATES,
  SHARED_REQUEST_HASH_PATTERN,
  SHARED_REQUEST_RETENTION_MS,
} from './sharedRequestConstants'
import type {
  SharedRequestItem,
  SharedRequestNewItem,
  SharedRequestOperation,
  SharedRequestSnapshot,
} from './sharedRequestTypes'
import { isStoredSharedRequestItem } from './sharedRequestValidation'
import { countTextCharacters } from './text'

const CREATE_SHARED_REQUEST_TABLE = `
  CREATE TABLE IF NOT EXISTS shared_request (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    request_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    edit_secret_hash TEXT NOT NULL,
    updates_count INTEGER NOT NULL,
    items_json TEXT NOT NULL
  )
`

type SharedRequestRow = {
  request_id: string
  revision: number
  created_at: number
  expires_at: number
  edit_secret_hash: string
  updates_count: number
  items_json: string
}

export type CreateSharedRequestInput = {
  requestId: string
  editSecretHash: string
  createdAt: number
  expiresAt: number
  items: SharedRequestNewItem[]
}

export type CreateSharedRequestResult =
  | { status: 'created'; request: SharedRequestSnapshot }
  | { status: 'exists' }

export type ReadSharedRequestResult =
  | { status: 'found'; request: SharedRequestSnapshot }
  | { status: 'missing' }
  | { status: 'expired' }

export type UpdateSharedRequestInput = {
  now: number
  expectedRevision: number
  editSecretHash: string
  operations: SharedRequestOperation[]
}

export type UpdateSharedRequestResult =
  | { status: 'updated'; request: SharedRequestSnapshot }
  | { status: 'missing' }
  | { status: 'expired' }
  | { status: 'forbidden' }
  | { status: 'precondition-failed'; revision: number }
  | { status: 'update-limit' }
  | { status: 'operation-invalid' }

function cloneItem(item: SharedRequestItem): SharedRequestItem {
  return { ...item }
}

function cloneSnapshot(
  snapshot: SharedRequestSnapshot,
): SharedRequestSnapshot {
  return {
    ...snapshot,
    items: snapshot.items.map(cloneItem),
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  let difference = left.length ^ right.length
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    difference |=
      (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
  }
  return difference === 0
}

function parseItems(value: string): SharedRequestItem[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(value) as unknown
  } catch {
    throw new Error('Invalid shared request storage')
  }
  if (
    !Array.isArray(parsed) ||
    !parsed.every(isStoredSharedRequestItem)
  ) {
    throw new Error('Invalid shared request storage')
  }
  return parsed.map(cloneItem)
}

function rowToSnapshot(row: SharedRequestRow): SharedRequestSnapshot {
  if (
    !Number.isSafeInteger(row.revision) ||
    row.revision < 1 ||
    !Number.isSafeInteger(row.created_at) ||
    !Number.isSafeInteger(row.expires_at) ||
    !Number.isSafeInteger(row.updates_count) ||
    row.updates_count < 0
  ) {
    throw new Error('Invalid shared request storage')
  }
  return {
    schemaVersion: 1,
    requestId: row.request_id,
    revision: row.revision,
    createdAt: new Date(row.created_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
    updatesCount: row.updates_count,
    items: parseItems(row.items_json),
  }
}

function initialItems(
  items: readonly SharedRequestNewItem[],
): SharedRequestItem[] {
  return items.map((item) => ({
    ...item,
    lifecycle: 'active',
    createdRevision: 1,
    updatedRevision: 1,
  }))
}

function isCustomItem(item: Pick<SharedRequestNewItem, 'productId'>): boolean {
  return item.productId.startsWith('custom:')
}

function applyOperations(
  current: SharedRequestSnapshot,
  operations: readonly SharedRequestOperation[],
): SharedRequestSnapshot | undefined {
  const revision = current.revision + 1
  const items = current.items.map(cloneItem)
  const byId = new Map(items.map((item) => [item.itemId, item]))

  for (const operation of operations) {
    if (operation.type === 'add') {
      if (
        byId.has(operation.item.itemId) ||
        (isCustomItem(operation.item) &&
          items.filter(
            (item) =>
              item.lifecycle === 'active' && isCustomItem(item),
          ).length >= MAX_SHARED_REQUEST_CUSTOM_ITEMS) ||
        items.filter((item) => item.lifecycle === 'active').length >=
          MAX_SHARED_REQUEST_ITEMS ||
        items.length >=
          MAX_SHARED_REQUEST_ITEMS + MAX_SHARED_REQUEST_UPDATES
      ) {
        return undefined
      }
      const added: SharedRequestItem = {
        ...operation.item,
        lifecycle: 'active',
        createdRevision: revision,
        updatedRevision: revision,
      }
      items.push(added)
      byId.set(added.itemId, added)
      continue
    }

    const item = byId.get(operation.itemId)
    if (!item || item.lifecycle !== 'active') {
      return undefined
    }
    if (operation.type === 'set-quantity') {
      item.quantity = operation.quantity
      item.updatedRevision = revision
      continue
    }
    if (operation.type === 'set-memo') {
      if (operation.memo) {
        item.memo = operation.memo
      } else {
        delete item.memo
      }
      item.updatedRevision = revision
      continue
    }
    item.lifecycle = 'cancelled-by-requester'
    item.updatedRevision = revision
    item.cancelledRevision = revision
  }

  const memoCharacters = items.reduce(
    (total, item) =>
      item.lifecycle === 'active'
        ? total + countTextCharacters(item.memo ?? '')
        : total,
    0,
  )
  if (memoCharacters > 1_000) {
    return undefined
  }

  return {
    ...current,
    revision,
    updatesCount: current.updatesCount + 1,
    items,
  }
}

export class SharedRequestObject extends DurableObject<WorkerEnv> {
  private ensureSchema(): void {
    this.ctx.storage.sql.exec(CREATE_SHARED_REQUEST_TABLE)
  }

  private readRow(): SharedRequestRow | undefined {
    this.ensureSchema()
    return this.ctx.storage.sql
      .exec<SharedRequestRow>(
        `SELECT request_id, revision, created_at, expires_at,
          edit_secret_hash, updates_count, items_json
         FROM shared_request WHERE singleton = 1`,
      )
      .toArray()[0]
  }

  async createRequest(
    input: CreateSharedRequestInput,
  ): Promise<CreateSharedRequestResult> {
    if (
      !/^v5-r1_[A-Za-z0-9_-]{32}$/u.test(input.requestId) ||
      !SHARED_REQUEST_HASH_PATTERN.test(input.editSecretHash) ||
      !Number.isSafeInteger(input.createdAt) ||
      !Number.isSafeInteger(input.expiresAt) ||
      input.expiresAt - input.createdAt !==
        SHARED_REQUEST_RETENTION_MS ||
      input.items.length < 1 ||
      input.items.length > MAX_SHARED_REQUEST_ITEMS ||
      input.items.filter(isCustomItem).length >
        MAX_SHARED_REQUEST_CUSTOM_ITEMS
    ) {
      throw new Error('Invalid shared request storage input')
    }
    if (this.readRow()) {
      return { status: 'exists' }
    }

    const items = initialItems(input.items)
    await this.ctx.storage.setAlarm(input.expiresAt)
    this.ctx.storage.sql.exec(
      `INSERT INTO shared_request
        (singleton, request_id, revision, created_at, expires_at,
         edit_secret_hash, updates_count, items_json)
       VALUES (1, ?1, 1, ?2, ?3, ?4, 0, ?5)`,
      input.requestId,
      input.createdAt,
      input.expiresAt,
      input.editSecretHash,
      JSON.stringify(items),
    )
    return {
      status: 'created',
      request: {
        schemaVersion: 1,
        requestId: input.requestId,
        revision: 1,
        createdAt: new Date(input.createdAt).toISOString(),
        expiresAt: new Date(input.expiresAt).toISOString(),
        updatesCount: 0,
        items: items.map(cloneItem),
      },
    }
  }

  async getRequest(now: number): Promise<ReadSharedRequestResult> {
    if (!Number.isSafeInteger(now)) {
      throw new Error('Invalid shared request read time')
    }
    const row = this.readRow()
    if (!row) {
      return { status: 'missing' }
    }
    if (now >= row.expires_at) {
      await this.ctx.storage.deleteAll()
      return { status: 'expired' }
    }
    return { status: 'found', request: rowToSnapshot(row) }
  }

  async updateRequest(
    input: UpdateSharedRequestInput,
  ): Promise<UpdateSharedRequestResult> {
    if (
      !Number.isSafeInteger(input.now) ||
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 1 ||
      !SHARED_REQUEST_HASH_PATTERN.test(input.editSecretHash) ||
      input.operations.length < 1
    ) {
      throw new Error('Invalid shared request update input')
    }
    const row = this.readRow()
    if (!row) {
      return { status: 'missing' }
    }
    if (input.now >= row.expires_at) {
      await this.ctx.storage.deleteAll()
      return { status: 'expired' }
    }
    if (!constantTimeEqual(row.edit_secret_hash, input.editSecretHash)) {
      return { status: 'forbidden' }
    }
    if (row.revision !== input.expectedRevision) {
      return {
        status: 'precondition-failed',
        revision: row.revision,
      }
    }
    if (row.updates_count >= MAX_SHARED_REQUEST_UPDATES) {
      return { status: 'update-limit' }
    }

    const next = applyOperations(rowToSnapshot(row), input.operations)
    if (!next) {
      return { status: 'operation-invalid' }
    }
    this.ctx.storage.sql.exec(
      `UPDATE shared_request
       SET revision = ?1, updates_count = ?2, items_json = ?3
       WHERE singleton = 1`,
      next.revision,
      next.updatesCount,
      JSON.stringify(next.items),
    )
    return { status: 'updated', request: cloneSnapshot(next) }
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll()
  }
}
