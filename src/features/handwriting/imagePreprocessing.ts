import { HandwritingImportError } from './errors'
import type { HandwritingDiagnosticsReporter } from './diagnostics'

export const MAX_HANDWRITING_IMAGE_BYTES = 2 * 1024 * 1024
export const MAX_HANDWRITING_SOURCE_IMAGE_BYTES = 15 * 1024 * 1024
export const MAX_HANDWRITING_IMAGE_DIMENSION = 1_600
export const MIN_HANDWRITING_IMAGE_SHORT_EDGE = 200
export const MIN_HANDWRITING_IMAGE_LONG_EDGE = 320

export type SupportedImageMime =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'

export type ImageAdjustment =
  | { mode: 'none' }
  | { mode: 'grayscale' }
  | { mode: 'contrast'; amount: number }

export type ImagePreprocessOptions = {
  signal?: AbortSignal
  adjustment?: ImageAdjustment
  maxDimension?: number
  maxBytes?: number
  diagnostics?: HandwritingDiagnosticsReporter
}

type DecodedImage = {
  source: CanvasImageSource
  width: number
  height: number
  dispose: () => void
}

const SUPPORTED_MIME_TYPES = new Set<SupportedImageMime>([
  'image/jpeg',
  'image/png',
  'image/webp',
])

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError')
  }
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
}

function isPng(bytes: Uint8Array): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  return (
    bytes.length >= signature.length &&
    signature.every((value, index) => bytes[index] === value)
  )
}

function isWebp(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  )
}

export async function detectImageMime(
  image: Blob,
): Promise<SupportedImageMime | undefined> {
  const bytes = new Uint8Array(await image.slice(0, 12).arrayBuffer())
  if (isJpeg(bytes)) {
    return 'image/jpeg'
  }
  if (isPng(bytes)) {
    return 'image/png'
  }
  if (isWebp(bytes)) {
    return 'image/webp'
  }
  return undefined
}

export function calculateResizeDimensions(
  width: number,
  height: number,
  maxDimension = MAX_HANDWRITING_IMAGE_DIMENSION,
): { width: number; height: number } {
  const scale = Math.min(1, maxDimension / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function clampColor(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

export function adjustImagePixels(
  pixels: Uint8ClampedArray,
  adjustment: ImageAdjustment,
): Uint8ClampedArray {
  const adjusted = new Uint8ClampedArray(pixels)
  if (adjustment.mode === 'none') {
    return adjusted
  }

  for (let index = 0; index < adjusted.length; index += 4) {
    const red = adjusted[index]
    const green = adjusted[index + 1]
    const blue = adjusted[index + 2]
    if (adjustment.mode === 'grayscale') {
      const gray = clampColor(red * 0.299 + green * 0.587 + blue * 0.114)
      adjusted[index] = gray
      adjusted[index + 1] = gray
      adjusted[index + 2] = gray
      continue
    }

    const amount = Math.max(-1, Math.min(1, adjustment.amount))
    const factor =
      amount >= 0 ? 1 + amount * 2 : Math.max(0, 1 + amount)
    adjusted[index] = clampColor((red - 128) * factor + 128)
    adjusted[index + 1] = clampColor((green - 128) * factor + 128)
    adjusted[index + 2] = clampColor((blue - 128) * factor + 128)
  }
  return adjusted
}

async function decodeWithImageBitmap(file: File): Promise<DecodedImage | undefined> {
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
        reject(new HandwritingImportError('unsupported-image'))
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
    URL.revokeObjectURL(objectUrl)
    image.src = ''
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
  const bitmap = await decodeWithImageBitmap(file)
  throwIfAborted(signal)
  return bitmap ?? decodeWithImageElement(file, signal)
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function encodeJpeg(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob)
        } else {
          reject(new HandwritingImportError('request-invalid'))
        }
      },
      'image/jpeg',
      quality,
    )
  })
}

function applyCanvasAdjustment(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  adjustment: ImageAdjustment,
): void {
  if (adjustment.mode === 'none') {
    return
  }
  const imageData = context.getImageData(0, 0, width, height)
  imageData.data.set(adjustImagePixels(imageData.data, adjustment))
  context.putImageData(imageData, 0, 0)
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0))
}

