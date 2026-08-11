export type ImportProductCandidate = {
  id: string
  name: string
  aliases: string[]
}

export type HandwritingAnalyzedItem = {
  sourceText: string
  status: 'matched' | 'ambiguous' | 'unknown'
  productId: string | null
  candidateProductIds: string[]
}

export type HandwritingImportResult = {
  version: 1
  items: HandwritingAnalyzedItem[]
}
