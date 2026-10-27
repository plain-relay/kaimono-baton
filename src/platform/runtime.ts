import type { CapacitorGlobal } from '@capacitor/core'

export const PUBLIC_WEB_BASE = 'https://plain-relay.github.io/kaimono-baton/'

export function isNativeApp(): boolean {
  // Capacitor 8 injects this API at document start on Android and iOS.
  // Keep the browser entry free of plugin registration code.
  const runtime = (globalThis as typeof globalThis & { Capacitor?: Partial<CapacitorGlobal> }).Capacitor
  return typeof runtime?.isNativePlatform === 'function' && runtime.isNativePlatform() === true
}

// Never derive a native outgoing URL from a WebView origin.
export function resolveRequestBaseUrl(location: Pick<Location, 'origin' | 'pathname'>, native: boolean): string {
  return native ? PUBLIC_WEB_BASE : `${location.origin}${location.pathname}`
}

export function getRequestBaseUrl(): string {
  return resolveRequestBaseUrl(window.location, isNativeApp())
}

export function resolvePublicCurrentUrl(href: string, native: boolean): string {
  return native ? `${PUBLIC_WEB_BASE}${new URL(href).hash}` : href
}

export function getPublicCurrentUrl(): string {
  return resolvePublicCurrentUrl(window.location.href, isNativeApp())
}

export function getRecoveryBaseUrl(): string {
  return isNativeApp() ? PUBLIC_WEB_BASE : window.location.href.split('#', 1)[0]
}
