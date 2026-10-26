import { parseHashRoute } from '../utils/hashRoute'
import { decodeShoppingSessionPayload } from '../utils/shoppingSession'
import { decodeCatalogRecoveryPayload } from '../utils/catalogRecovery'
import { PUBLIC_WEB_BASE } from './runtime'

// Decoder compatibility headroom, independent of the 2,200 character outgoing budget.
export const MAX_INCOMING_LINK_CHARS = 70_000
export const INVALID_LINK_NOTICE = 'このリンクを開けません。買いものバトンの公開URLとデータを確認してください。'

export function parseIncomingLink(input: string): string | null {
  if (input.length > MAX_INCOMING_LINK_CHARS || /[\u0000-\u001f\u007f]/.test(input)) return null
  try {
    const url = new URL(input.trim())
    const allowed = new URL(PUBLIC_WEB_BASE)
    if (url.origin !== allowed.origin || url.pathname !== allowed.pathname ||
        url.username || url.password || url.port ||
        [...url.searchParams].some(([key, value]) => key !== 'openExternalBrowser' || value !== '1') ||
        url.searchParams.getAll('openExternalBrowser').length > 1) return null
    // Refuse ignored query suffixes and extra fragments before the shared parser.
    if (url.hash.slice(1).includes('#') || url.hash.split('?').length > 2) return null
    const route = parseHashRoute(url.hash)
    if (route.page === 'list') {
      if (route.codec === 'compact-path') {
        if (!/^#\/l\/[A-Za-z0-9+$-]+$/.test(url.hash)) return null
      } else {
        const query = new URLSearchParams(url.hash.slice('#/list?'.length))
        if (!url.hash.startsWith('#/list?') || [...query.keys()].some(key => key !== 'data') ||
            query.getAll('data').length !== 1) return null
      }
      decodeShoppingSessionPayload({ encodedPayload: route.encoded, codec: route.codec })
    } else if (route.page === 'catalogRestore') {
      if (!/^#\/catalog\/restore\/[A-Za-z0-9+$-]+$/.test(url.hash)) return null
      decodeCatalogRecoveryPayload(route.encoded)
    } else if (route.page === 'liveRequest' || route.page === 'manageLiveRequest') {
      if (url.hash.includes('?')) return null
      // Accept the published route; the existing page explains the disabled feature.
    } else return null
    return url.hash
  } catch {
    return null
  }
}
