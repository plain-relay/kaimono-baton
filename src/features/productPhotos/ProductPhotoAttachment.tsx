import { useId } from 'react'
import type { PendingPhoto } from './types'

type ProductPhotoAttachmentProps = {
  itemName: string
  selected: boolean
  photo?: PendingPhoto
  photoCount: number
  processing: boolean
  disabled: boolean
  errorMessage?: string
  onSelect: (file: File) => void
  onRemove: () => void
}

function statusLabel(photo: PendingPhoto): string {
  switch (photo.status) {
    case 'uploading':
      return '写真を保存中'
    case 'uploaded':
      return '共有用に保存済み'
    case 'failed':
      return '写真の保存に失敗'
    default:
      return '共有前の端末内プレビュー'
  }
}

export function ProductPhotoAttachment({
  itemName,
  selected,
  photo,
  photoCount,
  processing,
  disabled,
  errorMessage,
  onSelect,
  onRemove,
}: ProductPhotoAttachmentProps) {
  const cameraId = useId()
  const libraryId = useId()
  const unavailable = disabled || processing || (!photo && photoCount >= 3)
  const handleFileChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    input.value = ''
    if (file && !unavailable && selected) {
      onSelect(file)
    }
  }

  return (
    <section className="product-photo-attachment" aria-label={`${itemName}の参考写真`}>
      <div className="product-photo-heading">
        <strong>写真を撮る・選ぶ</strong>
        <span>{photoCount} / 3枚</span>
      </div>

      {photo ? (
        <div className="product-photo-preview">
          <img src={photo.previewUrl} alt={`${itemName}の参考写真プレビュー`} />
          <div>
            <p>{statusLabel(photo)}</p>
            <small>
              {photo.width} × {photo.height}px・
              {Math.max(1, Math.ceil(photo.bytes / 1024))}KB
            </small>
            {!selected ? (
              <small className="product-photo-excluded">
                数量0のため共有対象外です。数量を戻すと再利用できます。
              </small>
            ) : null}
          </div>
        </div>
      ) : null}

      {processing ? (
        <p className="product-photo-status" role="status">
          写真を圧縮中…
        </p>
      ) : null}
      {errorMessage ? (
        <p className="limit-inline-message" role="alert">
          {errorMessage}
        </p>
      ) : null}

      {!selected && !photo ? (
        <p className="helper-text">商品を選択すると写真を追加できます。</p>
      ) : null}
      {!photo && photoCount >= 3 ? (
        <p className="helper-text">写真は1依頼につき3枚までです。</p>
      ) : null}

      <div className="product-photo-actions">
        <input
          id={cameraId}
          className="visually-hidden"
          type="file"
          accept="image/*"
          capture="environment"
          disabled={unavailable || !selected}
          onChange={handleFileChange}
          aria-label={`${itemName}の写真を撮る`}
        />
        <label
          htmlFor={cameraId}
          className={`secondary-button compact-button ${unavailable || !selected ? 'is-disabled' : ''}`}
        >
          {photo ? '撮り直す' : '写真を撮る'}
        </label>
        <input
          id={libraryId}
          className="visually-hidden"
          type="file"
          accept="image/*"
          disabled={unavailable || !selected}
          onChange={handleFileChange}
          aria-label={`${itemName}の端末写真を選ぶ`}
        />
        <label
          htmlFor={libraryId}
          className={`secondary-button compact-button ${unavailable || !selected ? 'is-disabled' : ''}`}
        >
          {photo ? '選び直す' : '写真を選ぶ'}
        </label>
        {photo ? (
          <button
            type="button"
            className="ghost-button compact-button"
            onClick={onRemove}
            disabled={disabled || processing}
          >
            削除
          </button>
        ) : null}
      </div>
    </section>
  )
}
