// Local preparation only. This script never invokes Wrangler or any remote API.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import react from '@vitejs/plugin-react'

export const STAGING_ORIGIN = 'https://kaimono-baton-photo-staging.plainrelay01.workers.dev'
const WORKER = 'kaimono-baton-photo-staging'
const BRANCH = 'test/product-photo-staging'
// Public, host-restricted widget identifier supplied by the owner. Never a secret.
const SITE_KEY = '0x4AAAAAAFjKjYCH3bpjq49v'
const DUMMY_KEY = '1x00000000000000000000AA'
const ROOT = fileURLToPath(new URL('../', import.meta.url))
const OUTPUT = resolve(ROOT, '.photo-staging')
const CONFIG = resolve(ROOT, 'worker/wrangler.photo-staging.toml')
const ENTRY = resolve(ROOT, 'worker/src/photoStaging.ts')
// Fail closed if destination/bindings/Worker-first/migration configuration changes.
const CONFIG_SHA256 = '24821686a739c6b530ad5b0b798d704b28ce068addf1d8ecbbc9701d98fba918'
const sha = (value) => createHash('sha256').update(value).digest('hex')
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

export function captureCleanSource(root = ROOT) {
  const run = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  if (run('status', '--porcelain', '--untracked-files=normal') ||
    run('ls-files', '--others', '--ignored', '--exclude-standard', '--', 'src', 'public', 'scripts', 'worker/src')) throw new Error('SOURCE_NOT_CLEAN')
  return run('rev-parse', 'HEAD')
}

export function validateBuildSnapshot(before, after) {
  if (before !== after) throw new Error('SOURCE_CHANGED_DURING_BUILD')
}

export function validateBuildInput(siteKey, testOnly) {
  if (!(testOnly && siteKey === DUMMY_KEY) && !/^0x[A-Za-z0-9_-]{16,80}$/.test(siteKey)) throw new Error('SITE_KEY_INVALID')
}

export function createStagingViteConfig(siteKey, origin = STAGING_ORIGIN) {
  // Explicit per-key define feeds Vite's serialized import.meta.env object too.
  // envFile:false and an empty prefix list exclude inherited env and .env files.
  const environment = {
    VITE_PRODUCT_PHOTOS_ENABLED: 'true', VITE_LIVE_REQUESTS_ENABLED: 'false',
    VITE_HANDWRITING_IMPORT_ENABLED: 'false', VITE_HANDWRITING_DIAGNOSTICS_ENABLED: 'false',
    VITE_MANUAL_VALIDATION_ENABLED: 'false', VITE_TURNSTILE_SITE_KEY: siteKey,
    VITE_HANDWRITING_IMPORT_ENDPOINT: origin,
  }
  return {
    root: ROOT, configFile: false, envFile: false, envPrefix: [], base: '/',
    define: Object.fromEntries(Object.entries(environment).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])),
    plugins: [react(), { name: 'photo-staging-notice', transformIndexHtml: () => [{
      tag: 'div', attrs: { role: 'note', style: 'padding:12px;background:#fff3cd;color:#332701;text-align:center' },
      children: '写真機能の検証専用です。本物の個人情報や商品写真を使わず、テスト用画像だけで確認してください。保存期間は14日です。',
      injectTo: 'body-prepend',
    }] }],
    build: { outDir: resolve(OUTPUT, 'assets'), emptyOutDir: true },
  }
}

export function validateDeployContext(manifest, branch, commit) {
  if (manifest.worker !== WORKER || manifest.testOnly !== false || branch !== BRANCH ||
    !/^[a-f0-9]{40}$/.test(commit) || manifest.commit !== commit) throw new Error('DEPLOY_CONTEXT_INVALID')
}

async function fileHashes(directory) {
  const result = {}
  const walk = async (dir) => {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = resolve(dir, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile()) result[relative(directory, path).replaceAll('\\', '/')] = sha(await readFile(path))
      else throw new Error('ASSET_TYPE_INVALID')
    }
  }
  await walk(directory)
  return result
}

async function sourceHashes() {
  const config = (await readFile(CONFIG, 'utf8')).replaceAll('\r\n', '\n')
  if (sha(config) !== CONFIG_SHA256) throw new Error('STAGING_CONFIG_CHANGED')
  return { config: sha(config), entry: sha((await readFile(ENTRY, 'utf8')).replaceAll('\r\n', '\n')) }
}

export async function buildStaging({ testOnly = false, localTestOrigin } = {}) {
  // A dirty client build cannot become an approved artifact by restoring source
  // before verify. Capture before AND after the build, including HEAD changes.
  const sourceCommit = testOnly ? git('rev-parse', 'HEAD') : captureCleanSource()
  if (localTestOrigin && (!testOnly || !/^http:\/\/localhost:\d+$/.test(localTestOrigin))) throw new Error('LOCAL_ORIGIN_INVALID')
  const key = testOnly ? DUMMY_KEY : SITE_KEY
  validateBuildInput(key, testOnly)
  const sources = await sourceHashes()
  await build(createStagingViteConfig(key, localTestOrigin))
  const scripts = (await readdir(resolve(OUTPUT, 'assets/assets'))).filter((name) => name.endsWith('.js'))
  const compiled = (await Promise.all(scripts.map((name) => readFile(resolve(OUTPUT, 'assets/assets', name), 'utf8')))).join('\n')
  if (!compiled.includes(key) || !compiled.includes(localTestOrigin ?? STAGING_ORIGIN)) throw new Error('COMPILED_CONFIG_MISSING')
  if (!testOnly) validateBuildSnapshot(sourceCommit, captureCleanSource())
  const manifest = { worker: WORKER, origin: localTestOrigin ?? STAGING_ORIGIN,
    commit: sourceCommit, testOnly, sources,
    assets: await fileHashes(resolve(OUTPUT, 'assets')) }
  await writeFile(resolve(OUTPUT, 'build.json'), JSON.stringify(manifest, null, 2) + '\n')
  return manifest
}

export async function verifyStaging() {
  const manifest = JSON.parse(await readFile(resolve(OUTPUT, 'build.json'), 'utf8'))
  const branch = process.env.WORKERS_CI_BRANCH ?? git('branch', '--show-current')
  validateDeployContext(manifest, branch, captureCleanSource())
  if (manifest.origin !== STAGING_ORIGIN || JSON.stringify(manifest.sources) !== JSON.stringify(await sourceHashes()) ||
    JSON.stringify(manifest.assets) !== JSON.stringify(await fileHashes(resolve(OUTPUT, 'assets')))) throw new Error('ARTIFACT_CHANGED')
  return { worker: WORKER, commit: manifest.commit, verified: true }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv[2]
    if (command === 'build') {
      const testOnly = process.argv.includes('--test')
      await buildStaging({ testOnly })
      console.log(JSON.stringify({ worker: WORKER, built: true, testOnly }))
    } else if (command === 'verify') console.log(JSON.stringify(await verifyStaging()))
    else throw new Error('COMMAND_INVALID')
  } catch {
    // Never print raw build/config/provider errors or environment values.
    console.error('PHOTO_STAGING_PREPARATION_FAILED')
    process.exitCode = 1
  }
}
