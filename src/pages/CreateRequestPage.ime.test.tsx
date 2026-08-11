// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CreateRequestPage } from './CreateRequestPage'

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

function click(element: Element | null) {
  if (!element) {
    throw new Error('Clickable element was not found')
  }
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

function queryInput(container: Element, selector: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(selector)
  if (!input) {
    throw new Error(`Input not found: ${selector}`)
  }
  return input
}

function commitJapaneseText(input: HTMLInputElement, interim: string, final: string) {
  dispatchComposition(input, 'compositionstart', input.value)
  dispatchInput(input, interim, true)
  expect(input.value).toBe(interim)
  dispatchComposition(input, 'compositionend', final)
}

describe('CreateRequestPage shared IME inputs', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true
    localStorage.clear()
    window.history.replaceState({}, '', '/#/create')
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root.render(<CreateRequestPage onBackHome={() => undefined} />))
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    localStorage.clear()
  })

  it('removes the title input and keeps the shared IME input for regular conditions', () => {
    expect(container.textContent).not.toContain('依頼タイトル')
    expect(container.querySelector('#request-title-count')).toBeNull()
    act(() =>
      click(
        container.querySelector(
          'button[aria-label^="キャベツを1個増やす"]',
        ),
      ),
    )
    act(() =>
      click(
        container.querySelector(
          'button[aria-controls="product-condition-cabbage"]',
        ),
      ),
    )
    const condition = queryInput(
      container,
      '[aria-describedby="product-condition-cabbage-count"]',
    )
    act(() => commitJapaneseText(condition, 'あか', '赤いもの'))

    expect(condition.value).toBe('赤いもの')
    expect(
      container.querySelector('#product-condition-cabbage-count')?.textContent,
    ).toContain('4 / 30')
    expect(condition.hasAttribute('maxlength')).toBe(false)
  })

  it('uses the same IME foundation for custom name, unit, and condition', () => {
    act(() => click(container.querySelector('.custom-add-button')))

    const name = queryInput(container, '[aria-describedby="custom-name-count"]')
    act(() => commitJapaneseText(name, 'せん', '洗濯ネット'))
    expect(name.value).toBe('洗濯ネット')
    expect(container.querySelector('#custom-name-count')?.textContent).toContain(
      '5 / 30',
    )

    expect(container.querySelector('[aria-describedby="custom-unit-count"]')).toBeNull()
    act(() =>
      click(
        [...container.querySelectorAll('button')].find(
          (candidate) => candidate.textContent?.trim() === '詳細設定',
        ) ?? null,
      ),
    )
    const unit = queryInput(container, '[aria-describedby="custom-unit-count"]')
    act(() => commitJapaneseText(unit, 'ぱ', 'パック'))
    expect(unit.value).toBe('パック')
    expect(container.querySelector('#custom-unit-count')?.textContent).toContain(
      '3 / 10',
    )

    act(() =>
      click(
        [...container.querySelectorAll('button')].find(
          (candidate) => candidate.textContent?.trim() === '詳細設定を閉じる',
        ) ?? null,
      ),
    )
    expect(container.querySelector('[aria-describedby="custom-unit-count"]')).toBeNull()
    act(() =>
      click(
        [...container.querySelectorAll('button')].find(
          (candidate) => candidate.textContent?.trim() === '詳細設定',
        ) ?? null,
      ),
    )
    const reopenedUnit = queryInput(
      container,
      '[aria-describedby="custom-unit-count"]',
    )
    expect(reopenedUnit.value).toBe('パック')
    act(() => commitJapaneseText(reopenedUnit, 'たん', '単'.repeat(11)))
    expect(reopenedUnit.value).toBe('単'.repeat(10))
    expect(container.textContent).toContain('単位は10文字までです。')

    const condition = queryInput(
      container,
      '[aria-describedby="custom-condition-count"]',
    )
    act(() => commitJapaneseText(condition, 'やす', '安いもの'))
    expect(condition.value).toBe('安いもの')
    expect(container.querySelector('#custom-condition-count')?.textContent).toContain(
      '4 / 30',
    )

    for (const input of [name, unit, condition]) {
      expect(input.hasAttribute('maxlength')).toBe(false)
    }
  })
})
