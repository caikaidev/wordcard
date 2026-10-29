/* ---------------------------- 练习：共享类型与档位 ---------------------------- */

import type { StreakStatus } from './streak'
import type { QuestProgress } from './quest'

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
  /** 读完理解检查的成绩；还没做就是 null。和写作通过句数分开记 */
  reading: { correct: number; total: number } | null
}

export interface LessonSummary {
  id: number
  created_at: number
  level: Level
  title: string
  passed: number
  submitted: number
  /** 闯关进度；还没进过闯关就是 null */
  quest: { progress: QuestProgress; updated_at: number } | null
  /** 阅读理解成绩，和写作的 passed 分开 */
  reading: { correct: number; total: number } | null
}

export interface PracticeStats {
  /** 本月有提交的日期（几号） */
  days: number[]
  checkinDays: number
  /** 本月完成的练习数（3 句都至少提交过一次） */
  completed: number
  submissions: number
  streak: number
  /** 本月用掉保护卡的日期（几号） */
  frozen: number[]
  /** 今日目标、保护卡、下一个里程碑等 */
  detail: StreakStatus
  /** 昨天没练、今天也还没练 */
  missedYesterday: boolean
  today: number
  daysInMonth: number
  targets: { days: number; completed: number }
}

/** 第一波之前的出厂设定。只有一字不差的旧默认才换成入门日常阅读，改过的文本不动。 */
export const LEGACY_INTERVIEW_COACH_PROFILE = `我是中文母语的英语学习者，目标是能用英文完成工作面试和日常职场交流。
- 词汇：专业词汇还行，口语、日常和职场表达是短板
- 时间：每次练习 15–30 分钟
- 原则：目标是"能说出来"；先读后查；记句子不记单词
- 反馈：讲解用中文，示例和改写用英文；严格但鼓励；简洁，适合手机阅读`

export const DEFAULT_COACH_PROFILE = `我是中文母语的英语学习者，当前阅读目标是入门日常阅读。
- 词汇：先读懂日常短文里的常用词，再慢慢积累
- 时间：每次练习 15–30 分钟
- 原则：先猜后查；记句子不记单词；读懂比背下来更重要
- 反馈：讲解用中文，示例和改写用英文；鼓励为主；简洁，适合手机阅读`

/** 空值和旧出厂设定都视为当前默认；自定义文本原样保留。 */
export function resolveCoachProfile(stored: unknown): string {
  if (typeof stored !== 'string') return DEFAULT_COACH_PROFILE
  const text = stored.trim()
  if (!text || text === LEGACY_INTERVIEW_COACH_PROFILE.trim()) return DEFAULT_COACH_PROFILE
  return text
}

/** 默认目标，或写明了「入门日常阅读」且没有把面试当成目标。 */
export function isDailyReadingGoal(profile: string): boolean {
  const text = resolveCoachProfile(profile).trim()
  if (text === DEFAULT_COACH_PROFILE.trim()) return true
  if (/面试/.test(text)) return false
  return /入门日常阅读/.test(text)
}

const INTERVIEW_REPLACEMENTS: [RegExp, string][] = [
  [/用于面试回答/g, '用于日常交流'],
  [/模拟面试官/g, '朋友'],
  [/面试官/g, '朋友'],
  [/工作面试/g, '日常交流'],
  [/求职面试/g, '日常交流'],
  [/面试回答/g, '日常说法'],
  [/在面试中/g, '在日常对话中'],
  [/在面试时/g, '在日常对话时'],
  [/for an interview/gi, 'in daily life'],
  [/in an interview/gi, 'in daily life'],
  [/interview answers?/gi, 'everyday phrasing'],
  [/interviewers?/gi, 'a friend'],
]

/** 去掉输出任务里的面试模板措辞，保留文章话题里单独出现的「面试」。 */
export function stripInterviewCopy(text: string): string {
  let out = text
  for (const [re, rep] of INTERVIEW_REPLACEMENTS) out = out.replace(re, rep)
  return out.replace(/(?:日常交流){2,}/g, '日常交流').replace(/(?:朋友){2,}/g, '朋友').replace(/(?:a friend){2,}/gi, 'a friend')
}

/** 默认阅读目标下，出题结果里的任务、口语和句式不再带面试模板。 */
export function applyDailyReadingVoice(content: LessonContent, profile: string): LessonContent {
  if (!isDailyReadingGoal(profile)) return content
  const clean = (s: string) => stripInterviewCopy(s)
  return {
    ...content,
    tasks: content.tasks.map((t) => ({ ...t, prompt: clean(t.prompt), template: clean(t.template) })),
    speaking: content.speaking.map((q) => ({ question: clean(q.question), hint: clean(q.hint) })),
    expressions: content.expressions.map((e) => ({
      ...e,
      pattern: clean(e.pattern),
      meaning: clean(e.meaning),
      example: clean(e.example),
    })),
  }
}

