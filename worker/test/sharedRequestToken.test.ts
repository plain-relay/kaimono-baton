import { describe, expect, it } from 'vitest'
import {
  SHARED_REQUEST_EDIT_SECRET_PATTERN,
  SHARED_REQUEST_TOKEN_PATTERN,
} from '../src/sharedRequestConstants'
import {
  createSharedRequestEditSecret,
  createSharedRequestToken,
  sha256Hex,
} from '../src/sharedRequestToken'

describe('shared request capabilities', () => {
  it('creates a 192-bit request token and a 256-bit edit secret', () => {
    const lengths: number[] = []
    const randomValues = {
      getRandomValues(bytes: Uint8Array) {
        lengths.push(bytes.length)
        bytes.forEach((_value, index) => {
          bytes[index] = index
        })
        return bytes
      },
    }

    expect(createSharedRequestToken(randomValues)).toMatch(
      SHARED_REQUEST_TOKEN_PATTERN,
    )
    expect(createSharedRequestEditSecret(randomValues)).toMatch(
      SHARED_REQUEST_EDIT_SECRET_PATTERN,
    )
    expect(lengths).toEqual([24, 32])
  })

  it('hashes the edit secret without retaining its plaintext', async () => {
    const secret = `e1_${'A'.repeat(43)}`
    const hash = await sha256Hex(secret)

    expect(hash).toMatch(/^[a-f0-9]{64}$/u)
    expect(hash).not.toContain(secret)
  })
})
