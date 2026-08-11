export const MAX_PHOTOS_PER_BATCH = 3
export const MAX_PHOTO_BYTES = 500 * 1024
export const MAX_PHOTO_BATCH_BYTES = MAX_PHOTOS_PER_BATCH * MAX_PHOTO_BYTES
export const MAX_PHOTO_DIMENSION = 1_280
export const PHOTO_RETENTION_MS = 14 * 24 * 60 * 60 * 1_000
export const PHOTO_TOKEN_PATTERN = /^p1_[A-Za-z0-9_-]{32}$/
export const PHOTO_TURNSTILE_ACTION = 'product_photo_upload'
