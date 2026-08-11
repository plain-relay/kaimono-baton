import { isValidRequestId } from './requestId'

export type WorkerDiagnosticStage =
  | 'request-received'
  | 'request-validated'
  | 'turnstile-verification-started'
  | 'turnstile-verified'
  | 'gemini-request-started'
  | 'gemini-request-completed'
  | 'result-validated'
  | 'response-sent'
  | 'request-rejected'
  | 'request-failed'
  | 'request-timed-out'

export type WorkerDiagnosticErrorClass =
  | 'method-not-allowed'
  | 'origin-not-allowed'
  | 'configuration'
  | 'request-validation'
  | 'turnstile'
  | 'analysis-limit'
  | 'invalid-response'
  | 'safety-blocked'
  | 'gemini-unavailable'
  | 'unexpected'
  | 'timeout'

export type WorkerDiagnosticDetails = {
  httpStatus?: number
  errorClass?: WorkerDiagnosticErrorClass
  imageBytes?: number
  productCandidateCount?: number
  resultItemCount?: number
  matchedCount?: number
  ambiguousCount?: number
  unknownCount?: number
}

export interface WorkerDiagnostics {
  readonly enabled: boolean
  setRequestId(requestId: string): void
  record(
    stage: WorkerDiagnosticStage,
    details?: WorkerDiagnosticDetails,
  ): void
}

type WorkerDiagnosticsOptions = {
  enabled: boolean
  requestId: string
  startedAt: number
  now?: () => number
  log?: (message: string) => void
}

function safeInteger(value: unknown): number | undefined {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0
    ? value
    : undefined
}

export function isWorkerDiagnosticsEnabled(value?: string): boolean {
  return value?.trim().toLowerCase() === 'true'
}

export function createWorkerDiagnostics(
  options: WorkerDiagnosticsOptions,
): WorkerDiagnostics {
  const now = options.now ?? Date.now
  const log = options.log ?? console.log
  let requestId = isValidRequestId(options.requestId)
    ? options.requestId
    : 'worker-generated-request'

  return {
    enabled: options.enabled,
    setRequestId(nextRequestId) {
      if (isValidRequestId(nextRequestId)) {
        requestId = nextRequestId
      }
    },
    record(stage, details = {}) {
      if (!options.enabled) {
        return
      }
      const entry: Record<string, string | number> = {
        event: 'handwriting_import',
        requestId,
        stage,
        durationMs: Math.max(0, now() - options.startedAt),
      }
      const numericKeys = [
        'httpStatus',
        'imageBytes',
        'productCandidateCount',
        'resultItemCount',
        'matchedCount',
        'ambiguousCount',
        'unknownCount',
      ] as const
      for (const key of numericKeys) {
        const value = safeInteger(details[key])
        if (typeof value === 'number') {
          entry[key] = value
        }
      }
      if (details.errorClass) {
        entry.errorClass = details.errorClass
      }
      try {
        log(JSON.stringify(entry))
      } catch {
        // Diagnostics must never change the import response path.
      }
    },
  }
}
