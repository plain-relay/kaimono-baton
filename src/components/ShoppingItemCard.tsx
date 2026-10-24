import { useEffect, useRef, useState, type ReactNode } from 'react'
import type {
  CheckedItemStatus,
  ConsultationEntry,
  ItemIssue,
  ShoppingRequestItemPayload,
} from '../types/shopping'
import {
  getItemIssueLabel,
  getUnavailableReasonLabel,
  isFreeQuestion,
} from '../utils/shoppingMessages'
import { hasCondition, isCartStatus } from '../utils/shoppingState'

type ShoppingItemCardProps = {
  item: ShoppingRequestItemPayload
  status: CheckedItemStatus
  issue?: ItemIssue
  consultation?: ConsultationEntry
  isPurchaseLocked: boolean
  isConsultationLocked: boolean
  onAddToCart: () => void
  onOpenConditionConfirmation: () => void
  onOpenConsultation: () => void
  onReset: () => void
  photoContent?: ReactNode
  changeNotice?: ReactNode
}

function getStatusLabel(status: CheckedItemStatus): string {
  const labels: Record<CheckedItemStatus, string> = {
    pending: '未購入',
    inCart: 'かご済み',
    verified: '購入時に条件確認済み',
    consulting: '未購入',
    notBuying: '今回は買わない',
  }

  return labels[status]
}

function getCartButtonLabel(item: ShoppingRequestItemPayload): string {
  return `${item.quantity}${item.unit}をかごに入れる`
}

export function ShoppingItemCard({
  item,
  status,
  issue,
  consultation,
  isPurchaseLocked,
  isConsultationLocked,
  onAddToCart,
  onOpenConditionConfirmation,
  onOpenConsultation,
  onReset,
  photoContent,
  changeNotice,
}: ShoppingItemCardProps) {
  const conditionItem = hasCondition(item)
  const effectiveStatus = status === 'consulting' ? 'pending' : status
  const unresolvedConsultation =
    consultation?.status === 'queued' || consultation?.status === 'shared'
  const isCompact = isCartStatus(status) &&
    (status === 'verified' || !conditionItem) && !unresolvedConsultation && !changeNotice
  const [isDetailsOpen, setIsDetailsOpen] = useState(false)
  const cardRef = useRef<HTMLElement>(null)
  const summaryRef = useRef<HTMLButtonElement>(null)
  const detailsRef = useRef<HTMLDivElement>(null)
  const previousCompactRef = useRef(isCompact)
  const restoreActionFocusRef = useRef(false)
  const detailsId = `shopping-details-${item.id}`

  useEffect(() => {
    if (previousCompactRef.current !== isCompact) {
      setIsDetailsOpen(false)
      // Keep keyboard focus on a visible control when purchase/Undo changes the view.
      if (restoreActionFocusRef.current || cardRef.current?.contains(document.activeElement)) {
        if (isCompact) summaryRef.current?.focus()
        else detailsRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus()
      }
      previousCompactRef.current = isCompact
      restoreActionFocusRef.current = false
    }
  }, [isCompact])

  return (
    <article ref={cardRef} className={`shopping-item-card is-${effectiveStatus}${isCompact ? ' is-compact' : ''}`}>
      <button ref={summaryRef} type="button" className="shopping-compact-summary"
        hidden={!isCompact} aria-expanded={isDetailsOpen} aria-controls={detailsId}
        aria-label={`${item.productNameSnapshot} ${item.quantity}${item.unit} 購入済みの詳細を${isDetailsOpen ? '閉じる' : '開く'}`}
        onClick={() => setIsDetailsOpen((current) => !current)}>
        <strong>{item.productNameSnapshot}</strong>
        <span>{item.quantity}{item.unit}</span>
        <span>購入済み</span>
        <span aria-hidden="true">{isDetailsOpen ? '▲' : '▼'}</span>
      </button>
      <div ref={detailsRef} id={detailsId} className="shopping-item-details" hidden={isCompact && !isDetailsOpen}>
      <span className="shopping-icon" aria-hidden="true">
        {item.iconSnapshot}
      </span>
      <span className="shopping-body">
        <span className="shopping-title-row">
          <strong>{item.productNameSnapshot}</strong>
          <span
            className="shopping-quantity-block"
            aria-label={`必要数量 ${item.quantity}${item.unit}`}
          >
            {item.quantity}{item.unit}
          </span>
          {unresolvedConsultation ? (
            <span className="consultation-badge">
              {consultation.status === 'queued'
                ? 'まとめ相談に追加済み'
                : '共有操作済み'}
            </span>
          ) : null}
        </span>
        {item.memo ? <span className="shopping-condition">条件: {item.memo}</span> : null}
        {changeNotice}
        {photoContent}
        {effectiveStatus === 'notBuying' ? (
          <span className="shopping-issue">
            理由: {getItemIssueLabel(issue)}
            {issue?.note ? <small>補足: {issue.note}</small> : null}
          </span>
        ) : null}
        {unresolvedConsultation ? (
          <span className="shopping-consultation">
            {isFreeQuestion(consultation) ? (
              `質問: ${consultation.note}`
            ) : (
              <>
                相談内容: {getUnavailableReasonLabel(consultation.reason)}
                {consultation.note ? <small>補足: {consultation.note}</small> : null}
              </>
            )}
          </span>
        ) : null}
        <span className="shopping-state">{getStatusLabel(status)}</span>
      </span>
      <span className="shopping-actions">
        {effectiveStatus === 'pending' ? (
          <button
            type="button"
            className="primary-button shopping-cart-button"
            onClick={(event) => {
              restoreActionFocusRef.current = document.activeElement === event.currentTarget
              onAddToCart()
            }}
            disabled={isPurchaseLocked}
            aria-label={`${item.productNameSnapshot}を${item.quantity}${item.unit}かごに入れる`}
          >
            {getCartButtonLabel(item)}
          </button>
        ) : null}

        {effectiveStatus === 'inCart' && conditionItem ? (
          <button
            type="button"
            className="primary-button shopping-cart-button"
            onClick={onOpenConditionConfirmation}
            disabled={isPurchaseLocked}
            aria-label={`${item.productNameSnapshot}の購入時条件確認を開く`}
          >
            購入時の条件を確認する
          </button>
        ) : null}

        <button
          type="button"
          className="secondary-button shopping-secondary-button"
          onClick={onOpenConsultation}
          disabled={isConsultationLocked}
          aria-label={`${item.productNameSnapshot}について質問・買わない`}
        >
          質問・買わない
        </button>

        {effectiveStatus !== 'pending' ? (
          <button
            type="button"
            className="ghost-button shopping-secondary-button"
            onClick={(event) => {
              restoreActionFocusRef.current = document.activeElement === event.currentTarget
              onReset()
            }}
            aria-label={`${item.productNameSnapshot}を未購入に戻す`}
            disabled={isPurchaseLocked}
          >
            未購入に戻す
          </button>
        ) : null}
      </span>
      </div>
    </article>
  )
}
