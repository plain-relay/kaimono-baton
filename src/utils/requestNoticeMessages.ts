import type { DraftLimitReason } from './requestBudget'
import type { NativeShareResult } from './shareText'

export type ShareMessageStatus = 'success' | 'error' | 'cancelled' | ''

export function getLimitMessage(reason?: DraftLimitReason): string {
  switch (reason) {
    case 'quantity-limit':
      return '数量は20個までです。'
    case 'item-condition-limit':
      return '条件は30文字までです。'
    case 'total-condition-limit':
      return '条件の合計が1,000文字に達しました。不要な条件を短くすると、別の商品に入力できます。'
    case 'custom-item-limit':
      return '自由追加商品は10件までです。'
    case 'custom-name-limit':
      return '自由追加の商品名は30文字までです。'
    case 'custom-unit-limit':
      return '自由追加商品の単位は10文字までです。'
    case 'title-limit':
      return '共有データを作成できませんでした。'
    case 'url-limit':
      return 'LINEで送れるデータ量の上限に達しました。条件や自由追加商品を短くしてください。'
    case 'no-items':
      return '共有する商品を選んでください。'
    default:
      return ''
  }
}

export function getShareResultMessage(result: NativeShareResult): {
  status: ShareMessageStatus
  message: string
} {
  switch (result) {
    case 'shared':
      return {
        status: 'success',
        message: '共有画面を開きました。LINEを選択して送信してください。',
      }
    case 'copied':
      return {
        status: 'success',
        message:
          '共有画面を開けなかったため、依頼文をコピーしました。LINEへ貼り付けて送ってください。',
      }
    case 'cancelled':
      return {
        status: 'cancelled',
        message: '共有をキャンセルしました。入力内容はそのまま残しています。',
      }
    case 'failed':
      return {
        status: 'error',
        message: '共有またはコピーができませんでした。もう一度お試しください。',
      }
  }
}
