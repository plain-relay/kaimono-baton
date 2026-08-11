import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LiveRequestManagementItem } from '../components/LiveRequestManagementItem'
import { ImeAwareTextInput } from '../components/ImeAwareTextInput'
import { MAX_CUSTOM_ITEMS } from '../constants/requestLimits'
import { categories } from '../data/categories'
import {
  LIVE_REQUEST_UPDATE_TURNSTILE_ACTION,
  LiveRequestApiError,
  WorkerLiveRequestApi,
} from '../features/liveRequests/api'
import {
  getLiveRequestConfig,
  type LiveRequestConfig,
} from '../features/liveRequests/config'
import type {
  LiveRequestApi,
  LiveRequestNewItem,
  LiveRequestOperation,
  LiveRequestSnapshot,
} from '../features/liveRequests/types'
import { BrowserTurnstileTokenProvider } from '../features/handwriting/turnstile'
import { useHouseholdCatalog } from '../hooks/useHouseholdCatalog'
import { createId } from '../utils/id'
import { truncateUserCharacters } from '../utils/textLength'

type LiveRequestManagePageProps = {
  requestToken: string
  editSecret: string
  onBackHome: () => void
  onError: (title: string, description: string) => void
  liveRequestConfig?: LiveRequestConfig
  liveRequestApi?: LiveRequestApi
  createItemId?: () => string
}

function categoryName(categoryId: string): string {
  return (
    categories.find((category) => category.id === categoryId)?.name ??
    'その他'
  )
}

function finiteMessage(error: unknown): string {
  if (error instanceof LiveRequestApiError) {
    switch (error.code) {
      case 'auth-failed':
        return '認証確認に失敗しました。もう一度お試しください。'
      case 'conflict':
        return '別の画面で更新されています。最新内容を再取得しました。入力中の値を確認して再度保存してください。'
      case 'expired':
        return '共有期限が切れたため更新できません。'
      case 'limit-reached':
        return '更新回数または利用上限に達しました。'
      case 'invalid-request':
        return '入力内容を更新できません。数量や条件を確認してください。'
      case 'invalid-response':
      case 'service-unavailable':
      case 'timeout':
        return '更新サービスへ接続できません。表示中の内容はそのまま残っています。'
    }
  }
  return '更新サービスへ接続できません。表示中の内容はそのまま残っています。'
}

