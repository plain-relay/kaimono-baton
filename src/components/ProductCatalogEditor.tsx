import { useState } from 'react'
import {
  MAX_CUSTOM_ITEM_NAME_CHARS,
  MAX_CUSTOM_ITEM_UNIT_CHARS,
} from '../constants/requestLimits'
import { categories } from '../data/categories'
import type { EffectiveProduct } from '../types/householdCatalog'
import type { HouseholdProductInput } from '../utils/householdCatalog'
import {
  countUserCharacters,
  truncateUserCharacters,
} from '../utils/textLength'
import { ImeAwareTextInput, type CommitTextResult } from './ImeAwareTextInput'
import { ShoppingDialog } from './ShoppingDialog'

type ProductCatalogEditorProps = {
  product: EffectiveProduct | null
  onCancel: () => void
  onHide: () => void
  onReset: () => void
  onSave: (input: HouseholdProductInput) => void
}

export function ProductCatalogEditor({
  product,
  onCancel,
  onHide,
  onReset,
  onSave,
}: ProductCatalogEditorProps) {
  const [name, setName] = useState(product?.name ?? '')
  const [unit, setUnit] = useState(product?.unit ?? '個')
  const [categoryId, setCategoryId] = useState(
    product?.categoryId ?? 'other',
  )
  const titleId = 'catalog-editor-title'
  const descriptionId = 'catalog-editor-description'
  const isNew = product === null

  const commitText = (
    value: string,
    current: string,
    limit: number,
    setter: (next: string) => void,
  ): CommitTextResult => {
    const next = truncateUserCharacters(value, limit)
    setter(next)
    return {
      value: next,
      accepted: next !== current,
      reason: next !== value ? 'field-limit' : undefined,
    }
  }

  return (
    <ShoppingDialog
      title={isNew ? '新しい商品を追加' : `${product.name}を編集`}
      titleId={titleId}
      descriptionId={descriptionId}
      onClose={onCancel}
    >
      <p id={descriptionId} className="shopping-dialog-description">
        家庭で使う商品名、単位、カテゴリを設定します。
      </p>
      <div className="catalog-editor-fields">
        <label className="stack-field">
          <span>商品名</span>
          <ImeAwareTextInput
            value={name}
            aria-describedby="catalog-product-name-count"
            onCommit={(value) =>
              commitText(value, name, MAX_CUSTOM_ITEM_NAME_CHARS, setName)
            }
          />
          <span id="catalog-product-name-count" className="character-count">
            {countUserCharacters(name)} / {MAX_CUSTOM_ITEM_NAME_CHARS}
          </span>
          {countUserCharacters(name) >= MAX_CUSTOM_ITEM_NAME_CHARS ? (
            <span className="limit-inline-message">
              商品名は30文字までです。
            </span>
          ) : null}
        </label>

        <label className="stack-field">
          <span>単位</span>
          <ImeAwareTextInput
            value={unit}
            aria-describedby="catalog-product-unit-count"
            onCommit={(value) =>
              commitText(value, unit, MAX_CUSTOM_ITEM_UNIT_CHARS, setUnit)
            }
          />
          <span id="catalog-product-unit-count" className="character-count">
            {countUserCharacters(unit)} / {MAX_CUSTOM_ITEM_UNIT_CHARS}
          </span>
          {countUserCharacters(unit) >= MAX_CUSTOM_ITEM_UNIT_CHARS ? (
            <span className="limit-inline-message">単位は10文字までです。</span>
          ) : null}
        </label>

        <label className="stack-field">
          <span>カテゴリ</span>
          <select
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            {categories
              .slice()
              .sort((left, right) => left.sortOrder - right.sortOrder)
              .map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
          </select>
        </label>
      </div>

      <div className="shopping-dialog-actions catalog-editor-actions">
        <button
          type="button"
          className="primary-button"
          disabled={!name.trim()}
          onClick={() =>
            onSave({
              name,
              unit,
              categoryId,
              hidden: product?.hidden ?? false,
            })
          }
        >
          {isNew ? '商品を追加' : '変更を保存'}
        </button>
        <button type="button" className="ghost-button" onClick={onCancel}>
          キャンセル
        </button>
        {!isNew && !product.hidden ? (
          <button
            type="button"
            className="ghost-button danger-button"
            onClick={onHide}
          >
            商品リストから外す
          </button>
        ) : null}
        {!isNew && product.source === 'base' ? (
          <button type="button" className="ghost-button" onClick={onReset}>
            標準に戻す
          </button>
        ) : null}
      </div>
    </ShoppingDialog>
  )
}
