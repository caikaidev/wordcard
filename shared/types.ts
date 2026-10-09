export type ItemType = 'word' | 'sentence'
export type ItemStatus = 'active' | 'done'

/** AI 补全出来、也可以手动修改的卡片内容 */
export interface CardMeta {
  /** 音标，句子为空 */
  ipa: string
  /** 词性，如 n. / adj.；句子为空 */
  pos: string
  /** 中文释义；句子则是整句翻译 */
  meaning: string
  /** 例句（英文）。句子条目可以为空 */
  example: string
  /** 例句中文翻译 */
  exampleZh: string
  /** 例句里要高亮的原文片段（与例句中的写法完全一致） */
  highlight: string
  /** 常见搭配 / 句子里的重点短语 */
  phrases: { text: string; meaning: string }[]
  /** 英英释义：词典原文（不是 AI 写的），没有就留空 */
  definitionEn?: string
  /** 英英释义出处，如 Merriam-Webster */
  definitionSrc?: string
  /** 产出练习：看中文情境，说出空里的表达（与原例句不同的新情境） */
  cloze?: Cloze
  /** 记忆钩子（谐音 / 拆词 / 画面），来自导入的学习包 */
  memoryTip?: string
}

export interface Cloze {
  /** 中文情境 + 想表达的意思 */
  scene: string
  /** 英文句子，目标表达处为 ____ */
  sentence: string
  /** 被挖掉的原文 */
  answer: string
}

export const BLANK = '____'

/** 产出练习题：优先用 AI 生成的新情境；老卡片退回用原例句挖空 */
export function clozeOf(item: { type: ItemType; meta: CardMeta }): Cloze | null {
  const c = item.meta.cloze
  if (c && c.answer && c.sentence.includes(BLANK)) return c
  const m = item.meta
  if (m.example && m.highlight && m.example.includes(m.highlight)) {
    return { scene: m.exampleZh || m.meaning, sentence: m.example.replace(m.highlight, BLANK), answer: m.highlight }
  }
  return null
}

/** 语境复习：永远用原文例句挖空（不用 AI 编的新情境），在原来的语境里回想这个词 */
export function contextClozeOf(item: { meta: CardMeta }): Cloze | null {
  const m = item.meta
  if (!m.example || !m.highlight || !m.example.includes(m.highlight)) return null
  return { scene: m.exampleZh || m.meaning, sentence: m.example.replace(m.highlight, BLANK), answer: m.highlight }
}

export type ReviewMode = 'mixed' | 'recognition' | 'production' | 'context'

export interface Item {
  id: number
  type: ItemType
  text: string
  meta: CardMeta
  status: ItemStatus
  interval: number
  due_at: number
  reps: number
  lapses: number
  created_at: number
  updated_at: number
  /** 所属学习包；手动添加的卡片为 null */
  package_id?: number | null
  /** 学习包名（列表 / 复习接口附带） */
  package_title?: string | null
  /** 在原文中的出处，如 Ch2 */
  source_ref?: string | null
  difficulty?: number | null
}

/** 学习包概览 */
export interface PackageInfo {
  id: number
  title: string
  source_url: string | null
  source_type: string | null
  total: number
  done: number
  created_at: number
}

export interface EnrichResult {
  type: ItemType
  text: string
  meta: CardMeta
}

export interface RemixSentence {
  en: string
  zh: string
  /** 句子里用到的目标词，写法与 en 中完全一致，用于高亮 */
  highlights: string[]
}

export interface RemixResult {
  words: { id: number; text: string }[]
  sentences: RemixSentence[]
}

/** 0 = 忘了，1 = 模糊，2 = 记得 */
export type Grade = 0 | 1 | 2

/** 每周回顾（周一到周日，按北京时间） */
export interface WeeklyReport {
  /** 0 = 本周，-1 = 上周 … */
  offset: number
  /** 本周一 00:00（毫秒时间戳）和下周一 00:00 */
  start: number
  end: number
  /** 今天是本周的第几天（0–6）；不是本周时为 -1 */
  todayIdx: number
  /** 周一到周日每天的复习次数 */
  perDay: number[]
  added: number
  /** 其中来自导入学习包的 */
  addedImported: number
  reviews: number
  remembered: number
  forgot: number
  mastered: number
  practiceDays: number
  practiceSubmissions: number
  /** 本周最常忘记的词 */
  trouble: { text: string; n: number }[]
  prev: { added: number; reviews: number; mastered: number }
  /** 复习流水最早的记录时间；null 表示还没有记录 */
  logSince: number | null
}
