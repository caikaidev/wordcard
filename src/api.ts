import type { Settings } from '../shared/settings'
import type { Lesson, LessonSummary, Level, PracticeStats, ShareData } from '../shared/practice'
import type { CardMeta, EnrichResult, Grade, Item, ItemStatus, ItemType, PackageInfo, RemixResult, WeeklyReport } from '../shared/types'

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

/** 请求默认超时：服务端卡住时给出明确提示，而不是让页面一直转圈 */
const TIMEOUT_MS = 60_000

async function req<T>(path: string, init?: RequestInit, timeoutMs = TIMEOUT_MS): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
      credentials: 'same-origin',
      headers: init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers,
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'TimeoutError') throw new ApiError('等得太久了，请求超时，请重试', 0)
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

export interface SavedArticle {
  id: number
  url: string | null
  title: string
  created_at: number
  /** 已保存的原文字数；null 表示还没读到，打开时再读 */
  chars: number | null
}

export const api = {
  stats: () => req<{ active: number; done: number; due: number }>('/stats'),
  items: (status: ItemStatus, q = '', packageId?: number) =>
    req<{ items: Item[] }>(
      `/items?status=${status}${q ? `&q=${encodeURIComponent(q)}` : ''}${packageId ? `&package=${packageId}` : ''}`,
    ),
  weekly: (offset = 0) => req<WeeklyReport>(`/weekly?offset=${offset}`),
  packages: () => req<{ packages: PackageInfo[] }>('/packages'),
  createPackageLesson: (id: number, input: { level?: Level; repeat?: boolean } = {}) =>
    req<{ id: number; count: number }>(`/practice/packages/${id}/lessons`, { method: 'POST', body: json(input) }, 180_000),
  deletePackage: (id: number) => req<void>(`/packages/${id}`, { method: 'DELETE' }),
  importPackage: (body: unknown) =>
    req<ImportReport>('/import', { method: 'POST', body: json(body) }, 120_000),
  create: (type: ItemType, text: string, meta: CardMeta) =>
    req<{ item: Item }>('/items', { method: 'POST', body: json({ type, text, meta }) }),
  update: (id: number, patch: Partial<Pick<Item, 'text' | 'meta' | 'status'>>) =>
    req<{ item: Item }>(`/items/${id}`, { method: 'PATCH', body: json(patch) }),
  remove: (id: number) => req<void>(`/items/${id}`, { method: 'DELETE' }),
  define: (id: number) => req<{ item: Item }>(`/items/${id}/define`, { method: 'POST' }),
  review: () => req<{ items: Item[] }>('/review'),
  grade: (id: number, grade: Grade) => req<{ item: Item }>(`/review/${id}`, { method: 'POST', body: json({ grade }) }),
  enrich: (text: string, type?: ItemType, context?: string) =>
    req<EnrichResult>('/enrich', { method: 'POST', body: json({ text, type, context }) }),
  lookup: (word: string) => req<{ source: string; senses: { pos: string; def: string }[] }>(`/lookup?word=${encodeURIComponent(word)}`),
  lessonSource: (id: number) => req<{ title: string; text: string }>(`/practice/lessons/${id}/source`),
  saved: () => req<{ saved: SavedArticle[] }>('/practice/saved'),
  save: (input: { url?: string; text?: string }) =>
    req<{ id: number; title: string; hasText: boolean }>('/practice/saved', { method: 'POST', body: json(input) }),
  savedSource: (id: number) => req<{ title: string; text: string; url: string | null }>(`/practice/saved/${id}/source`),
  deleteSaved: (id: number) => req<void>(`/practice/saved/${id}`, { method: 'DELETE' }),
  translate: (paragraphs: string[]) =>
    req<{ translations: string[] }>('/practice/translate', { method: 'POST', body: json({ paragraphs }) }),
  settings: () => req<{ current: Settings; defaults: Settings; me: Me }>('/settings'),
  saveSettings: (patch: Partial<Record<keyof Settings, string | number | null>>) =>
    req<{ current: Settings; me: Me }>('/settings', { method: 'PUT', body: json(patch) }),
  usage: () => req<UsageReport>('/usage', undefined, 20_000),
  practiceStats: () => req<PracticeStats>('/practice/stats'),
  shareData: () => req<ShareData>('/practice/share'),
  lessons: () => req<{ lessons: LessonSummary[] }>('/practice/lessons'),
  lesson: (id: number) => req<{ lesson: Lesson }>(`/practice/lessons/${id}`),
  createLesson: (input: { url?: string; text?: string; images?: { mime: string; data: string }[]; level?: Level; savedId?: number }) =>
    req<{ id: number }>('/practice/lessons', { method: 'POST', body: json(input) }, 180_000),
  deleteLesson: (id: number) => req<void>(`/practice/lessons/${id}`, { method: 'DELETE' }),
  submit: (id: number, idx: number, text: string) =>
    req<{ lesson: Lesson }>(`/practice/lessons/${id}/submit`, { method: 'POST', body: json({ idx, text }) }),
  storage: () =>
    req<{ count: number; bytes: number; unusedCount: number; unusedBytes: number; limitBytes: number }>('/storage'),
  cleanup: (mode: 'unused' | 'all') =>
    req<{ deleted: number; freedBytes: number }>('/storage/cleanup', { method: 'POST', body: json({ mode }) }),
  remix: (exclude: number[] = []) => req<RemixResult>('/remix', { method: 'POST', body: json({ exclude }) }, 40_000),
}

export const ttsUrl = (text: string, slow = false) =>
  `/api/tts?text=${encodeURIComponent(text)}${slow ? '&slow=1' : ''}`

export type UsageBucket = { calls: number; input: number; output: number; cost: number; unpriced: number }
export type UsageReport = {
  month: { total: UsageBucket; byKind: Record<string, UsageBucket> }
  lastMonth: UsageBucket
  projected: number
  today: { text: number; tts: number; textLimit: number; ttsLimit: number; disabled: boolean }
  /** 仅管理员：本月每个人的调用次数与费用 */
  users?: { email: string; calls: number; cost: number }[]
}

export type ImportReport = { packageId: number; added: number; skipped: number; invalid: string[] }

export type Me = { email: string; admin: boolean }
