import { useMemo, useState } from 'react'
import { CatalogRecoveryPreview } from '../components/CatalogRecoveryPreview'
import { useHouseholdCatalog } from '../hooks/useHouseholdCatalog'
import {
  decodeCatalogRecoveryPayload,
  isRecoveryPayloadOlderThanCatalog,
} from '../utils/catalogRecovery'
import { hasHouseholdCatalogChanges } from '../utils/catalogFingerprint'

type CatalogRecoveryPageProps = {
  encoded: string
  onBackHome: () => void
  onOpenProducts: () => void
}

export function CatalogRecoveryPage({
  encoded,
  onBackHome,
  onOpenProducts,
}: CatalogRecoveryPageProps) {
  const { catalog, replaceCatalogFromRecovery } = useHouseholdCatalog()
  const [restoreError, setRestoreError] = useState('')
  const [isRestoring, setIsRestoring] = useState(false)
  const [isRestored, setIsRestored] = useState(false)
  const decoded = useMemo(() => {
    try {
      return {
        payload: decodeCatalogRecoveryPayload(encoded),
        error: '',
      }
    } catch (error) {
      return {
        payload: null,
        error:
          error instanceof Error
            ? error.message
            : '商品リスト復旧データを開けませんでした。',
      }
    }
  }, [encoded])

  if (!decoded.payload) {
    return (
      <main className="page">
        <section className="top-bar">
          <button type="button" className="ghost-button" onClick={onBackHome}>
            ホームへ
          </button>
          <h1>商品リストを復元</h1>
        </section>
        <section className="info-card error-card">
          <h2>復旧データを確認できません</h2>
          <p>{decoded.error}</p>
        </section>
      </main>
    )
  }

  const handleRestore = () => {
    setIsRestoring(true)
    setRestoreError('')
    if (!replaceCatalogFromRecovery(decoded.payload)) {
      setRestoreError(
        '商品リストを復元できませんでした。ブラウザの保存容量を確認してください。',
      )
      setIsRestoring(false)
      return
    }
    setIsRestored(true)
    setIsRestoring(false)
  }

  if (isRestored) {
    return (
      <main className="page">
        <section className="info-card catalog-recovery-success">
          <p className="eyebrow">復元が完了しました</p>
          <h1>商品リストを置き換えました</h1>
          <p>
            復元した商品名・単位・カテゴリ・表示設定を、依頼作成で利用できます。
          </p>
          <div className="catalog-recovery-actions">
            <button
              type="button"
              className="primary-button"
              onClick={onOpenProducts}
            >
              商品リストを確認
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={onBackHome}
            >
              ホームへ
            </button>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="page">
      <CatalogRecoveryPreview
        payload={decoded.payload}
        isOlderThanCurrent={
          hasHouseholdCatalogChanges(catalog) &&
          isRecoveryPayloadOlderThanCatalog(decoded.payload, catalog)
        }
        isRestoring={isRestoring}
        errorMessage={restoreError}
        onRestore={handleRestore}
        onCancel={onBackHome}
      />
    </main>
  )
}
