import { describe, expect, it, vi } from 'vitest'
import {
  inspectPhotoJpeg,
  MAX_PHOTO_BATCH_BYTES,
  MAX_PHOTO_BYTES,
  MAX_PHOTO_REQUEST_BYTES,
  validatePhotoBatchRequest,
} from '../src/photoValidation'
import {
  allowedOrigin,
  createJpegBytes,
  photoBatchRequest,
  validPhotoTokens,
} from './photoTestHelpers'

const origins = new Set([allowedOrigin])

describe('photo JPEG inspection', () => {
  it('reads dimensions at the 1280px boundary', () => {
    expect(inspectPhotoJpeg(createJpegBytes(1_280, 960))).toEqual({
      width: 1_280,
      height: 960,
    })
  })

  it('rejects dimensions above 1280px', () => {
    expect(() => inspectPhotoJpeg(createJpegBytes(1_281, 960))).toThrowError(
      expect.objectContaining({
        status: 413,
        code: 'PHOTO_DIMENSIONS_TOO_LARGE',
      }),
    )
  })

  it('rejects multiple SOF segments instead of trusting a later size', () => {
    expect(() =>
      inspectPhotoJpeg(
        createJpegBytes(1_280, 960, {
          secondSof: { width: 640, height: 480 },
        }),
      ),
    ).toThrowError(
      expect.objectContaining({ status: 415, code: 'PHOTO_INVALID' }),
    )
    expect(() =>
      inspectPhotoJpeg(
        createJpegBytes(1_281, 960, {
          secondSof: { width: 640, height: 480 },
        }),
      ),
    ).toThrowError(
      expect.objectContaining({
        status: 413,
        code: 'PHOTO_DIMENSIONS_TOO_LARGE',
      }),
    )
  })

  it('rejects a SOF-only payload without a start-of-scan segment', () => {
    expect(() =>
      inspectPhotoJpeg(createJpegBytes(640, 480, { omitSos: true })),
    ).toThrowError(
      expect.objectContaining({ status: 415, code: 'PHOTO_INVALID' }),
    )
  })

  it('rejects APP1 EXIF or XMP metadata segments', () => {
    expect(() =>
      inspectPhotoJpeg(createJpegBytes(640, 480, { app1: true })),
    ).toThrowError(
      expect.objectContaining({
        status: 415,
        code: 'PHOTO_METADATA_PRESENT',
      }),
    )
  })

  it.each([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    new TextEncoder().encode('<svg><script /></svg>'),
    new TextEncoder().encode('<!doctype html>'),
  ])('rejects non-JPEG or executable content', (bytes) => {
    expect(() => inspectPhotoJpeg(bytes)).toThrowError(
      expect.objectContaining({ code: 'PHOTO_INVALID' }),
    )
  })
})

