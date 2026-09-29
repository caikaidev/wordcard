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
}

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
