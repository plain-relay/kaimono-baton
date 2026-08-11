import { describe, expect, it } from 'vitest'
import type { SelectedRequestItem } from '../../utils/selectedRequestItems'
import { buildLiveRequestItems, buildLiveRequestUrls } from './createItems'

const selected: SelectedRequestItem[] = [
  {
    productId: 'milk',
    name: '牛乳',
    unit: '本',
    categoryId: 'drinks',
    sortOrder: 2,
    quantity: 2,
    memo: '低脂肪',
    icon: '🥛',
    hidden: false,
  },
]

describe('live request create conversion', () => {
  it('snapshots selected items and attaches an existing photo token', () => {
    expect(
      buildLiveRequestItems(
        selected,
        [{ itemKey: 'milk', token: `p1_${'P'.repeat(32)}` }],
        () => 'live-item-1',
      ),
    ).toEqual([
      {
        itemId: 'live-item-1',
        productId: 'milk',
        productNameSnapshot: '牛乳',
        categoryIdSnapshot: 'drinks',
        categoryNameSnapshot: '飲料',
        quantity: 2,
        unit: '本',
        memo: '低脂肪',
        iconSnapshot: '🥛',
        sortOrderSnapshot: 2,
        photoToken: `p1_${'P'.repeat(32)}`,
      },
    ])
  })

  it('rejects duplicate or unsafe generated item IDs', () => {
    expect(() =>
      buildLiveRequestItems([...selected, ...selected], [], () => 'same'),
    ).toThrow('Invalid live request item ID')
    expect(() =>
      buildLiveRequestItems(selected, [], () => 'unsafe item'),
    ).toThrow('Invalid live request item ID')
  })

  it('separates purchaser and management capability URLs', () => {
    const urls = buildLiveRequestUrls(
      'https://example.test/otsukai/',
      `r1_${'A'.repeat(32)}`,
      `e1_${'B'.repeat(43)}`,
    )
    expect(urls.purchaserUrl).toBe(
      `https://example.test/otsukai/#/r/r1_${'A'.repeat(32)}`,
    )
    expect(urls.purchaserUrl).not.toContain('e1_')
    expect(urls.managementUrl).toContain('/#/manage/r1_')
    expect(urls.managementUrl).toContain('/e1_')
  })

  it('preserves a validation query on both links without leaking edit secret to purchaser', () => {
    const validationToken = `mv1_${'V'.repeat(32)}`
    const urls = buildLiveRequestUrls(
      `https://example.test/otsukai/?manualValidationSessionId=${validationToken}`,
      `r1_${'A'.repeat(32)}`,
      `e1_${'B'.repeat(43)}`,
    )
    expect(urls.purchaserUrl).toContain(
      `manualValidationSessionId=${validationToken}#/r/`,
    )
    expect(urls.purchaserUrl).not.toContain('e1_')
    expect(urls.managementUrl).toContain(
      `manualValidationSessionId=${validationToken}#/manage/`,
    )
  })
})
