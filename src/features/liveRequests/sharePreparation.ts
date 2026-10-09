import { LiveRequestApiError } from './api'

type LiveRequestShareInput = {
  snapshot: string
  sharedUrl: string
  sharedSnapshot: string
  hasManagementUrl: boolean
  managementSnapshot: string
  expiresAt: number | undefined
  now: number
}

export function resolveLiveRequestShare(input: LiveRequestShareInput): {
  snapshot: string
  url: string
  reused: boolean
} {
  return {
    snapshot: input.snapshot,
    url: input.sharedUrl,
    reused:
      input.sharedUrl.includes('#/r/') &&
      input.sharedSnapshot === input.snapshot &&
      input.hasManagementUrl &&
      input.managementSnapshot === input.snapshot &&
      typeof input.expiresAt === 'number' &&
      input.now < input.expiresAt,
  }
}

export function getLiveRequestFailureMessage(error: unknown): string {
  if (error instanceof LiveRequestApiError) {
    switch (error.code) {
      case 'auth-failed':
        return '認証確認に失敗しました。通常依頼は引き続き利用できます。'
      case 'limit-reached':
        return '更新可能な依頼の利用上限に達した可能性があります。通常依頼を利用してください。'
      case 'timeout':
      case 'service-unavailable':
      case 'invalid-response':
        return '更新可能な依頼を作成できませんでした。通常依頼は引き続き利用できます。'
      case 'conflict':
      case 'expired':
      case 'invalid-request':
        return '更新可能な依頼の内容を準備できませんでした。入力を確認してください。'
    }
  }
  return '更新可能な依頼を作成できませんでした。通常依頼は引き続き利用できます。'
}
