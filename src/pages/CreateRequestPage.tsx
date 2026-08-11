import { useEffect, useMemo, useRef, useState } from 'react'
import { categories } from '../data/categories'
import { FIXED_REQUEST_TITLE } from '../constants/request'
import type { CreateDraftState } from '../types/shopping'
import type { CommitTextResult } from '../components/ImeAwareTextInput'
import { CreateRequestBottomActions } from '../components/CreateRequestBottomActions'
import { CustomItemsSection } from '../components/CustomItemsSection'
import { ProductSelectionSections } from '../components/ProductSelectionSections'
import { RequestLimitNotice } from '../components/RequestLimitNotice'
import { RequestReviewView } from '../components/RequestReviewView'
import { HiddenSelectedProductsSection } from '../components/HiddenSelectedProductsSection'
import {
  loadCreateDraft,
  loadLastSharedUrl,
  saveCreateDraft,
  saveLastSharedUrl,
} from '../utils/storage'
import { createId } from '../utils/id'
import {
  createEmptyDraftState,
  createRequestContentSnapshot,
  createInitialCreateRequestState,
  hasAnyCreateRequestInput,
  resolveSharedRequestUrl,
  toggleExpandedProductId,
} from '../utils/createRequestState'
import {
  applyConditionChange,
  applyCustomItemAdd,
  applyCustomItemDelete,
  applyCustomItemUpdate,
  applyQuantityChange,
  normalizeCustomQuantity,
  normalizeRequestDraftData,
  type DraftChangeResult,
} from '../utils/draftLimits'
import {
  calculateRequestBudget,
  countTotalConditionCharacters,
  isShareUrlWarning,
  isTotalConditionWarning,
  validateDraftLimits,
  type CustomRequestDraftItem,
  type DraftLimitReason,
  type RequestBudgetContext,
  type RequestDraftData,
} from '../utils/requestBudget'
import {
  MAX_CUSTOM_ITEM_NAME_CHARS,
  MAX_CUSTOM_ITEM_UNIT_CHARS,
  MAX_ITEM_CONDITION_CHARS,
  MAX_ITEM_QUANTITY,
  MAX_SHARE_URL_LENGTH,
} from '../constants/requestLimits'
import {
  splitUserCharacters,
  truncateUserCharacters,
} from '../utils/textLength'
import { createRequestKey } from '../utils/compactRequest'
import {
  buildRequestShareMessage,
  REQUEST_SHARE_TITLE,
} from '../utils/requestShareMessage'
import {
  createRequestShareLock,
  isRequestUrlWithinShareLimit,
} from '../utils/shareRequest'
import { shareText } from '../utils/shareText'
import { buildLineDeliveryRequestUrl } from '../utils/lineDeliveryUrl'
import {
  clearCreateRequestReturnState,
  loadCreateRequestReturnState,
  saveCreateRequestReturnState,
  type CreateRequestReturnState,
} from '../utils/createRequestReturnState'
import {
  getLimitMessage,
  getShareResultMessage,
  type ShareMessageStatus,
} from '../utils/requestNoticeMessages'
import { useCustomItemEditor } from '../hooks/useCustomItemEditor'
import { useHouseholdCatalog } from '../hooks/useHouseholdCatalog'
import type { EffectiveProduct } from '../types/householdCatalog'
import { buildSelectedRequestItems } from '../utils/selectedRequestItems'
import { toStableCustomProductId } from '../utils/selectedRequestItems'
import { HandwritingImportSection } from '../features/handwriting/HandwritingImportSection'
import {
  getHandwritingImportConfig,
  type HandwritingImportConfig,
} from '../features/handwriting/config'
import {
  applyHandwritingImportSelections,
} from '../features/handwriting/applyImport'
import type {
  HandwritingImportProvider,
  HandwritingImportSelection,
} from '../features/handwriting/types'
import type {
  ImagePreprocessOptions,
} from '../features/handwriting/imagePreprocessing'
import {
  getProductPhotoConfig,
  type ProductPhotoConfig,
} from '../features/productPhotos/config'
import {
  PRODUCT_PHOTO_TURNSTILE_ACTION,
  ProductPhotoUploadError,
  WorkerProductPhotoUploadProvider,
  type ProductPhotoClientDiagnosticStage,
  type ProductPhotoUploadProvider,
} from '../features/productPhotos/ProductPhotoUploadProvider'
import {
  processProductPhoto as defaultProcessProductPhoto,
  type ProcessedProductPhoto,
} from '../features/productPhotos/imageProcessing'
import { usePendingProductPhotos } from '../features/productPhotos/usePendingProductPhotos'
import { ProductPhotoAttachment } from '../features/productPhotos/ProductPhotoAttachment'
import { BrowserTurnstileTokenProvider } from '../features/handwriting/turnstile'
import { buildCompactRequestV4UrlFromInput } from '../utils/compactRequestV4'
import {
  RequestSharingModeSection,
  type RequestSharingMode,
} from '../components/RequestSharingModeSection'
import {
  LIVE_REQUEST_CREATE_TURNSTILE_ACTION,
  LiveRequestApiError,
  WorkerLiveRequestApi,
} from '../features/liveRequests/api'
import {
  getLiveRequestConfig,
  type LiveRequestConfig,
} from '../features/liveRequests/config'
import {
  buildLiveRequestItems,
  buildLiveRequestUrls,
} from '../features/liveRequests/createItems'
import type { LiveRequestApi } from '../features/liveRequests/types'
import { addManualValidationSessionToBaseUrl } from '../features/manualValidation/session'

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

