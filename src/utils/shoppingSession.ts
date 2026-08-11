import type {
  ConsultationMap,
  ShoppingRequestPayload,
} from '../types/shopping'
import { decodeCompactRequestV2OrV3 } from './compactRequestV3'
import { decodeCompactRequestV4Payload } from './compactRequestV4'
import { decodeCompressedRequestJson } from './requestPayloadDecoder'
import {
  migrateLegacyConsultingState,
  reconcileConsultations,
} from './consultationState'
import { decodeShoppingRequest } from './encodeRequest'
import {
  getItemStatus,
  isCartStatus,
  reconcileCheckedStateWithIssues,
  reconcileItemIssues,
  type ShoppingStateSnapshot,
} from './shoppingState'
import {
  loadCartOrder,
  loadCheckedState,
  loadConsultations,
  loadItemIssues,
} from './storage'

export type RequestRouteCodec = 'legacy-query' | 'compact-path'

export type LoadedShoppingSession = {
  payload: ShoppingRequestPayload
  shoppingState: ShoppingStateSnapshot
  consultations: ConsultationMap
}

export function decodeShoppingSessionPayload(input: {
  encodedPayload: string
  codec: RequestRouteCodec
}): ShoppingRequestPayload {
  if (input.codec !== 'compact-path') {
    return decodeShoppingRequest(input.encodedPayload)
  }

  const value = decodeCompressedRequestJson(
    input.encodedPayload,
    '共有URLの復元に失敗しました。',
  )
  return Array.isArray(value) && value[0] === 4
    ? decodeCompactRequestV4Payload(value)
    : decodeCompactRequestV2OrV3(input.encodedPayload)
}

export function restoreShoppingSession(
  payload: ShoppingRequestPayload,
): LoadedShoppingSession {
  return reconcileShoppingSession(
    payload,
    {
      checkedState: loadCheckedState(payload.requestId),
      itemIssues: loadItemIssues(payload.requestId),
      cartOrder: loadCartOrder(payload.requestId),
    },
    loadConsultations(payload.requestId),
  )
}

export function reconcileShoppingSession(
  payload: ShoppingRequestPayload,
  currentState: ShoppingStateSnapshot,
  currentConsultations: ConsultationMap,
): LoadedShoppingSession {
  const requestItemIds = new Set(payload.items.map((item) => item.id))
  const storedCheckedState = Object.fromEntries(
    Object.entries(currentState.checkedState).filter(([itemId]) =>
      requestItemIds.has(itemId),
    ),
  )
  const storedItemIssues = Object.fromEntries(
    Object.entries(currentState.itemIssues).filter(([itemId]) =>
      requestItemIds.has(itemId),
    ),
  )
  const migration = migrateLegacyConsultingState(
    storedCheckedState,
    storedItemIssues,
    currentConsultations,
  )
  const checkedState = reconcileCheckedStateWithIssues(
    migration.checkedState,
    migration.itemIssues,
  )
  const itemIssues = reconcileItemIssues(
    migration.itemIssues,
    checkedState,
  )
  const consultations = reconcileConsultations(
    migration.consultations,
    [...requestItemIds],
  )
  const cartOrder = currentState.cartOrder.filter(
    (itemId) =>
      requestItemIds.has(itemId) &&
      isCartStatus(getItemStatus(checkedState, itemId)),
  )

  return {
    payload,
    shoppingState: {
      checkedState,
      itemIssues,
      cartOrder,
    },
    consultations,
  }
}

export function loadShoppingSession(input: {
  encodedPayload: string
  codec: RequestRouteCodec
}): LoadedShoppingSession {
  return restoreShoppingSession(decodeShoppingSessionPayload(input))
}
