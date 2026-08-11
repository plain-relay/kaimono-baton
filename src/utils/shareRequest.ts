import { MAX_SHARE_URL_LENGTH } from '../constants/requestLimits'

export type RequestShareLock = {
  tryAcquire: () => boolean
  release: () => void
  isActive: () => boolean
}

export function createRequestShareLock(): RequestShareLock {
  let active = false
  return {
    tryAcquire: () => {
      if (active) {
        return false
      }
      active = true
      return true
    },
    release: () => {
      active = false
    },
    isActive: () => active,
  }
}

export function isRequestUrlWithinShareLimit(requestUrl: string): boolean {
  return requestUrl.length <= MAX_SHARE_URL_LENGTH
}
