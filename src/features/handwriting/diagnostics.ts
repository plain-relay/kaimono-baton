import type { HandwritingImportErrorCode } from './errors'

export const HANDWRITING_DIAGNOSTICS_SCHEMA_VERSION = 1
export const HANDWRITING_DIAGNOSTICS_STORAGE_KEY =
  'otsukai:handwriting-diagnostics:v1'
export const MAX_HANDWRITING_REQUEST_ID_CHARACTERS = 64

export type HandwritingDiagnosticStage =
  | 'idle'
  | 'file-selected'
  | 'source-validated'
  | 'decode-started'
  | 'decode-completed'
  | 'resize-calculated'
  | 'canvas-render-started'
  | 'canvas-render-completed'
  | 'encode-started'
  | 'encode-completed'
  | 'preprocessing-completed'
  | 'turnstile-load-started'
  | 'turnstile-ready'
  | 'turnstile-execute-started'
  | 'turnstile-token-received'
  | 'worker-request-started'
  | 'worker-response-received'
  | 'worker-response-validated'
  | 'confirmation-render-started'
  | 'confirmation-rendered'
  | 'failed'
  | 'cancelled'

export type HandwritingDiagnosticBrowser = {
  name: 'Chrome' | 'Edge' | 'Firefox' | 'Safari' | 'Other'
  version: string
  deviceMemory?: number
  hardwareConcurrency?: number
  online: boolean
}

export type HandwritingDiagnosticSnapshot = {
  schemaVersion: 1
  requestId: string
  stage: HandwritingDiagnosticStage
  failedAfterStage?: HandwritingDiagnosticStage
  timestamp: string
  elapsedMs: number
  browser: HandwritingDiagnosticBrowser
  sourceImageBytes?: number
  sourceMime?: 'image/jpeg' | 'image/png' | 'image/webp'
  decodedWidth?: number
  decodedHeight?: number
  resizedWidth?: number
  resizedHeight?: number
  encodedBytes?: number
  httpStatus?: number
  workerErrorCode?: SafeWorkerErrorCode
  errorCode?: HandwritingImportErrorCode
  resultItemCount?: number
  matchedCount?: number
  ambiguousCount?: number
  unknownCount?: number
}

export type HandwritingDiagnosticDetails = Partial<
  Pick<
    HandwritingDiagnosticSnapshot,
    | 'sourceImageBytes'
    | 'sourceMime'
    | 'decodedWidth'
    | 'decodedHeight'
    | 'resizedWidth'
    | 'resizedHeight'
    | 'encodedBytes'
    | 'httpStatus'
    | 'workerErrorCode'
    | 'errorCode'
    | 'resultItemCount'
    | 'matchedCount'
    | 'ambiguousCount'
    | 'unknownCount'
  >
>

export type HandwritingDiagnosticsView = {
  current?: HandwritingDiagnosticSnapshot
  previous?: HandwritingDiagnosticSnapshot
}

export interface HandwritingDiagnosticsReporter {
  readonly enabled: boolean
  record(
    stage: HandwritingDiagnosticStage,
    details?: HandwritingDiagnosticDetails,
  ): void
  adoptRequestId(requestId: string): void
}

export interface HandwritingDiagnosticsStore
  extends HandwritingDiagnosticsReporter {
  begin(options: {
    requestId: string
    sourceImageBytes: number
    sourceMime: string
  }): void
  clear(): void
  getView(): HandwritingDiagnosticsView
  serialize(): string
  subscribe(listener: (view: HandwritingDiagnosticsView) => void): () => void
}

type DiagnosticsCrypto = {
  randomUUID?: () => string
  getRandomValues?: <T extends ArrayBufferView>(array: T) => T
}

type DiagnosticsNavigator = {
  userAgent?: string
  deviceMemory?: number
  hardwareConcurrency?: number
  onLine?: boolean
}

type DiagnosticsStorage = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem'
>

type DiagnosticsDependencies = {
  storage?: DiagnosticsStorage
  crypto?: DiagnosticsCrypto
  navigator?: DiagnosticsNavigator
  now?: () => number
}

export type SafeWorkerErrorCode =
  | 'METHOD_NOT_ALLOWED'
  | 'ORIGIN_NOT_ALLOWED'
  | 'SERVICE_UNAVAILABLE'
  | 'AUTH_FAILED'
  | 'ANALYSIS_LIMIT'
  | 'INVALID_ANALYSIS_RESPONSE'
  | 'SAFETY_BLOCKED'
  | 'REQUEST_INVALID'
  | 'INVALID_PRODUCTS'
  | 'IMAGE_TOO_LARGE'
  | 'UNSUPPORTED_CONTENT_TYPE'
  | 'UNSUPPORTED_IMAGE_TYPE'
  | 'TIMEOUT'

