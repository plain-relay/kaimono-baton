type Segment = { segment: string }

type Segmenter = {
  segment: (text: string) => Iterable<Segment>
}
type SegmenterConstructor = new (
  locales?: string | string[],
  options?: { granularity: 'grapheme' },
) => Segmenter

let cachedSegmenter: Segmenter | null | undefined

function getSegmenter(): Segmenter | null {
  if (cachedSegmenter !== undefined) {
    return cachedSegmenter
  }

  const SegmenterClass = (Intl as unknown as { Segmenter?: SegmenterConstructor }).Segmenter
  cachedSegmenter = SegmenterClass
    ? new SegmenterClass('ja', { granularity: 'grapheme' })
    : null
  return cachedSegmenter
}

export function splitUserCharacters(text: string): string[] {
  const segmenter = getSegmenter()
  return segmenter
    ? Array.from(segmenter.segment(text), ({ segment }) => segment)
    : Array.from(text)
}

export function countUserCharacters(text: string): number {
  return splitUserCharacters(text).length
}

export function truncateUserCharacters(text: string, limit: number): string {
  if (!Number.isFinite(limit) || limit <= 0) {
    return ''
  }

  const characters = splitUserCharacters(text)
  return characters.length <= limit ? text : characters.slice(0, Math.floor(limit)).join('')
}
