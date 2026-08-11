import type { ReactNode } from 'react'
import type { CommitTextResult } from './ImeAwareTextInput'
import type { EffectiveProduct } from '../types/householdCatalog'
import type { CreateDraftState } from '../types/shopping'
import { ProductCard } from './ProductCard'

type HiddenSelectedProductsSectionProps = {
  products: EffectiveProduct[]
  draft: CreateDraftState
  expandedProductIds: Set<string>
  onConditionCommit: (productId: string, value: string) => CommitTextResult
  onDecrease: (productId: string) => void
  onIncrease: (productId: string) => void
  onToggleDetails: (productId: string) => void
  renderPhotoAttachment?: (product: EffectiveProduct) => ReactNode
  hasRetainedPhotoAtQuantityZero?: boolean
}

export function HiddenSelectedProductsSection({
  products,
  draft,
  expandedProductIds,
  onConditionCommit,
  onDecrease,
  onIncrease,
  onToggleDetails,
  renderPhotoAttachment,
  hasRetainedPhotoAtQuantityZero = false,
}: HiddenSelectedProductsSectionProps) {
  if (products.length === 0) {
    return null
  }

  return (
    <section className="info-card hidden-selected-products">
      <div className="section-heading">
        <h2>今回の依頼に残っている非表示商品</h2>
        <span>{products.length}商品</span>
      </div>
      <p className="helper-text">
        {hasRetainedPhotoAtQuantityZero
          ? '商品リストから外した後も、写真の再利用・削除ができるように表示しています。数量0の商品と写真は共有対象外です。'
          : '商品リストから外した後も、数量が1以上の間は今回の依頼に残ります。数量を0にすると表示されなくなります。'}
      </p>
      <div className="product-list">
        {products.map((product) => (
          <ProductCard
            key={product.id}
            product={product}
            draft={draft[product.id]}
            isExpanded={expandedProductIds.has(product.id)}
            onIncrease={() => onIncrease(product.id)}
            onDecrease={() => onDecrease(product.id)}
            onToggleDetails={() => onToggleDetails(product.id)}
            onMemoCommit={(value) => onConditionCommit(product.id, value)}
            photoAttachment={renderPhotoAttachment?.(product)}
          />
        ))}
      </div>
    </section>
  )
}