const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/u
const DIAGNOSTIC_STAGES = new Set<HandwritingDiagnosticStage>([
  'idle',
  'file-selected',
  'source-validated',
  'decode-started',
  'decode-completed',
  'resize-calculated',
  'canvas-render-started',
  'canvas-render-completed',
  'encode-started',
  'encode-completed',
  'preprocessing-completed',
  'turnstile-load-started',
  'turnstile-ready',
  'turnstile-execute-started',
  'turnstile-token-received',
  'worker-request-started',
  'worker-response-received',
  'worker-response-validated',
  'confirmation-render-started',
  'confirmation-rendered',
  'failed',
  'cancelled',
])
const TERMINAL_DIAGNOSTIC_STAGES = new Set<HandwritingDiagnosticStage>([
  'idle',
  'failed',
  'cancelled',
])
const WORKER_ERROR_CODES = new Set<SafeWorkerErrorCode>([
  'METHOD_NOT_ALLOWED',
  'ORIGIN_NOT_ALLOWED',
  'SERVICE_UNAVAILABLE',
  'AUTH_FAILED',
  'ANALYSIS_LIMIT',
  'INVALID_ANALYSIS_RESPONSE',
  'SAFETY_BLOCKED',
  'REQUEST_INVALID',
  'INVALID_PRODUCTS',
  'IMAGE_TOO_LARGE',
  'UNSUPPORTED_CONTENT_TYPE',
  'UNSUPPORTED_IMAGE_TYPE',
  'TIMEOUT',
])
const IMPORT_ERROR_CODES = new Set<HandwritingImportErrorCode>([
  'unsupported-image',
  'image-too-large',
  'image-too-small',
  'cancelled',
  'auth-failed',
  'analysis-limit',
  'no-products-detected',
  'invalid-analysis-response',
  'safety-blocked',
  'service-unavailable',
  'timeout',
  'request-invalid',
])
const SNAPSHOT_KEYS = new Set([
  'schemaVersion',
  'requestId',
  'stage',
  'failedAfterStage',
  'timestamp',
  'elapsedMs',
  'browser',
  'sourceImageBytes',
  'sourceMime',
  'decodedWidth',
  'decodedHeight',
  'resizedWidth',
  'resizedHeight',
  'encodedBytes',
  'httpStatus',
  'workerErrorCode',
  'errorCode',
  'resultItemCount',
  'matchedCount',
  'ambiguousCount',
  'unknownCount',
])
const BROWSER_KEYS = new Set([
  'name',
  'version',
  'deviceMemory',
  'hardwareConcurrency',
  'online',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0
  )
}

function optionalNonNegativeNumber(value: unknown): value is number | undefined {
  return typeof value === 'undefined' || isFiniteNonNegativeNumber(value)
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every((key) => allowedKeys.has(key))
}

function isBrowserName(
  value: unknown,
): value is HandwritingDiagnosticBrowser['name'] {
  return (
    value === 'Chrome' ||
    value === 'Edge' ||
    value === 'Firefox' ||
    value === 'Safari' ||
    value === 'Other'
  )
}

function parseBrowser(
  value: unknown,
): HandwritingDiagnosticBrowser | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, BROWSER_KEYS) ||
    !isBrowserName(value.name) ||
    typeof value.version !== 'string' ||
    value.version.length > 32 ||
    typeof value.online !== 'boolean' ||
    !optionalNonNegativeNumber(value.deviceMemory) ||
    !optionalNonNegativeNumber(value.hardwareConcurrency)
  ) {
    return undefined
  }
  return {
    name: value.name,
    version: value.version,
    ...(typeof value.deviceMemory === 'number'
      ? { deviceMemory: value.deviceMemory }
      : {}),
    ...(typeof value.hardwareConcurrency === 'number'
      ? { hardwareConcurrency: value.hardwareConcurrency }
      : {}),
    online: value.online,
  }
}

function optionalInteger(value: unknown): value is number | undefined {
  return (
    typeof value === 'undefined' ||
    (isFiniteNonNegativeNumber(value) && Number.isInteger(value))
  )
}

