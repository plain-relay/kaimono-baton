import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { captureCleanSource, validateBuildSnapshot, createStagingViteConfig, validateBuildInput, validateDeployContext } from './photo-staging.mjs'

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
  it('rejects a dirty client before building and a changed HEAD during a build', async () => {
    const tempRoot = resolve(tmpdir())
    const root = await mkdtemp(join(tempRoot, 'photo-build-context-'))
    const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' })
    try {
      git('init')
      await writeFile(join(root, 'client.js'), 'synthetic approved source\n')
      await writeFile(join(root, '.gitignore'), 'public/.env\n')
      git('add', 'client.js', '.gitignore')
      git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--no-gpg-sign', '-m', 'fixture')
      const before = captureCleanSource(root)
      await mkdir(join(root, 'public'))
      const untracked = join(root, 'public', 'extra.txt')
      await writeFile(untracked, 'synthetic untracked asset')
      expect(() => captureCleanSource(root)).toThrow('SOURCE_NOT_CLEAN')
      await rm(untracked)
      const ignored = join(root, 'public', '.env')
      await writeFile(ignored, 'synthetic ignored asset')
      expect(() => captureCleanSource(root)).toThrow('SOURCE_NOT_CLEAN')
      await rm(ignored)
      await writeFile(join(root, 'client.js'), 'synthetic unreviewed source\n')
      expect(() => captureCleanSource(root)).toThrow('SOURCE_NOT_CLEAN')
      git('add', 'client.js')
      git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--no-gpg-sign', '-m', 'new fixture')
      expect(() => validateBuildSnapshot(before, captureCleanSource(root))).toThrow('SOURCE_CHANGED_DURING_BUILD')
      expect(() => validateBuildSnapshot(before, before)).not.toThrow()
    } finally {
      if (dirname(root) !== tempRoot || !basename(root).startsWith('photo-build-context-')) throw new Error('INVALID_TEST_CLEANUP_TARGET')
      await rm(root, { recursive: true, force: true })
    }
  })
})
