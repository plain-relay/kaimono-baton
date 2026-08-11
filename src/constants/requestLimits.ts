export const MAX_ITEM_QUANTITY = 20
export const MAX_ITEM_CONDITION_CHARS = 30
export const MAX_TOTAL_CONDITION_CHARS = 1000
export const MAX_TITLE_CHARS = 30
export const MAX_CUSTOM_ITEM_NAME_CHARS = 30
export const MAX_CUSTOM_ITEM_UNIT_CHARS = 10
export const MAX_CUSTOM_ITEMS = 10
export const MAX_SHARE_URL_LENGTH = 2200
export const MAX_CATALOG_RECOVERY_URL_LENGTH = 2200
export const MAX_HOUSEHOLD_PRODUCTS = 200
export const MAX_CATALOG_RECOVERY_JSON_CHARS = 200_000
// File.size is measured in UTF-8 bytes, while recovery validation uses
// JavaScript string characters. Three bytes per UTF-16 code unit safely
// accommodates all valid UTF-8 text before the exact character check.
export const MAX_CATALOG_RECOVERY_JSON_BYTES =
  MAX_CATALOG_RECOVERY_JSON_CHARS * 3
export const REQUEST_LIMIT_WARNING_RATIO = 0.8
export const TOTAL_CONDITION_WARNING_THRESHOLD =
  MAX_TOTAL_CONDITION_CHARS * REQUEST_LIMIT_WARNING_RATIO
export const SHARE_URL_WARNING_THRESHOLD =
  MAX_SHARE_URL_LENGTH * REQUEST_LIMIT_WARNING_RATIO
