import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const formHtml = readFileSync(
  new URL('../public/handwriting-form-v1.html', import.meta.url),
  'utf8',
)

describe('printable handwriting form', () => {
  it('defines the v1 A4 portrait form with twelve numbered rows', () => {
    expect(formHtml).toContain('OTSUKAI FORM V1')
    expect(formHtml).toMatch(/@page\s*\{[\s\S]*size:\s*A4 portrait;/u)
    expect(formHtml).toContain('商品名')
    expect(formHtml).toContain('個数')
    expect(formHtml).toContain('条件')

    const body = /<tbody>([\s\S]*?)<\/tbody>/u.exec(formHtml)?.[1] ?? ''
    expect(body.match(/<tr>/gu)).toHaveLength(12)
    for (let row = 1; row <= 12; row += 1) {
      expect(body).toContain(`<td class="row-number">${row}</td>`)
    }
  })

  it('has four printable vector markers and hides screen controls in print', () => {
    expect(formHtml.match(/class="alignment-marker /gu)).toHaveLength(4)
    expect(formHtml.match(/<rect width="10" height="10" fill="#000"/gu)).toHaveLength(
      4,
    )
    expect(formHtml).toMatch(
      /@media print\s*\{[\s\S]*\.screen-only\s*\{[\s\S]*display:\s*none !important;/u,
    )
    expect(formHtml).toContain('A4・縦向き・倍率100%')
  })

  it('preserves the accepted 190 mm column geometry', () => {
    expect(formHtml).toMatch(
      /@media print\s*\{[\s\S]*?table\s*\{[\s\S]*?width:\s*190mm;/u,
    )
    expect(formHtml).toMatch(
      /@media print\s*\{[\s\S]*?\.column-number\s*\{[\s\S]*?width:\s*10mm;/u,
    )
    expect(formHtml).toMatch(
      /@media print\s*\{[\s\S]*?\.column-product\s*\{[\s\S]*?width:\s*70mm;/u,
    )
    expect(formHtml).toMatch(
      /@media print\s*\{[\s\S]*?\.column-quantity\s*\{[\s\S]*?width:\s*20mm;/u,
    )
    expect(formHtml).toMatch(
      /@media print\s*\{[\s\S]*?\.column-condition\s*\{[\s\S]*?width:\s*90mm;/u,
    )
    expect(formHtml).toMatch(/table\s*\{\s*width:\s*100%;/u)
  })

  it('prints the agreed handwriting guidance', () => {
    expect(formHtml).toContain('個数は1〜20で書いてください。')
    expect(formHtml).toContain('条件は短く書いてください。')
    expect(formHtml).toContain('空行は読み取りません。')
    expect(formHtml).toContain('同じ商品は原則1行へまとめてください。')
    expect(formHtml).toContain('訂正は二重線で消し')
  })

  it('contains no personal-information fields or external resources', () => {
    for (const forbiddenLabel of [
      '氏名',
      '住所',
      '電話番号',
      '価格',
      '店舗',
    ]) {
      expect(formHtml).not.toContain(forbiddenLabel)
    }
    expect(formHtml).not.toMatch(/<(?:link|script|img)\b[^>]*\b(?:href|src)=/iu)
    expect(formHtml).not.toMatch(/url\s*\(/iu)
  })
})
