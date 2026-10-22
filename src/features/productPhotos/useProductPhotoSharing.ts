import { useEffect, useRef, useState } from 'react'
import type { ShareMessageStatus } from '../../utils/requestNoticeMessages'
import { BrowserTurnstileTokenProvider } from '../handwriting/turnstile'
import type { ProductPhotoConfig } from './config'
import { PRODUCT_PHOTO_TURNSTILE_ACTION, ProductPhotoUploadError, WorkerProductPhotoUploadProvider, type ProductPhotoClientDiagnosticStage, type ProductPhotoUploadProvider } from './ProductPhotoUploadProvider'
import type { PendingPhoto } from './types'
import type { PendingProductPhotosController } from './usePendingProductPhotos'

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

export function useProductPhotoSharing({ photoConfig, productPhotoUploadProvider, pendingPhotos, setShareMessage, setShareStatus }: {
  photoConfig: ProductPhotoConfig
  productPhotoUploadProvider?: ProductPhotoUploadProvider
  pendingPhotos: PendingProductPhotosController
  setShareMessage: (message: string) => void
  setShareStatus: (status: ShareMessageStatus) => void
}) {
  const [isUploadingPhotos, setIsUploadingPhotos] = useState(false)
  const [photoUploadFailed, setPhotoUploadFailed] = useState(false)
  const [defaultPhotoUploader, setDefaultPhotoUploader] = useState<ProductPhotoUploadProvider>()
  const photoClientStageRef = useRef<ProductPhotoClientDiagnosticStage>()
  const photoTurnstileContainerRef = useRef<HTMLDivElement>(null)
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

  const uploadPhotosForShare = async (
    photos: readonly PendingPhoto[],
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


  return { isUploadingPhotos, photoUploadFailed, setPhotoUploadFailed, photoTurnstileContainerRef, uploadPhotosForShare }
}
