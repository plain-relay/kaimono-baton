import type { Product } from '../types/product'
import type { CreateDraftState } from '../types/shopping'
import { MAX_ITEM_CONDITION_CHARS } from '../constants/requestLimits'
import { normalizeRegularQuantity } from './draftLimits'
import { toStableCustomProductId } from './selectedRequestItems'
import { truncateUserCharacters } from './textLength'

type InitialCreateRequestState = {
  draft: CreateDraftState
  expandedProductIds: Set<string>
  wasNormalized: boolean
}

type CreateRequestInputState = {
  title: string
  defaultTitle: string
  draft: CreateDraftState
  productList: readonly Product[]
  customItemCount: number
  isCustomFormOpen: boolean
  customName: string
  customQuantity: number
  customUnit: string
  customMemo: string
  sharedUrl: string
  lastSharedUrl: string
  mode: string
  copyMessage: string
}

type CreateRequestSnapshotCustomItem = {
  id: string
  name: string
  quantity: number
  unit: string
  memo: string
}

type CreateRequestSnapshotInput = {
  title: string
  draft: CreateDraftState
  productList: readonly Product[]
  customItems: readonly CreateRequestSnapshotCustomItem[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeQuantity(value: unknown): number {
  return normalizeRegularQuantity(value)
}

export function createDraftState(
  saved: unknown,
  productList: readonly Product[],
): CreateDraftState {
  const savedItems = isRecord(saved) ? saved : {}
  const state: CreateDraftState = {}

  for (const product of productList) {
    const savedValue = savedItems[product.id]
    const savedItem = isRecord(savedValue) ? savedValue : undefined
    const memo =
      typeof savedItem?.memo === 'string' ? savedItem.memo : product.memo ?? ''
    state[product.id] = {
      quantity: normalizeQuantity(savedItem?.quantity),
      memo: truncateUserCharacters(memo, MAX_ITEM_CONDITION_CHARS),
    }
  }

  return state
}

export function createEmptyDraftState(productList: readonly Product[]): CreateDraftState {
  const state: CreateDraftState = {}

  for (const product of productList) {
    state[product.id] = {
      quantity: 0,
      memo: '',
    }
  }

  return state
}

export function getSavedExpandedProductIds(
  saved: unknown,
  productList: readonly Product[],
): Set<string> {
  const savedItems = isRecord(saved) ? saved : {}
  const expandedProductIds = new Set<string>()

  for (const product of productList) {
    const savedValue = savedItems[product.id]
    const savedItem = isRecord(savedValue) ? savedValue : undefined
    if (typeof savedItem?.memo === 'string' && savedItem.memo.trim()) {
      expandedProductIds.add(product.id)
    }
  }

  return expandedProductIds
}

export function createInitialCreateRequestState(
  saved: unknown,
  productList: readonly Product[],
): InitialCreateRequestState {
  const draft = createDraftState(saved, productList)
  const savedItems = isRecord(saved) ? saved : {}
  const wasNormalized = productList.some((product) => {
    const savedValue = savedItems[product.id]
    const savedItem = isRecord(savedValue) ? savedValue : undefined
    if (!savedItem) {
      return false
    }
    return (
      savedItem.quantity !== draft[product.id].quantity ||
      savedItem.memo !== draft[product.id].memo
    )
  })

  return {
    draft,
    expandedProductIds: getSavedExpandedProductIds(saved, productList),
    wasNormalized,
  }
}

export function hasAnyCreateRequestInput({
  title,
  defaultTitle,
  draft,
  productList,
  customItemCount,
  isCustomFormOpen,
  customName,
  customQuantity,
  customUnit,
  customMemo,
  sharedUrl,
  lastSharedUrl,
  mode,
  copyMessage,
}: CreateRequestInputState): boolean {
  if (
    title !== defaultTitle ||
    customItemCount > 0 ||
    isCustomFormOpen ||
    customName.trim() !== '' ||
    customQuantity !== 1 ||
    customUnit !== '個' ||
    customMemo.trim() !== '' ||
    sharedUrl !== '' ||
    lastSharedUrl !== '' ||
    mode !== 'edit' ||
    copyMessage !== ''
  ) {
    return true
  }

  const productsById = new Map(productList.map((product) => [product.id, product]))

  return Object.entries(draft).some(([productId, item]) => {
    if (item.quantity > 0) {
      return true
    }

    const condition = item.memo.trim()
    if (!condition) {
      return false
    }

    const masterCondition = productsById.get(productId)?.memo?.trim() ?? ''
    return condition !== masterCondition
  })
}

export function createRequestContentSnapshot({
  title,
  draft,
  productList,
  customItems,
}: CreateRequestSnapshotInput): string {
  const selectedProducts = productList
    .filter((product) => (draft[product.id]?.quantity ?? 0) > 0)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id, 'ja'))
    .map((product) => ({
      productId: product.id,
      name: product.name,
      unit: product.unit,
      categoryId: product.categoryId,
      sortOrder: product.sortOrder,
      quantity: normalizeQuantity(draft[product.id]?.quantity),
      memo: draft[product.id]?.memo.trim() ?? '',
    }))

  const normalizedCustomItems = customItems.map((item) => ({
    productId: toStableCustomProductId(item.id),
    name: item.name.trim(),
    quantity: normalizeQuantity(item.quantity),
    unit: item.unit.trim() || '個',
    memo: item.memo.trim(),
  }))

  return JSON.stringify({
    title: title.trim() || 'おつかい依頼',
    selectedProducts,
    customItems: normalizedCustomItems,
  })
}

export function canReuseSharedRequestUrl(
  currentSnapshot: string,
  sharedSnapshot: string,
  sharedUrl: string,
): boolean {
  return sharedUrl !== '' && currentSnapshot === sharedSnapshot
}

export function resolveSharedRequestUrl(
  currentSnapshot: string,
  sharedSnapshot: string,
  sharedUrl: string,
  createUrl: () => string,
): { url: string; snapshot: string; reused: boolean } {
  if (canReuseSharedRequestUrl(currentSnapshot, sharedSnapshot, sharedUrl)) {
    return { url: sharedUrl, snapshot: sharedSnapshot, reused: true }
  }

  return {
    url: createUrl(),
    snapshot: currentSnapshot,
    reused: false,
  }
}

export function increaseQuantity(currentQuantity: unknown): number {
  return normalizeQuantity(normalizeQuantity(currentQuantity) + 1)
}

export function decreaseQuantity(currentQuantity: unknown): number {
  return Math.max(0, normalizeQuantity(currentQuantity) - 1)
}

export function toggleExpandedProductId(
  current: ReadonlySet<string>,
  productId: string,
): Set<string> {
  const next = new Set(current)

  if (next.has(productId)) {
    next.delete(productId)
  } else {
    next.add(productId)
  }

  return next
}
