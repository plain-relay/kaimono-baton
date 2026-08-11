// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { products } from '../data/products'
import type {
  CheckedStateMap,
  ConsultationMap,
  CreateDraftState,
  ItemIssueMap,
} from '../types/shopping'
import {
  buildCompactRequestPayload,
  decodeCompactRequest,
  encodeCompactRequest,
} from '../utils/compactRequest'
import { ShoppingListPage } from './ShoppingListPage'

type RequestItemInput = {
  quantity?: number
  memo?: string
}

function createRequest(
  itemInputs: RequestItemInput[] = [{}],
  requestKey = `shopping-flow-${itemInputs.length}`,
) {
  const draft: CreateDraftState = Object.fromEntries(
    products.map((product) => [product.id, { quantity: 0, memo: '' }]),
  )
  itemInputs.forEach((input, index) => {
    const product = products[index]
    draft[product.id] = {
      quantity: input.quantity ?? 1,
      memo: input.memo ?? '',
    }
  })
  const encoded = encodeCompactRequest(
    buildCompactRequestPayload({
      requestKey,
      title: '共有テスト',
      draft,
      customItems: [],
    }),
  )
  return { encoded, payload: decodeCompactRequest(encoded) }
}

function setNavigatorShare(
  share: ((data: ShareData) => Promise<void>) | undefined,
) {
  Object.defineProperty(window.navigator, 'share', {
    configurable: true,
    value: share,
  })
}

function setClipboardWriter(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
}

