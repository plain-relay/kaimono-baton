import type { WorkerEnv } from './config'
import { handlePhotoApiRequest, isPhotoApiRoute } from './photoHandler'

// No environment override: this entry cannot serve the production host.
const STAGING_ORIGIN = 'https://kaimono-baton-photo-staging.plainrelay01.workers.dev'
const MAX_WINDOW_MS = 48 * 60 * 60 * 1000

export type PhotoStagingEnv = Pick<WorkerEnv, 'PHOTO_OBJECTS' | 'TURNSTILE_SECRET_KEY'> & {
  ASSETS?: { fetch(request: Request): Promise<Response> }
  PHOTO_STAGING_ENABLED?: string
  PHOTO_STAGING_PASSWORD?: string
  PHOTO_STAGING_EXPIRES_AT?: string
}

type Dependencies = {
  now?: () => number
  photoHandler?: typeof handlePhotoApiRequest
  // Only used by the local workerd test shim, never a deployed env variable.
  localTestOrigin?: string
}

function protect(response: Response): Response {
  const headers = new Headers(response.headers)
  headers.set('Cache-Control', 'no-store')
  headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive')
  headers.set('Referrer-Policy', 'no-referrer')
  headers.set('X-Content-Type-Options', 'nosniff')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

function reject(status: number): Response {
  const headers = new Headers({ 'Content-Type': 'text/plain; charset=utf-8' })
  if (status === 401) headers.set('WWW-Authenticate', 'Basic realm="Kaimono photo staging", charset="UTF-8"')
  return new Response(status === 410 ? '検証期間が終了しました。' : '写真検証環境は現在利用できません。', { status, headers })
}

async function authenticated(request: Request, password: string): Promise<boolean> {
  const header = request.headers.get('Authorization') ?? ''
  if (header.length > 512 || !header.startsWith('Basic ')) return false
  let supplied: string
  try { supplied = atob(header.slice(6)) } catch { return false }
  const encode = new TextEncoder()
  const [actual, expected] = await Promise.all([
    crypto.subtle.digest('SHA-256', encode.encode(supplied)),
    crypto.subtle.digest('SHA-256', encode.encode(`staging:${password}`)),
  ])
  const a = new Uint8Array(actual)
  const b = new Uint8Array(expected)
  let difference = 0
  for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index]
  return difference === 0
}

async function route(request: Request, env: PhotoStagingEnv, dependencies: Dependencies): Promise<Response> {
  const url = new URL(request.url)
  const origin = dependencies.localTestOrigin ?? STAGING_ORIGIN
  if (url.origin !== origin) return reject(421)
  const now = (dependencies.now ?? Date.now)()
  const expiry = Date.parse(env.PHOTO_STAGING_EXPIRES_AT ?? '')
  if (env.PHOTO_STAGING_ENABLED !== 'true' ||
    !/^[A-Za-z0-9_-]{32,128}$/.test(env.PHOTO_STAGING_PASSWORD ?? '') ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(env.PHOTO_STAGING_EXPIRES_AT ?? '') ||
    !Number.isFinite(expiry) || expiry - now > MAX_WINDOW_MS ||
    !env.ASSETS || !env.PHOTO_OBJECTS || !env.TURNSTILE_SECRET_KEY?.trim()) return reject(503)
  if (expiry <= now) return reject(410)
  if (!await authenticated(request, env.PHOTO_STAGING_PASSWORD!)) return reject(401)

  const headers = new Headers(request.headers)
  headers.delete('Authorization')
  headers.delete('Cookie')
  if (isPhotoApiRoute(url.pathname)) {
    const suppliedOrigin = headers.get('Origin')
    if ((suppliedOrigin && suppliedOrigin !== origin) ||
      headers.get('Sec-Fetch-Site') === 'cross-site' ||
      (request.method !== 'GET' && suppliedOrigin !== origin)) return reject(403)
    // Same-origin fetch GET legitimately omits Origin. The outer host/auth gates
    // have already succeeded; never relax the public photo handler's CORS rule.
    headers.set('Origin', origin)
    return (dependencies.photoHandler ?? handlePhotoApiRequest)(new Request(request, { headers }), {
      PHOTO_API_ENABLED: 'true', ALLOWED_ORIGINS: origin,
      TURNSTILE_SECRET_KEY: env.TURNSTILE_SECRET_KEY, PHOTO_OBJECTS: env.PHOTO_OBJECTS,
    })
  }
  if (url.pathname.startsWith('/v1/')) return reject(404)
  if (request.method !== 'GET' && request.method !== 'HEAD') return reject(405)
  return env.ASSETS.fetch(new Request(request, { headers }))
}

export async function handlePhotoStagingRequest(request: Request, env: PhotoStagingEnv, dependencies: Dependencies = {}): Promise<Response> {
  try { return protect(await route(request, env, dependencies)) }
  catch { return protect(reject(503)) }
}

// Worker entry exports must be supported entrypoints, never string constants.
export { PhotoObject } from './photoObject'
export default { fetch: (request: Request, env: PhotoStagingEnv) => handlePhotoStagingRequest(request, env) }
