import { describe, expect, it } from 'vitest'
import type { DraftLimitReason } from './requestBudget'
import type { NativeShareResult } from './shareText'
import {
  getLimitMessage,
  getShareResultMessage,
} from './requestNoticeMessages'

describe('request limit messages', () => {
  it.each<[DraftLimitReason | undefined, string]>([
    ['quantity-limit', '数量は20個までです。'],
    ['item-condition-limit', '条件は30文字までです。'],
    [
      'total-condition-limit',
      '条件の合計が1,000文字に達しました。不要な条件を短くすると、別の商品に入力できます。',
    ],
    ['custom-item-limit', '自由追加商品は10件までです。'],
    ['custom-name-limit', '自由追加の商品名は30文字までです。'],
    ['custom-unit-limit', '自由追加商品の単位は10文字までです。'],
    ['title-limit', '共有データを作成できませんでした。'],
    [
      'url-limit',
      'LINEで送れるデータ量の上限に達しました。条件や自由追加商品を短くしてください。',
    ],
    ['no-items', '共有する商品を選んでください。'],
    [undefined, ''],
  ])('maps %s without changing its message', (reason, message) => {
    expect(getLimitMessage(reason)).toBe(message)
  })
})

describe('request share result messages', () => {
  it.each<
    [NativeShareResult, ReturnType<typeof getShareResultMessage>]
  >([
    [
      'shared',
      {
        status: 'success',
        message: '共有画面を開きました。LINEを選択して送信してください。',
      },
    ],
    [
      'copied',
      {
        status: 'success',
        message:
          '共有画面を開けなかったため、依頼文をコピーしました。LINEへ貼り付けて送ってください。',
      },
    ],
    [
      'cancelled',
      {
        status: 'cancelled',
        message: '共有をキャンセルしました。入力内容はそのまま残しています。',
      },
    ],
    [
      'failed',
      {
        status: 'error',
        message: '共有またはコピーができませんでした。もう一度お試しください。',
      },
    ],
  ])('maps %s without changing its status or message', (result, notice) => {
    expect(getShareResultMessage(result)).toEqual(notice)
  })
})
