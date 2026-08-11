// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const token = `mv1_${'A'.repeat(32)}`

describe('manual validation UI gate', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true
    vi.stubEnv('VITE_MANUAL_VALIDATION_ENABLED', 'true')
    vi.stubEnv(
      'VITE_HANDWRITING_IMPORT_ENDPOINT',
      'https://worker.example/',
    )
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'public-site-key')
    vi.stubEnv('VITE_PRODUCT_PHOTOS_ENABLED', 'false')
    vi.stubEnv('VITE_LIVE_REQUESTS_ENABLED', 'false')
    window.localStorage.clear()
    window.sessionStorage.clear()
    Object.defineProperty(window, 'scrollTo', {
      configurable: true,
      value: vi.fn(),
    })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    window.localStorage.clear()
    window.sessionStorage.clear()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  async function renderAt(sessionToken: string) {
    window.history.replaceState(
      {},
      '',
      `/?manualValidationSessionId=${sessionToken}#/create`,
    )
    await act(async () => {
      root.render(<App />)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  it('shows photo and v5 controls only after the Worker verifies the session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          schemaVersion: 1,
          productPhotosEnabled: true,
          liveRequestsEnabled: true,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }),
      ),
    )
    await renderAt(token)

    expect(container.querySelector('.request-sharing-mode')).not.toBeNull()
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('.detail-toggle')
        ?.click()
      await Promise.resolve()
    })
    expect(container.querySelector('.product-photo-attachment')).not.toBeNull()
    expect(window.location.href).not.toContain(token)
    expect(JSON.stringify(window.history.state)).not.toContain(token)
    expect(
      [...Array(window.localStorage.length)].map((_, index) =>
        window.localStorage.getItem(window.localStorage.key(index) ?? ''),
      ).join(''),
    ).not.toContain(token)
  })

  it('keeps the normal UI closed when verification fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { code: 'VALIDATION_SESSION_INVALID' },
          { status: 403 },
        ),
      ),
    )
    await renderAt(token)

    expect(container.querySelector('.request-sharing-mode')).toBeNull()
    expect(container.querySelector('.product-photo-attachment')).toBeNull()
    expect(window.sessionStorage.length).toBe(0)
  })

  it('does not reject a gated v5 deep link while session verification is pending', async () => {
    const requestToken = `r1_${'R'.repeat(32)}`
    window.history.replaceState(
      {},
      '',
      `/?manualValidationSessionId=${token}#/r/${requestToken}`,
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    )
    await act(async () => {
      root.render(<App />)
      await Promise.resolve()
    })
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      '検証セッションを確認中',
    )
    expect(container.querySelector('h1')).toBeNull()
  })

  it('renders the normal application without touching a blocked sessionStorage when the build gate is off', async () => {
    vi.stubEnv('VITE_MANUAL_VALIDATION_ENABLED', 'false')
    const descriptor = Object.getOwnPropertyDescriptor(
      window,
      'sessionStorage',
    )
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() {
        throw new DOMException('blocked', 'SecurityError')
      },
    })
    try {
      window.history.replaceState({}, '', '/#/')
      await act(async () => {
        root.render(<App />)
        await Promise.resolve()
      })
      expect(container.querySelector('h1')).not.toBeNull()
    } finally {
      if (descriptor) {
        Object.defineProperty(window, 'sessionStorage', descriptor)
      }
    }
  })
})
