/* ---------------------------- 练习：共享类型与档位 ---------------------------- */

export type Level = 1 | 2 | 3

export const LEVELS: { id: Level; name: string; short: string; desc: string }[] = [
  {
    id: 1,
    name: '入门 · 填空',
    short: '填空',
    desc: '每句给填空模板，15 词以内；写不出的部分可以用中文括起来，批改时教你怎么说',
  },
  {
    id: 2,
    name: '进阶 · 引导',
    short: '引导',
    desc: '给句子开头和建议句式，25 词以内；中文最多一小处',
  },
  {
    id: 3,
    name: '挑战 · 自由',
    short: '自由',
    desc: '只给任务目标，自己组织；3 句里至少用上 1 个今天的句式，不写中文，批改最严格',
  },
]

export const isLevel = (v: unknown): v is Level => v === 1 || v === 2 || v === 3

/** 给 AI 的档位说明（出题与批改共用） */
export const LEVEL_RULES: Record<Level, { task: string; grade: string }> = {
  1: {
    task: '入门·填空：每个输出任务给一个英文填空模板（用 ___ 表示空），学习者只需填内容；每句不超过 15 个词；用简单词汇。',
    grade:
      '入门档：以鼓励和建立习惯为主。意思清楚、主干结构正确就判通过；允许学习者用中文括号写不会的部分，要在 translations 里给出这些部分的英文说法。只指出真正的错误。',
  },
  2: {
    task: '进阶·引导：每个输出任务给一个英文句子开头（starter，如 "I agree that ..."），并提示建议用今天哪个句式；每句不超过 25 个词。',
    grade:
      '进阶档：语法错误和明显不自然的表达都要指出；中文括号最多允许一处，同样在 translations 里给英文；意思清楚且没有影响理解的语法错误才判通过。',
  },
  3: {
    task: '挑战·自由：输出任务只给中文目标，不给模板或开头；要求 3 句中至少用上 1 个今天的句式。',
    grade:
      '挑战档：严格批改，自然度与地道程度也要评价；不接受中文；语法正确且表达自然才判通过；这一句若应当用上今天的句式却没用，要在 keyPoint 里指出。',
  },
}

export const TASK_GOALS = ['讲清楚', '有观点', '连到自己'] as const

export interface LessonContent {
  title: string
  /** 难度判断：ok 合适 / hard 偏难 / easy 偏简单 */
  fit: 'ok' | 'hard' | 'easy'
  fitNote: string
  summary: string
  words: { word: string; ipa: string; meaning: string; quote: string }[]
  expressions: { pattern: string; meaning: string; example: string }[]
  tasks: { goal: string; prompt: string; template: string }[]
  speaking: { question: string; hint: string }[]
}

export interface GradeResult {
  verdict: 'pass' | 'revise'
  praise: string
  corrections: { original: string; fixed: string; reason: string }[]
  keyPoint: string
  hint: string
  /** 参考版本：通过或改过两次后才下发给前端 */
  reference: string
  translations: { zh: string; en: string }[]
  scores: { content: number; grammar: number; naturalness: number; expression: number }
  remember: { text: string; meaning: string; example: string }
}

export interface Submission {
  id: number
  idx: number
  attempt: number
  text: string
  passed: boolean
  result: GradeResult
  created_at: number
}

export interface Lesson {
  id: number
  created_at: number
  level: Level
  source_url: string | null
  title: string
  content: LessonContent
  submissions: Submission[]
  /** 能不能在应用里读原文 */
  readable: boolean
}

export interface LessonSummary {
  id: number
  created_at: number
  level: Level
  title: string
  passed: number
  submitted: number
}

export interface PracticeStats {
  /** 本月有提交的日期（几号） */
  days: number[]
  checkinDays: number
  /** 本月完成的练习数（3 句都至少提交过一次） */
  completed: number
  submissions: number
  streak: number
  /** 昨天没练、今天也还没练 */
  missedYesterday: boolean
  today: number
  daysInMonth: number
  targets: { days: number; completed: number }
}

export const DEFAULT_COACH_PROFILE = `我是中文母语的英语学习者，目标是能用英文完成工作面试和日常职场交流。
- 词汇：专业词汇还行，口语、日常和职场表达是短板
- 时间：每次练习 15–30 分钟
- 原则：目标是"能说出来"；先读后查；记句子不记单词
- 反馈：讲解用中文，示例和改写用英文；严格但鼓励；简洁，适合手机阅读`

/** 分享卡片上的一句话 */
export interface ShareQuote {
  text: string
  /** 中文释义或补充说明 */
  note?: string
  /** mine 自己写的 / remember 批改里值得记的 / card 新收的卡片 */
  kind: 'mine' | 'remember' | 'card'
}

export interface ShareData {
  stats: PracticeStats
  library: { active: number; done: number }
  quotes: ShareQuote[]
}
