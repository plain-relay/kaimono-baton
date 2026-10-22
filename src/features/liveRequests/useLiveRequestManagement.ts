import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BrowserTurnstileTokenProvider } from '../handwriting/turnstile'
import { LIVE_REQUEST_UPDATE_TURNSTILE_ACTION, LiveRequestApiError, WorkerLiveRequestApi } from './api'
import type { LiveRequestConfig } from './config'
import type { LiveRequestApi, LiveRequestOperation, LiveRequestSnapshot } from './types'

function finiteMessage(error: unknown): string {
  if (error instanceof LiveRequestApiError) {
    switch (error.code) {
      case 'auth-failed':
        return '認証確認に失敗しました。もう一度お試しください。'
      case 'conflict':
        return '別の画面で更新されています。最新内容を再取得しました。入力中の値を確認して再度保存してください。'
      case 'expired':
        return '共有期限が切れたため更新できません。'
      case 'limit-reached':
        return '更新回数または利用上限に達しました。'
      case 'invalid-request':
        return '入力内容を更新できません。数量や条件を確認してください。'
      case 'invalid-response':
      case 'service-unavailable':
      case 'timeout':
        return '更新サービスへ接続できません。表示中の内容はそのまま残っています。'
    }
  }
  return '更新サービスへ接続できません。表示中の内容はそのまま残っています。'
}

export function useLiveRequestManagement({ config, liveRequestApi, requestToken, editSecret, onError }: {
  config: LiveRequestConfig
  liveRequestApi?: LiveRequestApi
  requestToken: string
  editSecret: string
  onError: (title: string, description: string) => void
}) {
  const turnstileContainerRef = useRef<HTMLDivElement>(null)
  const [defaultUpdateApi, setDefaultUpdateApi] = useState<LiveRequestApi>()
  const readApi = useMemo(
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
  const updateApi = liveRequestApi ?? defaultUpdateApi
  const [snapshot, setSnapshot] = useState<LiveRequestSnapshot>()
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [memos, setMemos] = useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)
  const [isExpired, setIsExpired] = useState(false)
  const [message, setMessage] = useState('')
  const applySnapshot = useCallback(
    (next: LiveRequestSnapshot, preserveInputs: boolean) => {
      setSnapshot(next)
      setIsExpired(false)
      setQuantities((current) =>
        Object.fromEntries(
          next.items
            .filter((item) => item.lifecycle === 'active')
            .map((item) => [
              item.itemId,
              preserveInputs
                ? current[item.itemId] ?? item.quantity
                : item.quantity,
            ]),
        ),
      )
      setMemos((current) =>
        Object.fromEntries(
          next.items
            .filter((item) => item.lifecycle === 'active')
            .map((item) => [
              item.itemId,
              preserveInputs
                ? current[item.itemId] ?? item.memo ?? ''
                : item.memo ?? '',
            ]),
        ),
      )
    },
    [],
  )

  const refresh = useCallback(
    async (preserveInputs = true, signal?: AbortSignal) => {
      if (!readApi) {
        return false
      }
      setIsLoading(true)
      try {
        const result = await readApi.get(requestToken, { signal })
        if (result.status === 'found') {
          applySnapshot(result.request, preserveInputs)
          setMessage('')
          return true
        } else if (result.status === 'expired') {
          setIsExpired(true)
          setMessage('共有期限が切れたため更新できません。')
        } else if (result.status === 'missing') {
          onError(
            '管理する依頼が見つかりません',
            '管理リンクが正しいか確認してください。',
          )
        }
      } catch (error) {
        if (!signal?.aborted) {
          setMessage(finiteMessage(error))
        }
      } finally {
        if (!signal?.aborted) {
          setIsLoading(false)
        }
      }
      return false
    },
    [applySnapshot, onError, readApi, requestToken],
  )

  useEffect(() => {
    if (!config.enabled) {
      onError(
        '依頼の管理機能は現在利用できません',
        '通常の固定依頼は引き続き利用できます。',
      )
      return
    }
    const controller = new AbortController()
    void refresh(false, controller.signal)
    return () => controller.abort()
  }, [config.enabled, onError, refresh])

  useEffect(() => {
    if (
      !config.enabled ||
      liveRequestApi ||
      !turnstileContainerRef.current
    ) {
      return
    }
    const turnstile = new BrowserTurnstileTokenProvider(
      turnstileContainerRef.current,
      config.turnstileSiteKey,
      undefined,
      undefined,
      LIVE_REQUEST_UPDATE_TURNSTILE_ACTION,
    )
    setDefaultUpdateApi(
      new WorkerLiveRequestApi(
        config.endpoint,
        turnstile,
        fetch,
        config.validationSessionToken,
      ),
    )
    return () => turnstile.dispose()
  }, [
    config.enabled,
    config.endpoint,
    config.turnstileSiteKey,
    config.validationSessionToken,
    liveRequestApi,
  ])

  const submitOperations = async (
    operations: readonly LiveRequestOperation[],
  ) => {
    if (!snapshot || !updateApi || isExpired || isUpdating) {
      return false
    }
    setIsUpdating(true)
    setMessage('')
    try {
      const result = await updateApi.patch(
        requestToken,
        editSecret,
        snapshot.revision,
        operations,
      )
      applySnapshot(result.request, true)
      setMessage('依頼内容を更新しました。')
      return true
    } catch (error) {
      setMessage(finiteMessage(error))
      if (error instanceof LiveRequestApiError && error.code === 'conflict') {
        if (await refresh(true)) {
          setMessage(finiteMessage(error))
        }
      } else if (
        error instanceof LiveRequestApiError &&
        error.code === 'expired'
      ) {
        setIsExpired(true)
      }
      return false
    } finally {
      setIsUpdating(false)
    }
  }


  return { snapshot, quantities, setQuantities, memos, setMemos, isLoading, isUpdating, isExpired,
    message, setMessage, updateApiAvailable: Boolean(updateApi), submitOperations, turnstileContainerRef }
}
