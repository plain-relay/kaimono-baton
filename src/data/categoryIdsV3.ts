// Public v3 URLs use this array index as the category number. Never reorder,
// remove, or rename published entries. Append new category IDs at the end.
export const CATEGORY_IDS_V3 = [
  'vegetables',
  'fruits',
  'fish',
  'meat',
  'prepared',
  'bread',
  'eggs-dairy',
  'soy',
  'seasonings-dry',
  'frozen',
  'drinks',
  'daily',
  'baby',
  'other',
] as const

export type CategoryIdV3 = (typeof CATEGORY_IDS_V3)[number]
