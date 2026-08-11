import type { ReactNode } from 'react'
import type {
  CheckedItemStatus,
  ConsultationEntry,
  ItemIssue,
  ShoppingRequestItemPayload,
} from '../types/shopping'
import {
  getItemIssueLabel,
  getUnavailableReasonLabel,
} from '../utils/shoppingMessages'
import { hasCondition } from '../utils/shoppingState'

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
  return item.quantity >= 2
    ? `${item.quantity}${item.unit}をかごに入れる`
    : 'かごに入れる'
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

  return (
    <article className={`shopping-item-card is-${effectiveStatus}`}>
      <span className="shopping-icon" aria-hidden="true">
        {item.iconSnapshot}
      </span>
      <span className="shopping-body">
        <span className="shopping-title-row">
          <strong>{item.productNameSnapshot}</strong>
          {conditionItem ? <span className="condition-badge">条件あり</span> : null}
          {unresolvedConsultation ? (
            <span className="consultation-badge">
              {consultation.status === 'queued'
                ? 'まとめ相談に追加済み'
                : '共有操作済み'}
            </span>
          ) : null}
        </span>
        {changeNotice}
        {photoContent}
        {item.memo ? <span className="shopping-condition">条件: {item.memo}</span> : null}
        {effectiveStatus === 'notBuying' ? (
          <span className="shopping-issue">
            理由: {getItemIssueLabel(issue)}
            {issue?.note ? <small>補足: {issue.note}</small> : null}
          </span>
        ) : null}
        {unresolvedConsultation ? (
          <span className="shopping-consultation">
            相談内容: {getUnavailableReasonLabel(consultation.reason)}
            {consultation.note ? <small>補足: {consultation.note}</small> : null}
          </span>
        ) : null}
        <span className="shopping-state">{getStatusLabel(status)}</span>
      </span>
      <span
        className={`shopping-quantity-block ${item.quantity > 1 ? 'is-multiple' : ''}`}
        aria-label={`必要数量 ${item.quantity}${item.unit}`}
      >
        <strong>{item.quantity >= 2 ? `×${item.quantity}` : item.quantity}</strong>
        <small>{item.unit}</small>
      </span>

      <span className="shopping-actions">
        {effectiveStatus === 'pending' ? (
          <button
            type="button"
            className="primary-button shopping-cart-button"
            onClick={onAddToCart}
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
          aria-label={`${item.productNameSnapshot}について相談する`}
        >
          相談する
        </button>

        {effectiveStatus !== 'pending' ? (
          <button
            type="button"
            className="ghost-button shopping-secondary-button"
            onClick={onReset}
            aria-label={`${item.productNameSnapshot}を未購入に戻す`}
            disabled={isPurchaseLocked}
          >
            未購入に戻す
          </button>
        ) : null}
      </span>
    </article>
  )
}
