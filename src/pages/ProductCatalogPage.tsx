import { useMemo, useState, type ChangeEvent } from 'react'
import { CatalogBackupStatus } from '../components/CatalogBackupStatus'
import { CatalogRecoveryPreview } from '../components/CatalogRecoveryPreview'
import { ProductCatalogEditor } from '../components/ProductCatalogEditor'
import { ProductCatalogList } from '../components/ProductCatalogList'
import { MAX_CATALOG_RECOVERY_JSON_BYTES } from '../constants/requestLimits'
import { categories } from '../data/categories'
import { useHouseholdCatalog } from '../hooks/useHouseholdCatalog'
import type {
  CatalogRecoveryPayloadV1,
  EffectiveProduct,
} from '../types/householdCatalog'
import {
  isRecoveryPayloadOlderThanCatalog,
  parseCatalogRecoveryJson,
} from '../utils/catalogRecovery'
import { hasHouseholdCatalogChanges } from '../utils/catalogFingerprint'
import {
  addHouseholdProduct,
  resetBaseProduct,
  setCatalogProductHidden,
  updateBaseProduct,
  updateHouseholdProduct,
  type HouseholdProductInput,
} from '../utils/householdCatalog'
import { loadCreateDraft } from '../utils/storage'

type ProductCatalogPageProps = {
  onBackHome: () => void
}

