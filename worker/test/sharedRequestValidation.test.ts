import { describe, expect, it } from 'vitest'
import {
  MAX_CUSTOM_ITEMS,
  MAX_HOUSEHOLD_PRODUCTS,
} from '../../src/constants/requestLimits'
import { SHARE_PRODUCT_IDS_V2 } from '../../src/data/shareProductIdsV2'
import {
  MAX_SHARED_REQUEST_BODY_BYTES,
  MAX_SHARED_REQUEST_CUSTOM_ITEMS,
  MAX_SHARED_REQUEST_ITEMS,
} from '../src/sharedRequestConstants'
import type { SharedRequestNewItem } from '../src/sharedRequestTypes'
import {
  SharedRequestValidationError,
  validateSharedRequestCreateRequest,
  validateSharedRequestPatchRequest,
} from '../src/sharedRequestValidation'

function item(
  index = 0,
  overrides: Partial<SharedRequestNewItem> = {},
): SharedRequestNewItem {
  return {
    itemId: `item-${index}`,
    productId: `product-${index}`,
    productNameSnapshot: `商品${index}`,
    categoryIdSnapshot: 'other',
    categoryNameSnapshot: 'その他',
    quantity: 1,
    unit: '個',
    memo: '国産',
    iconSnapshot: '🛒',
    sortOrderSnapshot: index,
    ...overrides,
  }
}

