export const MAX_PRODUCT_NAME_CHARACTERS = 30
export const MAX_SOURCE_TEXT_CHARACTERS = 30

type Segment = { segment: string }
type Segmenter = {
  segment: (text: string) => Iterable<Segment>
}
type SegmenterConstructor = new (
  locales?: string | string[],
  options?: { granularity: 'grapheme' },
) => Segmenter

const CONTROL_CHARACTERS =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu

function splitCharacters(value: string): string[] {
  const SegmenterClass = (
    Intl as unknown as { Segmenter?: SegmenterConstructor }
  ).Segmenter
  return SegmenterClass
    ? Array.from(
        new SegmenterClass('ja', { granularity: 'grapheme' }).segment(
          value,
        ),
        ({ segment }) => segment,
      )
    : Array.from(value)
}

export function countTextCharacters(value: string): number {
  return splitCharacters(value).length
}

export function sanitizeText(value: string, limit: number): string {
  const normalized = value
    .normalize('NFKC')
    .replace(CONTROL_CHARACTERS, '')
    .replace(/[\r\n\t]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ')
  const characters = splitCharacters(normalized)
  return characters.length <= limit
    ? normalized
    : characters.slice(0, limit).join('')
}

export function toTextDedupeKey(value: string): string {
  return sanitizeText(
    value,
    MAX_SOURCE_TEXT_CHARACTERS,
  ).toLocaleLowerCase('ja-JP')
}
