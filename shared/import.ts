import type { CardMeta, ItemType } from './types'

export const IMPORT_FORMAT = 'shiju-import-v1'
/** 单个学习包的卡片上限 */
export const IMPORT_MAX_CARDS = 500

export interface ImportPackage {
  title: string
  source_url?: string
  source_type?: string
  created_at?: string
  card_count?: number
  difficulty_order?: string[]
}

/** 校验、清洗之后的一张卡片 */
export interface ImportCard {
  type: ItemType
  text: string
  meta: CardMeta
  sourceRef: string
  difficulty: number | null
  /** 在文件 cards 数组里的原始下标 */
  index: number
}

export type ImportParse =
  | { ok: true; pkg: ImportPackage; cards: ImportCard[]; invalid: string[] }
  | { ok: false; error: string }

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** 例句里和 term 写法一致的片段（忽略大小写），用于高亮；找不到就不高亮 */
function highlightOf(term: string, example: string) {
  const i = example.toLowerCase().indexOf(term.toLowerCase())
  return i >= 0 ? example.slice(i, i + term.length) : ''
}

/** 解析并校验《导入格式规范 v1》。前端预览和后端入库共用同一份逻辑 */
export function parseImport(raw: unknown): ImportParse {
  const o = raw as { format?: unknown; package?: Record<string, unknown>; cards?: unknown } | null
  if (!o || typeof o !== 'object') return { ok: false, error: '文件内容不是有效的 JSON 对象' }
  if (o.format !== IMPORT_FORMAT) return { ok: false, error: '不支持的导入格式版本' }
  if (!Array.isArray(o.cards)) return { ok: false, error: 'cards 必须是数组' }
  if (o.cards.length > IMPORT_MAX_CARDS) return { ok: false, error: `单个学习包最多 ${IMPORT_MAX_CARDS} 张卡片，请拆分后再导入` }
  const p = o.package
  const title = str(p?.title, 120)
  if (!title) return { ok: false, error: 'package.title 不能为空' }

  const order = Array.isArray(p?.difficulty_order) ? p.difficulty_order.map((x) => str(x, 40)).filter(Boolean).slice(0, 200) : []
  const pkg: ImportPackage = {
    title,
    source_url: str(p?.source_url, 500) || undefined,
    source_type: str(p?.source_type, 30) || undefined,
    created_at: str(p?.created_at, 20) || undefined,
    card_count: typeof p?.card_count === 'number' ? p.card_count : undefined,
    difficulty_order: order.length ? order : undefined,
  }

  const cards: ImportCard[] = []
  const invalid: string[] = []
  o.cards.forEach((c: Record<string, unknown> | null, i) => {
    const term = str(c?.term, 500).replace(/\s+/g, ' ')
    const meaning = str(c?.definition_cn, 1000)
    const example = str(c?.example_en, 1000)
    const exampleZh = str(c?.example_cn, 1000)
    const missing = [!term && 'term', !meaning && 'definition_cn', !example && 'example_en', !exampleZh && 'example_cn'].filter(Boolean)
    if (missing.length) {
      invalid.push(`第 ${i + 1} 张${term ? `「${term}」` : ''}缺少 ${missing.join('、')}`)
      return
    }
    const phrases = (Array.isArray(c?.phrases) ? c.phrases : [])
      .map((x) => str(x, 200))
      .filter(Boolean)
      .slice(0, 5)
      .map((text) => ({ text, meaning: '' }))
    const d = Number(c?.difficulty)
    cards.push({
      type: term.includes(' ') && /[.!?]$/.test(term) ? 'sentence' : 'word',
      text: term,
      meta: {
        ipa: str(c?.phonetic, 100),
        pos: str(c?.pos, 30),
        meaning,
        example,
        exampleZh,
        highlight: highlightOf(term, example),
        phrases,
        memoryTip: str(c?.memory_tip, 500) || undefined,
      },
      sourceRef: str(c?.source_ref, 40),
      difficulty: Number.isInteger(d) && d >= 1 && d <= 5 ? d : null,
      index: i,
    })
  })

  // 有 difficulty_order 时，按章节顺序（再按文件里的原顺序）排好，复习时就是这个先后
  if (pkg.difficulty_order) {
    const rank = (c: ImportCard) => {
      const r = pkg.difficulty_order!.findIndex((k) => k.toLowerCase() === c.sourceRef.toLowerCase())
      return r < 0 ? pkg.difficulty_order!.length : r
    }
    cards.sort((a, b) => rank(a) - rank(b) || a.index - b.index)
  }
  return { ok: true, pkg, cards, invalid }
}
