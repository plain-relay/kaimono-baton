import { describe, expect, it, vi } from 'vitest'

vi.mock('./runtime', () => ({ isNativeApp: () => true }))
vi.mock('./nativeShare', () => { throw new Error('native chunk unavailable') })
import { shareText } from '../utils/shareText'

describe('native plugin loading failure', () => {
  it('returns the existing failure result without rejecting or falling back to the clipboard', async () => {
    await expect(shareText({ title: 'test', text: 'test' })).resolves.toBe('failed')
  })
})
