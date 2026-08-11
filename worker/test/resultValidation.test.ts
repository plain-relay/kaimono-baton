import { describe, expect, it } from 'vitest'
import { parseGeminiHandwritingResult } from '../src/resultValidation'
import type { ImportProductCandidate } from '../src/types'

const products: ImportProductCandidate[] = [
  { id: 'milk', name: '牛乳', aliases: [] },
  { id: 'soy-milk', name: '豆乳', aliases: [] },
  { id: 'tofu', name: '豆腐', aliases: [] },
  { id: 'three-pack-tofu', name: '三連豆腐', aliases: [] },
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

function parse(items: unknown[]) {
  return parseGeminiHandwritingResult(
    JSON.stringify({ version: 1, items }),
    products,
  )
}

describe('Gemini result validation', () => {
  it('accepts valid matched, ambiguous, and unknown items', () => {
    expect(
      parse([
        item(),
        item({
          sourceText: 'とうふ',
          status: 'ambiguous',
          productId: null,
          candidateProductIds: ['tofu', 'three-pack-tofu'],
        }),
        item({
          sourceText: '電池',
          status: 'unknown',
          productId: null,
          candidateProductIds: [],
        }),
      ]),
    ).toEqual({
      version: 1,
      items: [
        item(),
        item({
          sourceText: 'とうふ',
          status: 'ambiguous',
          productId: null,
          candidateProductIds: ['tofu', 'three-pack-tofu'],
        }),
        item({
          sourceText: '電池',
          status: 'unknown',
          productId: null,
          candidateProductIds: [],
        }),
      ],
    })
  })

  it('downgrades an invented matched ID to unknown', () => {
    expect(parse([item({ productId: 'invented' })]).items[0]).toEqual(
      item({
        status: 'unknown',
        productId: null,
        candidateProductIds: [],
      }),
    )
  })

  it('filters unknown and duplicate ambiguous IDs and caps them at three', () => {
    expect(
      parse([
        item({
          status: 'ambiguous',
          productId: null,
          candidateProductIds: [
            'tofu',
            'invented',
            'tofu',
            'three-pack-tofu',
            'milk',
            'soy-milk',
          ],
        }),
      ]).items[0],
    ).toMatchObject({
      status: 'ambiguous',
      productId: null,
      candidateProductIds: ['tofu', 'three-pack-tofu', 'milk'],
    })
  })

  it('downgrades ambiguous with no valid candidate to unknown', () => {
    expect(
      parse([
        item({
          status: 'ambiguous',
          productId: null,
          candidateProductIds: ['invented'],
        }),
      ]).items[0],
    ).toMatchObject({
      status: 'unknown',
      productId: null,
      candidateProductIds: [],
    })
  })

  it('clears IDs from unknown and inconsistent items', () => {
    expect(
      parse([
        item({
          status: 'unknown',
          productId: 'milk',
          candidateProductIds: ['tofu'],
        }),
      ]).items[0],
    ).toMatchObject({
      status: 'unknown',
      productId: null,
      candidateProductIds: [],
    })
  })

  it('removes controls and normalizes source text', () => {
    expect(
      parse([item({ sourceText: '  牛\u0000乳\n ' })]).items[0].sourceText,
    ).toBe('牛乳')
  })

  it('deduplicates repeated source text', () => {
    expect(
      parse([
        item({ status: 'unknown', productId: null }),
        item({
          sourceText: ' 牛乳 ',
          status: 'unknown',
          productId: null,
        }),
      ]).items,
    ).toHaveLength(1)
  })

  it('deduplicates the same matched product from different source text', () => {
    expect(
      parse([
        item(),
        item({ sourceText: 'ミルク' }),
      ]).items,
    ).toHaveLength(1)
  })

  it.each([
    ['not-json'],
    [JSON.stringify({ version: 2, items: [] })],
    [JSON.stringify({ version: 1, items: [], extra: true })],
    [JSON.stringify({ version: 1, items: [item({ sourceText: '' })] })],
    [JSON.stringify({ version: 1, items: [item({ status: 'other' })] })],
    [
      JSON.stringify({
        version: 1,
        items: [item({ unexpected: true })],
      }),
    ],
    [
      JSON.stringify({
        version: 1,
        items: Array.from({ length: 21 }, () => item()),
      }),
    ],
  ])('rejects malformed structured output', (value) => {
    expect(() =>
      parseGeminiHandwritingResult(value, products),
    ).toThrowError(expect.objectContaining({ kind: 'invalid-response' }))
  })
})
