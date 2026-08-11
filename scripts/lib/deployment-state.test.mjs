import {
  mkdtemp,
  readFile,
  rm,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  appendGitHubEnvironment,
  createDeploymentBuildEnvironment,
  createDeploymentManifest,
  writeDeploymentManifest,
} from './deployment-state.mjs'

const temporaryDirectories = []

async function temporaryDirectory() {
  const path = await mkdtemp(join(tmpdir(), 'kaimono-baton-deployment-state-'))
  temporaryDirectories.push(path)
  return path
}

afterEach(async () => {
  for (const path of temporaryDirectories.splice(0)) {
    await rm(path, { recursive: true, force: true })
  }
})

describe('deployment build environment', () => {
  it('prepares a time-limited manual-on session', () => {
    const environment = createDeploymentBuildEnvironment({
      mode: 'manual-on',
      sessionId: 'session-123',
      now: Date.parse('2026-07-28T00:00:00.000Z'),
    })

    expect(environment).toMatchObject({
      HANDWRITING_DEPLOYMENT_MODE: 'manual-on',
      HANDWRITING_DEPLOYMENT_SESSION_ID: 'session-123',
      HANDWRITING_DEPLOYMENT_BUILT_AT: '2026-07-28T00:00:00.000Z',
      HANDWRITING_DEPLOYMENT_EXPIRES_AT:
        '2026-07-28T00:45:00.000Z',
      VITE_HANDWRITING_MANUAL_TEST_SESSION_ID: 'session-123',
      VITE_HANDWRITING_MANUAL_TEST_EXPIRES_AT:
        '2026-07-28T00:45:00.000Z',
      VITE_HANDWRITING_IMPORT_ENABLED: 'true',
      VITE_HANDWRITING_DIAGNOSTICS_ENABLED: 'true',
    })
  })

  it('leaves repository and manual-off builds without UI access metadata', () => {
    expect(
      createDeploymentBuildEnvironment({
        mode: 'repository',
        sessionId: '',
      }),
    ).toMatchObject({
      HANDWRITING_DEPLOYMENT_SESSION_ID: '',
      VITE_HANDWRITING_MANUAL_TEST_SESSION_ID: '',
      VITE_HANDWRITING_MANUAL_TEST_EXPIRES_AT: '',
      VITE_HANDWRITING_IMPORT_ENABLED: 'false',
      VITE_HANDWRITING_DIAGNOSTICS_ENABLED: 'false',
    })
    expect(
      createDeploymentBuildEnvironment({
        mode: 'manual-off',
        sessionId: 'session-123-off',
      }),
    ).toMatchObject({
      HANDWRITING_DEPLOYMENT_SESSION_ID: 'session-123-off',
      VITE_HANDWRITING_MANUAL_TEST_SESSION_ID: '',
      VITE_HANDWRITING_MANUAL_TEST_EXPIRES_AT: '',
      VITE_HANDWRITING_IMPORT_ENABLED: 'false',
      VITE_HANDWRITING_DIAGNOSTICS_ENABLED: 'false',
    })
  })

  it('uses Repository Variable values outside manual-on mode', () => {
    expect(
      createDeploymentBuildEnvironment({
        mode: 'repository',
        sessionId: '',
        repositoryImportEnabled: 'TRUE',
        repositoryDiagnosticsEnabled: 'true',
      }),
    ).toMatchObject({
      VITE_HANDWRITING_IMPORT_ENABLED: 'true',
      VITE_HANDWRITING_DIAGNOSTICS_ENABLED: 'true',
    })
  })

  it('rejects invalid modes and injection-prone session IDs', () => {
    expect(() =>
      createDeploymentBuildEnvironment({
        mode: 'unknown',
        sessionId: 'session',
      }),
    ).toThrow()
    expect(() =>
      createDeploymentBuildEnvironment({
        mode: 'manual-on',
        sessionId: 'session\nINJECTED=true',
      }),
    ).toThrow()
  })

  it('writes only validated single-line entries to GITHUB_ENV', async () => {
    const root = await temporaryDirectory()
    const path = join(root, 'github-env')
    await appendGitHubEnvironment(path, {
      SAFE_NAME: 'safe-value',
    })

    expect(await readFile(path, 'utf8')).toBe('SAFE_NAME=safe-value\n')
    await expect(
      appendGitHubEnvironment(path, {
        SAFE_NAME: 'unsafe\nvalue',
      }),
    ).rejects.toThrow()
  })
})

