import type {
  LiveRequestPendingChange,
  LiveRequestSnapshot,
} from './types'

export function diffLiveRequestSnapshots(
  previous: LiveRequestSnapshot,
  next: LiveRequestSnapshot,
  pending: readonly LiveRequestPendingChange[] = [],
): LiveRequestPendingChange[] {
  if (next.revision <= previous.revision) {
    return pending.map((change) => ({ ...change }))
  }
  const previousById = new Map(
    previous.items.map((item) => [item.itemId, item]),
  )
  const changes = new Map(
    pending.map((change) => [`${change.itemId}:${change.kind}`, { ...change }]),
  )

  for (const item of next.items) {
    const oldItem = previousById.get(item.itemId)
    if (!oldItem) {
      if (item.lifecycle === 'active') {
        changes.set(`${item.itemId}:added`, {
          kind: 'added',
          itemId: item.itemId,
          revision: item.createdRevision,
        })
      }
      continue
    }
    if (
      oldItem.lifecycle === 'active' &&
      item.lifecycle === 'cancelled-by-requester'
    ) {
      for (const kind of ['added', 'changed', 'cancelled'] as const) {
        changes.delete(`${item.itemId}:${kind}`)
      }
      changes.set(`${item.itemId}:cancelled`, {
        kind: 'cancelled',
        itemId: item.itemId,
        revision: item.cancelledRevision ?? next.revision,
      })
      continue
    }
    if (
      item.lifecycle === 'active' &&
      (oldItem.quantity !== item.quantity ||
        (oldItem.memo ?? '') !== (item.memo ?? ''))
    ) {
      if (changes.has(`${item.itemId}:added`)) {
        continue
      }
      const existing = changes.get(`${item.itemId}:changed`)
      changes.set(`${item.itemId}:changed`, {
        kind: 'changed',
        itemId: item.itemId,
        revision: item.updatedRevision,
        previousQuantity:
          existing?.kind === 'changed'
            ? existing.previousQuantity
            : oldItem.quantity,
        nextQuantity: item.quantity,
        previousMemo:
          existing?.kind === 'changed'
            ? existing.previousMemo
            : oldItem.memo ?? '',
        nextMemo: item.memo ?? '',
      })
    }
  }

  return [...changes.values()].sort(
    (left, right) =>
      left.revision - right.revision ||
      left.itemId.localeCompare(right.itemId),
  )
}
