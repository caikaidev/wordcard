/* ---------------------------- 读原文：先猜后查、线索句、读完理解检查 ---------------------------- */

export interface ReadingWord {
  word: string
  ipa?: string
  meaning: string
  quote: string
}

export interface GuessItem {
  id: string
  word: string
  ipa: string
  meaning: string
  /** 含目标词的原句 */
  sentence: string
  /** 目标词换成 ____ 的原句，线索阶段用这个，不露出词形 */
  masked: string
  clues: string[]
  /** 四个中文义项，含正确答案 */
  options: string[]
}

export interface GuessProgress {
  wrongs: number
  clue: boolean
  revealed: boolean
  /** 揭晓之后才有对错；还没揭晓是 null */
  correct: boolean | null
}

export type GuessAction = { type: 'clue' } | { type: 'answer'; hit: boolean }

export interface ComprehensionQuestion {
  id: string
  kind: '主旨' | '细节' | '指代' | '语气'
  question: string
  options: string[]
  answer: string
  /** 原文依据，答错才展示 */
  evidence: string
}

export interface DecorToken {
  text: string
  lookup?: string
  blankId?: string
  clue?: boolean
  active?: boolean
}

const STOP = new Set(
  `a an the of to in on for and or but with at by from as is are was were be been being it this that these those i you he she we they my your his her our their its not no do does did have has had will would can could should may might if so than then there here what when where who how which into about over after before just also very more most some any all people`.split(
    ' ',
  ),
)

const MEANING_BANK = [
  '因此、所以',
  '然而、但是',
  '非常、极其',
  '开始做某事',
  '结束、完成',
  '一个地点',
  '一种食物',
  '表示同意',
  '表示拒绝',
  '数量很少',
  '立刻、马上',
  '慢慢地',
  '和钱有关',
  '一种天气',
]

const ANTONYMS: Record<string, string> = {
  before: 'after',
  after: 'before',
  always: 'never',
  never: 'always',
  early: 'late',
  late: 'early',
  small: 'large',
  large: 'small',
  fresh: 'stale',
  warm: 'cold',
  cold: 'warm',
  more: 'less',
  less: 'more',
  with: 'without',
  without: 'with',
  good: 'bad',
  bad: 'good',
  first: 'last',
  last: 'first',
  all: 'none',
  none: 'all',
  young: 'old',
  old: 'young',
  high: 'low',
  low: 'high',
  many: 'few',
  few: 'many',
}

const TONES = ['陈述一件事实', '提出疑问', '给出建议或要求', '表达强烈感受'] as const
type Tone = (typeof TONES)[number]

const PRONOUNS = new Set(['she', 'he', 'they', 'them', 'their', 'her', 'his', 'him', 'it', 'this', 'that', 'these', 'those'])
const SKIP_CAP = new Set(
  'The A An She He They It This That These Those Her His Their But And If When After Before Because Then So There Here What How Why Who I We My Our People In On At For To Of From'.split(
    ' ',
  ),
)

export function initialGuess(): GuessProgress {
  return { wrongs: 0, clue: false, revealed: false, correct: null }
}

/** 猜错一次只打开线索，不揭晓；再错一次才揭晓。看线索本身不算出错。 */
export function stepGuess(state: GuessProgress, action: GuessAction): GuessProgress {
  if (state.revealed) return state
  switch (action.type) {
    case 'clue':
      return { ...state, clue: true }
    case 'answer':
      if (action.hit) return { ...state, revealed: true, correct: true, clue: true }
      if (state.wrongs === 0) return { ...state, wrongs: 1, clue: true, correct: false }
      return { ...state, wrongs: state.wrongs + 1, revealed: true, correct: false, clue: true }
    default: {
      const exhaustive: never = action
      return exhaustive
    }
  }
}

export function canRevealAnswer(state: GuessProgress): boolean {
  return state.revealed
}

export function gradeGuess(input: string, item: Pick<GuessItem, 'word' | 'meaning'>): boolean {
  const typed = input.trim()
  if (!typed) return false
  if (normEn(typed) === normEn(item.word)) return true
  const meaning = item.meaning.trim()
  if (!meaning) return false
  const a = compact(typed)
  const b = compact(meaning)
  if (a === b) return true
  return a.length >= 2 && b.includes(a)
}

