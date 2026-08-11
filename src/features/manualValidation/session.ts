import { useEffect, useMemo, useState } from 'react'

export const MANUAL_VALIDATION_SESSION_HEADER =
  'X-Otsukai-Validation-Session'
export const MANUAL_VALIDATION_SESSION_PARAMETER =
  'manualValidationSessionId'
export const MANUAL_VALIDATION_SESSION_STORAGE_KEY =
  'otsukai:manualValidationSession:v1'

const SESSION_PATTERN = /^mv1_[A-Za-z0-9_-]{32}$/u

type ManualValidationEnvironment = {
  VITE_MANUAL_VALIDATION_ENABLED?: string
  VITE_HANDWRITING_IMPORT_ENDPOINT?: string
}

export type ManualValidationSession = {
  token: string
  expiresAt: string
}

export type ManualValidationAccess =
  | { status: 'inactive' }
  | { status: 'checking' }
  | { status: 'active'; session: ManualValidationSession }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAllowedEndpoint(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' ||
      (url.protocol === 'http:' &&
        (url.hostname === 'localhost' || url.hostname === '127.0.0.1'))
    )
  } catch {
    return false
  }
}

export function isManualValidationSessionToken(value: string): boolean {
  return SESSION_PATTERN.test(value)
}

export function manualValidationSessionUrl(endpoint: string): string {
  const base = endpoint.endsWith('/') ? endpoint : `${endpoint}/`
  return new URL('v1/manual-validation/session', base).toString()
}

export function readManualValidationSession(
  storage: Pick<Storage, 'getItem'> | undefined,
  now: number = Date.now(),
): ManualValidationSession | undefined {
  try {
    if (!storage) {
      return undefined
    }
    const raw = storage.getItem(MANUAL_VALIDATION_SESSION_STORAGE_KEY)
    if (!raw) {
      return undefined
    }
    const value: unknown = JSON.parse(raw)
    if (
      !isRecord(value) ||
      Object.keys(value).sort().join(',') !== 'expiresAt,token' ||
      typeof value.token !== 'string' ||
      !isManualValidationSessionToken(value.token) ||
      typeof value.expiresAt !== 'string' ||
      !Number.isFinite(Date.parse(value.expiresAt)) ||
      Date.parse(value.expiresAt) <= now
    ) {
      return undefined
    }
    return { token: value.token, expiresAt: value.expiresAt }
  } catch {
    return undefined
  }
}

export function writeManualValidationSession(
  storage: Pick<Storage, 'setItem'> | undefined,
  session: ManualValidationSession,
): void {
  try {
    storage?.setItem(
      MANUAL_VALIDATION_SESSION_STORAGE_KEY,
      JSON.stringify({ token: session.token, expiresAt: session.expiresAt }),
    )
  } catch {
    // A blocked storage API keeps the verified session memory-only.
  }
}

export function clearManualValidationSession(
  storage: Pick<Storage, 'removeItem'> | undefined,
): void {
  try {
    storage?.removeItem(MANUAL_VALIDATION_SESSION_STORAGE_KEY)
  } catch {
    // Storage failures must not affect the normal application.
  }
}

function availableSessionStorage(): Storage | undefined {
  try {
    return window.sessionStorage
  } catch {
    return undefined
  }
}

export function captureManualValidationToken(
  location: Pick<Location, 'href'>,
  history: Pick<History, 'replaceState' | 'state'>,
): string | undefined {
  const url = new URL(location.href)
  const token = url.searchParams.get(MANUAL_VALIDATION_SESSION_PARAMETER)
  if (token !== null) {
    url.searchParams.delete(MANUAL_VALIDATION_SESSION_PARAMETER)
    history.replaceState(history.state, '', url.toString())
  }
  return token && isManualValidationSessionToken(token) ? token : undefined
}

export function addManualValidationSessionToBaseUrl(
  baseUrl: string,
  token?: string,
): string {
  if (!token || !isManualValidationSessionToken(token)) {
    return baseUrl
  }
  const url = new URL(baseUrl)
  url.searchParams.set(MANUAL_VALIDATION_SESSION_PARAMETER, token)
  return url.toString()
}

