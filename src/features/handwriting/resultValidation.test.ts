import { describe, expect, it } from 'vitest'
import { parseHandwritingImportResult } from './resultValidation'
import type { ImportProductCandidate } from './types'

const products: ImportProductCandidate[] = [
  { id: 'milk', name: '牛乳', aliases: [] },
  { id: 'soy-milk', name: '豆乳', aliases: [] },
  { id: 'tofu', name: '木綿豆腐', aliases: [] },
  { id: 'triple-tofu', name: '三連豆腐', aliases: [] },
]

function item(overrides: Record<string, unknown> = {}) {
  return {
    sourceText: '牛乳',
    status: 'matched',
    productId: 'milk',
    candidateProductIds: [],
    ...overrides,
  }
}

describe('parseHandwritingImportResult', () => {
  it('accepts matched, ambiguous, and unknown items', () => {
    const value = {
      version: 1,
      items: [
        item(),
        item({
          sourceText: 'とうふ',
          status: 'ambiguous',
          productId: null,
          candidateProductIds: ['tofu', 'triple-tofu'],
        }),
        item({
          sourceText: '電池',
          status: 'unknown',
          productId: null,
          candidateProductIds: [],
        }),
      ],
    }
    expect(parseHandwritingImportResult(value, products)).toEqual(value)
  })

  it('rejects an invented matched ID', () => {
    expect(
      parseHandwritingImportResult(
        { version: 1, items: [item({ productId: 'invented' })] },
        products,
      ),
    ).toBeUndefined()
  })

  it('rejects an out-of-list ambiguous ID', () => {
    expect(
      parseHandwritingImportResult(
        {
          version: 1,
          items: [
            item({
              status: 'ambiguous',
              productId: null,
              candidateProductIds: ['invented'],
            }),
          ],
        },
        products,
      ),
    ).toBeUndefined()
  })

  it('rejects inconsistent status and ID fields', () => {
    expect(
      parseHandwritingImportResult(
        {
          version: 1,
          items: [
            item({
              status: 'unknown',
              productId: 'milk',
            }),
          ],
        },
        products,
      ),
    ).toBeUndefined()
  })

  it('rejects more than three ambiguous candidates', () => {
    expect(
      parseHandwritingImportResult(
        {
          version: 1,
          items: [
            item({
              status: 'ambiguous',
              productId: null,
              candidateProductIds: [
                'milk',
                'soy-milk',
                'tofu',
                'triple-tofu',
              ],
            }),
          ],
        },
        products,
      ),
    ).toBeUndefined()
  })

  it('deduplicates a repeated source and matched product', () => {
    const result = parseHandwritingImportResult(
      {
        version: 1,
        items: [
          item(),
          item({ sourceText: ' 牛乳 ' }),
          item({ sourceText: 'ミルク' }),
        ],
      },
      products,
    )
    expect(result?.items).toHaveLength(1)
  })

  it('rejects extra properties and more than twenty items', () => {
    expect(
      parseHandwritingImportResult(
        { version: 1, items: [], extra: true },
        products,
      ),
    ).toBeUndefined()
    expect(
      parseHandwritingImportResult(
        { version: 1, items: Array.from({ length: 21 }, () => item()) },
        products,
      ),
    ).toBeUndefined()
  })

  it('rejects empty or overlong source text', () => {
    expect(
      parseHandwritingImportResult(
        { version: 1, items: [item({ sourceText: '   ' })] },
        products,
      ),
    ).toBeUndefined()
    expect(
      parseHandwritingImportResult(
        { version: 1, items: [item({ sourceText: 'あ'.repeat(31) })] },
        products,
      ),
    ).toBeUndefined()
  })
})
