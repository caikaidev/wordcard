import type { Difficulty } from '../shared/difficulty'
import type { ReviewForecast } from '../shared/forecast'
import { beginWrite, cachedRead, clearReadCache } from './readCache'
import type { Settings } from '../shared/settings'
import type { Lesson, LessonSummary, Level, PracticeStats, ShareData } from '../shared/practice'
import type { CheckinEvent, StreakStatus } from '../shared/streak'
import type { Discovery, DiscoverReport } from '../shared/discover'
import type { LevelStatus, TestResult } from '../shared/level'
import type { Quest, QuestProgress, StageId } from '../shared/quest'
import type { LessonImportReport } from '../shared/lesson-import'
import type { CardMeta, EnrichResult, Grade, Item, ItemStatus, ItemType, PackageInfo, RemixResult, WeeklyReport } from '../shared/types'

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

/** 请求默认超时：服务端卡住时给出明确提示，而不是让页面一直转圈 */
const TIMEOUT_MS = 90_000

const RELOGIN_KEY = 'shiju:relogin'

/**
 * Cloudflare Access 登录过期：整页重新打开当前地址，让 Access 现场生成一个新的登录跳转。
 * 不能等用户自己去刷新——系统恢复后台页面、重开旧标签时可能带着早已过期的登录链接，
 * 会落到 Access 的「Current authentication token is expired」错误页。
 * 30 秒内只跳一次，避免配置有误（比如 AUD 对不上）时无限刷新。
 */
export function relogin(): boolean {
  clearReadCache()
  try {
    const last = Number(sessionStorage.getItem(RELOGIN_KEY) || 0)
    if (Date.now() - last < 30_000) return false
    sessionStorage.setItem(RELOGIN_KEY, String(Date.now()))
  } catch {
    // 存储不可用时照样跳转
  }
  window.location.reload()
  return true
}

async function networkReq<T>(path: string, init?: RequestInit, timeoutMs = TIMEOUT_MS): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
      credentials: 'same-origin',
      // Access 登录过期时会把请求重定向到登录页；不跟随，才能准确认出这种情况
      redirect: 'manual',
      headers: init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers,
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'TimeoutError') throw new ApiError('等得太久了，请求超时，请重试', 0)
    throw new ApiError(navigator.onLine ? '连不上服务器，请稍后重试' : '网络断开了，联网后再试', 0)
  }
  if (res.type === 'opaqueredirect') {
    relogin()
    throw new ApiError('登录已过期，正在重新登录…', 401)
  }
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    if ((data as { login?: boolean } | null)?.login && relogin()) throw new ApiError('登录已过期，正在重新登录…', res.status)
    const msg =
      (data as { error?: string } | null)?.error ??
      (res.status === 401 || res.status === 403 ? '登录已失效，请刷新页面' : `请求失败（${res.status}）`)
    throw new ApiError(msg, res.status)
  }
  return data as T
}

/** Cache only cheap, read-only page data; AI generation and credentials stay uncached. */
const CACHEABLE_READ = /^(\/stats|\/settings|\/packages|\/review|\/streak|\/items(?:\?.*)?|\/practice\/(?:stats|lessons|saved))$/

