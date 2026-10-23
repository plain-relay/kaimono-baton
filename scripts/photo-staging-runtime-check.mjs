// Real local workerd, SQLite, and the static-assets router. Only outbound
// Siteverify is a fixture. No deployed URLs, credentials, or user data are read.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { build } from 'esbuild'
import { Miniflare, createFetchMock, Log, LogLevel } from 'miniflare'
import sharp from 'sharp'
import { buildStaging } from './photo-staging.mjs'

const withBrowser = process.argv.includes('--browser')
const origin = 'http://localhost:4186'
const password = randomBytes(32).toString('base64url')
const Authorization = `Basic ${Buffer.from(`staging:${password}`).toString('base64')}`
let step = 'build'
let mf
try {
  await buildStaging({ testOnly: true, localTestOrigin: origin })
  const bundle = await build({
    stdin: { contents: `import {handlePhotoStagingRequest} from './worker/src/photoStaging';
      export {PhotoObject} from './worker/src/photoStaging';
      export default {fetch:(request,env)=>handlePhotoStagingRequest(request,env,{localTestOrigin:${JSON.stringify(origin)}})};`,
      resolveDir: process.cwd(), sourcefile: 'staging-local-only.ts' },
    bundle: true, write: false, format: 'esm', platform: 'browser', external: ['cloudflare:workers'],
  })
  const mock = createFetchMock()
  mock.disableNetConnect()
  mock.get('https://challenges.cloudflare.com').intercept({ path: '/turnstile/v0/siteverify', method: 'POST' })
    .reply(200, JSON.stringify({ success: true, action: 'product_photo_upload', hostname: 'localhost' }),
      { headers: { 'Content-Type': 'application/json' } }).persist()
  mf = new Miniflare({
    name: 'photo-staging-local-check', modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-07-26', host: '127.0.0.1', port: 4186,
    log: new Log(LogLevel.NONE), fetchMock: mock,
    bindings: { PHOTO_STAGING_ENABLED: 'true', PHOTO_STAGING_PASSWORD: password,
      PHOTO_STAGING_EXPIRES_AT: new Date(Date.now() + 86400000).toISOString(),
      TURNSTILE_SECRET_KEY: 'synthetic-local-fixture-only' },
    durableObjects: { PHOTO_OBJECTS: { className: 'PhotoObject', useSQLite: true } },
    assets: { directory: '.photo-staging/assets', binding: 'ASSETS',
      routerConfig: { has_user_worker: true, invoke_user_worker_ahead_of_assets: true },
      assetConfig: { not_found_handling: 'single-page-application' } },
  })
  await mf.ready
  step = 'asset-auth'
  const index = await fetch(origin, { headers: { Authorization } })
  assert.equal(index.status, 200)
  assert.equal(index.headers.get('Cache-Control'), 'no-store')
  const html = await index.text()
  assert.ok(html.includes('検証専用'))
  const asset = /src="([^"]+\.js)"/.exec(html)?.[1]
  assert.ok(asset)
  for (const path of ['/', '/index.html', asset, '/v1/photos/batch']) {
    assert.equal((await fetch(origin + path)).status, 401)
  }
  assert.equal((await fetch(origin + asset, { headers: { Authorization } })).status, 200)
  step = 'post-save-get'
  const jpeg = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#3388bb' } }).jpeg().toBuffer()
  const results = []
  for (const count of [1, 2, 3]) {
    const tokens = Array.from({ length: count }, () => `p1_${randomBytes(24).toString('base64url')}`)
    const body = new FormData()
    body.append('turnstileToken', 'synthetic-fixture')
    body.append('metadata', JSON.stringify(tokens.map((token, index) => ({ token, itemKey: `fixture-${index}` }))))
    for (const _token of tokens) body.append('photo', new Blob([jpeg], { type: 'image/jpeg' }), 'synthetic.jpg')
    const saved = await fetch(origin + '/v1/photos/batch', { method: 'POST', body, headers: { Authorization, Origin: origin } })
    assert.equal(saved.status, 200)
    await saved.arrayBuffer() // Do not print API bodies or photo tokens.
    for (const token of tokens) {
      const fetched = await fetch(origin + '/v1/photos/' + token, { headers: { Authorization } })
      assert.equal(fetched.status, 200)
      assert.equal(fetched.headers.get('Content-Type'), 'image/jpeg')
      assert.deepEqual(Buffer.from(await fetched.arrayBuffer()), jpeg)
      assert.equal((await fetch(origin + '/v1/photos/' + token)).status, 401)
      assert.equal((await fetch(origin + '/v1/photos/' + token, { headers: { Authorization, Origin: 'https://wrong.example' } })).status, 403)
    }
    results.push({ photos: count, post: 200, get: 200 })
  }
  for (const path of ['/v1/handwriting/analyze', '/v1/shared-requests', '/v1/manual-validation/session']) {
    assert.equal((await fetch(origin + path, { headers: { Authorization } })).status, 404)
  }
  if (withBrowser) {
    step = 'browser'
    const code = await new Promise((done, fail) => {
      const child = spawn(process.execPath, ['scripts/photo-browser-check.mjs'], { stdio: 'inherit',
        env: { ...process.env, PHOTO_CHECK_ORIGIN: origin, PHOTO_CHECK_FIXTURE_PASSWORD: password } })
      child.once('error', fail)
      child.once('exit', done)
    })
    assert.equal(code, 0)
  }
  console.log(JSON.stringify({ runtime: 'workerd + SQLite + static assets', siteverify: 'outbound HTTP fixture',
    assetAuthentication: true, results, browser: withBrowser, passed: true }))
} catch {
  console.error(JSON.stringify({ case: step, passed: false, errorClass: 'staging-check-failed' }))
  process.exitCode = 1
} finally {
  await mf?.dispose()
}
