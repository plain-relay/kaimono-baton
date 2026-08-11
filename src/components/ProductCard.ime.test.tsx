// @vitest-environment happy-dom

import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Product } from '../types/product'
import { ProductCard } from './ProductCard'

const product: Product = {
  id: 'cabbage',
  name: 'キャベツ',
  categoryId: 'vegetables',
  defaultQuantity: 1,
  unit: '個',
  icon: '🥬',
  sortOrder: 1,
}

function setNativeInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set
  if (!setter) {
    throw new Error('HTMLInputElement.value setter is unavailable')
  }
  setter.call(input, value)
}

function dispatchInput(
  input: HTMLInputElement,
  value: string,
  isComposing: boolean,
) {
  setNativeInputValue(input, value)
  const event = new InputEvent('input', {
    bubbles: true,
    data: value,
    inputType: isComposing ? 'insertCompositionText' : 'insertText',
  })
  Object.defineProperty(event, 'isComposing', {
    configurable: true,
    value: isComposing,
  })
  input.dispatchEvent(event)
}

function dispatchComposition(
  input: HTMLInputElement,
  type: 'compositionstart' | 'compositionend',
  value: string,
) {
  setNativeInputValue(input, value)
  input.dispatchEvent(
    new CompositionEvent(type, { bubbles: true, data: value }),
  )
}

describe('ProductCard Japanese IME input', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('keeps Android-style composing text visible and commits the conversion once', () => {
    const commits: string[] = []

    function Harness() {
      const [memo, setMemo] = useState('')
      return (
        <>
          <ProductCard
            product={product}
            draft={{ quantity: 1, memo }}
            isExpanded
            onIncrease={() => undefined}
            onDecrease={() => undefined}
            onToggleDetails={() => undefined}
            onMemoCommit={(value) => {
              commits.push(value)
              setMemo(value)
              return { value, accepted: true }
            }}
          />
          <output data-testid="committed-value">{memo}</output>
        </>
      )
    }

    act(() => root.render(<Harness />))
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="キャベツの条件"]',
    )
    expect(input).not.toBeNull()

    act(() => dispatchComposition(input!, 'compositionstart', ''))
    act(() => dispatchInput(input!, 'あ', true))
    expect(input!.value).toBe('あ')
    expect(commits).toEqual([])

    act(() => dispatchInput(input!, 'あか', true))
    expect(input!.value).toBe('あか')
    expect(commits).toEqual([])

    act(() => dispatchComposition(input!, 'compositionend', '赤いもの'))
    act(() => dispatchInput(input!, '赤いもの', false))

    expect(input!.value).toBe('赤いもの')
    expect(
      container.querySelector('[data-testid="committed-value"]')?.textContent,
    ).toBe('赤いもの')
    expect(commits).toEqual(['赤いもの'])
  })
})
