import { useCallback, useEffect, useRef, useState } from 'react'
import { diffLiveRequestSnapshots } from './snapshot'
import {
  loadLiveRequestCachedState,
  saveLiveRequestCachedState,
} from './storage'
import type {
  LiveRequestApi,
  LiveRequestCachedState,
  LiveRequestPendingChange,
  LiveRequestSnapshot,
} from './types'

export type LiveRequestSyncStatus =
  | 'loading'
  | 'current'
  | 'checking'
  | 'stale'
  | 'expired'
  | 'missing'

type UseLiveRequestSyncOptions = {
  enabled: boolean
  requestToken: string
  api?: LiveRequestApi
  pollIntervalMs?: number
  storage?: Storage
  now?: () => number
}

type SyncState = {
  snapshot?: LiveRequestSnapshot
  etag?: string
  pendingChanges: LiveRequestPendingChange[]
  status: LiveRequestSyncStatus
  cachePersistenceFailed: boolean
}

function initialState(
  enabled: boolean,
  requestToken: string,
  storage?: Storage,
): SyncState {
  if (!enabled || !storage) {
    return {
      pendingChanges: [],
      status: enabled ? 'loading' : 'missing',
      cachePersistenceFailed: false,
    }
  }
  const cached = loadLiveRequestCachedState(requestToken, storage)
  return cached
    ? {
        snapshot: cached.snapshot,
        etag: cached.etag,
        pendingChanges: cached.pendingChanges,
        status: 'checking',
        cachePersistenceFailed: false,
      }
    : {
        pendingChanges: [],
        status: 'loading',
        cachePersistenceFailed: false,
      }
}

function isExpiredSnapshot(
  snapshot: LiveRequestSnapshot | undefined,
  now: () => number,
): boolean {
  return Boolean(
    snapshot && Date.parse(snapshot.expiresAt) <= now(),
  )
}