describe('photo batch request validation', () => {
  it.each([1, 2, 3])('accepts a batch of %s JPEG photos', async (count) => {
    const result = await validatePhotoBatchRequest(
      photoBatchRequest({ count }),
      origins,
    )

    expect(result.photos).toHaveLength(count)
    expect(result.photos[0]).toMatchObject({
      token: validPhotoTokens[0],
      itemKey: 'item-0',
      width: 640,
      height: 480,
    })
  })

  it('rejects four photos', async () => {
    await expect(
      validatePhotoBatchRequest(photoBatchRequest({ count: 4 }), origins),
    ).rejects.toMatchObject({
      status: 400,
      code: 'PHOTO_REQUEST_INVALID',
    })
  })

  it('accepts exactly 500KB and rejects one byte more', async () => {
    const exact = new File(
      [createJpegBytes(640, 480, { size: MAX_PHOTO_BYTES }).buffer],
      'exact.jpg',
      { type: 'image/jpeg' },
    )
    const over = new File(
      [createJpegBytes(640, 480, { size: MAX_PHOTO_BYTES + 1 }).buffer],
      'over.jpg',
      { type: 'image/jpeg' },
    )

    await expect(
      validatePhotoBatchRequest(
        photoBatchRequest({ files: [exact] }),
        origins,
      ),
    ).resolves.toMatchObject({ photos: [{ jpeg: expect.any(ArrayBuffer) }] })
    await expect(
      validatePhotoBatchRequest(
        photoBatchRequest({ files: [over] }),
        origins,
      ),
    ).rejects.toMatchObject({ status: 413, code: 'PHOTO_TOO_LARGE' })
  })

  it('rejects a declared request larger than the multipart safety limit', async () => {
    expect(MAX_PHOTO_BATCH_BYTES).toBe(3 * MAX_PHOTO_BYTES)
    const request = photoBatchRequest({
      contentLength: MAX_PHOTO_REQUEST_BYTES + 1,
    })
    const formData = vi.spyOn(request, 'formData')
    await expect(
      validatePhotoBatchRequest(request, origins),
    ).rejects.toMatchObject({
      status: 413,
      code: 'PHOTO_BATCH_TOO_LARGE',
    })
    expect(formData).not.toHaveBeenCalled()
  })

  it('parses the body once and resolves either manual-session transport', async () => {
    const validationSessionToken = `mv1_${'M'.repeat(32)}`
    for (const request of [
      photoBatchRequest({ validationSessionToken }),
      photoBatchRequest({
        validationSessionHeader: validationSessionToken,
      }),
      photoBatchRequest({
        validationSessionToken,
        validationSessionHeader: validationSessionToken,
      }),
    ]) {
      const formData = vi.spyOn(request, 'formData')
      await expect(
        validatePhotoBatchRequest(request, origins),
      ).resolves.toMatchObject({ validationSessionToken })
      expect(formData).toHaveBeenCalledTimes(1)
    }
  })

  it('rejects mismatched manual-session transports', async () => {
    await expect(
      validatePhotoBatchRequest(
        photoBatchRequest({
          validationSessionToken: `mv1_${'M'.repeat(32)}`,
          validationSessionHeader: `mv1_${'X'.repeat(32)}`,
        }),
        origins,
      ),
    ).rejects.toMatchObject({
      status: 403,
      code: 'VALIDATION_SESSION_INVALID',
    })
  })

  it('rejects MIME declarations that do not match JPEG content', async () => {
    const declaredPng = new File([createJpegBytes().buffer], 'photo.png', {
      type: 'image/png',
    })
    const disguisedHtml = new File(
      [new TextEncoder().encode('<!doctype html>').buffer as ArrayBuffer],
      'photo.jpg',
      { type: 'image/jpeg' },
    )

    for (const file of [declaredPng, disguisedHtml]) {
      await expect(
        validatePhotoBatchRequest(
          photoBatchRequest({ files: [file] }),
          origins,
        ),
      ).rejects.toMatchObject({ status: 415, code: 'PHOTO_INVALID' })
    }
  })

  it('rejects unsafe or duplicate token and itemKey metadata', async () => {
    const cases = [
      [{ token: 'bad-token', itemKey: 'item-0' }],
      [
        { token: validPhotoTokens[0], itemKey: 'item-0' },
        { token: validPhotoTokens[0], itemKey: 'item-1' },
      ],
      [
        { token: validPhotoTokens[0], itemKey: 'item-0' },
        { token: validPhotoTokens[1], itemKey: 'item-0' },
      ],
      [
        {
          token: validPhotoTokens[0],
          itemKey: 'contains whitespace',
        },
      ],
      [
        {
          token: validPhotoTokens[0],
          itemKey: 'item-0',
          unexpected: true,
        },
      ],
    ]

    for (const metadata of cases) {
      await expect(
        validatePhotoBatchRequest(
          photoBatchRequest({ count: metadata.length, metadata }),
          origins,
        ),
      ).rejects.toMatchObject({
        status: 400,
        code: 'PHOTO_REQUEST_INVALID',
      })
    }
  })

  it('rejects an unlisted Origin before accepting files', async () => {
    await expect(
      validatePhotoBatchRequest(
        photoBatchRequest({ origin: 'https://attacker.example' }),
        origins,
      ),
    ).rejects.toMatchObject({
      status: 403,
      code: 'ORIGIN_NOT_ALLOWED',
    })
  })
})