describe('ShoppingListPage buyer flow', () => {
  let container: HTMLDivElement
  let root: Root
  let rootIsMounted: boolean

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true
    window.localStorage.clear()
    window.history.replaceState({}, '', '/')
    setNavigatorShare(undefined)
    setClipboardWriter(async () => undefined)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    rootIsMounted = true
  })

  afterEach(() => {
    if (rootIsMounted) {
      act(() => root.unmount())
    }
    container.remove()
    document.body.style.overflow = ''
    window.localStorage.clear()
    window.history.replaceState({}, '', '/')
    delete (window.navigator as unknown as Record<string, unknown>).share
    delete (window.navigator as unknown as Record<string, unknown>).clipboard
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  async function renderRequest(encoded: string) {
    window.history.replaceState({}, '', `/#/l/${encoded}`)
    await act(async () => {
      root.render(
        <ShoppingListPage
          encodedPayload={encoded}
          payloadCodec="compact-path"
          onBackHome={() => undefined}
          onError={(title, description) => {
            throw new Error(`${title}: ${description}`)
          }}
        />,
      )
      await Promise.resolve()
    })
  }

  async function remountRequest(encoded: string) {
    act(() => root.unmount())
    root = createRoot(container)
    rootIsMounted = true
    await renderRequest(encoded)
  }

  function buttons(label: string): HTMLButtonElement[] {
    return [...container.querySelectorAll<HTMLButtonElement>('button')].filter(
      (candidate) => candidate.textContent?.trim() === label,
    )
  }

  function button(label: string): HTMLButtonElement {
    const found = buttons(label)[0]
    if (!found) {
      throw new Error(`Button was not rendered: ${label}`)
    }
    return found
  }

  function click(element: Element) {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }

  async function clickAndFlush(element: Element) {
    await act(async () => {
      click(element)
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  function storeShoppingState(
    requestId: string,
    checkedState: CheckedStateMap,
    itemIssues: ItemIssueMap = {},
    consultations: ConsultationMap = {},
    cartOrder: string[] = [],
  ) {
    window.localStorage.setItem(
      `otsukai:checked:${requestId}`,
      JSON.stringify(checkedState),
    )
    window.localStorage.setItem(
      `otsukai:itemIssues:${requestId}`,
      JSON.stringify(itemIssues),
    )
    window.localStorage.setItem(
      `otsukai:consultations:${requestId}`,
      JSON.stringify(consultations),
    )
    window.localStorage.setItem(
      `otsukai:cartOrder:${requestId}`,
      JSON.stringify(cartOrder),
    )
  }

  function readCheckedState(requestId: string): CheckedStateMap {
    return JSON.parse(
      window.localStorage.getItem(`otsukai:checked:${requestId}`) ?? '{}',
    ) as CheckedStateMap
  }

  function readConsultations(requestId: string): ConsultationMap {
    return JSON.parse(
      window.localStorage.getItem(`otsukai:consultations:${requestId}`) ?? '{}',
    ) as ConsultationMap
  }

  async function selectReason(reason = 'soldOut') {
    const input = container.querySelector<HTMLInputElement>(
      `input[type="radio"][value="${reason}"]`,
    )
    if (!input) {
      throw new Error(`Consultation reason was not rendered: ${reason}`)
    }
    await clickAndFlush(input)
  }

  async function openConsultation(reason = 'soldOut') {
    await clickAndFlush(button('相談する'))
    await selectReason(reason)
  }

  function createDeferredNativeShare() {
    let resolveShare: () => void = () => {}
    const share = vi.fn(
      (_data: ShareData) =>
        new Promise<void>((resolve) => {
          resolveShare = resolve
        }),
    )
    setNavigatorShare(share)
    return {
      share,
      resolve: async () => {
        await act(async () => {
          resolveShare()
          await Promise.resolve()
        })
      },
    }
  }

  function expectTitleAndTextOnly(
    share: ReturnType<typeof vi.fn>,
    title: string,
    expectedText: string,
  ) {
    expect(share).toHaveBeenCalledTimes(1)
    const sharedData = share.mock.calls[0][0] as ShareData
    expect(sharedData.title).toBe(title)
    expect(sharedData.text).toContain(expectedText)
    expect(Object.keys(sharedData).sort()).toEqual(['text', 'title'])
    expect('url' in sharedData).toBe(false)
  }

  it('puts a quantity-one item without conditions in the cart in one tap', async () => {
    const { encoded, payload } = createRequest()
    await renderRequest(encoded)

    await clickAndFlush(button('かごに入れる'))

    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(readCheckedState(payload.requestId)[payload.items[0].id]).toBe('inCart')
    expect(button('元に戻す')).toBeDefined()
  })

  it('shows only quantity confirmation for quantity two and requires its checkbox', async () => {
    const { encoded, payload } = createRequest([{ quantity: 2 }])
    await renderRequest(encoded)

    expect(container.textContent).toContain('×2')
    await clickAndFlush(button('2個をかごに入れる'))
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')
    expect(dialog?.textContent).toContain('数量の確認')
    expect(dialog?.textContent).toContain('必要数量')
    expect(dialog?.textContent).toContain('2個')
    expect(dialog?.textContent).not.toContain('条件の確認')
    expect(button('2個をかご済みにする').disabled).toBe(true)

    const quantityCheck = container.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    )
    await clickAndFlush(quantityCheck!)
    expect(button('2個をかご済みにする').disabled).toBe(false)
    await clickAndFlush(button('2個をかご済みにする'))
    expect(readCheckedState(payload.requestId)[payload.items[0].id]).toBe('inCart')
  })

  it('shows only the full condition for quantity one and saves verified', async () => {
    const condition = '成分無調整、1L\n賞味期限が長いもの'
    const { encoded, payload } = createRequest([{ memo: condition }])
    await renderRequest(encoded)

    await clickAndFlush(button('かごに入れる'))
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')
    expect(dialog?.textContent).not.toContain('数量の確認')
    expect(dialog?.textContent).toContain('条件の確認')
    expect(dialog?.textContent).toContain(condition)
    expect(button('条件を確認してかご済みにする').disabled).toBe(true)

    await clickAndFlush(
      container.querySelector<HTMLInputElement>('input[type="checkbox"]')!,
    )
    await clickAndFlush(button('条件を確認してかご済みにする'))
    expect(readCheckedState(payload.requestId)[payload.items[0].id]).toBe('verified')
  })

  it('shows quantity and condition in one dialog and waits for both checks', async () => {
    const { encoded, payload } = createRequest([
      { quantity: 2, memo: '傷のないもの' },
    ])
    await renderRequest(encoded)

    await clickAndFlush(button('2個をかごに入れる'))
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    expect(container.textContent).toContain('数量の確認')
    expect(container.textContent).toContain('条件の確認')
    const confirm = button('確認してかご済みにする')
    const checks = container.querySelectorAll<HTMLInputElement>(
      '[role="dialog"] input[type="checkbox"]',
    )
    expect(confirm.disabled).toBe(true)
    await clickAndFlush(checks[0])
    expect(confirm.disabled).toBe(true)
    await clickAndFlush(checks[1])
    expect(confirm.disabled).toBe(false)
    await clickAndFlush(confirm)
    expect(readCheckedState(payload.requestId)[payload.items[0].id]).toBe('verified')
  })

  it('closes a purchase dialog without changing state and restores focus', async () => {
    const { encoded, payload } = createRequest([{ quantity: 2 }])
    await renderRequest(encoded)
    const trigger = button('2個をかごに入れる')
    trigger.focus()
    await clickAndFlush(trigger)

    const heading = container.querySelector<HTMLHeadingElement>(
      '[role="dialog"] h2',
    )
    expect(document.activeElement).toBe(heading)
    expect(document.body.style.overflow).toBe('hidden')
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )
      await Promise.resolve()
    })

    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(readCheckedState(payload.requestId)[payload.items[0].id]).toBeUndefined()
    expect(document.body.style.overflow).toBe('')
    expect(document.activeElement).toBe(trigger)
  })

  it('opens consultation from purchase confirmation without buying the item', async () => {
    const { encoded, payload } = createRequest([{ memo: '国産' }])
    const item = payload.items[0]
    await renderRequest(encoded)
    await clickAndFlush(button('かごに入れる'))
    const consultationButton = [
      ...container.querySelectorAll<HTMLButtonElement>(
        '[role="dialog"] button',
      ),
    ].find((candidate) => candidate.textContent?.trim() === '相談する')

    await clickAndFlush(consultationButton!)

    expect(container.querySelector('[role="dialog"]')?.textContent).toContain(
      `${item.productNameSnapshot}について相談する`,
    )
    expect(readCheckedState(payload.requestId)[item.id]).toBeUndefined()
  })

  it('undoes a confirmed cart change and restores the exact cart order', async () => {
    const { encoded, payload } = createRequest([{}, {}])
    const [first, second] = payload.items
    storeShoppingState(
      payload.requestId,
      { [first.id]: 'inCart', [second.id]: 'inCart' },
      {},
      {},
      [first.id, second.id],
    )
    await renderRequest(encoded)

    const resetFirst = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${first.productNameSnapshot}を未購入に戻す"]`,
    )
    await clickAndFlush(resetFirst!)
    await clickAndFlush(button('元に戻す'))

    expect(readCheckedState(payload.requestId)[first.id]).toBe('inCart')
    expect(
      JSON.parse(
        window.localStorage.getItem(
          `otsukai:cartOrder:${payload.requestId}`,
        ) ?? '[]',
      ),
    ).toEqual([first.id, second.id])
    expect(container.textContent).not.toContain('元に戻す')
  })

  it('expires the latest Undo after five seconds and resets for a newer action', async () => {
    vi.useFakeTimers()
    const { encoded, payload } = createRequest([{}, {}])
    const [first, second] = payload.items
    await renderRequest(encoded)

    await clickAndFlush(button('かごに入れる'))
    act(() => vi.advanceTimersByTime(4_000))
    await clickAndFlush(button('かごに入れる'))
    expect(container.textContent).toContain(
      `${second.productNameSnapshot}をかご済みにしました`,
    )
    expect(container.textContent).not.toContain(
      `${first.productNameSnapshot}をかご済みにしました`,
    )
    act(() => vi.advanceTimersByTime(4_999))
    expect(button('元に戻す')).toBeDefined()
    act(() => vi.advanceTimersByTime(1))
    expect(container.textContent).not.toContain('元に戻す')
  })

  it('clears the current Undo when another request URL is loaded', async () => {
    vi.useFakeTimers()
    const firstRequest = createRequest([{}], 'first-request')
    const secondRequest = createRequest([{}], 'second-request')
    await renderRequest(firstRequest.encoded)
    await clickAndFlush(button('かごに入れる'))
    expect(button('元に戻す')).toBeDefined()

    await renderRequest(secondRequest.encoded)

    expect(container.textContent).not.toContain('元に戻す')
  })

  it('reports the established shared-URL error when session loading fails', async () => {
    const onError = vi.fn()

    await act(async () => {
      root.render(
        <ShoppingListPage
          encodedPayload="broken-data"
          payloadCodec="compact-path"
          onBackHome={() => undefined}
          onError={onError}
        />,
      )
      await Promise.resolve()
    })

    expect(onError).toHaveBeenCalledWith(
      '共有URLを開けませんでした',
      '共有URLの復元に失敗しました。',
    )
    expect(container.textContent).toBe('')
  })

  it('shows a consultation button for every purchase state and consultation state', async () => {
    const { encoded, payload } = createRequest([{}, {}, {}, {}, {}, {}])
    const [pending, inCart, verified, notBuying, queued, shared] = payload.items
    storeShoppingState(
      payload.requestId,
      {
        [pending.id]: 'pending',
        [inCart.id]: 'inCart',
        [verified.id]: 'verified',
        [notBuying.id]: 'notBuying',
        [queued.id]: 'inCart',
        [shared.id]: 'notBuying',
      },
      {
        [notBuying.id]: { reason: 'soldOut' },
        [shared.id]: { reason: 'notFound' },
      },
      {
        [queued.id]: {
          itemId: queued.id,
          reason: 'notFound',
          status: 'queued',
        },
        [shared.id]: {
          itemId: shared.id,
          reason: 'poorCondition',
          status: 'shared',
        },
      },
    )
    await renderRequest(encoded)

    expect(buttons('相談する')).toHaveLength(6)
  })

  it('shares one item immediately without changing its cart state', async () => {
    const deferred = createDeferredNativeShare()
    const { encoded, payload } = createRequest([{ quantity: 2, memo: '国産' }])
    const item = payload.items[0]
    storeShoppingState(
      payload.requestId,
      { [item.id]: 'inCart' },
      {},
      {},
      [item.id],
    )
    await renderRequest(encoded)

    await openConsultation('conditionMismatch')
    act(() => {
      const shareButton = button('LINEですぐ相談')
      click(shareButton)
      click(shareButton)
    })
    expectTitleAndTextOnly(
      deferred.share,
      'おつかい相談',
      `商品：${item.productNameSnapshot}`,
    )
    const sharedText = (deferred.share.mock.calls[0][0] as ShareData).text ?? ''
    expect(sharedText).toContain('数量：2個')
    expect(sharedText).toContain('条件：国産')
    expect(sharedText).toContain('状況：指定条件の商品がない')
    await deferred.resolve()

    expect(readCheckedState(payload.requestId)[item.id]).toBe('inCart')
    expect(readConsultations(payload.requestId)[item.id].status).toBe('shared')
    expect(container.textContent).toContain('LINEを選択して送信してください。')
  })

  it('does not lock purchase actions while a consultation share is open', async () => {
    const deferred = createDeferredNativeShare()
    const { encoded, payload } = createRequest()
    const item = payload.items[0]
    await renderRequest(encoded)

    await openConsultation('notFound')
    act(() => click(button('LINEですぐ相談')))
    expect(deferred.share).toHaveBeenCalledTimes(1)
    await clickAndFlush(button('戻る'))
    expect(button('かごに入れる').disabled).toBe(false)
    await clickAndFlush(button('かごに入れる'))
    expect(readCheckedState(payload.requestId)[item.id]).toBe('inCart')
    await deferred.resolve()
    expect(readCheckedState(payload.requestId)[item.id]).toBe('inCart')
    expect(readConsultations(payload.requestId)[item.id].status).toBe('shared')
  })

  it('adds and updates the same queue entry without duplication', async () => {
    const { encoded, payload } = createRequest()
    const item = payload.items[0]
    await renderRequest(encoded)

    await openConsultation('soldOut')
    await clickAndFlush(button('まとめ相談に追加'))
    expect(container.textContent).toContain('まとめ相談 1件')
    await clickAndFlush(button('編集'))
    await selectReason('notFound')
    await clickAndFlush(button('まとめ相談に追加'))

    const saved = readConsultations(payload.requestId)
    expect(Object.keys(saved)).toEqual([item.id])
    expect(saved[item.id]).toMatchObject({
      itemId: item.id,
      reason: 'notFound',
      status: 'queued',
    })
  })

  it('bulk-shares only queued entries and marks them shared', async () => {
    const share = vi.fn(async (_data: ShareData) => undefined)
    setNavigatorShare(share)
    const { encoded, payload } = createRequest([{}, {}, {}])
    const [first, second, alreadyShared] = payload.items
    storeShoppingState(
      payload.requestId,
      {},
      {},
      {
        [first.id]: {
          itemId: first.id,
          reason: 'soldOut',
          status: 'queued',
        },
        [second.id]: {
          itemId: second.id,
          reason: 'notFound',
          status: 'queued',
        },
        [alreadyShared.id]: {
          itemId: alreadyShared.id,
          reason: 'poorCondition',
          status: 'shared',
        },
      },
    )
    await renderRequest(encoded)

    await clickAndFlush(button('まとめてLINEで相談'))
    expectTitleAndTextOnly(
      share,
      'おつかい相談',
      '次の商品について確認をお願いします。',
    )
    const text = (share.mock.calls[0][0] as ShareData).text ?? ''
    expect(text).toContain(first.productNameSnapshot)
    expect(text).toContain(second.productNameSnapshot)
    expect(text).not.toContain(alreadyShared.productNameSnapshot)
    const saved = readConsultations(payload.requestId)
    expect(saved[first.id].status).toBe('shared')
    expect(saved[second.id].status).toBe('shared')
    expect(saved[alreadyShared.id].status).toBe('shared')
  })

  it.each(['cancelled', 'failed'] as const)(
    'keeps consultation input and queued state when immediate sharing is %s',
    async (outcome) => {
      if (outcome === 'cancelled') {
        setNavigatorShare(
          vi.fn(async () => {
            throw { name: 'AbortError' }
          }),
        )
      } else {
        setNavigatorShare(
          vi.fn(async () => {
            throw new Error('native share failed')
          }),
        )
        setClipboardWriter(
          vi.fn(async () => {
            throw new Error('clipboard failed')
          }),
        )
      }
      const { encoded, payload } = createRequest()
      const item = payload.items[0]
      await renderRequest(encoded)
      await openConsultation('soldOut')
      await clickAndFlush(button('LINEですぐ相談'))

      expect(readConsultations(payload.requestId)[item.id]).toMatchObject({
        reason: 'soldOut',
        status: 'queued',
      })
      expect(container.querySelector('[role="dialog"]')).not.toBeNull()
      expect(
        container.querySelector<HTMLInputElement>(
          'input[type="radio"][value="soldOut"]',
        )?.checked,
      ).toBe(true)
      expect(container.textContent).toContain('相談内容はそのまま残しています。')
    },
  )

  it('marks a copied consultation as a completed share operation', async () => {
    const clipboard = vi.fn(async (_text: string) => undefined)
    setNavigatorShare(undefined)
    setClipboardWriter(clipboard)
    const { encoded, payload } = createRequest()
    const item = payload.items[0]
    await renderRequest(encoded)
    await openConsultation('soldOut')

    await clickAndFlush(button('LINEですぐ相談'))

    expect(clipboard).toHaveBeenCalledTimes(1)
    expect(readConsultations(payload.requestId)[item.id].status).toBe('shared')
    expect(container.textContent).toContain(
      'OS共有を利用できなかったため、相談文をコピーしました。',
    )
  })

  it('resolves a consultation without changing the purchase state', async () => {
    const { encoded, payload } = createRequest()
    const item = payload.items[0]
    storeShoppingState(
      payload.requestId,
      { [item.id]: 'inCart' },
      {},
      {
        [item.id]: {
          itemId: item.id,
          reason: 'notFound',
          status: 'shared',
        },
      },
      [item.id],
    )
    await renderRequest(encoded)

    await clickAndFlush(button('相談を解決'))

    expect(readCheckedState(payload.requestId)[item.id]).toBe('inCart')
    expect(readConsultations(payload.requestId)[item.id].status).toBe('resolved')
    expect(button('買い物を終了する')).toBeDefined()
  })

  it('removes an individual queue entry and keeps another entry', async () => {
    const { encoded, payload } = createRequest([{}, {}])
    const [first, second] = payload.items
    storeShoppingState(
      payload.requestId,
      {},
      {},
      {
        [first.id]: {
          itemId: first.id,
          reason: 'soldOut',
          status: 'queued',
        },
        [second.id]: {
          itemId: second.id,
          reason: 'notFound',
          status: 'queued',
        },
      },
    )
    await renderRequest(encoded)

    await clickAndFlush(buttons('削除')[0])
    const saved = readConsultations(payload.requestId)
    expect(saved[first.id]).toBeUndefined()
    expect(saved[second.id]).toBeDefined()
    expect(container.textContent).toContain('まとめ相談 1件')
  })

  it('migrates legacy consulting state to pending plus a queued consultation', async () => {
    const { encoded, payload } = createRequest()
    const item = payload.items[0]
    storeShoppingState(
      payload.requestId,
      { [item.id]: 'consulting' },
      { [item.id]: { reason: 'other', note: '予算より高い' } },
    )
    await renderRequest(encoded)

    expect(readCheckedState(payload.requestId)[item.id]).toBe('pending')
    expect(
      JSON.parse(
        window.localStorage.getItem(
          `otsukai:itemIssues:${payload.requestId}`,
        ) ?? '{}',
      ),
    ).toEqual({})
    expect(readConsultations(payload.requestId)[item.id]).toEqual({
      itemId: item.id,
      reason: 'other',
      note: '予算より高い',
      status: 'queued',
    })
  })

  it('ignores malformed consultation storage safely', async () => {
    const { encoded, payload } = createRequest()
    window.localStorage.setItem(
      `otsukai:consultations:${payload.requestId}`,
      JSON.stringify({
        broken: { itemId: 42, reason: 'unknown', status: 'waiting' },
        [payload.items[0].id]: {
          itemId: 'different-item',
          reason: 'soldOut',
          status: 'queued',
        },
      }),
    )

    await renderRequest(encoded)

    expect(container.querySelector('h1')?.textContent).toBe('おつかいリスト')
    expect(readConsultations(payload.requestId)).toEqual({})
  })

  it('restores purchase, consultation, and cart-order state after reload', async () => {
    const { encoded, payload } = createRequest([{}, {}])
    const [first, second] = payload.items
    storeShoppingState(
      payload.requestId,
      { [first.id]: 'inCart', [second.id]: 'notBuying' },
      { [second.id]: { reason: 'soldOut' } },
      {
        [first.id]: {
          itemId: first.id,
          reason: 'notFound',
          status: 'queued',
        },
      },
      [first.id],
    )
    await renderRequest(encoded)
    await remountRequest(encoded)

    expect(readCheckedState(payload.requestId)).toMatchObject({
      [first.id]: 'inCart',
      [second.id]: 'notBuying',
    })
    expect(container.textContent).toContain('まとめ相談 1件')
    expect(container.textContent).toContain('今回は買わない商品')
    expect(
      JSON.parse(
        window.localStorage.getItem(
          `otsukai:cartOrder:${payload.requestId}`,
        ) ?? '[]',
      ),
    ).toEqual([first.id])
  })

  it('removes checkout condition buttons and confirms legacy inCart data in the purchase dialog', async () => {
    const { encoded, payload } = createRequest([{ memo: '大きめ' }])
    const item = payload.items[0]
    storeShoppingState(
      payload.requestId,
      { [item.id]: 'inCart' },
      {},
      {},
      [item.id],
    )
    await renderRequest(encoded)

    expect(container.textContent).not.toContain('条件を確認した')
    expect(container.textContent).not.toContain('確認を戻す')
    expect(container.textContent).not.toContain(
      '条件ありの商品だけ、会計前に条件確認済みにしてください',
    )
    await clickAndFlush(button('購入時確認を開く'))
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain(
      '条件の確認',
    )
    await clickAndFlush(
      container.querySelector<HTMLInputElement>(
        '[role="dialog"] input[type="checkbox"]',
      )!,
    )
    await clickAndFlush(button('条件を確認してかご済みにする'))
    expect(readCheckedState(payload.requestId)[item.id]).toBe('verified')
  })

  it('shows quantities and exceptions at checkout and blocks finish until resolved', async () => {
    const { encoded, payload } = createRequest([{ quantity: 2 }, {}])
    const [cartItem, pendingItem] = payload.items
    storeShoppingState(
      payload.requestId,
      { [cartItem.id]: 'inCart', [pendingItem.id]: 'pending' },
      {},
      {
        [cartItem.id]: {
          itemId: cartItem.id,
          reason: 'notFound',
          status: 'shared',
        },
      },
      [cartItem.id],
    )
    await renderRequest(encoded)
    await clickAndFlush(button('会計前チェックへ'))

    const checkout = container.querySelector('.checkout-review-card')
    expect(checkout?.textContent).toContain('2個')
    expect(checkout?.textContent).toContain('未処理の商品')
    expect(checkout?.textContent).toContain(pendingItem.productNameSnapshot)
    expect(checkout?.textContent).toContain('未解決相談')
    expect(buttons('買い物を終了する')).toHaveLength(0)
  })

  it('finishes only after every purchase and consultation is resolved', async () => {
    const { encoded, payload } = createRequest()
    const item = payload.items[0]
    storeShoppingState(
      payload.requestId,
      { [item.id]: 'inCart' },
      {},
      {
        [item.id]: {
          itemId: item.id,
          reason: 'notFound',
          status: 'queued',
        },
      },
      [item.id],
    )
    await renderRequest(encoded)

    expect(buttons('買い物を終了する')).toHaveLength(0)
    await clickAndFlush(button('相談を解決'))
    await clickAndFlush(button('買い物を終了する'))
    expect(container.textContent).toContain('おつかい完了')
    expect(button('ホームへ')).toBeDefined()
  })

  it('keeps completion and checkout focus targets connected', async () => {
    const animationFrames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      animationFrames.push(callback)
      return animationFrames.length
    })
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(
      () => undefined,
    )
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    const flushAnimationFrames = async () => {
      await act(async () => {
        animationFrames.splice(0).forEach((callback) => callback(0))
        await Promise.resolve()
      })
    }
    const { encoded, payload } = createRequest()
    const item = payload.items[0]
    storeShoppingState(
      payload.requestId,
      { [item.id]: 'inCart' },
      {},
      {},
      [item.id],
    )
    await renderRequest(encoded)

    await clickAndFlush(button('買い物を終了する'))
    await flushAnimationFrames()
    const completionHeading = [...container.querySelectorAll('h1')].find(
      (candidate) => candidate.textContent?.trim() === 'おつかい完了',
    )
    expect(document.activeElement).toBe(completionHeading)

    await clickAndFlush(button('買い物内容を見直す'))
    await flushAnimationFrames()
    expect(document.activeElement).toBe(
      container.querySelector('.checkout-review-card'),
    )
  })

  it('marks an item not buying from consultation input and can Undo it', async () => {
    const { encoded, payload } = createRequest()
    const item = payload.items[0]
    await renderRequest(encoded)

    await openConsultation('poorCondition')
    await clickAndFlush(button('今回は買わない'))
    expect(readCheckedState(payload.requestId)[item.id]).toBe('notBuying')
    await clickAndFlush(button('元に戻す'))
    expect(readCheckedState(payload.requestId)[item.id]).toBe('pending')
  })

  it('uses one native share call for the shopping result', async () => {
    const deferred = createDeferredNativeShare()
    const { encoded, payload } = createRequest()
    const item = payload.items[0]
    storeShoppingState(
      payload.requestId,
      { [item.id]: 'inCart' },
      {},
      {
        [item.id]: {
          itemId: item.id,
          reason: 'notFound',
          status: 'resolved',
        },
      },
      [item.id],
    )
    await renderRequest(encoded)
    await clickAndFlush(button('買い物を終了する'))

    act(() => {
      const shareButton = button('結果を共有')
      click(shareButton)
      click(shareButton)
    })
    expectTitleAndTextOnly(
      deferred.share,
      'おつかい結果',
      '【おつかい結果】',
    )
    await deferred.resolve()
    expect(container.textContent).toContain(
      'LINEを選択して結果を送信してください。',
    )
    expect(readConsultations(payload.requestId)[item.id].status).toBe(
      'resolved',
    )
  })

  it('ignores a pending result share after switching requests and allows the new request to share', async () => {
    const deferred = createDeferredNativeShare()
    const firstRequest = createRequest([{}], 'result-share-first')
    const secondRequest = createRequest([{}], 'result-share-second')
    const firstItem = firstRequest.payload.items[0]
    storeShoppingState(
      firstRequest.payload.requestId,
      { [firstItem.id]: 'inCart' },
      {},
      {},
      [firstItem.id],
    )
    await renderRequest(firstRequest.encoded)
    await clickAndFlush(button('買い物を終了する'))

    act(() => {
      click(button('結果を共有'))
    })
    expect(deferred.share).toHaveBeenCalledTimes(1)

    await renderRequest(secondRequest.encoded)
    await deferred.resolve()
    expect(container.textContent).not.toContain(
      'LINEを選択して結果を送信してください。',
    )

    const retryShare = vi.fn(async (_data: ShareData) => undefined)
    setNavigatorShare(retryShare)
    await clickAndFlush(button('かごに入れる'))
    await clickAndFlush(button('買い物を終了する'))
    await clickAndFlush(button('結果を共有'))

    expect(retryShare).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain(
      'LINEを選択して結果を送信してください。',
    )
  })

  it('invalidates a pending result share when reviewing and allows consultation sharing', async () => {
    let resolveResultShare: () => void = () => {}
    const share = vi
      .fn<(data: ShareData) => Promise<void>>()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveResultShare = resolve
          }),
      )
      .mockResolvedValue(undefined)
    setNavigatorShare(share)
    const { encoded, payload } = createRequest()
    const item = payload.items[0]
    storeShoppingState(
      payload.requestId,
      { [item.id]: 'inCart' },
      {},
      {},
      [item.id],
    )
    await renderRequest(encoded)
    await clickAndFlush(button('買い物を終了する'))
    act(() => {
      click(button('結果を共有'))
    })

    await clickAndFlush(button('買い物内容を見直す'))
    await openConsultation('notFound')
    await clickAndFlush(button('LINEですぐ相談'))
    expect(share).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain(
      '別の共有処理が進行中です。完了してからもう一度お試しください。',
    )

    await act(async () => {
      resolveResultShare()
      await Promise.resolve()
    })
    expect(container.textContent).not.toContain(
      'LINEを選択して結果を送信してください。',
    )
    await clickAndFlush(button('LINEですぐ相談'))

    expect(share).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain(
      'LINEを選択して送信してください。',
    )
  })

  it('ignores a pending result share after unmount without an update warning', async () => {
    const deferred = createDeferredNativeShare()
    const error = vi.spyOn(console, 'error')
    const { encoded, payload } = createRequest(
      [{}],
      'result-share-unmount',
    )
    const item = payload.items[0]
    storeShoppingState(
      payload.requestId,
      { [item.id]: 'inCart' },
      {},
      {},
      [item.id],
    )
    await renderRequest(encoded)
    await clickAndFlush(button('買い物を終了する'))
    act(() => {
      click(button('結果を共有'))
    })

    act(() => root.unmount())
    rootIsMounted = false
    await deferred.resolve()

    expect(container.textContent).toBe('')
    expect(error).not.toHaveBeenCalled()
  })

  it('shows a result-specific notice when sharing falls back to copy', async () => {
    const clipboard = vi.fn(async (_text: string) => undefined)
    setNavigatorShare(undefined)
    setClipboardWriter(clipboard)
    const { encoded, payload } = createRequest()
    const item = payload.items[0]
    storeShoppingState(
      payload.requestId,
      { [item.id]: 'inCart' },
      {},
      {},
      [item.id],
    )
    await renderRequest(encoded)
    await clickAndFlush(button('買い物を終了する'))
    await clickAndFlush(button('結果を共有'))

    expect(clipboard).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain(
      'OS共有を利用できなかったため、結果をコピーしました。',
    )
  })

  it.each([
    {
      outcome: 'cancelled',
      expectedKind: 'info',
      expectedMessage:
        '結果の共有をキャンセルしました。買い物結果はそのまま残っています。',
    },
    {
      outcome: 'failed',
      expectedKind: 'error',
      expectedMessage:
        '結果を共有またはコピーできませんでした。\n買い物結果はそのまま残っています。',
    },
  ] as const)(
    'shows a result-specific $outcome notice, prevents duplicate sharing, and allows retry',
    async ({ outcome, expectedKind, expectedMessage }) => {
      const share = vi
        .fn<(data: ShareData) => Promise<void>>()
        .mockImplementationOnce(async () => {
          if (outcome === 'cancelled') {
            throw new DOMException('cancelled', 'AbortError')
          }
          throw new Error('native share failed')
        })
        .mockResolvedValue(undefined)
      const clipboard = vi.fn(async () => {
        throw new Error('clipboard failed')
      })
      setNavigatorShare(share)
      setClipboardWriter(clipboard)
      const { encoded, payload } = createRequest()
      const item = payload.items[0]
      storeShoppingState(
        payload.requestId,
        { [item.id]: 'inCart' },
        {},
        {},
        [item.id],
      )
      await renderRequest(encoded)
      await clickAndFlush(button('買い物を終了する'))

      await act(async () => {
        const shareButton = button('結果を共有')
        click(shareButton)
        click(shareButton)
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(share).toHaveBeenCalledTimes(1)
      expect(container.querySelector(`.share-notice.${expectedKind}`)?.textContent)
        .toContain(expectedMessage)
      expect(container.textContent).not.toContain('相談内容')
      expect(container.textContent).toContain('おつかい完了')

      await clickAndFlush(button('結果を共有'))
      expect(share).toHaveBeenCalledTimes(2)
      expect(container.textContent).toContain(
        'LINEを選択して結果を送信してください。',
      )
    },
  )

  it('keeps an in-memory shopping change visible when persistence fails and warns the user', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { encoded, payload } = createRequest()
    const item = payload.items[0]
    await renderRequest(encoded)
    const originalSetItem = window.localStorage.setItem.bind(
      window.localStorage,
    )
    let shouldFail = true
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(
      (key: string, value: string) => {
        if (
          shouldFail &&
          key === `otsukai:checked:${payload.requestId}`
        ) {
          throw new DOMException('storage full', 'QuotaExceededError')
        }
        originalSetItem(key, value)
      },
    )

    await clickAndFlush(button('かごに入れる'))

    expect(container.textContent).toContain('かご済み')
    expect(container.textContent).toContain(
      '再読み込みすると変更が失われる可能性があります。',
    )
    expect(readCheckedState(payload.requestId)[item.id]).toBeUndefined()
    expect(warn).toHaveBeenCalled()

    shouldFail = false
    await clickAndFlush(button('未購入に戻す'))
    expect(container.textContent).not.toContain(
      '再読み込みすると変更が失われる可能性があります。',
    )
    expect(readCheckedState(payload.requestId)[item.id]).toBe('pending')
  })

  it('restores only successfully persisted shopping progress after remount', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { encoded, payload } = createRequest()
    await renderRequest(encoded)
    const originalSetItem = window.localStorage.setItem.bind(
      window.localStorage,
    )
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(
      (key: string, value: string) => {
        if (key === `otsukai:checked:${payload.requestId}`) {
          throw new DOMException('storage full', 'QuotaExceededError')
        }
        originalSetItem(key, value)
      },
    )

    await clickAndFlush(button('かごに入れる'))
    expect(container.textContent).toContain('かご済み')

    act(() => root.unmount())
    rootIsMounted = false
    root = createRoot(container)
    rootIsMounted = true
    await renderRequest(encoded)

    expect(button('かごに入れる').disabled).toBe(false)
    expect(container.textContent).not.toContain('キャベツをかご済みにしました')
    expect(warn).toHaveBeenCalled()
  })

  it('shows an external-browser link only when native sharing is unavailable', async () => {
    const { encoded } = createRequest()
    window.history.replaceState(
      {},
      '',
      `/?source=line&openExternalBrowser=0#/l/${encoded}`,
    )
    await act(async () => {
      root.render(
        <ShoppingListPage
          encodedPayload={encoded}
          payloadCodec="compact-path"
          onBackHome={() => undefined}
          onError={() => undefined}
        />,
      )
      await Promise.resolve()
    })

    const link = [...container.querySelectorAll<HTMLAnchorElement>('a')].find(
      (candidate) => candidate.textContent?.trim() === '外部ブラウザで開く',
    )
    expect(link).toBeDefined()
    const url = new URL(link?.href ?? '')
    expect(url.searchParams.getAll('openExternalBrowser')).toEqual(['1'])
    expect(url.hash).toBe(`#/l/${encoded}`)

    setNavigatorShare(vi.fn(async () => undefined))
    await remountRequest(encoded)
    expect(container.querySelector('.native-share-unavailable')).toBeNull()
  })
})
