import type { Category, Product } from '../types/product'
import type { CreateDraftState } from '../types/shopping'
import type { CustomRequestDraftItem } from '../utils/requestBudget'
import type { PendingPhoto } from '../features/productPhotos/types'
import { toStableCustomProductId } from '../utils/selectedRequestItems'
import type { RequestSharingMode } from './RequestSharingModeSection'

type ShareMessageStatus = 'success' | 'error' | 'cancelled' | ''

type ProductGroup = {
  category: Category
  items: Product[]
}

type RequestReviewViewProps = {
  customItems: CustomRequestDraftItem[]
  draft: CreateDraftState
  groupedSelectedProducts: ProductGroup[]
  isSharingRequest: boolean
  onReturnToEdit: () => void
  onShareRequest: () => void | Promise<void>
  selectedCount: number
  shareMessage: string
  shareStatus: ShareMessageStatus
  photos?: readonly PendingPhoto[]
  isUploadingPhotos?: boolean
  photoUploadFailed?: boolean
  onShareWithoutPhotos?: () => void | Promise<void>
  sharingMode?: RequestSharingMode
  managementUrl?: string
  managementCopyMessage?: string
  onCopyManagementUrl?: () => void | Promise<void>
}

const OTHER_CATEGORY_NAME = 'その他'

export function RequestReviewView({
  customItems,
  draft,
  groupedSelectedProducts,
  isSharingRequest,
  onReturnToEdit,
  onShareRequest,
  selectedCount,
  shareMessage,
  shareStatus,
  photos = [],
  isUploadingPhotos = false,
  photoUploadFailed = false,
  onShareWithoutPhotos,
  sharingMode = 'fixed',
  managementUrl,
  managementCopyMessage,
  onCopyManagementUrl,
}: RequestReviewViewProps) {
  const photosByItemKey = new Map(
    photos.map((photo) => [photo.itemKey, photo]),
  )
  const photoPreview = (itemKey: string, name: string) => {
    const photo = photosByItemKey.get(itemKey)
    return photo ? (
      <img
        className="review-photo-thumbnail"
        src={photo.previewUrl}
        alt={`${name}の参考写真`}
      />
    ) : null
  }

  return (
    <>
      <section className="top-bar">
        <div>
          <p className="eyebrow">依頼作成</p>
          <h1>依頼内容の確認</h1>
        </div>
      </section>

      <section className="info-card">
        <p className="lead">{selectedCount}件の商品を選択しています。</p>
        <p className="helper-text">
          {sharingMode === 'live'
            ? '共有後に追加・数量・条件・取消を変更できる依頼です。'
            : '共有した時点で内容を固定する通常依頼です。'}
        </p>
      </section>

      {groupedSelectedProducts.map(({ category, items }) => (
        <section key={category.id} className="info-card review-category">
          <h2>{category.name}</h2>
          <ul className="review-list">
            {items.map((product) => {
              const item = draft[product.id]
              return (
                <li key={product.id}>
                  {photoPreview(product.id, product.name)}
                  <strong>{product.name}</strong> {item.quantity}
                  {product.unit}
                  {item.memo.trim() ? (
                    <p className="review-memo">条件: {item.memo.trim()}</p>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </section>
      ))}

      {customItems.length > 0 ? (
        <section className="info-card review-category">
          <h2>{OTHER_CATEGORY_NAME}</h2>
          <ul className="review-list">
            {customItems.map((item) => (
              <li key={item.id}>
                {photoPreview(toStableCustomProductId(item.id), item.name)}
                <strong>{item.name}</strong> {item.quantity}
                {item.unit}
                {item.memo ? (
                  <p className="review-memo">条件: {item.memo}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="review-share-actions">
        <button
          type="button"
          className="primary-button review-share-button"
          onClick={() => void onShareRequest()}
          disabled={isSharingRequest}
        >
          {isUploadingPhotos
            ? '写真を保存中…'
            : isSharingRequest
              ? '共有画面を開いています…'
              : photoUploadFailed
                ? '写真付き共有を再試行'
                : sharingMode === 'live'
                  ? '更新可能な依頼をLINEで送る'
                  : 'LINEで送る'}
        </button>
        <p className="helper-text">
          共有画面でLINEを選択してください。
          {sharingMode === 'live'
            ? '購入者用リンクだけが共有されます。'
            : ''}
        </p>
        {shareMessage ? (
          <p
            className={`copy-message ${shareStatus}`}
            role="status"
            aria-live="polite"
          >
            {shareMessage}
          </p>
        ) : null}
        {photoUploadFailed && onShareWithoutPhotos ? (
          <button
            type="button"
            className="secondary-button"
            onClick={() => void onShareWithoutPhotos()}
            disabled={isSharingRequest}
          >
            写真を外して{sharingMode === 'live' ? 'v5' : 'v3'}で共有
          </button>
        ) : null}
        {sharingMode === 'live' && managementUrl ? (
          <section className="live-management-link-card">
            <h2>依頼者用の管理リンク</h2>
            <p>
              このリンクを知っている人は依頼を変更できます。購入者へ送らず、安全な場所へ保管してください。
            </p>
            <textarea
              readOnly
              rows={4}
              value={managementUrl}
              aria-label="依頼者用の管理リンク"
            />
            {onCopyManagementUrl ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => void onCopyManagementUrl()}
                disabled={isSharingRequest}
              >
                管理リンクをコピー
              </button>
            ) : null}
            {managementCopyMessage ? (
              <p className="copy-message" role="status">
                {managementCopyMessage}
              </p>
            ) : null}
          </section>
        ) : null}
        <button
          type="button"
          className="secondary-button"
          onClick={onReturnToEdit}
          disabled={isSharingRequest}
        >
          修正する
        </button>
      </div>
    </>
  )
}
