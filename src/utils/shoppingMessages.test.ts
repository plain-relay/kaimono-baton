import { describe, expect, it } from 'vitest'
import type { ShoppingRequestItemPayload, UnavailableReason } from '../types/shopping'
import {
  buildBulkConsultationMessage,
  buildIndividualConsultationMessage,
  buildShoppingResultMessage,
  getUnavailableReasonLabel,
  isFreeQuestion,
} from './shoppingMessages'

const createItem = (
  id: string,
  name: string,
  quantity: number,
  unit: string,
  memo?: string,
): ShoppingRequestItemPayload => ({
  id,
  productId: id,
  productNameSnapshot: name,
  categoryIdSnapshot: 'category',
  categoryNameSnapshot: 'Category',
  quantity,
  unit,
  memo,
  iconSnapshot: '🛒',
  sortOrderSnapshot: 1,
})

describe('unavailable reason labels', () => {
  it.each<[UnavailableReason, string]>([
    ['soldOut', '売り切れ'],
    ['notFound', '商品が見つからない'],
    ['conditionMismatch', '指定条件の商品がない'],
    ['poorCondition', '商品の状態が悪い'],
    ['other', 'その他'],
  ])('translates %s to Japanese', (reason, label) => {
    expect(getUnavailableReasonLabel(reason)).toBe(label)
  })
})

describe('consultation messages', () => {
  it('builds an individual message with a condition', () => {
    const item = createItem('apple', 'りんご', 2, '玉', '王林かフジ')
    expect(
      buildIndividualConsultationMessage(item, { reason: 'conditionMismatch' }),
    ).toBe(`【おつかい相談】

商品：りんご
数量：2玉
条件：王林かフジ
状況：指定条件の商品がない

別の商品でよいですか？`)
  })

  it('omits the condition line when the item has no condition', () => {
    const item = createItem('milk', '牛乳', 1, '本')
    const message = buildIndividualConsultationMessage(item, { reason: 'soldOut' })

    expect(message).toBe(`【おつかい相談】

商品：牛乳
数量：1本
状況：売り切れ

別の商品でよいですか？`)
    expect(message).not.toContain('条件：')
  })

  it('shares a note-only question without an invented situation or request', () => {
    const item = createItem('fish', '魚', 1, 'パック')
    const message = buildIndividualConsultationMessage(item, {
        reason: 'other',
        note: '  これでいい？  ',
      })
    expect(message).toBe('【おつかい相談】\n\n商品：魚\n数量：1パック\n\nこれでいい？')
    expect(message).not.toMatch(/状況：|補足：|別の商品でよいですか/)
  })

  it('keeps structured and free questions distinct in a mixed bulk share', () => {
    const message = buildBulkConsultationMessage([
      { item: createItem('apple', 'りんご', 1, '玉', '国産'), issue: { reason: 'other', note: 'これでいい？' } },
      { item: createItem('milk', '牛乳', 1, '本'), issue: { reason: 'soldOut', note: '小さいサイズはあり' } },
    ])
    expect(message).toContain('・りんご 1玉\n  条件：国産\n  これでいい？')
    expect(message).toContain('・牛乳 1本\n  状況：売り切れ\n  補足：小さいサイズはあり')
    expect(message).not.toContain('状況：その他')
    expect(isFreeQuestion({ reason: 'other', note: '  ' })).toBe(false)
    expect(isFreeQuestion()).toBe(false)
  })

  it('builds a bulk message for multiple consulting items', () => {
    const apple = createItem('apple', 'りんご', 2, '玉', '王林かフジ')
    const milk = createItem('milk', '牛乳', 1, '本')

    expect(
      buildBulkConsultationMessage([
        { item: apple, issue: { reason: 'conditionMismatch' } },
        { item: milk, issue: { reason: 'soldOut' } },
      ]),
    ).toBe(`【おつかい相談】

次の商品について確認をお願いします。

・りんご 2玉
  状況：指定条件の商品がない
  条件：王林かフジ

・牛乳 1本
  状況：売り切れ`)
  })
})

describe('shopping result messages', () => {
  it('retains the explicit notBuying reason even when other has a note', () => {
    expect(buildShoppingResultMessage(0, [{ item: createItem('apple', 'りんご', 1, '玉'), issue: { reason: 'other', note: '高すぎる' } }])).toContain('理由：その他\n  補足：高すぎる')
  })
  it('omits an unavailable item list when every item was purchased', () => {
    expect(buildShoppingResultMessage(24, [])).toBe(`【おつかい結果】

購入：24件
買えなかった商品：0件`)
  })

  it('lists notBuying items and their reasons', () => {
    const milk = createItem('milk', '牛乳', 1, '本')
    const apple = createItem('apple', 'りんご', 2, '玉')

    expect(
      buildShoppingResultMessage(22, [
        { item: milk, issue: { reason: 'soldOut' } },
        {
          item: apple,
          issue: { reason: 'conditionMismatch', note: '王林もフジもなし' },
        },
      ]),
    ).toBe(`【おつかい結果】

購入：22件
買えなかった商品：2件

・牛乳
  理由：売り切れ

・りんご
  理由：指定条件の商品がない
  補足：王林もフジもなし`)
  })
})
