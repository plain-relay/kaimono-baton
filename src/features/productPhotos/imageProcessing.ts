export const MAX_PRODUCT_PHOTO_DIMENSION = 1_280
export const TARGET_PRODUCT_PHOTO_BYTES = 400 * 1024
export const MAX_PRODUCT_PHOTO_BYTES = 500 * 1024
export const MAX_PRODUCT_PHOTO_SOURCE_BYTES = 20 * 1024 * 1024

const JPEG_QUALITIES = [0.9, 0.84, 0.78, 0.72, 0.66, 0.6, 0.54, 0.48]
const MAX_RESIZE_ATTEMPTS = 5
const RESIZE_FACTOR = 0.82
const SUPPORTED_SOURCE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
])

export type ProductPhotoProcessingErrorCode =
  | 'unsupported-image'
  | 'image-too-large'
  | 'decode-failed'
  | 'processing-failed'

export class ProductPhotoProcessingError extends Error {
  constructor(readonly code: ProductPhotoProcessingErrorCode) {
    super(code)
    this.name = 'ProductPhotoProcessingError'
  }
}

export type ProcessedProductPhoto = {
  blob: Blob
  width: number
  height: number
  bytes: number
}

export type ProductPhotoProcessingOptions = {
  signal?: AbortSignal
  maxDimension?: number
  targetBytes?: number
  maxBytes?: number
}

type DecodedImage = {
  source: CanvasImageSource
  width: number
  height: number
  dispose: () => void
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError')
  }
}

export function calculateProductPhotoDimensions(
  width: number,
  height: number,
  maxDimension = MAX_PRODUCT_PHOTO_DIMENSION,
): { width: number; height: number } {
  const scale = Math.min(1, maxDimension / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

async function decodeWithImageBitmap(
  file: File,
): Promise<DecodedImage | undefined> {
  if (typeof createImageBitmap !== 'function') {
    return undefined
  }

  try {
    const bitmap = await createImageBitmap(file, {
      imageOrientation: 'from-image',
    })
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      dispose: () => bitmap.close(),
    }
  } catch {
    try {
      const bitmap = await createImageBitmap(file)
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        dispose: () => bitmap.close(),
      }
    } catch {
      return undefined
    }
  }
}

async function decodeWithImageElement(
  file: File,
  signal?: AbortSignal,
): Promise<DecodedImage> {
  const objectUrl = URL.createObjectURL(file)
  const image = new Image()
  image.decoding = 'async'

  try {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        image.removeEventListener('load', handleLoad)
        image.removeEventListener('error', handleError)
        signal?.removeEventListener('abort', handleAbort)
      }
      const handleLoad = () => {
        cleanup()
        resolve()
      }
      const handleError = () => {
        cleanup()
        reject(new ProductPhotoProcessingError('decode-failed'))
      }
      const handleAbort = () => {
        cleanup()
        reject(new DOMException('The operation was aborted.', 'AbortError'))
      }
      image.addEventListener('load', handleLoad, { once: true })
      image.addEventListener('error', handleError, { once: true })
      signal?.addEventListener('abort', handleAbort, { once: true })
      image.src = objectUrl
    })
  } catch (error) {
    image.src = ''
    URL.revokeObjectURL(objectUrl)
    throw error
  }

  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    dispose: () => {
      image.src = ''
      URL.revokeObjectURL(objectUrl)
    },
  }
}

async function decodeImage(
  file: File,
  signal?: AbortSignal,
): Promise<DecodedImage> {
  const decoded = await decodeWithImageBitmap(file)
  if (signal?.aborted) {
    decoded?.dispose()
    throw new DOMException('The operation was aborted.', 'AbortError')
  }
  return decoded ?? decodeWithImageElement(file, signal)
}

function encodeJpeg(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob?.type === 'image/jpeg') {
          resolve(blob)
        } else {
          reject(new ProductPhotoProcessingError('processing-failed'))
        }
      },
      'image/jpeg',
      quality,
    )
  })
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0))
}

async function renderAtDimensions(
  decoded: DecodedImage,
  dimensions: { width: number; height: number },
  signal: AbortSignal | undefined,
  targetBytes: number,
  maxBytes: number,
): Promise<{
  target?: ProcessedProductPhoto
  fallback?: ProcessedProductPhoto
}> {
  const canvas = document.createElement('canvas')
  canvas.width = dimensions.width
  canvas.height = dimensions.height

  try {
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) {
      throw new ProductPhotoProcessingError('processing-failed')
    }
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, dimensions.width, dimensions.height)
    context.drawImage(
      decoded.source,
      0,
      0,
      dimensions.width,
      dimensions.height,
    )
    await yieldToBrowser()

    let fallback: ProcessedProductPhoto | undefined
    for (const quality of JPEG_QUALITIES) {
      throwIfAborted(signal)
      const blob = await encodeJpeg(canvas, quality)
      const processed = {
        blob,
        width: dimensions.width,
        height: dimensions.height,
        bytes: blob.size,
      }
      if (blob.size <= targetBytes) {
        return { target: processed }
      }
      if (
        blob.size <= maxBytes &&
        (!fallback || blob.size < fallback.bytes)
      ) {
        fallback = processed
      }
    }
    return { fallback }
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

export async function processProductPhoto(
  file: File,
  options: ProductPhotoProcessingOptions = {},
): Promise<ProcessedProductPhoto> {
  const {
    signal,
    maxDimension = MAX_PRODUCT_PHOTO_DIMENSION,
    targetBytes = TARGET_PRODUCT_PHOTO_BYTES,
    maxBytes = MAX_PRODUCT_PHOTO_BYTES,
  } = options
  throwIfAborted(signal)

  if (
    !SUPPORTED_SOURCE_MIME_TYPES.has(file.type.toLowerCase()) ||
    file.size === 0 ||
    file.size > MAX_PRODUCT_PHOTO_SOURCE_BYTES
  ) {
    throw new ProductPhotoProcessingError(
      file.size > MAX_PRODUCT_PHOTO_SOURCE_BYTES
        ? 'image-too-large'
        : 'unsupported-image',
    )
  }

  const decoded = await decodeImage(file, signal)
  try {
    if (decoded.width < 1 || decoded.height < 1) {
      throw new ProductPhotoProcessingError('decode-failed')
    }

    let dimensions = calculateProductPhotoDimensions(
      decoded.width,
      decoded.height,
      maxDimension,
    )
    let bestFallback: ProcessedProductPhoto | undefined
    for (let attempt = 0; attempt < MAX_RESIZE_ATTEMPTS; attempt += 1) {
      throwIfAborted(signal)
      const result = await renderAtDimensions(
        decoded,
        dimensions,
        signal,
        targetBytes,
        maxBytes,
      )
      if (result.target) {
        return result.target
      }
      if (
        result.fallback &&
        (!bestFallback || result.fallback.bytes < bestFallback.bytes)
      ) {
        bestFallback = result.fallback
      }
      dimensions = {
        width: Math.max(1, Math.round(dimensions.width * RESIZE_FACTOR)),
        height: Math.max(1, Math.round(dimensions.height * RESIZE_FACTOR)),
      }
    }

    if (bestFallback) {
      return bestFallback
    }
    throw new ProductPhotoProcessingError('image-too-large')
  } finally {
    decoded.dispose()
  }
}
