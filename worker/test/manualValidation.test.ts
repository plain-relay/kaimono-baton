import { describe, expect, it, vi } from 'vitest'
import type { WorkerEnv } from '../src/config'
import {
  handleManualValidationSessionRequest,
  MANUAL_VALIDATION_SESSION_HEADER,
  MANUAL_VALIDATION_SESSION_PATH,
  validateManualValidationSession,
} from '../src/manualValidation'
import { routeRequest } from '../src/index'

const origin = 'https://plain-relay.github.io'
const token = `mv1_${'A'.repeat(32)}`
const now = Date.UTC(2026, 7, 2)

async function sha256(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  )
  return [...digest]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function configuredEnv(
  overrides: Partial<WorkerEnv> = {},
): Promise<WorkerEnv> {
  return {
    ALLOWED_ORIGINS: origin,
    MANUAL_VALIDATION_ENABLED: 'true',
    MANUAL_VALIDATION_SESSION_SHA256: await sha256(token),
    MANUAL_VALIDATION_EXPIRES_AT: new Date(now + 60_000).toISOString(),
    ...overrides,
  }
}

function request(value = token, requestOrigin = origin): Request {
  return new Request(
    `https://worker.example${MANUAL_VALIDATION_SESSION_PATH}`,
    {
      method: 'GET',
      headers: {
        Origin: requestOrigin,
        [MANUAL_VALIDATION_SESSION_HEADER]: value,
      },
    },
  )
}

describe('manual validation session gate', () => {
  it('returns only finite capabilities and expiry for a valid session', async () => {
    const env = await configuredEnv()
    const response = await handleManualValidationSessionRequest(
      request(),
      env,
      { now: () => now },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin)
    await expect(response.json()).resolves.toEqual({
      schemaVersion: 1,
      productPhotosEnabled: true,
      liveRequestsEnabled: true,
      expiresAt: env.MANUAL_VALIDATION_EXPIRES_AT,
    })
  })

  it.each([
    [{ MANUAL_VALIDATION_ENABLED: 'false' }, 404, 'NOT_FOUND'],
    [{ MANUAL_VALIDATION_SESSION_SHA256: '' }, 404, 'NOT_FOUND'],
    [{ MANUAL_VALIDATION_EXPIRES_AT: '' }, 404, 'NOT_FOUND'],
    [
      { MANUAL_VALIDATION_EXPIRES_AT: new Date(now).toISOString() },
      410,
      'VALIDATION_SESSION_EXPIRED',
    ],
  ] as const)('safely rejects unavailable configuration %#', async (overrides, status, code) => {
    const response = await handleManualValidationSessionRequest(
      request(),
      await configuredEnv(overrides),
      { now: () => now },
    )
    expect(response.status).toBe(status)
    await expect(response.json()).resolves.toEqual({ code })
  })

  it('rejects missing, malformed, and incorrect sessions without echoing them', async () => {
    const env = await configuredEnv()
    for (const value of ['', 'unsafe value', `mv1_${'B'.repeat(32)}`]) {
      const response = await handleManualValidationSessionRequest(
        request(value),
        env,
        { now: () => now },
      )
      expect(response.status).toBe(403)
      expect(await response.text()).toBe(
        '{"code":"VALIDATION_SESSION_INVALID"}',
      )
    }
  })

  it('rejects a non-allowed Origin before session comparison', async () => {
    const digest = vi.fn(async () => new ArrayBuffer(32))
    const response = await handleManualValidationSessionRequest(
      request(token, 'https://attacker.example'),
      await configuredEnv(),
      { now: () => now, digestImplementation: digest },
    )
    expect(response.status).toBe(403)
    expect(digest).not.toHaveBeenCalled()
  })

  it('does not depend on Gemini or Turnstile configuration', async () => {
    const env = await configuredEnv()
    expect(env.GEMINI_API_KEY).toBeUndefined()
    expect(env.TURNSTILE_SECRET_KEY).toBeUndefined()
    await expect(
      validateManualValidationSession(request(), env, { now: () => now }),
    ).resolves.toBe('valid')
  })

  it('exposes the session request header in CORS preflight', async () => {
    const response = await routeRequest(
      new Request('https://worker.example/v1/photos/batch', {
        method: 'OPTIONS',
        headers: { Origin: origin },
      }),
      await configuredEnv(),
    )
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain(
      MANUAL_VALIDATION_SESSION_HEADER,
    )
  })

  it('does not write tokens or hashes to console', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const env = await configuredEnv()
    await handleManualValidationSessionRequest(request(), env, {
      now: () => now,
    })
    const serialized = JSON.stringify([
      ...log.mock.calls,
      ...error.mock.calls,
    ])
    expect(serialized).not.toContain(token)
    expect(serialized).not.toContain(env.MANUAL_VALIDATION_SESSION_SHA256)
    expect(log).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })
})
