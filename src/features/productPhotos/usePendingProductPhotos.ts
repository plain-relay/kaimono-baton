import { useCallback, useEffect, useRef, useState } from 'react'
import {
  processProductPhoto,
  ProductPhotoProcessingError,
  type ProcessedProductPhoto,
} from './imageProcessing'
import { createProductPhotoToken } from './photoToken'
import type { PendingPhoto } from './types'

type ProcessPhoto = (
  file: File,
  options?: { signal?: AbortSignal },
) => Promise<ProcessedProductPhoto>

type PendingPhotoStatus = PendingPhoto['status']

export type PendingProductPhotosController = {
  photos: readonly PendingPhoto[]
  photosByItemKey: ReadonlyMap<string, PendingPhoto>
  errorsByItemKey: ReadonlyMap<string, string>
  processingItemKey?: string
  selectPhoto: (itemKey: string, file: File) => Promise<void>
  removePhoto: (itemKey: string) => void
  removePhotos: (itemKeys: readonly string[]) => void
  clearPhotos: () => void
  setPhotoStatus: (
    itemKeys: readonly string[],
    status: PendingPhotoStatus,
  ) => void
}

type UsePendingProductPhotosOptions = {
  processPhoto?: ProcessPhoto
  createToken?: () => string
  createPreviewUrl?: (blob: Blob) => string
  revokePreviewUrl?: (url: string) => void
}

function defaultCreatePreviewUrl(blob: Blob): string {
  return URL.createObjectURL(blob)
}

function defaultRevokePreviewUrl(url: string): void {
  URL.revokeObjectURL(url)
}

function processingErrorMessage(error: unknown): string {
  if (error instanceof ProductPhotoProcessingError) {
    switch (error.code) {
      case 'unsupported-image':
        return 'この画像形式には対応していません。端末で表示できる写真を選んでください。'
      case 'image-too-large':
        return '写真を500KB以下に圧縮できませんでした。別の写真を選んでください。'
      case 'decode-failed':
        return 'この端末では写真を読み込めませんでした。JPEGまたはPNGをお試しください。'
      default:
        return '写真を準備できませんでした。別の写真を選んでください。'
    }
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return ''
  }
  return '写真を準備できませんでした。別の写真を選んでください。'
}

export function usePendingProductPhotos(
  options: UsePendingProductPhotosOptions = {},
): PendingProductPhotosController {
  const {
    processPhoto = processProductPhoto,
    createToken = createProductPhotoToken,
    createPreviewUrl = defaultCreatePreviewUrl,
    revokePreviewUrl = defaultRevokePreviewUrl,
  } = options
  const [photos, setPhotos] = useState<PendingPhoto[]>([])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [processingItemKey, setProcessingItemKey] = useState<string>()
  const photosRef = useRef<PendingPhoto[]>([])
  const processingControllerRef = useRef<AbortController>()
  const processingItemKeyRef = useRef<string>()

  const commitPhotos = useCallback((next: PendingPhoto[]) => {
    photosRef.current = next
    setPhotos(next)
  }, [])

  const revokePhoto = useCallback(
    (photo: PendingPhoto | undefined) => {
      if (photo) {
        revokePreviewUrl(photo.previewUrl)
      }
    },
    [revokePreviewUrl],
  )

  const cancelProcessing = useCallback(
    (itemKeys?: ReadonlySet<string>) => {
      const controller = processingControllerRef.current
      const itemKey = processingItemKeyRef.current
      if (
        !controller ||
        !itemKey ||
        (itemKeys && !itemKeys.has(itemKey))
      ) {
        return
      }
      controller.abort()
      processingControllerRef.current = undefined
      processingItemKeyRef.current = undefined
      setProcessingItemKey(undefined)
    },
    [],
  )

  const removePhotos = useCallback(
    (itemKeys: readonly string[]) => {
      const keys = new Set(itemKeys)
      cancelProcessing(keys)
      const next: PendingPhoto[] = []
      for (const photo of photosRef.current) {
        if (keys.has(photo.itemKey)) {
          revokePhoto(photo)
        } else {
          next.push(photo)
        }
      }
      commitPhotos(next)
      setErrors((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([key]) => !keys.has(key)),
        ),
      )
    },
    [cancelProcessing, commitPhotos, revokePhoto],
  )

  const removePhoto = useCallback(
    (itemKey: string) => removePhotos([itemKey]),
    [removePhotos],
  )

  const clearPhotos = useCallback(() => {
    cancelProcessing()
    for (const photo of photosRef.current) {
      revokePhoto(photo)
    }
    commitPhotos([])
    setErrors({})
  }, [cancelProcessing, commitPhotos, revokePhoto])

  const selectPhoto = useCallback(
    async (itemKey: string, file: File) => {
      if (
        processingControllerRef.current ||
        (!photosRef.current.some((photo) => photo.itemKey === itemKey) &&
          photosRef.current.length >= 3)
      ) {
        return
      }

      const controller = new AbortController()
      processingControllerRef.current = controller
      processingItemKeyRef.current = itemKey
      setProcessingItemKey(itemKey)
      setErrors((current) => ({ ...current, [itemKey]: '' }))
      try {
        const processed = await processPhoto(file, {
          signal: controller.signal,
        })
        if (controller.signal.aborted) {
          return
        }
        const previewUrl = createPreviewUrl(processed.blob)
        let nextPhoto: PendingPhoto
        try {
          nextPhoto = {
            itemKey,
            token: createToken(),
            blob: processed.blob,
            previewUrl,
            width: processed.width,
            height: processed.height,
            bytes: processed.bytes,
            status: 'local',
          }
        } catch (error) {
          revokePreviewUrl(previewUrl)
          throw error
        }
        const existing = photosRef.current.find(
          (photo) => photo.itemKey === itemKey,
        )
        revokePhoto(existing)
        commitPhotos([
          ...photosRef.current.filter(
            (photo) => photo.itemKey !== itemKey,
          ),
          nextPhoto,
        ])
      } catch (error) {
        if (controller.signal.aborted) {
          return
        }
        const message = processingErrorMessage(error)
        if (message) {
          setErrors((current) => ({ ...current, [itemKey]: message }))
        }
      } finally {
        if (processingControllerRef.current === controller) {
          processingControllerRef.current = undefined
          processingItemKeyRef.current = undefined
          setProcessingItemKey(undefined)
        }
      }
    },
    [commitPhotos, createPreviewUrl, createToken, processPhoto, revokePhoto],
  )

  const setPhotoStatus = useCallback(
    (itemKeys: readonly string[], status: PendingPhotoStatus) => {
      const keys = new Set(itemKeys)
      commitPhotos(
        photosRef.current.map((photo) =>
          keys.has(photo.itemKey) ? { ...photo, status } : photo,
        ),
      )
    },
    [commitPhotos],
  )

  useEffect(
    () => () => {
      processingControllerRef.current?.abort()
      processingControllerRef.current = undefined
      processingItemKeyRef.current = undefined
      for (const photo of photosRef.current) {
        revokePreviewUrl(photo.previewUrl)
      }
      photosRef.current = []
    },
    [revokePreviewUrl],
  )

  return {
    photos,
    photosByItemKey: new Map(
      photos.map((photo) => [photo.itemKey, photo]),
    ),
    errorsByItemKey: new Map(Object.entries(errors)),
    processingItemKey,
    selectPhoto,
    removePhoto,
    removePhotos,
    clearPhotos,
    setPhotoStatus,
  }
}
