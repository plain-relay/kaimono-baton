// @vitest-environment happy-dom

import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAX_SHARE_URL_LENGTH } from '../constants/requestLimits'
import { products } from '../data/products'
import type { CreateDraftState } from '../types/shopping'
import {
  applyConditionChange,
  type ConditionTarget,
} from '../utils/draftLimits'
import {
  calculateRequestBudget,
  countTotalConditionCharacters,
  type RequestBudgetContext,
  type RequestDraftData,
} from '../utils/requestBudget'
import {
  countUserCharacters,
  splitUserCharacters,
  truncateUserCharacters,
} from '../utils/textLength'
import { ImeAwareTextInput } from './ImeAwareTextInput'

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
  isComposing = false,
  inputType = isComposing ? 'insertCompositionText' : 'insertText',
) {
  setNativeInputValue(input, value)
  const event = new InputEvent('input', {
    bubbles: true,
    data: value,
    inputType,
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

function dispatchBlur(input: HTMLInputElement) {
  input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
}

function createDraft(): CreateDraftState {
  return Object.fromEntries(
    products.map((product) => [product.id, { quantity: 0, memo: '' }]),
  )
}

function fillConditions(total: number): RequestDraftData {
  const draft = createDraft()
  let remaining = total
  for (let index = 0; remaining > 0; index += 1) {
    const length = Math.min(30, remaining)
    draft[products[index].id] = {
      quantity: 1,
      memo: `条件${index}`.padEnd(length, '文').slice(0, length),
    }
    remaining -= length
  }
  return { title: 'IMEテスト', draft, customItems: [] }
}

const standardContext: RequestBudgetContext = {
  baseUrl: 'https://plain-relay.github.io/kaimono-baton',
  requestKey: 'ime-test-abcd',
}

function contextWithCandidateUrlLength(
  data: RequestDraftData,
  target: ConditionTarget,
  condition: string,
  targetLength: number,
): RequestBudgetContext {
  const candidate = applyConditionChange(data, target, condition, standardContext)
  const length = calculateRequestBudget(candidate.value, standardContext).urlLength
  return {
    ...standardContext,
    baseUrl: `${standardContext.baseUrl}${'x'.repeat(targetLength - length)}`,
  }
}

describe('ImeAwareTextInput', () => {
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

  function input(): HTMLInputElement {
    const element = container.querySelector<HTMLInputElement>('input')
    if (!element) {
      throw new Error('Input was not rendered')
    }
    return element
  }

  it('supports Android-style event order without losing or double-committing text', () => {
    const commits: string[] = []

    function Harness() {
      const [value, setValue] = useState('')
      return (
        <ImeAwareTextInput
          value={value}
          onCommit={(candidate) => {
            commits.push(candidate)
            setValue(candidate)
            return { value: candidate, accepted: candidate !== value }
          }}
        />
      )
    }

    act(() => root.render(<Harness />))
    act(() => dispatchComposition(input(), 'compositionstart', ''))
    act(() => dispatchInput(input(), 'あ', true))
    expect(input().value).toBe('あ')
    act(() => dispatchInput(input(), 'あか', true))
    expect(input().value).toBe('あか')
    act(() => {
      dispatchComposition(input(), 'compositionend', '赤いもの')
      dispatchInput(input(), '赤いもの', false)
    })

    expect(input().value).toBe('赤いもの')
    expect(commits).toEqual(['赤いもの'])
  })

  it('supports the alternative order where a non-composing input precedes compositionend', () => {
    const commits: string[] = []

    function Harness() {
      const [value, setValue] = useState('')
      return (
        <ImeAwareTextInput
          value={value}
          onCommit={(candidate) => {
            commits.push(candidate)
            setValue(candidate)
            return { value: candidate, accepted: true }
          }}
        />
      )
    }

    act(() => root.render(<Harness />))
    act(() => dispatchComposition(input(), 'compositionstart', ''))
    act(() => dispatchInput(input(), 'あ', true))
    act(() => dispatchInput(input(), '赤いもの', false))
    expect(input().value).toBe('赤いもの')
    expect(commits).toEqual([])
    act(() => dispatchComposition(input(), 'compositionend', '赤いもの'))

    expect(input().value).toBe('赤いもの')
    expect(commits).toEqual(['赤いもの'])
  })

  it('preserves composing text across an unrelated parent rerender', () => {
    function Harness() {
      const [value, setValue] = useState('')
      const [renderCount, setRenderCount] = useState(0)
      return (
        <>
          <ImeAwareTextInput
            value={value}
            onCommit={(candidate) => {
              setValue(candidate)
              return { value: candidate, accepted: true }
            }}
          />
          <button type="button" onClick={() => setRenderCount((count) => count + 1)}>
            rerender {renderCount}
          </button>
        </>
      )
    }

    act(() => root.render(<Harness />))
    act(() => dispatchComposition(input(), 'compositionstart', ''))
    act(() => dispatchInput(input(), 'あ', true))
    act(() => {
      container
        .querySelector('button')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(input().value).toBe('あ')
  })

  it('syncs external parent values only while no composition is active', () => {
    function Harness() {
      const [value, setValue] = useState('初期値')
      return (
        <>
          <ImeAwareTextInput
            value={value}
            onCommit={(candidate) => {
              setValue(candidate)
              return { value: candidate, accepted: true }
            }}
          />
          <button
            type="button"
            onClick={() =>
              setValue((current) =>
                current === '初期値' ? '外部更新1' : '外部更新2',
              )
            }
          >
            update
          </button>
        </>
      )
    }

    act(() => root.render(<Harness />))
    act(() =>
      container
        .querySelector('button')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true })),
    )
    expect(input().value).toBe('外部更新1')

    act(() => dispatchComposition(input(), 'compositionstart', '外部更新1'))
    act(() => dispatchInput(input(), 'へんかん', true))
    act(() =>
      container
        .querySelector('button')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true })),
    )
    expect(input().value).toBe('へんかん')

    act(() => dispatchComposition(input(), 'compositionend', '変換確定'))
    expect(input().value).toBe('変換確定')
  })

  it('uses the normalized parent result and keeps grapheme clusters intact', () => {
    function Harness() {
      const [value, setValue] = useState('')
      return (
        <ImeAwareTextInput
          value={value}
          onCommit={(candidate) => {
            const normalized = truncateUserCharacters(candidate, 30)
            setValue(normalized)
            return {
              value: normalized,
              accepted: normalized !== value,
              reason: normalized === candidate ? undefined : 'field-limit',
            }
          }}
        />
      )
    }

    const clusters = ['👍🏽', '👨‍👩‍👧‍👦', 'e\u0301', 'が']
    const candidate = Array.from({ length: 31 }, (_, index) => clusters[index % 4]).join('')
    act(() => root.render(<Harness />))
    act(() => dispatchComposition(input(), 'compositionstart', ''))
    act(() => dispatchComposition(input(), 'compositionend', candidate))

    expect(countUserCharacters(input().value)).toBe(30)
    expect(input().value).toBe(splitUserCharacters(candidate).slice(0, 30).join(''))
  })

  it('accepts half-width text, symbols, and pasted emoji up to the parent limit', () => {
    const commits: string[] = []

    function Harness() {
      const [value, setValue] = useState('')
      return (
        <ImeAwareTextInput
          value={value}
          onCommit={(candidate) => {
            const normalized = truncateUserCharacters(candidate, 5)
            commits.push(normalized)
            setValue(normalized)
            return { value: normalized, accepted: normalized !== value }
          }}
        />
      )
    }

    act(() => root.render(<Harness />))
    act(() => dispatchInput(input(), '123ab', false))
    expect(input().value).toBe('123ab')
    act(() =>
      dispatchInput(input(), 'あいうえおかきく', false, 'insertFromPaste'),
    )
    expect(input().value).toBe('あいうえお')
    act(() => dispatchInput(input(), 'a!?😀👍🏽👨‍👩‍👧‍👦', false, 'insertFromPaste'))

    expect(input().value).toBe('a!?😀👍🏽')
    expect(commits).toEqual(['123ab', 'あいうえお', 'a!?😀👍🏽'])
    expect(input().hasAttribute('maxlength')).toBe(false)
  })

  it('does not commit on composing blur and does not duplicate after compositionend blur', () => {
    const commits: string[] = []

    function Harness() {
      const [value, setValue] = useState('')
      return (
        <ImeAwareTextInput
          value={value}
          onCommit={(candidate) => {
            commits.push(candidate)
            setValue(candidate)
            return { value: candidate, accepted: true }
          }}
        />
      )
    }

    act(() => root.render(<Harness />))
    act(() => dispatchInput(input(), 'abc', false))
    act(() => dispatchBlur(input()))
    expect(input().value).toBe('abc')
    expect(commits).toEqual(['abc'])

    act(() => dispatchComposition(input(), 'compositionstart', 'abc'))
    act(() => dispatchInput(input(), 'abcみ', true))
    act(() => dispatchBlur(input()))
    expect(input().value).toBe('abcみ')
    expect(commits).toEqual(['abc'])

    act(() => dispatchComposition(input(), 'compositionend', 'abc蜜柑'))
    act(() => dispatchBlur(input()))
    expect(input().value).toBe('abc蜜柑')
    expect(commits).toEqual(['abc', 'abc蜜柑'])
  })

  it('shows the five-character remainder accepted by the total-condition logic', () => {
    const target: ConditionTarget = {
      kind: 'product',
      productId: products[34].id,
    }
    const initialData = fillConditions(995)
    initialData.draft[products[34].id] = { quantity: 1, memo: '' }

    function Harness() {
      const [data, setData] = useState(initialData)
      const value = data.draft[products[34].id].memo
      return (
        <>
          <ImeAwareTextInput
            value={value}
            onCommit={(candidate) => {
              const result = applyConditionChange(
                data,
                target,
                candidate,
                standardContext,
              )
              if (result.accepted) {
                setData(result.value)
              }
              return {
                value: result.value.draft[products[34].id].memo,
                accepted: result.accepted,
                reason: result.reason,
              }
            }}
          />
          <output>{countTotalConditionCharacters(data)}</output>
        </>
      )
    }

    act(() => root.render(<Harness />))
    act(() => dispatchComposition(input(), 'compositionstart', ''))
    act(() => dispatchComposition(input(), 'compositionend', 'あいうえおかきくけこ'))

    expect(input().value).toBe('あいうえお')
    expect(container.querySelector('output')?.textContent).toBe('1000')
  })

  it('shows the longest prefix accepted by the real 2,200-character URL budget', () => {
    const target: ConditionTarget = { kind: 'product', productId: 'cabbage' }
    const initialData: RequestDraftData = {
      title: 'URL予算',
      draft: createDraft(),
      customItems: [],
    }
    initialData.draft.cabbage = { quantity: 1, memo: '' }
    const candidate = '赤青黄緑白黒紫橙金銀'
    const context = contextWithCandidateUrlLength(
      initialData,
      target,
      candidate,
      MAX_SHARE_URL_LENGTH + 8,
    )

    function Harness() {
      const [data, setData] = useState(initialData)
      const value = data.draft.cabbage.memo
      return (
        <>
          <ImeAwareTextInput
            value={value}
            onCommit={(proposed) => {
              const result = applyConditionChange(data, target, proposed, context)
              if (result.accepted) {
                setData(result.value)
              }
              return {
                value: result.value.draft.cabbage.memo,
                accepted: result.accepted,
                reason: result.reason,
              }
            }}
          />
          <output>{calculateRequestBudget(data, context).urlLength}</output>
        </>
      )
    }

    act(() => root.render(<Harness />))
    act(() => dispatchComposition(input(), 'compositionstart', ''))
    act(() => dispatchComposition(input(), 'compositionend', candidate))

    expect(input().value.length).toBeGreaterThan(0)
    expect(input().value.length).toBeLessThan(candidate.length)
    expect(Number(container.querySelector('output')?.textContent)).toBeLessThanOrEqual(
      MAX_SHARE_URL_LENGTH,
    )
  })
})
