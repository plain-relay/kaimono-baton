import {
  MAX_CUSTOM_ITEM_NAME_CHARS,
  MAX_CUSTOM_ITEM_UNIT_CHARS,
  MAX_HOUSEHOLD_PRODUCTS,
} from '../constants/requestLimits'
import { categories } from '../data/categories'
import { products } from '../data/products'
import type {
  BaseProductOverride,
  EffectiveProduct,
  HouseholdCatalogV1,
  HouseholdProduct,
} from '../types/householdCatalog'
import type { Category, Product } from '../types/product'
import { countUserCharacters } from './textLength'

const DEFAULT_UNIT = '個'
const HOUSEHOLD_PRODUCT_ID_PATTERN =
  /^household:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const OVERRIDE_KEYS = new Set(['name', 'unit', 'categoryId', 'hidden'])
const HOUSEHOLD_PRODUCT_KEYS = new Set([
  'id',
  'name',
  'unit',
  'categoryId',
  'hidden',
  'createdAt',
  'updatedAt',
])
const CATALOG_KEYS = new Set([
  'schemaVersion',
  'revision',
  'updatedAt',
  'overrides',
  'addedProducts',
])

export type BaseProductEditInput = {
  name: string
  unit: string
  categoryId: string
  hidden: boolean
}

export type HouseholdProductInput = {
  name: string
  unit: string
  categoryId: string
  hidden?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>) {
  return Object.keys(value).every((key) => allowed.has(key))
}

function normalizeDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null
  }
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const name = value.trim()
  return name && countUserCharacters(name) <= MAX_CUSTOM_ITEM_NAME_CHARS
    ? name
    : null
}

function normalizeUnit(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const unit = value.trim() || DEFAULT_UNIT
  return countUserCharacters(unit) <= MAX_CUSTOM_ITEM_UNIT_CHARS ? unit : null
}

export function hasDangerousObjectKeys(value: unknown): boolean {
  const seen = new WeakSet<object>()

  function inspect(current: unknown): boolean {
    if (!current || typeof current !== 'object') {
      return false
    }
    if (seen.has(current)) {
      return true
    }
    seen.add(current)

    for (const key of Object.keys(current)) {
      if (DANGEROUS_KEYS.has(key) || inspect((current as Record<string, unknown>)[key])) {
        return true
      }
    }
    return false
  }

  return inspect(value)
}

export function isHouseholdProductId(value: string): boolean {
  return HOUSEHOLD_PRODUCT_ID_PATTERN.test(value)
}

function randomUuidFallback(): string {
  const bytes = new Uint8Array(16)
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0'))
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-')
}

export function createHouseholdProductId(
  existingIds: ReadonlySet<string> = new Set(),
): string {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const uuid = globalThis.crypto?.randomUUID?.() ?? randomUuidFallback()
    const id = `household:${uuid.toLowerCase()}`
    if (!existingIds.has(id)) {
      return id
    }
  }
  throw new Error('家庭用商品のIDを生成できませんでした。')
}

export function createEmptyHouseholdCatalog(
  now = new Date().toISOString(),
): HouseholdCatalogV1 {
  const updatedAt = normalizeDate(now)
  if (!updatedAt) {
    throw new Error('更新日時の形式が正しくありません。')
  }
  return {
    schemaVersion: 1,
    revision: 0,
    updatedAt,
    overrides: {},
    addedProducts: [],
  }
}

