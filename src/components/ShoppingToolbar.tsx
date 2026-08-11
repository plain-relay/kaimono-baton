type ShoppingToolbarProps = {
  filterMode: 'remaining' | 'all'
  onToggleFilter: () => void
}

export function ShoppingToolbar({
  filterMode,
  onToggleFilter,
}: ShoppingToolbarProps) {
  return (
    <section className="toolbar-card">
      <button
        type="button"
        className="secondary-button"
        onClick={onToggleFilter}
      >
        {filterMode === 'remaining' ? 'すべて表示' : '未購入・相談中だけ表示'}
      </button>
    </section>
  )
}
