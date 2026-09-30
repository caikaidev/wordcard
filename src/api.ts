import type { Settings } from '../shared/settings'
import type { CardMeta, EnrichResult, Grade, Item, ItemStatus, ItemType, RemixResult } from '../shared/types'

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      credentials: 'same-origin',
      headers: init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers,
    })
  } catch {
    // 断网，或 Cloudflare Access 登录过期（请求被重定向到登录页）
    throw new ApiError(navigator.onLine ? '登录可能已过期，请刷新页面重新登录' : '网络断开了，联网后再试', 0)
  }
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const msg =
      (data as { error?: string } | null)?.error ??
      (res.status === 401 || res.status === 403 ? '登录已失效，请刷新页面' : `请求失败（${res.status}）`)
    throw new ApiError(msg, res.status)
  }
  return data as T
}

const json = (body: unknown) => JSON.stringify(body)

export const api = {
  stats: () => req<{ active: number; done: number; due: number }>('/stats'),
  items: (status: ItemStatus, q = '') =>
    req<{ items: Item[] }>(`/items?status=${status}${q ? `&q=${encodeURIComponent(q)}` : ''}`),
  create: (type: ItemType, text: string, meta: CardMeta) =>
    req<{ item: Item }>('/items', { method: 'POST', body: json({ type, text, meta }) }),
  update: (id: number, patch: Partial<Pick<Item, 'text' | 'meta' | 'status'>>) =>
    req<{ item: Item }>(`/items/${id}`, { method: 'PATCH', body: json(patch) }),
  remove: (id: number) => req<void>(`/items/${id}`, { method: 'DELETE' }),
  review: () => req<{ items: Item[] }>('/review'),
  grade: (id: number, grade: Grade) => req<{ item: Item }>(`/review/${id}`, { method: 'POST', body: json({ grade }) }),
  enrich: (text: string, type?: ItemType) => req<EnrichResult>('/enrich', { method: 'POST', body: json({ text, type }) }),
  settings: () => req<{ current: Settings; defaults: Settings }>('/settings'),
  saveSettings: (patch: Partial<Record<keyof Settings, string | null>>) =>
    req<{ current: Settings }>('/settings', { method: 'PUT', body: json(patch) }),
  usage: () => req<UsageReport>('/usage'),
  storage: () =>
    req<{ count: number; bytes: number; unusedCount: number; unusedBytes: number; limitBytes: number }>('/storage'),
  cleanup: (mode: 'unused' | 'all') =>
    req<{ deleted: number; freedBytes: number }>('/storage/cleanup', { method: 'POST', body: json({ mode }) }),
  remix: (exclude: number[] = []) => req<RemixResult>('/remix', { method: 'POST', body: json({ exclude }) }),
}

export const ttsUrl = (text: string, slow = false) =>
  `/api/tts?text=${encodeURIComponent(text)}${slow ? '&slow=1' : ''}`

export type UsageBucket = { calls: number; input: number; output: number; cost: number; unpriced: number }
export type UsageReport = {
  month: { total: UsageBucket; byKind: Record<string, UsageBucket> }
  lastMonth: UsageBucket
  projected: number
}
