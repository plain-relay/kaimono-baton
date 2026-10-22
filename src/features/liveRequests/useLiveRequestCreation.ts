import { useEffect, useRef, useState } from 'react'
import { buildLineDeliveryRequestUrl } from '../../utils/lineDeliveryUrl'
import type { SelectedRequestItem } from '../../utils/selectedRequestItems'
import { BrowserTurnstileTokenProvider } from '../handwriting/turnstile'
import type { PendingPhoto } from '../productPhotos/types'
import { LIVE_REQUEST_CREATE_TURNSTILE_ACTION, WorkerLiveRequestApi } from './api'
import type { LiveRequestConfig } from './config'
import { buildLiveRequestItems, buildLiveRequestUrls } from './createItems'
import { getLiveRequestFailureMessage, resolveLiveRequestShare } from './sharePreparation'
import type { LiveRequestApi } from './types'

export function useLiveRequestCreation({ liveConfig, liveRequestApi, createLiveRequestItemId }: {
  liveConfig: LiveRequestConfig
  liveRequestApi?: LiveRequestApi
  createLiveRequestItemId?: () => string
}) {
  const [liveManagementUrl, setLiveManagementUrl] = useState('')
  const [liveManagementSnapshot, setLiveManagementSnapshot] = useState('')
  const [liveRequestExpiresAt, setLiveRequestExpiresAt] = useState<number>()
  const [managementCopyMessage, setManagementCopyMessage] = useState('')
  const [defaultLiveRequestApi, setDefaultLiveRequestApi] = useState<LiveRequestApi>()
  const liveTurnstileContainerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (
      !liveConfig.enabled ||
      liveRequestApi ||
      !liveTurnstileContainerRef.current
    ) {
      return
    }
    const turnstile = new BrowserTurnstileTokenProvider(
      liveTurnstileContainerRef.current,
      liveConfig.turnstileSiteKey,
      undefined,
      undefined,
      LIVE_REQUEST_CREATE_TURNSTILE_ACTION,
    )
    setDefaultLiveRequestApi(
      new WorkerLiveRequestApi(
        liveConfig.endpoint,
        turnstile,
        fetch,
        liveConfig.validationSessionToken,
      ),
    )
    return () => turnstile.dispose()
  }, [
    liveConfig.enabled,
    liveConfig.endpoint,
    liveConfig.turnstileSiteKey,
    liveConfig.validationSessionToken,
    liveRequestApi,
  ])


  const prepare = (snapshot: string, sharedUrl: string, sharedSnapshot: string) => resolveLiveRequestShare({
    snapshot, sharedUrl, sharedSnapshot,
    hasManagementUrl: liveManagementUrl.includes('#/manage/'),
    managementSnapshot: liveManagementSnapshot,
    expiresAt: liveRequestExpiresAt,
    now: Date.now(),
  })

  const create = async (prepared: {url: string; snapshot: string; reused: boolean; photos: readonly PendingPhoto[]}, selectedItems: readonly SelectedRequestItem[], validationRequestBaseUrl: string): Promise<string> => {
    if (prepared.reused) return prepared.url
    const api = liveRequestApi ?? defaultLiveRequestApi
    if (!api) throw new Error('更新可能な依頼の認証機能を準備できませんでした。通常依頼は引き続き利用できます。')
    try {
      const items = buildLiveRequestItems(selectedItems, prepared.photos, createLiveRequestItemId)
      const created = await api.create(items)
      const urls = buildLiveRequestUrls(validationRequestBaseUrl, created.requestToken, created.editSecret)
      setLiveManagementUrl(urls.managementUrl)
      setLiveManagementSnapshot(prepared.snapshot)
      setLiveRequestExpiresAt(Date.parse(created.request.expiresAt))
      setManagementCopyMessage('')
      return buildLineDeliveryRequestUrl(urls.purchaserUrl)
    } catch (error) {
      throw new Error(getLiveRequestFailureMessage(error))
    }
  }
  const handleCopyManagementUrl = async () => {
    if (!liveManagementUrl || !navigator.clipboard?.writeText) {
      setManagementCopyMessage(
        '管理リンクをコピーできませんでした。選択して安全な場所へ保存してください。',
      )
      return
    }
    try {
      await navigator.clipboard.writeText(liveManagementUrl)
      setManagementCopyMessage('管理リンクをコピーしました。')
    } catch {
      setManagementCopyMessage(
        '管理リンクをコピーできませんでした。選択して安全な場所へ保存してください。',
      )
    }
  }


  const resetLiveRequest = () => {
    setLiveManagementUrl('')
    setLiveManagementSnapshot('')
    setLiveRequestExpiresAt(undefined)
    setManagementCopyMessage('')
  }
  return { prepare, create, liveManagementUrl, liveManagementSnapshot, managementCopyMessage, handleCopyManagementUrl, liveTurnstileContainerRef, resetLiveRequest }
}
