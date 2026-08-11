import { describe, expect, it } from 'vitest'
import {
  isNativeShareAvailable,
  isShareCancellation,
  shareText,
} from './shareText'

const input = {
  title: 'おつかい相談',
  text: '相談内容',
}

describe('shareText', () => {
  it('uses Web Share before the clipboard', async () => {
    const sharedData: ShareData[] = []
    const result = await shareText(input, {
      share: async (data) => {
        sharedData.push(data)
      },
      writeClipboardText: async () => {
        throw new Error('clipboard should not be used')
      },
    })

    expect(result).toBe('shared')
    expect(sharedData).toEqual([
      {
        title: 'おつかい相談',
        text: '相談内容',
      },
    ])
    expect(Object.keys(sharedData[0]).sort()).toEqual(['text', 'title'])
    expect('url' in sharedData[0]).toBe(false)
  })

  it('copies when Web Share is unavailable', async () => {
    const copied: string[] = []
    const result = await shareText(input, {
      writeClipboardText: async (text) => {
        copied.push(text)
      },
    })

    expect(result).toBe('copied')
    expect(copied).toEqual(['相談内容'])
  })

  it('falls back to copying when Web Share fails for a reason other than cancellation', async () => {
    const copied: string[] = []
    const result = await shareText(input, {
      share: async () => {
        throw new Error('share unavailable')
      },
      writeClipboardText: async (text) => {
        copied.push(text)
      },
    })

    expect(result).toBe('copied')
    expect(copied).toEqual(['相談内容'])
  })

  it('does not report success or copy when the user cancels Web Share', async () => {
    let copied = false
    const result = await shareText(input, {
      share: async () => {
        throw { name: 'AbortError' }
      },
      writeClipboardText: async () => {
        copied = true
      },
    })

    expect(result).toBe('cancelled')
    expect(copied).toBe(false)
  })

  it('reports failure when neither sharing nor copying succeeds', async () => {
    expect(await shareText(input, {})).toBe('failed')
    expect(
      await shareText(input, {
        writeClipboardText: async () => {
          throw new Error('clipboard denied')
        },
      }),
    ).toBe('failed')
  })

  it('reports failure when Web Share and the clipboard both fail', async () => {
    const result = await shareText(input, {
      share: async () => {
        throw new Error('share unavailable')
      },
      writeClipboardText: async () => {
        throw new Error('clipboard denied')
      },
    })

    expect(result).toBe('failed')
  })

  it('recognizes only AbortError as a share cancellation', () => {
    expect(isShareCancellation({ name: 'AbortError' })).toBe(true)
    expect(isShareCancellation({ name: 'NotAllowedError' })).toBe(false)
    expect(isShareCancellation(new Error('cancelled'))).toBe(false)
  })

  it('detects native sharing by capability instead of OS or user agent', () => {
    expect(isNativeShareAvailable(async () => undefined)).toBe(true)
    expect(isNativeShareAvailable(undefined)).toBe(false)
  })
})
