import { isValidRequestId } from './requestId'

export type PhotoDiagnosticStage =
  | 'request-received'
  | 'request-validated'
  | 'turnstile-verification-started'
  | 'turnstile-verified'
  | 'photo-save-started'
  | 'photo-save-completed'
  | 'response-sent'
  | 'request-rejected'
  | 'request-failed'
  | 'request-timed-out'

export type PhotoDiagnosticErrorClass =
  | 'method-not-allowed'
  | 'origin-not-allowed'
  | 'configuration'
  | 'validation-session'
  | 'request-validation'
  | 'turnstile-failed'
  | 'turnstile-action-mismatch'
  | 'turnstile-hostname-mismatch'
  | 'turnstile-response-invalid'
  | 'turnstile-unavailable'
  | 'photo-preparation'
  | 'photo-storage'
  | 'timeout'

export type PhotoDiagnosticDetails = {
  httpStatus?: number
  errorClass?: PhotoDiagnosticErrorClass
  photoCount?: number
  imageBytes?: number
}

export interface PhotoDiagnostics {
  record(stage: PhotoDiagnosticStage, details?: PhotoDiagnosticDetails): void
}

type PhotoDiagnosticsOptions = {
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

export function createPhotoDiagnostics(
  options: PhotoDiagnosticsOptions,
): PhotoDiagnostics {
  const now = options.now ?? Date.now
  const log = options.log ?? console.log
  const requestId = isValidRequestId(options.requestId)
    ? options.requestId
    : 'worker-generated-request'

  return {
    record(stage, details = {}) {
      if (!options.enabled) {
        return
      }
      const entry: Record<string, string | number> = {
        schemaVersion: 1,
        event: 'product_photo_api',
        requestId,
        stage,
        durationMs: Math.max(0, now() - options.startedAt),
      }
      for (const key of ['httpStatus', 'photoCount', 'imageBytes'] as const) {
        const value = safeInteger(details[key])
        if (value !== undefined) {
          entry[key] = value
        }
      }
      if (details.errorClass) {
        entry.errorClass = details.errorClass
      }
      try {
        log(JSON.stringify(entry))
      } catch {
        // Diagnostics must never affect the photo upload response.
      }
    },
  }
}
