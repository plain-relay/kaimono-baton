export const MAX_REQUEST_ID_CHARACTERS = 64
export const WORKER_REQUEST_ID_HEADER = 'X-Otsukai-Request-Id'

const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/u

export function isValidRequestId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value)
}

export function createWorkerRequestId(): string {
  return crypto.randomUUID()
}

export function resolveRequestId(
  value: unknown,
  fallback: string,
): string {
  if (isValidRequestId(value)) {
    return value
  }
  return isValidRequestId(fallback)
    ? fallback
    : createWorkerRequestId()
}
