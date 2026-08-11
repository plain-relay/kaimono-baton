import type {
  ConsultationEntry,
  ShoppingRequestItemPayload,
} from '../types/shopping'
import { getUnavailableReasonLabel } from '../utils/shoppingMessages'

export type ConsultationSummaryEntry = {
  item: ShoppingRequestItemPayload
  consultation: ConsultationEntry
}

type ConsultationSummaryProps = {
  entries: ConsultationSummaryEntry[]
  isSharingConsultation: boolean
  sharingItemId: string | null
  onShareQueued: () => void
  onEdit: (itemId: string) => void
  onShareIndividual: (itemId: string) => void
  onRemove: (itemId: string) => void
  onResolve: (itemId: string) => void
}

export function ConsultationSummary({
  entries,
  isSharingConsultation,
  sharingItemId,
  onShareQueued,
  onEdit,
  onShareIndividual,
  onRemove,
  onResolve,
}: ConsultationSummaryProps) {
  const queuedCount = entries.filter(
    ({ consultation }) => consultation.status === 'queued',
  ).length

  return (
    <section className="info-card consultation-summary-card">
      <div className="consultation-summary-heading">
        <div>
          <h2>相談内容</h2>
          <p className="helper-text">未解決の相談が{entries.length}件あります。</p>
        </div>
        <strong>まとめ相談 {queuedCount}件</strong>
      </div>

      {queuedCount > 0 ? (
        <button
          type="button"
          className="primary-button consultation-bulk-button"
          onClick={onShareQueued}
          disabled={isSharingConsultation}
        >
          {isSharingConsultation && sharingItemId === null
            ? '共有中…'
            : 'まとめてLINEで相談'}
        </button>
      ) : null}

      <ul className="consultation-summary-list">
        {entries.map(({ item, consultation }) => (
          <li key={item.id}>
            <div>
              <strong>{item.productNameSnapshot}</strong>
              <span>{item.quantity}{item.unit}</span>
              <span>{getUnavailableReasonLabel(consultation.reason)}</span>
              {consultation.note ? <small>補足: {consultation.note}</small> : null}
              <small>
                {consultation.status === 'queued'
                  ? 'まとめ相談に追加済み'
                  : '共有操作済み'}
              </small>
            </div>
            <div className="consultation-entry-actions">
              <button
                type="button"
                className="secondary-button compact-button"
                onClick={() => onShareIndividual(item.id)}
                disabled={isSharingConsultation}
              >
                {isSharingConsultation && sharingItemId === item.id
                  ? '共有中…'
                  : 'LINEですぐ相談'}
              </button>
              <button
                type="button"
                className="ghost-button compact-button"
                onClick={() => onEdit(item.id)}
                disabled={isSharingConsultation}
              >
                編集
              </button>
              <button
                type="button"
                className="ghost-button compact-button"
                onClick={() => onRemove(item.id)}
                disabled={isSharingConsultation}
              >
                削除
              </button>
              <button
                type="button"
                className="ghost-button compact-button"
                onClick={() => onResolve(item.id)}
                disabled={isSharingConsultation}
              >
                相談を解決
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
