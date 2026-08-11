import type { ReactNode } from 'react'

type CategorySectionProps = {
  name: string
  count: number
  children: ReactNode
}

export function CategorySection({ name, count, children }: CategorySectionProps) {
  return (
    <section className="category-section">
      <div className="section-heading">
        <h2>{name}</h2>
        <span>{count}件</span>
      </div>
      <div className="section-items">{children}</div>
    </section>
  )
}
