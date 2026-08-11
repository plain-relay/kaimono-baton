import {
  applyCustomItemAdd,
  applyQuantityChange,
} from '../../utils/draftLimits'
import {
  getEffectiveProducts,
  validateDraftLimits,
  type DraftLimitReason,
  type RequestBudgetContext,
  type RequestDraftData,
} from '../../utils/requestBudget'
import {
  sanitizeHandwritingText,
  toHandwritingDedupeKey,
} from './textSanitization'
import type { HandwritingImportSelection } from './types'

export type HandwritingImportApplyReason =
  | DraftLimitReason
  | 'invalid-selection'

export type HandwritingImportApplyResult = {
  accepted: boolean
  value: RequestDraftData
  changedItemCount: number
  reason?: HandwritingImportApplyReason
}

export function applyHandwritingImportSelections(
  current: RequestDraftData,
  selections: readonly HandwritingImportSelection[],
  context: RequestBudgetContext,
): HandwritingImportApplyResult {
  const availableProductIds = new Set(
    getEffectiveProducts(current)
      .filter((product) => !product.hidden)
      .map((product) => product.id),
  )
  const processedProductIds = new Set<string>()
  const processedCustomNames = new Set<string>()
  let candidate = current
  let changedItemCount = 0

  for (const selection of selections) {
    if (selection.kind === 'product') {
      if (
        !availableProductIds.has(selection.productId) ||
        processedProductIds.has(selection.productId)
      ) {
        if (!availableProductIds.has(selection.productId)) {
          return {
            accepted: false,
            value: current,
            changedItemCount: 0,
            reason: 'invalid-selection',
          }
        }
        continue
      }
      processedProductIds.add(selection.productId)

      if ((candidate.draft[selection.productId]?.quantity ?? 0) >= 1) {
        continue
      }
      const result = applyQuantityChange(
        candidate,
        selection.productId,
        1,
        context,
      )
      if (!result.accepted) {
        return {
          accepted: false,
          value: current,
          changedItemCount: 0,
          reason: result.reason ?? 'invalid-selection',
        }
      }
      candidate = result.value
      changedItemCount += 1
      continue
    }

    const name = sanitizeHandwritingText(selection.name)
    const comparisonName = toHandwritingDedupeKey(name)
    if (!comparisonName || processedCustomNames.has(comparisonName)) {
      continue
    }
    processedCustomNames.add(comparisonName)
    const result = applyCustomItemAdd(
      candidate,
      {
        id: selection.customItemId,
        name,
        quantity: 1,
        unit: '個',
        memo: '',
      },
      context,
    )
    if (!result.accepted) {
      return {
        accepted: false,
        value: current,
        changedItemCount: 0,
        reason: result.reason ?? 'invalid-selection',
      }
    }
    candidate = result.value
    changedItemCount += 1
  }

  const validation = validateDraftLimits(candidate, context)
  if (!validation.valid) {
    return {
      accepted: false,
      value: current,
      changedItemCount: 0,
      reason: validation.reason,
    }
  }

  return {
    accepted: true,
    value: candidate,
    changedItemCount,
  }
}
