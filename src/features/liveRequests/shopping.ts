import { FIXED_REQUEST_TITLE } from '../../constants/request'
import type {
  CheckedItemStatus,
  ShoppingRequestPayload,
} from '../../types/shopping'
import type {
  LiveRequestPendingChange,
  LiveRequestSnapshot,
} from './types'

export function liveRequestToShoppingPayload(
  snapshot: LiveRequestSnapshot,
): ShoppingRequestPayload {
  return {
    requestId: snapshot.requestId,
    title: FIXED_REQUEST_TITLE,
    createdAt: snapshot.createdAt,
    items: snapshot.items.map((item) => ({
      id: item.itemId,
      productId: item.productId,
      productNameSnapshot: item.productNameSnapshot,
      categoryIdSnapshot: item.categoryIdSnapshot,
      categoryNameSnapshot: item.categoryNameSnapshot,
      quantity: item.quantity,
      unit: item.unit,
      ...(item.memo ? { memo: item.memo } : {}),
      iconSnapshot: item.iconSnapshot,
      sortOrderSnapshot: item.sortOrderSnapshot,
      ...(item.photoToken ? { photoToken: item.photoToken } : {}),
      liveLifecycle: item.lifecycle,
      liveUpdatedRevision: item.updatedRevision,
    })),
  }
}

export function cancelledItemMessage(
  status: CheckedItemStatus,
  hasConsultation = false,
): string {
  if (hasConsultation) {
    return '相談中の商品が取り消されました'
  }
  switch (status) {
    case 'inCart':
      return 'かごに入れた後に取り消されました'
    case 'verified':
      return '購入確認後に取り消されました'
    case 'consulting':
      return '相談中の商品が取り消されました'
    case 'notBuying':
      return '取消済みとして履歴を保持しています'
    case 'pending':
      return '依頼者が取り消しました'
  }
}

export function describeLiveRequestChange(
  change: LiveRequestPendingChange,
): string {
  if (change.kind === 'added') {
    return '追加されました'
  }
  if (change.kind === 'cancelled') {
    return '依頼者が取り消しました'
  }
  const parts: string[] = []
  if (change.previousQuantity !== change.nextQuantity) {
    parts.push(
      `数量 ${change.previousQuantity} → ${change.nextQuantity}`,
    )
  }
  if (change.previousMemo !== change.nextMemo) {
    parts.push(
      `条件「${change.previousMemo || 'なし'}」→「${
        change.nextMemo || 'なし'
      }」`,
    )
  }
  return parts.join(' / ') || '依頼内容が変更されました'
}
