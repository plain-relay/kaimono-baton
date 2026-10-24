import { useEffect, useRef, useState } from 'react'
import type {
  ShoppingRequestItemPayload,
  UnavailableReason,
} from '../types/shopping'
import { buildIndividualConsultationMessage, CONSULTATION_TEMPLATES, getUnavailableReasonLabel } from '../utils/shoppingMessages'
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
  const [pendingTemplate, setPendingTemplate] = useState<string | null>(null)
  const focusNoteRef = useRef(false)
  const noteId = `consultation-note-${item.id}`
  useEffect(() => {
    if (focusNoteRef.current && pendingTemplate === null) {
      focusNoteRef.current = false
      document.getElementById(noteId)?.focus()
    }
  }, [note, noteId, pendingTemplate])
  const applyTemplate = (text: string) => {
    focusNoteRef.current = true
    onReasonChange(undefined)
    onNoteChange(text)
    setPendingTemplate(null)
  }

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

      <div className="consultation-template-actions" role="group" aria-label="定型相談">
        {CONSULTATION_TEMPLATES.map((template) => (
          <button key={template.label} type="button" className="secondary-button" disabled={isSharing}
            onClick={() => note.trim() && note !== template.note ? setPendingTemplate(template.note) : applyTemplate(template.note)}>
            {template.label}
          </button>
        ))}
      </div>
      {pendingTemplate !== null ? (
        <div className="info-card" role="group" aria-label="相談文の置き換え確認">
          <p>入力済みの文章を定型文に置き換えますか？</p>
          <div className="inline-actions">
            <button type="button" className="secondary-button" disabled={isSharing} onClick={() => applyTemplate(pendingTemplate)}>定型文に置き換える</button>
            <button type="button" className="ghost-button" onClick={() => setPendingTemplate(null)}>入力を残す</button>
          </div>
        </div>
      ) : null}

      <label className="stack-field">
        <span>質問・伝えたいこと</span>
        <ImeAwareTextInput
          id={noteId}
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
      {canShare ? (
        <details className="consultation-message-preview">
          <summary>共有する相談文を確認</summary>
          <pre>{buildIndividualConsultationMessage(item, { reason: selectedReason ?? 'other', note })}</pre>
        </details>
      ) : null}
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
