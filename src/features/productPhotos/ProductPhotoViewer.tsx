import { useEffect, useState } from 'react'
import { MAX_PRODUCT_PHOTO_BYTES } from './imageProcessing'
import { isProductPhotoToken } from './photoToken'

export type ProductPhotoLoadState =
  | 'loading'
  | 'loaded'
  | 'expired'
  | 'failed'
  | 'invalid'

type ProductPhotoViewerProps = {
  endpoint: string
  token: string
  itemName: string
  fetchImplementation?: typeof fetch
  createPreviewUrl?: (blob: Blob) => string
  revokePreviewUrl?: (url: string) => void
  validationSessionToken?: string
}

function photoUrl(endpoint: string, token: string): string {
  const base = endpoint.endsWith('/') ? endpoint : `${endpoint}/`
  return new URL(`v1/photos/${token}`, base).toString()
}

function defaultCreatePreviewUrl(blob: Blob): string {
  return URL.createObjectURL(blob)
}

function defaultRevokePreviewUrl(url: string): void {
  URL.revokeObjectURL(url)
}

async function hasJpegSignature(blob: Blob): Promise<boolean> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  return (
    bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[bytes.length - 2] === 0xff &&
    bytes[bytes.length - 1] === 0xd9
  )
}

export function ProductPhotoViewer({
  endpoint,
  token,
  itemName,
  fetchImplementation = fetch,
  createPreviewUrl = defaultCreatePreviewUrl,
  revokePreviewUrl = defaultRevokePreviewUrl,
  validationSessionToken,
}: ProductPhotoViewerProps) {
  const [state, setState] = useState<ProductPhotoLoadState>('loading')
  const [previewUrl, setPreviewUrl] = useState('')
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!isProductPhotoToken(token)) {
      setState('invalid')
      setPreviewUrl('')
      return
    }

    const controller = new AbortController()
    let localUrl = ''
    let active = true
    setState('loading')
    setPreviewUrl('')
    setExpanded(false)

    const load = async () => {
      try {
        const response = await fetchImplementation(photoUrl(endpoint, token), {
          method: 'GET',
          ...(validationSessionToken
            ? {
                headers: {
                  'X-Otsukai-Validation-Session': validationSessionToken,
                },
              }
            : {}),
          signal: controller.signal,
          cache: 'no-store',
        })
        if (!active) {
          return
        }
        if (response.status === 404 || response.status === 410) {
          setState('expired')
          return
        }
        if (!response.ok) {
          setState('failed')
          return
        }
        if (
          !response.headers
            .get('Content-Type')
            ?.toLowerCase()
            .startsWith('image/jpeg')
        ) {
          setState('invalid')
          return
        }
        const blob = await response.blob()
        if (!active) {
          return
        }
        const validSignature = await hasJpegSignature(blob)
        if (!active) {
          return
        }
        if (
          blob.type !== 'image/jpeg' ||
          blob.size < 1 ||
          blob.size > MAX_PRODUCT_PHOTO_BYTES ||
          !validSignature
        ) {
          setState('invalid')
          return
        }
        const nextUrl = createPreviewUrl(blob)
        if (!active) {
          revokePreviewUrl(nextUrl)
          return
        }
        localUrl = nextUrl
        setPreviewUrl(localUrl)
        setState('loaded')
      } catch {
        if (!controller.signal.aborted) {
          setState('failed')
        }
      }
    }
    void load()

    return () => {
      active = false
      controller.abort()
      if (localUrl) {
        revokePreviewUrl(localUrl)
      }
    }
  }, [
    createPreviewUrl,
    endpoint,
    fetchImplementation,
    revokePreviewUrl,
    token,
    validationSessionToken,
  ])

  return (
    <span className="shopping-photo" data-photo-state={state}>
      {state === 'loading' ? <span role="status">写真を読み込み中…</span> : null}
      {state === 'expired' ? <span>写真の保存期限が切れました</span> : null}
      {state === 'failed' ? <span>写真を取得できませんでした</span> : null}
      {state === 'invalid' ? <span>写真情報が正しくありません</span> : null}
      {state === 'loaded' && previewUrl ? (
        <button
          type="button"
          className="shopping-photo-button"
          onClick={() => setExpanded(true)}
          aria-label={`${itemName}の参考写真を拡大`}
        >
          <img src={previewUrl} alt={`${itemName}の参考写真`} />
        </button>
      ) : null}

      {expanded && previewUrl ? (
        <span className="dialog-backdrop">
          <span
            className="dialog-card product-photo-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`${itemName}の参考写真`}
          >
            <img src={previewUrl} alt={`${itemName}の参考写真（拡大）`} />
            <button
              type="button"
              className="secondary-button"
              onClick={() => setExpanded(false)}
            >
              閉じる
            </button>
          </span>
        </span>
      ) : null}
    </span>
  )
}
