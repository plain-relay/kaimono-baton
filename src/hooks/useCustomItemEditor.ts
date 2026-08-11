import { useState } from 'react'

type CustomItemEditorValues = {
  name: string
  quantity: number
  unit: string
  memo: string
}

const DEFAULT_CUSTOM_ITEM_VALUES: CustomItemEditorValues = {
  name: '',
  quantity: 1,
  unit: '個',
  memo: '',
}

export function useCustomItemEditor() {
  const [isOpen, setIsOpen] = useState(false)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [name, setName] = useState(DEFAULT_CUSTOM_ITEM_VALUES.name)
  const [quantity, setQuantity] = useState(DEFAULT_CUSTOM_ITEM_VALUES.quantity)
  const [unit, setUnit] = useState(DEFAULT_CUSTOM_ITEM_VALUES.unit)
  const [memo, setMemo] = useState(DEFAULT_CUSTOM_ITEM_VALUES.memo)
  const [isDetailsOpen, setIsDetailsOpen] = useState(false)

  const reset = () => {
    setIsOpen(false)
    setEditingIndex(null)
    setName(DEFAULT_CUSTOM_ITEM_VALUES.name)
    setQuantity(DEFAULT_CUSTOM_ITEM_VALUES.quantity)
    setUnit(DEFAULT_CUSTOM_ITEM_VALUES.unit)
    setMemo(DEFAULT_CUSTOM_ITEM_VALUES.memo)
    setIsDetailsOpen(false)
  }

  const openNew = () => {
    reset()
    setIsOpen(true)
  }

  const openExisting = (index: number, values: CustomItemEditorValues) => {
    setEditingIndex(index)
    setName(values.name)
    setQuantity(values.quantity)
    setUnit(values.unit)
    setMemo(values.memo)
    setIsDetailsOpen(values.unit.trim() !== DEFAULT_CUSTOM_ITEM_VALUES.unit)
    setIsOpen(true)
  }

  const handleItemDeleted = (deletedIndex: number) => {
    if (editingIndex === deletedIndex) {
      reset()
    } else if (editingIndex !== null && editingIndex > deletedIndex) {
      setEditingIndex(editingIndex - 1)
    }
  }

  const toggleDetails = () => {
    setIsDetailsOpen((current) => !current)
  }

  return {
    isOpen,
    editingIndex,
    name,
    quantity,
    unit,
    memo,
    isDetailsOpen,
    setName,
    setQuantity,
    setUnit,
    setMemo,
    openNew,
    openExisting,
    handleItemDeleted,
    toggleDetails,
    reset,
  }
}
