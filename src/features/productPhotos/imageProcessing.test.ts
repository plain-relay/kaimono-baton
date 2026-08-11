// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  calculateProductPhotoDimensions,
  MAX_PRODUCT_PHOTO_BYTES,
  MAX_PRODUCT_PHOTO_DIMENSION,
  processProductPhoto,
  TARGET_PRODUCT_PHOTO_BYTES,
} from './imageProcessing'

function jpegBlob(size = 100, marker = ''): Blob {
  const prefix = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
  const markerBytes = new TextEncoder().encode(marker)
  const padding = new Uint8Array(
    Math.max(0, size - prefix.length - markerBytes.length),
  )
  return new Blob([prefix, markerBytes, padding], {
    type: 'image/jpeg',
  })
}

function imageFile(type = 'image/jpeg', marker = ''): File {
  return new File([jpegBlob(100, marker)], 'private-name.jpg', { type })
}

function installPipeline(options: {
  width?: number
  height?: number
  encodedSizes?: number[]
} = {}) {
  const close = vi.fn()
  const bitmap = {
    width: options.width ?? 4_032,
    height: options.height ?? 3_024,
    close,
  } as unknown as ImageBitmap
  const createBitmap = vi.fn(async () => bitmap)
  vi.stubGlobal('createImageBitmap', createBitmap)

  const context = {
    fillStyle: '',
    fillRect: vi.fn(),
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => context,
  )
  let encodeIndex = 0
  const encodedSizes = options.encodedSizes ?? [100]
  const toBlob = vi
    .spyOn(HTMLCanvasElement.prototype, 'toBlob')
    .mockImplementation((callback) => {
      const size =
        encodedSizes[Math.min(encodeIndex, encodedSizes.length - 1)]
      encodeIndex += 1
      callback(jpegBlob(size))
    })

  return { close, context, createBitmap, toBlob }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('product photo resize calculation', () => {
  it.each([
    [2_000, 1_000, 1_280, 640],
    [1_000, 2_000, 640, 1_280],
    [2_000, 2_000, 1_280, 1_280],
    [1_280, 960, 1_280, 960],
  ])(
    'preserves aspect ratio for %sx%s',
    (width, height, expectedWidth, expectedHeight) => {
      expect(calculateProductPhotoDimensions(width, height)).toEqual({
        width: expectedWidth,
        height: expectedHeight,
      })
    },
  )
})

describe('processProductPhoto', () => {
  it('applies EXIF-aware decode, draws on white, and emits a JPEG under the target', async () => {
    const pipeline = installPipeline()
    const result = await processProductPhoto(imageFile('image/png', 'Exif'))

    expect(pipeline.createBitmap).toHaveBeenCalledWith(expect.any(File), {
      imageOrientation: 'from-image',
    })
    expect(pipeline.context.fillStyle).toBe('#ffffff')
    expect(pipeline.context.fillRect).toHaveBeenCalledWith(
      0,
      0,
      1_280,
      960,
    )
    expect(pipeline.context.drawImage).toHaveBeenCalledWith(
      expect.anything(),
      0,
      0,
      1_280,
      960,
    )
    expect(result).toMatchObject({
      width: 1_280,
      height: 960,
      bytes: 100,
    })
    expect(result.blob.type).toBe('image/jpeg')
    expect(
      new TextDecoder().decode(await result.blob.arrayBuffer()),
    ).not.toContain('Exif')
    expect(pipeline.close).toHaveBeenCalledTimes(1)
  })

  it('lowers JPEG quality until the 400KB target is reached', async () => {
    const pipeline = installPipeline({
      encodedSizes: [
        MAX_PRODUCT_PHOTO_BYTES + 1,
        450 * 1024,
        TARGET_PRODUCT_PHOTO_BYTES,
      ],
    })

    const result = await processProductPhoto(imageFile())

    expect(result.bytes).toBe(TARGET_PRODUCT_PHOTO_BYTES)
    expect(pipeline.toBlob).toHaveBeenCalledTimes(3)
  })

  it('shrinks dimensions after exhausting quality adjustments', async () => {
    const pipeline = installPipeline({
      width: 1_600,
      height: 1_200,
      encodedSizes: [
        ...Array.from({ length: 8 }, () => MAX_PRODUCT_PHOTO_BYTES + 1),
        TARGET_PRODUCT_PHOTO_BYTES,
      ],
    })

    const result = await processProductPhoto(imageFile())

    expect(result).toMatchObject({
      width: 1_050,
      height: 787,
      bytes: TARGET_PRODUCT_PHOTO_BYTES,
    })
    expect(pipeline.context.drawImage).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      0,
      0,
      MAX_PRODUCT_PHOTO_DIMENSION,
      960,
    )
    expect(pipeline.context.drawImage).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      0,
      0,
      1_050,
      787,
    )
  })

  it('accepts the absolute 500KB boundary when the target cannot be reached', async () => {
    installPipeline({
      encodedSizes: [MAX_PRODUCT_PHOTO_BYTES],
    })

    const result = await processProductPhoto(imageFile(), {
      targetBytes: MAX_PRODUCT_PHOTO_BYTES - 1,
    })

    expect(result.bytes).toBe(MAX_PRODUCT_PHOTO_BYTES)
  })

  it('rejects an undecodable image and revokes the fallback object URL', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => Promise.reject()))
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:photo-test')
    const revoke = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined)

    class FailingImage extends EventTarget {
      decoding = ''
      naturalWidth = 0
      naturalHeight = 0
      private source = ''

      get src() {
        return this.source
      }

      set src(value: string) {
        this.source = value
        if (value) {
          queueMicrotask(() => this.dispatchEvent(new Event('error')))
        }
      }
    }
    vi.stubGlobal('Image', FailingImage)

    await expect(processProductPhoto(imageFile())).rejects.toMatchObject({
      code: 'decode-failed',
    })
    expect(revoke).toHaveBeenCalledWith('blob:photo-test')
  })

  it('revokes the Image fallback URL after a successful conversion', async () => {
    vi.stubGlobal('createImageBitmap', undefined)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:photo-success')
    const revoke = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined)

    class SuccessfulImage extends EventTarget {
      decoding = ''
      naturalWidth = 640
      naturalHeight = 480
      private source = ''

      get src() {
        return this.source
      }

      set src(value: string) {
        this.source = value
        if (value) {
          queueMicrotask(() => this.dispatchEvent(new Event('load')))
        }
      }
    }
    vi.stubGlobal('Image', SuccessfulImage)
    const pipeline = installPipeline({ width: 640, height: 480 })
    vi.stubGlobal('createImageBitmap', undefined)

    await expect(processProductPhoto(imageFile())).resolves.toMatchObject({
      width: 640,
      height: 480,
    })
    expect(revoke).toHaveBeenCalledWith('blob:photo-success')
    expect(pipeline.context.drawImage).toHaveBeenCalledTimes(1)
  })

  it.each(['text/html', 'image/svg+xml'])(
    'rejects unsupported %s input before decode or network use',
    async (type) => {
      const createBitmap = vi.fn()
      vi.stubGlobal('createImageBitmap', createBitmap)
      const file = new File(
        [new Uint8Array([1, 2, 3])],
        'payload.html',
        { type },
      )

      await expect(processProductPhoto(file)).rejects.toMatchObject({
        code: 'unsupported-image',
      })
      expect(createBitmap).not.toHaveBeenCalled()
    },
  )

  it('cancels without retaining decoded resources', async () => {
    const pipeline = installPipeline()
    const controller = new AbortController()
    controller.abort()

    await expect(
      processProductPhoto(imageFile(), { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(pipeline.createBitmap).not.toHaveBeenCalled()
  })

  it('closes an ImageBitmap when cancellation happens during decode', async () => {
    const close = vi.fn()
    let resolveBitmap: ((bitmap: ImageBitmap) => void) | undefined
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(
        () =>
          new Promise<ImageBitmap>((resolve) => {
            resolveBitmap = resolve
          }),
      ),
    )
    const controller = new AbortController()
    const processing = processProductPhoto(imageFile(), {
      signal: controller.signal,
    })

    controller.abort()
    resolveBitmap?.({ width: 640, height: 480, close } as ImageBitmap)

    await expect(processing).rejects.toMatchObject({ name: 'AbortError' })
    expect(close).toHaveBeenCalledTimes(1)
  })
})
