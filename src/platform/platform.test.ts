import { rememberFixedRequest, loadFixedRequest } from './fixedRequestResume'
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Capacitor } from '@capacitor/core'
import { Share } from '@capacitor/share'
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { getRequestBaseUrl, getRecoveryBaseUrl, getPublicCurrentUrl, resolveRequestBaseUrl, resolvePublicCurrentUrl, PUBLIC_WEB_BASE } from './runtime'
import { parseIncomingLink, MAX_INCOMING_LINK_CHARS } from './incomingLink'
import { exportNativeCatalogJson, shareNativeText } from './nativeShare'
import { handleAndroidBack, handleNativeLinkClick, initializeNativeRuntime, openIncomingLink } from './nativeRuntime'
import { isNativeShareAvailable, shareText } from '../utils/shareText'
import { getProductPhotoConfig } from '../features/productPhotos/config'
import { getLiveRequestConfig } from '../features/liveRequests/config'
import { getHandwritingImportConfig } from '../features/handwriting/config'
import { PUBLISHED_V1_REQUEST_FIXTURE, PUBLISHED_V2_REQUEST_FIXTURE, PUBLISHED_V3_REQUEST_FIXTURE, PUBLISHED_CATALOG_RECOVERY_FIXTURE } from '../testFixtures/publishedFormats'
import { compressToEncodedURIComponent } from 'lz-string'
import { encodeCompactRequestV4 } from '../utils/compactRequestV4'

vi.mock('@capacitor/share', () => ({ Share: { share: vi.fn() } }))
vi.mock('@capacitor/filesystem', () => ({
  Filesystem: { writeFile: vi.fn() }, Directory: { Cache: 'CACHE' }, Encoding: { UTF8: 'utf8' },
}))
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn(), getLaunchUrl: vi.fn(), minimizeApp: vi.fn() } }))
vi.mock('@capacitor/browser', () => ({ Browser: { open: vi.fn() } }))

const fixedHash = `#/l/${PUBLISHED_V3_REQUEST_FIXTURE}`
const fixedUrl = `${PUBLIC_WEB_BASE}?openExternalBrowser=1${fixedHash}`
const native = () => vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true)
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); document.documentElement.classList.remove('native-app') })

describe('Web/native outgoing boundary', () => {
  it('keeps Web bases including project paths, but never emits local native origins', () => {
    const location = { origin: 'http://localhost', pathname: '/some-project/' }
    expect(resolveRequestBaseUrl(location, false)).toBe('http://localhost/some-project/')
    expect(resolvePublicCurrentUrl('https://example.org/project/?q=1#/about', false)).toBe('https://example.org/project/?q=1#/about')
    for (const href of ['https://localhost/#/list?data=abc', 'capacitor://localhost/#/about', 'file:///index.html#/products']) {
      expect(resolvePublicCurrentUrl(href, true)).toBe(PUBLIC_WEB_BASE + new URL(href).hash)
    }
    expect(resolveRequestBaseUrl(location, true)).toBe(PUBLIC_WEB_BASE)
  })
  it('applies canonical bases to request, recovery and purchaser links only in native', () => {
    window.history.replaceState({}, '', '/project/?keep=1#/products')
    expect(getRequestBaseUrl()).toBe(`${window.location.origin}/project/`)
    expect(getRecoveryBaseUrl()).toBe(`${window.location.origin}/project/?keep=1`)
    native()
    expect(getRequestBaseUrl()).toBe(PUBLIC_WEB_BASE)
    expect(getRecoveryBaseUrl()).toBe(PUBLIC_WEB_BASE)
    expect(getPublicCurrentUrl()).toBe(`${PUBLIC_WEB_BASE}#/products`)
  })
  it('disables optional services even if environment flags or manual sessions request them', () => {
    native()
    for (const key of ['VITE_PRODUCT_PHOTOS_ENABLED', 'VITE_LIVE_REQUESTS_ENABLED', 'VITE_HANDWRITING_IMPORT_ENABLED']) vi.stubEnv(key, 'true')
    expect(getProductPhotoConfig('test')).toEqual({ enabled: false, endpoint: '', turnstileSiteKey: '' })
    expect(getLiveRequestConfig('test').enabled).toBe(false)
    expect(getHandwritingImportConfig()).toEqual({ enabled: false, diagnosticsEnabled: false, endpoint: '', turnstileSiteKey: '' })
  })
})

