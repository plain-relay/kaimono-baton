import type {
  CartOrderList,
  CheckedStateMap,
  ConsultationMap,
  CreateDraftState,
  ItemIssueMap,
} from '../types/shopping'
import { normalizeConsultations } from './consultationState'
import { normalizeCartOrder, normalizeCheckedState, normalizeItemIssues } from './shoppingState'

const CREATE_DRAFT_KEY = 'otsukai:createDraft'
const LAST_SHARED_URL_KEY = 'otsukai:lastSharedUrl'

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson<T>(key: string, value: T): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch (error) {
    console.warn(`Failed to write localStorage key: ${key}`, error)
    return false
  }
}

export function loadCreateDraft(): CreateDraftState {
  return readJson<CreateDraftState>(CREATE_DRAFT_KEY, {})
}

export function saveCreateDraft(draft: CreateDraftState) {
  return writeJson(CREATE_DRAFT_KEY, draft)
}

export function loadCheckedState(requestId: string): CheckedStateMap {
  return normalizeCheckedState(readJson<unknown>(`otsukai:checked:${requestId}`, {}))
}

export function saveCheckedState(requestId: string, state: CheckedStateMap) {
  return writeJson(
    `otsukai:checked:${requestId}`,
    normalizeCheckedState(state),
  )
}

export function loadCartOrder(requestId: string): CartOrderList {
  return normalizeCartOrder(readJson<unknown>(`otsukai:cartOrder:${requestId}`, []))
}

export function saveCartOrder(requestId: string, order: CartOrderList) {
  return writeJson(
    `otsukai:cartOrder:${requestId}`,
    normalizeCartOrder(order),
  )
}

export function loadItemIssues(requestId: string): ItemIssueMap {
  return normalizeItemIssues(readJson<unknown>(`otsukai:itemIssues:${requestId}`, {}))
}

export function saveItemIssues(requestId: string, issues: ItemIssueMap) {
  return writeJson(
    `otsukai:itemIssues:${requestId}`,
    normalizeItemIssues(issues),
  )
}

export function loadConsultations(requestId: string): ConsultationMap {
  return normalizeConsultations(
    readJson<unknown>(`otsukai:consultations:${requestId}`, {}),
  )
}

export function saveConsultations(requestId: string, consultations: ConsultationMap) {
  return writeJson(
    `otsukai:consultations:${requestId}`,
    normalizeConsultations(consultations),
  )
}

export function loadLastSharedUrl(): string {
  try {
    return window.localStorage.getItem(LAST_SHARED_URL_KEY) || ''
  } catch {
    return ''
  }
}

export function saveLastSharedUrl(url: string) {
  try {
    if (url) {
      window.localStorage.setItem(LAST_SHARED_URL_KEY, url)
    } else {
      window.localStorage.removeItem(LAST_SHARED_URL_KEY)
    }
  } catch (error) {
    console.warn(`Failed to write localStorage key: ${LAST_SHARED_URL_KEY}`, error)
  }
}
