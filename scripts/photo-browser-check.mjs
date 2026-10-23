// Requires the two local servers described in PRODUCT_PHOTO_RECOVERY.md and an
// operator-provided Playwright installation. No production data or config used.
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
import lzString from 'lz-string'
const { decompressFromEncodedURIComponent } = lzString

const { chromium } = await import(process.env.PHOTO_CHECK_PLAYWRIGHT_PATH
  ? pathToFileURL(process.env.PHOTO_CHECK_PLAYWRIGHT_PATH).href : 'playwright')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
let step = 'startup'
const results = []
const raw = Buffer.alloc(1600 * 800 * 3)
for (let y = 0; y < 800; y++) for (let x = 0; x < 1600; x++) {
  const at = (y * 1600 + x) * 3
  raw[at + (x < 800 ? 0 : 2)] = 240
}
const source = await sharp(raw, { raw: { width: 1600, height: 800, channels: 3 } })
  .withMetadata({ orientation: 6 }).jpeg().toBuffer()
try {
  for (const count of [0, 1, 2, 3]) {
    step = `browser-${count}`
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    await context.addInitScript(() => {
      window.photoCheck = { shares: [], cancel: false, photoBytes: [] }
      const nativeFetch = window.fetch
      window.fetch = async (input, init) => {
        if (String(input).endsWith('/v1/photos/batch') && init?.body instanceof FormData) {
          window.photoCheck.photoBytes = await Promise.all(init.body.getAll('photo').map(async (photo) =>
            Array.from(new Uint8Array(await photo.arrayBuffer()))))
        }
        return nativeFetch(input, init)
      }
      Object.defineProperty(navigator, 'share', { configurable: true, value: async (data) => {
        window.photoCheck.shares.push(data.text)
        if (window.photoCheck.cancel) throw new DOMException('Cancelled', 'AbortError')
      } })
    })
    const page = await context.newPage()
    let posts = 0
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/v1/photos/batch')) {
        posts++
      }
    })
    await page.goto('http://localhost:4178/#/create')
    if (count === 0) {
      for (const orientation of [1, 8]) {
        const fixture = await sharp(raw, { raw: { width: 1600, height: 800, channels: 3 } })
          .withMetadata({ orientation }).jpeg().toBuffer()
        const output = await page.evaluate(async (input) => {
          const { processProductPhoto } = await import('/src/features/productPhotos/imageProcessing.ts')
          const result = await processProductPhoto(new File([new Uint8Array(input)], 'synthetic.jpg', { type: 'image/jpeg' }))
          return { width: result.width, height: result.height, bytes: Array.from(new Uint8Array(await result.blob.arrayBuffer())) }
        }, Array.from(fixture))
        assert.equal(output.width, orientation === 1 ? 1280 : 640)
        assert.equal(output.height, orientation === 1 ? 640 : 1280)
        const metadata = await sharp(Buffer.from(output.bytes)).metadata()
        assert.equal(metadata.exif, undefined)
      }
    }
    step = `select-${count}`
    const names = ['牛乳', '卵', '食パン']
    for (let index = 0; index < Math.max(count, 1); index++) {
      const name = names[index]
      await page.getByRole('button', { name: new RegExp(`^${name}を1.*増やす`) }).click()
      if (index < count) {
        await page.getByRole('button', { name: new RegExp(`^${name}の条件を開く`) }).click()
        await page.getByLabel(`${name}の端末写真を選ぶ`, { exact: true }).setInputFiles({
          name: 'synthetic.jpg', mimeType: 'image/jpeg', buffer: source,
        })
        await page.getByAltText(`${name}の参考写真プレビュー`, { exact: true }).waitFor()
      }
    }
    if (count === 3) {
      await page.getByRole('button', { name: /^キャベツを1.*増やす/ }).click()
      await page.getByRole('button', { name: /^キャベツの条件を開く/ }).click()
      assert.equal(await page.getByLabel('キャベツの端末写真を選ぶ', { exact: true }).isDisabled(), true)
    }
    await page.getByRole('button', { name: '確認へ', exact: true }).click()
    step = `share-${count}`
    assert.equal(posts, 0)
    if (count === 1) {
      await page.evaluate(() => { window.photoCheck.cancel = true })
      await page.route('**/v1/photos/batch', (route) => route.fulfill({ status: 503,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'http://localhost:4178' },
        body: JSON.stringify({ code: 'SERVICE_UNAVAILABLE' }) }))
    }
    await page.getByRole('button', { name: 'LINEで送る', exact: true }).click()
    if (count === 1) {
      await page.getByText('写真保存サービスで問題が発生しました。', { exact: false }).waitFor()
      assert.equal(await page.evaluate(() => window.photoCheck.shares.length), 0)
      assert.equal(await page.getByAltText('牛乳の参考写真', { exact: true }).count(), 1)
      await page.unroute('**/v1/photos/batch')
      await page.getByRole('button', { name: '写真付き共有を再試行', exact: true }).click()
    }
    await page.waitForFunction(() => window.photoCheck.shares.length > 0, null, { timeout: 70000 })
    if (count === 1) {
      await page.getByText('共有をキャンセル', { exact: false }).first().waitFor()
      assert.equal(await page.getByAltText('牛乳の参考写真', { exact: true }).count(), 1)
      await page.evaluate(() => { window.photoCheck.cancel = false })
      await page.getByRole('button', { name: 'LINEで送る', exact: true }).click()
      await page.waitForFunction(() => window.photoCheck.shares.length === 2)
    }
    assert.equal(posts, count === 0 ? 0 : count === 1 ? 2 : 1)
    const sharedText = await page.evaluate(() => window.photoCheck.shares.at(-1))
    step = `codec-${count}`
    const url = new URL(sharedText.split('\n').at(-1))
    const encoded = url.hash.slice('#/l/'.length)
    const payload = JSON.parse(decompressFromEncodedURIComponent(encoded))
    assert.equal(payload[0], count === 0 ? 3 : 4)
    const photoBytes = await page.evaluate(() => window.photoCheck.photoBytes)
    assert.equal(photoBytes.length, count)
    for (const photo of photoBytes) {
        const bytes = Buffer.from(photo)
        const meta = await sharp(bytes).metadata()
        assert.equal(meta.width, 640)
        assert.equal(meta.height, 1280)
        assert.equal(meta.exif, undefined)
        const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true })
        assert.ok(data[0] > 200 && data[2] < 20)
        const bottom = (info.height - 1) * info.width * info.channels
        assert.ok(data[bottom + 2] > 200 && data[bottom] < 20)
        assert.ok(bytes.length <= 500 * 1024)
    }
    // A fresh purchaser context proves no creator session is needed.
    const buyer = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const recipient = await buyer.newPage()
    await recipient.goto(url.toString())
    step = `purchase-controls-${count}`
    await recipient.getByRole('button', { name: '牛乳を1本かごに入れる', exact: true }).waitFor()
    if (count) {
      step = `display-${count}`
      await recipient.waitForFunction((expected) => document.querySelectorAll('[data-photo-state="loaded"] img').length === expected, count)
      const images = recipient.locator('[data-photo-state="loaded"] img')
      assert.equal(await images.count(), count)
      assert.equal(await images.evaluateAll((xs) => xs.every((x) => x.complete && x.naturalWidth > 0)), true)
      await recipient.getByRole('button', { name: '牛乳の参考写真を拡大', exact: true }).click()
      await recipient.getByRole('dialog').waitFor()
      await recipient.getByRole('button', { name: '閉じる', exact: true }).click()
    }
    await recipient.getByRole('button', { name: '牛乳を1本かごに入れる', exact: true }).click()
    step = `purchase-result-${count}`
    assert.ok(await recipient.getByText('かご済み', { exact: false }).count())
    assert.equal(await recipient.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    results.push({ photos: count, urlVersion: count === 0 ? 3 : 4, post: posts,
      preview: true, displayed: count, enlarged: count > 0, purchase: true, passed: true })
    await buyer.close()
    await context.close()
  }
  console.log(JSON.stringify({ browser: 'Chrome desktop / 390px viewport',
    shareSheet: 'navigator.share fixture', turnstile: 'official dummy sitekey',
    siteverify: 'HTTP fixture', results }))
} catch (error) {
  console.error(JSON.stringify({ case: step, passed: false,
    errorClass: ['AssertionError', 'TimeoutError'].includes(error.name) ? error.name : 'other',
    scriptLine: /photo-browser-check\.mjs:(\d+)/.exec(error.stack)?.[1] }))
  process.exitCode = 1
} finally {
  await browser.close()
}
