import { describe, expect, it } from 'vitest'
import {
  canAddProductPhoto,
  MAX_PRODUCT_PHOTOS_PER_REQUEST,
} from './types'

describe('pending photo limits', () => {
  it('allows at most three photos per request', () => {
    expect(MAX_PRODUCT_PHOTOS_PER_REQUEST).toBe(3)
    expect(canAddProductPhoto(0)).toBe(true)
    expect(canAddProductPhoto(2)).toBe(true)
    expect(canAddProductPhoto(3)).toBe(false)
    expect(canAddProductPhoto(4)).toBe(false)
  })
})