export function normalizeHouseholdCatalog(
  value: unknown,
  baseProducts: readonly Product[] = products,
  categoryList: readonly Category[] = categories,
): HouseholdCatalogV1 | null {
  if (
    !isRecord(value) ||
    hasDangerousObjectKeys(value) ||
    !hasOnlyKeys(value, CATALOG_KEYS) ||
    value.schemaVersion !== 1 ||
    !Number.isInteger(value.revision) ||
    (value.revision as number) < 0 ||
    !isRecord(value.overrides) ||
    !Array.isArray(value.addedProducts) ||
    value.addedProducts.length > MAX_HOUSEHOLD_PRODUCTS
  ) {
    return null
  }

  const updatedAt = normalizeDate(value.updatedAt)
  if (!updatedAt) {
    return null
  }

  const categoriesById = new Set(categoryList.map((category) => category.id))
  const baseProductsById = new Map(baseProducts.map((product) => [product.id, product]))
  const normalizedOverrides: Record<string, BaseProductOverride> = {}

  for (const [productId, rawOverride] of Object.entries(value.overrides)) {
    const baseProduct = baseProductsById.get(productId)
    if (
      !baseProduct ||
      !isRecord(rawOverride) ||
      !hasOnlyKeys(rawOverride, OVERRIDE_KEYS)
    ) {
      return null
    }

    const override: BaseProductOverride = {}
    if (typeof rawOverride.name !== 'undefined') {
      const name = normalizeName(rawOverride.name)
      if (!name) {
        return null
      }
      if (name !== baseProduct.name) {
        override.name = name
      }
    }
    if (typeof rawOverride.unit !== 'undefined') {
      const unit = normalizeUnit(rawOverride.unit)
      if (!unit) {
        return null
      }
      if (unit !== baseProduct.unit) {
        override.unit = unit
      }
    }
    if (typeof rawOverride.categoryId !== 'undefined') {
      if (
        typeof rawOverride.categoryId !== 'string' ||
        !categoriesById.has(rawOverride.categoryId)
      ) {
        return null
      }
      if (rawOverride.categoryId !== baseProduct.categoryId) {
        override.categoryId = rawOverride.categoryId
      }
    }
    if (typeof rawOverride.hidden !== 'undefined') {
      if (typeof rawOverride.hidden !== 'boolean') {
        return null
      }
      if (rawOverride.hidden) {
        override.hidden = true
      }
    }
    if (Object.keys(override).length > 0) {
      normalizedOverrides[productId] = override
    }
  }

  const seenIds = new Set(baseProducts.map((product) => product.id))
  const normalizedAddedProducts: HouseholdProduct[] = []
  for (const rawProduct of value.addedProducts) {
    const normalizedId =
      typeof rawProduct.id === 'string' ? rawProduct.id.toLowerCase() : ''
    if (
      !isRecord(rawProduct) ||
      !hasOnlyKeys(rawProduct, HOUSEHOLD_PRODUCT_KEYS) ||
      typeof rawProduct.id !== 'string' ||
      !isHouseholdProductId(rawProduct.id) ||
      seenIds.has(normalizedId) ||
      typeof rawProduct.categoryId !== 'string' ||
      !categoriesById.has(rawProduct.categoryId) ||
      typeof rawProduct.hidden !== 'boolean'
    ) {
      return null
    }

    const name = normalizeName(rawProduct.name)
    const unit = normalizeUnit(rawProduct.unit)
    const createdAt = normalizeDate(rawProduct.createdAt)
    const productUpdatedAt = normalizeDate(rawProduct.updatedAt)
    if (!name || !unit || !createdAt || !productUpdatedAt) {
      return null
    }

    seenIds.add(normalizedId)
    normalizedAddedProducts.push({
      id: normalizedId,
      name,
      unit,
      categoryId: rawProduct.categoryId,
      hidden: rawProduct.hidden,
      createdAt,
      updatedAt: productUpdatedAt,
    })
  }

  return {
    schemaVersion: 1,
    revision: value.revision as number,
    updatedAt,
    overrides: normalizedOverrides,
    addedProducts: normalizedAddedProducts,
  }
}

function requireNormalizedCatalog(
  value: HouseholdCatalogV1,
  baseProducts: readonly Product[] = products,
  categoryList: readonly Category[] = categories,
): HouseholdCatalogV1 {
  const normalized = normalizeHouseholdCatalog(value, baseProducts, categoryList)
  if (!normalized) {
    throw new Error('商品リストの形式が正しくありません。')
  }
  return normalized
}

function compareCatalogContent(
  left: HouseholdCatalogV1,
  right: HouseholdCatalogV1,
): boolean {
  const addedProductContent = (catalog: HouseholdCatalogV1) =>
    catalog.addedProducts.map((product) => ({
      id: product.id,
      name: product.name,
      unit: product.unit,
      categoryId: product.categoryId,
      hidden: product.hidden,
    }))
  return (
    JSON.stringify(left.overrides) === JSON.stringify(right.overrides) &&
    JSON.stringify(addedProductContent(left)) ===
      JSON.stringify(addedProductContent(right))
  )
}

