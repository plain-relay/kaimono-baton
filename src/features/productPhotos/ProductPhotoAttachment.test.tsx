// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PendingPhoto } from './types'
import { ProductPhotoAttachment } from './ProductPhotoAttachment'

const token = 'p1_AAECAwQFBgcICQoLDA0ODxAREhMUFRYX'

function pendingPhoto(): PendingPhoto {
  return {
    itemKey: 'milk',
    token,
    blob: new Blob(['jpeg'], { type: 'image/jpeg' }),
    previewUrl: 'blob:preview',
    width: 640,
    height: 480,
    bytes: 20_000,
    status: 'local',
  }
}

describe('ProductPhotoAttachment', () => {
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

  function render(overrides: Partial<React.ComponentProps<typeof ProductPhotoAttachment>> = {}) {
    const props: React.ComponentProps<typeof ProductPhotoAttachment> = {
      itemName: '牛乳',
      selected: true,
      photoCount: 0,
      processing: false,
      disabled: false,
      onSelect: vi.fn(),
      onRemove: vi.fn(),
      ...overrides,
    }
    act(() => root.render(<ProductPhotoAttachment {...props} />))
    return props
  }

  it('keeps camera and library inputs distinct', () => {
    render()
    const inputs = [...container.querySelectorAll('input[type="file"]')]
    expect(inputs).toHaveLength(2)
    expect(inputs[0].getAttribute('accept')).toBe('image/*')
    expect(inputs[0].getAttribute('capture')).toBe('environment')
    expect(inputs[1].getAttribute('accept')).toBe('image/*')
    expect(inputs[1].hasAttribute('capture')).toBe(false)
    expect(inputs[0].getAttribute('aria-label')).not.toBe(
      inputs[1].getAttribute('aria-label'),
    )
  })

  it('sends both inputs through the same safe callback', () => {
    const onSelect = vi.fn()
    render({ onSelect })
    const file = new File(['image'], 'not-rendered.jpg', { type: 'image/jpeg' })
    for (const input of container.querySelectorAll<HTMLInputElement>('input[type="file"]')) {
      Object.defineProperty(input, 'files', { configurable: true, value: [file] })
      act(() => input.dispatchEvent(new Event('change', { bubbles: true })))
    }
    expect(onSelect).toHaveBeenNthCalledWith(1, file)
    expect(onSelect).toHaveBeenNthCalledWith(2, file)
    expect(container.textContent).not.toContain('not-rendered.jpg')
  })

  it('disables selection at quantity zero or the three-photo limit', () => {
    render({ selected: false })
    expect(
      [...container.querySelectorAll<HTMLInputElement>('input[type="file"]')].every(
        (input) => input.disabled,
      ),
    ).toBe(true)

    act(() => root.render(
      <ProductPhotoAttachment
        itemName="牛乳"
        selected
        photoCount={3}
        processing={false}
        disabled={false}
        onSelect={vi.fn()}
        onRemove={vi.fn()}
      />,
    ))
    expect(container.textContent).toContain('3枚まで')
  })

  it('shows compressed preview metadata but no filename', () => {
    render({ photo: pendingPhoto(), photoCount: 1, selected: false })
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:preview')
    expect(container.textContent).toContain('640 × 480px')
    expect(container.textContent).toContain('数量0のため共有対象外')
  })
})
