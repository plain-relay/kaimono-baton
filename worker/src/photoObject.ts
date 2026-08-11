import { DurableObject } from 'cloudflare:workers'
import type { WorkerEnv } from './config'
import { MAX_PHOTO_BYTES, PHOTO_RETENTION_MS } from './photoConstants'

const CONTENT_HASH_PATTERN = /^[a-f0-9]{64}$/

const CREATE_PHOTO_TABLE = `
  CREATE TABLE IF NOT EXISTS photo (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    jpeg BLOB NOT NULL,
    content_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )
`

type PhotoRow = {
  jpeg: ArrayBuffer
  content_hash: string
  created_at: number
  expires_at: number
}

export type SavePhotoInput = {
  jpeg: ArrayBuffer
  contentHash: string
  createdAt: number
  expiresAt: number
}

export type SavePhotoResult = {
  status: 'created' | 'existing' | 'conflict'
}

export type ReadPhotoResult =
  | { status: 'found'; jpeg: ArrayBuffer; expiresAt: number }
  | { status: 'missing' }
  | { status: 'expired' }

export class PhotoObject extends DurableObject<WorkerEnv> {
  private ensureSchema(): void {
    this.ctx.storage.sql.exec(CREATE_PHOTO_TABLE)
  }

  private readRow(): PhotoRow | undefined {
    this.ensureSchema()
    const rows = this.ctx.storage.sql
      .exec<PhotoRow>(
        'SELECT jpeg, content_hash, created_at, expires_at FROM photo WHERE singleton = 1',
      )
      .toArray()
    return rows[0]
  }

  async savePhoto(input: SavePhotoInput): Promise<SavePhotoResult> {
    if (
      input.jpeg.byteLength < 1 ||
      input.jpeg.byteLength > MAX_PHOTO_BYTES ||
      !CONTENT_HASH_PATTERN.test(input.contentHash) ||
      !Number.isSafeInteger(input.createdAt) ||
      !Number.isSafeInteger(input.expiresAt) ||
      input.expiresAt - input.createdAt !== PHOTO_RETENTION_MS
    ) {
      throw new Error('Invalid photo storage input')
    }

    const existing = this.readRow()
    if (existing) {
      if (existing.content_hash !== input.contentHash) {
        return { status: 'conflict' }
      }
      await this.ctx.storage.setAlarm(existing.expires_at)
      return { status: 'existing' }
    }

    await this.ctx.storage.setAlarm(input.expiresAt)
    this.ctx.storage.sql.exec(
      `INSERT INTO photo
        (singleton, jpeg, content_hash, created_at, expires_at)
       VALUES (1, ?1, ?2, ?3, ?4)`,
      input.jpeg,
      input.contentHash,
      input.createdAt,
      input.expiresAt,
    )
    return { status: 'created' }
  }

  async getPhoto(now: number): Promise<ReadPhotoResult> {
    if (!Number.isSafeInteger(now)) {
      throw new Error('Invalid photo read time')
    }
    const row = this.readRow()
    if (!row) {
      return { status: 'missing' }
    }
    if (now >= row.expires_at) {
      await this.deletePhoto()
      return { status: 'expired' }
    }
    return {
      status: 'found',
      jpeg: row.jpeg.slice(0),
      expiresAt: row.expires_at,
    }
  }

  async deletePhoto(): Promise<void> {
    // SQLite-backed deleteAll atomically removes data and alarms. Calling
    // deleteAlarm first could strand a photo if the subsequent deletion fails.
    await this.ctx.storage.deleteAll()
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll()
  }
}
