import { getLiveRequestConfig } from '../features/liveRequests/config'

type AboutPageProps = {
  onBackHome: () => void
  liveRequestsEnabled?: boolean
}

export function AboutPage({
  onBackHome,
  liveRequestsEnabled = getLiveRequestConfig().enabled,
}: AboutPageProps) {
  return (
    <main className="page">
      <section className="top-bar">
        <button type="button" className="ghost-button" onClick={onBackHome}>
          ホームへ
        </button>
        <div>
          <p className="eyebrow">買いものバトン</p>
          <h1>このアプリについて</h1>
        </div>
      </section>

      <section className="info-card about-card">
        <h2>試験公開について</h2>
        <p>現在は外部試験公開中です。不具合がある場合があります。</p>
      </section>

      <section className="info-card about-card">
        <h2>依頼内容</h2>
        {liveRequestsEnabled ? (
          <>
            <p>通常の固定依頼は、依頼内容が共有URLに含まれています。</p>
            <p>
              更新可能な依頼は、依頼内容を共有時から14日間だけ保存し、期限を延長しません。
            </p>
          </>
        ) : (
          <p>依頼内容は共有URLに含まれています。</p>
        )}
        <p>共有URLを知っている人は、依頼内容を見ることができます。</p>
        <p>
          パスワード、個人情報、その他の秘密にしたい情報は書かないでください。
        </p>
      </section>

      <section className="info-card about-card">
        <h2>安全上の注意</h2>
        <p>
          医療やアレルギーなど安全上重要な買い物では、このアプリの情報だけに頼らず、購入者と直接確認してください。
        </p>
      </section>

      <section className="info-card about-card">
        <h2>今回の外部価値検証</h2>
        <p>
          固定依頼、URL共有、買い物の進捗などのStable Free Coreだけが対象です。
        </p>
        <p>
          写真、更新可能な依頼（v5 / live requests）、手書き取り込みなどのサーバーを使う実験的機能は提供対象外です。
        </p>
      </section>

      <section className="info-card about-card">
        <h2>買い物の進捗</h2>
        <p>
          買い物の進捗は、操作している端末とブラウザ内（localStorage）に保存されます。
        </p>
        <p>別の端末や別のブラウザでは、進捗が引き継がれない場合があります。</p>
        <p>
          LINE内ブラウザとChrome・Safariなどの外部ブラウザでは、保存された進捗が共有されない場合があります。
        </p>
      </section>

      <section className="info-card about-card">
        <h2>アカウントとサーバー</h2>
        <p>アカウント登録やサーバーへの進捗保存は使用していません。</p>
      </section>

      <section className="info-card about-card">
        <h2>データの自動収集</h2>
        <p>
          今回の外部価値検証では、商品名・条件・共有URLなどの買い物内容を、アクセス解析などで自動収集しません。
        </p>
      </section>
    </main>
  )
}
