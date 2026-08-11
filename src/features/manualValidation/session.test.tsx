// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addManualValidationSessionToBaseUrl,
  captureManualValidationToken,
  clearManualValidationSession,
  isManualValidationSessionToken,
  MANUAL_VALIDATION_SESSION_HEADER,
  MANUAL_VALIDATION_SESSION_STORAGE_KEY,
  readManualValidationSession,
  useManualValidationSession,
  verifyManualValidationSession,
  writeManualValidationSession,
} from './session'

const token = `mv1_${'A'.repeat(32)}`
const endpoint = 'https://worker.example/'

function validResponse(expiresAt = new Date(Date.now() + 60_000).toISOString()) {
  return Response.json({
    schemaVersion: 1,
    productPhotosEnabled: true,
    liveRequestsEnabled: true,
    expiresAt,
  })
}

describe('manual validation browser session', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    window.history.replaceState({}, '', '/otsukai/#/create')
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function Probe({ enabled = true }: { enabled?: boolean }) {
    const access = useManualValidationSession({
      VITE_MANUAL_VALIDATION_ENABLED: enabled ? 'true' : 'false',
      VITE_HANDWRITING_IMPORT_ENDPOINT: endpoint,
    })
    return (
      <output data-status={access.status}>
        {access.status === 'active' ? access.session.expiresAt : ''}
      </output>
    )
  }

  it('accepts only the bounded validation token format', () => {
    expect(isManualValidationSessionToken(token)).toBe(true)
    expect(isManualValidationSessionToken('unsafe token')).toBe(false)
    expect(isManualValidationSessionToken(`mv1_${'A'.repeat(31)}`)).toBe(false)
  })

  it('removes the URL token without putting it into history state', () => {
    window.history.replaceState(
      { safe: true },
      '',
      `/otsukai/?manualValidationSessionId=${token}#/create`,
    )
    const captured = captureManualValidationToken(
      window.location,
      window.history,
    )
    expect(captured).toBe(token)
    expect(window.location.href).not.toContain(token)
    expect(window.history.state).toEqual({ safe: true })
  })

  it('verifies a strict finite response and sends the token only in the header', async () => {
    const fetchImplementation = vi.fn(async () => validResponse()) as typeof fetch
    const session = await verifyManualValidationSession(
      endpoint,
      token,
      fetchImplementation,
    )
    expect(session).toEqual({
      token,
      expiresAt: expect.any(String),
    })
    expect(fetchImplementation).toHaveBeenCalledWith(
      'https://worker.example/v1/manual-validation/session',
      expect.objectContaining({
        method: 'GET',
        headers: { [MANUAL_VALIDATION_SESSION_HEADER]: token },
        cache: 'no-store',
      }),
    )
  })

  it.each([
    Response.json({ code: 'VALIDATION_SESSION_INVALID' }, { status: 403 }),
    Response.json({
      schemaVersion: 1,
      productPhotosEnabled: true,
      liveRequestsEnabled: true,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      extra: token,
    }),
    Response.json({
      schemaVersion: 1,
      productPhotosEnabled: false,
      liveRequestsEnabled: true,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }),
  ])('rejects invalid or over-broad validation responses', async (response) => {
    await expect(
      verifyManualValidationSession(
        endpoint,
        token,
        vi.fn(async () => response.clone()) as typeof fetch,
      ),
    ).resolves.toBeUndefined()
  })

  it('enables only after verification, uses sessionStorage, and never writes localStorage', async () => {
    window.history.replaceState(
      {},
      '',
      `/otsukai/?manualValidationSessionId=${token}#/create`,
    )
    const localSet = vi.spyOn(window.localStorage, 'setItem')
    vi.stubGlobal('fetch', vi.fn(async () => validResponse()))

    await act(async () => {
      root.render(<Probe />)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.querySelector('output')?.dataset.status).toBe('active')
    expect(window.location.href).not.toContain(token)
    expect(localSet).not.toHaveBeenCalled()
    const raw = window.sessionStorage.getItem(
      MANUAL_VALIDATION_SESSION_STORAGE_KEY,
    )
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw ?? '')).toEqual({
      token,
      expiresAt: expect.any(String),
    })
  })

  it('does not verify or persist when the build flag is off', async () => {
    window.history.replaceState(
      {},
      '',
      `/otsukai/?manualValidationSessionId=${token}#/create`,
    )
    const fetchImplementation = vi.fn()
    vi.stubGlobal('fetch', fetchImplementation)
    await act(async () => {
      root.render(<Probe enabled={false} />)
      await Promise.resolve()
    })
    expect(fetchImplementation).not.toHaveBeenCalled()
    expect(container.querySelector('output')?.dataset.status).toBe('inactive')
    expect(window.location.href).not.toContain(token)
    expect(window.sessionStorage.length).toBe(0)
    expect(window.localStorage.length).toBe(0)
  })

  it('restores only an unexpired exact sessionStorage shape', () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString()
    window.sessionStorage.setItem(
      MANUAL_VALIDATION_SESSION_STORAGE_KEY,
      JSON.stringify({ token, expiresAt }),
    )
    expect(readManualValidationSession(window.sessionStorage)).toEqual({
      token,
      expiresAt,
    })
    window.sessionStorage.setItem(
      MANUAL_VALIDATION_SESSION_STORAGE_KEY,
      JSON.stringify({ token, expiresAt, productName: 'forbidden' }),
    )
    expect(
      readManualValidationSession(window.sessionStorage),
    ).toBeUndefined()
  })

  it('fails storage operations closed without throwing or logging token data', () => {
    const blockedStorage = {
      getItem: () => {
        throw new DOMException('blocked', 'SecurityError')
      },
      setItem: () => {
        throw new DOMException('blocked', 'SecurityError')
      },
      removeItem: () => {
        throw new DOMException('blocked', 'SecurityError')
      },
    }
    expect(readManualValidationSession(blockedStorage)).toBeUndefined()
    expect(() =>
      writeManualValidationSession(blockedStorage, {
        token,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    ).not.toThrow()
    expect(() =>
      clearManualValidationSession(blockedStorage),
    ).not.toThrow()
  })

  it('adds the token only to explicitly generated validation share bases', () => {
    expect(
      addManualValidationSessionToBaseUrl(
        'https://plain-relay.github.io/kaimono-baton/',
        token,
      ),
    ).toBe(
      `https://plain-relay.github.io/kaimono-baton/?manualValidationSessionId=${token}`,
    )
    expect(
      addManualValidationSessionToBaseUrl(
        'https://plain-relay.github.io/kaimono-baton/',
      ),
    ).toBe('https://plain-relay.github.io/kaimono-baton/')
  })
})
