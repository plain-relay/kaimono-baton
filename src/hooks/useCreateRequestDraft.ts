import { useEffect, useMemo, useRef, useState } from 'react'
import { FIXED_REQUEST_TITLE } from '../constants/request'
import type { EffectiveProduct } from '../types/householdCatalog'
import type { CreateDraftState } from '../types/shopping'
import { createInitialCreateRequestState } from '../utils/createRequestState'
import {
  clearCreateRequestReturnState,
  loadCreateRequestReturnState,
} from '../utils/createRequestReturnState'
import {
  applyConditionChange,
  applyCustomItemAdd,
  applyCustomItemDelete,
  applyCustomItemUpdate,
  applyQuantityChange,
  normalizeRequestDraftData,
} from '../utils/draftLimits'
import type {
  CustomRequestDraftItem,
  RequestBudgetContext,
  RequestDraftData,
} from '../utils/requestBudget'
import { loadCreateDraft, saveCreateDraft } from '../utils/storage'

type DraftInput = {
  draft: CreateDraftState
  customItems: CustomRequestDraftItem[]
}

type DraftChange = { accepted: boolean; value: RequestDraftData }

function restoreDraft(effectiveProducts: readonly EffectiveProduct[]) {
  const returnState = loadCreateRequestReturnState()
  const initialDraft = createInitialCreateRequestState(
    loadCreateDraft(),
    effectiveProducts,
  )
  const normalized = normalizeRequestDraftData({
    title: FIXED_REQUEST_TITLE,
    draft: initialDraft.draft,
    customItems: returnState?.customItems ?? [],
    effectiveProducts,
  })

  return {
    draft: normalized.value.draft,
    expandedProductIds: new Set(
      returnState?.expandedProductIds ?? initialDraft.expandedProductIds,
    ),
    customItems: [...normalized.value.customItems],
    returnState,
    wasNormalized: initialDraft.wasNormalized || normalized.normalized,
  }
}

export function useCreateRequestDraft({
  effectiveProducts,
  budgetContext,
}: {
  effectiveProducts: readonly EffectiveProduct[]
  budgetContext: RequestBudgetContext
}) {
  // Review/share metadata is read once for the page's initial UI, not owned here.
  const [initialPageState] = useState(() => restoreDraft(effectiveProducts))
  const [input, setInput] = useState<DraftInput>(() => ({
    draft: initialPageState.draft,
    customItems: initialPageState.customItems,
  }))
  const inputRef = useRef(input)
  const requestData = useMemo<RequestDraftData>(
    () => ({ title: FIXED_REQUEST_TITLE, ...input, effectiveProducts }),
    [input, effectiveProducts],
  )

  useEffect(() => {
    saveCreateDraft(input.draft)
  }, [input.draft])

  useEffect(() => {
    const clearReturnState = () => clearCreateRequestReturnState()
    clearReturnState()
    window.addEventListener('pageshow', clearReturnState)
    return () => window.removeEventListener('pageshow', clearReturnState)
  }, [])

  const currentData = (): RequestDraftData => ({
    title: FIXED_REQUEST_TITLE,
    ...inputRef.current,
    effectiveProducts,
  })

  const replaceInput = (next: DraftInput) => {
    inputRef.current = next
    setInput(next)
  }

  // Validate and commit against the same latest input, including batched edits.
  function applyChange<T extends DraftChange>(
    change: (current: RequestDraftData) => T,
  ): T {
    const result = change(currentData())
    if (result.accepted) {
      replaceInput({
        draft: result.value.draft,
        customItems: [...result.value.customItems],
      })
    }
    return result
  }

  const changeQuantity = (productId: string, delta: number) =>
    applyChange((current) =>
      applyQuantityChange(
        current,
        productId,
        (current.draft[productId]?.quantity ?? 0) + delta,
        budgetContext,
      ),
    )

  const changeCondition = (productId: string, value: string) =>
    applyChange((current) =>
      applyConditionChange(
        current,
        { kind: 'product', productId },
        value,
        budgetContext,
      ),
    )

  const previewCustomItem = (
    item: CustomRequestDraftItem,
    editingIndex: number | null,
  ) =>
    editingIndex === null
      ? applyCustomItemAdd(currentData(), item, budgetContext)
      : applyCustomItemUpdate(currentData(), editingIndex, item, budgetContext)

  const saveCustomItem = (
    item: CustomRequestDraftItem,
    editingIndex: number | null,
  ) =>
    applyChange((current) =>
      editingIndex === null
        ? applyCustomItemAdd(current, item, budgetContext)
        : applyCustomItemUpdate(current, editingIndex, item, budgetContext),
    )

  const deleteCustomItem = (index: number) =>
    applyChange((current) => applyCustomItemDelete(current, index))

  const resetDraft = (draft: CreateDraftState) => {
    replaceInput({ draft, customItems: [] })
    saveCreateDraft(draft)
    clearCreateRequestReturnState()
  }

  return {
    initialPageState,
    draft: input.draft,
    customItems: input.customItems,
    requestData,
    changeQuantity,
    changeCondition,
    previewCustomItem,
    saveCustomItem,
    deleteCustomItem,
    applyChange,
    resetDraft,
  }
}
