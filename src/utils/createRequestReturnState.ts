import type { CustomRequestDraftItem } from './requestBudget'

export type CreateRequestReturnState = {
  customItems: CustomRequestDraftItem[]
  expandedProductIds: string[]
  sharedUrl: string
  sharedSnapshot: string
}

export const CREATE_REQUEST_RETURN_STATE_KEY =
  'otsukaiCreateRequestReturnState'

type HistoryAdapter = Pick<History, 'state' | 'replaceState'>

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function parseCreateRequestReturnState(
  historyState: unknown,
): CreateRequestReturnState | undefined {
  const value = isRecord(historyState)
    ? historyState[CREATE_REQUEST_RETURN_STATE_KEY]
    : undefined

  if (
    !isRecord(value) ||
    typeof value.sharedUrl !== 'string' ||
    typeof value.sharedSnapshot !== 'string' ||
    !Array.isArray(value.expandedProductIds) ||
    !value.expandedProductIds.every((item) => typeof item === 'string') ||
    !Array.isArray(value.customItems)
  ) {
    return undefined
  }

  const customItems = value.customItems.filter(
    (item): item is CustomRequestDraftItem =>
      isRecord(item) &&
      typeof item.id === 'string' &&
      typeof item.name === 'string' &&
      typeof item.quantity === 'number' &&
      Number.isFinite(item.quantity) &&
      typeof item.unit === 'string' &&
      typeof item.memo === 'string',
  )

  return {
    customItems,
    expandedProductIds: [...value.expandedProductIds],
    sharedUrl: value.sharedUrl,
    sharedSnapshot: value.sharedSnapshot,
  }
}

export function loadCreateRequestReturnState(
  history: HistoryAdapter = window.history,
): CreateRequestReturnState | undefined {
  return parseCreateRequestReturnState(history.state)
}

export function saveCreateRequestReturnState(
  state: CreateRequestReturnState,
  history: HistoryAdapter = window.history,
) {
  const historyState = isRecord(history.state) ? history.state : {}
  history.replaceState(
    { ...historyState, [CREATE_REQUEST_RETURN_STATE_KEY]: state },
    '',
  )
}

export function clearCreateRequestReturnState(
  history: HistoryAdapter = window.history,
) {
  if (
    !isRecord(history.state) ||
    !(CREATE_REQUEST_RETURN_STATE_KEY in history.state)
  ) {
    return
  }

  const { [CREATE_REQUEST_RETURN_STATE_KEY]: _returnState, ...historyState } =
    history.state
  history.replaceState(historyState, '')
}
