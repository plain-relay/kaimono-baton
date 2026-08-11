import { BottomBar } from './BottomBar'

type CreateRequestBottomActionsProps = {
  onReset: () => void
  onReview: () => void
  selectedCount: number
  reviewDisabled?: boolean
  reviewDisabledMessage?: string
}

export function CreateRequestBottomActions({
  onReset,
  onReview,
  selectedCount,
  reviewDisabled = false,
  reviewDisabledMessage,
}: CreateRequestBottomActionsProps) {
  return (
    <BottomBar>
      <div>
        <strong>{selectedCount}件選択中</strong>
        <p>数量が1以上の商品だけ確認画面に表示します</p>
        {reviewDisabled && reviewDisabledMessage ? (
          <p role="status">{reviewDisabledMessage}</p>
        ) : null}
      </div>
      <div className="inline-actions bottom-bar-actions">
        <button
          type="button"
          className="ghost-button danger-button"
          onClick={onReset}
        >
          入力内容を消去
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={onReview}
          disabled={!selectedCount || reviewDisabled}
        >
          確認へ
        </button>
      </div>
    </BottomBar>
  )
}
