import type {
  CheckedStateMap,
  ConsultationEntry,
  ConsultationMap,
  ConsultationStatus,
  ItemIssue,
  ItemIssueMap,
} from '../types/shopping'
import {
  normalizeCheckedState,
  normalizeItemIssue,
  normalizeItemIssues,
} from './shoppingState'

const VALID_CONSULTATION_STATUSES = new Set<ConsultationStatus>([
  'queued',
  'shared',
  'resolved',
])

export type LegacyConsultationMigration = {
  checkedState: CheckedStateMap
  itemIssues: ItemIssueMap
  consultations: ConsultationMap
  migratedItemIds: string[]
}

export function isConsultationStatus(value: unknown): value is ConsultationStatus {
  return (
    typeof value === 'string' &&
    VALID_CONSULTATION_STATUSES.has(value as ConsultationStatus)
  )
}

export function normalizeConsultationEntry(
  value: unknown,
  expectedItemId?: string,
): ConsultationEntry | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  const {
    itemId,
    reason,
    note,
    status,
  } = value as {
    itemId?: unknown
    reason?: unknown
    note?: unknown
    status?: unknown
  }
  if (
    typeof itemId !== 'string' ||
    itemId.length === 0 ||
    (expectedItemId !== undefined && itemId !== expectedItemId) ||
    !isConsultationStatus(status)
  ) {
    return undefined
  }

  const issue = normalizeItemIssue({ reason, note })
  if (!issue) {
    return undefined
  }

  return {
    itemId,
    reason: issue.reason,
    ...(issue.note ? { note: issue.note } : {}),
    status,
  }
}

export function normalizeConsultations(value: unknown): ConsultationMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  const normalized: ConsultationMap = {}
  for (const [itemId, entry] of Object.entries(value)) {
    const normalizedEntry = normalizeConsultationEntry(entry, itemId)
    if (normalizedEntry) {
      normalized[itemId] = normalizedEntry
    }
  }

  return normalized
}

export function reconcileConsultations(
  consultations: ConsultationMap,
  validItemIds: Iterable<string>,
): ConsultationMap {
  const normalized = normalizeConsultations(consultations)
  const validIds = new Set(validItemIds)

  return Object.fromEntries(
    Object.entries(normalized).filter(([itemId]) => validIds.has(itemId)),
  )
}

export function createConsultationEntry(
  itemId: string,
  issue: ItemIssue,
  status: ConsultationStatus = 'queued',
): ConsultationEntry {
  const normalizedIssue = normalizeItemIssue(issue)
  if (!normalizedIssue) {
    throw new Error('相談理由が正しくありません。')
  }

  return {
    itemId,
    reason: normalizedIssue.reason,
    ...(normalizedIssue.note ? { note: normalizedIssue.note } : {}),
    status,
  }
}

export function getConsultationIssue(entry?: ConsultationEntry): ItemIssue | undefined {
  if (!entry) {
    return undefined
  }

  return normalizeItemIssue(entry)
}

export function isUnresolvedConsultation(entry?: ConsultationEntry): boolean {
  return entry?.status === 'queued' || entry?.status === 'shared'
}

export function migrateLegacyConsultingState(
  checkedState: CheckedStateMap,
  itemIssues: ItemIssueMap,
  consultations: ConsultationMap,
): LegacyConsultationMigration {
  const nextCheckedState = normalizeCheckedState(checkedState)
  const nextItemIssues = normalizeItemIssues(itemIssues)
  const nextConsultations = normalizeConsultations(consultations)
  const migratedItemIds: string[] = []

  for (const [itemId, status] of Object.entries(nextCheckedState)) {
    if (status !== 'consulting') {
      continue
    }

    nextCheckedState[itemId] = 'pending'
    const issue = nextItemIssues[itemId]
    if (
      issue &&
      (!nextConsultations[itemId] ||
        nextConsultations[itemId].status === 'resolved')
    ) {
      nextConsultations[itemId] = createConsultationEntry(itemId, issue)
    }
    delete nextItemIssues[itemId]
    migratedItemIds.push(itemId)
  }

  return {
    checkedState: nextCheckedState,
    itemIssues: nextItemIssues,
    consultations: nextConsultations,
    migratedItemIds,
  }
}
