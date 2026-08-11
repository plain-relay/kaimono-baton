import { describe, expect, it } from 'vitest'
import {
  MAX_PRODUCT_PHOTO_BYTES,
  MAX_PRODUCT_PHOTO_DIMENSION,
} from './imageProcessing'
import { PRODUCT_PHOTO_TOKEN_PATTERN } from './photoToken'
import { MAX_PRODUCT_PHOTOS_PER_REQUEST } from './types'
import {
  MAX_PHOTO_BYTES,
  MAX_PHOTO_DIMENSION,
  MAX_PHOTOS_PER_BATCH,
  PHOTO_TOKEN_PATTERN,
} from '../../../worker/src/photoConstants'

describe('product photo frontend/Worker contract', () => {
  it('keeps count, byte, dimension, and token limits aligned', () => {
    expect(MAX_PRODUCT_PHOTOS_PER_REQUEST).toBe(MAX_PHOTOS_PER_BATCH)
    expect(MAX_PRODUCT_PHOTO_BYTES).toBe(MAX_PHOTO_BYTES)
    expect(MAX_PRODUCT_PHOTO_DIMENSION).toBe(MAX_PHOTO_DIMENSION)
    expect(PRODUCT_PHOTO_TOKEN_PATTERN.source).toBe(
      PHOTO_TOKEN_PATTERN.source,
    )
  })
})
