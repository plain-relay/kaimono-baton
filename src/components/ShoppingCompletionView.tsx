import type { Ref } from 'react'
import type {
  ItemIssueMap,
  ShoppingRequestItemPayload,
} from '../types/shopping'
import { getItemIssueLabel } from '../utils/shoppingMessages'
import type { ShoppingCompletionState } from '../utils/shoppingState'
import { NativeShareUnavailableNotice } from './NativeShareUnavailableNotice'

type ShoppingCompletionViewProps = {
  allPurchased: boolean
  nativeShareAvailable: boolean
  externalBrowserUrl: string
  completionState: ShoppingCompletionState
  completionHeadingRef: Ref<HTMLHeadingElement>
  shareNotice: {
    kind: 'success' | 'error' | 'info'
    message: string
  } | null
  hasPersistenceError: boolean
  notBuyingItems: ShoppingRequestItemPayload[]
  itemIssues: ItemIssueMap
  isSharingResult: boolean
  onShareResult: () => void
  onReviewShopping: () => void
  onBackHome: () => void
}

export function ShoppingCompletionView({
  allPurchased,
  nativeShareAvailable,
  externalBrowserUrl,
  completionState,
  completionHeadingRef,
  shareNotice,
  hasPersistenceError,
  notBuyingItems,
  itemIssues,
  isSharingResult,
  onShareResult,
  onReviewShopping,
  onBackHome,
}: ShoppingCompletionViewProps) {
  return (
    <main className="page completion-page">
      {!nativeShareAvailable ? (
        <NativeShareUnavailableNotice externalBrowserUrl={externalBrowserUrl} />
      ) : null}
      <section className={`hero-card completion-hero ${allPurchased ? 'is-complete' : ''}`}>
        <p className="completion-symbol" aria-hidden="true">{allPurchased ? '✓' : '!'}</p>
        <h1 ref={completionHeadingRef} tabIndex={-1}>
          {allPurchased ? 'おつかい完了' : 'おつかい終了'}
        </h1>
        <dl className="completion-stats">
          <div>
            <dt>購入した商品</dt>
            <dd>{completionState.purchasedCount}件</dd>
          </div>
          <div>
            <dt>買えなかった商品</dt>
            <dd>{completionState.notBuyingCount}件</dd>
          </div>
        </dl>
      </section>

      {shareNotice ? (
        <p className={`share-notice ${shareNotice.kind}`} role="status">
          {shareNotice.message}
        </p>
      ) : null}

      {hasPersistenceError ? (
        <p className="share-notice error" role="alert">
          買い物の進捗をこの端末に保存できませんでした。
          再読み込みすると変更が失われる可能性があります。
        </p>
      ) : null}

      {notBuyingItems.length > 0 ? (
        <section className="info-card unavailable-result-card">
          <h2>買えなかった商品</h2>
          <ul className="unavailable-result-list">
            {notBuyingItems.map((item) => (
              <li key={item.id}>
                <strong>{item.productNameSnapshot}</strong>
                <span>{getItemIssueLabel(itemIssues[item.id])}</span>
                {itemIssues[item.id]?.note ? <small>補足: {itemIssues[item.id]?.note}</small> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="info-card completion-actions-card">
        <button
          type="button"
          className="primary-button large-button"
          onClick={onShareResult}
          disabled={isSharingResult}
        >
          {isSharingResult ? '共有中…' : '結果を共有'}
        </button>
        <button type="button" className="secondary-button large-button" onClick={onReviewShopping}>
          買い物内容を見直す
        </button>
        <button type="button" className="ghost-button large-button" onClick={onBackHome}>
          ホームへ
        </button>
      </section>
    </main>
  )
}
