// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  adjustImagePixels,
  calculateResizeDimensions,
  detectImageMime,
  MAX_HANDWRITING_SOURCE_IMAGE_BYTES,
  preprocessHandwritingImage,
} from './imagePreprocessing'

function jpegBlob(extraBytes = 0): Blob {
  return new Blob(
    [
      new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
      new Uint8Array(extraBytes),
    ],
    { type: 'image/jpeg' },
  )
}

function jpegFile(): File {
  return new File([jpegBlob()], 'memo.jpg', { type: 'image/jpeg' })
}

function installImagePipeline(options: {
  width?: number
  height?: number
  encodedBlob?: () => Blob
  contextAvailable?: boolean
} = {}) {
  const close = vi.fn()
  const bitmap = {
    width: options.width ?? 2_400,
    height: options.height ?? 1_800,
    close,
  } as unknown as ImageBitmap
  const createBitmap = vi.fn(async () => bitmap)
  vi.stubGlobal('createImageBitmap', createBitmap)

  const drawImage = vi.fn()
  const getImageData = vi.fn(() => ({
    data: new Uint8ClampedArray([100, 150, 200, 255]),
  }))
  const putImageData = vi.fn()
  const context = {
    fillStyle: '',
    fillRect: vi.fn(),
    drawImage,
    getImageData,
    putImageData,
  } as unknown as CanvasRenderingContext2D
  const getContext = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockImplementation(() =>
      options.contextAvailable === false ? null : context,
    )
  const toBlob = vi
    .spyOn(HTMLCanvasElement.prototype, 'toBlob')
    .mockImplementation((callback) =>
      callback(options.encodedBlob?.() ?? jpegBlob()),
    )

  return {
    close,
    createBitmap,
    drawImage,
    getImageData,
    putImageData,
    getContext,
    toBlob,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('image signature validation', () => {
  it.each([
    {
      bytes: [0xff, 0xd8, 0xff, 0xe0],
      expected: 'image/jpeg',
    },
    {
      bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      expected: 'image/png',
    },
    {
      bytes: [
        0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45,
        0x42, 0x50,
      ],
      expected: 'image/webp',
    },
  ])('detects $expected from bytes', async ({ bytes, expected }) => {
    await expect(detectImageMime(new Blob([new Uint8Array(bytes)]))).resolves.toBe(
      expected,
    )
  })

  it('rejects content whose bytes are not a supported image', async () => {
    await expect(
      detectImageMime(new Blob([new Uint8Array([1, 2, 3, 4])])),
    ).resolves.toBeUndefined()
  })
})

describe('image resize calculations', () => {
  it('preserves a small image and its aspect ratio', () => {
    expect(calculateResizeDimensions(1_200, 800)).toEqual({
      width: 1_200,
      height: 800,
    })
  })

  it('limits the long edge to 1600px while preserving aspect ratio', () => {
    expect(calculateResizeDimensions(4_000, 3_000)).toEqual({
      width: 1_600,
      height: 1_200,
    })
    expect(calculateResizeDimensions(3_000, 4_000)).toEqual({
      width: 1_200,
      height: 1_600,
    })
  })
})

describe('optional image adjustments', () => {
  const pixels = new Uint8ClampedArray([100, 150, 200, 255])

  it('keeps the default no-adjustment path unchanged without mutating input', () => {
    const adjusted = adjustImagePixels(pixels, { mode: 'none' })
    expect([...adjusted]).toEqual([...pixels])
    expect(adjusted).not.toBe(pixels)
  })

  it('supports a pure grayscale comparison variant', () => {
    const adjusted = adjustImagePixels(pixels, { mode: 'grayscale' })
    expect(adjusted[0]).toBe(adjusted[1])
    expect(adjusted[1]).toBe(adjusted[2])
    expect(adjusted[3]).toBe(255)
  })

  it('supports a pure contrast comparison variant', () => {
    const adjusted = adjustImagePixels(pixels, {
      mode: 'contrast',
      amount: 0.5,
    })
    expect(adjusted[0]).toBeLessThan(pixels[0])
    expect(adjusted[2]).toBeGreaterThan(pixels[2])
    expect(adjusted[3]).toBe(255)
  })
})

describe('preprocessHandwritingImage', () => {
  it('decodes EXIF-aware, resizes, encodes under 2MB, and releases bitmap/canvas resources', async () => {
    const pipeline = installImagePipeline()
    const result = await preprocessHandwritingImage(jpegFile())

    expect(result.type).toBe('image/jpeg')
    expect(result.size).toBeLessThanOrEqual(2 * 1024 * 1024)
    expect(pipeline.createBitmap).toHaveBeenCalledWith(
      expect.any(File),
      { imageOrientation: 'from-image' },
    )
    expect(pipeline.drawImage).toHaveBeenCalledWith(
      expect.anything(),
      0,
      0,
      1_600,
      1_200,
    )
    expect(pipeline.close).toHaveBeenCalledTimes(1)
  })

  it('records safe preprocessing stages and dimensions without file content', async () => {
    installImagePipeline()
    const record = vi.fn()
    await preprocessHandwritingImage(jpegFile(), {
      diagnostics: {
        enabled: true,
        record,
        adoptRequestId: vi.fn(),
      },
    })

    expect(record.mock.calls.map(([stage]) => stage)).toEqual([
      'source-validated',
      'decode-started',
      'decode-completed',
      'resize-calculated',
      'canvas-render-started',
      'canvas-render-completed',
      'encode-started',
      'encode-completed',
      'preprocessing-completed',
    ])
    expect(record).toHaveBeenCalledWith('decode-completed', {
      decodedWidth: 2_400,
      decodedHeight: 1_800,
    })
    expect(record).toHaveBeenCalledWith('resize-calculated', {
      resizedWidth: 1_600,
      resizedHeight: 1_200,
    })
    expect(JSON.stringify(record.mock.calls)).not.toContain('memo.jpg')
  })

  it('runs an optional grayscale comparison variant without changing the default', async () => {
    const pipeline = installImagePipeline()
    await preprocessHandwritingImage(jpegFile(), {
      adjustment: { mode: 'grayscale' },
    })
    expect(pipeline.getImageData).toHaveBeenCalledTimes(1)
    expect(pipeline.putImageData).toHaveBeenCalledTimes(1)
  })

  it('falls back to the default ImageBitmap decode when the EXIF option is unavailable', async () => {
    const pipeline = installImagePipeline()
    pipeline.createBitmap.mockRejectedValueOnce(
      new TypeError('imageOrientation unsupported'),
    )
    await expect(preprocessHandwritingImage(jpegFile())).resolves.toBeInstanceOf(
      Blob,
    )
    expect(pipeline.createBitmap).toHaveBeenCalledTimes(2)
    expect(pipeline.close).toHaveBeenCalledTimes(1)
  })

  it('falls back to an EXIF-aware image element and revokes its object URL', async () => {
    const pipeline = installImagePipeline()
    vi.stubGlobal('createImageBitmap', undefined)
    const createObjectUrl = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:handwriting-test')
    const revokeObjectUrl = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined)

    class FakeImage extends EventTarget {
      decoding = ''
      naturalWidth = 800
      naturalHeight = 600
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
    vi.stubGlobal('Image', FakeImage)

    await expect(preprocessHandwritingImage(jpegFile())).resolves.toBeInstanceOf(
      Blob,
    )
    expect(createObjectUrl).toHaveBeenCalledTimes(1)
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:handwriting-test')
    expect(pipeline.drawImage).toHaveBeenCalledTimes(1)
  })

  it('rejects an extremely small decoded image and still closes it', async () => {
    const pipeline = installImagePipeline({ width: 250, height: 120 })
    await expect(preprocessHandwritingImage(jpegFile())).rejects.toMatchObject({
      code: 'image-too-small',
    })
    expect(pipeline.close).toHaveBeenCalledTimes(1)
    expect(pipeline.toBlob).not.toHaveBeenCalled()
  })

  it('rejects unsupported declared MIME and mismatched data before decoding', async () => {
    const createBitmap = vi.fn()
    vi.stubGlobal('createImageBitmap', createBitmap)
    await expect(
      preprocessHandwritingImage(
        new File(['plain text'], 'memo.txt', { type: 'text/plain' }),
      ),
    ).rejects.toMatchObject({ code: 'unsupported-image' })
    await expect(
      preprocessHandwritingImage(
        new File(['not png'], 'memo.png', { type: 'image/png' }),
      ),
    ).rejects.toMatchObject({ code: 'unsupported-image' })
    expect(createBitmap).not.toHaveBeenCalled()
  })

  it('rejects an oversized source before decoding', async () => {
    const file = jpegFile()
    Object.defineProperty(file, 'size', {
      configurable: true,
      value: MAX_HANDWRITING_SOURCE_IMAGE_BYTES + 1,
    })
    const createBitmap = vi.fn()
    vi.stubGlobal('createImageBitmap', createBitmap)
    await expect(preprocessHandwritingImage(file)).rejects.toMatchObject({
      code: 'image-too-large',
    })
    expect(createBitmap).not.toHaveBeenCalled()
  })

  it('retries quality and dimensions, then rejects when no encoding fits', async () => {
    const pipeline = installImagePipeline({
      encodedBlob: () => jpegBlob(10),
    })
    await expect(
      preprocessHandwritingImage(jpegFile(), { maxBytes: 3 }),
    ).rejects.toMatchObject({ code: 'image-too-large' })
    expect(pipeline.toBlob).toHaveBeenCalledTimes(20)
    expect(pipeline.getContext).toHaveBeenCalledTimes(4)
    expect(pipeline.close).toHaveBeenCalledTimes(1)
  })

  it('maps a missing canvas context to a safe processing failure', async () => {
    const pipeline = installImagePipeline({ contextAvailable: false })
    await expect(preprocessHandwritingImage(jpegFile())).rejects.toMatchObject({
      code: 'request-invalid',
    })
    expect(pipeline.close).toHaveBeenCalledTimes(1)
  })

  it('honors an already-aborted signal before reading or decoding', async () => {
    const controller = new AbortController()
    controller.abort()
    const createBitmap = vi.fn()
    vi.stubGlobal('createImageBitmap', createBitmap)
    await expect(
      preprocessHandwritingImage(jpegFile(), {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(createBitmap).not.toHaveBeenCalled()
  })
})
