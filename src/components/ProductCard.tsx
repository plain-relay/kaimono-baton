import type { ReactNode } from 'react'
import type { Product } from '../types/product'
import type { CreateDraftItemState } from '../types/shopping'
import {
  MAX_ITEM_CONDITION_CHARS,
  MAX_ITEM_QUANTITY,
} from '../constants/requestLimits'
import { countUserCharacters } from '../utils/textLength'
import {
  ImeAwareTextInput,
  type CommitTextResult,
} from './ImeAwareTextInput'

type ProductCardProps = {
  product: Product
  draft: CreateDraftItemState
  isExpanded: boolean
  onIncrease: () => void
  onDecrease: () => void
  onToggleDetails: () => void
  onMemoCommit: (value: string) => CommitTextResult
  photoAttachment?: ReactNode
}

export function ProductCard({
  product,
  draft,
  isExpanded,
  onIncrease,
  onDecrease,
  onToggleDetails,
  onMemoCommit,
  photoAttachment,
}: ProductCardProps) {
  const isSelected = draft.quantity > 0
  const hasCondition = draft.memo.trim().length > 0
  const conditionPanelId = `product-condition-${product.id}`
  const conditionCountId = `${conditionPanelId}-count`
  const conditionToggleLabel = [
    `${product.name}の条件を${isExpanded ? '閉じる' : '開く'}`,
    hasCondition ? `${product.name}には入力済みの条件があります` : '',
  ]
    .filter(Boolean)
    .join('。')

  return (
    <article
      className={`product-row ${isSelected ? 'is-selected' : ''}`}
      aria-label={`${product.name}、${isSelected ? `選択済み、数量${draft.quantity}${product.unit}` : '未選択'}`}
    >
      <div className="product-row-main">
        <span className="product-icon" aria-hidden="true">
          {product.icon}
        </span>
        <span className="product-main">
          <strong>{product.name}</strong>
        </span>
        <div className="quantity-stepper" role="group" aria-label={`${product.name}の数量`}>
          <button
            type="button"
            className="step-button"
            onClick={onDecrease}
            disabled={draft.quantity <= 0}
            aria-label={`${product.name}を1${product.unit}減らす（現在${draft.quantity}${product.unit}）`}
          >
            −
          </button>
          <span className="quantity-value" aria-live="polite" aria-atomic="true">
            <strong>{draft.quantity}</strong>
            <small>{product.unit}</small>
          </span>
          <button
            type="button"
            className="step-button"
            onClick={onIncrease}
            disabled={draft.quantity >= MAX_ITEM_QUANTITY}
            aria-label={`${product.name}を1${product.unit}増やす（現在${draft.quantity}${product.unit}）`}
          >
            ＋
          </button>
        </div>
        <button
          type="button"
          className={`detail-toggle ${hasCondition ? 'has-condition' : ''}`}
          onClick={onToggleDetails}
          aria-expanded={isExpanded}
          aria-controls={conditionPanelId}
          aria-label={conditionToggleLabel}
        >
          <span className="condition-entered-marker" aria-hidden="true">
            {hasCondition ? '•' : ''}
          </span>
          <span aria-hidden="true">条件{isExpanded ? '▲' : '▼'}</span>
        </button>
      </div>

      {draft.quantity >= MAX_ITEM_QUANTITY ? (
        <p className="quantity-limit-message" role="status">
          数量は20個までです。
        </p>
      ) : null}

      {isExpanded ? (
        <div id={conditionPanelId} className="product-detail-panel">
          <ImeAwareTextInput
            aria-label={`${product.name}の条件`}
            aria-describedby={conditionCountId}
            placeholder="例：安い方でOK、○○味、500g以上"
            value={draft.memo}
            onCommit={onMemoCommit}
          />
          <span id={conditionCountId} className="character-count">
            {countUserCharacters(draft.memo)} / {MAX_ITEM_CONDITION_CHARS}
          </span>
          {countUserCharacters(draft.memo) >= MAX_ITEM_CONDITION_CHARS ? (
            <p className="limit-inline-message">条件は30文字までです。</p>
          ) : null}
          {photoAttachment}
        </div>
      ) : null}
    </article>
  )
}