export async function verifyManualValidationSession(
  endpoint: string,
  token: string,
  fetchImplementation: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<ManualValidationSession | undefined> {
  if (!isAllowedEndpoint(endpoint) || !isManualValidationSessionToken(token)) {
    return undefined
  }
  try {
    const response = await fetchImplementation(
      manualValidationSessionUrl(endpoint),
      {
        method: 'GET',
        headers: { [MANUAL_VALIDATION_SESSION_HEADER]: token },
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal,
      },
    )
    if (
      response.status !== 200 ||
      !response.headers
        .get('Content-Type')
        ?.toLowerCase()
        .startsWith('application/json')
    ) {
      return undefined
    }
    const value: unknown = await response.json()
    if (
      !isRecord(value) ||
      Object.keys(value).sort().join(',') !==
        'expiresAt,liveRequestsEnabled,productPhotosEnabled,schemaVersion' ||
      value.schemaVersion !== 1 ||
      value.productPhotosEnabled !== true ||
      value.liveRequestsEnabled !== true ||
      typeof value.expiresAt !== 'string' ||
      !Number.isFinite(Date.parse(value.expiresAt)) ||
      Date.parse(value.expiresAt) <= Date.now()
    ) {
      return undefined
    }
    return { token, expiresAt: value.expiresAt }
  } catch {
    return undefined
  }
}

export function isManualValidationBuildEnabled(
  environment: ManualValidationEnvironment,
): boolean {
  return (
    environment.VITE_MANUAL_VALIDATION_ENABLED?.trim().toLowerCase() ===
      'true' &&
    isAllowedEndpoint(
      environment.VITE_HANDWRITING_IMPORT_ENDPOINT?.trim() ?? '',
    )
  )
}

export function useManualValidationSession(
  environment: ManualValidationEnvironment = import.meta.env,
): ManualValidationAccess {
  const enabled = isManualValidationBuildEnabled(environment)
  const endpoint = environment.VITE_HANDWRITING_IMPORT_ENDPOINT?.trim() ?? ''
  const [candidate] = useState(() => {
    const fromUrl = captureManualValidationToken(
      window.location,
      window.history,
    )
    if (!enabled) {
      return fromUrl
    }
    return (
      fromUrl ??
      readManualValidationSession(availableSessionStorage())?.token
    )
  })
  const [access, setAccess] = useState<ManualValidationAccess>(() =>
    enabled && candidate
      ? { status: 'checking' }
      : { status: 'inactive' },
  )

  useEffect(() => {
    if (!enabled) {
      setAccess({ status: 'inactive' })
      return
    }
    if (!candidate) {
      clearManualValidationSession(availableSessionStorage())
      setAccess({ status: 'inactive' })
      return
    }
    setAccess({ status: 'checking' })
    const controller = new AbortController()
    void verifyManualValidationSession(
      endpoint,
      candidate,
      fetch,
      controller.signal,
    ).then((verified) => {
      if (!verified) {
        clearManualValidationSession(availableSessionStorage())
        setAccess({ status: 'inactive' })
        return
      }
      writeManualValidationSession(availableSessionStorage(), verified)
      setAccess({ status: 'active', session: verified })
    })
    return () => controller.abort()
  }, [candidate, enabled, endpoint])

  useEffect(() => {
    if (access.status !== 'active') {
      return
    }
    const remaining = Date.parse(access.session.expiresAt) - Date.now()
    if (remaining <= 0) {
      clearManualValidationSession(availableSessionStorage())
      setAccess({ status: 'inactive' })
      return
    }
    const timeout = window.setTimeout(() => {
      clearManualValidationSession(availableSessionStorage())
      setAccess({ status: 'inactive' })
    }, Math.min(remaining, 2_147_483_647))
    return () => window.clearTimeout(timeout)
  }, [access])

  return useMemo(() => access, [access])
}
