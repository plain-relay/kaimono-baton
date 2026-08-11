import {
  MAX_SHARE_URL_LENGTH,
  MAX_TOTAL_CONDITION_CHARS,
} from '../constants/requestLimits'

type RequestLimitNoticeProps = {
  hasError: boolean
  isConditionWarning: boolean
  isShareUrlOverLimit: boolean
  isShareUrlWarning: boolean
  limitMessage: string
  shareUrlLength?: number
  totalConditionCharacters: number
}

export function RequestLimitNotice({
  hasError,
  isConditionWarning,
  isShareUrlOverLimit,
  isShareUrlWarning,
  limitMessage,
  shareUrlLength,
  totalConditionCharacters,
}: RequestLimitNoticeProps) {
  return (
    <section
      className={`info-card request-limit-notice ${hasError ? 'is-error' : 'is-warning'}`}
      role="status"
      aria-live="polite"
    >
      {isConditionWarning ? (
        <div>
          <strong>条件の合計が上限に近づいています。</strong>
          <p>
            現在 {totalConditionCharacters.toLocaleString('ja-JP')} /{' '}
            {MAX_TOTAL_CONDITION_CHARS.toLocaleString('ja-JP')}文字です。
          </p>
        </div>
      ) : null}
      {isShareUrlWarning && typeof shareUrlLength === 'number' ? (
        <div>
          <strong>共有データ量が上限に近づいています。</strong>
          <p>
            これ以上内容を追加すると、LINEで共有できない可能性があります。
          </p>
          <p>
            現在 {shareUrlLength.toLocaleString('ja-JP')} /{' '}
            {MAX_SHARE_URL_LENGTH.toLocaleString('ja-JP')}文字です。
          </p>
        </div>
      ) : null}
      {typeof shareUrlLength !== 'number' ? (
        <p>
          共有URLを生成できませんでした。入力内容を短くしてもう一度お試しください。
        </p>
      ) : null}
      {isShareUrlOverLimit ? (
        <p className="limit-message">
          LINEで共有できるデータ量を超えています。条件や自由追加商品を短くしてください。
        </p>
      ) : null}
      {limitMessage ? <p className="limit-message">{limitMessage}</p> : null}
    </section>
  )
}