export function useLiveRequestSync({
  enabled,
  requestToken,
  api,
  pollIntervalMs = 45_000,
  storage = typeof window === 'undefined' ? undefined : window.localStorage,
  now = Date.now,
}: UseLiveRequestSyncOptions) {
  const [state, setState] = useState<SyncState>(() =>
    initialState(enabled, requestToken, storage),
  )
  const stateRef = useRef(state)
  const inFlightRef = useRef<Promise<SyncState>>()
  const controllerRef = useRef<AbortController>()
  const mountedRef = useRef(true)

  const commitState = useCallback((next: SyncState) => {
    stateRef.current = next
    if (mountedRef.current) {
      setState(next)
    }
  }, [])

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    controllerRef.current?.abort()
    controllerRef.current = undefined
    inFlightRef.current = undefined
    mountedRef.current = true
    commitState(initialState(enabled, requestToken, storage))
  }, [commitState, enabled, requestToken, storage])

  const persist = useCallback(
    (
      snapshot: LiveRequestSnapshot,
      etag: string,
      pendingChanges: LiveRequestPendingChange[],
    ): boolean => {
      if (!storage) {
        return false
      }
      const cached: LiveRequestCachedState = {
        schemaVersion: 1,
        requestToken,
        etag,
        snapshot,
        pendingChanges,
        savedAt: new Date(now()).toISOString(),
      }
      return saveLiveRequestCachedState(cached, storage)
    },
    [now, requestToken, storage],
  )

  const getCurrentState = useCallback(() => stateRef.current, [])

  const refresh = useCallback((): Promise<SyncState> => {
    if (!enabled || !api) {
      return Promise.resolve(stateRef.current)
    }
    if (inFlightRef.current) {
      return inFlightRef.current
    }
    const controller = new AbortController()
    let timedOut = false
    let timeout: number | undefined
    controllerRef.current = controller
    const current = stateRef.current
    commitState({
      ...current,
      status: current.snapshot ? 'checking' : 'loading',
    })
    const operation = (async () => {
      try {
        const interrupted = new Promise<never>((_, reject) => {
          controller.signal.addEventListener('abort', () => reject(new Error('interrupted')), { once: true })
          timeout = window.setTimeout(() => {
            timedOut = true
            controller.abort()
          }, 10_000)
        })
        const result = await Promise.race([
          api.get(requestToken, {
            ...(current.etag ? { etag: current.etag } : {}),
            signal: controller.signal,
          }),
          interrupted,
        ])
        if (controller.signal.aborted || !mountedRef.current) {
          return stateRef.current
        }
        const latest = stateRef.current
        if (result.status === 'not-modified') {
          commitState({ ...latest, etag: result.etag, status: 'current' })
          return stateRef.current
        }
        if (result.status === 'expired') {
          commitState({ ...latest, status: 'expired' })
          return stateRef.current
        }
        if (result.status === 'missing') {
          commitState({
            ...latest,
            status: isExpiredSnapshot(latest.snapshot, now)
              ? 'expired'
              : latest.snapshot
                ? 'stale'
                : 'missing',
          })
          return stateRef.current
        }
        if (
          latest.snapshot &&
          result.request.revision < latest.snapshot.revision
        ) {
          commitState({ ...latest, status: 'stale' })
          return stateRef.current
        }
        const pendingChanges = latest.snapshot
          ? diffLiveRequestSnapshots(
              latest.snapshot,
              result.request,
              latest.pendingChanges,
            )
          : []
        const persisted = persist(
          result.request,
          result.etag,
          pendingChanges,
        )
        commitState({
          snapshot: result.request,
          etag: result.etag,
          pendingChanges,
          status: 'current',
          cachePersistenceFailed: !persisted,
        })
      } catch {
        if ((!controller.signal.aborted || timedOut) && mountedRef.current) {
          const latest = stateRef.current
          commitState({
            ...latest,
            status: isExpiredSnapshot(latest.snapshot, now)
              ? 'expired'
              : latest.snapshot
                ? 'stale'
                : 'missing',
          })
        }
      } finally {
        window.clearTimeout(timeout)
        if (controllerRef.current === controller) {
          controllerRef.current = undefined
          inFlightRef.current = undefined
        }
      }
      return stateRef.current
    })()
    inFlightRef.current = operation
    return operation
  }, [api, commitState, enabled, now, persist, requestToken])

  const acknowledgeChanges = useCallback((itemId?: string, throughRevision?: number) => {
    const current = stateRef.current
    if (!current.snapshot || !current.etag) {
      return
    }
    const pendingChanges = current.pendingChanges.filter((change) =>
      itemId !== undefined &&
      (change.itemId !== itemId || change.revision > (throughRevision ?? 0)),
    )
    const persisted = persist(current.snapshot, current.etag, pendingChanges)
    commitState({
      ...current,
      // Keep the reminder if it cannot be saved; a reload must not silently
      // restore an update that the screen already claims has been dismissed.
      pendingChanges: persisted ? pendingChanges : current.pendingChanges,
      cachePersistenceFailed: !persisted,
    })
  }, [commitState, persist])

  useEffect(() => {
    mountedRef.current = true
    if (!enabled || !api) {
      return
    }
    void refresh()
    let timer: number | undefined
    const stopTimer = () => {
      if (timer !== undefined) {
        window.clearInterval(timer)
        timer = undefined
      }
    }
    const startTimer = () => {
      stopTimer()
      if (document.visibilityState === 'visible') {
        timer = window.setInterval(() => void refresh(), pollIntervalMs)
      }
    }
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void refresh()
        startTimer()
      } else {
        stopTimer()
      }
    }
    const handleFocus = () => void refresh()
    startTimer()
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('focus', handleFocus)
    return () => {
      mountedRef.current = false
      stopTimer()
      controllerRef.current?.abort()
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('focus', handleFocus)
    }
  }, [api, enabled, pollIntervalMs, refresh])

  return {
    ...state,
    refresh,
    acknowledgeChanges,
    getCurrentState,
  }
}
