type ProductSearchProps = {
  query: string
  resultCount: number
  isSearching: boolean
  canAddCustom: boolean
  onQueryChange: (query: string) => void
  onAddCustom: () => void
}

export function ProductSearch({ query, resultCount, isSearching, canAddCustom, onQueryChange, onAddCustom }: ProductSearchProps) {
  return (
    <section className="info-card product-search" aria-label="商品検索">
      <label className="stack-field">
        <span>商品を検索</span>
        <input type="text" value={query} placeholder="商品名を入力" autoComplete="off"
          onChange={(event) => onQueryChange(event.currentTarget.value)} />
      </label>
      {query ? <button type="button" className="ghost-button" onClick={() => onQueryChange('')}>検索をクリア</button> : null}
      {isSearching ? <p className="helper-text" role="status">{resultCount ? `${resultCount}商品が見つかりました` : '一致する商品がありません'}</p> : null}
      {isSearching && resultCount === 0 ? (
        <>
          <button type="button" className="secondary-button" onClick={onAddCustom} disabled={!canAddCustom}>この商品名で自由追加</button>
          {!canAddCustom ? <p className="helper-text">入力中の商品を保存・キャンセルするか、自由追加の件数を確認してください。</p> : null}
        </>
      ) : null}
    </section>
  )
}
