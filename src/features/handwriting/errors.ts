export type HandwritingImportErrorCode =
  | 'unsupported-image'
  | 'image-too-large'
  | 'image-too-small'
  | 'cancelled'
  | 'auth-failed'
  | 'analysis-limit'
  | 'no-products-detected'
  | 'invalid-analysis-response'
  | 'safety-blocked'
  | 'service-unavailable'
  | 'timeout'
  | 'request-invalid'

export class HandwritingImportError extends Error {
  readonly code: HandwritingImportErrorCode
  readonly cause?: unknown

  constructor(code: HandwritingImportErrorCode, cause?: unknown) {
    super(code)
    this.name = 'HandwritingImportError'
    this.code = code
    this.cause = cause
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof HandwritingImportError && error.code === 'cancelled')
  )
}

export function toHandwritingErrorMessage(error: unknown): string {
  const code = isAbortError(error)
    ? 'cancelled'
    : error instanceof HandwritingImportError
      ? error.code
      : 'service-unavailable'

  switch (code) {
    case 'unsupported-image':
      return '対応していない画像形式です。JPEG、PNG、WebPを選んでください。'
    case 'image-too-large':
      return '画像が大きすぎます。別の画像を選んでください。'
    case 'image-too-small':
      return '画像が小さすぎます。メモ全体が大きく写った画像を選んでください。'
    case 'no-products-detected':
      return '商品名を検出できませんでした。明るく、文字が大きく写るように撮り直してください。'
    case 'auth-failed':
      return '認証確認に失敗しました。もう一度お試しください。'
    case 'analysis-limit':
      return '無料枠の利用上限に達した可能性があります。時間をおいて再度試すか、通常の商品選択を利用してください。'
    case 'invalid-analysis-response':
      return '読み取り結果を安全に確認できませんでした。もう一度お試しください。'
    case 'safety-blocked':
      return '安全上の理由で画像を処理できませんでした。別の画像を選んでください。'
    case 'service-unavailable':
      return '手書きメモ解析サービスへ接続できません。通常の商品選択はそのまま利用できます。'
    case 'timeout':
      return '手書きメモの解析が時間切れになりました。もう一度お試しください。'
    case 'cancelled':
      return '処理をキャンセルしました。'
    case 'request-invalid':
      return '画像を処理できませんでした。別の画像でお試しください。'
  }
}
