// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useCustomItemEditor } from './useCustomItemEditor'

describe('useCustomItemEditor', () => {
  let container: HTMLDivElement
  let root: Root
  let editor: ReturnType<typeof useCustomItemEditor>

  function HookHarness() {
    editor = useCustomItemEditor()
    return null
  }

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root.render(<HookHarness />))
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('opens a new form with fresh defaults and resets stale input', () => {
    act(() => {
      editor.setName('古い商品')
      editor.setQuantity(3)
      editor.setUnit('袋')
      editor.setMemo('古い条件')
      editor.toggleDetails()
      editor.openNew()
    })

    expect(editor).toMatchObject({
      isOpen: true,
      editingIndex: null,
      name: '',
      quantity: 1,
      unit: '個',
      memo: '',
      isDetailsOpen: false,
    })
  })

  it('opens an existing item with its values and reveals a custom unit', () => {
    act(() =>
      editor.openExisting(2, {
        name: 'お米',
        quantity: 2,
        unit: '袋',
        memo: '無洗米',
      }),
    )

    expect(editor).toMatchObject({
      isOpen: true,
      editingIndex: 2,
      name: 'お米',
      quantity: 2,
      unit: '袋',
      memo: '無洗米',
      isDetailsOpen: true,
    })

    act(() =>
      editor.openExisting(0, {
        name: 'ティッシュ',
        quantity: 1,
        unit: '個',
        memo: '',
      }),
    )
    expect(editor.isDetailsOpen).toBe(false)
  })

  it('corrects the editing index and resets when the edited item is deleted', () => {
    act(() =>
      editor.openExisting(2, {
        name: '編集対象',
        quantity: 4,
        unit: '本',
        memo: '条件',
      }),
    )

    act(() => editor.handleItemDeleted(0))
    expect(editor).toMatchObject({
      isOpen: true,
      editingIndex: 1,
      name: '編集対象',
      quantity: 4,
      unit: '本',
      memo: '条件',
    })

    act(() => editor.handleItemDeleted(1))
    expect(editor).toMatchObject({
      isOpen: false,
      editingIndex: null,
      name: '',
      quantity: 1,
      unit: '個',
      memo: '',
      isDetailsOpen: false,
    })
  })

  it('uses the same complete reset for save, cancel, and full clear callers', () => {
    act(() =>
      editor.openExisting(1, {
        name: '保存前の商品',
        quantity: 2,
        unit: '箱',
        memo: '条件あり',
      }),
    )

    act(() => editor.reset())

    expect(editor).toMatchObject({
      isOpen: false,
      editingIndex: null,
      name: '',
      quantity: 1,
      unit: '個',
      memo: '',
      isDetailsOpen: false,
    })
  })
})