export function coachExampleHint(profile: string): string {
  return isDailyReadingGoal(profile) ? '一个贴近日常生活的 example' : '一个贴近学习者自身经历的 example'
}

function sceneBlock(profile: string): string {
  if (!isDailyReadingGoal(profile)) {
    return '目标场景以学习者设定为准。设定里没写的场景不要自行添加，尤其不要默认写成求职或职场问答。'
  }
  return `当前阅读目标是「入门日常阅读」。
- 句式、输出任务和口语题都围绕读懂短文和日常生活，用朋友聊天的口吻。
- 不要写成求职、职场问答或自我推销。
- 第 3 个输出任务连到自己的日常生活，不要连到工作。`
}

function taskLines(profile: string, subject: string, promptExtra: string): string {
  const third = isDailyReadingGoal(profile) ? '和学习者的日常生活有什么关系' : '和学习者自己的经历有什么关系'
  return `固定 3 个，依次是
  1. 讲清楚：${subject}讲了什么
  2. 有观点：同意或不同意什么，为什么
  3. 连到自己：${third}
  goal 分别填 "${TASK_GOALS.join('" "')}"；prompt 用中文说明这一句要写什么（${promptExtra}）；template 按当前档位给出（挑战档留空字符串）`
}

function expressionLine(profile: string): string {
  return isDailyReadingGoal(profile)
    ? '2–3 个能用在日常阅读和日常对话里的英文句式（pattern 用 ... 表示可替换部分），meaning 中文说明，example 贴近日常生活的英文例句'
    : '2–3 个能直接用在学习者设定场景里的英文句式（没写具体场景就按日常交流；pattern 用 ... 表示可替换部分），meaning 中文说明，example 贴近学习者生活的英文例句'
}

function speakingLine(profile: string): string {
  return isDailyReadingGoal(profile)
    ? '1–2 个英文口语题，用日常聊天的方式提问，像朋友闲聊；可在散步时用 1 分钟回答；hint 中文提示回答思路'
    : '1–2 个英文口语题，贴合学习者设定里写明的场景；可在散步时用 1 分钟回答；hint 中文提示回答思路'
}

export function lessonPrompt(profile: string, level: Level, source: string): string {
  const resolved = resolveCoachProfile(profile)
  return `你是一名英语教练。根据下面提供的文章，为学习者设计一次 15–30 分钟的练习。

# 学习者设定
${resolved}

# 当前档位
${LEVEL_RULES[level].task}

# 场景
${sceneBlock(resolved)}

# 要求（讲解用中文，示例用英文）
- title：文章标题（英文原标题；没有就起一个简短的）
- fit：这篇文章对学习者现阶段是否合适（ok / hard / easy）；fitNote：一两句中文说明，太难就直接说并建议换什么材料
- summary：一句简单英文概括文章主旨
- words：最多 5 个值得学的生词或短语，只选文章里出现过的；ipa 美式音标（短语可留空）；meaning 中文释义；quote 文章里包含它的原句（太长可以截取一段，但必须在完整单词处断开，不要用 ... 或 … 截断单词）
- expressions：${expressionLine(resolved)}
- tasks：${taskLines(resolved, '文章', '可给思路提示')}
- speaking：${speakingLine(resolved)}
- 回复简洁，适合手机阅读

# 文章
${source}`
}

export function packageLessonPrompt(
  profile: string,
  level: Level,
  title: string,
  ref: string,
  cards: { text: string; meaning: string; example: string }[],
): string {
  const resolved = resolveCoachProfile(profile)
  const list = cards.map((c, i) => `${i + 1}. ${c.text}（${c.meaning}）\n   原句：${c.example}`).join('\n')
  return `你是一名英语教练。学习者正在读《${title}》${ref ? `（${ref}）` : ''}，下面是从原文里摘出的 ${cards.length} 个值得学的词/短语和它们的原句。请围绕这些原句，为学习者设计一次 15–30 分钟的练习。

# 学习者设定
${resolved}

# 当前档位
${LEVEL_RULES[level].task}

# 场景
${sceneBlock(resolved)}

# 要求（讲解用中文，示例用英文）
- summary：一句简单英文，概括这些原句共同讲的内容
- expressions：${expressionLine(resolved)}。优先从原句里提炼
- tasks：${taskLines(resolved, '这些原句', '可给思路提示，最好引导用上上面的词')}
- speaking：${speakingLine(resolved)}
- 回复简洁，适合手机阅读

# 词和原句
${list}`
}

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
