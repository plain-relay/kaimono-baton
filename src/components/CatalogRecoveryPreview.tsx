import { useEffect, useMemo, useRef } from 'react'
import type { CatalogRecoveryPayloadV1 } from '../types/householdCatalog'
import { createCatalogRecoveryPreview } from '../utils/catalogRecovery'

type CatalogRecoveryPreviewProps = {
  payload: CatalogRecoveryPayloadV1
  isOlderThanCurrent: boolean
  isRestoring?: boolean
  errorMessage?: string
  onRestore: () => void
  onCancel: () => void
}

function formatSavedAt(createdAt: string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(createdAt))
}

export function CatalogRecoveryPreview({
  payload,
  isOlderThanCurrent,
  isRestoring = false,
  errorMessage = '',
  onRestore,
  onCancel,
}: CatalogRecoveryPreviewProps) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  const preview = useMemo(
    () => createCatalogRecoveryPreview(payload),
    [payload],
  )

  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  return (
    <section className="info-card catalog-recovery-preview">
      <p className="eyebrow">内容を確認してから置き換えます</p>
      <h1 ref={titleRef} tabIndex={-1}>
        商品リストを復元
      </h1>
      <p className="catalog-recovery-date">
        <span>保存日時</span>
        <strong>{formatSavedAt(payload.createdAt)}</strong>
      </p>

      <h2>変更される内容</h2>
      <dl className="catalog-recovery-counts">
        <div>
          <dt>名前変更</dt>
          <dd>{preview.renamed}件</dd>
        </div>
        <div>
          <dt>単位変更</dt>
          <dd>{preview.unitChanged}件</dd>
        </div>
        <div>
          <dt>カテゴリ変更</dt>
          <dd>{preview.categoryChanged}件</dd>
        </div>
        <div>
          <dt>非表示</dt>
          <dd>{preview.hidden}件</dd>
        </div>
        <div>
          <dt>追加商品</dt>
          <dd>{preview.added}件</dd>
        </div>
      </dl>

      {isOlderThanCurrent ? (
        <p className="catalog-recovery-warning" role="alert">
          この復旧データは、現在の商品リストより古い可能性があります。置き換えると現在の変更が失われます。
        </p>
      ) : null}

      {errorMessage ? (
        <p className="catalog-recovery-error" role="alert">
          {errorMessage}
        </p>
      ) : null}

      <div className="catalog-recovery-actions">
        <button
          type="button"
          className="primary-button"
          disabled={isRestoring}
          onClick={onCancel}
        >
          キャンセル
        </button>
        <button
          type="button"
          className="ghost-button danger-button"
          disabled={isRestoring}
          onClick={onRestore}
        >
          {isRestoring
            ? '商品リストを復元しています…'
            : 'この商品リストに置き換える'}
        </button>
      </div>
    </section>
  )
}
