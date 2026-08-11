// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ShoppingDialog } from './ShoppingDialog'

describe('ShoppingDialog', () => {
  let container: HTMLDivElement
  let opener: HTMLButtonElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true
    opener = document.createElement('button')
    opener.textContent = 'Open dialog'
    container = document.createElement('div')
    document.body.append(opener, container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    opener.remove()
    container.remove()
    document.body.style.overflow = ''
    vi.restoreAllMocks()
  })

  function renderDialog(
    onClose = vi.fn(),
    children = (
      <>
        <button type="button" data-testid="first">
          First
        </button>
        <button type="button" disabled data-testid="disabled">
          Disabled
        </button>
        <button type="button" data-testid="last">
          Last
        </button>
      </>
    ),
  ) {
    act(() => {
      root.render(
        <ShoppingDialog
          title="Confirm item"
          titleId="dialog-title"
          descriptionId="dialog-description"
          onClose={onClose}
        >
          <p id="dialog-description">Dialog details</p>
          {children}
        </ShoppingDialog>,
      )
    })
    return onClose
  }

  function keydown(key: string, shiftKey = false) {
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key,
          shiftKey,
          bubbles: true,
          cancelable: true,
        }),
      )
    })
  }

  it('traps forward and reverse Tab focus without selecting disabled controls', () => {
    renderDialog()
    const heading = container.querySelector<HTMLHeadingElement>('#dialog-title')
    const first = container.querySelector<HTMLButtonElement>(
      '[data-testid="first"]',
    )
    const disabled = container.querySelector<HTMLButtonElement>(
      '[data-testid="disabled"]',
    )
    const last = container.querySelector<HTMLButtonElement>(
      '[data-testid="last"]',
    )
    expect(document.activeElement).toBe(heading)

    last?.focus()
    keydown('Tab')
    expect(document.activeElement).toBe(first)

    heading?.focus()
    keydown('Tab', true)
    expect(document.activeElement).toBe(last)

    first?.focus()
    keydown('Tab', true)
    expect(document.activeElement).toBe(last)
    expect(document.activeElement).not.toBe(disabled)
  })

  it('keeps focus on the heading when no enabled focusable control exists', () => {
    renderDialog(
      vi.fn(),
      <button type="button" disabled>
        Disabled
      </button>,
    )
    const heading = container.querySelector<HTMLHeadingElement>('#dialog-title')

    keydown('Tab')

    expect(document.activeElement).toBe(heading)
  })

  it('closes only for a backdrop mousedown, not a dialog mousedown', () => {
    const onClose = renderDialog()
    const backdrop = container.querySelector('.shopping-dialog-backdrop')
    const dialog = container.querySelector('.shopping-dialog')

    act(() => {
      dialog?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(onClose).not.toHaveBeenCalled()

    act(() => {
      backdrop?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape, restores the opener focus, and restores body overflow', () => {
    const onClose = vi.fn()
    document.body.style.overflow = 'clip'
    opener.focus()
    renderDialog(onClose)
    expect(document.body.style.overflow).toBe('hidden')

    keydown('Escape')
    expect(onClose).toHaveBeenCalledTimes(1)

    act(() => {
      root.render(null)
    })
    expect(document.activeElement).toBe(opener)
    expect(document.body.style.overflow).toBe('clip')
  })

  it('does not accumulate keydown listeners across repeated openings', () => {
    const onClose = vi.fn()
    renderDialog(onClose)
    keydown('Escape')
    expect(onClose).toHaveBeenCalledTimes(1)

    act(() => {
      root.render(null)
    })
    renderDialog(onClose)
    keydown('Escape')

    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