function productPhotoUploadErrorMessage(
  error: unknown,
  clientStage?: ProductPhotoClientDiagnosticStage,
): string {
  if (!(error instanceof ProductPhotoUploadError)) {
    return '写真を保存できませんでした。再試行するか、写真を外して共有してください。'
  }
  const message = (() => {
    switch (error.code) {
      case 'auth-failed':
        return '写真保存の認証確認に失敗しました。もう一度お試しください。'
      case 'validation-session-invalid':
        return '限定検証セッションを確認できませんでした。検証URLを開き直してください。'
      case 'validation-session-expired':
        return '限定検証セッションの有効期限が切れています。'
      case 'origin-not-allowed':
        return '写真保存への接続元を確認できませんでした。通常の商品選択は引き続き利用できます。'
      case 'invalid-photo':
        return '写真の形式または容量を確認できませんでした。別の写真を選んでください。'
      case 'limit-reached':
        return '写真保存の無料枠または容量上限に達した可能性があります。再試行するか、写真を外して共有してください。'
      case 'network-failed':
        return '写真保存サービスへ接続できませんでした。通信状態を確認して、もう一度お試しください。'
      case 'timeout':
        return '写真の保存が時間内に完了しませんでした。再試行するか、写真を外して共有してください。'
      default:
        return '写真保存サービスで問題が発生しました。再試行するか、写真を外して共有してください。'
    }
  })()
  const classification = ` エラー分類: ${error.code}`
  const stage =
    !error.requestId &&
    (error.code === 'auth-failed' || error.code === 'network-failed') &&
    clientStage
      ? ` 処理段階: ${clientStage}`
      : ''
  const requestId = error.requestId
    ? ` 問い合わせID: ${error.requestId}`
    : ''
  return `${message}${classification}${stage}${requestId}`
}

type CreateMode = 'edit' | 'review'

type CustomItem = CustomRequestDraftItem

type InitialPageState = {
  draft: CreateDraftState
  expandedProductIds: Set<string>
  customItems: CustomItem[]
  returnState?: CreateRequestReturnState
  wasNormalized: boolean
}

