import type { Env } from './env'

/**
 * 英英释义：只从真实词典取，不让 AI 编。
 * 顺序：Merriam-Webster 学习者词典 → Merriam-Webster 大学词典 → Free Dictionary API（Wiktionary 数据）
 */
export interface DictSense {
  pos: string
  def: string
}

export interface DictResult {
  source: 'mw-learners' | 'mw-collegiate' | 'wiktionary'
  senses: DictSense[]
}

/** 出处名称按 Merriam-Webster 品牌规范使用产品全称 */
export const SOURCE_LABEL: Record<DictResult['source'], string> = {
  'mw-learners': "Merriam-Webster's Learner's Dictionary",
  'mw-collegiate': "Merriam-Webster's Collegiate® Dictionary",
  wiktionary: 'Wiktionary',
}

const MAX_SENSES = 8
const TIMEOUT = 4000

async function getJson(url: string): Promise<unknown> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

const clean = (s: string) =>
  s
    .replace(/\{[^}]*\}/g, '') // MW 排版标记，如 {bc} {it}
    .replace(/\s+/g, ' ')
    .trim()

async function merriamWebster(base: string, ref: 'learners' | 'collegiate', key: string, word: string): Promise<DictSense[]> {
  const data = await getJson(
    `${base}/api/v3/references/${ref}/json/${encodeURIComponent(word)}?key=${encodeURIComponent(key)}`,
  )
  // 查不到时返回的是建议词（字符串数组）
  if (!Array.isArray(data) || !data.length || typeof data[0] === 'string') return []
  const target = word.toLowerCase()
  const senses: DictSense[] = []
  for (const e of data as { meta?: { id?: string; stems?: string[] }; fl?: string; shortdef?: string[] }[]) {
    const id = (e.meta?.id ?? '').split(':')[0].toLowerCase()
    const stems = (e.meta?.stems ?? []).map((s) => s.toLowerCase())
    // 只要这个词本身的词条，排除 "word-for-word" 之类的派生词条
    if (id !== target && !stems.includes(target)) continue
    for (const d of e.shortdef ?? []) {
      const def = clean(d)
      if (def) senses.push({ pos: e.fl ?? '', def })
    }
    if (senses.length >= MAX_SENSES) break
  }
  return senses.slice(0, MAX_SENSES)
}

async function wiktionary(base: string, word: string): Promise<DictSense[]> {
  const data = await getJson(`${base}/api/v2/entries/en/${encodeURIComponent(word)}`)
  if (!Array.isArray(data)) return []
  const senses: DictSense[] = []
  for (const e of data as { meanings?: { partOfSpeech?: string; definitions?: { definition?: string }[] }[] }[]) {
    for (const m of e.meanings ?? []) {
      for (const d of m.definitions ?? []) {
        if (d.definition) senses.push({ pos: m.partOfSpeech ?? '', def: clean(d.definition) })
        if (senses.length >= MAX_SENSES) return senses
      }
    }
  }
  return senses
}

/** 查一个单词或短语；整句不查 */
export async function lookup(env: Env, raw: string): Promise<DictResult | null> {
  const word = raw.trim().replace(/[.!?,;:]+$/, '')
  if (!word || word.split(/\s+/).length > 4) return null
  const mwBase = env.DICT_TEST_BASE || 'https://www.dictionaryapi.com'
  const freeBase = env.DICT_TEST_BASE || 'https://api.dictionaryapi.dev'
  if (env.MW_LEARNERS_KEY) {
    const s = await merriamWebster(mwBase, 'learners', env.MW_LEARNERS_KEY, word)
    if (s.length) return { source: 'mw-learners', senses: s }
  }
  if (env.MW_COLLEGIATE_KEY) {
    const s = await merriamWebster(mwBase, 'collegiate', env.MW_COLLEGIATE_KEY, word)
    if (s.length) return { source: 'mw-collegiate', senses: s }
  }
  const s = await wiktionary(freeBase, word)
  return s.length ? { source: 'wiktionary', senses: s } : null
}
