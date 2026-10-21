/* ---------------------------- 闯关：一篇文章拆成几个小关卡，一题一屏 ---------------------------- */

/**
 * AI 为一篇练习出的题库（一次调用出齐，存下来反复用）。
 * 选择题只存正确答案和干扰项，选项顺序由前端每次打乱，答案永远不会“总在第一个”
 */
export interface QuestContent {
  /** 认词：生词 / 句式和它的中文意思，配 3 个似是而非的中文干扰项 */
  words: { en: string; zh: string; distractors: string[] }[]
  /** 听：文章里的短句，听音频选意思、听音频排单词 */
  listening: { en: string; zh: string; distractors: string[]; extra: string[] }[]
  /** 读：原句挖空选词 */
  cloze: { sentence: string; answer: string; distractors: string[]; zh: string }[]
  /** 读：原文片段 + 理解题 */
  reading: { passage: string; questions: { question: string; answer: string; distractors: string[]; explain: string }[] }[]
}

export interface QuestProgress {
  /** 每关的最好成绩：答对率（0–1），没过就没有 */
  stages: Partial<Record<StageId, { accuracy: number; at: number }>>
  xp: number
}

export interface Quest {
  lessonId: number
  title: string
  content: QuestContent
  progress: QuestProgress
}

export const STAGES = [
  { id: 'words', name: '认词', desc: '生词和句式的意思' },
  { id: 'listen', name: '听', desc: '听句子选意思、排单词' },
  { id: 'read', name: '读', desc: '原句填空、读懂原文' },
  { id: 'speak', name: '说', desc: '跟读、开口说（即将推出）' },
  { id: 'write', name: '写', desc: '写三句，AI 逐句批改' },
] as const
export type StageId = (typeof STAGES)[number]['id']
/** 题目在关卡页里做的几关；说还没做，写跳到原来的练习页 */
export const PLAYABLE: StageId[] = ['words', 'listen', 'read']

export const XP_PER_STAGE = 10
export const XP_PERFECT_BONUS = 5

/* ------------------------------ 题型 ------------------------------ */

export type Exercise =
  | { kind: 'match'; pairs: { en: string; zh: string }[] }
  | {
      kind: 'choice'
      /** word：看英文选中文；audio：听音频选中文；cloze：句子挖空选词；reading：读片段答题 */
      prompt: 'word' | 'audio' | 'cloze' | 'reading'
      text: string
      /** 阅读题的原文片段 */
      passage?: string
      options: string[]
      answer: string
      /** 答完显示：翻译或解析 */
      note?: string
      /** 题目里可以点播放的英文 */
      speak?: string
    }
  | { kind: 'order'; audio: string; zh: string; tiles: string[]; answer: string[] }

/** 洗牌：传入随机数函数，测试里可以固定 */
export function shuffle<T>(list: T[], rand = Math.random): T[] {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const options = (answer: string, distractors: string[], rand: () => number) => {
  const seen = new Set([answer.trim().toLowerCase()])
  const rest = distractors.filter((d) => {
    const k = d.trim().toLowerCase()
    if (!k || seen.has(k)) return false
    seen.add(k)
    return true
  })
  return shuffle([answer, ...rest.slice(0, 3)], rand)
}

/** 句子拆成单词块，去掉词尾标点（逗号句号不该提示词的位置），引号括号也去掉 */
export const tokens = (sentence: string) =>
  sentence
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/^["“'(]+|[.,!?;:"”')]+$/g, ''))
    .filter(Boolean)

/** 排序题的答案比较：忽略大小写和句末标点 */
export const sameTokens = (a: string[], b: string[]) => {
  const norm = (l: string[]) => l.map((t) => t.toLowerCase().replace(/[.,!?;:"“”]+$/g, '')).join(' ')
  return norm(a) === norm(b)
}

/** 按关卡把题库组织成一串题目 */
export function buildStage(stage: StageId, c: QuestContent, rand = Math.random): Exercise[] {
  if (stage === 'words') {
    const words = c.words.slice(0, 6)
    const out: Exercise[] = []
    if (words.length >= 3) out.push({ kind: 'match', pairs: shuffle(words, rand).slice(0, 5).map((w) => ({ en: w.en, zh: w.zh })) })
    for (const w of shuffle(words, rand)) {
      out.push({ kind: 'choice', prompt: 'word', text: w.en, options: options(w.zh, w.distractors, rand), answer: w.zh, speak: w.en })
    }
    return out
  }
  if (stage === 'listen') {
    const out: Exercise[] = []
    c.listening.slice(0, 4).forEach((l, i) => {
      // 一半听音选意思，一半听音排单词；短句排单词，长句选意思
      const words = tokens(l.en)
      if (i % 2 === 1 && words.length >= 3 && words.length <= 14) {
        out.push({ kind: 'order', audio: l.en, zh: l.zh, answer: words, tiles: shuffle([...words, ...l.extra.slice(0, 2)], rand) })
      } else {
        out.push({ kind: 'choice', prompt: 'audio', text: l.en, options: options(l.zh, l.distractors, rand), answer: l.zh, note: l.en, speak: l.en })
      }
    })
    return out
  }
  if (stage === 'read') {
    const out: Exercise[] = c.cloze.slice(0, 3).map((q) => ({
      kind: 'choice',
      prompt: 'cloze',
      text: q.sentence,
      options: options(q.answer, q.distractors, rand),
      answer: q.answer,
      note: q.zh,
      speak: q.sentence.replace('____', q.answer),
    }))
    for (const r of c.reading.slice(0, 2)) {
      for (const q of r.questions.slice(0, 2)) {
        out.push({ kind: 'choice', prompt: 'reading', text: q.question, passage: r.passage, options: options(q.answer, q.distractors, rand), answer: q.answer, note: q.explain })
      }
    }
    return out
  }
  return []
}

/** 前一关过了才解锁；「说」还没做，不挡后面的「写」 */
export function unlocked(p: QuestProgress, stage: StageId) {
  if (stage === 'speak') return false
  const order = STAGES.map((s) => s.id).filter((id) => id !== 'speak')
  const i = order.indexOf(stage)
  return i <= 0 || !!p.stages[order[i - 1]]
}
