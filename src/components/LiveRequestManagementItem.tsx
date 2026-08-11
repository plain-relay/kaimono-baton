import { ImeAwareTextInput } from './ImeAwareTextInput'
import type { LiveRequestItem } from '../features/liveRequests/types'
import { truncateUserCharacters } from '../utils/textLength'

type LiveRequestManagementItemProps = {
  item: LiveRequestItem
  quantity: number
  memo: string
  disabled: boolean
  onQuantityChange: (quantity: number) => void
  onMemoChange: (memo: string) => void
  onSaveQuantity: () => void
  onSaveMemo: () => void
  onCancel: () => void
}

export function LiveRequestManagementItem({
  item,
  quantity,
  memo,
  disabled,
  onQuantityChange,
  onMemoChange,
  onSaveQuantity,
  onSaveMemo,
  onCancel,
}: LiveRequestManagementItemProps) {
  return (
    <article className="live-request-management-item">
      <div>
        <strong>{item.productNameSnapshot}</strong>
        <p>
          現在: {item.quantity}{item.unit}
          {item.memo ? ` / 条件: ${item.memo}` : ''}
        </p>
      </div>
      <label>
        数量
        <input
          type="number"
          min={1}
          max={20}
          inputMode="numeric"
          step={1}
          value={quantity}
          onChange={(event) =>
            onQuantityChange(
              Math.min(
                20,
                Math.max(
                  1,
                  Math.trunc(Number(event.currentTarget.value) || 1),
                ),
              ),
            )
          }
          disabled={disabled}
          aria-label={`${item.productNameSnapshot}の新しい数量`}
        />
      </label>
      <button
        type="button"
        className="secondary-button"
        onClick={onSaveQuantity}
        disabled={disabled || quantity === item.quantity}
      >
        数量を変更
      </button>
      <label>
        条件
        <ImeAwareTextInput
          value={memo}
          onCommit={(candidate) => {
            const value = truncateUserCharacters(candidate, 30)
            onMemoChange(value)
            return { value, accepted: value !== memo }
          }}
          disabled={disabled}
          aria-label={`${item.productNameSnapshot}の新しい条件`}
        />
      </label>
      <button
        type="button"
        className="secondary-button"
        onClick={onSaveMemo}
        disabled={disabled || memo.trim() === (item.memo ?? '')}
      >
        条件を変更
      </button>
      <button
        type="button"
        className="ghost-button danger-button"
        onClick={onCancel}
        disabled={disabled}
      >
        依頼から取り消す
      </button>
    </article>
  )
}