function isFailureBoundaryStage(
  value: unknown,
): value is HandwritingDiagnosticStage {
  return (
    typeof value === 'string' &&
    DIAGNOSTIC_STAGES.has(value as HandwritingDiagnosticStage) &&
    !TERMINAL_DIAGNOSTIC_STAGES.has(
      value as HandwritingDiagnosticStage,
    )
  )
}

function parseSnapshot(
  value: unknown,
): HandwritingDiagnosticSnapshot | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, SNAPSHOT_KEYS) ||
    value.schemaVersion !== HANDWRITING_DIAGNOSTICS_SCHEMA_VERSION ||
    !isValidHandwritingRequestId(value.requestId) ||
    typeof value.stage !== 'string' ||
    !DIAGNOSTIC_STAGES.has(value.stage as HandwritingDiagnosticStage) ||
    (typeof value.failedAfterStage !== 'undefined' &&
      (!isFailureBoundaryStage(value.failedAfterStage) ||
        value.stage !== 'failed')) ||
    typeof value.timestamp !== 'string' ||
    Number.isNaN(Date.parse(value.timestamp)) ||
    !isFiniteNonNegativeNumber(value.elapsedMs)
  ) {
    return undefined
  }
  const browser = parseBrowser(value.browser)
  if (
    !browser ||
    !optionalInteger(value.sourceImageBytes) ||
    (typeof value.sourceMime !== 'undefined' &&
      value.sourceMime !== 'image/jpeg' &&
      value.sourceMime !== 'image/png' &&
      value.sourceMime !== 'image/webp') ||
    !optionalInteger(value.decodedWidth) ||
    !optionalInteger(value.decodedHeight) ||
    !optionalInteger(value.resizedWidth) ||
    !optionalInteger(value.resizedHeight) ||
    !optionalInteger(value.encodedBytes) ||
    !optionalInteger(value.httpStatus) ||
    (typeof value.workerErrorCode !== 'undefined' &&
      (typeof value.workerErrorCode !== 'string' ||
        !WORKER_ERROR_CODES.has(
          value.workerErrorCode as SafeWorkerErrorCode,
        ))) ||
    (typeof value.errorCode !== 'undefined' &&
      (typeof value.errorCode !== 'string' ||
        !IMPORT_ERROR_CODES.has(
          value.errorCode as HandwritingImportErrorCode,
        ))) ||
    !optionalInteger(value.resultItemCount) ||
    !optionalInteger(value.matchedCount) ||
    !optionalInteger(value.ambiguousCount) ||
    !optionalInteger(value.unknownCount)
  ) {
    return undefined
  }

  return {
    schemaVersion: 1,
    requestId: value.requestId,
    stage: value.stage as HandwritingDiagnosticStage,
    ...(typeof value.failedAfterStage === 'string'
      ? {
          failedAfterStage:
            value.failedAfterStage as HandwritingDiagnosticStage,
        }
      : {}),
    timestamp: value.timestamp,
    elapsedMs: value.elapsedMs,
    browser,
    ...(typeof value.sourceImageBytes === 'number'
      ? { sourceImageBytes: value.sourceImageBytes }
      : {}),
    ...(typeof value.sourceMime === 'string'
      ? {
          sourceMime: value.sourceMime as
            | 'image/jpeg'
            | 'image/png'
            | 'image/webp',
        }
      : {}),
    ...(typeof value.decodedWidth === 'number'
      ? { decodedWidth: value.decodedWidth }
      : {}),
    ...(typeof value.decodedHeight === 'number'
      ? { decodedHeight: value.decodedHeight }
      : {}),
    ...(typeof value.resizedWidth === 'number'
      ? { resizedWidth: value.resizedWidth }
      : {}),
    ...(typeof value.resizedHeight === 'number'
      ? { resizedHeight: value.resizedHeight }
      : {}),
    ...(typeof value.encodedBytes === 'number'
      ? { encodedBytes: value.encodedBytes }
      : {}),
    ...(typeof value.httpStatus === 'number'
      ? { httpStatus: value.httpStatus }
      : {}),
    ...(typeof value.workerErrorCode === 'string'
      ? {
          workerErrorCode:
            value.workerErrorCode as SafeWorkerErrorCode,
        }
      : {}),
    ...(typeof value.errorCode === 'string'
      ? { errorCode: value.errorCode as HandwritingImportErrorCode }
      : {}),
    ...(typeof value.resultItemCount === 'number'
      ? { resultItemCount: value.resultItemCount }
      : {}),
    ...(typeof value.matchedCount === 'number'
      ? { matchedCount: value.matchedCount }
      : {}),
    ...(typeof value.ambiguousCount === 'number'
      ? { ambiguousCount: value.ambiguousCount }
      : {}),
    ...(typeof value.unknownCount === 'number'
      ? { unknownCount: value.unknownCount }
      : {}),
  }
}

