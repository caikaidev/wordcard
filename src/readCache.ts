/** Short-lived, per-page-session data cache. Personal responses never go to disk. */
const TTL = 30_000
const MAX_ENTRIES = 80
const values = new Map<string, { value: unknown; expires: number }>()
const pending = new Map<string, Promise<unknown>>()
let generation = 0
let writes = 0

export function clearReadCache() {
  generation++
  values.clear()
  pending.clear()
}

export function beginWrite() {
  writes++
  clearReadCache()
  return () => {
    writes--
    clearReadCache()
  }
}

export function readCached<T>(key: string): T | null {
  const entry = values.get(key)
  if (!entry || writes || entry.expires <= Date.now()) {
    values.delete(key)
    return null
  }
  // Consumers may sort or edit their own copy without corrupting the cache.
  return structuredClone(entry.value) as T
}

export async function cachedRead<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = readCached<T>(key)
  if (hit !== null) return hit
  if (writes) return load()
  const existing = pending.get(key)
  if (existing) return structuredClone(await existing) as T
  const started = generation
  const request = load().then((value) => {
    // A read started before a write/refresh must never repopulate the cache.
    if (generation === started && !writes) {
      if (values.size >= MAX_ENTRIES) values.delete(values.keys().next().value!)
      values.set(key, { value: structuredClone(value), expires: Date.now() + TTL })
    }
    return value
  })
  pending.set(key, request)
  try {
    return structuredClone(await request)
  } finally {
    if (pending.get(key) === request) pending.delete(key)
  }
}
