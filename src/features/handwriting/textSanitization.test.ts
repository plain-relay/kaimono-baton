import { describe, expect, it } from 'vitest'
import {
  isWithinHandwritingTextLimit,
  sanitizeHandwritingText,
  toHandwritingDedupeKey,
} from './textSanitization'

describe('handwriting text sanitization', () => {
  it('applies NFKC and collapses whitespace', () => {
    expect(sanitizeHandwritingText('  牛乳　２本  ')).toBe('牛乳 2本')
  })

  it('removes controls and bidirectional formatting characters', () => {
    expect(sanitizeHandwritingText('牛\u0000乳\u202e')).toBe('牛乳')
  })

  it('converts line breaks and tabs to one space', () => {
    expect(sanitizeHandwritingText('冷凍\n\tうどん')).toBe('冷凍 うどん')
  })

  it('truncates by user-perceived characters', () => {
    expect(sanitizeHandwritingText('あいうえお', 3)).toBe('あいう')
  })

  it('creates a case-insensitive duplicate key', () => {
    expect(toHandwritingDedupeKey(' Ｒ-１ ')).toBe('r-1')
  })

  it('checks the configured character limit', () => {
    expect(isWithinHandwritingTextLimit('あいう', 3)).toBe(true)
    expect(isWithinHandwritingTextLimit('あいうえ', 3)).toBe(false)
  })
})
