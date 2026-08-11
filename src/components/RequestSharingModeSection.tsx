export type RequestSharingMode = 'fixed' | 'live'

type RequestSharingModeSectionProps = {
  value: RequestSharingMode
  onChange: (value: RequestSharingMode) => void
}

export function RequestSharingModeSection({
  value,
  onChange,
}: RequestSharingModeSectionProps) {
  return (
    <fieldset className="info-card request-sharing-mode">
      <legend>共有後の変更</legend>
      <label>
        <input
          type="radio"
          name="request-sharing-mode"
          value="fixed"
          checked={value === 'fixed'}
          onChange={() => onChange('fixed')}
        />
        <span>
          <strong>変更しない通常依頼</strong>
          <small>従来どおり、共有した時点の商品を固定します。</small>
        </span>
      </label>
      <label>
        <input
          type="radio"
          name="request-sharing-mode"
          value="live"
          checked={value === 'live'}
          onChange={() => onChange('live')}
        />
        <span>
          <strong>あとから追加・変更できる依頼</strong>
          <small>14日間、依頼者用の管理リンクから内容を変更できます。</small>
        </span>
      </label>
    </fieldset>
  )
}