function safeStorage(): DiagnosticsStorage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

function safeNavigator(): DiagnosticsNavigator | undefined {
  return typeof navigator === 'undefined'
    ? undefined
    : (navigator as Navigator & { deviceMemory?: number })
}

function safeCrypto(): DiagnosticsCrypto | undefined {
  return typeof crypto === 'undefined' ? undefined : crypto
}

function detectBrowser(
  navigatorValue?: DiagnosticsNavigator,
): HandwritingDiagnosticBrowser {
  const userAgent = navigatorValue?.userAgent ?? ''
  const matches: Array<{
    name: HandwritingDiagnosticBrowser['name']
    pattern: RegExp
  }> = [
    { name: 'Edge', pattern: /\bEdg\/([\d.]+)/u },
    { name: 'Chrome', pattern: /\bChrome\/([\d.]+)/u },
    { name: 'Firefox', pattern: /\bFirefox\/([\d.]+)/u },
    { name: 'Safari', pattern: /\bVersion\/([\d.]+).*\bSafari\//u },
  ]
  const detected = matches
    .map(({ name, pattern }) => ({ name, match: pattern.exec(userAgent) }))
    .find(({ match }) => Boolean(match))
  const deviceMemory = navigatorValue?.deviceMemory
  const hardwareConcurrency = navigatorValue?.hardwareConcurrency
  return {
    name: detected?.name ?? 'Other',
    version: detected?.match?.[1]?.slice(0, 32) ?? '',
    ...(isFiniteNonNegativeNumber(deviceMemory)
      ? { deviceMemory }
      : {}),
    ...(isFiniteNonNegativeNumber(hardwareConcurrency)
      ? { hardwareConcurrency }
      : {}),
    online: navigatorValue?.onLine !== false,
  }
}

function uuidFromBytes(bytes: Uint8Array): string {
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((value) =>
    value.toString(16).padStart(2, '0'),
  )
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-')
}

export function isValidHandwritingRequestId(
  value: unknown,
): value is string {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value)
}

export function createHandwritingRequestId(
  cryptoValue: DiagnosticsCrypto | undefined = safeCrypto(),
): string {
  const generated = cryptoValue?.randomUUID?.()
  if (generated && isValidHandwritingRequestId(generated)) {
    return generated
  }
  if (cryptoValue?.getRandomValues) {
    const bytes = cryptoValue.getRandomValues(new Uint8Array(16))
    return uuidFromBytes(bytes)
  }
  return `fallback-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 14)}`
}

export function toSafeWorkerErrorCode(
  value: unknown,
): SafeWorkerErrorCode | undefined {
  return typeof value === 'string' &&
    WORKER_ERROR_CODES.has(value as SafeWorkerErrorCode)
    ? (value as SafeWorkerErrorCode)
    : undefined
}

function safeInteger(value: unknown): number | undefined {
  return optionalInteger(value) && typeof value === 'number'
    ? value
    : undefined
}

function applyDetails(
  snapshot: HandwritingDiagnosticSnapshot,
  details: HandwritingDiagnosticDetails,
): HandwritingDiagnosticSnapshot {
  const next = { ...snapshot }
  const numericKeys = [
    'sourceImageBytes',
    'decodedWidth',
    'decodedHeight',
    'resizedWidth',
    'resizedHeight',
    'encodedBytes',
    'httpStatus',
    'resultItemCount',
    'matchedCount',
    'ambiguousCount',
    'unknownCount',
  ] as const
  for (const key of numericKeys) {
    const value = safeInteger(details[key])
    if (typeof value === 'number') {
      next[key] = value
    }
  }
  if (
    details.sourceMime === 'image/jpeg' ||
    details.sourceMime === 'image/png' ||
    details.sourceMime === 'image/webp'
  ) {
    next.sourceMime = details.sourceMime
  }
  const workerErrorCode = toSafeWorkerErrorCode(details.workerErrorCode)
  if (workerErrorCode) {
    next.workerErrorCode = workerErrorCode
  }
  if (details.errorCode && IMPORT_ERROR_CODES.has(details.errorCode)) {
    next.errorCode = details.errorCode
  }
  return next
}

