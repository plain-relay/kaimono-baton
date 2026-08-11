import type { Ref } from 'react'
import type {
  CheckedStateMap,
  ConsultationEntry,
  ItemIssueMap,
  ShoppingRequestItemPayload,
} from '../types/shopping'
import {
  getItemIssueLabel,
  getUnavailableReasonLabel,
} from '../utils/shoppingMessages'
import {
  getItemStatus,
  hasCondition,
  type ShoppingCompletionState,
} from '../utils/shoppingState'

type CheckoutConsultationEntry = {
  item: ShoppingRequestItemPayload
  consultation: ConsultationEntry
}

type CheckoutReviewSectionProps = {
  cartItems: ShoppingRequestItemPayload[]
  notBuyingItems: ShoppingRequestItemPayload[]
  pendingItems: ShoppingRequestItemPayload[]
  consultationEntries: CheckoutConsultationEntry[]
  checkedState: CheckedStateMap
  itemIssues: ItemIssueMap
  completionState: ShoppingCompletionState
  isConsultationShareActive: boolean
  sectionRef: Ref<HTMLElement>
  onResetItem: (itemId: string) => void
  onOpenConditionConfirmation: (itemId: string) => void
  onEditConsultation: (itemId: string) => void
  onResolveConsultation: (itemId: string) => void
  onFinishShopping: () => void
}

export function CheckoutReviewSection({
  cartItems,
  notBuyingItems,
  pendingItems,
  consultationEntries,
  checkedState,
  itemIssues,
  completionState,
  isConsultationShareActive,
  sectionRef,
  onResetItem,
  onOpenConditionConfirmation,
  onEditConsultation,
  onResolveConsultation,
  onFinishShopping,
}: CheckoutReviewSectionProps) {
  return (
    <section
      className="info-card checkout-review-card"
      ref={sectionRef}
      tabIndex={-1}
      aria-labelledby="checkout-review-heading"
    >
      <div className="section-heading">
        <h2 id="checkout-review-heading">会計前チェック</h2>
        <span>{cartItems.length}件</span>
      </div>
      <p className="helper-text">
        かごの商品と、未処理・未解決の例外を確認してください。
      </p>

      {cartItems.length > 0 ? (
        <div className="checkout-list">
          {cartItems.map((item) => {
            const status = getItemStatus(checkedState, item.id)
            const conditionItem = hasCondition(item)

            return (
              <article key={item.id} className={`checkout-item is-${status}`}>
                <div className="checkout-item-main">
                  <span className="shopping-icon" aria-hidden="true">
                    {item.iconSnapshot}
                  </span>
                  <span>
                    <span className="shopping-title-row">
                      <strong>{item.productNameSnapshot}</strong>
                      {conditionItem ? <span className="condition-badge">条件あり</span> : null}
                    </span>
                    <span
                      className={`checkout-quantity ${item.quantity >= 2 ? 'is-multiple' : ''}`}
                    >
                      {item.quantity}{item.unit}
                    </span>
                    {item.memo ? (
                      <span className="shopping-condition">条件: {item.memo}</span>
                    ) : null}
                    <span className="shopping-state">
                      {status === 'verified' ? '購入時に条件確認済み' : 'かご済み'}
                    </span>
                  </span>
                </div>
                <div className="checkout-actions">
                  {conditionItem && status === 'inCart' ? (
                    <button
                      type="button"
                      className="primary-button compact-button"
                      onClick={() => onOpenConditionConfirmation(item.id)}
                      aria-label={`${item.productNameSnapshot}の購入時条件確認を開く`}
                    >
                      購入時確認を開く
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="ghost-button compact-button"
                    onClick={() => onResetItem(item.id)}
                    aria-label={`${item.productNameSnapshot}を未購入に戻す`}
                  >
                    未購入に戻す
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      ) : (
        <p className="empty-checkout-message">かごに入れた商品はありません。</p>
      )}

      {notBuyingItems.length > 0 ? (
        <div className="checkout-not-buying">
          <h3>今回は買わない商品</h3>
          <ul>
            {notBuyingItems.map((item) => (
              <li key={item.id}>
                <strong>{item.productNameSnapshot}</strong>
                <span>{getItemIssueLabel(itemIssues[item.id])}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {pendingItems.length > 0 ? (
        <div className="checkout-exception-list">
          <h3>未処理の商品</h3>
          <ul>
            {pendingItems.map((item) => (
              <li key={item.id}>
                <strong>{item.productNameSnapshot}</strong>
                <span>{item.quantity}{item.unit}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {consultationEntries.length > 0 ? (
        <div className="checkout-exception-list">
          <h3>未解決相談</h3>
          <ul>
            {consultationEntries.map(({ item, consultation }) => (
              <li key={item.id}>
                <div>
                  <strong>{item.productNameSnapshot}</strong>
                  <span>{getUnavailableReasonLabel(consultation.reason)}</span>
                </div>
                <div className="checkout-actions">
                  <button
                    type="button"
                    className="ghost-button compact-button"
                    onClick={() => onEditConsultation(item.id)}
                    disabled={isConsultationShareActive}
                  >
                    相談を編集
                  </button>
                  <button
                    type="button"
                    className="ghost-button compact-button"
                    onClick={() => onResolveConsultation(item.id)}
                    disabled={isConsultationShareActive}
                  >
                    相談を解決
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="finish-shopping-panel">
        {completionState.pendingCount > 0 ? (
          <p>未購入の商品が{completionState.pendingCount}件あります。</p>
        ) : null}
        {completionState.consultingCount > 0 ? (
          <p>
            未解決の相談が{completionState.consultingCount}件あります。回答後に相談を解決してください。
          </p>
        ) : null}
        {completionState.needsVerificationCount > 0 ? (
          <p>
            購入時の条件確認が未完了の商品が{completionState.needsVerificationCount}件あります。
          </p>
        ) : null}
        {completionState.canFinish ? (
          <>
            <p>購入内容を確認してから終了してください。</p>
            <button
              type="button"
              className="primary-button large-button finish-shopping-button"
              onClick={onFinishShopping}
            >
              買い物を終了する
            </button>
          </>
        ) : null}
      </div>
    </section>
  )
}
