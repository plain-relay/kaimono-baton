type ShoppingUndoNoticeProps = {
  message: string
  disabled: boolean
  onUndo: () => void
}

export function ShoppingUndoNotice({
  message,
  disabled,
  onUndo,
}: ShoppingUndoNoticeProps) {
  return (
    <section className="shopping-undo-notice" role="status" aria-live="polite">
      <p>{message}</p>
      <button
        type="button"
        className="secondary-button compact-button"
        onClick={onUndo}
        disabled={disabled}
      >
        元に戻す
      </button>
    </section>
  )
}
