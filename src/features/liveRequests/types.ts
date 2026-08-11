export type LiveRequestLifecycle =
  | 'active'
  | 'cancelled-by-requester'

export type LiveRequestNewItem = {
  itemId: string
  productId: string
  productNameSnapshot: string
  categoryIdSnapshot: string
  categoryNameSnapshot: string
  quantity: number
  unit: string
  memo?: string
  iconSnapshot: string
  sortOrderSnapshot: number
  photoToken?: string
}

export type LiveRequestItem = LiveRequestNewItem & {
  lifecycle: LiveRequestLifecycle
  createdRevision: number
  updatedRevision: number
  cancelledRevision?: number
}

export type LiveRequestSnapshot = {
  schemaVersion: 1
  requestId: string
  revision: number
  createdAt: string
  expiresAt: string
  updatesCount: number
  items: LiveRequestItem[]
}

export type LiveRequestOperation =
  | { type: 'add'; item: LiveRequestNewItem }
  | { type: 'set-quantity'; itemId: string; quantity: number }
  | { type: 'set-memo'; itemId: string; memo: string }
  | { type: 'cancel'; itemId: string }

export type LiveRequestCreateResponse = {
  requestToken: string
  editSecret: string
  request: LiveRequestSnapshot
}

export type LiveRequestGetResult =
  | {
      status: 'found'
      request: LiveRequestSnapshot
      etag: string
    }
  | { status: 'not-modified'; etag: string }
  | { status: 'expired' }
  | { status: 'missing' }

export interface LiveRequestApi {
  create(
    items: readonly LiveRequestNewItem[],
    options?: { signal?: AbortSignal },
  ): Promise<LiveRequestCreateResponse>
  get(
    requestToken: string,
    options?: { etag?: string; signal?: AbortSignal },
  ): Promise<LiveRequestGetResult>
  patch(
    requestToken: string,
    editSecret: string,
    revision: number,
    operations: readonly LiveRequestOperation[],
    options?: { signal?: AbortSignal },
  ): Promise<{ request: LiveRequestSnapshot; etag: string }>
}

export type LiveRequestPendingChange =
  | {
      kind: 'added'
      itemId: string
      revision: number
    }
  | {
      kind: 'changed'
      itemId: string
      revision: number
      previousQuantity: number
      nextQuantity: number
      previousMemo: string
      nextMemo: string
    }
  | {
      kind: 'cancelled'
      itemId: string
      revision: number
    }

export type LiveRequestCachedState = {
  schemaVersion: 1
  requestToken: string
  etag: string
  snapshot: LiveRequestSnapshot
  pendingChanges: LiveRequestPendingChange[]
  savedAt: string
}
