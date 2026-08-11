import { describe, expect, it, vi } from 'vitest'
import {
  createProductPhotoToken,
  isProductPhotoToken,
  PRODUCT_PHOTO_TOKEN_BYTES,
} from './photoToken'

describe('product photo capability tokens', () => {
  it('uses 192 random bits and a versioned base64url representation', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.forEach((_, index) => {
        bytes[index] = index
      })
      return bytes
    })

    const token = createProductPhotoToken({ getRandomValues })

    expect(getRandomValues).toHaveBeenCalledWith(
      expect.objectContaining({ byteLength: PRODUCT_PHOTO_TOKEN_BYTES }),
    )
    expect(token).toBe('p1_AAECAwQFBgcICQoLDA0ODxAREhMUFRYX')
    expect(isProductPhotoToken(token)).toBe(true)
  })

  it.each([
    '',
    'p1_short',
    'p2_AAECAwQFBgcICQoLDA0ODxAREhMUFRYX',
    'p1_AAECAwQFBgcICQoLDA0ODxAREhMUFRY+',
  ])('rejects malformed token %j', (token) => {
    expect(isProductPhotoToken(token)).toBe(false)
  })
})
