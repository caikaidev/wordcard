/* ---------------------------- 练习导入格式 shiju-lesson-v1：一篇文章 + （可选）整理好的练习和闯关题库 ---------------------------- */

import type { LessonContent } from './practice'
import type { QuestContent } from './quest'

export const LESSON_FORMAT = 'shiju-lesson-v1'
export const LESSON_DOC_URL = 'https://github.com/caikaidev/wordcard/blob/main/docs/lesson-format.md'
export const LESSON_DOC_RAW_URL = 'https://raw.githubusercontent.com/caikaidev/wordcard/main/docs/lesson-format.md'
/** 原文最多保存这么多字符（和读链接一致） */
export const LESSON_MAX_TEXT = 100_000

export interface LessonImport {
  title: string
  sourceUrl: string | null
  text: string | null
  level: 1 | 2 | 3 | null
  /** 调用方整理好的练习内容；没有就由 AI 根据原文生成 */
  lesson: Partial<LessonContent> | null
  /** 调用方出好的闯关题库；没有就在第一次进入闯关时由 AI 生成 */
  quest: Partial<QuestContent> | null
}

export type LessonImportParse = { ok: true; data: LessonImport } | { ok: false; error: string }

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** 只检查结构；字段级的清洗（截断、补默认值、丢掉不完整的题）在服务端入库时做，并在报告里说明丢了多少 */
export function parseLessonImport(raw: unknown): LessonImportParse {
  if (!isObj(raw)) return { ok: false, error: `不是练习导入文件：应该是一个 JSON 对象，开头有 "format": "${LESSON_FORMAT}"` }
  if (raw.format !== LESSON_FORMAT) return { ok: false, error: `缺少格式标记或版本不对，请加上 "format": "${LESSON_FORMAT}"` }
  const text = typeof raw.text === 'string' ? raw.text.trim() : ''
  if (text.length > LESSON_MAX_TEXT) return { ok: false, error: `原文太长（${text.length} 字符），最多 ${LESSON_MAX_TEXT} 字符` }
  if (raw.lesson !== undefined && !isObj(raw.lesson)) return { ok: false, error: '"lesson" 应该是一个对象 { … }' }
  if (raw.quest !== undefined && !isObj(raw.quest)) return { ok: false, error: '"quest" 应该是一个对象 { … }' }
  const lesson = isObj(raw.lesson) ? (raw.lesson as Partial<LessonContent>) : null
  if (!text && !lesson) return { ok: false, error: '至少要有原文 "text"，或者整理好的练习 "lesson"' }
  const title = str(raw.title, 200) || str(lesson?.title, 200)
  if (!title && !text) return { ok: false, error: '缺少标题 "title"' }
  const url = str(raw.source_url, 500)
  const level = Number(raw.level)
  return {
    ok: true,
    data: {
      title,
      sourceUrl: /^https?:\/\//i.test(url) ? url : null,
      text: text || null,
      level: level === 1 || level === 2 || level === 3 ? level : null,
      lesson,
      quest: isObj(raw.quest) ? (raw.quest as Partial<QuestContent>) : null,
    },
  }
}

/** 导入结果：新练习的 id，以及哪些部分是 AI 补的、哪些题因为不完整被丢掉 */
export interface LessonImportReport {
  id: number
  title: string
  /** lesson 由 AI 根据原文生成（调用方没给） */
  generatedLesson: boolean
  /** 带了题库，闯关可以直接玩 */
  hasQuest: boolean
  /** 不完整、被丢掉的题目数 */
  dropped: number
  url: string
}

/** 示例（docs/examples/lesson-sample.json 与它保持一致） */
export const LESSON_EXAMPLE = {
  format: LESSON_FORMAT,
  title: 'Why the real bottleneck is organizational',
  source_url: 'https://news.ycombinator.com/item?id=1',
  level: 2,
  text: 'I think the real bottleneck here is organizational, not technical. Teams keep reinventing the wheel because nobody wants to own the tedious migration work. The overhead of maintaining two codebases is a real burden, and the tradeoff is rarely obvious. Measure first, then fix the bottleneck.',
  lesson: {
    summary: 'Most engineering slowdowns come from how teams are organized, not from technology.',
    fit: 'ok',
    fitNote: '话题贴近工作，句子不长，适合进阶档。',
    words: [
      { word: 'bottleneck', ipa: '/ˈbɑːtlnek/', meaning: '瓶颈', quote: 'I think the real bottleneck here is organizational, not technical.' },
      { word: 'tedious', ipa: '/ˈtiːdiəs/', meaning: '繁琐乏味的', quote: 'Nobody wants to own the tedious migration work.' },
      { word: 'overhead', ipa: '/ˈoʊvərhed/', meaning: '额外开销', quote: 'The overhead of maintaining two codebases is a real burden.' },
    ],
    expressions: [{ pattern: 'The real ... is ..., not ...', meaning: '指出问题的真正所在', example: 'The real problem is communication, not the deadline.' }],
    tasks: [
      { goal: '讲清楚', prompt: '用一句话说文章的核心观点', template: 'The author argues that ...' },
      { goal: '有观点', prompt: '你同意吗？为什么', template: 'I agree / disagree because ...' },
      { goal: '连到自己', prompt: '你的团队遇到过类似的瓶颈吗', template: 'In my team, ...' },
    ],
    speaking: [{ question: 'What is the biggest bottleneck in your current project?', hint: '先说是什么，再说为什么、打算怎么解决' }],
  },
  quest: {
    words: [
      { en: 'bottleneck', zh: '瓶颈', distractors: ['捷径', '里程碑', '副作用'] },
      { en: 'tedious', zh: '繁琐乏味的', distractors: ['紧急的', '精细的', '危险的'] },
      { en: 'overhead', zh: '额外开销', distractors: ['头顶空间', '管理层', '超时'] },
    ],
    listening: [
      {
        en: 'The real bottleneck is organizational, not technical.',
        zh: '真正的瓶颈在组织上，而不在技术上。',
        distractors: ['真正的技术问题已经解决了。', '组织调整带来了新技术。', '技术瓶颈比组织问题更严重。'],
        extra: ['budget', 'quickly'],
      },
      {
        en: 'Measure first, then fix the bottleneck.',
        zh: '先测量，再解决瓶颈。',
        distractors: ['先修好，再去测量。', '测量本身就是瓶颈。', '瓶颈不需要修。'],
        extra: ['always', 'never'],
      },
    ],
    cloze: [
      { sentence: 'Nobody wants to own the ____ migration work.', answer: 'tedious', distractors: ['curious', 'generous', 'famous'], zh: '没人愿意负责那些繁琐的迁移工作。' },
    ],
    reading: [
      {
        passage: 'I think the real bottleneck here is organizational, not technical. Teams keep reinventing the wheel because nobody wants to own the tedious migration work.',
        questions: [
          { question: '作者认为真正的瓶颈是什么？', answer: '组织层面的问题', distractors: ['技术不够先进', '预算不足', '人手太多'], explain: '原文说 the real bottleneck is organizational, not technical。' },
        ],
      },
    ],
  },
}
