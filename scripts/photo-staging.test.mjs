import { describe, expect, it } from 'vitest'
import { createStagingViteConfig, validateBuildInput, validateDeployContext } from './photo-staging.mjs'

describe('photo-only staging build boundary', () => {
  it('rejects missing, malformed, and dummy site keys for a deployable build', () => {
    for (const key of ['', 'invalid', '1x00000000000000000000AA']) expect(() => validateBuildInput(key, false)).toThrow()
    expect(() => validateBuildInput('0x4AAAAAAFjKjYCH3bpjq49v', false)).not.toThrow()
    expect(() => validateBuildInput('1x00000000000000000000AA', true)).not.toThrow()
  })
  it('builds only photos using a fixed endpoint and isolated environment', () => {
    const config = createStagingViteConfig('0x4AAAAAAFjKjYCH3bpjq49v')
    expect(config.envFile).toBe(false)
    expect(config.configFile).toBe(false)
    expect(config.envPrefix).toEqual([])
    expect(config.base).toBe('/')
    const env = Object.fromEntries(Object.entries(config.define).map(([key, value]) => [key.replace('import.meta.env.', ''), JSON.parse(value)]))
    expect(env.VITE_PRODUCT_PHOTOS_ENABLED).toBe('true')
    expect(env.VITE_LIVE_REQUESTS_ENABLED).toBe('false')
    expect(env.VITE_HANDWRITING_IMPORT_ENABLED).toBe('false')
    expect(env.VITE_MANUAL_VALIDATION_ENABLED).toBe('false')
    expect(env.VITE_HANDWRITING_IMPORT_ENDPOINT).toBe('https://kaimono-baton-photo-staging.plainrelay01.workers.dev')
    expect(Object.keys(env).some((key) => /SECRET|PASSWORD|TOKEN/.test(key))).toBe(false)
  })
  it('refuses an artifact from main, a different worker, test mode, or a stale commit', () => {
    const good = { worker: 'kaimono-baton-photo-staging', testOnly: false, commit: 'a'.repeat(40) }
    expect(() => validateDeployContext(good, 'test/product-photo-staging', good.commit)).not.toThrow()
    for (const [manifest, branch, sha] of [
      [good, 'main', good.commit],
      [{ ...good, worker: 'kaimono-baton-handwriting-import' }, 'test/product-photo-staging', good.commit],
      [{ ...good, testOnly: true }, 'test/product-photo-staging', good.commit],
      [good, 'test/product-photo-staging', 'b'.repeat(40)],
    ]) expect(() => validateDeployContext(manifest, branch, sha)).toThrow()
  })
})
