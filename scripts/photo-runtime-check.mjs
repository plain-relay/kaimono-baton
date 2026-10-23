// Local only: actual Worker bundle + workerd + SQLite DOs. Siteverify alone is
// mocked at the outbound HTTP boundary; never reads Wrangler config or Secrets.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { build } from 'esbuild'
import { Miniflare, createFetchMock, Log, LogLevel } from 'miniflare'
import sharp from 'sharp'

const origin = 'http://localhost:4178'
const serve = process.argv.includes('--serve')
let apiUrl
let verificationFixture = 'fixture-valid'
const mock = createFetchMock()
mock.disableNetConnect()
mock.get('https://challenges.cloudflare.com').intercept({
  path: '/turnstile/v0/siteverify', method: 'POST',
}).reply(200, () => {
  const token = verificationFixture
  return JSON.stringify({
    success: token !== 'fixture-invalid',
    action: token === 'fixture-action' ? 'other' : 'product_photo_upload',
    hostname: token === 'fixture-host' ? 'other.example' : 'localhost',
  })
}, { headers: { 'Content-Type': 'application/json' } }).persist()

const bundled = await build({
  entryPoints: ['worker/src/index.ts'], bundle: true, write: false,
  format: 'esm', platform: 'browser', external: ['cloudflare:workers'],
})
const mf = new Miniflare({
  name: 'photo-local-check', modules: true, script: bundled.outputFiles[0].text,
  compatibilityDate: '2026-07-26', host: '127.0.0.1', port: serve ? 8788 : 0,
  log: new Log(LogLevel.NONE), fetchMock: mock,
  bindings: { ALLOWED_ORIGINS: origin, PHOTO_API_ENABLED: 'true',
    TURNSTILE_SECRET_KEY: 'local-fixture-only' },
  durableObjects: { PHOTO_OBJECTS: { className: 'PhotoObject', useSQLite: true } },
})
const jpeg = await sharp({ create: { width: 32, height: 24, channels: 3,
  background: '#3388bb' } }).jpeg().toBuffer()
const different = await sharp({ create: { width: 32, height: 24, channels: 3,
  background: '#bb8833' } }).jpeg().toBuffer()
const photo = (bytes = jpeg) => ({ token: `p1_${randomBytes(24).toString('base64url')}`,
  itemKey: `fixture-${randomBytes(4).toString('hex')}`, bytes })
