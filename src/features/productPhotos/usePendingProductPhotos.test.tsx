// @vitest-environment happy-dom

import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PendingProductPhotosController } from './usePendingProductPhotos'
import { usePendingProductPhotos } from './usePendingProductPhotos'

function Harness({
  onChange,
  processPhoto,
  createToken = () => 'p1_AAECAwQFBgcICQoLDA0ODxAREhMUFRYX',
  createPreviewUrl,
  revokePreviewUrl,
}: {
  onChange: (value: PendingProductPhotosController) => void
  processPhoto: () => Promise<{
    blob: Blob
    width: number
    height: number
    bytes: number
  }>
  createToken?: () => string
  createPreviewUrl: (blob: Blob) => string
  revokePreviewUrl: (url: string) => void
}) {
  const value = usePendingProductPhotos({
    processPhoto,
    createToken,
    createPreviewUrl,
    revokePreviewUrl,
  })
  useEffect(() => onChange(value), [onChange, value])
  return null
}

describe('usePendingProductPhotos', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('keeps only compressed Blob data and revokes replacement, removal, and unmount URLs', async () => {
    let controller: PendingProductPhotosController | undefined
    let sequence = 0
    const revoke = vi.fn()
    const processPhoto = vi.fn(async () => {
      const blob = new Blob([`jpeg-${sequence}`], { type: 'image/jpeg' })
      sequence += 1
      return { blob, width: 640, height: 480, bytes: blob.size }
    })
    act(() => root.render(
      <Harness
        onChange={(value) => {
          controller = value
        }}
        processPhoto={processPhoto}
        createPreviewUrl={() => `blob:preview-${sequence}`}
        revokePreviewUrl={revoke}
      />,
    ))
    const source = new File(['private-source'], 'private-name.jpg', {
      type: 'image/jpeg',
    })

    await act(async () => controller?.selectPhoto('milk', source))
    expect(controller?.photos).toHaveLength(1)
    expect(controller?.photos[0].blob).not.toBe(source)
    expect(JSON.stringify(controller?.photos)).not.toContain('private-name.jpg')

    await act(async () => controller?.selectPhoto('milk', source))
    expect(revoke).toHaveBeenCalledWith('blob:preview-1')
    act(() => controller?.removePhoto('milk'))
    expect(revoke).toHaveBeenCalledWith('blob:preview-2')

    await act(async () => controller?.selectPhoto('eggs', source))
    act(() => root.unmount())
    expect(revoke).toHaveBeenCalledWith('blob:preview-3')
    container.remove()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  it('revokes a new preview when token creation fails', async () => {
    let controller: PendingProductPhotosController | undefined
    const revoke = vi.fn()
    const blob = new Blob(['jpeg'], { type: 'image/jpeg' })
    act(() => root.render(
      <Harness
        onChange={(value) => {
          controller = value
        }}
        processPhoto={async () => ({
          blob,
          width: 640,
          height: 480,
          bytes: blob.size,
        })}
        createToken={() => {
          throw new Error('random source unavailable')
        }}
        createPreviewUrl={() => 'blob:uncommitted'}
        revokePreviewUrl={revoke}
      />,
    ))

    await act(async () =>
      controller?.selectPhoto(
        'milk',
        new File(['source'], 'private.jpg', { type: 'image/jpeg' }),
      ),
    )

    expect(controller?.photos).toHaveLength(0)
    expect(revoke).toHaveBeenCalledWith('blob:uncommitted')
    expect(controller?.errorsByItemKey.get('milk')).toContain(
      '写真を準備できませんでした',
    )
  })

  it('keeps the three-photo limit before decoding another source', async () => {
    let controller: PendingProductPhotosController | undefined
    let tokenIndex = 0
    const processPhoto = vi.fn(async () => {
      const blob = new Blob(['jpeg'], { type: 'image/jpeg' })
      return { blob, width: 640, height: 480, bytes: blob.size }
    })
    act(() => root.render(
      <Harness
        onChange={(value) => {
          controller = value
        }}
        processPhoto={processPhoto}
        createToken={() => {
          tokenIndex += 1
          return `p1_AAECAwQFBgcICQoLDA0ODxAREhMUFRY${tokenIndex}`
        }}
        createPreviewUrl={() => `blob:preview-${tokenIndex}`}
        revokePreviewUrl={vi.fn()}
      />,
    ))
    const source = new File(['source'], 'private.jpg', {
      type: 'image/jpeg',
    })

    for (const itemKey of ['milk', 'eggs', 'cabbage']) {
      await act(async () => controller?.selectPhoto(itemKey, source))
    }
    await act(async () => controller?.selectPhoto('carrot', source))

    expect(controller?.photos).toHaveLength(3)
    expect(processPhoto).toHaveBeenCalledTimes(3)
  })

  it.each(['clear', 'remove'] as const)(
    'does not restore a late photo after %s cancels its in-flight processing',
    async (action) => {
      let controller: PendingProductPhotosController | undefined
      let resolveProcessing: ((value: {
        blob: Blob
        width: number
        height: number
        bytes: number
      }) => void) | undefined
      const pending = new Promise<{
        blob: Blob
        width: number
        height: number
        bytes: number
      }>((resolve) => {
        resolveProcessing = resolve
      })
      const createPreviewUrl = vi.fn(() => 'blob:late-preview')
      act(() => root.render(
        <Harness
          onChange={(value) => {
            controller = value
          }}
          processPhoto={() => pending}
          createPreviewUrl={createPreviewUrl}
          revokePreviewUrl={vi.fn()}
        />,
      ))
      const source = new File(['source'], 'private.jpg', {
        type: 'image/jpeg',
      })
      let selection: Promise<void> | undefined
      await act(async () => {
        selection = controller?.selectPhoto('milk', source)
        await Promise.resolve()
      })
      expect(controller?.processingItemKey).toBe('milk')

      act(() => {
        if (action === 'clear') {
          controller?.clearPhotos()
        } else {
          controller?.removePhoto('milk')
        }
      })
      expect(controller?.processingItemKey).toBeUndefined()

      const blob = new Blob(['late-jpeg'], { type: 'image/jpeg' })
      await act(async () => {
        resolveProcessing?.({
          blob,
          width: 640,
          height: 480,
          bytes: blob.size,
        })
        await selection
        await Promise.resolve()
      })

      expect(controller?.photos).toHaveLength(0)
      expect(createPreviewUrl).not.toHaveBeenCalled()
    },
  )

  it.each(['clear', 'remove'] as const)(
    'does not restore a late processing error after %s cancels it',
    async (action) => {
      let controller: PendingProductPhotosController | undefined
      let rejectProcessing: ((reason: Error) => void) | undefined
      const pending = new Promise<never>((_resolve, reject) => {
        rejectProcessing = reject
      })
      act(() => root.render(
        <Harness
          onChange={(value) => {
            controller = value
          }}
          processPhoto={() => pending}
          createPreviewUrl={vi.fn()}
          revokePreviewUrl={vi.fn()}
        />,
      ))
      const source = new File(['source'], 'private.jpg', {
        type: 'image/jpeg',
      })
      let selection: Promise<void> | undefined
      await act(async () => {
        selection = controller?.selectPhoto('milk', source)
        await Promise.resolve()
      })

      act(() => {
        if (action === 'clear') {
          controller?.clearPhotos()
        } else {
          controller?.removePhoto('milk')
        }
      })
      await act(async () => {
        rejectProcessing?.(new Error('late processing failure'))
        await selection
        await Promise.resolve()
      })

      expect(controller?.photos).toHaveLength(0)
      expect(controller?.errorsByItemKey.has('milk')).toBe(false)
      expect(controller?.processingItemKey).toBeUndefined()
    },
  )
})