function finalizeCatalogMutation(
  current: HouseholdCatalogV1,
  candidate: HouseholdCatalogV1,
  now: string,
  baseProducts: readonly Product[] = products,
  categoryList: readonly Category[] = categories,
): HouseholdCatalogV1 {
  const normalizedCurrent = requireNormalizedCatalog(
    current,
    baseProducts,
    categoryList,
  )
  const normalizedCandidate = requireNormalizedCatalog(
    {
      ...candidate,
      revision: normalizedCurrent.revision + 1,
      updatedAt: now,
    },
    baseProducts,
    categoryList,
  )
  return compareCatalogContent(normalizedCurrent, normalizedCandidate)
    ? normalizedCurrent
    : normalizedCandidate
}

export function updateBaseProduct(
  catalog: HouseholdCatalogV1,
  productId: string,
  input: BaseProductEditInput,
  now = new Date().toISOString(),
  baseProducts: readonly Product[] = products,
  categoryList: readonly Category[] = categories,
): HouseholdCatalogV1 {
  const baseProduct = baseProducts.find((product) => product.id === productId)
  if (!baseProduct) {
    throw new Error('基準商品が見つかりません。')
  }
  const candidate = {
    ...catalog,
    overrides: {
      ...catalog.overrides,
      [productId]: {
        name: input.name,
        unit: input.unit,
        categoryId: input.categoryId,
        hidden: input.hidden,
      },
    },
  }
  return finalizeCatalogMutation(catalog, candidate, now, baseProducts, categoryList)
}

export function resetBaseProduct(
  catalog: HouseholdCatalogV1,
  productId: string,
  now = new Date().toISOString(),
  baseProducts: readonly Product[] = products,
  categoryList: readonly Category[] = categories,
): HouseholdCatalogV1 {
  if (!baseProducts.some((product) => product.id === productId)) {
    throw new Error('基準商品が見つかりません。')
  }
  const overrides = { ...catalog.overrides }
  delete overrides[productId]
  return finalizeCatalogMutation(
    catalog,
    { ...catalog, overrides },
    now,
    baseProducts,
    categoryList,
  )
}

export function addHouseholdProduct(
  catalog: HouseholdCatalogV1,
  input: HouseholdProductInput,
  now = new Date().toISOString(),
  baseProducts: readonly Product[] = products,
  categoryList: readonly Category[] = categories,
  id = createHouseholdProductId(
    new Set([
      ...baseProducts.map((product) => product.id),
      ...catalog.addedProducts.map((product) => product.id),
    ]),
  ),
): HouseholdCatalogV1 {
  if (catalog.addedProducts.length >= MAX_HOUSEHOLD_PRODUCTS) {
    throw new Error('家庭用商品の登録上限に達しています。')
  }
  const candidate: HouseholdCatalogV1 = {
    ...catalog,
    addedProducts: [
      ...catalog.addedProducts,
      {
        id,
        name: input.name,
        unit: input.unit,
        categoryId: input.categoryId,
        hidden: input.hidden ?? false,
        createdAt: now,
        updatedAt: now,
      },
    ],
  }
  return finalizeCatalogMutation(catalog, candidate, now, baseProducts, categoryList)
}

export function updateHouseholdProduct(
  catalog: HouseholdCatalogV1,
  productId: string,
  input: HouseholdProductInput,
  now = new Date().toISOString(),
  baseProducts: readonly Product[] = products,
  categoryList: readonly Category[] = categories,
): HouseholdCatalogV1 {
  if (!catalog.addedProducts.some((product) => product.id === productId)) {
    throw new Error('家庭用商品が見つかりません。')
  }
  const candidate: HouseholdCatalogV1 = {
    ...catalog,
    addedProducts: catalog.addedProducts.map((product) =>
      product.id === productId
        ? {
            ...product,
            name: input.name,
            unit: input.unit,
            categoryId: input.categoryId,
            hidden: input.hidden ?? product.hidden,
            updatedAt: now,
          }
        : product,
    ),
  }
  return finalizeCatalogMutation(catalog, candidate, now, baseProducts, categoryList)
}

