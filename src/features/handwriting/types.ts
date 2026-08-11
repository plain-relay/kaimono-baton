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

export interface HandwritingImportProvider {
  analyze(
    image: Blob,
    products: readonly ImportProductCandidate[],
    options?: {
      signal?: AbortSignal
      requestId?: string
    },
  ): Promise<HandwritingImportResult>
}

export type HandwritingImportSelection =
  | {
      itemId: string
      kind: 'product'
      productId: string
    }
  | {
      itemId: string
      kind: 'custom'
      name: string
      customItemId: string
    }
