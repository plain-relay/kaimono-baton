import { describe, expect, it } from 'vitest'
import { resolveProductPhotoConfig } from './config'

describe('product photo configuration', () => {
  it('is disabled when the flag is missing or false', () => {
    expect(resolveProductPhotoConfig({}).enabled).toBe(false)
    expect(
      resolveProductPhotoConfig({ VITE_PRODUCT_PHOTOS_ENABLED: 'false' })
        .enabled,
    ).toBe(false)
  })

  it('is enabled only by explicit true with the shared Worker endpoint and Site Key', () => {
    expect(
      resolveProductPhotoConfig({
        VITE_PRODUCT_PHOTOS_ENABLED: ' TRUE ',
        VITE_HANDWRITING_IMPORT_ENDPOINT: 'https://worker.example/',
        VITE_TURNSTILE_SITE_KEY: 'public-site-key',
      }).enabled,
    ).toBe(true)
    expect(
      resolveProductPhotoConfig({ VITE_PRODUCT_PHOTOS_ENABLED: '1' })
        .enabled,
    ).toBe(false)
  })

  it('stays disabled when transport configuration is missing or unsafe', () => {
    expect(
      resolveProductPhotoConfig({ VITE_PRODUCT_PHOTOS_ENABLED: 'true' })
        .enabled,
    ).toBe(false)
    expect(
      resolveProductPhotoConfig({
        VITE_PRODUCT_PHOTOS_ENABLED: 'true',
        VITE_HANDWRITING_IMPORT_ENDPOINT: 'http://attacker.example/',
        VITE_TURNSTILE_SITE_KEY: 'public-site-key',
      }).enabled,
    ).toBe(false)
  })

  it('does not depend on the handwriting feature flag or Gemini settings', () => {
    expect(
      resolveProductPhotoConfig({
        VITE_PRODUCT_PHOTOS_ENABLED: 'true',
        VITE_HANDWRITING_IMPORT_ENDPOINT: 'https://worker.example/',
        VITE_TURNSTILE_SITE_KEY: 'public-site-key',
      }).enabled,
    ).toBe(true)
  })

  it('allows a Worker-verified validation session without enabling the public flag', () => {
    expect(
      resolveProductPhotoConfig(
        {
          VITE_PRODUCT_PHOTOS_ENABLED: 'false',
          VITE_HANDWRITING_IMPORT_ENDPOINT: 'https://worker.example/',
          VITE_TURNSTILE_SITE_KEY: 'public-site-key',
        },
        `mv1_${'A'.repeat(32)}`,
      ),
    ).toEqual({
      enabled: true,
      endpoint: 'https://worker.example/',
      turnstileSiteKey: 'public-site-key',
      validationSessionToken: `mv1_${'A'.repeat(32)}`,
    })
  })

  it('does not enable from an unsafe validation session value', () => {
    expect(
      resolveProductPhotoConfig(
        {
          VITE_PRODUCT_PHOTOS_ENABLED: 'false',
          VITE_HANDWRITING_IMPORT_ENDPOINT: 'https://worker.example/',
          VITE_TURNSTILE_SITE_KEY: 'public-site-key',
        },
        'unsafe\r\nheader',
      ).enabled,
    ).toBe(false)
  })
})
