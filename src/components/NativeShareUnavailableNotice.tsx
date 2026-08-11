type NativeShareUnavailableNoticeProps = {
  externalBrowserUrl: string
}

export function NativeShareUnavailableNotice({
  externalBrowserUrl,
}: NativeShareUnavailableNoticeProps) {
  return (
    <section
      className="info-card native-share-unavailable"
      aria-label="共有機能の案内"
    >
      <p>
        この画面ではOSの共有機能を利用できません。
        外部ブラウザで開くと、LINEなどの共有先を選べます。
      </p>
      <a className="primary-button" href={externalBrowserUrl}>
        外部ブラウザで開く
      </a>
    </section>
  )
}
