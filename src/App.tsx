import { useEffect, useMemo, useState } from 'react'
import { ErrorPage } from './pages/ErrorPage'
import { HomePage } from './pages/HomePage'
import { CreateRequestPage } from './pages/CreateRequestPage'
import { ShoppingListPage } from './pages/ShoppingListPage'
import { AboutPage } from './pages/AboutPage'
import { ProductCatalogPage } from './pages/ProductCatalogPage'
import { CatalogRecoveryPage } from './pages/CatalogRecoveryPage'
import { LiveShoppingListPage } from './pages/LiveShoppingListPage'
import { LiveRequestManagePage } from './pages/LiveRequestManagePage'
import { useManualValidationSession } from './features/manualValidation/session'
import { getProductPhotoConfig } from './features/productPhotos/config'
import { getLiveRequestConfig } from './features/liveRequests/config'

export type { RouteState } from './utils/hashRoute'
export { parseHashRoute } from './utils/hashRoute'
import { parseHashRoute, type RouteState } from './utils/hashRoute'
import { NativeLinkImport } from './platform/NativeLinkImport'
import { isNativeApp } from './platform/runtime'

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

  return <div className="app-shell">{isNativeApp() && <NativeLinkImport />}{page}</div>
}
