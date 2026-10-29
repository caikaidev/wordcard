import type { RemixSentence } from './types'

/** 和 api 超时、页面上的等待说明用同一个数 */
export const REMIX_TIMEOUT_SEC = 40
export const REMIX_MIN_SENTENCES = 3
export const REMIX_MAX_SENTENCES = 5

export function headword(text: string): string {
  const m = text.trim().toLowerCase().match(/[a-z]+(?:'[a-z]+)?/)
  return m?.[0] ?? ''
}

/** 排名小于等于这条线的单词，对当前词汇量来说过浅，不拿来重组。 */
export function shallowRankFloor(vocab: number): number {
  if (vocab <= 3000) return 800
  return Math.round(vocab * 0.4)
}

export function isShallowRank(rank: number | undefined, vocab: number): boolean {
  if (!rank || !Number.isFinite(rank)) return false
  return rank <= shallowRankFloor(vocab)
}

/**
 * 短语留着；单词若明显浅于当前词汇量就放下。
 * 放下之后不够 3 个（或不够原列表那么多）时，按更难的词补回，避免无词可写。
 */
export function selectRemixTargets<T extends { text: string }>(
  items: T[],
  rankOf: (word: string) => number | undefined,
  vocab: number,
): { kept: T[]; dropped: string[] } {
  const shallow = (item: T) => {
    if (item.text.trim().split(/\s+/).length >= 2) return false
    return isShallowRank(rankOf(headword(item.text)), vocab)
  }
  const droppedItems = items.filter(shallow)
  const kept = items.filter((item) => !shallow(item))
  const need = Math.min(3, items.length)
  if (kept.length < need) {
    const refill = [...droppedItems].sort((a, b) => (rankOf(headword(b.text)) ?? 0) - (rankOf(headword(a.text)) ?? 0))
    for (const item of refill) {
      if (kept.length >= need) break
      kept.push(item)
    }
  }
  const keptSet = new Set(kept)
  return { kept, dropped: droppedItems.filter((item) => !keptSet.has(item)).map((item) => item.text) }
}

export function remixPrompt(words: { text: string; meaning: string }[]): string {
  const list = words.map((w, i) => `${i + 1}. ${w.text}（${w.meaning || '见词库'}）`).join('\n')
  return `你在帮一个中国英语学习者复习。下面是今天要复习的词或表达，过浅的基础词已经去掉：
${list}

请把它们写进同一段连贯的英文短文，不要写三句互不相关的例句。
- 一共 3 到 5 句，按顺序连成一段，讲同一件小事
- 后一句要承接前一句的人物、地点或动作，用代词、时间或因果接上
- 整段大约 80 到 140 个英文词，每句不超过 30 个词
- 合起来覆盖全部目标词；每句至少用到 1 个。可以对单词做合理的词形变化
- 自然、地道，难度大约 CEFR B1 到 B2
- zh：这一句的自然中文
- highlights：这一句里用到的目标词或表达，写法必须与 en 中完全一致

按短文顺序返回 JSON 数组。`
}

export function normalizeRemixSentences(raw: { en?: string; zh?: string; highlights?: unknown }[]): RemixSentence[] {
  return (Array.isArray(raw) ? raw : [])
    .map((s) => {
      const en = (s.en ?? '').trim()
      const highlights = Array.isArray(s.highlights) ? s.highlights.filter((h): h is string => typeof h === 'string' && !!h && en.includes(h)) : []
      return { en, zh: (s.zh ?? '').trim(), highlights }
    })
    .filter((s) => s.en)
    .slice(0, REMIX_MAX_SENTENCES)
}

export function remixPassageText(sentences: { en: string }[]): string {
  return sentences
    .map((s) => s.en.trim())
    .filter(Boolean)
    .join(' ')
}

/** 3–5 句、每句有内容，才能当成一段短文而不是残句 */
export function remixReady(sentences: { en: string }[]): boolean {
  if (sentences.length < REMIX_MIN_SENTENCES || sentences.length > REMIX_MAX_SENTENCES) return false
  return sentences.every((s) => s.en.trim().split(/\s+/).length >= 4)
}
