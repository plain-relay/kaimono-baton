import type { RequestRouteCodec } from './shoppingSession'
import { isLiveRequestEditSecret, isLiveRequestToken } from '../features/liveRequests/validation'

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
