// Normalize only the comparison: preserve the user's text, including IME input.
export function normalizeProductSearch(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('ja').replace(/\s+/gu, '')
}

export function matchesProductSearch(name: string, query: string): boolean {
  return normalizeProductSearch(name).includes(normalizeProductSearch(query))
}
