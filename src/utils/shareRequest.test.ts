import { describe, expect, it } from 'vitest'
import { buildRequestShareMessage, REQUEST_SHARE_TITLE } from './requestShareMessage'
import {
  createRequestShareLock,
  createRequestShareSnapshot,
  isRequestUrlWithinShareLimit,
} from './shareRequest'
import { shareText } from './shareText'

const requestUrl =
  'https://plain-relay.github.io/kaimono-baton/?openExternalBrowser=1#/l/raw+#?&日本語😀'

describe('request sharing snapshot', () => {
  it('keeps the photo-free snapshot unchanged', () => {
    expect(createRequestShareSnapshot('content\nunchanged', [])).toBe(
      'content\nunchanged',
    )
  })

  it('uses only sorted photo references without mutating the source', () => {
    const photos = [
      { itemKey: 'z-item', token: 'fixture-z', previewUrl: 'local-preview' },
      { itemKey: 'a-item', token: 'fixture-a', previewUrl: 'other-preview' },
    ]
    const snapshot = createRequestShareSnapshot('content', photos)
    expect(snapshot).toBe(
      'content\nphotos:[{"itemKey":"a-item","token":"fixture-a"},{"itemKey":"z-item","token":"fixture-z"}]',
    )
    expect(createRequestShareSnapshot('content', [...photos].reverse())).toBe(
      snapshot,
    )
    expect(photos.map((photo) => photo.itemKey)).toEqual(['z-item', 'a-item'])
    expect(snapshot).not.toContain('preview')
  })

  it('invalidates reuse when content, an item reference, or its photo changes', () => {
    const photos = [{ itemKey: 'item', token: 'fixture-photo' }]
    const snapshot = createRequestShareSnapshot('content', photos)
    expect(createRequestShareSnapshot('changed', photos)).not.toBe(snapshot)
    expect(
      createRequestShareSnapshot('content', [
        { itemKey: 'other-item', token: 'fixture-photo' },
      ]),
    ).not.toBe(snapshot)
    expect(
      createRequestShareSnapshot('content', [
        { itemKey: 'item', token: 'other-fixture-photo' },
      ]),
    ).not.toBe(snapshot)
    expect(createRequestShareSnapshot('content', [])).not.toBe(snapshot)
  })
})

describe('request share message', () => {
  it('places one unchanged URL after a blank line as the independent final line', () => {
    const message = buildRequestShareMessage(requestUrl)
    expect(message).toBe(`今日のおつかいをお願いします。\n\n${requestUrl}`)
    expect(message.split(requestUrl)).toHaveLength(2)
    expect(message.split('\n').at(-1)).toBe(requestUrl)
    expect(message).not.toContain(encodeURIComponent(requestUrl))
  })
})

describe('request sharing', () => {
  it('blocks a URL over 2,200 characters before a share call can start', () => {
    expect(isRequestUrlWithinShareLimit('x'.repeat(2200))).toBe(true)
    expect(isRequestUrlWithinShareLimit('x'.repeat(2201))).toBe(false)
  })

  it('provides a single-flight lock for repeated button presses', () => {
    const lock = createRequestShareLock()
    expect(lock.tryAcquire()).toBe(true)
    expect(lock.isActive()).toBe(true)
    expect(lock.tryAcquire()).toBe(false)
    lock.release()
    expect(lock.isActive()).toBe(false)
    expect(lock.tryAcquire()).toBe(true)
  })

  it('uses Web Share with title and text only and never passes a url property', async () => {
    const shared: ShareData[] = []
    const message = buildRequestShareMessage(requestUrl)
    const result = await shareText(
      { title: REQUEST_SHARE_TITLE, text: message },
      {
        share: async (data) => {
          shared.push(data)
        },
        writeClipboardText: async () => {
          throw new Error('clipboard must not be used')
        },
      },
    )

    expect(result).toBe('shared')
    expect(shared).toEqual([{ title: 'おつかい依頼', text: message }])
    expect(Object.keys(shared[0]).sort()).toEqual(['text', 'title'])
    expect('url' in shared[0]).toBe(false)
  })
})
