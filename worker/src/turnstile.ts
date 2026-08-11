const TURNSTILE_SITEVERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const DEFAULT_TURNSTILE_ACTION = 'handwriting_import'

type TurnstileSiteverifyResponse = {
  success: boolean
  action?: string
  hostname?: string
}

export type TurnstileVerificationResult =
  | 'verified'
  | 'siteverify-failed'
  | 'action-mismatch'
  | 'hostname-mismatch'
  | 'response-invalid'
  | 'unavailable'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseSiteverifyResponse(
  value: unknown,
): TurnstileSiteverifyResponse | undefined {
  if (!isRecord(value) || typeof value.success !== 'boolean') {
    return undefined
  }
  return {
    success: value.success,
    ...(typeof value.action === 'string' ? { action: value.action } : {}),
    ...(typeof value.hostname === 'string'
      ? { hostname: value.hostname }
      : {}),
  }
}

export async function verifyTurnstileToken(options: {
  token: string
  secret: string
  origin: string
  remoteIp?: string
  fetchImplementation: typeof fetch
  signal: AbortSignal
  expectedAction?: string
}): Promise<boolean> {
  return (await verifyTurnstileTokenDetailed(options)) === 'verified'
}

export async function verifyTurnstileTokenDetailed(options: {
  token: string
  secret: string
  origin: string
  remoteIp?: string
  fetchImplementation: typeof fetch
  signal: AbortSignal
  expectedAction?: string
}): Promise<TurnstileVerificationResult> {
  const expectedHostname = new URL(options.origin).hostname
  const body = new URLSearchParams({
    secret: options.secret,
    response: options.token,
    ...(options.remoteIp ? { remoteip: options.remoteIp } : {}),
  })

  let response: Response
  try {
    response = await options.fetchImplementation(TURNSTILE_SITEVERIFY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: options.signal,
    })
  } catch (error) {
    if (options.signal.aborted) {
      throw error
    }
    return 'unavailable'
  }
  if (!response.ok) {
    return 'unavailable'
  }

  let parsed: TurnstileSiteverifyResponse | undefined
  try {
    parsed = parseSiteverifyResponse(await response.json())
  } catch {
    return 'response-invalid'
  }
  if (!parsed) {
    return 'response-invalid'
  }
  if (!parsed.success) {
    return 'siteverify-failed'
  }
  if (
    parsed.action !==
    (options.expectedAction ?? DEFAULT_TURNSTILE_ACTION)
  ) {
    return 'action-mismatch'
  }
  if (parsed.hostname !== expectedHostname) {
    return 'hostname-mismatch'
  }
  return 'verified'
}
