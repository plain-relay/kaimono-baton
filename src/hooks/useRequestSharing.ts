import { useRef, useState } from 'react'
import type { RequestSharingMode } from '../components/RequestSharingModeSection'
import { FIXED_REQUEST_TITLE } from '../constants/request'
import type { LiveRequestConfig } from '../features/liveRequests/config'
import { getLiveRequestFailureMessage } from '../features/liveRequests/sharePreparation'
import type { LiveRequestApi } from '../features/liveRequests/types'
import { useLiveRequestCreation } from '../features/liveRequests/useLiveRequestCreation'
import type { ProductPhotoConfig } from '../features/productPhotos/config'
import type { ProductPhotoUploadProvider } from '../features/productPhotos/ProductPhotoUploadProvider'
import type { PendingPhoto } from '../features/productPhotos/types'
import type { PendingProductPhotosController } from '../features/productPhotos/usePendingProductPhotos'
import { useProductPhotoSharing } from '../features/productPhotos/useProductPhotoSharing'
import { createRequestKey } from '../utils/compactRequest'
import { buildCompactRequestV4UrlFromInput } from '../utils/compactRequestV4'
import { saveCreateRequestReturnState, type CreateRequestReturnState } from '../utils/createRequestReturnState'
import { resolveSharedRequestUrl } from '../utils/createRequestState'
import { buildLineDeliveryRequestUrl } from '../utils/lineDeliveryUrl'
import { validateDraftLimits, type RequestBudgetContext, type RequestDraftData } from '../utils/requestBudget'
import { getLimitMessage, getShareResultMessage, type ShareMessageStatus } from '../utils/requestNoticeMessages'
import { buildRequestShareMessage, REQUEST_SHARE_TITLE } from '../utils/requestShareMessage'
import type { SelectedRequestItem } from '../utils/selectedRequestItems'
import { createRequestShareLock, createRequestShareSnapshot, isRequestUrlWithinShareLimit } from '../utils/shareRequest'
import { shareText } from '../utils/shareText'
import { loadLastSharedUrl, saveCreateDraft, saveLastSharedUrl } from '../utils/storage'

type SharingOptions = {
  initialPageState: { returnState?: CreateRequestReturnState; wasNormalized: boolean }
  requestData: RequestDraftData
  budgetContext: RequestBudgetContext
  requestKey: string
  setRequestKey: (key: string) => void
  currentRequestSnapshot: string
  selectedItems: SelectedRequestItem[]
  activePhotos: readonly PendingPhoto[]
  pendingPhotos: PendingProductPhotosController
  expandedProductIds: Set<string>
  validationRequestBaseUrl: string
  manualValidationSessionToken?: string
  photoConfig: ProductPhotoConfig
  productPhotoUploadProvider?: ProductPhotoUploadProvider
  liveConfig: LiveRequestConfig
  liveRequestApi?: LiveRequestApi
  createLiveRequestItemId?: () => string
}

export function useRequestSharing(options: SharingOptions) {
  const {
    initialPageState,
    requestData,
    budgetContext,
    requestKey,
    setRequestKey,
    currentRequestSnapshot,
    selectedItems,
    activePhotos,
    pendingPhotos,
    expandedProductIds,
    validationRequestBaseUrl,
    manualValidationSessionToken,
  } = options
  const {draft, customItems} = requestData
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

  const [isSharingRequest, setIsSharingRequest] = useState(false)
  const [sharingMode, setSharingMode] = useState<RequestSharingMode>('fixed')
  const shareLockRef = useRef(createRequestShareLock())
  const photoSharing = useProductPhotoSharing({
    photoConfig: options.photoConfig,
    productPhotoUploadProvider: options.productPhotoUploadProvider,
    pendingPhotos,
    setShareMessage,
    setShareStatus,
  })
  const {uploadPhotosForShare, setPhotoUploadFailed} = photoSharing
  const liveCreation = useLiveRequestCreation(options)
  const prepareRequestShare = (withoutPhotos = false) => {
    const validation = validateDraftLimits(requestData, budgetContext, true)
    if (!validation.valid) {
      setShareMessage(getLimitMessage(validation.reason))
      setShareStatus('error')
      return undefined
    }

    const photos = withoutPhotos ? [] : activePhotos
    const snapshot = createRequestShareSnapshot(currentRequestSnapshot, photos)

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

  const prepareLiveRequestShare = (withoutPhotos = false) => {
    const validation = validateDraftLimits(requestData, budgetContext, true)
    if (!validation.valid) {
      setShareMessage(getLimitMessage(validation.reason))
      setShareStatus('error')
      return undefined
    }
    const photos = withoutPhotos ? [] : activePhotos
    const snapshot = createRequestShareSnapshot(currentRequestSnapshot, photos)
    return {
      photos,
      ...liveCreation.prepare(snapshot, sharedUrl, sharedSnapshot),
    }
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
    try {
      if (!prepared.reused) {
        purchaserUrl = await liveCreation.create(prepared, selectedItems, validationRequestBaseUrl)
        setSharedUrl(purchaserUrl)
        setSharedSnapshot(prepared.snapshot)
        setLastSharedUrl(purchaserUrl)
        saveLastSharedUrl(manualValidationSessionToken ? '' : purchaserUrl)
      }
    } catch (error) {
      setShareMessage(error instanceof Error ? error.message : getLiveRequestFailureMessage(error))
      setShareStatus('error')
      return
    }
    saveCreateDraft(draft)
    saveCreateRequestReturnState({
      customItems: [...customItems],
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
        customItems: [...customItems],
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


  const resetSharing = () => {
    setSharedUrl('')
    setSharedSnapshot('')
    setLastSharedUrl('')
    saveLastSharedUrl('')
    setShareMessage('')
    setShareStatus('')
    setPhotoUploadFailed(false)
    setSharingMode('fixed')
    liveCreation.resetLiveRequest()
  }
  return {
    sharedUrl,
    lastSharedUrl,
    shareMessage,
    shareStatus,
    setShareMessage,
    setShareStatus,
    sharingMode,
    setSharingMode,
    isSharingRequest,
    isUploadingPhotos: photoSharing.isUploadingPhotos,
    photoUploadFailed: photoSharing.photoUploadFailed,
    photoTurnstileContainerRef: photoSharing.photoTurnstileContainerRef,
    liveTurnstileContainerRef: liveCreation.liveTurnstileContainerRef,
    liveManagementUrl: liveCreation.liveManagementUrl,
    liveManagementSnapshot: liveCreation.liveManagementSnapshot,
    managementCopyMessage: liveCreation.managementCopyMessage,
    handleCopyManagementUrl: liveCreation.handleCopyManagementUrl,
    handleShareRequest,
    handleShareWithoutPhotos,
    resetSharing,
    isSharingActive: shareLockRef.current.isActive,
  }
}
