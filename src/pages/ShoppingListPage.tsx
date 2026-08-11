import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { CartConfirmationDialog } from '../components/CartConfirmationDialog'
import { CategorySection } from '../components/CategorySection'
import { CheckoutReviewSection } from '../components/CheckoutReviewSection'
import { ConsultationDialog } from '../components/ConsultationDialog'
import { ConsultationSummary } from '../components/ConsultationSummary'
import { NativeShareUnavailableNotice } from '../components/NativeShareUnavailableNotice'
import { ShoppingCompletionView } from '../components/ShoppingCompletionView'
import { ShoppingItemCard } from '../components/ShoppingItemCard'
import { ShoppingToolbar } from '../components/ShoppingToolbar'
import { ShoppingUndoNotice } from '../components/ShoppingUndoNotice'
import { FIXED_REQUEST_TITLE } from '../constants/request'
import {
  useConsultationWorkflow,
  type ConsultationShareLock,
} from '../hooks/useConsultationWorkflow'
import { usePersistedShoppingSession } from '../hooks/usePersistedShoppingSession'
import { useShoppingUndoNotice } from '../hooks/useShoppingUndoNotice'
import type {
  CheckedItemStatus,
  ItemIssue,
  ShoppingRequestItemPayload,
  ShoppingRequestPayload,
  ShoppingStateChange,
} from '../types/shopping'
import { addLineExternalBrowserHint } from '../utils/lineDeliveryUrl'
import {
  buildShoppingResultMessage,
} from '../utils/shoppingMessages'
import {
  selectShoppingPageView,
  type ShoppingFilterMode,
} from '../utils/shoppingPageView'
import {
  getItemStatus,
  getShoppingCompletionState,
  hasCondition,
} from '../utils/shoppingState'
import {
  loadShoppingSession,
  reconcileShoppingSession,
  restoreShoppingSession,
  type RequestRouteCodec,
} from '../utils/shoppingSession'
import {
  isNativeShareAvailable,
  shareText,
  type NativeShareResult,
} from '../utils/shareText'
import {
  getProductPhotoConfig,
  type ProductPhotoConfig,
} from '../features/productPhotos/config'
import { ProductPhotoViewer } from '../features/productPhotos/ProductPhotoViewer'
import type { LiveRequestApi } from '../features/liveRequests/types'
import { useLiveRequestSync } from '../features/liveRequests/useLiveRequestSync'
import {
  cancelledItemMessage,
  describeLiveRequestChange,
  liveRequestToShoppingPayload,
} from '../features/liveRequests/shopping'

type ShoppingListPageProps = {
  encodedPayload: string
  payloadCodec: RequestRouteCodec
  onBackHome: () => void
  onError: (title: string, description: string) => void
  productPhotoConfig?: ProductPhotoConfig
  liveRequestToken?: string
  liveRequestApi?: LiveRequestApi
}

type CartConfirmationState = {
  itemId: string
  needsQuantityConfirmation: boolean
  needsConditionConfirmation: boolean
  quantityConfirmed: boolean
  conditionConfirmed: boolean
  isConditionFollowUp: boolean
}

type ShareNotice = {
  kind: 'success' | 'error' | 'info'
  message: string
}

function getUndoNoticeMessage(
  item: ShoppingRequestItemPayload,
  change: ShoppingStateChange,
): string {
  if (change.nextStatus === 'inCart') {
    return `${item.productNameSnapshot}をかご済みにしました`
  }
  if (change.nextStatus === 'verified') {
    return `${item.productNameSnapshot}を購入時に条件確認してかご済みにしました`
  }
  if (change.nextStatus === 'notBuying') {
    return `${item.productNameSnapshot}を今回は買わないにしました`
  }
  return `${item.productNameSnapshot}を未購入に戻しました`
}

