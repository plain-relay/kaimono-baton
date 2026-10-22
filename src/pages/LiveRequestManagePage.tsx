import { LiveRequestManagementItem } from '../components/LiveRequestManagementItem'
import {
  getLiveRequestConfig,
  type LiveRequestConfig,
} from '../features/liveRequests/config'
import { LiveRequestAddForm } from '../features/liveRequests/LiveRequestAddForm'
import type {
  LiveRequestApi
} from '../features/liveRequests/types'
import { useLiveRequestManagement } from '../features/liveRequests/useLiveRequestManagement'
import { useHouseholdCatalog } from '../hooks/useHouseholdCatalog'
import { createId } from '../utils/id'

type LiveRequestManagePageProps = {
  requestToken: string
  editSecret: string
  onBackHome: () => void
  onError: (title: string, description: string) => void
  liveRequestConfig?: LiveRequestConfig
  liveRequestApi?: LiveRequestApi
  createItemId?: () => string
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
  const { snapshot, quantities, setQuantities, memos, setMemos, isLoading, isUpdating, isExpired,
    message, setMessage, updateApiAvailable, submitOperations, turnstileContainerRef,
  } = useLiveRequestManagement({ config, liveRequestApi, requestToken, editSecret, onError })

  const activeItems = snapshot?.items.filter(
    (item) => item.lifecycle === 'active',
  ) ?? []
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
          <LiveRequestAddForm
            effectiveProducts={effectiveProducts}
            snapshot={snapshot}
            isUpdating={isUpdating}
            isExpired={isExpired}
            updateApiAvailable={updateApiAvailable}
            submitOperations={submitOperations}
            setMessage={setMessage}
            createItemId={createItemId}
          />

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
                  disabled={isUpdating || isExpired || !updateApiAvailable}
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
