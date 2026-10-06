import { describe, expect, it, vi } from 'vitest'
import { verifyTurnstileTokenDetailed } from '../src/turnstile'

const origin = 'https://plain-relay.github.io'

describe('Turnstile native fetch receiver', () => {
  it.each(['shared_request_create', 'shared_request_update'])(
    'verifies %s without binding fetch to the options object',
    async (expectedAction) => {
      const fetchImplementation = vi.fn(async function (this: unknown, input, init) {
        if (this !== undefined) throw new TypeError('Illegal invocation')
        expect(input).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify')
        expect(init?.method).toBe('POST')
        expect(init?.signal).toBeInstanceOf(AbortSignal)
        const body = init?.body as URLSearchParams
        expect(body.get('secret')).toBe('fixture-secret')
        expect(body.get('response')).toBe('fixture-response')
        return Response.json({ success: true, action: expectedAction, hostname: 'plain-relay.github.io' })
      }) as typeof fetch
      await expect(verifyTurnstileTokenDetailed({ token: 'fixture-response', secret: 'fixture-secret', origin, expectedAction, fetchImplementation, signal: new AbortController().signal })).resolves.toBe('verified')
      expect(fetchImplementation).toHaveBeenCalledTimes(1)
    },
  )

  it.each([
    [{ success: false }, 'siteverify-failed'],
    [{ success: true, action: 'other', hostname: 'plain-relay.github.io' }, 'action-mismatch'],
    [{ success: true, action: 'shared_request_create', hostname: 'example.com' }, 'hostname-mismatch'],
    [{ action: 'shared_request_create' }, 'response-invalid'],
  ])('keeps rejecting invalid Siteverify results %#', async (body, expected) => {
    await expect(verifyTurnstileTokenDetailed({ token: 'fixture-response', secret: 'fixture-secret', origin, expectedAction: 'shared_request_create', fetchImplementation: vi.fn(async () => Response.json(body)) as typeof fetch, signal: new AbortController().signal })).resolves.toBe(expected)
  })
})
