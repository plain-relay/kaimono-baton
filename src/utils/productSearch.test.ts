import { describe, expect, it } from 'vitest'
import { matchesProductSearch, normalizeProductSearch } from './productSearch'

describe('local product search', () => {
  it.each([
    ['牛乳', '牛', true], ['低脂肪牛乳', ' 牛 乳　', true],
    ['ＡＢＣ milk', 'abc MILK', true], ['無糖ヨーグルト', '牛乳', false],
    ['牛乳', '　 ', true], ['かぼちゃ', 'ｶﾎﾞﾁｬ', false],
  ])('matches %s / %s = %s', (name, query, expected) => {
    expect(matchesProductSearch(name, query)).toBe(expected)
  })
  it('does not mutate the raw query or use a regular expression from it', () => {
    const query = ' [Ａ] '
    expect(normalizeProductSearch(query)).toBe('[a]')
    expect(matchesProductSearch('A', query)).toBe(false)
    expect(query).toBe(' [Ａ] ')
  })
})
