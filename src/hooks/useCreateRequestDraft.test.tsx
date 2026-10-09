// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { products } from '../data/products'
import { MAX_CUSTOM_ITEMS, MAX_SHARE_URL_LENGTH } from '../constants/requestLimits'
import type { EffectiveProduct } from '../types/householdCatalog'
import { createDraftState, createEmptyDraftState } from '../utils/createRequestState'
import { saveCreateRequestReturnState } from '../utils/createRequestReturnState'
import type { CustomRequestDraftItem, RequestBudgetContext } from '../utils/requestBudget'
import { useCreateRequestDraft } from './useCreateRequestDraft'

const productList: EffectiveProduct[] = products.slice(0, 2).map((product) => ({
  ...product,
  source: 'base',
  hidden: false,
  isCustomized: false,
  memo: 'いつもの条件',
}))
const firstId = productList[0].id
const secondId = productList[1].id
const customItem: CustomRequestDraftItem = {
  id: 'custom-fixture', name: '検証用商品', quantity: 1, unit: '袋', memo: '',
}

describe('useCreateRequestDraft input ownership', () => {
  let container: HTMLDivElement
  let root: Root
  let draft: ReturnType<typeof useCreateRequestDraft>
  let effectiveProducts: readonly EffectiveProduct[]
  let budgetContext: RequestBudgetContext

  function Harness() {
    draft = useCreateRequestDraft({ effectiveProducts, budgetContext })
    return null
  }

  function render() {
    act(() => root.render(<Harness />))
  }

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    window.localStorage.clear()
    window.history.replaceState({}, '', '/#/create')
    effectiveProducts = productList
    budgetContext = { baseUrl: 'https://example.test/', requestKey: 'fixture-key' }
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    window.localStorage.clear()
    window.history.replaceState({}, '', '/')
    vi.restoreAllMocks()
  })

  it('restores explicit empty conditions and return items before discarding transient history', () => {
    window.localStorage.setItem('otsukai:createDraft', JSON.stringify({
      [firstId]: { quantity: 2, memo: '' },
    }))
    window.history.replaceState({ keep: true }, '')
    saveCreateRequestReturnState({
      customItems: [customItem], expandedProductIds: [firstId],
      sharedUrl: 'https://example.test/#/l/fixture', sharedSnapshot: 'fixture',
    })
    render()

    expect(draft.draft[firstId]).toEqual({ quantity: 2, memo: '' })
    expect(draft.draft[secondId].memo).toBe('いつもの条件')
    expect(draft.customItems).toEqual([customItem])
    expect(draft.initialPageState.expandedProductIds).toEqual(new Set([firstId]))
    expect(draft.initialPageState.returnState?.sharedSnapshot).toBe('fixture')
    expect(window.history.state).toEqual({ keep: true })
    expect(JSON.parse(window.localStorage.getItem('otsukai:createDraft')!)).toEqual(draft.draft)
  })

  it('normalizes restored values and reports the adjustment to the page', () => {
    window.localStorage.setItem('otsukai:createDraft', JSON.stringify({
      [firstId]: { quantity: 999, memo: '長'.repeat(40) },
    }))
    saveCreateRequestReturnState({
      customItems: [{ ...customItem, quantity: 0 }], expandedProductIds: [],
      sharedUrl: '', sharedSnapshot: '',
    })
    render()
    expect(draft.initialPageState.wasNormalized).toBe(true)
    expect(draft.draft[firstId]).toEqual({ quantity: 20, memo: '長'.repeat(30) })
    expect(draft.customItems[0].quantity).toBe(1)
  })

  it('applies consecutive quantity and condition edits to the same latest input', () => {
    render()
    act(() => {
      draft.changeQuantity(firstId, 1)
      draft.changeCondition(firstId, '今回の条件')
      draft.changeQuantity(firstId, 1)
      draft.changeQuantity(secondId, 1)
    })
    expect(draft.draft[firstId]).toEqual({ quantity: 2, memo: '今回の条件' })
    expect(draft.draft[secondId].quantity).toBe(1)
    expect(JSON.parse(window.localStorage.getItem('otsukai:createDraft')!)).toEqual(draft.draft)
  })

  it('previews without committing and preserves custom IDs through edit and deletion', () => {
    render()
    act(() => {
      expect(draft.previewCustomItem(customItem, null).accepted).toBe(true)
    })
    expect(draft.customItems).toEqual([])
    act(() => {
      draft.saveCustomItem(customItem, null)
      draft.saveCustomItem({ ...customItem, quantity: 3, memo: '一時条件' }, 0)
      draft.saveCustomItem({ ...customItem, id: 'second-fixture' }, null)
      draft.deleteCustomItem(0)
    })
    expect(draft.customItems).toEqual([{ ...customItem, id: 'second-fixture' }])
    act(() => {
      const invalid = draft.deleteCustomItem(99)
      expect(invalid.accepted).toBe(false)
    })
    expect(draft.customItems[0].id).toBe('second-fixture')
  })

  it('enforces the custom-item limit across batched additions without losing accepted items', () => {
    render()
    act(() => {
      for (let index = 0; index < MAX_CUSTOM_ITEMS; index += 1) {
        expect(draft.saveCustomItem({ ...customItem, id: `fixture-${index}` }, null).accepted).toBe(true)
      }
      const rejected = draft.saveCustomItem({ ...customItem, id: 'overflow' }, null)
      expect(rejected).toMatchObject({ accepted: false, reason: 'custom-item-limit' })
    })
    expect(draft.customItems.map((item) => item.id)).toEqual(
      Array.from({ length: MAX_CUSTOM_ITEMS }, (_, index) => `fixture-${index}`),
    )
  })

  it('uses updated catalog and budget context without overwriting an existing condition', () => {
    render()
    act(() => draft.changeCondition(firstId, '今回だけ'))
    effectiveProducts = productList.map((product) => ({ ...product, memo: '新しい初期条件' }))
    budgetContext = { ...budgetContext, baseUrl: `https://example.test/${'x'.repeat(MAX_SHARE_URL_LENGTH)}` }
    render()
    act(() => {
      expect(draft.changeQuantity(firstId, 1)).toMatchObject({ accepted: false, reason: 'url-limit' })
    })
    expect(draft.draft[firstId]).toEqual({ quantity: 0, memo: '今回だけ' })
    expect(draft.requestData.effectiveProducts).toBe(effectiveProducts)
  })

  it('clears custom items on reset and validates subsequent edits against the reset draft', () => {
    render()
    act(() => {
      draft.changeQuantity(firstId, 1)
      draft.saveCustomItem(customItem, null)
      draft.resetDraft(createEmptyDraftState(effectiveProducts))
      draft.changeQuantity(firstId, 1)
    })
    expect(draft.draft[firstId]).toEqual({ quantity: 1, memo: '' })
    expect(draft.customItems).toEqual([])
    act(() => draft.resetDraft(createDraftState(undefined, effectiveProducts)))
    expect(draft.draft[firstId]).toEqual({ quantity: 0, memo: 'いつもの条件' })
  })

  it('retains input when storage cannot be written', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('fixture storage full', 'QuotaExceededError')
    })
    render()
    act(() => draft.changeQuantity(firstId, 1))
    expect(draft.draft[firstId].quantity).toBe(1)
    expect(window.localStorage.getItem('otsukai:createDraft')).toBeNull()
    expect(warn).toHaveBeenCalled()
  })
})
