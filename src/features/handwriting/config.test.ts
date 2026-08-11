import { describe, expect, it } from 'vitest'
import { resolveHandwritingImportConfig } from './config'

describe('resolveHandwritingImportConfig', () => {
  it('enables the feature only when the flag and both public settings exist', () => {
    expect(
      resolveHandwritingImportConfig({
        VITE_HANDWRITING_IMPORT_ENABLED: 'true',
        VITE_HANDWRITING_IMPORT_ENDPOINT:
          'https://import.example.workers.dev/',
        VITE_TURNSTILE_SITE_KEY: 'site-key',
      }),
    ).toEqual({
      enabled: true,
      diagnosticsEnabled: false,
      endpoint: 'https://import.example.workers.dev/',
      turnstileSiteKey: 'site-key',
    })
  })

  it.each([
    {},
    {
      VITE_HANDWRITING_IMPORT_ENABLED: 'false',
      VITE_HANDWRITING_IMPORT_ENDPOINT:
        'https://import.example.workers.dev/',
      VITE_TURNSTILE_SITE_KEY: 'site-key',
    },
    {
      VITE_HANDWRITING_IMPORT_ENABLED: 'true',
      VITE_TURNSTILE_SITE_KEY: 'site-key',
    },
    {
      VITE_HANDWRITING_IMPORT_ENABLED: 'true',
      VITE_HANDWRITING_IMPORT_ENDPOINT:
        'https://import.example.workers.dev/',
    },
    {
      VITE_HANDWRITING_IMPORT_ENABLED: 'true',
      VITE_HANDWRITING_IMPORT_ENDPOINT: 'javascript:alert(1)',
      VITE_TURNSTILE_SITE_KEY: 'site-key',
    },
  ])('stays safely disabled for incomplete or invalid settings', (environment) => {
    expect(resolveHandwritingImportConfig(environment).enabled).toBe(false)
  })

  it('allows an HTTP localhost endpoint for local development', () => {
    expect(
      resolveHandwritingImportConfig({
        VITE_HANDWRITING_IMPORT_ENABLED: 'TRUE',
        VITE_HANDWRITING_IMPORT_ENDPOINT: 'http://localhost:8787/',
        VITE_TURNSTILE_SITE_KEY: 'site-key',
      }).enabled,
    ).toBe(true)
  })

  it('enables diagnostics only for a diagnostic build and a pre-hash query parameter', () => {
    const environment = {
      VITE_HANDWRITING_IMPORT_ENABLED: 'true',
      VITE_HANDWRITING_DIAGNOSTICS_ENABLED: 'true',
      VITE_HANDWRITING_IMPORT_ENDPOINT:
        'https://import.example.workers.dev/',
      VITE_TURNSTILE_SITE_KEY: 'site-key',
    }
    expect(
      resolveHandwritingImportConfig(
        environment,
        'https://plain-relay.github.io/kaimono-baton/?handwritingDiagnostics=1#/create',
      ).diagnosticsEnabled,
    ).toBe(true)
    expect(
      resolveHandwritingImportConfig(
        environment,
        'https://plain-relay.github.io/kaimono-baton/#/create?handwritingDiagnostics=1',
      ).diagnosticsEnabled,
    ).toBe(false)
    expect(
      resolveHandwritingImportConfig(
        {
          ...environment,
          VITE_HANDWRITING_DIAGNOSTICS_ENABLED: 'false',
        },
        'https://plain-relay.github.io/kaimono-baton/?handwritingDiagnostics=1#/create',
      ).diagnosticsEnabled,
    ).toBe(false)
  })

  it('keeps diagnostics disabled for an invalid location URL', () => {
    expect(
      resolveHandwritingImportConfig(
        {
          VITE_HANDWRITING_DIAGNOSTICS_ENABLED: 'true',
        },
        'not a url',
      ).diagnosticsEnabled,
    ).toBe(false)
  })

  it('limits a manual-test build to the matching unexpired URL', () => {
    const environment = {
      VITE_HANDWRITING_IMPORT_ENABLED: 'true',
      VITE_HANDWRITING_DIAGNOSTICS_ENABLED: 'true',
      VITE_HANDWRITING_IMPORT_ENDPOINT:
        'https://import.example.workers.dev/',
      VITE_HANDWRITING_MANUAL_TEST_SESSION_ID: 'session-123',
      VITE_HANDWRITING_MANUAL_TEST_EXPIRES_AT:
        '2026-07-28T12:45:00.000Z',
      VITE_TURNSTILE_SITE_KEY: 'site-key',
    }
    const now = Date.parse('2026-07-28T12:30:00.000Z')

    expect(
      resolveHandwritingImportConfig(
        environment,
        'https://plain-relay.github.io/kaimono-baton/?handwritingDiagnostics=1&manualTestSessionId=session-123#/create',
        now,
      ),
    ).toMatchObject({
      enabled: true,
      diagnosticsEnabled: true,
    })
    expect(
      resolveHandwritingImportConfig(
        environment,
        'https://plain-relay.github.io/kaimono-baton/#/create',
        now,
      ),
    ).toMatchObject({
      enabled: false,
      diagnosticsEnabled: false,
    })
    expect(
      resolveHandwritingImportConfig(
        environment,
        'https://plain-relay.github.io/kaimono-baton/?handwritingDiagnostics=1&manualTestSessionId=other-session#/create',
        now,
      ),
    ).toMatchObject({
      enabled: false,
      diagnosticsEnabled: false,
    })
  })

  it('hides an expired or partially configured manual-test build', () => {
    const baseEnvironment = {
      VITE_HANDWRITING_IMPORT_ENABLED: 'true',
      VITE_HANDWRITING_DIAGNOSTICS_ENABLED: 'true',
      VITE_HANDWRITING_IMPORT_ENDPOINT:
        'https://import.example.workers.dev/',
      VITE_HANDWRITING_MANUAL_TEST_SESSION_ID: 'session-123',
      VITE_HANDWRITING_MANUAL_TEST_EXPIRES_AT:
        '2026-07-28T12:45:00.000Z',
      VITE_TURNSTILE_SITE_KEY: 'site-key',
    }
    const manualUrl =
      'https://plain-relay.github.io/kaimono-baton/?handwritingDiagnostics=1&manualTestSessionId=session-123#/create'

    expect(
      resolveHandwritingImportConfig(
        baseEnvironment,
        manualUrl,
        Date.parse('2026-07-28T12:45:00.000Z'),
      ).enabled,
    ).toBe(false)
    expect(
      resolveHandwritingImportConfig(
        {
          ...baseEnvironment,
          VITE_HANDWRITING_MANUAL_TEST_EXPIRES_AT: '',
        },
        manualUrl,
      ).enabled,
    ).toBe(false)
  })
})
