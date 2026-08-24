import { toRaw } from 'vue'

/**
 * 复制来自 Vue 响应式状态的 JSON 值。
 * 原生 structuredClone 不能直接复制 Proxy，因此先递归解包再复制。
 */
export function cloneReactiveValue<T>(value: T): T {
  return cloneValue(value, new WeakMap<object, unknown>()) as T
}

function cloneValue(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (value === null || typeof value !== 'object') return value

  const raw = toRaw(value as object)
  const existing = seen.get(raw)
  if (existing) return existing

  if (raw instanceof Date) return new Date(raw.getTime())

  if (Array.isArray(raw)) {
    const result: unknown[] = []
    seen.set(raw, result)
    for (const item of raw) result.push(cloneValue(item, seen))
    return result
  }

  const result: Record<string, unknown> = {}
  seen.set(raw, result)
  for (const [key, child] of Object.entries(raw)) result[key] = cloneValue(child, seen)
  return result
}