export function ProductCatalogPage({
  onBackHome,
}: ProductCatalogPageProps) {
  const {
    catalog,
    effectiveProducts,
    visibleProducts,
    backupStatus,
    updateCatalog,
    confirmCatalogBackup,
    replaceCatalogFromRecovery,
  } = useHouseholdCatalog()
  const [query, setQuery] = useState('')
  const [editingProductId, setEditingProductId] = useState<
    string | 'new' | null
  >(null)
  const [recoveryPayload, setRecoveryPayload] =
    useState<CatalogRecoveryPayloadV1 | null>(null)
  const [notice, setNotice] = useState('')
  const normalizedQuery = query.trim().toLocaleLowerCase('ja')

  const matchesSearch = (product: EffectiveProduct) =>
    !normalizedQuery ||
    product.name.toLocaleLowerCase('ja').includes(normalizedQuery)

  const groups = useMemo(
    () =>
      categories
        .slice()
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .map((category) => ({
          category,
          items: visibleProducts.filter(
            (product) =>
              product.categoryId === category.id && matchesSearch(product),
          ),
        }))
        .filter((group) => group.items.length > 0),
    [normalizedQuery, visibleProducts],
  )
  const hiddenProducts = useMemo(
    () =>
      effectiveProducts
        .filter((product) => product.hidden && matchesSearch(product))
        .sort(
          (left, right) =>
            left.sortOrder - right.sortOrder ||
            left.name.localeCompare(right.name, 'ja'),
        ),
    [effectiveProducts, normalizedQuery],
  )
  const editingProduct =
    editingProductId && editingProductId !== 'new'
      ? effectiveProducts.find((product) => product.id === editingProductId) ??
        null
      : null
  const changedCount = effectiveProducts.filter(
    (product) => product.isCustomized,
  ).length
  const hiddenCount = effectiveProducts.filter(
    (product) => product.hidden,
  ).length

  const saveNextCatalog = (nextCatalog: typeof catalog, message: string) => {
    if (!updateCatalog(nextCatalog)) {
      setNotice(
        '商品リストを保存できませんでした。ブラウザの保存容量を確認してください。',
      )
      return false
    }
    setNotice(message)
    setEditingProductId(null)
    return true
  }

  const confirmUnitChange = (
    product: EffectiveProduct,
    nextUnit: string,
  ) => {
    const normalizedUnit = nextUnit.trim() || '個'
    const quantity = loadCreateDraft()[product.id]?.quantity ?? 0
    return (
      normalizedUnit === product.unit ||
      quantity <= 0 ||
      window.confirm(
        `この商品は作成中の依頼で${quantity}${product.unit}選択されています。\n単位を「${normalizedUnit}」に変更すると、${quantity}${normalizedUnit}として表示されます。`,
      )
    )
  }

  const handleSave = (input: HouseholdProductInput) => {
    try {
      if (editingProductId === 'new') {
        saveNextCatalog(
          addHouseholdProduct(catalog, input),
          `${input.name.trim()}を商品リストへ追加しました。`,
        )
        return
      }
      if (!editingProduct || !confirmUnitChange(editingProduct, input.unit)) {
        return
      }
      const next =
        editingProduct.source === 'base'
          ? updateBaseProduct(catalog, editingProduct.id, {
              name: input.name,
              unit: input.unit,
              categoryId: input.categoryId,
              hidden: input.hidden ?? false,
            })
          : updateHouseholdProduct(
              catalog,
              editingProduct.id,
              input,
            )
      saveNextCatalog(next, `${input.name.trim()}の変更を保存しました。`)
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : '商品リストを更新できませんでした。',
      )
    }
  }

  const handleHiddenChange = (productId: string, hidden: boolean) => {
    const product = effectiveProducts.find((item) => item.id === productId)
    if (!product) {
      return
    }
    try {
      saveNextCatalog(
        setCatalogProductHidden(catalog, productId, hidden),
        hidden
          ? `${product.name}を商品リストから外しました。`
          : `${product.name}を商品リストへ戻しました。`,
      )
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : '商品リストを更新できませんでした。',
      )
    }
  }

  const handleReset = () => {
    if (!editingProduct || editingProduct.source !== 'base') {
      return
    }
    try {
      saveNextCatalog(
        resetBaseProduct(catalog, editingProduct.id),
        `${editingProduct.name}を標準へ戻しました。`,
      )
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : '商品リストを更新できませんでした。',
      )
    }
  }

  const handleRecoveryJson = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }
    if (file.size > MAX_CATALOG_RECOVERY_JSON_BYTES) {
      setNotice('商品リスト復旧データが大きすぎます。')
      return
    }
    try {
      const payload = parseCatalogRecoveryJson(await file.text())
      setNotice('')
      setRecoveryPayload(payload)
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : '復旧用JSONファイルを読み込めませんでした。',
      )
    }
  }

  const handleRestoreJson = () => {
    if (!recoveryPayload) {
      return
    }
    if (!replaceCatalogFromRecovery(recoveryPayload)) {
      setNotice(
        '商品リストを復元できませんでした。ブラウザの保存容量を確認してください。',
      )
      return
    }
    setRecoveryPayload(null)
    setNotice('復旧用JSONファイルから商品リストを復元しました。')
  }

  if (recoveryPayload) {
    return (
      <main className="page">
        <CatalogRecoveryPreview
          payload={recoveryPayload}
          isOlderThanCurrent={
            hasHouseholdCatalogChanges(catalog) &&
            isRecoveryPayloadOlderThanCatalog(recoveryPayload, catalog)
          }
          errorMessage={notice}
          onRestore={handleRestoreJson}
          onCancel={() => {
            setNotice('')
            setRecoveryPayload(null)
          }}
        />
      </main>
    )
  }

  return (
    <main className="page">
      <section className="top-bar">
        <button type="button" className="ghost-button" onClick={onBackHome}>
          戻る
        </button>
        <div>
          <p className="eyebrow">家庭用の商品</p>
          <h1>商品リストを編集</h1>
        </div>
      </section>

      <section className="info-card catalog-summary-card">
        <label className="stack-field">
          <span>商品検索</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="商品名で検索"
          />
        </label>
        <div className="catalog-counts" aria-label="商品リストの変更状況">
          <span>変更済み {changedCount}件</span>
          <span>非表示 {hiddenCount}件</span>
        </div>
        <button
          type="button"
          className="secondary-button catalog-add-button"
          onClick={() => setEditingProductId('new')}
        >
          新しい商品を追加
        </button>
      </section>

      {notice ? (
        <p className="info-card catalog-notice" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}

      <ProductCatalogList
        groups={groups}
        hiddenProducts={hiddenProducts}
        onEdit={setEditingProductId}
        onRestore={(productId) => handleHiddenChange(productId, false)}
      />

      {groups.length === 0 && hiddenProducts.length === 0 ? (
        <section className="info-card">
          <p className="helper-text">検索に一致する商品はありません。</p>
        </section>
      ) : null}

      <CatalogBackupStatus
        catalog={catalog}
        backupStatus={backupStatus}
        onConfirmBackup={confirmCatalogBackup}
      />

      <section className="info-card muted-card catalog-json-restore">
        <h2>復旧用JSONファイルから復元</h2>
        <p className="helper-text">
          復旧リンクが長い場合に保存したJSONファイルを読み込み、内容を確認してから置き換えます。
        </p>
        <label className="stack-field">
          <span>JSONファイルを選択</span>
          <input
            type="file"
            accept="application/json,.json"
            onChange={(event) => void handleRecoveryJson(event)}
          />
        </label>
      </section>

      {editingProductId ? (
        <ProductCatalogEditor
          key={editingProductId}
          product={editingProductId === 'new' ? null : editingProduct}
          onCancel={() => setEditingProductId(null)}
          onHide={() => {
            if (editingProduct) {
              handleHiddenChange(editingProduct.id, true)
            }
          }}
          onReset={handleReset}
          onSave={handleSave}
        />
      ) : null}
    </main>
  )
}
