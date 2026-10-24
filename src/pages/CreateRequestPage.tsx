import { useEffect, useMemo, useRef, useState } from 'react'
import { CreateRequestBottomActions } from '../components/CreateRequestBottomActions'
import { CustomItemsSection } from '../components/CustomItemsSection'
import { HiddenSelectedProductsSection } from '../components/HiddenSelectedProductsSection'
import type { CommitTextResult } from '../components/ImeAwareTextInput'
import { ProductSelectionSections } from '../components/ProductSelectionSections'
import { ProductSearch } from '../components/ProductSearch'
import { RequestLimitNotice } from '../components/RequestLimitNotice'
import { RequestReviewView } from '../components/RequestReviewView'
import {
  RequestSharingModeSection
} from '../components/RequestSharingModeSection'
import { FIXED_REQUEST_TITLE } from '../constants/request'
import {
  MAX_CUSTOM_ITEM_NAME_CHARS,
  MAX_CUSTOM_ITEMS,
  MAX_CUSTOM_ITEM_UNIT_CHARS,
  MAX_ITEM_CONDITION_CHARS,
  MAX_ITEM_QUANTITY,
  MAX_SHARE_URL_LENGTH,
} from '../constants/requestLimits'
import { categories } from '../data/categories'
import { HandwritingImportSection } from '../features/handwriting/HandwritingImportSection'
import {
  applyHandwritingImportSelections,
} from '../features/handwriting/applyImport'
import {
  getHandwritingImportConfig,
  type HandwritingImportConfig,
} from '../features/handwriting/config'
import type {
  ImagePreprocessOptions,
} from '../features/handwriting/imagePreprocessing'
import type {
  HandwritingImportProvider,
  HandwritingImportSelection,
} from '../features/handwriting/types'
import {
  getLiveRequestConfig,
  type LiveRequestConfig,
} from '../features/liveRequests/config'
import type { LiveRequestApi } from '../features/liveRequests/types'
import { addManualValidationSessionToBaseUrl } from '../features/manualValidation/session'
import { ProductPhotoAttachment } from '../features/productPhotos/ProductPhotoAttachment'
import {
  type ProductPhotoUploadProvider
} from '../features/productPhotos/ProductPhotoUploadProvider'
import {
  getProductPhotoConfig,
  type ProductPhotoConfig,
} from '../features/productPhotos/config'
import {
  processProductPhoto as defaultProcessProductPhoto,
  type ProcessedProductPhoto,
} from '../features/productPhotos/imageProcessing'
import { usePendingProductPhotos } from '../features/productPhotos/usePendingProductPhotos'
import { useCreateRequestDraft } from '../hooks/useCreateRequestDraft'
import { useCustomItemEditor } from '../hooks/useCustomItemEditor'
import { useHouseholdCatalog } from '../hooks/useHouseholdCatalog'
import { useRequestSharing } from '../hooks/useRequestSharing'
import type { CreateDraftState } from '../types/shopping'
import { createRequestKey } from '../utils/compactRequest'
import {
  createDraftState,
  createEmptyDraftState,
  createRequestContentSnapshot,
  hasAnyCreateRequestInput,
  toggleExpandedProductId
} from '../utils/createRequestState'
import {
  normalizeCustomQuantity,
  type DraftChangeResult,
} from '../utils/draftLimits'
import { createId } from '../utils/id'
import { matchesProductSearch, normalizeProductSearch } from '../utils/productSearch'
import {
  calculateRequestBudget,
  countTotalConditionCharacters,
  isShareUrlWarning,
  isTotalConditionWarning,
  type CustomRequestDraftItem,
  type DraftLimitReason,
  type RequestDraftData
} from '../utils/requestBudget'
import {
  getLimitMessage
} from '../utils/requestNoticeMessages'
import { buildSelectedRequestItems, toStableCustomProductId } from '../utils/selectedRequestItems'
import {
  createRequestShareSnapshot
} from '../utils/shareRequest'
import {
  splitUserCharacters,
  truncateUserCharacters,
} from '../utils/textLength'

