import type { ReactNode } from 'react'
import {
  MAX_CUSTOM_ITEMS,
  MAX_CUSTOM_ITEM_NAME_CHARS,
  MAX_CUSTOM_ITEM_UNIT_CHARS,
  MAX_ITEM_CONDITION_CHARS,
  MAX_ITEM_QUANTITY,
} from '../constants/requestLimits'
import type { CustomRequestDraftItem } from '../utils/requestBudget'
import { countUserCharacters } from '../utils/textLength'
import {
  ImeAwareTextInput,
  type CommitTextResult,
} from './ImeAwareTextInput'

type CustomItemsSectionProps = {
  customItems: CustomRequestDraftItem[]
  customMemo: string
  customName: string
  customQuantity: number
  customUnit: string
  editingCustomIndex: number | null
  isCustomDetailsOpen: boolean
  isCustomFormOpen: boolean
  onCancel: () => void
  onDelete: (index: number) => void
  onMemoCommit: (value: string) => CommitTextResult
  onNameCommit: (value: string) => CommitTextResult
  onOpenForm: (index?: number) => void
  onQuantityChange: (value: unknown) => void
  onSave: () => void
  onToggleDetails: () => void
  onUnitCommit: (value: string) => CommitTextResult
  renderPhotoAttachment?: (item: CustomRequestDraftItem) => ReactNode
}

export function CustomItemsSection({
  customItems,
  customMemo,
  customName,
  customQuantity,
  customUnit,
  editingCustomIndex,
  isCustomDetailsOpen,
  isCustomFormOpen,
  onCancel,
  onDelete,
  onMemoCommit,
  onNameCommit,
  onOpenForm,
  onQuantityChange,
  onSave,
  onToggleDetails,
  onUnitCommit,
  renderPhotoAttachment,
}: CustomItemsSectionProps) {
  return (
    <section className="info-card custom-items-card">
      <div className="section-heading">
        <h2>追加したもの</h2>
        <span>
          {customItems.length} / {MAX_CUSTOM_ITEMS}件
        </span>
      </div>
      {customItems.length > 0 ? (
        <ul className="custom-items-list">
          {customItems.map((item, index) => (
            <li key={item.id}>
              <span>
                <strong>{item.name}</strong> {item.quantity}
                {item.unit}
                {item.memo ? <small>条件: {item.memo}</small> : null}
              </span>
              <div className="custom-item-actions">
                <button
                  type="button"
                  className="ghost-button compact-button"
                  onClick={() => onOpenForm(index)}
                  aria-label={`${item.name}を編集`}
                >
                  編集
                </button>
                <button
                  type="button"
                  className="custom-delete-button"
                  onClick={() => onDelete(index)}
                  aria-label={`${item.name}を削除`}
                >
                  削除
                </button>
              </div>
              {renderPhotoAttachment?.(item)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="helper-text">
          リストにない商品を、今回の依頼だけに追加できます。
        </p>
      )}

      {isCustomFormOpen ? (
        <div className="custom-item-form">
          <strong>{editingCustomIndex === null ? '商品を追加' : '商品を編集'}</strong>
          <label className="stack-field">
            <span>商品名</span>
            <ImeAwareTextInput
              value={customName}
              aria-describedby="custom-name-count"
              onCommit={onNameCommit}
              placeholder="例: 洗濯ネット"
            />
            <span id="custom-name-count" className="character-count">
              {countUserCharacters(customName)} / {MAX_CUSTOM_ITEM_NAME_CHARS}
            </span>
          </label>
          {countUserCharacters(customName) >= MAX_CUSTOM_ITEM_NAME_CHARS ? (
            <p className="limit-inline-message">自由追加の商品名は30文字までです。</p>
          ) : null}
          <div className="custom-item-quantity-field">
            <div className="stack-field">
              <span>数量</span>
              <div
                className="quantity-stepper"
                role="group"
                aria-label={`${customName.trim() || '追加する商品'}の数量`}
              >
                <button
                  type="button"
                  className="step-button"
                  onClick={() => onQuantityChange(customQuantity - 1)}
                  disabled={customQuantity <= 1}
                  aria-label={`${customName.trim() || '追加する商品'}の数量を1減らす（現在${customQuantity}）`}
                >
                  −
                </button>
                <input
                  className="quantity-number-input"
                  type="number"
                  min={1}
                  max={MAX_ITEM_QUANTITY}
                  step={1}
                  value={customQuantity}
                  onChange={(event) => onQuantityChange(event.target.value)}
                  aria-label={`${customName.trim() || '追加する商品'}の数量（1から20）`}
                />
                <button
                  type="button"
                  className="step-button"
                  onClick={() => onQuantityChange(customQuantity + 1)}
                  disabled={customQuantity >= MAX_ITEM_QUANTITY}
                  aria-label={`${customName.trim() || '追加する商品'}の数量を1増やす（現在${customQuantity}）`}
                >
                  ＋
                </button>
              </div>
              {customQuantity >= MAX_ITEM_QUANTITY ? (
                <span className="limit-inline-message">数量は20個までです。</span>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            className="ghost-button custom-details-toggle"
            aria-expanded={isCustomDetailsOpen}
            aria-controls="custom-item-details"
            onClick={onToggleDetails}
          >
            {isCustomDetailsOpen ? '詳細設定を閉じる' : '詳細設定'}
          </button>
          {isCustomDetailsOpen ? (
            <div id="custom-item-details" className="custom-item-details">
              <label className="stack-field">
                <span>単位</span>
                <ImeAwareTextInput
                  value={customUnit}
                  aria-describedby="custom-unit-count"
                  onCommit={onUnitCommit}
                  placeholder="個"
                />
                <span id="custom-unit-count" className="character-count">
                  {countUserCharacters(customUnit)} / {MAX_CUSTOM_ITEM_UNIT_CHARS}
                </span>
                {countUserCharacters(customUnit) >= MAX_CUSTOM_ITEM_UNIT_CHARS ? (
                  <span className="limit-inline-message">単位は10文字までです。</span>
                ) : null}
              </label>
            </div>
          ) : null}
          <label className="stack-field">
            <span>条件</span>
            <ImeAwareTextInput
              aria-label={
                customName.trim()
                  ? `${customName.trim()}の条件`
                  : '追加する商品の条件'
              }
              aria-describedby="custom-condition-count"
              value={customMemo}
              onCommit={onMemoCommit}
              placeholder="例：安い方でOK、○○味、500g以上"
            />
            <span id="custom-condition-count" className="character-count">
              {countUserCharacters(customMemo)} / {MAX_ITEM_CONDITION_CHARS}
            </span>
          </label>
          {countUserCharacters(customMemo) >= MAX_ITEM_CONDITION_CHARS ? (
            <p className="limit-inline-message">条件は30文字までです。</p>
          ) : null}
          <div className="inline-actions">
            <button
              type="button"
              className="primary-button"
              onClick={onSave}
              disabled={!customName.trim()}
            >
              {editingCustomIndex === null ? '追加' : '変更を保存'}
            </button>
            <button type="button" className="ghost-button" onClick={onCancel}>
              キャンセル
            </button>
          </div>
        </div>
      ) : customItems.length >= MAX_CUSTOM_ITEMS ? (
        <p className="limit-inline-message">自由追加商品は10件までです。</p>
      ) : (
        <button
          type="button"
          className="secondary-button custom-add-button"
          onClick={() => onOpenForm()}
        >
          ＋ リストにないものを追加
        </button>
      )}
    </section>
  )
}
