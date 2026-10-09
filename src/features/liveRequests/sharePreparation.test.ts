import { describe, expect, it } from 'vitest'
import { LiveRequestApiError, type LiveRequestApiErrorCode } from './api'
import {
  getLiveRequestFailureMessage,
  resolveLiveRequestShare,
} from './sharePreparation'

const input = {
  snapshot: 'fixture-current-content',
  sharedUrl: 'https://example.test/#/r/fixture-request',
  sharedSnapshot: 'fixture-current-content',
  hasManagementUrl: true,
  managementSnapshot: 'fixture-current-content',
  expiresAt: 200,
  now: 100,
}

describe('live request share preparation', () => {
  it('reuses the purchaser URL only while both share records match and remain valid', () => {
    expect(resolveLiveRequestShare(input)).toEqual({
      snapshot: input.snapshot,
      url: input.sharedUrl,
      reused: true,
    })
  })

  it.each([
    ['a fixed URL', { sharedUrl: 'https://example.test/#/l/fixture-fixed' }],
    ['no previous share', { sharedUrl: '' }],
    ['a changed request', { snapshot: 'fixture-changed-content' }],
    ['a stale purchaser snapshot', { sharedSnapshot: 'fixture-old-content' }],
    ['a missing management capability', { hasManagementUrl: false }],
    ['a stale management snapshot', { managementSnapshot: 'fixture-old-content' }],
    ['an unknown expiry', { expiresAt: undefined }],
    ['an invalid expiry', { expiresAt: Number.NaN }],
    ['the exact expiry', { now: 200 }],
    ['a past expiry', { now: 201 }],
  ] as const)('creates anew with %s', (_, change) => {
    const changedInput = { ...input, ...change }
    const result = resolveLiveRequestShare(changedInput)
    expect(result.reused).toBe(false)
    expect(result.snapshot).toBe(changedInput.snapshot)
    expect(result.url).toBe(changedInput.sharedUrl)
  })
})

describe('live request failure messages', () => {
  it.each<{ codes: LiveRequestApiErrorCode[]; message: string }>([
    {
      codes: ['auth-failed'],
      message: '認証確認に失敗しました。通常依頼は引き続き利用できます。',
    },
    {
      codes: ['limit-reached'],
      message: '更新可能な依頼の利用上限に達した可能性があります。通常依頼を利用してください。',
    },
    {
      codes: ['timeout', 'service-unavailable', 'invalid-response'],
      message: '更新可能な依頼を作成できませんでした。通常依頼は引き続き利用できます。',
    },
    {
      codes: ['conflict', 'expired', 'invalid-request'],
      message: '更新可能な依頼の内容を準備できませんでした。入力を確認してください。',
    },
  ])('keeps the established notice for $codes', ({ codes, message }) => {
    for (const code of codes) {
      expect(getLiveRequestFailureMessage(new LiveRequestApiError(code))).toBe(
        message,
      )
    }
  })

  it('does not expose arbitrary error text or stringify unknown values', () => {
    const message =
      '更新可能な依頼を作成できませんでした。通常依頼は引き続き利用できます。'
    expect(getLiveRequestFailureMessage(new Error('synthetic-provider-detail'))).toBe(
      message,
    )
    expect(
      getLiveRequestFailureMessage({
        code: 'auth-failed',
        toString: () => { throw new Error('must not stringify') },
      }),
    ).toBe(message)
    expect(getLiveRequestFailureMessage(undefined)).toBe(message)
  })
})
