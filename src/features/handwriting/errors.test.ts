import { describe, expect, it } from 'vitest'
import {
  HandwritingImportError,
  isAbortError,
  toHandwritingErrorMessage,
  type HandwritingImportErrorCode,
} from './errors'

describe('handwriting import error messages', () => {
  it.each([
    ['unsupported-image', '対応していない画像形式です。'],
    ['image-too-large', '画像が大きすぎます。'],
    ['image-too-small', '画像が小さすぎます。'],
    ['cancelled', '処理をキャンセルしました。'],
    ['auth-failed', '認証確認に失敗しました。'],
    ['analysis-limit', '無料枠の利用上限に達した可能性があります。'],
    ['no-products-detected', '商品名を検出できませんでした。'],
    ['invalid-analysis-response', '読み取り結果を安全に確認できませんでした。'],
    ['safety-blocked', '安全上の理由で画像を処理できませんでした。'],
    ['service-unavailable', '手書きメモ解析サービスへ接続できません。'],
    ['timeout', '手書きメモの解析が時間切れになりました。'],
    ['request-invalid', '画像を処理できませんでした。'],
  ] satisfies Array<[HandwritingImportErrorCode, string]>)(
    'maps %s to a safe user-facing message',
    (code, expected) => {
      expect(
        toHandwritingErrorMessage(new HandwritingImportError(code)),
      ).toContain(expected)
    },
  )

  it('maps unknown failures to a safe service message', () => {
    expect(
      toHandwritingErrorMessage(new Error('internal detail')),
    ).toContain('手書きメモ解析サービスへ接続できません。')
  })

  it('recognizes native and wrapped cancellation errors', () => {
    expect(isAbortError(new DOMException('cancelled', 'AbortError'))).toBe(true)
    expect(isAbortError(new HandwritingImportError('cancelled'))).toBe(true)
    expect(isAbortError(new Error('AbortError'))).toBe(false)
  })
})