async function req<T>(path: string, init?: RequestInit, timeoutMs = TIMEOUT_MS): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase()
  if (method === 'GET') {
    const load = () => networkReq<T>(path, init, timeoutMs)
    return CACHEABLE_READ.test(path) ? cachedRead(path, load) : load()
  }
  const finish = beginWrite()
  try {
    return await networkReq<T>(path, init, timeoutMs)
  } finally {
    finish()
  }
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
  importPackage: (body: unknown) =>
    req<ImportReport>('/import', { method: 'POST', body: json(body) }, 120_000),
  create: (type: ItemType, text: string, meta: CardMeta) =>
    req<{ item: Item }>('/items', { method: 'POST', body: json({ type, text, meta }) }),
  update: (id: number, patch: Partial<Pick<Item, 'text' | 'meta' | 'status'>>) =>
    req<{ item: Item }>(`/items/${id}`, { method: 'PATCH', body: json(patch) }),
  remove: (id: number) => req<void>(`/items/${id}`, { method: 'DELETE' }),
  define: (id: number) => req<{ item: Item }>(`/items/${id}/define`, { method: 'POST' }),
  review: () => req<{ items: Item[] }>('/review'),
  reviewForecast: () => req<ReviewForecast>('/review/forecast'),
  grade: (id: number, grade: Grade) => req<{ item: Item; checkin: CheckinEvent | null }>(`/review/${id}`, { method: 'POST', body: json({ grade }) }),
  enrich: (text: string, type?: ItemType, context?: string) =>
    req<EnrichResult>('/enrich', { method: 'POST', body: json({ text, type, context }) }),
  lookup: (word: string) => req<{ source: string; senses: { pos: string; def: string }[] }>(`/lookup?word=${encodeURIComponent(word)}`),
  lessonSource: (id: number) => req<{ title: string; text: string }>(`/practice/lessons/${id}/source`, undefined, 150_000),
  saved: () => req<{ saved: SavedArticle[] }>('/practice/saved'),
  save: (input: { url?: string; text?: string }) =>
    req<{ id: number; title: string; hasText: boolean }>('/practice/saved', { method: 'POST', body: json(input) }, 150_000),
  savedSource: (id: number) => req<{ title: string; text: string; url: string | null }>(`/practice/saved/${id}/source`, undefined, 150_000),
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
    req<{ lesson: Lesson; checkin: CheckinEvent | null }>(`/practice/lessons/${id}/submit`, { method: 'POST', body: json({ idx, text }) }),
  storage: () =>
    req<{ count: number; bytes: number; unusedCount: number; unusedBytes: number; limitBytes: number }>('/storage'),
  cleanup: (mode: 'unused' | 'all') =>
    req<{ deleted: number; freedBytes: number }>('/storage/cleanup', { method: 'POST', body: json({ mode }) }),
  streak: () => req<StreakStatus>('/streak'),
  importLesson: (body: unknown) => req<LessonImportReport>('/lessons/import', { method: 'POST', body: json(body) }, 180_000),
  tokens: () => req<{ tokens: ApiToken[] }>('/tokens'),
  createToken: (name: string) => req<{ id: number; name: string; token: string }>('/tokens', { method: 'POST', body: json({ name }) }),
  deleteToken: (id: number) => req<void>(`/tokens/${id}`, { method: 'DELETE' }),
  prepareQuest: (lessonId: number) =>
    req<{ status: string; jobId?: number }>(`/generation/quest/${lessonId}`, { method: 'POST' }),
  quest: (lessonId: number) =>
    req<Quest | { pending: true; status: string }>(`/quest/${lessonId}`, { method: 'POST' }, 120_000),
  passStage: (lessonId: number, stage: StageId, accuracy: number) =>
    req<{ progress: QuestProgress; gained: number; checkin: CheckinEvent | null }>(`/quest/${lessonId}/stages/${stage}`, { method: 'POST', body: json({ accuracy }) }),
  questFeedback: (lessonId: number, stage: StageId, difficulty: Difficulty) =>
    req<{ difficulty: Difficulty }>(`/quest/${lessonId}/stages/${stage}/feedback`, { method: 'PUT', body: json({ difficulty }) }),
  level: () => req<LevelStatus>('/level'),
  startLevelTest: () => req<{ id: number; words: string[] }>('/level/test', { method: 'POST' }, 60_000),
  submitLevelTest: (id: number, known: string[]) => req<TestResult>(`/level/test/${id}`, { method: 'POST', body: json({ known }) }),
  discoveries: () => req<{ items: Discovery[]; redditAuth: boolean }>('/discover'),
  runDiscover: () => req<{ report: DiscoverReport; count: number }>('/discover/run', { method: 'POST' }, 120_000),
  learnDiscoveries: (ids: number[]) => req<{ added: number }>('/discover/add', { method: 'POST', body: json({ ids }) }),
  knowDiscoveries: (ids: number[]) => req<{ known: number }>('/discover/known', { method: 'POST', body: json({ ids }) }),
  pushKey: () => req<{ key: string | null }>('/push/key'),
  pushSubscribe: (sub: PushSubscriptionJSON) => req<void>('/push/subscribe', { method: 'POST', body: json(sub) }),
  pushUnsubscribe: (endpoint: string) => req<void>('/push/unsubscribe', { method: 'POST', body: json({ endpoint }) }),
  pushTest: () => req<{ sent: number; failed?: number; note?: string }>('/push/test', { method: 'POST' }, 30_000),
  remix: (exclude: number[] = []) => req<RemixResult>('/remix', { method: 'POST', body: json({ exclude }) }, 40_000),
}

export const ttsUrl = (text: string, slow = false) =>
  `/api/tts?text=${encodeURIComponent(text)}&v=melo-v2${slow ? '&slow=1' : ''}`

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

export type ApiToken = { id: number; name: string; prefix: string; created_at: number; last_used_at: number | null }

