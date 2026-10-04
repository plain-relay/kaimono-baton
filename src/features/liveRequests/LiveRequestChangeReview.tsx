import type { CheckedStateMap, ShoppingRequestItemPayload } from '../../types/shopping'
import { getItemStatus, isCartStatus } from '../../utils/shoppingState'
import { describeLiveRequestChange } from './shopping'
import type { LiveRequestPendingChange } from './types'

type Props = {
  changes: readonly LiveRequestPendingChange[]
  items: readonly ShoppingRequestItemPayload[]
  checkedState: CheckedStateMap
  onReview: (itemId: string) => void
}

export function LiveRequestChangeReview({ changes, items, checkedState, onReview }: Props) {
  if (changes.length === 0) return null
  const changedIds = [...new Set(changes.map((change) => change.itemId))]
  return (
    <section className="info-card live-request-review" aria-labelledby="live-change-review-heading">
      <h2 id="live-change-review-heading">依頼の変更を確認してください</h2>
      <p>未確認の変更が{changedIds.length}件あります。対応を確認するまで買い物を終了できません。</p>
      <ul className="live-request-cancelled-list">
        {changedIds.map((itemId) => {
          const item = items.find((candidate) => candidate.id === itemId)
          if (!item) return null
          const itemChanges = changes.filter((change) => change.itemId === itemId)
          const isCancelled = item.liveLifecycle === 'cancelled-by-requester'
          const needsCartReview = !isCancelled && isCartStatus(getItemStatus(checkedState, itemId))
          return (
            <li key={itemId}>
              <strong>{item.productNameSnapshot}　{item.quantity}{item.unit}</strong>
              <span>{itemChanges.map(describeLiveRequestChange).join(' / ')}</span>
              {isCancelled ? <span>かごに残っていないか確認してください。購入済みの場合はLINEで依頼者へ伝えてください。</span> : null}
              <button type="button" className="secondary-button compact-button" onClick={() => onReview(itemId)}
                aria-label={`${item.productNameSnapshot}の${isCancelled ? '取消への対応' : '変更内容'}を確認`}>
                {isCancelled ? '取消への対応を確認しました' : needsCartReview ? 'かごの数量・条件を再確認' : '変更を確認しました'}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
