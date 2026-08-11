// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest'
import {
  CREATE_REQUEST_RETURN_STATE_KEY,
  clearCreateRequestReturnState,
  loadCreateRequestReturnState,
  parseCreateRequestReturnState,
  saveCreateRequestReturnState,
  type CreateRequestReturnState,
} from './createRequestReturnState'

const validReturnState: CreateRequestReturnState = {
  customItems: [
    {
      id: 'custom-1',
      name: '洗濯ネット',
      quantity: 2,
      unit: '枚',
      memo: '大きめ',
    },
  ],
  expandedProductIds: ['milk'],
  sharedUrl: 'https://example.com/#/l/request',
  sharedSnapshot: 'snapshot',
}

describe('create request return state parsing', () => {
  it('returns copied arrays for a valid state and ignores legacy extra fields', () => {
    const historyState = {
      [CREATE_REQUEST_RETURN_STATE_KEY]: {
        ...validReturnState,
        title: '過去の依頼タイトル',
      },
    }

    const parsed = parseCreateRequestReturnState(historyState)

    expect(parsed).toEqual(validReturnState)
    expect(parsed?.customItems).not.toBe(validReturnState.customItems)
    expect(parsed?.expandedProductIds).not.toBe(validReturnState.expandedProductIds)
  })

  it.each([
    ['non-object history state', null],
    ['missing return state', {}],
    [
      'partial return state',
      {
        [CREATE_REQUEST_RETURN_STATE_KEY]: {
          customItems: [],
          expandedProductIds: [],
          sharedUrl: 'https://example.com',
        },
      },
    ],
    [
      'invalid expanded product ids',
      {
        [CREATE_REQUEST_RETURN_STATE_KEY]: {
          ...validReturnState,
          expandedProductIds: ['milk', 1],
        },
      },
    ],
  ])('rejects %s', (_, historyState) => {
    expect(parseCreateRequestReturnState(historyState)).toBeUndefined()
  })

  it('filters malformed custom items while keeping the valid return state', () => {
    expect(
      parseCreateRequestReturnState({
        [CREATE_REQUEST_RETURN_STATE_KEY]: {
          ...validReturnState,
          customItems: [
            ...validReturnState.customItems,
            { id: 'broken', name: '不正', quantity: Number.NaN },
            null,
          ],
        },
      }),
    ).toEqual(validReturnState)
  })
})

describe('create request return state history I/O', () => {
  beforeEach(() => {
    window.history.replaceState({ preserved: 'value' }, '', '/#/create')
  })

  it('saves and loads the return state without removing unrelated history data', () => {
    saveCreateRequestReturnState(validReturnState)

    expect(window.history.state.preserved).toBe('value')
    expect(loadCreateRequestReturnState()).toEqual(validReturnState)
  })

  it('clears only the create request return state', () => {
    saveCreateRequestReturnState(validReturnState)
    clearCreateRequestReturnState()

    expect(window.history.state).toEqual({ preserved: 'value' })
    expect(loadCreateRequestReturnState()).toBeUndefined()
  })

  it('leaves history untouched when no return state exists', () => {
    clearCreateRequestReturnState()

    expect(window.history.state).toEqual({ preserved: 'value' })
  })
})
