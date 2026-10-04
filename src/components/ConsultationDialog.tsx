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
  onReasonChange: (reason: UnavailableReason | undefined) => void
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
  const canShare = Boolean(selectedReason || note.trim())

  return (
    <ShoppingDialog
      title={`${item.productNameSnapshot}について質問・買わない`}
      titleId={titleId}
      descriptionId={descriptionId}
      onClose={onClose}
    >
      <div id={descriptionId} className="consultation-product-summary">
        <strong>{item.productNameSnapshot}</strong>
        <span>必要数量: {item.quantity}{item.unit}</span>
        {item.memo ? <span>条件: {item.memo}</span> : null}
      </div>

      <label className="stack-field">
        <span>質問・伝えたいこと</span>
        <ImeAwareTextInput
          value={note}
          onCommit={(candidate) => {
            onNoteChange(candidate)
            return { value: candidate, accepted: candidate !== note }
          }}
          placeholder="例：この大きいサイズでもいい？"
          aria-label={`${item.productNameSnapshot}への質問・伝えたいこと`}
          disabled={isSharing}
        />
      </label>
      <p className="helper-text">質問は状況を選ばずに送れます。</p>
      <div className="shopping-dialog-actions consultation-dialog-actions">
        <button
          type="button"
          className="primary-button"
          onClick={onShareImmediately}
          disabled={!canShare || isSharing}
        >
          {isSharing ? '共有中…' : selectedReason ? 'LINEですぐ相談' : 'LINEで質問する'}
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={onAddToQueue}
          disabled={!canShare || isSharing}
        >
          まとめ相談に追加
        </button>
      </div>

      <fieldset className="consultation-reason-fieldset" disabled={isSharing}>
        <legend>見つからない・買わない場合</legend>
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
        {selectedReason ? (
          <button type="button" className="ghost-button" onClick={() => onReasonChange(undefined)}>
            状況の選択を解除
          </button>
        ) : null}
      </fieldset>
      <p className="helper-text">買わない理由を選ぶと、LINEを送らずに見送りを記録できます。</p>
      <div className="shopping-dialog-actions consultation-dialog-actions">
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