async function renderAndEncode(
  decoded: DecodedImage,
  width: number,
  height: number,
  adjustment: ImageAdjustment,
  maxBytes: number,
  signal?: AbortSignal,
  diagnostics?: HandwritingDiagnosticsReporter,
): Promise<Blob | undefined> {
  const canvas = createCanvas(width, height)
  try {
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) {
      throw new HandwritingImportError('request-invalid')
    }
    diagnostics?.record('canvas-render-started', {
      resizedWidth: width,
      resizedHeight: height,
    })
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    context.drawImage(decoded.source, 0, 0, width, height)
    applyCanvasAdjustment(context, width, height, adjustment)
    diagnostics?.record('canvas-render-completed', {
      resizedWidth: width,
      resizedHeight: height,
    })
    await yieldToBrowser()

    diagnostics?.record('encode-started')
    for (const quality of [0.9, 0.82, 0.74, 0.66, 0.58]) {
      throwIfAborted(signal)
      const blob = await encodeJpeg(canvas, quality)
      diagnostics?.record('encode-completed', {
        encodedBytes: blob.size,
      })
      if (blob.size <= maxBytes) {
        return blob
      }
    }
    return undefined
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

export async function preprocessHandwritingImage(
  file: File,
  options: ImagePreprocessOptions = {},
): Promise<Blob> {
  const {
    signal,
    adjustment = { mode: 'none' },
    maxDimension = MAX_HANDWRITING_IMAGE_DIMENSION,
    maxBytes = MAX_HANDWRITING_IMAGE_BYTES,
    diagnostics,
  } = options
  throwIfAborted(signal)

  if (
    !SUPPORTED_MIME_TYPES.has(file.type as SupportedImageMime) ||
    file.size > MAX_HANDWRITING_SOURCE_IMAGE_BYTES
  ) {
    throw new HandwritingImportError(
      file.size > MAX_HANDWRITING_SOURCE_IMAGE_BYTES
        ? 'image-too-large'
        : 'unsupported-image',
    )
  }
  const detectedMime = await detectImageMime(file)
  if (!detectedMime || detectedMime !== file.type) {
    throw new HandwritingImportError('unsupported-image')
  }
  diagnostics?.record('source-validated', {
    sourceImageBytes: file.size,
    sourceMime: detectedMime,
  })

  diagnostics?.record('decode-started')
  const decoded = await decodeImage(file, signal)
  diagnostics?.record('decode-completed', {
    decodedWidth: decoded.width,
    decodedHeight: decoded.height,
  })
  try {
    if (
      Math.min(decoded.width, decoded.height) <
        MIN_HANDWRITING_IMAGE_SHORT_EDGE ||
      Math.max(decoded.width, decoded.height) <
        MIN_HANDWRITING_IMAGE_LONG_EDGE
    ) {
      throw new HandwritingImportError('image-too-small')
    }

    let dimensions = calculateResizeDimensions(
      decoded.width,
      decoded.height,
      maxDimension,
    )
    diagnostics?.record('resize-calculated', {
      resizedWidth: dimensions.width,
      resizedHeight: dimensions.height,
    })
    for (let attempt = 0; attempt < 4; attempt += 1) {
      throwIfAborted(signal)
      const result = await renderAndEncode(
        decoded,
        dimensions.width,
        dimensions.height,
        adjustment,
        maxBytes,
        signal,
        diagnostics,
      )
      if (result) {
        const outputMime = await detectImageMime(result)
        if (outputMime !== 'image/jpeg') {
          throw new HandwritingImportError('request-invalid')
        }
        diagnostics?.record('preprocessing-completed', {
          encodedBytes: result.size,
        })
        return result
      }
      dimensions = {
        width: Math.max(1, Math.round(dimensions.width * 0.82)),
        height: Math.max(1, Math.round(dimensions.height * 0.82)),
      }
    }
    throw new HandwritingImportError('image-too-large')
  } finally {
    decoded.dispose()
  }
}
