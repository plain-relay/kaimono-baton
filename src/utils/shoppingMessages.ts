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

// Templates use the existing other + note question representation; no stored enum.
export const CONSULTATION_TEMPLATES = [
  { label: '売り切れ', note: '指定の商品が売り切れです。代わりの商品を買ってもいいですか？' },
  { label: '別メーカーの商品ならある', note: '指定の商品がありません。別メーカーの同等品ならあります。代わりに買ってもいいですか？' },
  { label: 'サイズ違いならある', note: '指定のサイズがありません。サイズ違いの商品ならあります。代わりに買ってもいいですか？' },
  { label: '商品が見つからない', note: '指定の商品が見つかりません。売り場や商品の特徴を教えてもらえますか？' },
] as const

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

// Note-only questions use the existing other + note persisted representation.
export function isFreeQuestion(issue?: ItemIssue): boolean {
  return issue?.reason === 'other' && Boolean(getTrimmedIssueNote(issue))
}

export function buildIndividualConsultationMessage(
  item: ShoppingRequestItemPayload,
  issue?: ItemIssue,
): string {
  const condition = getTrimmedCondition(item)
  const note = getTrimmedIssueNote(issue)
  if (isFreeQuestion(issue)) {
    return [
      '【おつかい相談】',
      '',
      `商品：${item.productNameSnapshot}`,
      `数量：${item.quantity}${item.unit}`,
      ...(condition ? [`条件：${condition}`] : []),
      '',
      note,
    ].join('\n')
  }
  const details = [
    `商品：${item.productNameSnapshot}`,
    `数量：${item.quantity}${item.unit}`,
    ...(condition ? [`条件：${condition}`] : []),
    `状況：${getItemIssueLabel(issue)}`,
    ...(note ? [`補足：${note}`] : []),
  ]

  return ['【おつかい相談】', '', ...details,
    ...(/[?？]/u.test(note) ? [] : ['', '別の商品でよいですか？']),
  ].join('\n')
}

export function buildBulkConsultationMessage(entries: ShoppingItemIssueEntry[]): string {
  const itemBlocks = entries.map(({ item, issue }) => {
    const condition = getTrimmedCondition(item)
    const note = getTrimmedIssueNote(issue)

    return [
      `・${item.productNameSnapshot} ${item.quantity}${item.unit}`,
      ...(!isFreeQuestion(issue) ? [`  状況：${getItemIssueLabel(issue)}`] : []),
      ...(condition ? [`  条件：${condition}`] : []),
      ...(note ? [isFreeQuestion(issue) ? `  ${note}` : `  補足：${note}`] : []),
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
