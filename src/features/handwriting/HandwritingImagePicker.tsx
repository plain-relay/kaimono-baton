import type { ChangeEvent } from 'react'

export type HandwritingImagePreview = {
  file: File
  objectUrl: string
  mime: string
  sizeBytes: number
  width?: number
  height?: number
  decodeFailed: boolean
}

type HandwritingImagePickerProps = {
  preview?: HandwritingImagePreview
  disabled: boolean
  analysisReady: boolean
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void
  onPreviewLoad: (objectUrl: string, width: number, height: number) => void
  onPreviewError: (objectUrl: string) => void
  onStart: () => void
  onCancel: () => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function HandwritingImagePicker({
  preview,
  disabled,
  analysisReady,
  onFileChange,
  onPreviewLoad,
  onPreviewError,
  onStart,
  onCancel,
}: HandwritingImagePickerProps) {
  const cameraActionLabel = preview ? '撮り直す' : '写真を撮る'
  const libraryActionLabel = preview
    ? '選び直す'
    : '端末の写真を選ぶ'

  return (
    <>
      <div className="handwriting-source-actions">
        <label
          className={`primary-button handwriting-file-button${
            disabled ? ' is-disabled' : ''
          }`}
        >
          {cameraActionLabel}
          <input
            className="visually-hidden"
            type="file"
            accept="image/*"
            capture="environment"
            aria-label={cameraActionLabel}
            disabled={disabled}
            onChange={onFileChange}
          />
        </label>
        <label
          className={`ghost-button handwriting-file-button${
            disabled ? ' is-disabled' : ''
          }`}
        >
          {libraryActionLabel}
          <input
            className="visually-hidden"
            type="file"
            accept="image/*"
            aria-label={libraryActionLabel}
            disabled={disabled}
            onChange={onFileChange}
          />
        </label>
      </div>

      {preview ? (
        <section
          className="handwriting-image-preview"
          aria-label="送信前の画像プレビュー"
        >
          <img
            src={preview.objectUrl}
            alt="選択した手書きメモのプレビュー"
            onLoad={(event) =>
              onPreviewLoad(
                preview.objectUrl,
                event.currentTarget.naturalWidth,
                event.currentTarget.naturalHeight,
              )
            }
            onError={() => onPreviewError(preview.objectUrl)}
          />
          <dl className="handwriting-image-metadata">
            <div>
              <dt>MIME種別</dt>
              <dd>{preview.mime}</dd>
            </div>
            <div>
              <dt>ファイルサイズ</dt>
              <dd>{formatBytes(preview.sizeBytes)}</dd>
            </div>
            <div>
              <dt>元画像の幅・高さ</dt>
              <dd>
                {preview.width && preview.height
                  ? `${preview.width} × ${preview.height} px`
                  : preview.decodeFailed
                    ? '確認できません'
                    : '読み込み中'}
              </dd>
            </div>
          </dl>
          {preview.decodeFailed ? (
            <p className="handwriting-preview-error" role="alert">
              画像をプレビューできません。対応するJPEG、PNG、WebPを選び直してください。
            </p>
          ) : null}
          {!analysisReady ? (
            <p className="helper-text" role="status">
              読み取り機能を準備中です。
            </p>
          ) : null}
          <div className="handwriting-preview-actions">
            <button
              type="button"
              className="ghost-button"
              disabled={disabled}
              onClick={onCancel}
            >
              キャンセル
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={
                disabled ||
                !analysisReady ||
                preview.decodeFailed ||
                !preview.width ||
                !preview.height
              }
              onClick={onStart}
            >
              読み取りを開始
            </button>
          </div>
        </section>
      ) : null}
    </>
  )
}
