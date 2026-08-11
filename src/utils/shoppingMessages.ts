import type {
  ItemIssue,
  ShoppingRequestItemPayload,
  UnavailableReason,
} from '../types/shopping'

const UNAVAILABLE_REASON_LABELS: Record<UnavailableReason, string> = {
  soldOut: '売り切れ',
  notFound: '商品が見つからない',
  conditionMismatch: '指定条件の商品がない',
  poorCondition: '商品の状態が悪い',
  other: 'その他',
}

export type ShoppingItemIssueEntry = {
  item: ShoppingRequestItemPayload
  issue?: ItemIssue
}

export function getUnavailableReasonLabel(reason: UnavailableReason): string {
  return UNAVAILABLE_REASON_LABELS[reason]
}

export function getItemIssueLabel(issue?: ItemIssue): string {
  return issue ? getUnavailableReasonLabel(issue.reason) : '理由未登録'
}

function getTrimmedCondition(item: ShoppingRequestItemPayload): string {
  return item.memo?.trim() ?? ''
}

function getTrimmedIssueNote(issue?: ItemIssue): string {
  return issue?.note?.trim() ?? ''
}

export function buildIndividualConsultationMessage(
  item: ShoppingRequestItemPayload,
  issue?: ItemIssue,
): string {
  const condition = getTrimmedCondition(item)
  const note = getTrimmedIssueNote(issue)
  const details = [
    `商品：${item.productNameSnapshot}`,
    `数量：${item.quantity}${item.unit}`,
    ...(condition ? [`条件：${condition}`] : []),
    `状況：${getItemIssueLabel(issue)}`,
    ...(note ? [`補足：${note}`] : []),
  ]

  return ['【おつかい相談】', '', ...details, '', '別の商品でよいですか？'].join('\n')
}

export function buildBulkConsultationMessage(entries: ShoppingItemIssueEntry[]): string {
  const itemBlocks = entries.map(({ item, issue }) => {
    const condition = getTrimmedCondition(item)
    const note = getTrimmedIssueNote(issue)

    return [
      `・${item.productNameSnapshot} ${item.quantity}${item.unit}`,
      `  状況：${getItemIssueLabel(issue)}`,
      ...(condition ? [`  条件：${condition}`] : []),
      ...(note ? [`  補足：${note}`] : []),
    ].join('\n')
  })

  return [
    '【おつかい相談】',
    '',
    '次の商品について確認をお願いします。',
    ...(itemBlocks.length ? ['', itemBlocks.join('\n\n')] : []),
  ].join('\n')
}

export function buildShoppingResultMessage(
  purchasedCount: number,
  notBuyingEntries: ShoppingItemIssueEntry[],
): string {
  const itemBlocks = notBuyingEntries.map(({ item, issue }) => {
    const note = getTrimmedIssueNote(issue)

    return [
      `・${item.productNameSnapshot}`,
      `  理由：${getItemIssueLabel(issue)}`,
      ...(note ? [`  補足：${note}`] : []),
    ].join('\n')
  })

  return [
    '【おつかい結果】',
    '',
    `購入：${purchasedCount}件`,
    `買えなかった商品：${notBuyingEntries.length}件`,
    ...(itemBlocks.length ? ['', itemBlocks.join('\n\n')] : []),
  ].join('\n')
}
