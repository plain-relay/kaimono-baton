import type { Category } from '../types/product'

export const categories: Category[] = [
  { id: 'vegetables', name: '野菜', sortOrder: 1 },
  { id: 'fruits', name: '果物', sortOrder: 2 },
  { id: 'fish', name: '魚・魚加工品', sortOrder: 3 },
  { id: 'meat', name: '肉', sortOrder: 4 },
  { id: 'prepared', name: '惣菜', sortOrder: 5 },
  { id: 'bread', name: 'パン', sortOrder: 6 },
  { id: 'eggs-dairy', name: '卵・乳製品', sortOrder: 7 },
  { id: 'soy', name: '大豆製品', sortOrder: 8 },
  { id: 'seasonings-dry', name: '調味料・乾物', sortOrder: 9 },
  { id: 'frozen', name: '冷凍食品', sortOrder: 10 },
  { id: 'drinks', name: '飲料', sortOrder: 11 },
  { id: 'daily', name: '日用品', sortOrder: 12 },
  { id: 'baby', name: 'ベビー用品', sortOrder: 13 },
  { id: 'other', name: 'その他', sortOrder: 14 },
]
