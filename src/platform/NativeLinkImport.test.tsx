// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NativeLinkImport } from './NativeLinkImport'
import { PUBLIC_WEB_BASE } from './runtime'
import { PUBLISHED_V3_REQUEST_FIXTURE } from '../testFixtures/publishedFormats'
import { INVALID_LINK_NOTICE } from './incomingLink'

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  window.history.replaceState({}, '', '/#/')
  container = document.createElement('div'); document.body.append(container)
  root = createRoot(container)
  act(() => root.render(<NativeLinkImport />))
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks() })

function setInput(value: string) {
  const input = container.querySelector('textarea')!
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  act(() => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}
function submit() {
  act(() => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
}

describe('native manual link import', () => {
  it('keeps malformed URLs in the form and does not navigate or overwrite local data', () => {
    localStorage.setItem('test-progress', 'retained')
    setInput('https://evil.test/')
    submit()
    expect(container.querySelector('[role=status]')?.textContent).toBe(INVALID_LINK_NOTICE)
    expect(window.location.hash).toBe('#/')
    expect(localStorage.getItem('test-progress')).toBe('retained')
  })
  it('opens a validated request, clears the capability from the form, and explains manual recovery', () => {
    const hash = `#/l/${PUBLISHED_V3_REQUEST_FIXTURE}`
    setInput(PUBLIC_WEB_BASE + hash)
    submit()
    expect(window.location.hash).toBe(hash)
    expect(container.querySelector('textarea')!.value).toBe('')
    expect(container.textContent).toContain('復旧は内容を確認してから確定')
    expect(container.textContent).toContain('自動で移りません')
    window.location.hash = '/'
    act(() => (container.querySelector('button.ghost-button') as HTMLButtonElement).click())
    expect(window.location.hash).toBe(hash)
  })
  it('announces invalid native lifecycle links and unregisters on unmount', () => {
    act(() => window.dispatchEvent(new Event('native-link-error')))
    expect(container.querySelector('[role=status]')?.textContent).toBe(INVALID_LINK_NOTICE)
  })
})
