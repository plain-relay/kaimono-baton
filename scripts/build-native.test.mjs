import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'

function digest(path) {
  return existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null
}

describe('native build isolation', () => {
  it('ignores Web path and optional service flags, bundles a restrictive CSP, and leaves Web assets intact', () => {
    const before = digest('dist/index.html')
    execFileSync(process.execPath, ['scripts/build-native.mjs'], {
      stdio: 'pipe',
      env: {
        ...process.env, BASE_PATH: '/native-build-test-sentinel/',
        VITE_PRODUCT_PHOTOS_ENABLED: 'true', VITE_LIVE_REQUESTS_ENABLED: 'true',
        VITE_HANDWRITING_IMPORT_ENABLED: 'true', VITE_MANUAL_VALIDATION_ENABLED: 'true',
        VITE_HANDWRITING_IMPORT_ENDPOINT: 'https://native-build-test-sentinel.invalid',
        VITE_TURNSTILE_SITE_KEY: 'native-build-test-sentinel',
      },
    })
    const index = readFileSync('dist-native/index.html', 'utf8')
    const scripts = readdirSync('dist-native/assets').filter(name => name.endsWith('.js'))
      .map(name => readFileSync(`dist-native/assets/${name}`, 'utf8')).join('\n')
    expect(index).toContain('Content-Security-Policy')
    expect(index).toContain("connect-src 'self'")
    expect(index).toContain('/assets/')
    expect(index + scripts).not.toContain('native-build-test-sentinel')
    expect(JSON.parse(readFileSync('dist-native/native-build.json', 'utf8'))).toMatchObject({
      webAssetVersion: '0.1.0', optionalFeatures: false, sourceCommit: expect.stringMatching(/^[0-9a-f]{40}$/),
    })
    expect(digest('dist/index.html')).toBe(before)
  }, 20_000)
})