const batch = (photos, challenge = 'fixture-valid') => {
  const body = new FormData()
  body.append('turnstileToken', challenge)
  body.append('metadata', JSON.stringify(photos.map(({ token, itemKey }) => ({ token, itemKey }))))
  for (const p of photos) body.append('photo', new Blob([p.bytes], { type: 'image/jpeg' }), 'photo.jpg')
  return body
}
const post = (photos, challenge = 'fixture-valid', from = origin) => {
  verificationFixture = challenge
  return fetch(new URL('/v1/photos/batch', apiUrl), {
  method: 'POST', headers: { Origin: from }, body: batch(photos, challenge),
  })
}
const get = (token) => fetch(new URL(`/v1/photos/${token}`, apiUrl), { headers: { Origin: origin } })
const results = []
let currentCase = 'startup'
const status = async (name, response, expected) => {
  currentCase = name
  if (response.status !== expected) console.log(JSON.stringify({ case: name, httpStatus: response.status, expected }))
  assert.equal(response.status, expected, name)
  await response.arrayBuffer()
  results.push({ case: name, httpStatus: expected, passed: true })
}
try {
  apiUrl = await mf.ready
  for (const count of [1, 2, 3]) {
    currentCase = `post-${count}`
    const photos = Array.from({ length: count }, () => photo())
    await status(`post-${count}`, await post(photos), 200)
    for (const p of photos) {
      const response = await get(p.token)
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('content-type'), 'image/jpeg')
      assert.equal(response.headers.get('access-control-allow-origin'), origin)
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), jpeg)
    }
    results.push({ case: `get-${count}`, httpStatus: 200, passed: true })
  }
  await status('four-photos', await post(Array.from({ length: 4 }, () => photo())), 400)
  const retry = photo()
  await status('first-save', await post([retry]), 200)
  await status('identical-retry', await post([retry]), 200)
  await status('overwrite-conflict', await post([{ ...retry, bytes: different }]), 409)
  for (const challenge of ['fixture-invalid', 'fixture-action', 'fixture-host']) {
    await status(challenge, await post([photo()], challenge), 403)
  }
  await status('origin-rejected', await post([photo()], undefined, 'https://other.example'), 403)
  await status('invalid-jpeg', await post([photo(Buffer.from('invalid'))]), 415)
  await status('oversize', await post([photo(Buffer.alloc(500 * 1024 + 1))]), 413)
  const bindings = await mf.getBindings()
  const object = bindings.PHOTO_OBJECTS.getByName(retry.token)
  const first = await object.getPhoto(Date.now())
  assert.equal(first.status, 'found')
  assert.ok(first.expiresAt > Date.now() + 13.99 * 86400000)
  await post([retry])
  assert.equal((await object.getPhoto(Date.now())).expiresAt, first.expiresAt)
  assert.equal((await object.getPhoto(first.expiresAt)).status, 'expired')
  await status('expired-deleted', await get(retry.token), 404)
  results.push({ case: 'fixed-14-day-expiry', passed: true })
  currentCase = 'lifecycle-runtime'
  // Test-only subclass exposes clock/scheduler controls, never a production route.
  // The inherited storage, HTTP handler, and alarm() implementation are real.
  const lifecycleBundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
      export { default } from './worker/src/index'
      import { PhotoObject as BasePhotoObject } from './worker/src/photoObject'
      export class PhotoObject extends BasePhotoObject {
        expireForTest() { this.ctx.storage.sql.exec('UPDATE photo SET expires_at = ?1', Date.now() - 1) }
        alarmSoonForTest() { return this.ctx.storage.setAlarm(Date.now() + 100) }
      }
    ` }, bundle: true, write: false, format: 'esm', platform: 'browser',
    external: ['cloudflare:workers'],
  })
  const lifecycle = new Miniflare({
    name: 'photo-lifecycle-check', modules: true, script: lifecycleBundle.outputFiles[0].text,
    compatibilityDate: '2026-07-26', log: new Log(LogLevel.NONE),
    bindings: { ALLOWED_ORIGINS: origin, PHOTO_API_ENABLED: 'true', TURNSTILE_SECRET_KEY: 'local-fixture-only' },
    durableObjects: { PHOTO_OBJECTS: { className: 'PhotoObject', useSQLite: true } },
  })
  try {
    const lifecycleUrl = await lifecycle.ready
    const objects = (await lifecycle.getBindings()).PHOTO_OBJECTS
    const expired = photo()
    const expiredObject = objects.getByName(expired.token)
    const createdAt = Date.now()
    const input = { jpeg: new Uint8Array(jpeg).buffer, contentHash: 'a'.repeat(64),
      createdAt, expiresAt: createdAt + 14 * 86400000 }
    await expiredObject.savePhoto(input)
    await expiredObject.expireForTest()
    await status('http-expired', await fetch(new URL(`/v1/photos/${expired.token}`, lifecycleUrl), { headers: { Origin: origin } }), 410)
    const alarmObject = objects.getByName(photo().token)
    await alarmObject.savePhoto(input)
    await alarmObject.alarmSoonForTest()
    const deadline = Date.now() + 5000
    let read
    do {
      await new Promise((resolve) => setTimeout(resolve, 50))
      read = await alarmObject.getPhoto(Date.now())
    } while (read.status !== 'missing' && Date.now() < deadline)
    assert.equal(read.status, 'missing')
    results.push({ case: 'scheduled-alarm-deletes-sqlite', passed: true })
  } finally {
    await lifecycle.dispose()
  }
  console.log(JSON.stringify({ runtime: 'workerd/SQLite', siteverify: 'HTTP fixture', results }))
  if (serve) {
    console.log('Local synthetic browser verification server ready on port 8788.')
    await new Promise((resolve) => {
      process.once('SIGINT', resolve)
      process.once('SIGTERM', resolve)
    })
  }
} catch (error) {
  // Never print provider errors, request bodies, capabilities, or complete URLs.
  console.error(`Local photo runtime verification failed at ${currentCase}. No payload details logged.`)
  console.log(JSON.stringify({ errorClass: ['TypeError', 'AssertionError', 'Error'].includes(error.name) ? error.name : 'other',
    ...(Number.isInteger(error.actual) ? { actual: error.actual } : {}),
    ...(Number.isInteger(error.expected) ? { expected: error.expected } : {}) }))
  process.exitCode = 1
} finally {
  await mf.dispose().catch(() => undefined)
  await mock.close()
}
