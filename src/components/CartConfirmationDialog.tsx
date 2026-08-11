import type { ShoppingRequestItemPayload } from '../types/shopping'
import { ShoppingDialog } from './ShoppingDialog'

type CartConfirmationDialogProps = {
  item: ShoppingRequestItemPayload
  needsQuantityConfirmation: boolean
  needsConditionConfirmation: boolean
  quantityConfirmed: boolean
  conditionConfirmed: boolean
  isConditionFollowUp: boolean
  isPurchaseLocked: boolean
  isConsultationLocked: boolean
  onQuantityConfirmedChange: (confirmed: boolean) => void
  onConditionConfirmedChange: (confirmed: boolean) => void
  onConsult: () => void
  onClose: () => void
  onConfirm: () => void
}

function getConfirmButtonLabel({
  item,
  needsQuantityConfirmation,
  needsConditionConfirmation,
}: Pick<
  CartConfirmationDialogProps,
  'item' | 'needsQuantityConfirmation' | 'needsConditionConfirmation'
>): string {
  if (needsQuantityConfirmation && needsConditionConfirmation) {
    return '確認してかご済みにする'
  }
  if (needsQuantityConfirmation) {
    return `${item.quantity}${item.unit}をかご済みにする`
  }
  return '条件を確認してかご済みにする'
}

export function CartConfirmationDialog({
  item,
  needsQuantityConfirmation,
  needsConditionConfirmation,
  quantityConfirmed,
  conditionConfirmed,
  isConditionFollowUp,
  isPurchaseLocked,
  isConsultationLocked,
  onQuantityConfirmedChange,
  onConditionConfirmedChange,
  onConsult,
  onClose,
  onConfirm,
}: CartConfirmationDialogProps) {
  const titleId = `cart-confirmation-title-${item.id}`
  const descriptionId = `cart-confirmation-description-${item.id}`
  const canConfirm =
    (!needsQuantityConfirmation || quantityConfirmed) &&
    (!needsConditionConfirmation || conditionConfirmed)

  return (
    <ShoppingDialog
      title={
        isConditionFollowUp
          ? `${item.productNameSnapshot}の条件を確認します`
          : `${item.productNameSnapshot}をかごに入れます`
      }
      titleId={titleId}
      descriptionId={descriptionId}
      onClose={onClose}
    >
      <p id={descriptionId} className="shopping-dialog-description">
        必要な項目をそれぞれ確認してから、かご済みにしてください。
      </p>

      <div className="cart-confirmation-sections">
        {needsQuantityConfirmation ? (
          <section className="cart-confirmation-section" aria-labelledby={`quantity-heading-${item.id}`}>
            <h3 id={`quantity-heading-${item.id}`}>数量の確認</h3>
            <p className="cart-confirmation-value">
              <span>必要数量</span>
              <strong>{item.quantity}{item.unit}</strong>
            </p>
            <label className="cart-confirmation-check">
              <input
                type="checkbox"
                checked={quantityConfirmed}
                onChange={(event) => onQuantityConfirmedChange(event.target.checked)}
                disabled={isPurchaseLocked}
              />
              <span>{item.quantity}{item.unit}をかごに入れた</span>
            </label>
          </section>
        ) : null}

        {needsConditionConfirmation ? (
          <section className="cart-confirmation-section" aria-labelledby={`condition-heading-${item.id}`}>
            <h3 id={`condition-heading-${item.id}`}>条件の確認</h3>
            <p className="cart-confirmation-condition">{item.memo}</p>
            <label className="cart-confirmation-check">
              <input
                type="checkbox"
                checked={conditionConfirmed}
                onChange={(event) => onConditionConfirmedChange(event.target.checked)}
                disabled={isPurchaseLocked}
              />
              <span>この条件に合う商品をかごに入れた</span>
            </label>
          </section>
        ) : null}
      </div>

      <div className="shopping-dialog-actions">
        <button
          type="button"
          className="secondary-button"
          onClick={onConsult}
          disabled={isConsultationLocked}
        >
          相談する
        </button>
        <button type="button" className="ghost-button" onClick={onClose}>
          戻る
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={onConfirm}
          disabled={!canConfirm || isPurchaseLocked}
        >
          {getConfirmButtonLabel({
            item,
            needsQuantityConfirmation,
            needsConditionConfirmation,
          })}
        </button>
      </div>
    </ShoppingDialog>
  )
}
