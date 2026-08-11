import { useEffect, useMemo } from 'react'
import { WorkerLiveRequestApi } from '../features/liveRequests/api'
import {
  getLiveRequestConfig,
  type LiveRequestConfig,
} from '../features/liveRequests/config'
import type { LiveRequestApi } from '../features/liveRequests/types'
import type { ProductPhotoConfig } from '../features/productPhotos/config'
import { ShoppingListPage } from './ShoppingListPage'

type LiveShoppingListPageProps = {
  requestToken: string
  onBackHome: () => void
  onError: (title: string, description: string) => void
  liveRequestConfig?: LiveRequestConfig
  liveRequestApi?: LiveRequestApi
  productPhotoConfig?: ProductPhotoConfig
}

export function LiveShoppingListPage({
  requestToken,
  onBackHome,
  onError,
  liveRequestConfig,
  liveRequestApi,
  productPhotoConfig,
}: LiveShoppingListPageProps) {
  const config = liveRequestConfig ?? getLiveRequestConfig()
  const api = useMemo(
    () =>
      liveRequestApi ??
      (config.enabled
        ? new WorkerLiveRequestApi(
            config.endpoint,
            undefined,
            fetch,
            config.validationSessionToken,
          )
        : undefined),
    [
      config.enabled,
      config.endpoint,
      config.validationSessionToken,
      liveRequestApi,
    ],
  )

  useEffect(() => {
    if (!config.enabled) {
      onError(
        '更新可能な依頼は現在利用できません',
        '通常の商品選択や固定依頼は引き続き利用できます。',
      )
    }
  }, [config.enabled, onError])

  return config.enabled && api ? (
    <ShoppingListPage
      encodedPayload={requestToken}
      payloadCodec="compact-path"
      onBackHome={onBackHome}
      onError={onError}
      productPhotoConfig={productPhotoConfig}
      liveRequestToken={requestToken}
      liveRequestApi={api}
    />
  ) : null
}