function getResultShareNotice(result: NativeShareResult): ShareNotice {
  if (result === 'shared') {
    return {
      kind: 'success',
      message:
        '共有画面を開きました。\nLINEを選択して結果を送信してください。',
    }
  }

  if (result === 'copied') {
    return {
      kind: 'success',
      message:
        'OS共有を利用できなかったため、結果をコピーしました。\nLINEへ貼り付けるか、外部ブラウザで開いて共有してください。',
    }
  }

  if (result === 'cancelled') {
    return {
      kind: 'info',
      message:
        '結果の共有をキャンセルしました。買い物結果はそのまま残っています。',
    }
  }

  return {
    kind: 'error',
    message:
      '結果を共有またはコピーできませんでした。\n買い物結果はそのまま残っています。外部ブラウザで開いてもう一度お試しください。',
  }
}

export function ShoppingListPage({
  encodedPayload,
  payloadCodec,
  onBackHome,
  onError,
  productPhotoConfig,
  liveRequestToken,
  liveRequestApi,
}: ShoppingListPageProps) {
  const photoConfig = productPhotoConfig ?? getProductPhotoConfig()
  const [payload, setPayload] = useState<ShoppingRequestPayload | null>(null)
  const {
    shoppingState,
    consultations,
    hasPersistenceError,
    replaceSession,
    commitShoppingChange: commitPersistedShoppingChange,
    undoShoppingChange,
    updateConsultations,
    getCurrentShoppingState,
    getCurrentConsultations,
  } = usePersistedShoppingSession()
  const [filterMode, setFilterMode] = useState<ShoppingFilterMode>('all')
  const [cartConfirmation, setCartConfirmation] =
    useState<CartConfirmationState | null>(null)
  const [isCheckoutReviewOpen, setIsCheckoutReviewOpen] = useState(false)
  const [isCompletionView, setIsCompletionView] = useState(false)
  const {
    undoNotice,
    showUndoNotice,
    consumeUndoNotice,
    clearUndoNotice,
  } = useShoppingUndoNotice()
  const [isSharingResult, setIsSharingResult] = useState(false)
  const [shareNotice, setShareNotice] = useState<ShareNotice | null>(null)
  const activeShareRef = useRef(false)
  const resultShareGenerationRef = useRef(0)
  const shouldPublishResultNoticeRef = useRef(false)
  const checkoutReviewRef = useRef<HTMLElement | null>(null)
  const completionHeadingRef = useRef<HTMLHeadingElement | null>(null)
  const loadedLiveRequestIdRef = useRef<string>()
  const liveSync = useLiveRequestSync({
    enabled: Boolean(liveRequestToken && liveRequestApi),
    requestToken: liveRequestToken ?? '',
    api: liveRequestApi,
  })
  const nativeShareAvailable = isNativeShareAvailable()
  const externalBrowserUrl = useMemo(
    () => addLineExternalBrowserHint(window.location.href),
    [encodedPayload, liveRequestToken, payloadCodec],
  )
  const consultationShareLock = useMemo<ConsultationShareLock>(
    () => ({
      tryAcquire: () => {
        if (activeShareRef.current) {
          return false
        }
        activeShareRef.current = true
        return true
      },
      release: () => {
        activeShareRef.current = false
      },
    }),
    [],
  )

  const { checkedState, itemIssues, cartOrder } = shoppingState

  useEffect(
    () => () => {
      resultShareGenerationRef.current += 1
      shouldPublishResultNoticeRef.current = false
      activeShareRef.current = false
    },
    [],
  )

  const activeItems = useMemo(
    () =>
      (payload?.items ?? []).filter(
        (item) => item.liveLifecycle !== 'cancelled-by-requester',
      ),
    [payload],
  )
  const cancelledItems = useMemo(
    () =>
      (payload?.items ?? []).filter(
        (item) => item.liveLifecycle === 'cancelled-by-requester',
      ),
    [payload],
  )
  const liveChangesByItem = useMemo(() => {
    const changes = new Map<
      string,
      (typeof liveSync.pendingChanges)[number][]
    >()
    for (const change of liveSync.pendingChanges) {
      const current = changes.get(change.itemId) ?? []
      current.push(change)
      changes.set(change.itemId, current)
    }
    return changes
  }, [liveSync.pendingChanges])

  const {
    sortedItems,
    cartItems,
    consultationItems,
    notBuyingItems,
    groupedVisibleItems,
    completionState,
    unresolvedCount,
  } = useMemo(
    () =>
      selectShoppingPageView({
        items: activeItems,
        checkedState,
        consultations,
        cartOrder,
        filterMode,
      }),
    [activeItems, cartOrder, checkedState, consultations, filterMode],
  )
  const pendingItems = useMemo(
    () =>
      sortedItems.filter(
        (item) => getItemStatus(checkedState, item.id) === 'pending',
      ),
    [checkedState, sortedItems],
  )
  const getCurrentItemIssue = useCallback(
    (itemId: string) =>
      getCurrentShoppingState().itemIssues[itemId],
    [getCurrentShoppingState],
  )
  const {
    consultationDraft,
    isSharingConsultation,
    sharingConsultationItemId,
    openConsultation,
    closeConsultation,
    setReason: setConsultationReason,
    setNote: setConsultationNote,
    getDraftIssue,
    addToQueue: handleAddToQueue,
    shareDraftImmediately: handleShareDraftImmediately,
    shareIndividual: handleShareIndividual,
    shareQueued: handleShareQueued,
    removeConsultation: handleRemoveConsultation,
    resolveConsultation: handleResolveConsultation,
  } = useConsultationWorkflow({
    sessionKey: liveRequestToken
      ? `live:${liveRequestToken}`
      : `${payloadCodec}:${encodedPayload}`,
    items: sortedItems,
    updateConsultations,
    getCurrentConsultations,
    getItemIssue: getCurrentItemIssue,
    share: shareText,
    shareLock: consultationShareLock,
    onNotice: setShareNotice,
  })

  useEffect(() => {
    if (liveRequestToken) {
      return
    }
    loadedLiveRequestIdRef.current = undefined
    resultShareGenerationRef.current += 1
    shouldPublishResultNoticeRef.current = false
    activeShareRef.current = false
    clearUndoNotice()

    try {
      const loadedSession = loadShoppingSession({
        encodedPayload,
        codec: payloadCodec,
      })

      setPayload(loadedSession.payload)
      replaceSession({
        requestId: loadedSession.payload.requestId,
        shoppingState: loadedSession.shoppingState,
        consultations: loadedSession.consultations,
      })
      setFilterMode('all')
      setCartConfirmation(null)
      setIsCheckoutReviewOpen(false)
      setIsCompletionView(false)
      setIsSharingResult(false)
      setShareNotice(null)
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : '共有URLの内容を読み込めませんでした。'
      onError('共有URLを開けませんでした', message)
    }
  }, [
    clearUndoNotice,
    encodedPayload,
    onError,
    payloadCodec,
    replaceSession,
    liveRequestToken,
  ])

  useEffect(() => {
    if (!liveRequestToken || !liveSync.snapshot) {
      if (liveRequestToken && liveSync.status === 'missing') {
        onError(
          '更新可能な依頼を開けませんでした',
          '依頼が見つからないか、最新状態を取得できませんでした。',
        )
      }
      return
    }

    const nextPayload = liveRequestToShoppingPayload(liveSync.snapshot)
    const isExistingSession =
      loadedLiveRequestIdRef.current === nextPayload.requestId
    const loadedSession = isExistingSession
      ? reconcileShoppingSession(
          nextPayload,
          getCurrentShoppingState(),
          getCurrentConsultations(),
        )
      : restoreShoppingSession(nextPayload)

    setPayload(nextPayload)
    replaceSession({
      requestId: nextPayload.requestId,
      shoppingState: loadedSession.shoppingState,
      consultations: loadedSession.consultations,
    })
    loadedLiveRequestIdRef.current = nextPayload.requestId
    setCartConfirmation((current) =>
      current &&
      nextPayload.items.some(
        (item) =>
          item.id === current.itemId &&
          item.liveLifecycle !== 'cancelled-by-requester',
      )
        ? current
        : null,
    )
    if (!isExistingSession) {
      setFilterMode('all')
      setIsCheckoutReviewOpen(false)
      setIsCompletionView(false)
      setIsSharingResult(false)
      setShareNotice(null)
      clearUndoNotice()
    } else if (liveSync.pendingChanges.length > 0) {
      setIsCompletionView(false)
    }
  }, [
    clearUndoNotice,
    getCurrentConsultations,
    getCurrentShoppingState,
    liveRequestToken,
    liveSync.pendingChanges.length,
    liveSync.snapshot,
    liveSync.status,
    onError,
    replaceSession,
  ])

  const commitShoppingChange = (
    itemId: string,
    nextStatus: CheckedItemStatus,
    nextIssue?: ItemIssue,
  ) => {
    const committedChange = commitPersistedShoppingChange(
      itemId,
      nextStatus,
      nextIssue,
    )

    if (!committedChange) {
      setCartConfirmation((current) =>
        current?.itemId === itemId ? null : current,
      )
      return false
    }

    const { change, previousCartOrder } = committedChange
    setShareNotice(null)
    const changedItem = payload?.items.find((item) => item.id === itemId)
    if (changedItem) {
      showUndoNotice({
        change,
        message: getUndoNoticeMessage(changedItem, change),
        previousCartOrder,
      })
    }
    setCartConfirmation((current) =>
      current?.itemId === itemId ? null : current,
    )
    return true
  }

  const handleOpenCartConfirmation = (
    item: ShoppingRequestItemPayload,
    isConditionFollowUp = false,
  ) => {
    const needsQuantityConfirmation =
      !isConditionFollowUp && item.quantity >= 2
    const needsConditionConfirmation = hasCondition(item)

    if (!needsQuantityConfirmation && !needsConditionConfirmation) {
      commitShoppingChange(item.id, 'inCart')
      return
    }

    closeConsultation()
    setShareNotice(null)
    setCartConfirmation({
      itemId: item.id,
      needsQuantityConfirmation,
      needsConditionConfirmation,
      quantityConfirmed: false,
      conditionConfirmed: false,
      isConditionFollowUp,
    })
  }

  const handleConfirmCart = () => {
    if (!cartConfirmation) {
      return
    }
    if (
      (cartConfirmation.needsQuantityConfirmation &&
        !cartConfirmation.quantityConfirmed) ||
      (cartConfirmation.needsConditionConfirmation &&
        !cartConfirmation.conditionConfirmed)
    ) {
      return
    }

    commitShoppingChange(
      cartConfirmation.itemId,
      cartConfirmation.needsConditionConfirmation ? 'verified' : 'inCart',
    )
  }

  const handleOpenConsultation = (itemId: string) => {
    setCartConfirmation(null)
    setShareNotice(null)
    openConsultation(itemId)
  }

  const handleMarkNotBuying = () => {
    const draftIssue = getDraftIssue()
    if (!draftIssue) {
      return
    }

    commitShoppingChange(
      draftIssue.itemId,
      'notBuying',
      draftIssue.issue,
    )
    closeConsultation()
  }

  const handleOpenCheckoutReview = () => {
    setIsCheckoutReviewOpen(true)
    window.requestAnimationFrame(() => {
      checkoutReviewRef.current?.focus()
      checkoutReviewRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    })
  }

  const handleUndo = () => {
    const currentUndoNotice = consumeUndoNotice()
    if (!currentUndoNotice) {
      return
    }
    const { change: lastChange, previousCartOrder } = currentUndoNotice

    undoShoppingChange(lastChange, previousCartOrder)
    setCartConfirmation((current) =>
      current?.itemId === lastChange.itemId ? null : current,
    )
  }

  const handleShareResult = async () => {
    if (activeShareRef.current) {
      return
    }

    const shareGeneration = resultShareGenerationRef.current
    activeShareRef.current = true
    shouldPublishResultNoticeRef.current = true
    setIsSharingResult(true)
    try {
      const result = await shareText({
        title: 'おつかい結果',
        text: buildShoppingResultMessage(
          completionState.purchasedCount,
          notBuyingItems.map((item) => ({
            item,
            issue: itemIssues[item.id],
          })),
        ),
      })
      if (
        shareGeneration !== resultShareGenerationRef.current ||
        !shouldPublishResultNoticeRef.current
      ) {
        return
      }

      setShareNotice(getResultShareNotice(result))
    } finally {
      if (shareGeneration === resultShareGenerationRef.current) {
        shouldPublishResultNoticeRef.current = false
        activeShareRef.current = false
        setIsSharingResult(false)
      }
    }
  }

  const handleFinishShopping = () => {
    const latestCompletionState = getShoppingCompletionState(
      sortedItems,
      getCurrentShoppingState().checkedState,
      getCurrentConsultations(),
    )
    if (!latestCompletionState.canFinish) {
      return
    }

    setShareNotice(null)
    setIsCompletionView(true)
    window.requestAnimationFrame(() => {
      completionHeadingRef.current?.focus()
      window.scrollTo({ top: 0, behavior: 'smooth' })
    })
  }

  const handleReviewShopping = () => {
    shouldPublishResultNoticeRef.current = false
    setIsCompletionView(false)
    setIsCheckoutReviewOpen(true)
    setShareNotice(null)
    window.requestAnimationFrame(() => {
      checkoutReviewRef.current?.focus()
      checkoutReviewRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    })
  }

  if (!payload) {
    return liveRequestToken ? (
      <main className="page">
        <section className="top-bar">
          <button type="button" className="ghost-button" onClick={onBackHome}>
            ホーム
          </button>
          <div>
            <p className="eyebrow">お使いリスト</p>
            <h1>依頼を確認中</h1>
          </div>
        </section>
        <section className="info-card" aria-live="polite">
          <p>最新の依頼内容を確認しています。</p>
        </section>
      </main>
    ) : null
  }

  if (isCompletionView) {
    return (
      <ShoppingCompletionView
        allPurchased={completionState.notBuyingCount === 0}
        nativeShareAvailable={nativeShareAvailable}
        externalBrowserUrl={externalBrowserUrl}
        completionState={completionState}
        completionHeadingRef={completionHeadingRef}
        shareNotice={shareNotice}
        hasPersistenceError={hasPersistenceError}
        notBuyingItems={notBuyingItems}
        itemIssues={itemIssues}
        isSharingResult={isSharingResult}
        onShareResult={handleShareResult}
        onReviewShopping={handleReviewShopping}
        onBackHome={onBackHome}
      />
    )
  }

  const showCheckoutReview =
    isCheckoutReviewOpen ||
    (sortedItems.length > 0 && completionState.pendingCount === 0)
  const cartConfirmationItem = cartConfirmation
    ? sortedItems.find((item) => item.id === cartConfirmation.itemId)
    : undefined
  const consultationDraftItem = consultationDraft
    ? sortedItems.find((item) => item.id === consultationDraft.itemId)
    : undefined

  return (
    <main className="page">
      <section className="top-bar">
        <button type="button" className="ghost-button" onClick={onBackHome}>
          ホーム
        </button>
        <div>
          <p className="eyebrow">お使いリスト</p>
          <h1>{FIXED_REQUEST_TITLE}</h1>
        </div>
      </section>

      {!nativeShareAvailable ? (
        <NativeShareUnavailableNotice externalBrowserUrl={externalBrowserUrl} />
      ) : null}

      {liveRequestToken ? (
        <section className="info-card live-request-sync-card" aria-live="polite">
          <div className="section-heading">
            <h2>依頼の更新</h2>
            <span>revision {liveSync.snapshot?.revision ?? '-'}</span>
          </div>
          {liveSync.status === 'stale' ? (
            <p className="share-notice error">
              最新状態を確認できません。最後に取得できた商品リストで買い物を続けられます。
            </p>
          ) : null}
          {liveSync.status === 'expired' ? (
            <p className="share-notice error">
              共有期限が切れました。最後に取得できた商品リストと端末内の購入進捗は引き続き利用できます。
            </p>
          ) : null}
          {liveSync.cachePersistenceFailed ? (
            <p className="share-notice error">
              最新の依頼内容をこの端末へ保存できませんでした。
            </p>
          ) : null}
          <div className="inline-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => void liveSync.refresh()}
              disabled={
                liveSync.status === 'checking' ||
                liveSync.status === 'loading'
              }
            >
              {liveSync.status === 'checking' ? '確認中…' : '更新を確認'}
            </button>
            {liveSync.pendingChanges.length > 0 ? (
              <button
                type="button"
                className="secondary-button"
                onClick={liveSync.acknowledgeChanges}
              >
                変更を確認しました
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="hero-card compact-hero">
        <p className="eyebrow">残りの処理</p>
        <div className="remaining-count">{unresolvedCount}</div>
        <p className="lead">
          {unresolvedCount > 0
            ? '件の商品が未処理または未解決です'
            : 'すべての商品を確認できました'}
        </p>
        {(cartItems.length > 0 || notBuyingItems.length > 0) &&
        !showCheckoutReview ? (
          <div className="checkout-callout">
            <p>購入内容と未処理の例外を会計前に確認できます。</p>
            <button
              type="button"
              className="primary-button"
              onClick={handleOpenCheckoutReview}
            >
              会計前チェックへ
            </button>
          </div>
        ) : null}
      </section>

      {shareNotice ? (
        <p className={`share-notice ${shareNotice.kind}`} role="status">
          {shareNotice.message}
        </p>
      ) : null}

      {hasPersistenceError ? (
        <p className="share-notice error" role="alert">
          買い物の進捗をこの端末に保存できませんでした。
          再読み込みすると変更が失われる可能性があります。
        </p>
      ) : null}

      {undoNotice ? (
        <ShoppingUndoNotice
          message={undoNotice.message}
          disabled={false}
          onUndo={handleUndo}
        />
      ) : null}

      {consultationItems.length > 0 ? (
        <ConsultationSummary
          entries={consultationItems}
          isSharingConsultation={isSharingConsultation}
          sharingItemId={sharingConsultationItemId}
          onShareQueued={handleShareQueued}
          onEdit={handleOpenConsultation}
          onShareIndividual={handleShareIndividual}
          onRemove={handleRemoveConsultation}
          onResolve={handleResolveConsultation}
        />
      ) : null}

      <ShoppingToolbar
        filterMode={filterMode}
        onToggleFilter={() =>
          setFilterMode((current) =>
            current === 'remaining' ? 'all' : 'remaining',
          )
        }
      />

      {groupedVisibleItems.length > 0 ? (
        groupedVisibleItems.map((group) => (
          <CategorySection
            key={group.id}
            name={group.name}
            count={group.items.length}
          >
            {group.items.map((item) => {
              const status = getItemStatus(checkedState, item.id)
              const itemChanges = liveChangesByItem.get(item.id) ?? []
              const changeNotice = itemChanges.length > 0 ? (
                <span
                  className={`live-request-change ${
                    status === 'inCart' || status === 'verified'
                      ? 'is-strong'
                      : ''
                  }`}
                >
                  {itemChanges.map(describeLiveRequestChange).join(' / ')}
                </span>
              ) : undefined

              return (
                <ShoppingItemCard
                  key={item.id}
                  item={item}
                  status={status}
                  issue={itemIssues[item.id]}
                  consultation={consultations[item.id]}
                  isPurchaseLocked={false}
                  isConsultationLocked={isSharingConsultation}
                  onAddToCart={() => handleOpenCartConfirmation(item)}
                  onOpenConditionConfirmation={() =>
                    handleOpenCartConfirmation(item, true)
                  }
                  onOpenConsultation={() =>
                    handleOpenConsultation(item.id)
                  }
                  onReset={() =>
                    commitShoppingChange(item.id, 'pending')
                  }
                  changeNotice={changeNotice}
                  photoContent={
                    photoConfig.enabled && item.photoToken ? (
                      <ProductPhotoViewer
                        endpoint={photoConfig.endpoint}
                        validationSessionToken={
                          photoConfig.validationSessionToken
                        }
                        token={item.photoToken}
                        itemName={item.productNameSnapshot}
                      />
                    ) : undefined
                  }
                />
              )
            })}
          </CategorySection>
        ))
      ) : (
        <section className="info-card">
          <p>表示できる商品がありません。</p>
        </section>
      )}

      {cancelledItems.length > 0 ? (
        <details
          className="info-card live-request-cancelled"
          open={liveSync.pendingChanges.some(
            (change) => change.kind === 'cancelled',
          )}
        >
          <summary>依頼者が取り消した商品（{cancelledItems.length}件）</summary>
          <ul className="live-request-cancelled-list">
            {cancelledItems.map((item) => (
              <li key={item.id}>
                <strong>{item.productNameSnapshot}</strong>
                <span>
                  {cancelledItemMessage(
                    getItemStatus(checkedState, item.id),
                    Boolean(consultations[item.id]),
                  )}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {showCheckoutReview ? (
        <CheckoutReviewSection
          cartItems={cartItems}
          notBuyingItems={notBuyingItems}
          pendingItems={pendingItems}
          consultationEntries={consultationItems}
          checkedState={checkedState}
          itemIssues={itemIssues}
          completionState={completionState}
          isConsultationShareActive={isSharingConsultation}
          sectionRef={checkoutReviewRef}
          onResetItem={(itemId) =>
            commitShoppingChange(itemId, 'pending')
          }
          onOpenConditionConfirmation={(itemId) => {
            const item = sortedItems.find(
              (currentItem) => currentItem.id === itemId,
            )
            if (item) {
              handleOpenCartConfirmation(item, true)
            }
          }}
          onEditConsultation={handleOpenConsultation}
          onResolveConsultation={handleResolveConsultation}
          onFinishShopping={handleFinishShopping}
        />
      ) : null}

      {cartConfirmation && cartConfirmationItem ? (
        <CartConfirmationDialog
          item={cartConfirmationItem}
          needsQuantityConfirmation={
            cartConfirmation.needsQuantityConfirmation
          }
          needsConditionConfirmation={
            cartConfirmation.needsConditionConfirmation
          }
          quantityConfirmed={cartConfirmation.quantityConfirmed}
          conditionConfirmed={cartConfirmation.conditionConfirmed}
          isConditionFollowUp={cartConfirmation.isConditionFollowUp}
          isPurchaseLocked={false}
          isConsultationLocked={isSharingConsultation}
          onQuantityConfirmedChange={(confirmed) =>
            setCartConfirmation((current) =>
              current
                ? { ...current, quantityConfirmed: confirmed }
                : current,
            )
          }
          onConditionConfirmedChange={(confirmed) =>
            setCartConfirmation((current) =>
              current
                ? { ...current, conditionConfirmed: confirmed }
                : current,
            )
          }
          onConsult={() =>
            handleOpenConsultation(cartConfirmation.itemId)
          }
          onClose={() => setCartConfirmation(null)}
          onConfirm={handleConfirmCart}
        />
      ) : null}

      {consultationDraft && consultationDraftItem ? (
        <ConsultationDialog
          item={consultationDraftItem}
          selectedReason={consultationDraft.reason}
          note={consultationDraft.note}
          isSharing={
            isSharingConsultation &&
            sharingConsultationItemId === consultationDraft.itemId
          }
          onReasonChange={setConsultationReason}
          onNoteChange={setConsultationNote}
          onShareImmediately={handleShareDraftImmediately}
          onAddToQueue={handleAddToQueue}
          onMarkNotBuying={handleMarkNotBuying}
          onClose={closeConsultation}
        />
      ) : null}
    </main>
  )
}
