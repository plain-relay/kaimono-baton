// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  loadCartOrder,
  loadCheckedState,
  loadConsultations,
  loadItemIssues,
  saveCartOrder,
  saveCheckedState,
  saveConsultations,
  saveItemIssues,
} from './storage'

describe('shopping storage failures', () => {
  afterEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('returns safe normalized values when localStorage reads are blocked', () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('storage blocked', 'SecurityError')
    })

    expect(loadCheckedState('request')).toEqual({})
    expect(loadItemIssues('request')).toEqual({})
    expect(loadCartOrder('request')).toEqual([])
    expect(loadConsultations('request')).toEqual({})
  })

  it.each(['QuotaExceededError', 'SecurityError'])(
    'reports false without crashing when a write throws %s',
    (errorName) => {
      const warn = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined)
      vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
        throw new DOMException('storage unavailable', errorName)
      })

      expect(saveCheckedState('request', { milk: 'inCart' })).toBe(false)
      expect(
        saveItemIssues('request', { eggs: { reason: 'soldOut' } }),
      ).toBe(false)
      expect(saveCartOrder('request', ['milk'])).toBe(false)
      expect(
        saveConsultations('request', {
          eggs: {
            itemId: 'eggs',
            reason: 'soldOut',
            status: 'queued',
          },
        }),
      ).toBe(false)
      expect(warn).toHaveBeenCalledTimes(4)
    },
  )
})
