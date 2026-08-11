import {
  SHARED_REQUEST_EDIT_SECRET_PREFIX,
  SHARED_REQUEST_TOKEN_PREFIX,
} from './sharedRequestConstants'

export type RandomValuesProvider = {
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

function createCapability(
  prefix: string,
  byteLength: number,
  cryptoImplementation: RandomValuesProvider,
): string {
  const bytes = new Uint8Array(byteLength)
  cryptoImplementation.getRandomValues(bytes)
  return `${prefix}${encodeBase64Url(bytes)}`
}

export function createSharedRequestToken(
  cryptoImplementation: RandomValuesProvider = crypto,
): string {
  return createCapability(
    SHARED_REQUEST_TOKEN_PREFIX,
    24,
    cryptoImplementation,
  )
}

export function createSharedRequestEditSecret(
  cryptoImplementation: RandomValuesProvider = crypto,
): string {
  return createCapability(
    SHARED_REQUEST_EDIT_SECRET_PREFIX,
    32,
    cryptoImplementation,
  )
}

export async function sha256Hex(
  value: string,
  digestImplementation: (
    data: ArrayBuffer,
  ) => Promise<ArrayBuffer> = (data) =>
    crypto.subtle.digest('SHA-256', data),
): Promise<string> {
  const encoded = new TextEncoder().encode(value)
  const digest = new Uint8Array(
    await digestImplementation(encoded.buffer as ArrayBuffer),
  )
  return [...digest]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
