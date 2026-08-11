import { categories } from '../../data/categories'
import { createId } from '../../utils/id'
import type { SelectedRequestItem } from '../../utils/selectedRequestItems'
import type { LiveRequestNewItem } from './types'

type PhotoReference = { itemKey: string; token: string }

export function buildLiveRequestItems(
  selectedItems: readonly SelectedRequestItem[],
  photos: readonly PhotoReference[],
  createItemId: () => string = () => createId('live-item'),
): LiveRequestNewItem[] {
  const photoTokens = new Map(
    photos.map((photo) => [photo.itemKey, photo.token]),
  )
  const categoryNames = new Map(
    categories.map((category) => [category.id, category.name]),
  )
  const itemIds = new Set<string>()

  return selectedItems.map((item) => {
    const itemId = createItemId()
    if (
      !/^[A-Za-z0-9:_-]{1,128}$/u.test(itemId) ||
      itemIds.has(itemId)
    ) {
      throw new Error('Invalid live request item ID')
    }
    itemIds.add(itemId)
    const photoToken = photoTokens.get(item.productId)
    return {
      itemId,
      productId: item.productId,
      productNameSnapshot: item.name,
      categoryIdSnapshot: item.categoryId,
      categoryNameSnapshot:
        categoryNames.get(item.categoryId) ?? 'その他',
      quantity: item.quantity,
      unit: item.unit,
      ...(item.memo ? { memo: item.memo } : {}),
      iconSnapshot: item.icon,
      sortOrderSnapshot: item.sortOrder,
      ...(photoToken ? { photoToken } : {}),
    }
  })
}

export function buildLiveRequestUrls(
  baseUrl: string,
  requestToken: string,
  editSecret: string,
): { purchaserUrl: string; managementUrl: string } {
  const base = baseUrl.replace(/#.*$/u, '')
  return {
    purchaserUrl: `${base}#/r/${requestToken}`,
    managementUrl: `${base}#/manage/${requestToken}/${editSecret}`,
  }
}