type CreateRequestPageProps = {
  onBackHome: () => void
  handwritingImportConfig?: HandwritingImportConfig
  handwritingImportProvider?: HandwritingImportProvider
  preprocessHandwritingImage?: (
    file: File,
    options?: ImagePreprocessOptions,
  ) => Promise<Blob>
  productPhotoConfig?: ProductPhotoConfig
  productPhotoUploadProvider?: ProductPhotoUploadProvider
  processProductPhoto?: (
    file: File,
    options?: { signal?: AbortSignal },
  ) => Promise<ProcessedProductPhoto>
  createProductPhotoPreviewUrl?: (blob: Blob) => string
  revokeProductPhotoPreviewUrl?: (url: string) => void
  liveRequestConfig?: LiveRequestConfig
  liveRequestApi?: LiveRequestApi
  createLiveRequestItemId?: () => string
}

type CreateMode = 'edit' | 'review'

type CustomItem = CustomRequestDraftItem

export function CreateRequestPage({
  onBackHome,
  handwritingImportConfig,
  handwritingImportProvider,
  preprocessHandwritingImage,
  productPhotoConfig,
  productPhotoUploadProvider,
  processProductPhoto,
  createProductPhotoPreviewUrl,
  revokeProductPhotoPreviewUrl,
  liveRequestConfig,
  liveRequestApi,
  createLiveRequestItemId,
}: CreateRequestPageProps) {
  const { effectiveProducts, visibleProducts } = useHouseholdCatalog()
  const handwritingConfig =
    handwritingImportConfig ?? getHandwritingImportConfig()
  const photoConfig = productPhotoConfig ?? getProductPhotoConfig()
  const liveConfig = liveRequestConfig ?? getLiveRequestConfig()
  const manualValidationSessionToken =
    photoConfig.validationSessionToken ?? liveConfig.validationSessionToken
  const [requestKey, setRequestKey] = useState(createRequestKey)
  const requestBaseUrl = useMemo(
    () => `${window.location.origin}${window.location.pathname}`,
    [],
  )
  const budgetContext = useMemo(
    () => ({ baseUrl: requestBaseUrl, requestKey }),
    [requestBaseUrl, requestKey],
  )
  const {
    initialPageState,
    draft,
    customItems,
    requestData,
    changeQuantity,
    changeCondition,
    previewCustomItem: previewDraftCustomItem,
    saveCustomItem,
    deleteCustomItem,
    applyChange: applyDraftChange,
    resetDraft,
  } = useCreateRequestDraft({ effectiveProducts, budgetContext })
  const [expandedProductIds, setExpandedProductIds] = useState<Set<string>>(
    initialPageState.expandedProductIds,
  )
  const [mode, setMode] = useState<CreateMode>(
    initialPageState.returnState ? 'review' : 'edit',
  )
  const [limitMessage, setLimitMessage] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const focusCustomNameRef = useRef(false)
  const {
    isOpen: isCustomFormOpen,
    editingIndex: editingCustomIndex,
    name: customName,
    quantity: customQuantity,
    unit: customUnit,
    memo: customMemo,
    isDetailsOpen: isCustomDetailsOpen,
    setName: setCustomName,
    setQuantity: setCustomQuantity,
    setUnit: setCustomUnit,
    setMemo: setCustomMemo,
    openNew: openNewCustomForm,
    openExisting: openExistingCustomForm,
    handleItemDeleted: handleCustomItemDeleted,
    toggleDetails: toggleCustomDetails,
    reset: closeCustomForm,
  } = useCustomItemEditor()
  useEffect(() => {
    if (isCustomFormOpen && focusCustomNameRef.current) {
      focusCustomNameRef.current = false
      document.getElementById('custom-item-name')?.focus()
    }
  }, [isCustomFormOpen])
  const pendingPhotos = usePendingProductPhotos({
    processPhoto: processProductPhoto ?? defaultProcessProductPhoto,
    ...(createProductPhotoPreviewUrl
      ? { createPreviewUrl: createProductPhotoPreviewUrl }
      : {}),
    ...(revokeProductPhotoPreviewUrl
      ? { revokePreviewUrl: revokeProductPhotoPreviewUrl }
      : {}),
  })

  const validationRequestBaseUrl = useMemo(
    () =>
      addManualValidationSessionToBaseUrl(
        requestBaseUrl,
        manualValidationSessionToken,
      ),
    [manualValidationSessionToken, requestBaseUrl],
  )
  const selectedItems = useMemo(
    () => buildSelectedRequestItems(effectiveProducts, draft, customItems),
    [customItems, draft, effectiveProducts],
  )
  const selectedCount = selectedItems.length
  const selectedItemKeys = useMemo(
    () => new Set(selectedItems.map((item) => item.productId)),
    [selectedItems],
  )
  const activePhotos = useMemo(
    () =>
      pendingPhotos.photos.filter((photo) =>
        selectedItemKeys.has(photo.itemKey),
      ),
    [pendingPhotos.photos, selectedItemKeys],
  )

  const totalConditionCharacters = useMemo(
    () => countTotalConditionCharacters(requestData),
    [requestData],
  )

  const currentBudget = useMemo(() => {
    try {
      return calculateRequestBudget(requestData, budgetContext)
    } catch {
      return undefined
    }
  }, [budgetContext, requestData])
  const isConditionLimitWarning = isTotalConditionWarning(totalConditionCharacters)
  const isShareUrlLimitWarning =
    currentBudget ? isShareUrlWarning(currentBudget.urlLength) : false
  const isShareUrlOverLimit = (currentBudget?.urlLength ?? 0) > MAX_SHARE_URL_LENGTH
  const hasRequestLimitError =
    Boolean(limitMessage) || !currentBudget || isShareUrlOverLimit
  const showRequestLimitNotice =
    isConditionLimitWarning || isShareUrlLimitWarning || hasRequestLimitError

  const currentRequestSnapshot = useMemo(
    () =>
      createRequestContentSnapshot({
        title: FIXED_REQUEST_TITLE,
        draft,
        productList: effectiveProducts,
        customItems,
      }),
    [customItems, draft, effectiveProducts],
  )

  const {
    sharedUrl, lastSharedUrl, shareMessage, shareStatus, setShareMessage, setShareStatus,
    sharingMode, setSharingMode, isSharingRequest, isUploadingPhotos, photoUploadFailed,
    photoTurnstileContainerRef, liveTurnstileContainerRef, liveManagementUrl, liveManagementSnapshot,
    managementCopyMessage, handleCopyManagementUrl, handleShareRequest, handleShareWithoutPhotos,
    resetSharing, isSharingActive,
  } = useRequestSharing({
    initialPageState, requestData, budgetContext, requestKey, setRequestKey, currentRequestSnapshot,
    selectedItems, activePhotos, pendingPhotos, expandedProductIds, validationRequestBaseUrl,
    manualValidationSessionToken, photoConfig, productPhotoUploadProvider, liveConfig, liveRequestApi,
    createLiveRequestItemId,
  })

  const hasResettableInput = useMemo(
    () =>
      pendingPhotos.photos.length > 0 ||
      Object.values(draft).some((item) => item.memo.trim().length > 0) ||
      hasAnyCreateRequestInput({
        title: FIXED_REQUEST_TITLE,
        defaultTitle: FIXED_REQUEST_TITLE,
        draft,
        productList: effectiveProducts,
        customItemCount: customItems.length,
        isCustomFormOpen,
        customName,
        customQuantity,
        customUnit,
        customMemo,
        sharedUrl,
        lastSharedUrl,
        mode,
        copyMessage: shareMessage,
      }),
    [
      customItems.length,
      customMemo,
      customName,
      customQuantity,
      customUnit,
      draft,
      effectiveProducts,
      isCustomFormOpen,
      lastSharedUrl,
      mode,
      shareMessage,
      sharedUrl,
      pendingPhotos.photos.length,
    ],
  )

  const groupedProducts = useMemo(
    () =>
      categories
        .map((category) => ({
          category,
          items: visibleProducts
            .filter((product) => product.categoryId === category.id && matchesProductSearch(product.name, searchQuery))
            .sort((a, b) => a.sortOrder - b.sortOrder),
        }))
        .filter((group) => group.items.length > 0),
    [visibleProducts, searchQuery],
  )

  const hiddenSelectedProducts = useMemo(
    () =>
      effectiveProducts.filter(
        (product) =>
          product.hidden &&
          ((draft[product.id]?.quantity ?? 0) > 0 ||
            pendingPhotos.photosByItemKey.has(product.id)),
      ),
    [draft, effectiveProducts, pendingPhotos.photosByItemKey],
  )

  const hasHiddenPhotoAtQuantityZero = hiddenSelectedProducts.some(
    (product) =>
      (draft[product.id]?.quantity ?? 0) === 0 &&
      pendingPhotos.photosByItemKey.has(product.id),
  )

  const groupedSelectedProducts = useMemo(
    () =>
      categories
        .map((category) => ({
          category,
          items: effectiveProducts.filter(
            (product) =>
              product.categoryId === category.id &&
              (draft[product.id]?.quantity ?? 0) > 0,
          ),
        }))
        .filter((group) => group.items.length > 0),
    [draft, effectiveProducts],
  )

  const applyChangeResult = (
    result: DraftChangeResult<RequestDraftData>,
    urlMessage?: string,
  ) => {
    setLimitMessage(
      result.reason === 'url-limit' && urlMessage
        ? urlMessage
        : getLimitMessage(result.reason),
    )
  }

  const handleIncrease = (productId: string) => {
    const currentQuantity = draft[productId]?.quantity ?? 0
    const result = changeQuantity(productId, 1)
    applyChangeResult(
      result,
      currentQuantity === 0
        ? 'この商品を追加すると、LINEで送れるデータ量を超えます。条件を短くしてから追加してください。'
        : undefined,
    )
  }

  const handleDecrease = (productId: string) => {
    applyChangeResult(changeQuantity(productId, -1))
  }

  const handleConditionCommit = (
    productId: string,
    value: string,
  ): CommitTextResult => {
    const result = changeCondition(productId, value)
    applyChangeResult(result)
    return {
      value: result.value.draft[productId]?.memo ?? '',
      accepted: result.accepted,
      reason: result.reason,
    }
  }

  const openCustomForm = (index?: number) => {
    if (typeof index === 'number') {
      const item = customItems[index]
      if (!item) {
        return
      }
      openExistingCustomForm(index, item)
    } else {
      openNewCustomForm()
    }
    setLimitMessage('')
  }

  const pendingCustomItem = (
    overrides: Partial<CustomItem> = {},
  ): CustomItem => ({
    id:
      editingCustomIndex === null
        ? 'custom-preview'
        : customItems[editingCustomIndex]?.id ?? 'custom-preview',
    name: customName,
    quantity: customQuantity,
    unit: customUnit,
    memo: customMemo,
    ...overrides,
  })

  const previewCustomItem = (item: CustomItem) =>
    previewDraftCustomItem(item, editingCustomIndex)

  const applyPendingTextChange = (
    field: 'name' | 'unit' | 'memo',
    proposedValue: string,
    limit: number,
    fieldReason: DraftLimitReason,
  ): CommitTextResult => {
    const currentValue =
      field === 'name' ? customName : field === 'unit' ? customUnit : customMemo
    const fieldLimited = truncateUserCharacters(proposedValue, limit)
    const characters = splitUserCharacters(fieldLimited)
    let acceptedValue: string | undefined
    let rejectedReason: DraftLimitReason | undefined

    for (let length = characters.length; length >= 0; length -= 1) {
      const value = characters.slice(0, length).join('')
      const item = pendingCustomItem({ [field]: value })
      if (!item.name.trim()) {
        acceptedValue = value
        break
      }
      const result = previewCustomItem(item)
      if (result.accepted) {
        acceptedValue = value
        break
      }
      rejectedReason = result.reason
    }

    if (typeof acceptedValue === 'undefined') {
      const reason = rejectedReason ?? 'url-limit'
      setLimitMessage(getLimitMessage(reason))
      return { value: currentValue, accepted: false, reason }
    }

    if (field === 'name') {
      setCustomName(acceptedValue)
    } else if (field === 'unit') {
      setCustomUnit(acceptedValue)
    } else {
      setCustomMemo(acceptedValue)
    }

    const wasUrlLimited = acceptedValue !== fieldLimited
    const wasFieldLimited = fieldLimited !== proposedValue
    const reason = wasUrlLimited
      ? rejectedReason ?? 'url-limit'
      : wasFieldLimited
        ? fieldReason
        : undefined
    setLimitMessage(getLimitMessage(reason))
    return {
      value: acceptedValue,
      accepted: acceptedValue !== currentValue,
      reason,
    }
  }

  const handleCustomQuantityChange = (value: unknown) => {
    const quantity = normalizeCustomQuantity(value)
    const item = pendingCustomItem({ quantity })
    if (item.name.trim()) {
      const preview = previewCustomItem(item)
      if (!preview.accepted) {
        setLimitMessage(getLimitMessage(preview.reason))
        return
      }
    }
    setCustomQuantity(quantity)
    const numericValue = typeof value === 'number' ? value : Number(value)
    setLimitMessage(
      !Number.isFinite(numericValue) ||
        !Number.isInteger(numericValue) ||
        numericValue < 1 ||
        numericValue > MAX_ITEM_QUANTITY
        ? getLimitMessage('quantity-limit')
        : '',
    )
  }

  const handleSaveCustomItem = () => {
    const item = {
      id:
        editingCustomIndex === null
          ? createId('custom')
          : customItems[editingCustomIndex]?.id ?? createId('custom'),
      name: customName,
      quantity: customQuantity,
      unit: customUnit,
      memo: customMemo,
    }
    const result = saveCustomItem(item, editingCustomIndex)
    applyChangeResult(result)
    if (result.accepted) {
      closeCustomForm()
    }
  }

  const handleDeleteCustomItem = (index: number) => {
    const item = customItems[index]
    const result = deleteCustomItem(index)
    applyChangeResult(result)
    if (result.accepted && item) {
      pendingPhotos.removePhoto(toStableCustomProductId(item.id))
      handleCustomItemDeleted(index)
    }
  }

  const handleApplyHandwritingSelections = (
    selections: readonly HandwritingImportSelection[],
  ) => {
    const result = applyDraftChange((current) =>
      applyHandwritingImportSelections(current, selections, budgetContext),
    )
    if (result.accepted) {
      setLimitMessage('')
    } else {
      setLimitMessage(
        result.reason === 'invalid-selection'
          ? ''
          : getLimitMessage(result.reason),
      )
    }
    return result
  }

  const handleReturnToEdit = () => {
    setShareMessage('')
    setShareStatus('')
    setMode('edit')
  }

  const resetRequest = (nextDraft: CreateDraftState) => {
    resetDraft(nextDraft)
    setExpandedProductIds(new Set())
    setMode('edit')
    resetSharing()
    setLimitMessage('')
    setRequestKey(createRequestKey())
    pendingPhotos.clearPhotos()
    closeCustomForm()
  }

  const handleStartNext = () => {
    if (isSharingActive() || pendingPhotos.processingItemKey) {
      return
    }
    if (
      !window.confirm(
        '今回の選択をリセットして、新しいリストを作ります。\n商品に登録されている初期条件は引き継ぎます。\n今回だけ追加した商品・写真は引き継ぎません。',
      )
    ) {
      return
    }
    resetRequest(createDraftState(undefined, effectiveProducts))
  }

  const handleReset = () => {
    if (isSharingActive() || pendingPhotos.processingItemKey) {
      return
    }
    if (
      hasResettableInput &&
      !window.confirm('条件も含めて入力内容をすべて消去しますか？')
    ) {
      return
    }

    resetRequest(createEmptyDraftState(effectiveProducts))
  }

  const renderPhotoAttachment = (
    itemKey: string,
    name: string,
    selected: boolean,
  ) =>
    photoConfig.enabled ? (
      <ProductPhotoAttachment
        itemName={name}
        selected={selected}
        photo={pendingPhotos.photosByItemKey.get(itemKey)}
        photoCount={pendingPhotos.photos.length}
        processing={pendingPhotos.processingItemKey === itemKey}
        disabled={Boolean(
          pendingPhotos.processingItemKey &&
            pendingPhotos.processingItemKey !== itemKey,
        )}
        errorMessage={pendingPhotos.errorsByItemKey.get(itemKey)}
        onSelect={(file) => void pendingPhotos.selectPhoto(itemKey, file)}
        onRemove={() => pendingPhotos.removePhoto(itemKey)}
      />
    ) : null

  const renderEdit = () => (
    <>
      <section className="top-bar">
        <button type="button" className="ghost-button" onClick={onBackHome}>
          戻る
        </button>
        <div>
          <p className="eyebrow">依頼作成</p>
          <h1>商品を選ぶ</h1>
        </div>
      </section>

      <section className="info-card">
        <p className="helper-text">
          商品はリストから数量で選びます。共有時は数量が1以上のものだけ送られます。
        </p>
      </section>

      {liveConfig.enabled ? (
        <RequestSharingModeSection
          value={sharingMode}
          onChange={(nextMode) => {
            setSharingMode(nextMode)
            setShareMessage('')
            setShareStatus('')
          }}
        />
      ) : null}

      {showRequestLimitNotice ? (
        <RequestLimitNotice
          hasError={hasRequestLimitError}
          isConditionWarning={isConditionLimitWarning}
          isShareUrlOverLimit={isShareUrlOverLimit}
          isShareUrlWarning={isShareUrlLimitWarning}
          limitMessage={limitMessage}
          shareUrlLength={currentBudget?.urlLength}
          totalConditionCharacters={totalConditionCharacters}
        />
      ) : null}

      <HandwritingImportSection
        config={handwritingConfig}
        effectiveProducts={effectiveProducts}
        onApplySelections={handleApplyHandwritingSelections}
        importProvider={handwritingImportProvider}
        preprocessImage={preprocessHandwritingImage}
      />

      <CustomItemsSection
        customItems={customItems}
        customMemo={customMemo}
        customName={customName}
        customQuantity={customQuantity}
        customUnit={customUnit}
        editingCustomIndex={editingCustomIndex}
        isCustomDetailsOpen={isCustomDetailsOpen}
        isCustomFormOpen={isCustomFormOpen}
        onCancel={closeCustomForm}
        onDelete={handleDeleteCustomItem}
        onMemoCommit={(value) =>
          applyPendingTextChange(
            'memo',
            value,
            MAX_ITEM_CONDITION_CHARS,
            'item-condition-limit',
          )
        }
        onNameCommit={(value) =>
          applyPendingTextChange(
            'name',
            value,
            MAX_CUSTOM_ITEM_NAME_CHARS,
            'custom-name-limit',
          )
        }
        onOpenForm={openCustomForm}
        onQuantityChange={handleCustomQuantityChange}
        onSave={handleSaveCustomItem}
        onToggleDetails={toggleCustomDetails}
        onUnitCommit={(value) =>
          applyPendingTextChange(
            'unit',
            value,
            MAX_CUSTOM_ITEM_UNIT_CHARS,
            'custom-unit-limit',
          )
        }
        renderPhotoAttachment={(item) =>
          renderPhotoAttachment(
            toStableCustomProductId(item.id),
            item.name,
            item.quantity > 0,
          )
        }
      />

      <ProductSearch
        query={searchQuery}
        isSearching={Boolean(normalizeProductSearch(searchQuery))}
        resultCount={groupedProducts.reduce((total, group) => total + group.items.length, 0)}
        canAddCustom={!isCustomFormOpen && customItems.length < MAX_CUSTOM_ITEMS}
        onQueryChange={setSearchQuery}
        onAddCustom={() => {
          if (isCustomFormOpen || customItems.length >= MAX_CUSTOM_ITEMS) return
          focusCustomNameRef.current = true
          openCustomForm()
          applyPendingTextChange('name', searchQuery.trim(), MAX_CUSTOM_ITEM_NAME_CHARS, 'custom-name-limit')
        }}
      />

      <ProductSelectionSections
        draft={draft}
        expandedProductIds={expandedProductIds}
        groups={groupedProducts}
        onConditionCommit={handleConditionCommit}
        onDecrease={handleDecrease}
        onIncrease={handleIncrease}
        onToggleDetails={(productId) =>
          setExpandedProductIds((current) =>
            toggleExpandedProductId(current, productId),
          )
        }
        renderPhotoAttachment={(product) =>
          renderPhotoAttachment(
            product.id,
            product.name,
            (draft[product.id]?.quantity ?? 0) > 0,
          )
        }
      />

      <HiddenSelectedProductsSection
        products={hiddenSelectedProducts}
        draft={draft}
        expandedProductIds={expandedProductIds}
        onConditionCommit={handleConditionCommit}
        onDecrease={handleDecrease}
        onIncrease={handleIncrease}
        onToggleDetails={(productId) =>
          setExpandedProductIds((current) =>
            toggleExpandedProductId(current, productId),
          )
        }
        renderPhotoAttachment={(product) =>
          renderPhotoAttachment(
            product.id,
            product.name,
            (draft[product.id]?.quantity ?? 0) > 0,
          )
        }
        hasRetainedPhotoAtQuantityZero={hasHiddenPhotoAtQuantityZero}
      />

      <CreateRequestBottomActions
        selectedCount={selectedCount}
        onReset={handleReset}
        onStartNext={handleStartNext}
        isBusy={
          isSharingRequest ||
          isUploadingPhotos ||
          Boolean(pendingPhotos.processingItemKey)
        }
        onReview={() => setMode('review')}
        reviewDisabled={Boolean(pendingPhotos.processingItemKey)}
        reviewDisabledMessage="写真の圧縮が終わるまでお待ちください。"
      />
    </>
  )

  const renderReview = () => (
    <RequestReviewView
      customItems={customItems}
      draft={draft}
      groupedSelectedProducts={groupedSelectedProducts}
      isSharingRequest={isSharingRequest}
      onReturnToEdit={handleReturnToEdit}
      onShareRequest={handleShareRequest}
      selectedCount={selectedCount}
      shareMessage={shareMessage}
      shareStatus={shareStatus}
      photos={activePhotos}
      isUploadingPhotos={isUploadingPhotos}
      photoUploadFailed={photoUploadFailed}
      onShareWithoutPhotos={handleShareWithoutPhotos}
      sharingMode={sharingMode}
      managementUrl={
        sharingMode === 'live' &&
        sharedUrl.includes('#/r/') &&
        liveManagementSnapshot ===
          createRequestShareSnapshot(currentRequestSnapshot, activePhotos)
          ? liveManagementUrl
          : undefined
      }
      managementCopyMessage={managementCopyMessage}
      onCopyManagementUrl={handleCopyManagementUrl}
    />
  )

  return (
    <main className={`page ${mode === 'edit' ? 'page-with-bottom-bar' : ''}`}>
      {mode === 'edit' ? renderEdit() : null}
      {mode === 'review' ? renderReview() : null}
      {photoConfig.enabled ? (
        <div
          ref={photoTurnstileContainerRef}
          className="product-photo-turnstile"
          aria-label="写真共有の認証確認"
        />
      ) : null}
      {liveConfig.enabled ? (
        <div
          ref={liveTurnstileContainerRef}
          className="live-request-turnstile"
          aria-label="更新可能な依頼作成の認証確認"
        />
      ) : null}
    </main>
  )
}
