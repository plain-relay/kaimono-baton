export type PendingPhoto = {
  itemKey: string
  token: string
  blob: Blob
  previewUrl: string
  width: number
  height: number
  bytes: number
  status: 'local' | 'uploading' | 'uploaded' | 'failed'
}

export const MAX_PRODUCT_PHOTOS_PER_REQUEST = 3

export function canAddProductPhoto(currentCount: number): boolean {
  return (
    Number.isInteger(currentCount) &&
    currentCount >= 0 &&
    currentCount < MAX_PRODUCT_PHOTOS_PER_REQUEST
  )
}
