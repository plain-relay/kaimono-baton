export const REQUEST_SHARE_TITLE = 'おつかい依頼'

export function buildRequestShareMessage(requestUrl: string): string {
  return ['今日のおつかいをお願いします。', '', requestUrl].join('\n')
}
