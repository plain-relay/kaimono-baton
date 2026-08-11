import { describe, expect, it } from 'vitest'
import { countUserCharacters, truncateUserCharacters } from './textLength'

describe('user-visible text length', () => {
  it('counts Japanese, surrogate pairs, and emoji as user-visible characters', () => {
    expect(countUserCharacters('日本語')).toBe(3)
    expect(countUserCharacters('😀🛍️')).toBe(2)
  })

  it('keeps combining sequences and emoji clusters intact when truncating', () => {
    const text = `e\u0301👨‍👩‍👧‍👦か`
    expect(countUserCharacters(text)).toBe(3)
    expect(truncateUserCharacters(text, 1)).toBe('e\u0301')
    expect(truncateUserCharacters(text, 2)).toBe('e\u0301👨‍👩‍👧‍👦')
  })

  it('returns the original string inside the limit and handles a zero limit', () => {
    expect(truncateUserCharacters('そのまま', 10)).toBe('そのまま')
    expect(truncateUserCharacters('切る', 0)).toBe('')
  })
})
