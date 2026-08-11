import type { Category } from '../types/product'
import type { EffectiveProduct } from '../types/householdCatalog'

type ProductCatalogGroup = {
  category: Category
  items: EffectiveProduct[]
}

type ProductCatalogListProps = {
  groups: ProductCatalogGroup[]
  hiddenProducts: EffectiveProduct[]
  onEdit: (productId: string) => void
  onRestore: (productId: string) => void
}

function CatalogProductRow({
  product,
  onEdit,
  onRestore,
}: {
  product: EffectiveProduct
  onEdit: (productId: string) => void
  onRestore?: (productId: string) => void
}) {
  return (
    <li className="catalog-product-row">
      <span className="catalog-product-main">
        <span className="product-icon" aria-hidden="true">
          {product.icon}
        </span>
        <span>
          <strong>{product.name}</strong>
          <small>
            単位: {product.unit}
            {product.isCustomized ? '・変更済み' : ''}
          </small>
        </span>
      </span>
      <span className="catalog-product-actions">
        {onRestore ? (
          <button
            type="button"
            className="secondary-button compact-button"
            onClick={() => onRestore(product.id)}
          >
            リストに戻す
          </button>
        ) : null}
        <button
          type="button"
          className="ghost-button compact-button"
          onClick={() => onEdit(product.id)}
          aria-label={`${product.name}を編集`}
        >
          編集
        </button>
      </span>
    </li>
  )
}

export function ProductCatalogList({
  groups,
  hiddenProducts,
  onEdit,
  onRestore,
}: ProductCatalogListProps) {
  return (
    <>
      {groups.map(({ category, items }) => (
        <section key={category.id} className="category-block">
          <div className="section-heading">
            <h2>{category.name}</h2>
            <span>{items.length}商品</span>
          </div>
          <ul className="catalog-product-list">
            {items.map((product) => (
              <CatalogProductRow
                key={product.id}
                product={product}
                onEdit={onEdit}
              />
            ))}
          </ul>
        </section>
      ))}

      {hiddenProducts.length > 0 ? (
        <section className="info-card catalog-hidden-card">
          <div className="section-heading">
            <h2>非表示の商品</h2>
            <span>{hiddenProducts.length}商品</span>
          </div>
          <ul className="catalog-product-list">
            {hiddenProducts.map((product) => (
              <CatalogProductRow
                key={product.id}
                product={product}
                onEdit={onEdit}
                onRestore={onRestore}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </>
  )
}
