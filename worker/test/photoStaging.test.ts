import { describe, expect, it, vi } from 'vitest'
import { handlePhotoStagingRequest, type PhotoStagingEnv } from '../src/photoStaging'
import type { WorkerEnv } from '../src/config'

const origin = 'https://kaimono-baton-photo-staging.plainrelay01.workers.dev'
const now = Date.parse('2026-10-24T00:00:00Z')
const password = 'synthetic-staging-password-32-characters'
const auth = `Basic ${btoa(`staging:${password}`)}`
const makeEnv = () => ({
  PHOTO_STAGING_ENABLED: 'true',
  PHOTO_STAGING_PASSWORD: password,
  PHOTO_STAGING_EXPIRES_AT: new Date(now + 86400000).toISOString(),
  TURNSTILE_SECRET_KEY: 'fixture-only',
  PHOTO_OBJECTS: {} as NonNullable<WorkerEnv['PHOTO_OBJECTS']>,
  ASSETS: { fetch: vi.fn(async (_request: Request) => new Response('<html>fixture</html>')) },
})
const request = (path = '/', headers: Record<string, string> = { Authorization: auth }, method = 'GET') =>
  new Request(`${origin}${path}`, { headers, method })
const deps = { now: () => now }

describe('independent photo staging boundary', () => {
  it.each(['/', '/index.html', '/assets/app.js', '/v1/photos/batch'])('protects %s before any asset/API call', async (path) => {
    const env = makeEnv()
    const photoHandler = vi.fn()
    const result = await handlePhotoStagingRequest(request(path, {}), env, { ...deps, photoHandler })
    expect(result.status).toBe(401)
    expect(result.headers.get('WWW-Authenticate')).toContain('Basic')
    expect(env.ASSETS.fetch).not.toHaveBeenCalled()
    expect(photoHandler).not.toHaveBeenCalled()
  })
  it.each(['PHOTO_STAGING_ENABLED', 'PHOTO_STAGING_PASSWORD', 'PHOTO_STAGING_EXPIRES_AT', 'TURNSTILE_SECRET_KEY', 'PHOTO_OBJECTS', 'ASSETS'] as const)('fails closed without %s', async (key) => {
    const env: PhotoStagingEnv = makeEnv()
    delete env[key]
    expect((await handlePhotoStagingRequest(request(), env, deps)).status).toBe(503)
  })
  it.each(['false', 'TRUE', ''])('only literal true opens the staging flag (%s)', async (flag) => {
    const env = { ...makeEnv(), PHOTO_STAGING_ENABLED: flag }
    expect((await handlePhotoStagingRequest(request(), env, deps)).status).toBe(503)
  })
  it.each(['invalid', new Date(now + 49 * 3600000).toISOString()])('rejects an unsafe expiry %s', async (expiry) => {
    expect((await handlePhotoStagingRequest(request(), { ...makeEnv(), PHOTO_STAGING_EXPIRES_AT: expiry }, deps)).status).toBe(503)
  })
  it('closes at expiry and rejects production host before fetching assets', async () => {
    const env = makeEnv()
    expect((await handlePhotoStagingRequest(request(), env, { now: () => now + 86400000 })).status).toBe(410)
    const other = new Request('https://kaimono-baton-handwriting-import.example.workers.dev/', { headers: { Authorization: auth } })
    expect((await handlePhotoStagingRequest(other, env, deps)).status).toBe(421)
    expect(env.ASSETS.fetch).not.toHaveBeenCalled()
  })
  it.each(['Basic invalid!', `Basic ${btoa('other:' + password)}`, `Basic ${btoa('staging:incorrect')}`, 'Bearer fixture'])('rejects malformed or incorrect credentials', async (Authorization) => {
    expect((await handlePhotoStagingRequest(request('/', { Authorization }), makeEnv(), deps)).status).toBe(401)
  })
  it('strips credentials/cookies before assets, and prevents caching/indexing on every response', async () => {
    const env = makeEnv()
    const result = await handlePhotoStagingRequest(request('/', { Authorization: auth, Cookie: 'fixture=synthetic' }), env, deps)
    expect(result.status).toBe(200)
    const forwarded = env.ASSETS.fetch.mock.calls[0][0] as Request
    expect(forwarded.headers.has('Authorization')).toBe(false)
    expect(forwarded.headers.has('Cookie')).toBe(false)
    for (const response of [result, await handlePhotoStagingRequest(request('/', {}), env, deps)]) {
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(response.headers.get('X-Robots-Tag')).toContain('noindex')
      expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
    }
  })
  it('only allows photo API and GET/HEAD assets', async () => {
    for (const path of ['/v1/shared-requests', '/v1/handwriting/analyze', '/v1/manual-validation/session']) {
      expect((await handlePhotoStagingRequest(request(path), makeEnv(), deps)).status).toBe(404)
    }
    expect((await handlePhotoStagingRequest(request('/', { Authorization: auth }, 'POST'), makeEnv(), deps)).status).toBe(405)
  })
  it('clamps the API environment and handles same-origin GET without an Origin header', async () => {
    const photoHandler = vi.fn(async (_request: Request, _env: WorkerEnv) => new Response('fixture'))
    const env = { ...makeEnv(), GEMINI_API_KEY: 'must-not-forward', SHARED_REQUEST_API_ENABLED: 'true', ALLOWED_ORIGINS: 'https://wrong.example', DIAGNOSTIC_MODE: 'true' }
    const result = await handlePhotoStagingRequest(request('/v1/photos/p1_' + 'a'.repeat(32)), env, { ...deps, photoHandler })
    expect(result.status).toBe(200)
    const [forwarded, forwardedEnv] = photoHandler.mock.calls[0] as unknown as [Request, WorkerEnv]
    expect(forwarded.headers.get('Origin')).toBe(origin)
    expect(forwarded.headers.has('Authorization')).toBe(false)
    expect(forwardedEnv).toEqual({ PHOTO_API_ENABLED: 'true', ALLOWED_ORIGINS: origin, TURNSTILE_SECRET_KEY: 'fixture-only', PHOTO_OBJECTS: env.PHOTO_OBJECTS })
  })
  it('requires the exact Origin for uploads; refuses foreign Origin/fetch-site even after authentication', async () => {
    const photoHandler = vi.fn()
    const cases: Record<string, string>[] = [{}, { Origin: 'https://wrong.example' }, { Origin: origin, 'Sec-Fetch-Site': 'cross-site' }]
    for (const headers of cases) {
      const result = await handlePhotoStagingRequest(request('/v1/photos/batch', { Authorization: auth, ...headers }, 'POST'), makeEnv(), { ...deps, photoHandler })
      expect(result.status).toBe(403)
    }
    expect(photoHandler).not.toHaveBeenCalled()
  })
})