describe('deployment manifest', () => {
  function manifestEnvironment(overrides = {}) {
    return {
      HANDWRITING_DEPLOYMENT_MODE: 'manual-on',
      HANDWRITING_DEPLOYMENT_SESSION_ID: 'session-123',
      HANDWRITING_DEPLOYMENT_BUILT_AT:
        '2026-07-28T00:00:00.000Z',
      HANDWRITING_DEPLOYMENT_EXPIRES_AT:
        '2026-07-28T00:45:00.000Z',
      GITHUB_SHA: 'a'.repeat(40),
      VITE_HANDWRITING_IMPORT_ENABLED: 'true',
      VITE_HANDWRITING_DIAGNOSTICS_ENABLED: 'true',
      VITE_HANDWRITING_IMPORT_ENDPOINT:
        'https://worker.example.invalid/',
      VITE_TURNSTILE_SITE_KEY: 'public-site-key',
      VITE_PRODUCT_PHOTOS_ENABLED: 'true',
      VITE_LIVE_REQUESTS_ENABLED: 'true',
      VITE_MANUAL_VALIDATION_ENABLED: 'true',
      ...overrides,
    }
  }

  it('contains flags and configuration presence, not public values', () => {
    const manifest = createDeploymentManifest(manifestEnvironment())
    const serialized = JSON.stringify(manifest)

    expect(manifest).toEqual({
      schemaVersion: 1,
      commitSha: 'a'.repeat(40),
      manualTestMode: 'manual-on',
      manualTestSessionId: 'session-123',
      handwritingImportEnabled: true,
      diagnosticsEnabled: true,
      productPhotosEnabled: true,
      liveRequestsEnabled: true,
      manualValidationEnabled: true,
      endpointConfigured: true,
      turnstileSiteKeyConfigured: true,
      builtAt: '2026-07-28T00:00:00.000Z',
      expiresAt: '2026-07-28T00:45:00.000Z',
    })
    expect(serialized).not.toContain('worker.example.invalid')
    expect(serialized).not.toContain('public-site-key')
  })

  it('creates a safe repository-mode manifest for an ordinary main deployment', () => {
    const buildEnvironment = createDeploymentBuildEnvironment({
      mode: 'repository',
      sessionId: '',
      repositoryImportEnabled: 'false',
      repositoryDiagnosticsEnabled: 'false',
      now: Date.parse('2026-07-28T00:00:00.000Z'),
    })

    expect(
      createDeploymentManifest({
        ...buildEnvironment,
        GITHUB_SHA: 'b'.repeat(40),
        VITE_HANDWRITING_IMPORT_ENDPOINT:
          'https://worker.example.invalid/',
        VITE_TURNSTILE_SITE_KEY: 'public-site-key',
      }),
    ).toEqual({
      schemaVersion: 1,
      commitSha: 'b'.repeat(40),
      manualTestMode: 'repository',
      manualTestSessionId: '',
      handwritingImportEnabled: false,
      diagnosticsEnabled: false,
      productPhotosEnabled: false,
      liveRequestsEnabled: false,
      manualValidationEnabled: false,
      endpointConfigured: true,
      turnstileSiteKeyConfigured: true,
      builtAt: '2026-07-28T00:00:00.000Z',
      expiresAt: null,
    })
  })

  it('records missing public configuration only as booleans', () => {
    expect(
      createDeploymentManifest(
        manifestEnvironment({
          VITE_HANDWRITING_IMPORT_ENDPOINT: '',
          VITE_TURNSTILE_SITE_KEY: '',
        }),
      ),
    ).toMatchObject({
      endpointConfigured: false,
      turnstileSiteKeyConfigured: false,
    })
  })

  it('writes the manifest to the requested dist path', async () => {
    const root = await temporaryDirectory()
    const path = join(root, 'dist', 'handwriting-deployment-state.json')
    const manifest = createDeploymentManifest(manifestEnvironment())

    await writeDeploymentManifest(path, manifest)

    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(manifest)
  })

  it('does not serialize forbidden request or product data', () => {
    const forbidden = [
      'API_KEY_SENTINEL',
      'WORKER_SECRET_SENTINEL',
      'TURNSTILE_TOKEN_SENTINEL',
      'data:image/jpeg;base64,',
      'PRODUCT_NAME_SENTINEL',
      'ALIAS_SENTINEL',
      'PRODUCT_ID_SENTINEL',
      'SOURCE_TEXT_SENTINEL',
      'GEMINI_OUTPUT_SENTINEL',
    ]
    const serialized = JSON.stringify(
      createDeploymentManifest(
        manifestEnvironment({
          GEMINI_API_KEY: forbidden[0],
          TURNSTILE_SECRET_KEY: forbidden[1],
          TURNSTILE_TOKEN: forbidden[2],
          IMAGE_DATA: forbidden[3],
          PRODUCT_NAME: forbidden[4],
          PRODUCT_ALIAS: forbidden[5],
          PRODUCT_ID: forbidden[6],
          SOURCE_TEXT: forbidden[7],
          GEMINI_OUTPUT: forbidden[8],
        }),
      ),
    )

    for (const value of forbidden) {
      expect(serialized).not.toContain(value)
    }
  })
})
