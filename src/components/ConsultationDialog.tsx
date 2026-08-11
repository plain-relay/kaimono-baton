import type {
  ShoppingRequestItemPayload,
  UnavailableReason,
} from '../types/shopping'
import { getUnavailableReasonLabel } from '../utils/shoppingMessages'
import { ImeAwareTextInput } from './ImeAwareTextInput'
import { ShoppingDialog } from './ShoppingDialog'

type ConsultationDialogProps = {
  item: ShoppingRequestItemPayload
  selectedReason?: UnavailableReason
  note: string
  isSharing: boolean
  onReasonChange: (reason: UnavailableReason) => void
  onNoteChange: (note: string) => void
  onShareImmediately: () => void
  onAddToQueue: () => void
  onMarkNotBuying: () => void
  onClose: () => void
}

const UNAVAILABLE_REASONS: UnavailableReason[] = [
  'soldOut',
  'notFound',
  'conditionMismatch',
  'poorCondition',
  'other',
]

export function ConsultationDialog({
  item,
  selectedReason,
  note,
  isSharing,
  onReasonChange,
  onNoteChange,
  onShareImmediately,
  onAddToQueue,
  onMarkNotBuying,
  onClose,
}: ConsultationDialogProps) {
  const titleId = `consultation-title-${item.id}`
  const descriptionId = `consultation-description-${item.id}`

  return (
    <ShoppingDialog
      title={`${item.productNameSnapshot}について相談する`}
      titleId={titleId}
      descriptionId={descriptionId}
      onClose={onClose}
    >
      <div id={descriptionId} className="consultation-product-summary">
        <strong>{item.productNameSnapshot}</strong>
        <span>必要数量: {item.quantity}{item.unit}</span>
        {item.memo ? <span>条件: {item.memo}</span> : null}
      </div>

      <fieldset className="consultation-reason-fieldset" disabled={isSharing}>
        <legend>状況を選んでください</legend>
        <div className="issue-reason-options">
          {UNAVAILABLE_REASONS.map((reason) => (
            <label
              key={reason}
              className={`issue-reason-option ${selectedReason === reason ? 'is-selected' : ''}`}
            >
              <input
                type="radio"
                name={`consultation-reason-${item.id}`}
                value={reason}
                checked={selectedReason === reason}
                onChange={() => onReasonChange(reason)}
              />
              <span>{getUnavailableReasonLabel(reason)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="stack-field">
        <span>補足（任意）</span>
        <ImeAwareTextInput
          value={note}
          onCommit={(candidate) => {
            onNoteChange(candidate)
            return {
              value: candidate,
              accepted: candidate !== note,
            }
          }}
          placeholder="例：別の容量ならありました"
          aria-label={`${item.productNameSnapshot}の相談内容の補足`}
          disabled={isSharing}
        />
      </label>

      <div className="shopping-dialog-actions consultation-dialog-actions">
        <button
          type="button"
          className="primary-button"
          onClick={onShareImmediately}
          disabled={!selectedReason || isSharing}
        >
          {isSharing ? '共有中…' : 'LINEですぐ相談'}
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={onAddToQueue}
          disabled={!selectedReason || isSharing}
        >
          まとめ相談に追加
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={onMarkNotBuying}
          disabled={!selectedReason || isSharing}
        >
          今回は買わない
        </button>
        <button type="button" className="ghost-button" onClick={onClose}>
          戻る
        </button>
      </div>
    </ShoppingDialog>
  )
}