describe('strict incoming native links', () => {
  it('accepts published v1/v2/v3, recovery, v5 routes without altering the hash', () => {
    for (const hash of [
      `#/list?data=${encodeURIComponent(PUBLISHED_V1_REQUEST_FIXTURE)}`,
      `#/l/${PUBLISHED_V2_REQUEST_FIXTURE}`, fixedHash,
      `#/catalog/restore/${PUBLISHED_CATALOG_RECOVERY_FIXTURE}`,
      `#/r/r1_${'a'.repeat(32)}`, `#/manage/r1_${'a'.repeat(32)}/e1_${'b'.repeat(43)}`,
    ]) expect(parseIncomingLink(PUBLIC_WEB_BASE + '?openExternalBrowser=1' + hash)).toBe(hash)
    expect(parseIncomingLink(fixedUrl.trim())).toBe(fixedHash)
  })
  it('validates v4 data using the current shared decoder', () => {
    const encoded = compressToEncodedURIComponent(JSON.stringify([4, 'mobile-test', 1780000000000, [['milk', '牛乳', '本', 'eggs-dairy', 1, '']], []]))
    const valid = encodeCompactRequestV4([4, 'mobile-test', '', [[0, 0, '1']], [[0, 'p1_AAECAwQFBgcICQoLDA0ODxAREhMUFRYX']]])
    expect(parseIncomingLink(`${PUBLIC_WEB_BASE}#/l/${valid}`)).toBe(`#/l/${valid}`)
    // Invalid tuple shape is refused rather than just matching a route prefix.
    expect(parseIncomingLink(`${PUBLIC_WEB_BASE}#/l/${encoded}`)).toBeNull()
  })
  it.each([
    'http://plain-relay.github.io/kaimono-baton/',
    'https://plain-relay.github.io.evil.test/kaimono-baton/',
    'https://evil.test/kaimono-baton/', 'capacitor://localhost/',
    'https://user:pass@plain-relay.github.io/kaimono-baton/',
    'https://plain-relay.github.io:444/kaimono-baton/',
    'https://plain-relay.github.io/other/',
    'https://plain-relay.github.io/kaimono-baton',
  ])('refuses disallowed origins, credentials and paths', base => {
    expect(parseIncomingLink(base + fixedHash)).toBeNull()
  })
  it.each([
    '?redirect=https://evil.test', '?openExternalBrowser=0',
    '?openExternalBrowser=1&openExternalBrowser=1',
  ])('refuses unknown or duplicate query parameters', query => {
    expect(parseIncomingLink(PUBLIC_WEB_BASE + query + fixedHash)).toBeNull()
  })
  it.each(['#/', '#/about', '#/create', '#/l/', '#/l/bad', '#/l/bad?x=1', '#/l/bad#oops', '#/list', '#/list?data=bad', '#/catalog/restore/bad', '#/r/invalid', `#/r/r1_${'a'.repeat(32)}?x=1`, `#/manage/r1_${'a'.repeat(32)}/e1_${'b'.repeat(43)}/extra`])('refuses invalid hash and payload: %s', hash => {
    expect(parseIncomingLink(PUBLIC_WEB_BASE + hash)).toBeNull()
  })
  it('bounds input and rejects controls, malformed URLs and ignored query suffixes', () => {
    for (const input of ['', 'invalid', 'x'.repeat(MAX_INCOMING_LINK_CHARS + 1), fixedUrl + '\n', PUBLIC_WEB_BASE + fixedHash + '?ignored=1', `${PUBLIC_WEB_BASE}#/list?data=${PUBLISHED_V1_REQUEST_FIXTURE}&data=bad`, `${PUBLIC_WEB_BASE}#/list?data=${PUBLISHED_V1_REQUEST_FIXTURE}&ignored=1`]) expect(parseIncomingLink(input)).toBeNull()
  })
})

describe('native share and private cache export', () => {
  it('shares exact text only, without copying or constructing an OS-specific URL', async () => {
    native()
    const spy = vi.spyOn(Share, 'share').mockResolvedValue({})
    expect(isNativeShareAvailable()).toBe(true)
    expect(await shareText({ title: 'test', text: 'test text' })).toBe('shared')
    expect(spy).toHaveBeenCalledWith({ title: 'test', text: 'test text' })
  })
  it('handles cancellation and all plugin failures without clipboard fallback', async () => {
    native()
    const writeText = vi.fn()
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const spy = vi.spyOn(Share, 'share').mockRejectedValue(new Error('Share canceled'))
    expect(await shareText({ title: 'test', text: 'test' })).toBe('cancelled')
    spy.mockRejectedValue(new Error('unavailable'))
    expect(await shareNativeText({ title: 'test', text: 'test' })).toBe('failed')
    spy.mockRejectedValue(null)
    expect(await shareNativeText({ title: 'test', text: 'test' })).toBe('failed')
    expect(writeText).not.toHaveBeenCalled()
  })
  it('exports only a generated JSON file in app cache and keeps it for delayed OS consumers', async () => {
    const write = vi.spyOn(Filesystem, 'writeFile').mockResolvedValue({ uri: 'file:///private/cache/catalog-backup.json' })
    const share = vi.spyOn(Share, 'share').mockResolvedValue({})
    expect(await exportNativeCatalogJson({ json: '{}', fileName: 'test.json' })).toBe('shared')
    expect(write).toHaveBeenCalledWith({ path: 'catalog-backups/catalog-backup.json', data: '{}', directory: Directory.Cache, encoding: Encoding.UTF8, recursive: true })
    expect(share).toHaveBeenCalledWith({ title: 'test.json', files: ['file:///private/cache/catalog-backup.json'] })
    write.mockRejectedValue(new Error('disk full'))
    expect(await exportNativeCatalogJson({ json: '{}', fileName: 'test.json' })).toBe('failed')
  })
})

