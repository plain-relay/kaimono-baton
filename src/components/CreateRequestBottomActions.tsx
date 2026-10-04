import { BottomBar } from './BottomBar'

type CreateRequestBottomActionsProps = {
  onReset: () => void
  onStartNext: () => void
  onReview: () => void
  selectedCount: number
  reviewDisabled?: boolean
  reviewDisabledMessage?: string
  isBusy?: boolean
}

export function CreateRequestBottomActions({
  onReset,
  onStartNext,
  onReview,
  selectedCount,
  reviewDisabled = false,
  reviewDisabledMessage,
  isBusy = false,
}: CreateRequestBottomActionsProps) {
  return (
    <>
      <div className="create-reset-actions">
        <button
          type="button"
          className="ghost-button danger-button"
          onClick={onReset}
          disabled={isBusy}
        >
          条件も含めてすべて消去
        </button>
      </div>
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
            className="secondary-button"
            onClick={onStartNext}
            disabled={isBusy}
          >
            次の買い物リストを作る
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
    </>
  )
}
