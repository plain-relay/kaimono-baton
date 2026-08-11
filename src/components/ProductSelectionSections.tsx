import type { ReactNode } from 'react'
import type { Category, Product } from '../types/product'
import type { CreateDraftState } from '../types/shopping'
import type { CommitTextResult } from './ImeAwareTextInput'
import { ProductCard } from './ProductCard'

type ProductGroup = {
  category: Category
  items: Product[]
}

type ProductSelectionSectionsProps = {
  draft: CreateDraftState
  expandedProductIds: Set<string>
  groups: ProductGroup[]
  onConditionCommit: (productId: string, value: string) => CommitTextResult
  onDecrease: (productId: string) => void
  onIncrease: (productId: string) => void
  onToggleDetails: (productId: string) => void
  renderPhotoAttachment?: (product: Product) => ReactNode
}

export function ProductSelectionSections({
  draft,
  expandedProductIds,
  groups,
  onConditionCommit,
  onDecrease,
  onIncrease,
  onToggleDetails,
  renderPhotoAttachment,
}: ProductSelectionSectionsProps) {
  return groups.map(({ category, items }) => (
    <section key={category.id} className="category-block">
      <div className="section-heading">
        <h2>{category.name}</h2>
        <span>{items.length}商品</span>
      </div>
      <div className="product-list">
        {items.map((product) => (
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
  ))
}