describe('native lifecycle and external navigation', () => {
  it('does nothing in browsers', async () => {
    const launch = vi.spyOn(App, 'getLaunchUrl')
    await initializeNativeRuntime()
    expect(launch).not.toHaveBeenCalled()
  })
  it('opens only validated incoming links and reports generic errors without URLs', () => {
    const error = vi.fn()
    window.addEventListener('native-link-error', error)
    openIncomingLink(fixedUrl)
    expect(window.location.hash).toBe(fixedHash)
    openIncomingLink('https://evil.test/')
    expect(error).toHaveBeenCalledOnce()
    window.removeEventListener('native-link-error', error)
  })
  it('handles Android back without clearing local state', () => {
    const minimize = vi.spyOn(App, 'minimizeApp').mockResolvedValue()
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    window.location.hash = '/'
    handleAndroidBack(true)
    expect(minimize).toHaveBeenCalledOnce()
    window.location.hash = '/products'
    handleAndroidBack(true)
    expect(back).toHaveBeenCalledOnce()
    handleAndroidBack(false)
    expect(window.location.hash).toBe('#/')
  })
  it('opens HTTPS links in an isolated browser and rejects unsafe schemes', async () => {
    const browser = vi.spyOn(Browser, 'open').mockResolvedValue()
    for (const href of ['https://example.org/policy', 'javascript:alert(1)', 'https://user:pass@example.org']) {
      const a = document.createElement('a'); a.href = href
      const event = { target: a, preventDefault: vi.fn() } as unknown as MouseEvent
      await handleNativeLinkClick(event)
      expect(event.preventDefault).toHaveBeenCalledOnce()
    }
    expect(browser).toHaveBeenCalledTimes(1)
    expect(browser).toHaveBeenCalledWith({ url: 'https://example.org/policy' })
    const local = document.createElement('a'); local.href = '#/'
    const event = { target: local, preventDefault: vi.fn() } as unknown as MouseEvent
    await handleNativeLinkClick(event)
    expect(event.preventDefault).not.toHaveBeenCalled()
    await handleNativeLinkClick({ target: document } as unknown as MouseEvent)
    const empty = document.createElement('a')
    await handleNativeLinkClick({ target: empty } as unknown as MouseEvent)
  })
  it('registers launch, foreground and back handlers, and contains plugin failures', async () => {
    native()
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android')
    const add = vi.spyOn(App, 'addListener').mockResolvedValue({ remove: async () => {} })
    vi.spyOn(App, 'getLaunchUrl').mockResolvedValue({ url: fixedUrl })
    await initializeNativeRuntime()
    expect(document.documentElement.classList.contains('native-app')).toBe(true)
    expect(add.mock.calls.map(call => call[0])).toEqual(['appUrlOpen', 'backButton'])
    expect(window.location.hash).toBe(fixedHash)
    add.mockRejectedValue(new Error('unavailable'))
    await expect(initializeNativeRuntime()).resolves.toBeUndefined()
  })
})

describe('native offline resume', () => {
  it('remembers only fixed requests and validates stored routes before reopening', () => {
    localStorage.clear()
    expect(loadFixedRequest()).toBeNull()
    rememberFixedRequest(fixedHash)
    expect(loadFixedRequest()).toBe(fixedHash)
    rememberFixedRequest('#/manage/secret')
    expect(loadFixedRequest()).toBe(fixedHash)
    rememberFixedRequest('#/l/invalid')
    expect(loadFixedRequest()).toBeNull()
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new Error('blocked') })
    expect(() => rememberFixedRequest(fixedHash)).not.toThrow()
    expect(loadFixedRequest()).toBeNull()
  })
})
