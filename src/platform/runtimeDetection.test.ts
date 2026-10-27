import { afterEach, describe, expect, it, vi } from 'vitest'
import { isNativeApp } from './runtime'

afterEach(() => vi.unstubAllGlobals())
describe('document-start native runtime detection', () => {
  it('keeps an ordinary browser usable without loading Capacitor', () => {
    vi.stubGlobal('Capacitor', undefined)
    expect(isNativeApp()).toBe(false)
    vi.stubGlobal('Capacitor', {})
    expect(isNativeApp()).toBe(false)
    vi.stubGlobal('Capacitor', { isNativePlatform: true })
    expect(isNativeApp()).toBe(false)
  })
  it('uses the injected native API rather than an origin or user agent', () => {
    vi.stubGlobal('Capacitor', { isNativePlatform: () => true })
    expect(isNativeApp()).toBe(true)
    vi.stubGlobal('Capacitor', { isNativePlatform: () => false })
    expect(isNativeApp()).toBe(false)
  })
})
