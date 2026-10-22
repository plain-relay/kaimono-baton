import { useState } from 'react'
import { ImeAwareTextInput } from '../../components/ImeAwareTextInput'
import { MAX_CUSTOM_ITEMS } from '../../constants/requestLimits'
import { categories } from '../../data/categories'
import type { EffectiveProduct } from '../../types/householdCatalog'
import { truncateUserCharacters } from '../../utils/textLength'
import type { LiveRequestNewItem, LiveRequestOperation, LiveRequestSnapshot } from './types'

function categoryName(categoryId: string): string {
  return (
    categories.find((category) => category.id === categoryId)?.name ??
    'その他'
  )
}

export function LiveRequestAddForm({ effectiveProducts, snapshot, isUpdating, isExpired, updateApiAvailable, submitOperations, setMessage, createItemId }: {
  effectiveProducts: readonly EffectiveProduct[]
  snapshot: LiveRequestSnapshot
  isUpdating: boolean
  isExpired: boolean
  updateApiAvailable: boolean
  submitOperations: (operations: readonly LiveRequestOperation[]) => Promise<boolean>
  setMessage: (message: string) => void
  createItemId: () => string
}) {
  const [addMode, setAddMode] = useState<'catalog' | 'custom'>('catalog')
  const [addProductId, setAddProductId] = useState('')
  const [addName, setAddName] = useState('')
  const [addUnit, setAddUnit] = useState('個')
  const [addQuantity, setAddQuantity] = useState(1)
  const [catalogAddMemo, setCatalogAddMemo] = useState('')
  const [customAddMemo, setCustomAddMemo] = useState('')
  const addMemo = addMode === 'catalog' ? catalogAddMemo : customAddMemo
  const setAddMemo = addMode === 'catalog' ? setCatalogAddMemo : setCustomAddMemo


  const activeItems = snapshot.items.filter((item) => item.lifecycle === 'active')
  const activeProductIds = new Set(activeItems.map((item) => item.productId))
  const activeCustomItemCount = activeItems.filter((item) =>
    item.productId.startsWith('custom:'),
  ).length
  const customItemLimitReached =
    activeCustomItemCount >= MAX_CUSTOM_ITEMS
  const addFormDisabled =
    isUpdating ||
    isExpired ||
    (addMode === 'custom' && customItemLimitReached)
  const availableProducts = effectiveProducts.filter(
    (product) => !product.hidden && !activeProductIds.has(product.id),
  )

  const createAddedItem = (): LiveRequestNewItem | undefined => {
    const itemId = createItemId()
    if (addMode === 'catalog') {
      const product = effectiveProducts.find(
        (candidate) => candidate.id === addProductId && !candidate.hidden,
      )
      if (!product || activeProductIds.has(product.id)) {
        return undefined
      }
      return {
        itemId,
        productId: product.id,
        productNameSnapshot: product.name,
        categoryIdSnapshot: product.categoryId,
        categoryNameSnapshot: categoryName(product.categoryId),
        quantity: addQuantity,
        unit: product.unit,
        ...(addMemo.trim() ? { memo: addMemo.trim() } : {}),
        iconSnapshot: product.icon,
        sortOrderSnapshot: product.sortOrder,
      }
    }
    if (customItemLimitReached) {
      return undefined
    }
    const name = addName.trim()
    const unit = addUnit.trim() || '個'
    if (!name) {
      return undefined
    }
    return {
      itemId,
      productId: `custom:${itemId}`,
      productNameSnapshot: name,
      categoryIdSnapshot: 'other',
      categoryNameSnapshot: categoryName('other'),
      quantity: addQuantity,
      unit,
      ...(addMemo.trim() ? { memo: addMemo.trim() } : {}),
      iconSnapshot: '🛒',
      sortOrderSnapshot: 10_000 + (snapshot?.items.length ?? 0),
    }
  }

  const handleAdd = async () => {
    if (addMode === 'custom' && customItemLimitReached) {
      setMessage(
        `リストにない商品は${MAX_CUSTOM_ITEMS}件までです。既存の商品を取り消すと、新しい商品を追加できます。`,
      )
      return
    }
    const item = createAddedItem()
    if (!item) {
      setMessage('追加する商品を選ぶか、商品名を入力してください。')
      return
    }
    if (await submitOperations([{ type: 'add', item }])) {
      setAddProductId('')
      setAddName('')
      setAddUnit('個')
      setAddQuantity(1)
      setCatalogAddMemo('')
      setCustomAddMemo('')
    }
  }


  return (
          <section className="info-card live-request-add-card">
            <h2>商品を追加</h2>
            <div className="live-request-mode-options">
              <label>
                <input
                  type="radio"
                  name="live-add-mode"
                  checked={addMode === 'catalog'}
                  onChange={() => setAddMode('catalog')}
                />
                商品リストから
              </label>
              <label>
                <input
                  type="radio"
                  name="live-add-mode"
                  checked={addMode === 'custom'}
                  onChange={() => setAddMode('custom')}
                />
                リストにない商品
              </label>
            </div>
            {addMode === 'catalog' ? (
              <label>
                商品
                <select
                  value={addProductId}
                  onChange={(event) => {
                    const productId = event.currentTarget.value
                    setAddProductId(productId)
                    setAddMemo(
                      effectiveProducts.find((product) => product.id === productId)?.memo ?? '',
                    )
                  }}
                  disabled={isUpdating || isExpired}
                >
                  <option value="">選択してください</option>
                  {availableProducts.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="live-request-custom-fields">
                {customItemLimitReached ? (
                  <p className="helper-text" role="status">
                    リストにない商品は{MAX_CUSTOM_ITEMS}件までです。既存の商品を取り消すと、新しい商品を追加できます。
                  </p>
                ) : null}
                <label>
                  商品名
                  <ImeAwareTextInput
                    value={addName}
                    onCommit={(candidate) => {
                      const value = truncateUserCharacters(candidate, 30)
                      setAddName(value)
                      return { value, accepted: value !== addName }
                    }}
                    disabled={addFormDisabled}
                  />
                </label>
                <label>
                  単位
                  <ImeAwareTextInput
                    value={addUnit}
                    onCommit={(candidate) => {
                      const value = truncateUserCharacters(candidate, 10)
                      setAddUnit(value)
                      return { value, accepted: value !== addUnit }
                    }}
                    disabled={addFormDisabled}
                  />
                </label>
              </div>
            )}
            <label>
              数量
              <input
                type="number"
                min={1}
                max={20}
                step={1}
                value={addQuantity}
                onChange={(event) =>
                  setAddQuantity(
                    Math.min(
                      20,
                      Math.max(
                        1,
                        Math.trunc(
                          Number(event.currentTarget.value) || 1,
                        ),
                      ),
                    ),
                  )
                }
                disabled={addFormDisabled}
              />
            </label>
            <label>
              条件
              <ImeAwareTextInput
                value={addMemo}
                aria-label="追加商品の条件"
                onCommit={(candidate) => {
                  const value = truncateUserCharacters(candidate, 30)
                  setAddMemo(value)
                  return { value, accepted: value !== addMemo }
                }}
                disabled={addFormDisabled}
              />
            </label>
            <button
              type="button"
              className="primary-button"
              onClick={() => void handleAdd()}
              disabled={addFormDisabled || !updateApiAvailable}
            >
              商品を追加
            </button>
          </section>


  )
}
