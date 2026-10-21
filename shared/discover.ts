/* ---------------------------- 发现新词：从 HN / Reddit 找你还没学的高频词 ---------------------------- */

import type { CardMeta } from './types'

/** 词汇量档位：词频排名在这之前的词默认认识，不推荐；0 = 自动，用词汇评级的估算 */
export const VOCAB_LEVELS = [
  { id: 0, name: '自动', desc: '按词汇评级的估算' },
  { id: 3000, name: '3千', desc: '日常词还在补' },
  { id: 5000, name: '5千', desc: '能读懂大部分帖子' },
  { id: 8000, name: '8千', desc: '读技术文章基本不查词' },
  { id: 12000, name: '1.2万', desc: '只想要更地道、更少见的词' },
] as const
export type VocabLevel = (typeof VOCAB_LEVELS)[number]['id']
export const DEFAULT_VOCAB_LEVEL: VocabLevel = 0
export const isVocabLevel = (v: unknown): v is VocabLevel => VOCAB_LEVELS.some((l) => l.id === v)

/** 来源：hn 表示 Hacker News，r/xxx 表示某个 subreddit */
export const DEFAULT_SOURCES = 'hn, r/cscareerquestions, r/ExperiencedDevs'
export const MAX_SOURCES = 5

export type Source = { kind: 'hn' } | { kind: 'reddit'; sub: string }

/** "hn, r/programming, AskReddit" → 去重后的来源列表；认不出的项忽略 */
export function parseSources(raw: string): Source[] {
  const out: Source[] = []
  const seen = new Set<string>()
  for (const part of raw.split(/[\s,，、]+/)) {
    const p = part.trim().replace(/^\/+/, '')
    if (!p) continue
    let s: Source | null = null
    let key = ''
    if (/^(hn|hackernews|hacker-news)$/i.test(p)) {
      s = { kind: 'hn' }
      key = 'hn'
    } else {
      const m = /^(?:r\/)?([A-Za-z0-9_]{2,21})$/.exec(p)
      if (m) {
        s = { kind: 'reddit', sub: m[1] }
        key = `r/${m[1].toLowerCase()}`
      }
    }
    if (s && !seen.has(key)) {
      seen.add(key)
      out.push(s)
    }
    if (out.length >= MAX_SOURCES) break
  }
  return out
}

export const sourceLabel = (s: Source) => (s.kind === 'hn' ? 'HN' : `r/${s.sub}`)
export const formatSources = (list: Source[]) => list.map((s) => (s.kind === 'hn' ? 'hn' : `r/${s.sub}`)).join(', ')

/** 一个候选词：AI 挑出来、补好释义，等你决定学还是跳过 */
export interface Discovery {
  id: number
  text: string
  meta: CardMeta
  /** 为什么值得学（中文一句话） */
  why: string
  /** 出处：HN / r/xxx */
  source: string
  /** 例句原帖链接 */
  url: string | null
  /** 在这一批帖子里出现在多少条内容中 */
  hits: number
  created_at: number
}

export interface DiscoverReport {
  /** 每个来源读到了多少条内容，或者为什么没读到 */
  sources: { label: string; docs: number; error?: string }[]
  /** 进入 AI 挑选前的候选数 */
  candidates: number
  added: number
}

/** 自动加入时放进这个学习包，方便在词库里筛选、用学习包练习 */
export const DISCOVER_PACKAGE = '社区热词 · HN / Reddit'