export function splitSentences(text: string): string[] {
  const out: string[] = []
  for (const para of text.split(/\n+/)) {
    const p = para.trim()
    if (!p) continue
    for (const sentence of p.split(/(?<=[.!?]["”’)]?)\s+(?=["“‘(]?[A-Z0-9])/)) {
      const s = sentence.trim()
      if (s) out.push(s)
    }
  }
  return out
}

export function sameSentence(a: string, b: string): boolean {
  return compact(a) === compact(b)
}

export function buildGuessItems(words: ReadingWord[], source: string, rand = Math.random): GuessItem[] {
  const seen = new Set<string>()
  const located: { word: ReadingWord; sentence: string; at: number }[] = []
  for (const word of words) {
    const key = word.word.trim().toLowerCase()
    if (!key || !word.meaning.trim() || seen.has(key)) continue
    const sentence = locateSentence(source, word.word.trim(), word.quote ?? '')
    if (!sentence) continue
    const masked = maskWord(sentence, word.word.trim())
    if (masked === sentence) continue
    seen.add(key)
    const at = source.toLowerCase().indexOf(key)
    located.push({ word, sentence, at: at < 0 ? Number.MAX_SAFE_INTEGER : at })
  }
  located.sort((a, b) => a.at - b.at)
  return located.slice(0, 5).map((row, i) => {
    const others = located.filter((x) => x !== row).map((x) => x.word.meaning)
    return {
      id: `g${i}`,
      word: row.word.word.trim(),
      ipa: (row.word.ipa ?? '').trim(),
      meaning: row.word.meaning.trim(),
      sentence: row.sentence,
      masked: maskWord(row.sentence, row.word.word.trim()),
      clues: clueWords(row.sentence, row.word.word.trim()),
      options: meaningOptions(row.word.meaning.trim(), others, rand),
    }
  })
}

export function decorateSentence(
  sentence: string,
  items: GuessItem[],
  revealed: ReadonlySet<string>,
  activeId: string | null,
  showClues: boolean,
): DecorToken[] {
  const hidden = items.filter((item) => !revealed.has(item.id) && containsWord(sentence, item.word))
  const hiddenTokens = new Map<string, string>()
  for (const item of hidden) {
    for (const part of item.word.toLowerCase().split(/\s+/)) {
      if (!hiddenTokens.has(part)) hiddenTokens.set(part, item.id)
    }
  }
  const active = items.find((item) => item.id === activeId) ?? null
  const clueOn = showClues && !!active && sameSentence(active.sentence, sentence)
  const clues = new Set(clueOn ? active.clues.map((c) => c.toLowerCase()) : [])
  return sentence.split(/([A-Za-z][A-Za-z'’-]*[A-Za-z]|[A-Za-z])/).map((tok, j) => {
    if (j % 2 === 0) return { text: tok }
    const key = tok.toLowerCase()
    const blankId = hiddenTokens.get(key)
    if (blankId) return { text: '____', blankId, active: blankId === activeId }
    return { text: tok, lookup: tok, clue: clues.has(key) }
  })
}

export function buildComprehension(
  input: { title?: string; summary?: string; text: string; words?: ReadingWord[] },
  rand = Math.random,
): ComprehensionQuestion[] {
  const sentences = splitSentences(input.text)
  if (!sentences.length) return []
  const summary = `${input.summary ?? ''} ${input.title ?? ''}`.trim()
  const main = mainSentence(sentences, summary)
  const details = detailSentences(sentences, input.words ?? []).filter((s) => s !== main)
  const detailPool = (details.length ? details : [sentences.find((s) => s !== main) ?? main]).slice(0, 2)
  const reference = referenceQuestion(sentences, rand)
  const tone = toneQuestion(sentences, rand)
  const questions: ComprehensionQuestion[] = [
    {
      id: 'main',
      kind: '主旨',
      question: '哪一句最接近这篇文章的主旨？',
      options: withOptions(main, [...sentences.filter((s) => s !== main), ...falseSentences(main)], rand),
      answer: main,
      evidence: main,
    },
    ...detailPool.map((sentence, i) => ({
      id: `detail-${i}`,
      kind: '细节' as const,
      question: '下面哪一句和原文一致？',
      options: withOptions(
        sentence,
        falseSentences(sentence).filter((candidate) => !sentences.some((original) => sameSentence(original, candidate))),
        rand,
      ),
      answer: sentence,
      evidence: sentence,
    })),
  ]
  if (reference) questions.push(reference)
  questions.push(tone)
  return questions.slice(0, 5)
}

export function feedbackFor(question: ComprehensionQuestion, picked: string): { correct: boolean; evidence: string | null } {
  const correct = picked.trim() === question.answer.trim()
  return { correct, evidence: correct ? null : question.evidence }
}

export function parseReadingScore(raw: unknown): { correct: number; total: number } | null {
  let value = raw
  if (typeof raw === 'string') {
    const text = raw.trim()
    if (!text) return null
    try {
      value = JSON.parse(text) as unknown
    } catch {
      return null
    }
  }
  if (!value || typeof value !== 'object') return null
  const correct = (value as { correct?: unknown }).correct
  const total = (value as { total?: unknown }).total
  if (typeof correct !== 'number' || typeof total !== 'number') return null
  if (!Number.isInteger(correct) || !Number.isInteger(total)) return null
  if (total < 1 || total > 5 || correct < 0 || correct > total) return null
  return { correct, total }
}

export function formatReadingScore(score: { correct: number; total: number } | null | undefined): string {
  if (!score || score.total <= 0) return '阅读未检查'
  return `阅读 ${score.correct}/${score.total}`
}

export function formatWritingScore(passed: number, total = 3): string {
  return `写作 ${passed}/${total}`
}

export function splitScoreLabels(
  reading: { correct: number; total: number } | null,
  writingPassed: number,
): { reading: string; writing: string } {
  return { reading: formatReadingScore(reading), writing: formatWritingScore(writingPassed) }
}

function locateSentence(text: string, word: string, quote: string): string {
  const sentences = splitSentences(text)
  const q = quote.trim()
  if (q) {
    const byQuote = sentences.find((s) => sameSentence(s, q) || compact(s).includes(compact(q)) || compact(q).includes(compact(s)))
    if (byQuote && containsWord(byQuote, word)) return byQuote
  }
  return sentences.find((s) => containsWord(s, word)) ?? (q && containsWord(q, word) ? q : '')
}

function containsWord(text: string, word: string): boolean {
  const w = word.trim()
  if (!w) return false
  return new RegExp(`(?:^|[^A-Za-z])${escapeReg(w)}(?:[^A-Za-z]|$)`, 'i').test(text)
}

function maskWord(sentence: string, word: string): string {
  const re = new RegExp(`(^|[^A-Za-z])(${escapeReg(word.trim())})(?=[^A-Za-z]|$)`, 'gi')
  return sentence.replace(re, '$1____')
}

function clueWords(sentence: string, word: string): string[] {
  const target = new Set(word.toLowerCase().split(/\s+/))
  const parts = sentence.split(/\s+/)
  const start = parts.findIndex((_, i) => containsWord(parts.slice(i, i + target.size).join(' '), word))
  const content = parts
    .map((raw, i) => ({ raw: cleanToken(raw), i }))
    .filter((x) => x.raw.length >= 4 && !STOP.has(x.raw.toLowerCase()) && !target.has(x.raw.toLowerCase()))
  const anchor = start < 0 ? 0 : start
  const ranked = [...content].sort((a, b) => Math.abs(a.i - anchor) - Math.abs(b.i - anchor) || a.i - b.i)
  return ranked
    .slice(0, 3)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.raw)
}

function meaningOptions(meaning: string, others: string[], rand: () => number): string[] {
  const seen = new Set([compact(meaning)])
  const pool: string[] = []
  for (const candidate of [...others, ...MEANING_BANK]) {
    const text = candidate.trim()
    const key = compact(text)
    if (!key || seen.has(key) || key.includes(compact(meaning)) || compact(meaning).includes(key)) continue
    seen.add(key)
    pool.push(text)
    if (pool.length === 3) break
  }
  let n = 1
  while (pool.length < 3) {
    const filler = `和这个词无关（${n}）`
    n += 1
    if (seen.has(compact(filler))) continue
    seen.add(compact(filler))
    pool.push(filler)
  }
  return shuffle([meaning, ...pool], rand)
}

function mainSentence(sentences: string[], summary: string): string {
  const target = summary.toLowerCase()
  let best = sentences[0]
  let bestScore = -1
  for (const sentence of sentences) {
    const words = contentWords(sentence)
    const score = target ? words.filter((w) => target.includes(w.toLowerCase())).length : words.length
    if (score > bestScore) {
      best = sentence
      bestScore = score
    }
  }
  return best
}

function detailSentences(sentences: string[], words: ReadingWord[]): string[] {
  const picked: string[] = []
  for (const word of words) {
    const quote = word.quote?.trim()
    if (!quote) continue
    const hit = sentences.find((s) => compact(s).includes(compact(quote)) || compact(quote).includes(compact(s)))
    if (hit && !picked.includes(hit)) picked.push(hit)
  }
  const rest = [...sentences].sort((a, b) => b.length - a.length)
  for (const sentence of rest) {
    if (picked.length >= 2) break
    if (sentence.split(/\s+/).length >= 4 && !picked.includes(sentence)) picked.push(sentence)
  }
  return picked.slice(0, 2)
}

function referenceQuestion(sentences: string[], rand: () => number): ComprehensionQuestion | null {
  for (let i = 0; i < sentences.length; i++) {
    const found = firstPronoun(sentences[i])
    if (!found) continue
    const answer = antecedent(sentences, i, found.index, found.pronoun)
    if (!answer) continue
    const pool = mentionPool(sentences).filter((x) => x.toLowerCase() !== answer.toLowerCase())
    const evidence = i > 0 ? `${sentences[i - 1]}\n${sentences[i]}` : sentences[i]
    return {
      id: 'ref',
      kind: '指代',
      question: `“${sentences[i]}”里的 “${found.pronoun}” 最可能指什么？`,
      options: withOptions(answer, [...pool, 'someone else', 'an object not mentioned', 'the reader'], rand),
      answer,
      evidence,
    }
  }
  return null
}

function toneQuestion(sentences: string[], rand: () => number): ComprehensionQuestion {
  const picked = sentences.find((s) => toneOf(s) !== '陈述一件事实') ?? sentences[sentences.length - 1]
  const answer = toneOf(picked)
  return {
    id: 'tone',
    kind: '语气',
    question: `“${picked}” 的语气更接近哪一种？`,
    options: shuffle([...TONES], rand),
    answer,
    evidence: picked,
  }
}

function toneOf(sentence: string): Tone {
  if (sentence.includes('?')) return '提出疑问'
  if (/\b(should|must|need to|have to|ought to)\b/i.test(sentence)) return '给出建议或要求'
  if (sentence.includes('!') || /\b(unfortunately|sadly|amazing|terrible|wonderful|awful|angry|glad)\b/i.test(sentence)) return '表达强烈感受'
  return '陈述一件事实'
}

function antecedent(sentences: string[], index: number, pronounAt: number, pronoun: string): string | null {
  const current = tokensOf(sentences[index])
  const before = current.slice(0, pronounAt)
  const previous = sentences.slice(0, index).flatMap(tokensOf)
  const kind = pronoun.toLowerCase()
  if (['she', 'he', 'her', 'his', 'him'].includes(kind)) {
    return lastName(before) ?? lastName(previous)
  }
  if (['they', 'them', 'their'].includes(kind)) {
    return lastWhere(before, (w) => /s$/.test(w) && !STOP.has(w)) ?? lastWhere(previous, (w) => /people|neighbors|friends/.test(w)) ?? lastName(previous)
  }
  return lastNoun(before) ?? lastNoun(previous)
}

function firstPronoun(sentence: string): { pronoun: string; index: number } | null {
  const tokens = sentence.split(/\s+/)
  for (let i = 0; i < tokens.length; i++) {
    const clean = cleanToken(tokens[i])
    if (PRONOUNS.has(clean.toLowerCase())) return { pronoun: clean, index: i }
  }
  return null
}

function tokensOf(sentence: string): string[] {
  return sentence.split(/\s+/).map(cleanToken).filter(Boolean)
}

function lastName(tokens: string[]): string | null {
  for (let i = tokens.length - 1; i >= 0; i--) {
    const w = tokens[i]
    if (/^[A-Z][a-z]+$/.test(w) && !SKIP_CAP.has(w)) return w
  }
  return null
}

function lastNoun(tokens: string[]): string | null {
  return lastWhere(tokens, (w) => w.length >= 4 && !STOP.has(w.toLowerCase()) && !PRONOUNS.has(w.toLowerCase()) && !SKIP_CAP.has(w))
}

function lastWhere(tokens: string[], ok: (w: string) => boolean): string | null {
  for (let i = tokens.length - 1; i >= 0; i--) if (ok(tokens[i])) return tokens[i]
  return null
}

function mentionPool(sentences: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const sentence of sentences) {
    for (const token of tokensOf(sentence)) {
      const key = token.toLowerCase()
      if (seen.has(key) || STOP.has(key) || PRONOUNS.has(key) || SKIP_CAP.has(token) || token.length < 3) continue
      if (!/^[A-Za-z][a-z]+$/.test(token)) continue
      seen.add(key)
      out.push(token)
    }
  }
  return out
}