function copySnapshot(
  snapshot: HandwritingDiagnosticSnapshot,
): HandwritingDiagnosticSnapshot {
  return {
    ...snapshot,
    browser: { ...snapshot.browser },
  }
}

function copyView(view: HandwritingDiagnosticsView): HandwritingDiagnosticsView {
  return {
    ...(view.current ? { current: copySnapshot(view.current) } : {}),
    ...(view.previous ? { previous: copySnapshot(view.previous) } : {}),
  }
}

function withoutFailureBoundary(
  snapshot: HandwritingDiagnosticSnapshot,
): HandwritingDiagnosticSnapshot {
  const next = { ...snapshot }
  delete next.failedAfterStage
  return next
}

export function createHandwritingDiagnosticsStore(
  enabled: boolean,
  dependencies: DiagnosticsDependencies = {},
): HandwritingDiagnosticsStore {
  const storage = dependencies.storage ?? (enabled ? safeStorage() : undefined)
  const cryptoValue = dependencies.crypto ?? safeCrypto()
  const navigatorValue = dependencies.navigator ?? safeNavigator()
  const now = dependencies.now ?? Date.now
  const listeners = new Set<(view: HandwritingDiagnosticsView) => void>()
  let current: HandwritingDiagnosticSnapshot | undefined
  let previous: HandwritingDiagnosticSnapshot | undefined
  let startedAt = 0

  if (enabled && storage) {
    try {
      const serialized = storage.getItem(
        HANDWRITING_DIAGNOSTICS_STORAGE_KEY,
      )
      if (serialized) {
        previous = parseSnapshot(JSON.parse(serialized) as unknown)
      }
    } catch {
      previous = undefined
    }
  }

  const getView = (): HandwritingDiagnosticsView =>
    copyView({ current, previous })
  const emit = () => {
    const view = getView()
    listeners.forEach((listener) => listener(view))
  }
  const persist = () => {
    if (!enabled || !storage || !current) {
      return
    }
    try {
      storage.setItem(
        HANDWRITING_DIAGNOSTICS_STORAGE_KEY,
        JSON.stringify(current),
      )
    } catch {
      // Diagnostics must never break the import path.
    }
  }

  return {
    enabled,
    begin(options) {
      if (!enabled) {
        return
      }
      if (current) {
        previous = current
      }
      const requestId = isValidHandwritingRequestId(options.requestId)
        ? options.requestId
        : createHandwritingRequestId(cryptoValue)
      startedAt = now()
      current = {
        schemaVersion: 1,
        requestId,
        stage: 'file-selected',
        timestamp: new Date(startedAt).toISOString(),
        elapsedMs: 0,
        browser: detectBrowser(navigatorValue),
        sourceImageBytes: Math.max(
          0,
          Math.floor(options.sourceImageBytes),
        ),
        ...(options.sourceMime === 'image/jpeg' ||
        options.sourceMime === 'image/png' ||
        options.sourceMime === 'image/webp'
          ? { sourceMime: options.sourceMime }
          : {}),
      }
      persist()
      emit()
    },
    record(stage, details = {}) {
      if (!enabled || !current || !DIAGNOSTIC_STAGES.has(stage)) {
        return
      }
      const timestamp = now()
      const failedAfterStage =
        stage === 'failed' && isFailureBoundaryStage(current.stage)
          ? current.stage
          : undefined
      current = applyDetails(
        {
          ...withoutFailureBoundary(current),
          stage,
          ...(failedAfterStage ? { failedAfterStage } : {}),
          timestamp: new Date(timestamp).toISOString(),
          elapsedMs: Math.max(0, timestamp - startedAt),
        },
        details,
      )
      persist()
      emit()
    },
    adoptRequestId(requestId) {
      if (!enabled || !current || !isValidHandwritingRequestId(requestId)) {
        return
      }
      current = { ...current, requestId }
      persist()
      emit()
    },
    clear() {
      if (!enabled) {
        return
      }
      current = undefined
      previous = undefined
      try {
        storage?.removeItem(HANDWRITING_DIAGNOSTICS_STORAGE_KEY)
      } catch {
        // Diagnostics cleanup must never break the import path.
      }
      emit()
    },
    getView,
    serialize() {
      return JSON.stringify(
        {
          schemaVersion: HANDWRITING_DIAGNOSTICS_SCHEMA_VERSION,
          ...getView(),
        },
        null,
        2,
      )
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
