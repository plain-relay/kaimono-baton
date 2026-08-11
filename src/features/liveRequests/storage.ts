import type {
  LiveRequestCachedState,
  LiveRequestPendingChange,
} from './types'
import { countUserCharacters } from '../../utils/textLength'
import {
  isLiveRequestToken,
  parseLiveRequestEtag,
  parseLiveRequestSnapshot,
} from './validation'

const LIVE_REQUEST_CACHE_PREFIX = 'otsukai:liveRequest:v1:'
const MAX_LIVE_REQUEST_CACHE_CHARACTERS = 1_200_000
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function owns(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
): boolean {
  const keys = Object.keys(value)
  const allowed = new Set(required)
  return (
    required.every((key) => owns(value, key)) &&
    keys.every((key) => allowed.has(key))
  )
}

function parseChange(value: unknown): LiveRequestPendingChange | undefined {
  if (
    !isRecord(value) ||
    typeof value.kind !== 'string' ||
    typeof value.itemId !== 'string' ||
    !/^[A-Za-z0-9:_-]{1,128}$/u.test(value.itemId) ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 1
  ) {
    return undefined
  }
  if (
    (value.kind === 'added' || value.kind === 'cancelled') &&
    hasExactKeys(value, ['kind', 'itemId', 'revision'])
  ) {
    return {
      kind: value.kind,
      itemId: value.itemId,
      revision: value.revision as number,
    }
  }
  if (
    value.kind === 'changed' &&
    hasExactKeys(value, [
      'kind',
      'itemId',
      'revision',
      'previousQuantity',
      'nextQuantity',
      'previousMemo',
      'nextMemo',
    ]) &&
    Number.isInteger(value.previousQuantity) &&
    Number.isInteger(value.nextQuantity) &&
    (value.previousQuantity as number) >= 1 &&
    (value.previousQuantity as number) <= 20 &&
    (value.nextQuantity as number) >= 1 &&
    (value.nextQuantity as number) <= 20 &&
    typeof value.previousMemo === 'string' &&
    typeof value.nextMemo === 'string' &&
    value.previousMemo === value.previousMemo.trim() &&
    value.nextMemo === value.nextMemo.trim() &&
    countUserCharacters(value.previousMemo) <= 30 &&
    countUserCharacters(value.nextMemo) <= 30 &&
    !CONTROL_CHARACTER_PATTERN.test(value.previousMemo) &&
    !CONTROL_CHARACTER_PATTERN.test(value.nextMemo)
  ) {
    return {
      kind: 'changed',
      itemId: value.itemId,
      revision: value.revision as number,
      previousQuantity: value.previousQuantity as number,
      nextQuantity: value.nextQuantity as number,
      previousMemo: value.previousMemo,
      nextMemo: value.nextMemo,
    }
  }
  return undefined
}

export function liveRequestCacheKey(requestToken: string): string {
  return `${LIVE_REQUEST_CACHE_PREFIX}${requestToken}`
}

export function parseLiveRequestCachedState(
  value: unknown,
  expectedToken: string,
): LiveRequestCachedState | undefined {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'schemaVersion',
      'requestToken',
      'etag',
      'snapshot',
      'pendingChanges',
      'savedAt',
    ]) ||
    value.schemaVersion !== 1 ||
    value.requestToken !== expectedToken ||
    !isLiveRequestToken(expectedToken) ||
    typeof value.etag !== 'string' ||
    typeof value.savedAt !== 'string' ||
    Number.isNaN(Date.parse(value.savedAt)) ||
    !Array.isArray(value.pendingChanges) ||
    value.pendingChanges.length > 403
  ) {
    return undefined
  }
  const snapshot = parseLiveRequestSnapshot(value.snapshot, expectedToken)
  const etag = parseLiveRequestEtag(
    value.etag,
    snapshot?.revision,
  )
  const pendingChanges = value.pendingChanges.map(parseChange)
  if (
    !snapshot ||
    !etag ||
    pendingChanges.some((change) => !change) ||
    pendingChanges.some(
      (change) => change && change.revision > snapshot.revision,
    )
  ) {
    return undefined
  }
  const itemIds = new Set(snapshot.items.map((item) => item.itemId))
  const normalizedChanges = pendingChanges.filter(
    (change): change is LiveRequestPendingChange =>
      change !== undefined && itemIds.has(change.itemId),
  )
  return normalizedChanges.length === pendingChanges.length
    ? {
        schemaVersion: 1,
        requestToken: expectedToken,
        etag,
        snapshot,
        pendingChanges: normalizedChanges,
        savedAt: value.savedAt,
      }
    : undefined
}

export function loadLiveRequestCachedState(
  requestToken: string,
  storage: Pick<Storage, 'getItem'> = window.localStorage,
): LiveRequestCachedState | undefined {
  try {
    const raw = storage.getItem(liveRequestCacheKey(requestToken))
    if (raw && raw.length > MAX_LIVE_REQUEST_CACHE_CHARACTERS) {
      return undefined
    }
    return raw
      ? parseLiveRequestCachedState(JSON.parse(raw) as unknown, requestToken)
      : undefined
  } catch {
    return undefined
  }
}

export function saveLiveRequestCachedState(
  state: LiveRequestCachedState,
  storage: Pick<Storage, 'setItem'> = window.localStorage,
): boolean {
  try {
    storage.setItem(
      liveRequestCacheKey(state.requestToken),
      JSON.stringify(state),
    )
    return true
  } catch {
    return false
  }
}
