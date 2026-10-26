import { parseIncomingLink } from './incomingLink'
import { PUBLIC_WEB_BASE } from './runtime'

// Native-only additive key. Existing Web storage keys and shapes are unchanged.
const KEY = 'kaimono-baton:native:last-fixed-route:v1'
export function rememberFixedRequest(hash: string): void {
  if (!hash.startsWith('#/l/') && !hash.startsWith('#/list?')) return
  try { window.localStorage.setItem(KEY, hash) } catch { /* Core remains usable without persistence. */ }
}
export function loadFixedRequest(): string | null {
  try {
    const hash = window.localStorage.getItem(KEY)
    return hash && (hash.startsWith('#/l/') || hash.startsWith('#/list?'))
      ? parseIncomingLink(PUBLIC_WEB_BASE + hash) : null
  } catch { return null }
}
