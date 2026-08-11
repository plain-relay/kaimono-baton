export type Product = {
  id: string
  name: string
  categoryId: string
  defaultQuantity: number
  unit: string
  memo?: string
  icon: string
  sortOrder: number
}

export type Category = {
  id: string
  name: string
  sortOrder: number
}
