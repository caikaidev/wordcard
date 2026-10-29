import type { RemixSentence } from './types'

/** 和 api 超时、页面上的等待说明用同一个数 */
export const REMIX_TIMEOUT_SEC = 40
export const REMIX_MIN_SENTENCES = 3
export const REMIX_MAX_SENTENCES = 5
/** 不连贯时最多写两次；两次加起来仍要落在页面超时里面 */
export const REMIX_ATTEMPTS = 2
export const REMIX_ATTEMPT_MS = 16_000

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

请把它们写进同一段语义连贯的英文短文，讲同一场景里的同一件事。不要写三句互不相关的例句，也不要把每个词各写成一句独立例句再拼在一起。
- 一共 3 到 5 句，按时间或因果往下推进
- 第 1 句只交代一个人物和一件事。从第 2 句起，必须接着这件事发生：用 he/she/they/this/that，或 then/so/because/after，或重复前面已经出现的人名、地点、物件
- 禁止每句换一个新话题、新人物或新地点
- 整段大约 70 到 130 个英文词，每句不超过 28 个词
- 合起来覆盖全部目标词；每句至少用到 1 个。可以对单词做合理的词形变化
- 自然、地道，难度大约 CEFR B1 到 B2
- zh：这一句的自然中文
- highlights：这一句里用到的目标词或表达，写法必须与 en 中完全一致

按短文顺序返回 JSON 数组。`
}

/** 上一稿被判定为零散句时，带着原稿要求重写，而不是再要一组例句。 */
export function remixRetryPrompt(words: { text: string; meaning: string }[], previous: { en: string }[]): string {
  const draft = previous.map((s) => s.en.trim()).filter(Boolean).join(' ')
  const rejected = draft ? `上一稿被拒绝，因为这几句没有接成同一件事：\n${draft}\n` : '上一稿没有写成合格短文。\n'
  return `${remixPrompt(words)}

${rejected}请整段重写，不要沿用互不相关的例句。
第 1 句只定一个人物和一件事。后面每一句都接着这件事往下发生。`
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

const STOP = new Set([
  'that', 'this', 'with', 'from', 'have', 'were', 'they', 'them', 'their', 'there', 'then', 'when', 'what', 'your',
  'about', 'into', 'over', 'after', 'before', 'would', 'could', 'should', 'just', 'than', 'also', 'more', 'most',
  'very', 'some', 'only', 'even', 'back', 'been', 'being', 'does', 'did', 'will', 'such', 'much', 'many', 'well',
  'here', 'where', 'which', 'while', 'those', 'these', 'other', 'still', 'through', 'during', 'without', 'again',
  'around', 'another', 'because', 'although', 'however', 'something', 'someone', 'really', 'already', 'always',
  'never', 'today', 'time', 'work', 'good', 'make', 'made', 'take', 'took', 'like', 'said', 'says', 'went', 'came',
  'know', 'knew', 'want', 'need', 'look', 'looked', 'people', 'thing', 'things',
])

/** 句首虚词，不当成重复出现的人名 */
const STARTERS = new Set([
  'the', 'a', 'an', 'when', 'after', 'before', 'then', 'she', 'he', 'they', 'it', 'his', 'her', 'their', 'this',
  'that', 'by', 'and', 'but', 'so', 'in', 'on', 'at', 'for', 'to', 'of', 'if', 'as', 'once', 'while', 'because',
  'although', 'however', 'later', 'soon', 'next', 'still', 'there', 'meanwhile', 'finally', 'eventually',
  'instead', 'also', 'now', 'we', 'you', 'i',
])

const PRONOUN_START = /^(he|she|they|it|we|his|her|their|its|this|that|these|those|him|them)\b/i
const CONNECTIVE_START =
  /^(then|so|but|and|after|later|when|meanwhile|however|still|soon|next|there|because|although|while|before|once|finally|eventually|instead|also|now|by|the same|that night|that morning|that evening|the next|afterwards|afterward)\b/i

function storyWords(sentence: string): Set<string> {
  const out = new Set<string>()
  const tokens = sentence.match(/\b[A-Za-z]+(?:'[A-Za-z]+)?\b/g) ?? []
  tokens.forEach((tok, i) => {
    const lower = tok.toLowerCase()
    if (/^[A-Z]/.test(tok) && tok.length >= 3 && tok !== tok.toUpperCase() && !(i === 0 && STARTERS.has(lower))) out.add(lower)
    if (lower.length >= 4 && !STOP.has(lower)) out.add(lower)
  })
  return out
}

/**
 * 零散例句：前后句既不共用人物/物件，下一句也不用人称或承接词开口。
 * 允许有一句只换镜头；但至少要有一处人称或重复名词，光靠 Then/And 接不上。
 */
export function remixCoherent(sentences: { en: string }[]): boolean {
  if (!remixReady(sentences)) return false
  const bags = sentences.map((s) => storyWords(s.en))
  let links = 0
  let strong = 0
  for (let i = 1; i < sentences.length; i++) {
    const next = sentences[i].en.trim()
    const pronoun = PRONOUN_START.test(next)
    const connective = CONNECTIVE_START.test(next)
    let shared = false
    for (let j = 0; j < i && !shared; j++) {
      for (const word of bags[i]) if (bags[j].has(word)) shared = true
    }
    if (pronoun || connective || shared) links++
    if (pronoun || shared) strong++
  }
  const need = Math.max(1, sentences.length - 2)
  return links >= need && strong >= 1
}

/** 能展示就返回 null；否则是给用户看的失败原因 */
export function remixFailure(sentences: { en: string }[]): string | null {
  if (remixCoherent(sentences)) return null
  if (!remixReady(sentences)) return '这次没有连成一段短文，请再试一次'
  return '这几句还是各说各的，没有连成同一段短文。请再试一次'
}
