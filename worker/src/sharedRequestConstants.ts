export const SHARED_REQUEST_RETENTION_MS =
  14 * 24 * 60 * 60 * 1_000
export const SHARED_REQUEST_TOKEN_PREFIX = 'r1_'
export const SHARED_REQUEST_TOKEN_PATTERN = /^r1_[A-Za-z0-9_-]{32}$/
export const SHARED_REQUEST_EDIT_SECRET_PREFIX = 'e1_'
export const SHARED_REQUEST_EDIT_SECRET_PATTERN =
  /^e1_[A-Za-z0-9_-]{43}$/
export const SHARED_REQUEST_HASH_PATTERN = /^[a-f0-9]{64}$/
export const SHARED_REQUEST_CREATE_ACTION = 'shared_request_create'
export const SHARED_REQUEST_UPDATE_ACTION = 'shared_request_update'
// Keep this aligned with the existing v3 draft ceiling:
// 93 published products + 200 household products + 10 one-time items.
export const MAX_SHARED_REQUEST_ITEMS = 303
export const MAX_SHARED_REQUEST_UPDATES = 100
export const MAX_SHARED_REQUEST_CUSTOM_ITEMS = 10
export const MAX_SHARED_REQUEST_PHOTOS = 3
// v5 uses descriptive JSON snapshots rather than v3's compact tuples. This
// accommodates every item at the existing field limits without weakening the
// per-field, aggregate memo, or item-count validation below.
export const MAX_SHARED_REQUEST_BODY_BYTES = 512 * 1024
