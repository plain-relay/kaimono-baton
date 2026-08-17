import { CatalogBackupStatus } from '../components/CatalogBackupStatus'
import { useHouseholdCatalog } from '../hooks/useHouseholdCatalog'

type HomePageProps = {
  onStartCreate: () => void
  onOpenProducts: () => void
  onOpenAbout: () => void
}

export function HomePage({
  onStartCreate,
  onOpenProducts,
  onOpenAbout,
}: HomePageProps) {
  const { catalog, backupStatus, confirmCatalogBackup } =
    useHouseholdCatalog()

  return (
    <main className="page">
      <section className="hero-card product-home-hero">
        <div className="product-home-title-row">
          <h1>買いものバトン</h1>
          <span className="product-home-status">外部試験版（Beta）</span>
        </div>
        <p className="product-home-copy">
          <span>「これ買ってきて」を、</span>
          <span>もっと伝えやすく。</span>
        </p>
        <p className="lead product-home-description">
          家族に渡せる買いものリストです。
        </p>
        <div className="product-home-actions">
          <button
            type="button"
            className="primary-button large-button"
            onClick={onStartCreate}
          >
            ＋ 新しい買いものリストを作る
          </button>
          <button
            type="button"
            className="secondary-button large-button"
            onClick={onOpenProducts}
          >
            商品リストを編集
          </button>
        </div>
        <p className="helper-text product-home-note">
          テスト公開中のため、不具合がある場合があります。
        </p>
      </section>

      {backupStatus === 'unbacked' ? (
        <CatalogBackupStatus
          catalog={catalog}
          backupStatus={backupStatus}
          compact
          onConfirmBackup={confirmCatalogBackup}
        />
      ) : null}

      <section className="info-card product-home-guide" aria-labelledby="product-home-guide-title">
        <p className="eyebrow">初めての方へ</p>
        <h2 id="product-home-guide-title">買いものバトンの使い方</h2>
        <ol className="product-home-steps">
          <li>
            <span className="product-home-step-number" aria-hidden="true">1</span>
            <div>
              <h3>作る</h3>
              <p className="product-home-step-title">買ってきてほしいものをまとめる</p>
              <p>商品・数量・必要な条件を買いものリストにまとめます。</p>
            </div>
          </li>
          <li>
            <span className="product-home-step-number" aria-hidden="true">2</span>
            <div>
              <h3>渡す</h3>
              <p className="product-home-step-title">家族に買いものバトンを渡す</p>
              <p>作成した共有URLをLINEなどで家族に送ります。</p>
            </div>
          </li>
          <li>
            <span className="product-home-step-number" aria-hidden="true">3</span>
            <div>
              <h3>買う</h3>
              <p className="product-home-step-title">リストを見ながら買い物</p>
              <p>受け取った人が必要な内容を確認しながら、買い物の進捗を記録します。</p>
            </div>
          </li>
        </ol>
        <p className="product-home-summary">
          作る → 渡す → 買う。だから「買いものバトン」。
        </p>
        <div className="product-home-about-action">
          <button type="button" className="product-home-about-link" onClick={onOpenAbout}>
            このアプリについて
          </button>
        </div>
      </section>
    </main>
  )
}
