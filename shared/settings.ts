import type { DailyGoal } from './streak'
import type { VocabLevel } from './discover'

/** 文本引擎。cloudflare 是默认，不入库。 */
export type TextProvider = 'cloudflare' | 'gemini' | 'openai'

export const isTextProvider = (v: unknown): v is TextProvider => v === 'cloudflare' || v === 'gemini' || v === 'openai'

/** 当前 OpenAI 最强可用旗舰。设置页和 wrangler 默认都用这个 id。 */
export const DEFAULT_OPENAI_MODEL = 'gpt-6-astra'
export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'

/** 设置页可切换的 OpenAI 模型（2026-10 官方文档里的 GPT-6 家族） */
export const OPENAI_MODELS = [
  { id: 'gpt-6-astra', note: '最强旗舰' },
  { id: 'gpt-6.1-sol', note: '接近旗舰，更省' },
  { id: 'gpt-6.1-terra', note: '更快，适合看图' },
  { id: 'gpt-6-luna', note: '更快更省' },
]

export function normalizeOpenAiBaseUrl(v: string): string {
  return v.trim().replace(/\/+$/, '')
}

/** https 地址，或本机 http。不接受用户名、密码、查询串，避免把密钥写进 URL。 */
export function isOpenAiBaseUrl(v: unknown): v is string {
  if (typeof v !== 'string') return false
  const t = v.trim()
  if (!t || t.length > 200) return false
  let url: URL
  try {
    url = new URL(t)
  } catch {
    return false
  }
  if (url.username || url.password || url.search || url.hash) return false
  if (url.protocol === 'https:') return true
  return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
}

export function cleanOpenAiApiKey(v: string): string {
  return v.trim().replace(/^Bearer\s+/i, '')
}

export function isOpenAiApiKey(v: unknown): v is string {
  if (typeof v !== 'string') return false
  const t = cleanOpenAiApiKey(v)
  return t.length >= 8 && t.length <= 300 && !/\s/.test(t)
}

/** 页面上可切换的模型与音色（选项以 Google AI Studio 当前可用为准） */
export const TEXT_MODELS = [
  { id: 'gemini-3.8-flash', note: '最新，效果最好' },
  { id: 'gemini-3.7-flash', note: '' },
  { id: 'gemini-3.5-flash', note: '' },
  { id: 'gemini-3.5-flash-lite', note: '更快更省' },
  { id: 'gemini-3.1-flash-lite', note: '' },
]

export const TTS_MODELS = [
  { id: 'gemini-3.8-flash-tts', note: '音质最好' },
  { id: 'gemini-3.8-flash-lite-tts', note: '更快更省' },
]

export const VOICES = [
  { id: 'Kore', note: '女声 · 沉稳' },
  { id: 'Aoede', note: '女声 · 轻快' },
  { id: 'Leda', note: '女声 · 年轻' },
  { id: 'Zephyr', note: '女声 · 明亮' },
  { id: 'Puck', note: '男声 · 活泼' },
  { id: 'Charon', note: '男声 · 平稳' },
  { id: 'Fenrir', note: '男声 · 有力' },
  { id: 'Orus', note: '男声 · 坚定' },
]

export interface Settings {
  /** Text provider, saved for each signed-in user. */
  textProvider: TextProvider
  textModel: string
  /** OpenAI Chat Completions 模型。默认 gpt-6-astra。 */
  openaiModel: string
  /** OpenAI 兼容接口根地址，不含末尾斜杠。默认 https://api.openai.com/v1。 */
  openaiBaseUrl: string
  /** 个人 key 或部署环境 OPENAI_API_KEY 至少有一个。响应里不带回明文 key。 */
  openaiKeySet: boolean
  openaiKeySource: 'user' | 'server' | 'none'
  ttsModel: string
  voice: string
  /** 练习默认档位 1/2/3 */
  practiceLevel: 1 | 2 | 3
  /** 教练设定：学习者背景、目标与原则，出题和批改都会带上 */
  coachProfile: string
  /** 复习方式：混合 / 只认读 / 只产出 */
  reviewMode: 'mixed' | 'recognition' | 'production' | 'context'
  /** 每日目标：复习满几张算打卡 */
  dailyGoal: DailyGoal
  /** 每日提醒：北京时间几点推送，-1 不提醒 */
  reminderHour: number
  /** 发现新词的来源，如 "hn, r/cscareerquestions" */
  discoverSources: string
  /** 词汇量：词频排名在这之前的词不推荐 */
  vocabLevel: VocabLevel
  /** 每天早上自动把发现的词加入复习。默认关：先读短文再决定 */
  discoverAuto: boolean
}

export const REVIEW_MODES: { id: Settings['reviewMode']; name: string; desc: string }[] = [
  { id: 'mixed', name: '混合', desc: '新卡先认读，之后认读和产出交替出现' },
  { id: 'recognition', name: '只认读', desc: '看英文，回想意思' },
  { id: 'production', name: '只产出', desc: '看中文情境，说出空里的英文表达' },
  { id: 'context', name: '语境', desc: '原文例句挖空：在原来的语境里想起这个词（没有可挖空例句的卡片照常认读）' },
]

export const COACH_PROFILE_MAX = 3000

/** 模型名/音色只允许字母数字和 . - _，防止拼进 URL 时出问题 */
export const isSafeId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(v)