export function LiveRequestManagePage({
  requestToken,
  editSecret,
  onBackHome,
  onError,
  liveRequestConfig,
  liveRequestApi,
  createItemId = () => createId('live-item'),
}: LiveRequestManagePageProps) {
  const config = liveRequestConfig ?? getLiveRequestConfig()
  const { effectiveProducts } = useHouseholdCatalog()
  const turnstileContainerRef = useRef<HTMLDivElement>(null)
  const [defaultUpdateApi, setDefaultUpdateApi] = useState<LiveRequestApi>()
  const readApi = useMemo(
    () =>
      liveRequestApi ??
      (config.enabled
        ? new WorkerLiveRequestApi(
            config.endpoint,
            undefined,
            fetch,
            config.validationSessionToken,
          )
        : undefined),
    [
      config.enabled,
      config.endpoint,
      config.validationSessionToken,
      liveRequestApi,
    ],
  )
  const updateApi = liveRequestApi ?? defaultUpdateApi
  const [snapshot, setSnapshot] = useState<LiveRequestSnapshot>()
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [memos, setMemos] = useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)
  const [isExpired, setIsExpired] = useState(false)
  const [message, setMessage] = useState('')
  const [addMode, setAddMode] = useState<'catalog' | 'custom'>('catalog')
  const [addProductId, setAddProductId] = useState('')
  const [addName, setAddName] = useState('')
  const [addUnit, setAddUnit] = useState('個')
  const [addQuantity, setAddQuantity] = useState(1)
  const [addMemo, setAddMemo] = useState('')

  const applySnapshot = useCallback(
    (next: LiveRequestSnapshot, preserveInputs: boolean) => {
      setSnapshot(next)
      setIsExpired(false)
      setQuantities((current) =>
        Object.fromEntries(
          next.items
            .filter((item) => item.lifecycle === 'active')
            .map((item) => [
              item.itemId,
              preserveInputs
                ? current[item.itemId] ?? item.quantity
                : item.quantity,
            ]),
        ),
      )
      setMemos((current) =>
        Object.fromEntries(
          next.items
            .filter((item) => item.lifecycle === 'active')
            .map((item) => [
              item.itemId,
              preserveInputs
                ? current[item.itemId] ?? item.memo ?? ''
                : item.memo ?? '',
            ]),
        ),
      )
    },
    [],
  )

  const refresh = useCallback(
    async (preserveInputs = true, signal?: AbortSignal) => {
      if (!readApi) {
        return false
      }
      setIsLoading(true)
      try {
        const result = await readApi.get(requestToken, { signal })
        if (result.status === 'found') {
          applySnapshot(result.request, preserveInputs)
          setMessage('')
          return true
        } else if (result.status === 'expired') {
          setIsExpired(true)
          setMessage('共有期限が切れたため更新できません。')
        } else if (result.status === 'missing') {
          onError(
            '管理する依頼が見つかりません',
            '管理リンクが正しいか確認してください。',
          )
        }
      } catch (error) {
        if (!signal?.aborted) {
          setMessage(finiteMessage(error))
        }
      } finally {
        if (!signal?.aborted) {
          setIsLoading(false)
        }
      }
      return false
    },
    [applySnapshot, onError, readApi, requestToken],
  )

  useEffect(() => {
    if (!config.enabled) {
      onError(
        '依頼の管理機能は現在利用できません',
        '通常の固定依頼は引き続き利用できます。',
      )
      return
    }
    const controller = new AbortController()
    void refresh(false, controller.signal)
    return () => controller.abort()
  }, [config.enabled, onError, refresh])

  useEffect(() => {
    if (
      !config.enabled ||
      liveRequestApi ||
      !turnstileContainerRef.current
    ) {
      return
    }
    const turnstile = new BrowserTurnstileTokenProvider(
      turnstileContainerRef.current,
      config.turnstileSiteKey,
      undefined,
      undefined,
      LIVE_REQUEST_UPDATE_TURNSTILE_ACTION,
    )
    setDefaultUpdateApi(
      new WorkerLiveRequestApi(
        config.endpoint,
        turnstile,
        fetch,
        config.validationSessionToken,
      ),
    )
    return () => turnstile.dispose()
  }, [
    config.enabled,
    config.endpoint,
    config.turnstileSiteKey,
    config.validationSessionToken,
    liveRequestApi,
  ])

  const submitOperations = async (
    operations: readonly LiveRequestOperation[],
  ) => {
    if (!snapshot || !updateApi || isExpired || isUpdating) {
      return false
    }
    setIsUpdating(true)
    setMessage('')
    try {
      const result = await updateApi.patch(
        requestToken,
        editSecret,
        snapshot.revision,
        operations,
      )
      applySnapshot(result.request, true)
      setMessage('依頼内容を更新しました。')
      return true
    } catch (error) {
      setMessage(finiteMessage(error))
      if (error instanceof LiveRequestApiError && error.code === 'conflict') {
        if (await refresh(true)) {
          setMessage(finiteMessage(error))
        }
      } else if (
        error instanceof LiveRequestApiError &&
        error.code === 'expired'
      ) {
        setIsExpired(true)
      }
      return false
    } finally {
      setIsUpdating(false)
    }
  }

  const activeItems = snapshot?.items.filter(
    (item) => item.lifecycle === 'active',
  ) ?? []
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
      setAddMemo('')
    }
  }

  if (!config.enabled) {
    return null
  }

  return (
    <main className="page">
      <section className="top-bar">
        <button type="button" className="ghost-button" onClick={onBackHome}>
          ホーム
        </button>
        <div>
          <p className="eyebrow">依頼者用</p>
          <h1>共有後の依頼を変更</h1>
        </div>
      </section>

      <section className="info-card">
        <p className="lead">
          この管理リンクを知っている人は依頼を変更できます。購入者へ送るリンクとは分けて保管してください。
        </p>
        {snapshot ? (
          <p>
            revision {snapshot.revision} / 期限{' '}
            {new Date(snapshot.expiresAt).toLocaleString('ja-JP')}
          </p>
        ) : null}
        {message ? (
          <p
            className={`share-notice ${
              message.includes('更新しました') ? 'success' : 'error'
            }`}
            role="status"
          >
            {message}
          </p>
        ) : null}
        {isLoading && !snapshot ? <p>依頼内容を読み込み中…</p> : null}
      </section>

      {snapshot ? (
        <>
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
                  onChange={(event) => setAddProductId(event.currentTarget.value)}
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
              disabled={addFormDisabled || !updateApi}
            >
              商品を追加
            </button>
          </section>

          <section className="category-section">
            <div className="section-heading">
              <h2>現在の商品</h2>
              <span>{activeItems.length}件</span>
            </div>
            <div className="live-request-management-list">
              {activeItems.map((item) => (
                <LiveRequestManagementItem
                  key={item.itemId}
                  item={item}
                  quantity={quantities[item.itemId] ?? item.quantity}
                  memo={memos[item.itemId] ?? item.memo ?? ''}
                  disabled={isUpdating || isExpired || !updateApi}
                  onQuantityChange={(quantity) =>
                    setQuantities((current) => ({
                      ...current,
                      [item.itemId]: quantity,
                    }))
                  }
                  onMemoChange={(memo) =>
                    setMemos((current) => ({
                      ...current,
                      [item.itemId]: memo,
                    }))
                  }
                  onSaveQuantity={() =>
                    void submitOperations([
                      {
                        type: 'set-quantity',
                        itemId: item.itemId,
                        quantity: quantities[item.itemId] ?? item.quantity,
                      },
                    ])
                  }
                  onSaveMemo={() =>
                    void submitOperations([
                      {
                        type: 'set-memo',
                        itemId: item.itemId,
                        memo: (memos[item.itemId] ?? '').trim(),
                      },
                    ])
                  }
                  onCancel={() => {
                    if (
                      window.confirm(
                        'すでに購入中または購入済みの可能性があります。依頼から取り消しますか？',
                      )
                    ) {
                      void submitOperations([
                        { type: 'cancel', itemId: item.itemId },
                      ])
                    }
                  }}
                />
              ))}
            </div>
          </section>
        </>
      ) : null}

      <div
        ref={turnstileContainerRef}
        className="live-request-turnstile"
        aria-label="依頼更新の認証確認"
      />
    </main>
  )
}