export function setCatalogProductHidden(
  catalog: HouseholdCatalogV1,
  productId: string,
  hidden: boolean,
  now = new Date().toISOString(),
  baseProducts: readonly Product[] = products,
  categoryList: readonly Category[] = categories,
): HouseholdCatalogV1 {
  const baseProduct = baseProducts.find((product) => product.id === productId)
  if (baseProduct) {
    const effective = buildAllEffectiveProductCatalog(
      baseProducts,
      catalog,
      categoryList,
    ).find((product) => product.id === productId)
    if (!effective) {
      throw new Error('商品が見つかりません。')
    }
    return updateBaseProduct(
      catalog,
      productId,
      {
        name: effective.name,
        unit: effective.unit,
        categoryId: effective.categoryId,
        hidden,
      },
      now,
      baseProducts,
      categoryList,
    )
  }

  const added = catalog.addedProducts.find((product) => product.id === productId)
  if (!added) {
    throw new Error('商品が見つかりません。')
  }
  return updateHouseholdProduct(
    catalog,
    productId,
    {
      name: added.name,
      unit: added.unit,
      categoryId: added.categoryId,
      hidden,
    },
    now,
    baseProducts,
    categoryList,
  )
}

export function buildAllEffectiveProductCatalog(
  baseProducts: readonly Product[],
  catalog: HouseholdCatalogV1,
  categoryList: readonly Category[] = categories,
): EffectiveProduct[] {
  const normalized = requireNormalizedCatalog(catalog, baseProducts, categoryList)
  const baseIndex = new Map(baseProducts.map((product, index) => [product.id, index]))
  const baseEffective = baseProducts.map((product): EffectiveProduct => {
    const override = normalized.overrides[product.id]
    return {
      ...product,
      name: override?.name ?? product.name,
      unit: override?.unit ?? product.unit,
      categoryId: override?.categoryId ?? product.categoryId,
      source: 'base',
      hidden: override?.hidden ?? false,
      isCustomized: Boolean(override && Object.keys(override).length > 0),
    }
  })
  const addedEffective = normalized.addedProducts.map(
    (product): EffectiveProduct => ({
      id: product.id,
      name: product.name,
      categoryId: product.categoryId,
      defaultQuantity: 1,
      unit: product.unit,
      icon: '🛒',
      sortOrder: 0,
      source: 'household',
      hidden: product.hidden,
      isCustomized: true,
    }),
  )

  const result: EffectiveProduct[] = []
  const categoryOrder = [...categoryList].sort(
    (left, right) => left.sortOrder - right.sortOrder,
  )
  for (const category of categoryOrder) {
    const unchangedBase = baseEffective
      .filter(
        (product) =>
          product.categoryId === category.id &&
          baseProductsById(baseProducts, product.id)?.categoryId === category.id,
      )
      .sort(
        (left, right) =>
          left.sortOrder - right.sortOrder || left.id.localeCompare(right.id),
      )
    const movedBase = baseEffective
      .filter(
        (product) =>
          product.categoryId === category.id &&
          baseProductsById(baseProducts, product.id)?.categoryId !== category.id,
      )
      .sort(
        (left, right) =>
          (baseIndex.get(left.id) ?? 0) - (baseIndex.get(right.id) ?? 0),
      )
    const added = addedEffective
      .filter((product) => product.categoryId === category.id)
      .sort((left, right) => left.id.localeCompare(right.id))

    const categoryTailStart = Math.max(
      category.sortOrder * 100,
      ...unchangedBase.map((product) => product.sortOrder),
    )
    const appended = [...movedBase, ...added].map((product, index) => ({
      ...product,
      sortOrder: categoryTailStart + index + 1,
    }))
    result.push(...unchangedBase, ...appended)
  }
  return result
}

function baseProductsById(
  baseProducts: readonly Product[],
  productId: string,
): Product | undefined {
  return baseProducts.find((product) => product.id === productId)
}

export function buildEffectiveProductCatalog(
  baseProducts: readonly Product[],
  householdCatalog: HouseholdCatalogV1,
): EffectiveProduct[] {
  return buildAllEffectiveProductCatalog(baseProducts, householdCatalog).filter(
    (product) => !product.hidden,
  )
}