function createInitialPageState(
  effectiveProducts: readonly EffectiveProduct[],
): InitialPageState {
  const returnState = loadCreateRequestReturnState()
  const initialDraft = createInitialCreateRequestState(
    loadCreateDraft(),
    effectiveProducts,
  )
  const normalized = normalizeRequestDraftData({
    title: FIXED_REQUEST_TITLE,
    draft: initialDraft.draft,
    customItems: returnState?.customItems ?? [],
    effectiveProducts,
  })

  return {
    draft: normalized.value.draft,
    expandedProductIds: new Set(
      returnState?.expandedProductIds ?? initialDraft.expandedProductIds,
    ),
    customItems: [...normalized.value.customItems],
    returnState,
    wasNormalized: initialDraft.wasNormalized || normalized.normalized,
  }
}

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
  const [initialPageState] = useState(() =>
    createInitialPageState(effectiveProducts),
  )
  const [draft, setDraft] = useState<CreateDraftState>(initialPageState.draft)
  const [expandedProductIds, setExpandedProductIds] = useState<Set<string>>(
    initialPageState.expandedProductIds,
  )
  const [mode, setMode] = useState<CreateMode>(
    initialPageState.returnState ? 'review' : 'edit',
  )
  const [sharedUrl, setSharedUrl] = useState(
    initialPageState.returnState?.sharedUrl ?? '',
  )
  const [sharedSnapshot, setSharedSnapshot] = useState(
    initialPageState.returnState?.sharedSnapshot ?? '',
  )
  const [lastSharedUrl, setLastSharedUrl] = useState(loadLastSharedUrl)
  const [shareMessage, setShareMessage] = useState(
    initialPageState.wasNormalized
      ? '保存されていた入力を新しい上限内に調整しました。'
      : '',
  )
  const [shareStatus, setShareStatus] = useState<ShareMessageStatus>(
    initialPageState.wasNormalized ? 'cancelled' : '',
  )
  const [limitMessage, setLimitMessage] = useState('')
  const [customItems, setCustomItems] = useState<CustomItem[]>(
    initialPageState.customItems,
  )
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
  const [requestKey, setRequestKey] = useState(createRequestKey)
  const [isSharingRequest, setIsSharingRequest] = useState(false)
  const [isUploadingPhotos, setIsUploadingPhotos] = useState(false)
  const [photoUploadFailed, setPhotoUploadFailed] = useState(false)
  const [sharingMode, setSharingMode] =
    useState<RequestSharingMode>('fixed')
  const [liveManagementUrl, setLiveManagementUrl] = useState('')
  const [liveManagementSnapshot, setLiveManagementSnapshot] = useState('')
  const [liveRequestExpiresAt, setLiveRequestExpiresAt] = useState<number>()
  const [managementCopyMessage, setManagementCopyMessage] = useState('')
  const [defaultPhotoUploader, setDefaultPhotoUploader] =
    useState<ProductPhotoUploadProvider>()
  const [defaultLiveRequestApi, setDefaultLiveRequestApi] =
    useState<LiveRequestApi>()
  const shareLockRef = useRef(createRequestShareLock())
  const photoClientStageRef = useRef<ProductPhotoClientDiagnosticStage>()
  const photoTurnstileContainerRef = useRef<HTMLDivElement>(null)
  const liveTurnstileContainerRef = useRef<HTMLDivElement>(null)
  const pendingPhotos = usePendingProductPhotos({
    processPhoto: processProductPhoto ?? defaultProcessProductPhoto,
    ...(createProductPhotoPreviewUrl
      ? { createPreviewUrl: createProductPhotoPreviewUrl }
      : {}),
    ...(revokeProductPhotoPreviewUrl
      ? { revokePreviewUrl: revokeProductPhotoPreviewUrl }
      : {}),
  })

  const requestBaseUrl = useMemo(
    () => `${window.location.origin}${window.location.pathname}`,
    [],
  )
  const validationRequestBaseUrl = useMemo(
    () =>
      addManualValidationSessionToBaseUrl(
        requestBaseUrl,
        manualValidationSessionToken,
      ),
    [manualValidationSessionToken, requestBaseUrl],
  )
  const budgetContext = useMemo<RequestBudgetContext>(
    () => ({ baseUrl: requestBaseUrl, requestKey }),
    [requestBaseUrl, requestKey],
  )
  const requestData = useMemo<RequestDraftData>(
    () => ({
      title: FIXED_REQUEST_TITLE,
      draft,
      customItems,
      effectiveProducts,
    }),
    [customItems, draft, effectiveProducts],
  )

  useEffect(() => {
    saveCreateDraft(draft)
  }, [draft])

  useEffect(() => {
    const clearReturnState = () => clearCreateRequestReturnState()

    clearReturnState()
    window.addEventListener('pageshow', clearReturnState)
    return () => window.removeEventListener('pageshow', clearReturnState)
  }, [])

  useEffect(() => {
    if (
      !photoConfig.enabled ||
      productPhotoUploadProvider ||
      !photoTurnstileContainerRef.current
    ) {
      return
    }
    const clientDiagnostics = {
      record(stage: ProductPhotoClientDiagnosticStage) {
        photoClientStageRef.current = stage
      },
    }
    const turnstile = new BrowserTurnstileTokenProvider(
      photoTurnstileContainerRef.current,
      photoConfig.turnstileSiteKey,
      undefined,
      undefined,
      PRODUCT_PHOTO_TURNSTILE_ACTION,
      clientDiagnostics,
    )
    setDefaultPhotoUploader(
      new WorkerProductPhotoUploadProvider(
        photoConfig.endpoint,
        turnstile,
        fetch,
        photoConfig.validationSessionToken,
        clientDiagnostics,
      ),
    )
    return () => turnstile.dispose()
  }, [
    photoConfig.enabled,
    photoConfig.endpoint,
    photoConfig.turnstileSiteKey,
    photoConfig.validationSessionToken,
    productPhotoUploadProvider,
  ])

  useEffect(() => {
    if (
      !liveConfig.enabled ||
      liveRequestApi ||
      !liveTurnstileContainerRef.current
    ) {
      return
    }
    const turnstile = new BrowserTurnstileTokenProvider(
      liveTurnstileContainerRef.current,
      liveConfig.turnstileSiteKey,
      undefined,
      undefined,
      LIVE_REQUEST_CREATE_TURNSTILE_ACTION,
    )
    setDefaultLiveRequestApi(
      new WorkerLiveRequestApi(
        liveConfig.endpoint,
        turnstile,
        fetch,
        liveConfig.validationSessionToken,
      ),
    )
    return () => turnstile.dispose()
  }, [
    liveConfig.enabled,
    liveConfig.endpoint,
    liveConfig.turnstileSiteKey,
    liveConfig.validationSessionToken,
    liveRequestApi,
  ])

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

  const hasResettableInput = useMemo(
    () =>
      pendingPhotos.photos.length > 0 ||
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
            .filter((product) => product.categoryId === category.id)
            .sort((a, b) => a.sortOrder - b.sortOrder),
        }))
        .filter((group) => group.items.length > 0),
    [visibleProducts],
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

  const applyRequestData = (next: RequestDraftData) => {
    setDraft(next.draft)
    setCustomItems([...next.customItems])
  }

  const applyChangeResult = (
    result: DraftChangeResult<RequestDraftData>,
    urlMessage?: string,
  ) => {
    if (result.accepted) {
      applyRequestData(result.value)
    }
    setLimitMessage(
      result.reason === 'url-limit' && urlMessage
        ? urlMessage
        : getLimitMessage(result.reason),
    )
  }

  const handleIncrease = (productId: string) => {
    const currentQuantity = draft[productId]?.quantity ?? 0
    const result = applyQuantityChange(
      requestData,
      productId,
      currentQuantity + 1,
      budgetContext,
    )
    applyChangeResult(
      result,
      currentQuantity === 0
        ? 'この商品を追加すると、LINEで送れるデータ量を超えます。条件を短くしてから追加してください。'
        : undefined,
    )
  }

  const handleDecrease = (productId: string) => {
    const currentQuantity = draft[productId]?.quantity ?? 0
    applyChangeResult(
      applyQuantityChange(
        requestData,
        productId,
        currentQuantity - 1,
        budgetContext,
      ),
    )
  }

  const handleConditionCommit = (
    productId: string,
    value: string,
  ): CommitTextResult => {
    const result = applyConditionChange(
      requestData,
      { kind: 'product', productId },
      value,
      budgetContext,
    )
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
    editingCustomIndex === null
      ? applyCustomItemAdd(requestData, item, budgetContext)
      : applyCustomItemUpdate(
          requestData,
          editingCustomIndex,
          item,
          budgetContext,
        )

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
    const result =
      editingCustomIndex === null
        ? applyCustomItemAdd(requestData, item, budgetContext)
        : applyCustomItemUpdate(
            requestData,
            editingCustomIndex,
            item,
            budgetContext,
          )
    applyChangeResult(result)
    if (result.accepted) {
      closeCustomForm()
    }
  }

  const handleDeleteCustomItem = (index: number) => {
    const item = customItems[index]
    const result = applyCustomItemDelete(requestData, index)
    applyChangeResult(result)
    if (result.accepted && item) {
      pendingPhotos.removePhoto(toStableCustomProductId(item.id))
      handleCustomItemDeleted(index)
    }
  }

  const handleApplyHandwritingSelections = (
    selections: readonly HandwritingImportSelection[],
  ) => {
    const result = applyHandwritingImportSelections(
      requestData,
      selections,
      budgetContext,
    )
    if (result.accepted) {
      applyRequestData(result.value)
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

  const createPhotoSnapshot = (
    photos: readonly { itemKey: string; token: string }[],
  ) =>
    photos.length === 0
      ? currentRequestSnapshot
      : `${currentRequestSnapshot}\nphotos:${JSON.stringify(
          photos
            .map(({ itemKey, token }) => ({ itemKey, token }))
            .sort((left, right) =>
              left.itemKey.localeCompare(right.itemKey),
            ),
        )}`

  const prepareRequestShare = (withoutPhotos = false) => {
    const validation = validateDraftLimits(requestData, budgetContext, true)
    if (!validation.valid) {
      setShareMessage(getLimitMessage(validation.reason))
      setShareStatus('error')
      return undefined
    }

    const photos = withoutPhotos ? [] : activePhotos
    const snapshot = createPhotoSnapshot(photos)

    const reusableSharedUrl = sharedUrl.includes('#/l/')
      ? buildLineDeliveryRequestUrl(sharedUrl)
      : ''
    const resolved = resolveSharedRequestUrl(
      snapshot,
      sharedSnapshot,
      reusableSharedUrl,
      () => {
        if (photos.length === 0) {
          return validation.url
        }
        const itemIndexes = new Map(
          selectedItems.map((item, index) => [item.productId, index]),
        )
        const photoRefs = photos.map((photo) => {
          const itemIndex = itemIndexes.get(photo.itemKey)
          if (typeof itemIndex !== 'number') {
            throw new Error('写真の商品参照が見つかりません。')
          }
          return [itemIndex, photo.token] as [number, string]
        })
        return buildLineDeliveryRequestUrl(
          buildCompactRequestV4UrlFromInput(validationRequestBaseUrl, {
            requestKey,
            title: FIXED_REQUEST_TITLE,
            items: selectedItems,
            photoRefs,
          }),
        )
      },
    )
    if (!isRequestUrlWithinShareLimit(resolved.url)) {
      setShareMessage(getLimitMessage('url-limit'))
      setShareStatus('error')
      return undefined
    }
    return { ...resolved, photos }
  }

  const commitPreparedShare = (prepared: {
    url: string
    snapshot: string
    reused: boolean
  }) => {
    if (!prepared.reused || prepared.url !== sharedUrl) {
      setSharedUrl(prepared.url)
      setSharedSnapshot(prepared.snapshot)
      setLastSharedUrl(prepared.url)
      saveLastSharedUrl(manualValidationSessionToken ? '' : prepared.url)
    }
    if (!prepared.reused) {
      setRequestKey(createRequestKey())
    }
  }

  const uploadPhotosForShare = async (
    photos: readonly (typeof activePhotos)[number][],
  ): Promise<boolean> => {
    if (photos.length === 0) {
      return true
    }
    const uploader = productPhotoUploadProvider ?? defaultPhotoUploader
    if (!uploader) {
      setShareMessage(
        '写真の保存機能を準備できませんでした。通常依頼は引き続き利用できます。',
      )
      setShareStatus('error')
      setPhotoUploadFailed(true)
      return false
    }
    const itemKeys = photos.map((photo) => photo.itemKey)
    photoClientStageRef.current = undefined
    setShareMessage('')
    setShareStatus('')
    setPhotoUploadFailed(false)
    pendingPhotos.setPhotoStatus(itemKeys, 'uploading')
    setIsUploadingPhotos(true)
    try {
      await uploader.upload(photos)
      pendingPhotos.setPhotoStatus(itemKeys, 'uploaded')
      return true
    } catch (error) {
      pendingPhotos.setPhotoStatus(itemKeys, 'failed')
      setPhotoUploadFailed(true)
      setShareStatus('error')
      setShareMessage(
        productPhotoUploadErrorMessage(
          error,
          photoConfig.validationSessionToken
            ? photoClientStageRef.current
            : undefined,
        ),
      )
      return false
    } finally {
      setIsUploadingPhotos(false)
    }
  }

  const prepareLiveRequestShare = (withoutPhotos = false) => {
    const validation = validateDraftLimits(requestData, budgetContext, true)
    if (!validation.valid) {
      setShareMessage(getLimitMessage(validation.reason))
      setShareStatus('error')
      return undefined
    }
    const photos = withoutPhotos ? [] : activePhotos
    const snapshot = createPhotoSnapshot(photos)
    return {
      photos,
      snapshot,
      reused:
        sharedUrl.includes('#/r/') &&
        sharedSnapshot === snapshot &&
        liveManagementUrl.includes('#/manage/') &&
        liveManagementSnapshot === snapshot &&
        typeof liveRequestExpiresAt === 'number' &&
        Date.now() < liveRequestExpiresAt,
      url: sharedUrl,
    }
  }

  const liveRequestFailureMessage = (error: unknown): string => {
    if (error instanceof LiveRequestApiError) {
      switch (error.code) {
        case 'auth-failed':
          return '認証確認に失敗しました。通常依頼は引き続き利用できます。'
        case 'limit-reached':
          return '更新可能な依頼の利用上限に達した可能性があります。通常依頼を利用してください。'
        case 'timeout':
        case 'service-unavailable':
        case 'invalid-response':
          return '更新可能な依頼を作成できませんでした。通常依頼は引き続き利用できます。'
        case 'conflict':
        case 'expired':
        case 'invalid-request':
          return '更新可能な依頼の内容を準備できませんでした。入力を確認してください。'
      }
    }
    return '更新可能な依頼を作成できませんでした。通常依頼は引き続き利用できます。'
  }

  const handleLiveRequestShare = async (withoutPhotos = false) => {
    const prepared = prepareLiveRequestShare(withoutPhotos)
    if (!prepared) {
      return
    }
    setPhotoUploadFailed(false)
    setIsSharingRequest(true)

    if (
      prepared.photos.length > 0 &&
      !prepared.reused &&
      !(await uploadPhotosForShare(prepared.photos))
    ) {
      return
    }

    let purchaserUrl = prepared.url
    if (!prepared.reused) {
      const api = liveRequestApi ?? defaultLiveRequestApi
      if (!api) {
        setShareMessage(
          '更新可能な依頼の認証機能を準備できませんでした。通常依頼は引き続き利用できます。',
        )
        setShareStatus('error')
        return
      }
      try {
        const items = buildLiveRequestItems(
          selectedItems,
          prepared.photos,
          createLiveRequestItemId,
        )
        const created = await api.create(items)
        const urls = buildLiveRequestUrls(
          validationRequestBaseUrl,
          created.requestToken,
          created.editSecret,
        )
        purchaserUrl = buildLineDeliveryRequestUrl(urls.purchaserUrl)
        setLiveManagementUrl(urls.managementUrl)
        setLiveManagementSnapshot(prepared.snapshot)
        setLiveRequestExpiresAt(Date.parse(created.request.expiresAt))
        setManagementCopyMessage('')
        setSharedUrl(purchaserUrl)
        setSharedSnapshot(prepared.snapshot)
        setLastSharedUrl(purchaserUrl)
        saveLastSharedUrl(manualValidationSessionToken ? '' : purchaserUrl)
      } catch (error) {
        setShareMessage(liveRequestFailureMessage(error))
        setShareStatus('error')
        return
      }
    }

    saveCreateDraft(draft)
    saveCreateRequestReturnState({
      customItems,
      expandedProductIds: [...expandedProductIds],
      sharedUrl: manualValidationSessionToken ? '' : purchaserUrl,
      sharedSnapshot: manualValidationSessionToken
        ? ''
        : prepared.snapshot,
    })
    setShareMessage('共有画面を開いています…')
    setShareStatus('cancelled')
    const result = await shareText({
      title: REQUEST_SHARE_TITLE,
      text: buildRequestShareMessage(purchaserUrl),
    })
    const notice = getShareResultMessage(result)
    setShareMessage(notice.message)
    setShareStatus(notice.status)
  }

  const handleShareRequest = async (withoutPhotos = false) => {
    if (!shareLockRef.current.tryAcquire()) {
      return
    }

    try {
      if (sharingMode === 'live') {
        await handleLiveRequestShare(withoutPhotos)
        return
      }
      let prepared: ReturnType<typeof prepareRequestShare>
      try {
        prepared = prepareRequestShare(withoutPhotos)
      } catch {
        setShareMessage('写真付き依頼を準備できませんでした。写真を確認してください。')
        setShareStatus('error')
        return
      }
      if (!prepared) return

      setPhotoUploadFailed(false)
      setIsSharingRequest(true)
      if (
        prepared.photos.length > 0 &&
        !prepared.reused &&
        !(await uploadPhotosForShare(prepared.photos))
      ) {
        return
      }

      commitPreparedShare(prepared)

      saveCreateDraft(draft)
      saveCreateRequestReturnState({
        customItems,
        expandedProductIds: [...expandedProductIds],
        sharedUrl: manualValidationSessionToken ? '' : prepared.url,
        sharedSnapshot: manualValidationSessionToken
          ? ''
          : prepared.snapshot,
      })

      setShareMessage('共有画面を開いています…')
      setShareStatus('cancelled')
      const result = await shareText({
        title: REQUEST_SHARE_TITLE,
        text: buildRequestShareMessage(prepared.url),
      })
      const notice = getShareResultMessage(result)
      setShareMessage(notice.message)
      setShareStatus(notice.status)
    } finally {
      shareLockRef.current.release()
      setIsSharingRequest(false)
    }
  }

  const handleShareWithoutPhotos = async () => {
    pendingPhotos.clearPhotos()
    await handleShareRequest(true)
  }

  const handleCopyManagementUrl = async () => {
    if (!liveManagementUrl || !navigator.clipboard?.writeText) {
      setManagementCopyMessage(
        '管理リンクをコピーできませんでした。選択して安全な場所へ保存してください。',
      )
      return
    }
    try {
      await navigator.clipboard.writeText(liveManagementUrl)
      setManagementCopyMessage('管理リンクをコピーしました。')
    } catch {
      setManagementCopyMessage(
        '管理リンクをコピーできませんでした。選択して安全な場所へ保存してください。',
      )
    }
  }

  const handleReturnToEdit = () => {
    setShareMessage('')
    setShareStatus('')
    setMode('edit')
  }

  const handleReset = () => {
    if (
      hasResettableInput &&
      !window.confirm('入力内容をすべて消去しますか？')
    ) {
      return
    }

    const emptyDraft = createEmptyDraftState(effectiveProducts)
    setDraft(emptyDraft)
    saveCreateDraft(emptyDraft)
    setExpandedProductIds(new Set())
    setMode('edit')
    setSharedUrl('')
    setSharedSnapshot('')
    setLastSharedUrl('')
    saveLastSharedUrl('')
    setShareMessage('')
    setShareStatus('')
    setLimitMessage('')
    setCustomItems([])
    setRequestKey(createRequestKey())
    pendingPhotos.clearPhotos()
    setPhotoUploadFailed(false)
    setSharingMode('fixed')
    setLiveManagementUrl('')
    setLiveManagementSnapshot('')
    setLiveRequestExpiresAt(undefined)
    setManagementCopyMessage('')
    closeCustomForm()
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
        liveManagementSnapshot === createPhotoSnapshot(activePhotos)
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
