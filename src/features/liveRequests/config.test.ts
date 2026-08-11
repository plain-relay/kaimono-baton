import { describe, expect, it } from 'vitest'
import { resolveLiveRequestConfig } from './config'

const configured = {
  VITE_LIVE_REQUESTS_ENABLED: 'true',
  VITE_HANDWRITING_IMPORT_ENDPOINT: 'https://worker.example/',
  VITE_TURNSTILE_SITE_KEY: 'public-site-key',
}

describe('live request configuration', () => {
  it('is disabled unless flag, endpoint, and public site key are all ready', () => {
    expect(resolveLiveRequestConfig({}).enabled).toBe(false)
    expect(
      resolveLiveRequestConfig({
        ...configured,
        VITE_LIVE_REQUESTS_ENABLED: 'false',
      }).enabled,
    ).toBe(false)
    expect(
      resolveLiveRequestConfig({
        ...configured,
        VITE_HANDWRITING_IMPORT_ENDPOINT: '',
      }).enabled,
    ).toBe(false)
    expect(
      resolveLiveRequestConfig({
        ...configured,
        VITE_TURNSTILE_SITE_KEY: '',
      }).enabled,
    ).toBe(false)
  })

  it('accepts explicit true with HTTPS or local development endpoint', () => {
    expect(
      resolveLiveRequestConfig({
        ...configured,
        VITE_LIVE_REQUESTS_ENABLED: ' TRUE ',
      }),
    ).toEqual({
      enabled: true,
      endpoint: 'https://worker.example/',
      turnstileSiteKey: 'public-site-key',
    })
    expect(
      resolveLiveRequestConfig({
        ...configured,
        VITE_HANDWRITING_IMPORT_ENDPOINT: 'http://localhost:8787',
      }).enabled,
    ).toBe(true)
  })

  it('rejects loose truthy flags and unsafe endpoints', () => {
    expect(
      resolveLiveRequestConfig({
        ...configured,
        VITE_LIVE_REQUESTS_ENABLED: '1',
      }).enabled,
    ).toBe(false)
    expect(
      resolveLiveRequestConfig({
        ...configured,
        VITE_HANDWRITING_IMPORT_ENDPOINT: 'http://worker.example',
      }).enabled,
    ).toBe(false)
  })

  it('allows a Worker-verified validation session without enabling the public flag', () => {
    const validationSessionToken = `mv1_${'A'.repeat(32)}`
    expect(
      resolveLiveRequestConfig(
        {
          ...configured,
          VITE_LIVE_REQUESTS_ENABLED: 'false',
        },
        validationSessionToken,
      ),
    ).toEqual({
      enabled: true,
      endpoint: 'https://worker.example/',
      turnstileSiteKey: 'public-site-key',
      validationSessionToken,
    })
  })

  it('does not enable from an unsafe validation session value', () => {
    expect(
      resolveLiveRequestConfig(
        {
          ...configured,
          VITE_LIVE_REQUESTS_ENABLED: 'false',
        },
        'unsafe\r\nheader',
      ).enabled,
    ).toBe(false)
  })
})