function jsonRequest(body: unknown): Request {
  return new Request('https://worker.example/v1/requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  })
}

async function expectInvalid(promise: Promise<unknown>) {
  await expect(promise).rejects.toMatchObject({
    status: 400,
    code: 'REQUEST_INVALID',
  } satisfies Partial<SharedRequestValidationError>)
}

describe('shared request validation', () => {
  it('matches the complete existing v3 draft ceiling', async () => {
    expect(MAX_SHARED_REQUEST_ITEMS).toBe(
      SHARE_PRODUCT_IDS_V2.length +
        MAX_HOUSEHOLD_PRODUCTS +
        MAX_CUSTOM_ITEMS,
    )

    const items = Array.from(
      { length: MAX_SHARED_REQUEST_ITEMS },
      (_, index) =>
        item(index, {
          itemId: `item-${index}-${'i'.repeat(118 - String(index).length)}`,
          productId: `product-${index}-${'p'.repeat(115 - String(index).length)}`,
          productNameSnapshot: '商'.repeat(30),
          categoryIdSnapshot: `category-${index}-${'c'.repeat(114 - String(index).length)}`,
          categoryNameSnapshot: '類'.repeat(30),
          unit: '個'.repeat(10),
          memo:
            index < 33
              ? '条'.repeat(30)
              : index === 33
                ? '条'.repeat(10)
                : undefined,
          iconSnapshot: '🛒'.repeat(16),
        }),
    )
    const requestBody = JSON.stringify({
      turnstileToken: 'single-use-token',
      items,
    })

    const requestBodyBytes = new TextEncoder().encode(requestBody).byteLength
    expect(requestBodyBytes).toBeGreaterThan(100 * 1024)
    expect(requestBodyBytes).toBeLessThanOrEqual(
      MAX_SHARED_REQUEST_BODY_BYTES,
    )
    await expect(
      validateSharedRequestCreateRequest(jsonRequest(JSON.parse(requestBody))),
    ).resolves.toMatchObject({ items: { length: MAX_SHARED_REQUEST_ITEMS } })

    await expectInvalid(
      validateSharedRequestCreateRequest(
        jsonRequest({
          turnstileToken: 'single-use-token',
          items: [...items, item(MAX_SHARED_REQUEST_ITEMS)],
        }),
      ),
    )
  })

  it('enforces the existing ten one-time custom item ceiling', async () => {
    expect(MAX_SHARED_REQUEST_CUSTOM_ITEMS).toBe(MAX_CUSTOM_ITEMS)
    const customItems = Array.from(
      { length: MAX_SHARED_REQUEST_CUSTOM_ITEMS },
      (_, index) =>
        item(index, { productId: `custom:one-time-${index}` }),
    )

    await expect(
      validateSharedRequestCreateRequest(
        jsonRequest({
          turnstileToken: 'single-use-token',
          items: customItems,
        }),
      ),
    ).resolves.toMatchObject({ items: { length: MAX_CUSTOM_ITEMS } })
    await expectInvalid(
      validateSharedRequestCreateRequest(
        jsonRequest({
          turnstileToken: 'single-use-token',
          items: [
            ...customItems,
            item(MAX_CUSTOM_ITEMS, {
              productId: `custom:one-time-${MAX_CUSTOM_ITEMS}`,
            }),
          ],
        }),
      ),
    )
  })

  it('normalizes a valid create request with up to three photo refs', async () => {
    const photoTokens = [0, 1, 2].map(
      (index) => `p1_${String(index).repeat(32)}`,
    )
    const result = await validateSharedRequestCreateRequest(
      jsonRequest({
        turnstileToken: 'single-use-token',
        items: photoTokens.map((photoToken, index) =>
          item(index, { photoToken }),
        ),
      }),
    )

    expect(result.items).toHaveLength(3)
    expect(result.items.map((entry) => entry.photoToken)).toEqual(
      photoTokens,
    )
    expect(result.items[0].memo).toBe('国産')
  })

  it.each([
    {
      name: 'an extra top-level key',
      body: {
        turnstileToken: 'single-use-token',
        items: [item()],
        secret: 'not-allowed',
      },
    },
    {
      name: 'a duplicate item ID',
      body: {
        turnstileToken: 'single-use-token',
        items: [item(), item()],
      },
    },
    {
      name: 'a duplicate photo token',
      body: {
        turnstileToken: 'single-use-token',
        items: [
          item(0, { photoToken: `p1_${'A'.repeat(32)}` }),
          item(1, { photoToken: `p1_${'A'.repeat(32)}` }),
        ],
      },
    },
    {
      name: 'more than three photos',
      body: {
        turnstileToken: 'single-use-token',
        items: Array.from({ length: 4 }, (_, index) =>
          item(index, {
            photoToken: `p1_${String(index).repeat(32)}`,
          }),
        ),
      },
    },
    {
      name: 'an out-of-range quantity',
      body: {
        turnstileToken: 'single-use-token',
        items: [item(0, { quantity: 21 })],
      },
    },
    {
      name: 'an unexpected item property',
      body: {
        turnstileToken: 'single-use-token',
        items: [{ ...item(), productPrice: 100 }],
      },
    },
  ])('rejects $name', async ({ body }) => {
    await expectInvalid(validateSharedRequestCreateRequest(jsonRequest(body)))
  })

  it('accepts explicit add, quantity, memo, and cancel operations', async () => {
    const result = await validateSharedRequestPatchRequest(
      jsonRequest({
        turnstileToken: 'single-use-token',
        editSecret: `e1_${'A'.repeat(43)}`,
        operations: [
          { type: 'add', item: item(2) },
          { type: 'set-quantity', itemId: 'item-0', quantity: 2 },
          { type: 'set-memo', itemId: 'item-0', memo: '' },
          { type: 'cancel', itemId: 'item-1' },
        ],
      }),
    )

    expect(result.operations.map((operation) => operation.type)).toEqual([
      'add',
      'set-quantity',
      'set-memo',
      'cancel',
    ])
  })

  it('rejects a new photo attachment in PATCH scope', async () => {
    await expectInvalid(
      validateSharedRequestPatchRequest(
        jsonRequest({
          turnstileToken: 'single-use-token',
          editSecret: `e1_${'A'.repeat(43)}`,
          operations: [
            {
              type: 'add',
              item: item(2, { photoToken: `p1_${'A'.repeat(32)}` }),
            },
          ],
        }),
      ),
    )
  })

  it('rejects non-JSON and oversized request bodies', async () => {
    await expect(
      validateSharedRequestCreateRequest(
        new Request('https://worker.example/v1/requests', {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: 'not-json',
        }),
      ),
    ).rejects.toMatchObject({ status: 415 })

    await expectInvalid(
      validateSharedRequestCreateRequest(
        new Request('https://worker.example/v1/requests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            turnstileToken: 'single-use-token',
            items: [
              item(0, {
                productNameSnapshot: 'x'.repeat(
                  MAX_SHARED_REQUEST_BODY_BYTES + 1,
                ),
              }),
            ],
          }),
        }),
      ),
    )
  })
})
