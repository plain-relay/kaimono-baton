export function createId(prefix: string) {
  const randomPart = Math.random().toString(36).slice(2, 8)
  return `${prefix}-${Date.now().toString(36)}-${randomPart}`
}
