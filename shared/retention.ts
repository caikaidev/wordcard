/** 兴趣与留存：冷启动、阅读时长、点词该不该划线、读完摘要。不含短文正文。 */

/** 推送和主屏幕「复习」快捷方式。带这个标记的 `/` 是复习，不是冷启动。 */
export const reviewEntry = '/?review=1'

/**
 * 冷启动只改裸 `/`（一次新的打开、没有 query、没有 hash）。
 * `/?review=1` 以及任何需要留住的 query/hash 都停在原地址。
 */
export function coldStartPath(pathname: string, navType: string, search = '', hash = ''): '/practice' | null {
  if (pathname === '/' && navType === 'navigate' && search === '' && hash === '') return '/practice'
  return null
}

/** 学习者读短文大约每分钟 90 词，界面上至少写 1 分钟。 */
export function readingMinutes(words: number): number {
  if (!Number.isFinite(words) || words <= 0) return 1
  return Math.max(1, Math.round(words / 90))
}

/** 读完底栏至少两项：+1 篇、读了 N 词；查了几次有数才加上。 */
export function completionLines(words: number, lookups: number | null): string[] {
  const lines = ['+1 篇', `读了 ${Math.max(0, Math.round(words) || 0)} 词`]
  if (lookups != null) lines.push(`查了 ${Math.max(0, Math.round(lookups) || 0)} 词`)
  return lines
}

const WORD_SRC = "[A-Za-z]+(?:['’-][A-Za-z]+)*"

export function eachWord(text: string): string[] {
  return [...text.matchAll(new RegExp(WORD_SRC, 'g'))].map((m) => m[0])
}

/** 词频表用小写；所有格先剥掉，避免 month's 被当成生词。 */
export function rankKey(surface: string): string {
  return surface.toLowerCase().replace(/[’']/g, "'").replace(/'s$/, '')
}

/** 短文里的人名不按生词划线。 */
const NAMES = new Set(['mary', 'chen', 'maya', 'jo', 'alex', 'nora', 'priya', 'lena', 'mateo', 'jordan', 'naomi', 'iris', 'evan'])

/**
 * 超当前词汇档：词频排名大于这一档（3千/5千/8千/1.2万）。
 * 词表里没有、又够长的词当作超档；一两个字母的功能词不算。
 * 连字符词（follow-up）按每一截判断，常见词拼起来的不算生词。
 */
export function beyondBand(surface: string, rankOf: (word: string) => number | undefined, band: number): boolean {
  const key = rankKey(surface)
  if (key.length <= 2) return false
  if (NAMES.has(key)) return false
  const parts = key.split('-').filter((part) => part.length > 0)
  if (parts.length > 1) return parts.some((part) => beyondBand(part, rankOf, band))
  const rank = rankOf(key)
  if (rank == null) return key.length >= 8
  return rank > band
}

/** 标出超档词，并带上调用方准备好的语境义。 */
export function passageReadingAids<T extends { zh: string }>(
  text: string,
  band: number,
  rankOf: (word: string) => number | undefined,
  glossFor: (word: string) => T | undefined,
): { marks: string[]; gloss: Record<string, T> } {
  const marks = markedWords(text, band, rankOf)
  const gloss: Record<string, T> = {}
  const put = (key: string) => {
    if (gloss[key]) return
    const g = glossFor(key)
    if (g) gloss[key] = g
  }
  for (const key of marks) put(key)
  for (const surface of eachWord(text)) put(surface.toLowerCase())
  return { marks, gloss }
}

export function markedWords(text: string, band: number, rankOf: (word: string) => number | undefined): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const surface of eachWord(text)) {
    const key = surface.toLowerCase()
    if (seen.has(key)) continue
    if (!beyondBand(surface, rankOf, band)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

const hintTokens = (s: string) => s.toLowerCase().match(/[a-z]{3,}/g) ?? []

/** 词典义项里和语境提示重合最多的一条。对不上就不高亮，避免点错义。 */
export function matchingSenseIndex(senses: { def: string }[], hint: string): number {
  if (senses.length === 1) return 0
  const want = hintTokens(hint)
  if (!want.length) return -1
  let best = -1
  let score = 0
  senses.forEach((sense, i) => {
    const have = new Set(hintTokens(sense.def))
    let n = 0
    for (const t of want) if (have.has(t)) n++
    if (n > score) {
      score = n
      best = i
    }
  })
  return score > 0 ? best : -1
}
