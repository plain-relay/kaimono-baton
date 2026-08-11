export const PRODUCT_PHOTO_TOKEN_PREFIX = 'p1_'
export const PRODUCT_PHOTO_TOKEN_BYTES = 24
export const PRODUCT_PHOTO_TOKEN_PATTERN = /^p1_[A-Za-z0-9_-]{32}$/

type RandomValuesProvider = {
  getRandomValues(bytes: Uint8Array): Uint8Array
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/gu, '')
}

export function createProductPhotoToken(
  cryptoImplementation: RandomValuesProvider = crypto,
): string {
  const bytes = new Uint8Array(PRODUCT_PHOTO_TOKEN_BYTES)
  cryptoImplementation.getRandomValues(bytes)
  return `${PRODUCT_PHOTO_TOKEN_PREFIX}${encodeBase64Url(bytes)}`
}

export function isProductPhotoToken(value: string): boolean {
  return PRODUCT_PHOTO_TOKEN_PATTERN.test(value)
}
