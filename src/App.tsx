import { useEffect, useMemo, useState } from 'react'
import { ErrorPage } from './pages/ErrorPage'
import { HomePage } from './pages/HomePage'
import { CreateRequestPage } from './pages/CreateRequestPage'
import { ShoppingListPage } from './pages/ShoppingListPage'
import { AboutPage } from './pages/AboutPage'
import { ProductCatalogPage } from './pages/ProductCatalogPage'
import { CatalogRecoveryPage } from './pages/CatalogRecoveryPage'
import type { RequestRouteCodec } from './utils/shoppingSession'
import { LiveShoppingListPage } from './pages/LiveShoppingListPage'
import { LiveRequestManagePage } from './pages/LiveRequestManagePage'
import {
  isLiveRequestEditSecret,
  isLiveRequestToken,
} from './features/liveRequests/validation'
import { useManualValidationSession } from './features/manualValidation/session'
import { getProductPhotoConfig } from './features/productPhotos/config'
import { getLiveRequestConfig } from './features/liveRequests/config'

export type RouteState =
  | { page: 'home' }
  | { page: 'create' }
  | { page: 'products' }
  | { page: 'catalogRestore'; encoded: string }
  | { page: 'about' }
  | { page: 'list'; encoded: string; codec: RequestRouteCodec }
  | { page: 'liveRequest'; requestToken: string }
  | {
      page: 'manageLiveRequest'
      requestToken: string
      editSecret: string
    }
  | { page: 'error'; title: string; description: string }

export function parseHashRoute(rawHash: string): RouteState {
  rawHash = rawHash || '#/'
  const normalized = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash
  const [pathPart, queryString = ''] = normalized.split('?')
  const path = pathPart || '/'

  if (path === '/' || path === '') {
    return { page: 'home' }
  }

  if (path === '/create') {
    return { page: 'create' }
  }

  if (path === '/products') {
    return { page: 'products' }
  }

  if (path.startsWith('/catalog/restore/')) {
    const encoded = path.slice('/catalog/restore/'.length)
    if (!encoded) {
      return {
        page: 'error',
        title: '復旧リンクにデータがありません',
        description:
          '商品リスト復旧データ付きのURLをもう一度開いてください。',
      }
    }
    return { page: 'catalogRestore', encoded }
  }

  if (path === '/about') {
    return { page: 'about' }
  }

  if (path === '/list') {
    const params = new URLSearchParams(queryString)
    const encoded = params.get('data')

    if (!encoded) {
      return {
        page: 'error',
        title: '共有URLにデータがありません',
        description: '依頼データ付きのURLをもう一度開いてください。',
      }
    }

    return { page: 'list', encoded, codec: 'legacy-query' }
  }

  if (path.startsWith('/l/')) {
    const encoded = path.slice('/l/'.length)
    if (!encoded) {
      return {
        page: 'error',
        title: '共有URLにデータがありません',
        description: '依頼データ付きのURLをもう一度開いてください。',
      }
    }
    return { page: 'list', encoded, codec: 'compact-path' }
  }

  if (path.startsWith('/r/')) {
    const requestToken = path.slice('/r/'.length)
    if (!isLiveRequestToken(requestToken)) {
      return {
        page: 'error',
        title: '更新可能な依頼リンクが正しくありません',
        description: '購入者用リンクをもう一度確認してください。',
      }
    }
    return { page: 'liveRequest', requestToken }
  }

  if (path.startsWith('/manage/')) {
    const parts = path.slice('/manage/'.length).split('/')
    const [requestToken = '', editSecret = ''] = parts
    if (
      parts.length !== 2 ||
      !isLiveRequestToken(requestToken) ||
      !isLiveRequestEditSecret(editSecret)
    ) {
      return {
        page: 'error',
        title: '依頼者用の管理リンクが正しくありません',
        description: '作成時に表示された管理リンクを確認してください。',
      }
    }
    return { page: 'manageLiveRequest', requestToken, editSecret }
  }

  return {
    page: 'error',
    title: 'ページが見つかりません',
    description: 'URLを確認してから、もう一度開いてください。',
  }
}

function navigate(hashPath: string) {
  window.location.hash = hashPath
}

export default function App() {
  const [route, setRoute] = useState<RouteState>(() => parseHashRoute(window.location.hash))
  const manualValidationAccess = useManualValidationSession()
  const manualValidationSession =
    manualValidationAccess.status === 'active'
      ? manualValidationAccess.session
      : undefined
  const productPhotoConfig = useMemo(
    () => getProductPhotoConfig(manualValidationSession?.token),
    [manualValidationSession?.token],
  )
  const liveRequestConfig = useMemo(
    () => getLiveRequestConfig(manualValidationSession?.token),
    [manualValidationSession?.token],
  )

  useEffect(() => {
    const handleHashChange = () => {
      setRoute(parseHashRoute(window.location.hash))
      window.scrollTo({ top: 0, behavior: 'auto' })
    }

    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  const page = useMemo(() => {
    if (
      manualValidationAccess.status === 'checking' &&
      (route.page === 'liveRequest' || route.page === 'manageLiveRequest')
    ) {
      return <main><p role="status">検証セッションを確認中…</p></main>
    }
    switch (route.page) {
      case 'home':
        return (
          <HomePage
            onStartCreate={() => navigate('/create')}
            onOpenProducts={() => navigate('/products')}
            onOpenAbout={() => navigate('/about')}
          />
        )
      case 'create':
        return (
          <CreateRequestPage
            onBackHome={() => navigate('/')}
            productPhotoConfig={productPhotoConfig}
            liveRequestConfig={liveRequestConfig}
          />
        )
      case 'products':
        return <ProductCatalogPage onBackHome={() => navigate('/')} />
      case 'catalogRestore':
        return (
          <CatalogRecoveryPage
            key={route.encoded}
            encoded={route.encoded}
            onBackHome={() => navigate('/')}
            onOpenProducts={() => navigate('/products')}
          />
        )
      case 'about':
        return <AboutPage onBackHome={() => navigate('/')} />
      case 'list':
        return (
          <ShoppingListPage
            encodedPayload={route.encoded}
            payloadCodec={route.codec}
            productPhotoConfig={productPhotoConfig}
            onBackHome={() => navigate('/')}
            onError={(title, description) => setRoute({ page: 'error', title, description })}
          />
        )
      case 'liveRequest':
        return (
          <LiveShoppingListPage
            key={route.requestToken}
            requestToken={route.requestToken}
            liveRequestConfig={liveRequestConfig}
            productPhotoConfig={productPhotoConfig}
            onBackHome={() => navigate('/')}
            onError={(title, description) =>
              setRoute({ page: 'error', title, description })
            }
          />
        )
      case 'manageLiveRequest':
        return (
          <LiveRequestManagePage
            key={`${route.requestToken}:${route.editSecret}`}
            requestToken={route.requestToken}
            editSecret={route.editSecret}
            liveRequestConfig={liveRequestConfig}
            onBackHome={() => navigate('/')}
            onError={(title, description) =>
              setRoute({ page: 'error', title, description })
            }
          />
        )
      case 'error':
        return (
          <ErrorPage
            title={route.title}
            description={route.description}
            onBackHome={() => navigate('/')}
          />
        )
      default:
        return null
    }
  }, [
    liveRequestConfig,
    manualValidationAccess.status,
    productPhotoConfig,
    route,
  ])

  return <div className="app-shell">{page}</div>
}
