import { MAX_CUSTOM_ITEM_NAME_CHARS } from '../../constants/requestLimits'
import {
  splitUserCharacters,
  truncateUserCharacters,
} from '../../utils/textLength'

const CONTROL_CHARACTERS =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu

export function sanitizeHandwritingText(
  value: string,
  maxCharacters = MAX_CUSTOM_ITEM_NAME_CHARS,
): string {
  const normalized = value
    .normalize('NFKC')
    .replace(CONTROL_CHARACTERS, '')
    .replace(/[\r\n\t]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ')

  return truncateUserCharacters(normalized, maxCharacters)
}

export function isWithinHandwritingTextLimit(
  value: string,
  maxCharacters = MAX_CUSTOM_ITEM_NAME_CHARS,
): boolean {
  return splitUserCharacters(value).length <= maxCharacters
}

export function toHandwritingDedupeKey(value: string): string {
  return sanitizeHandwritingText(value).toLocaleLowerCase('ja-JP')
}
