export type SharedRequestItemLifecycle =
  | 'active'
  | 'cancelled-by-requester'

export type SharedRequestNewItem = {
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

export type SharedRequestItem = SharedRequestNewItem & {
  lifecycle: SharedRequestItemLifecycle
  createdRevision: number
  updatedRevision: number
  cancelledRevision?: number
}

export type SharedRequestSnapshot = {
  schemaVersion: 1
  requestId: string
  revision: number
  createdAt: string
  expiresAt: string
  updatesCount: number
  items: SharedRequestItem[]
}

export type SharedRequestOperation =
  | { type: 'add'; item: Omit<SharedRequestNewItem, 'photoToken'> }
  | { type: 'set-quantity'; itemId: string; quantity: number }
  | { type: 'set-memo'; itemId: string; memo: string }
  | { type: 'cancel'; itemId: string }

export type SharedRequestCreateBody = {
  turnstileToken: string
  items: SharedRequestNewItem[]
}

export type SharedRequestPatchBody = {
  turnstileToken: string
  editSecret: string
  operations: SharedRequestOperation[]
}