function falseSentences(sentence: string): string[] {
  const out: string[] = []
  const swapped = swapAntonym(sentence)
  if (swapped) out.push(swapped)
  const negated = negate(sentence)
  if (negated && !out.includes(negated)) out.push(negated)
  out.push(`${sentence.replace(/[.?!]+$/, '')} on the moon.`)
  out.push('None of this appears in the passage.')
  return out
}

function swapAntonym(sentence: string): string | null {
  const match = sentence.match(/\b[A-Za-z]+\b/)
  if (!match) return null
  let replaced = false
  const next = sentence.replace(/\b[A-Za-z]+\b/g, (word) => {
    if (replaced) return word
    const mapped = ANTONYMS[word.toLowerCase()]
    if (!mapped) return word
    replaced = true
    return word[0] === word[0].toUpperCase() ? mapped[0].toUpperCase() + mapped.slice(1) : mapped
  })
  return replaced ? next : null
}

function negate(sentence: string): string | null {
  if (/\b(not|never)\b/i.test(sentence)) return null
  const next = sentence.replace(/\b(is|are|was|were|can|could|should|will|would)\b/i, (m) => `${m} not`)
  return next === sentence ? null : next
}

function withOptions(answer: string, distractors: string[], rand: () => number): string[] {
  const seen = new Set([compact(answer)])
  const rest: string[] = []
  for (const raw of distractors) {
    const text = raw.trim()
    const key = compact(text)
    if (!key || seen.has(key)) continue
    seen.add(key)
    rest.push(text)
    if (rest.length === 3) break
  }
  let n = 1
  while (rest.length < 3) {
    const filler = `This is not what the passage says (${n}).`
    n += 1
    if (seen.has(compact(filler))) continue
    seen.add(compact(filler))
    rest.push(filler)
  }
  return shuffle([answer, ...rest.slice(0, 3)], rand)
}

function contentWords(sentence: string): string[] {
  return tokensOf(sentence).filter((w) => w.length >= 3 && !STOP.has(w.toLowerCase()))
}

function shuffle<T>(list: T[], rand: () => number): T[] {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const tmp = a[i]
    a[i] = a[j]
    a[j] = tmp
  }
  return a
}

function compact(s: string): string {
  return s.replace(/\s+/g, '').trim().toLowerCase()
}

function normEn(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9'\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanToken(raw: string): string {
  return raw.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '')
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
