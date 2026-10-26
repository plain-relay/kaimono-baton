import { rememberFixedRequest } from './fixedRequestResume'
import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { isNativeApp } from './runtime'
import { parseIncomingLink } from './incomingLink'

export function openIncomingLink(url: string): void {
  const hash = parseIncomingLink(url)
  if (hash) { rememberFixedRequest(hash); window.location.hash = hash }
  else window.dispatchEvent(new Event('native-link-error'))
}

export function handleAndroidBack(canGoBack: boolean): void {
  if (!window.location.hash || window.location.hash === '#/') {
    void App.minimizeApp()
  } else if (canGoBack) window.history.back()
  else window.location.hash = '/'
}

export async function handleNativeLinkClick(event: MouseEvent): Promise<void> {
  const anchor = event.target instanceof Element ? event.target.closest('a') : null
  if (!anchor || !anchor.href || anchor.origin === window.location.origin) return
  event.preventDefault()
  try {
    const url = new URL(anchor.href)
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('unsupported')
    await Browser.open({ url: url.href })
  } catch {
    window.dispatchEvent(new Event('native-link-error'))
  }
}

export async function initializeNativeRuntime(): Promise<void> {
  if (!isNativeApp()) return
  document.documentElement.classList.add('native-app')
  document.addEventListener('click', event => { void handleNativeLinkClick(event) })
  try {
    // Register first so foreground link events cannot be lost during launch lookup.
    await App.addListener('appUrlOpen', ({ url }) => openIncomingLink(url))
    if (Capacitor.getPlatform() === 'android') {
      await App.addListener('backButton', ({ canGoBack }) => handleAndroidBack(canGoBack))
    }
    const launch = await App.getLaunchUrl()
    if (launch?.url) openIncomingLink(launch.url)
  } catch {
    // No URL, capability or plugin error is logged. Pasting remains available.
    window.dispatchEvent(new Event('native-link-error'))
  }
}
