import { Hono } from 'hono'
import type { AppEnv } from './env'
import { generateJson } from './gemini'
import { aiEnv } from './settings'
import { checkIn } from './streak'
import type { LessonContent } from '../shared/practice'
import { PLAYABLE, XP_PER_STAGE, XP_PERFECT_BONUS, type Quest, type QuestContent, type QuestProgress, type StageId } from '../shared/quest'

/* 闯关：给一份练习出一套小题库（认词 / 听 / 读），AI 只调用一次；判分全在前端本地完成 */

export const quest = new Hono<AppEnv>()

/** 出题时给 AI 的原文长度上限 */
const MAX_SOURCE = 6000

const str = { type: 'STRING' }
const strs = { type: 'ARRAY', items: str }
const questSchema = {
  type: 'OBJECT',
  properties: {
    words: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { en: str, zh: str, distractors: strs }, required: ['en', 'zh', 'distractors'] },
    },
    listening: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { en: str, zh: str, distractors: strs, extra: strs }, required: ['en', 'zh', 'distractors', 'extra'] },
    },
    cloze: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { sentence: str, answer: str, distractors: strs, zh: str }, required: ['sentence', 'answer', 'distractors', 'zh'] },
    },
    reading: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          passage: str,
          questions: {
            type: 'ARRAY',
            items: { type: 'OBJECT', properties: { question: str, answer: str, distractors: strs, explain: str }, required: ['question', 'answer', 'distractors', 'explain'] },
          },
        },
        required: ['passage', 'questions'],
      },
    },
  },
  required: ['words', 'listening', 'cloze', 'reading'],
}

function questPrompt(c: LessonContent, source: string | null, level: number) {
  const words = c.words.map((w) => `- ${w.word}：${w.meaning}（原句：${w.quote}）`).join('\n')
  const exprs = c.expressions.map((e) => `- ${e.pattern}：${e.meaning}（例句：${e.example}）`).join('\n')
  return `你在给英语学习者做一套像多邻国那样的小练习，一题一屏、点选作答。学习者是中文母语，档位 ${level}（1 入门 / 2 进阶 / 3 挑战），档位越低句子越短、干扰项越容易分辨。

文章标题：${c.title}
概要：${c.summary}

生词：
${words || '（无）'}

句式：
${exprs || '（无）'}

${source ? `原文（可能截断）：\n${source}` : '（没有原文，只能用上面的原句和例句）'}

请出：
1. words：上面每个生词和句式各一条（最多 6 条）。en 用原词或句式原样；zh 是贴合文章语境的简洁中文意思（10 个字以内）；distractors 3 个中文干扰项，词性和长度相近、看起来合理但意思不对，不要和正确答案是近义词。
2. listening：4 个短句，优先从原文里摘（可以截取一个完整的分句），每句 6–14 个词，尽量包含上面的生词或句式；zh 是自然的中文翻译；distractors 3 个中文干扰翻译，和原句话题相关但意思明显不同；extra 2 个不在这句里、但看起来能放进句子的英文单词（排单词题的干扰块）。
3. cloze：3 句原文里的句子，把一个生词或句式里的关键词换成 ____（四个下划线，只出现一次）；answer 是被挖掉的原词（保持句中的形式）；distractors 3 个英文干扰词，词性和形式相同但放进去意思不通或不地道；zh 是整句的中文翻译。
4. reading：1–2 段原文片段（每段 40–90 个词，原样摘录），每段 1–2 道理解题。question 用中文问；answer 和 distractors 都用中文、长度相近，distractors 3 个；explain 用一句中文解释为什么，引用原文关键词。

要求：英文必须拼写正确；干扰项不能也是对的；不要出现「以上都对」这类选项。`
}

const s = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '')
const list = (v: unknown, max: number, n: number) => (Array.isArray(v) ? v.map((x) => s(x, max)).filter(Boolean).slice(0, n) : [])

/** 校验 AI 的输出：缺字段、干扰项不够、挖空不对的题直接丢掉 */
export function cleanQuest(raw: Partial<QuestContent> | null | undefined): QuestContent {
  const words = (raw?.words ?? [])
    .map((w) => ({ en: s(w?.en, 80), zh: s(w?.zh, 40), distractors: list(w?.distractors, 40, 3) }))
    .filter((w) => w.en && w.zh && w.distractors.length >= 2)
    .slice(0, 6)
  const listening = (raw?.listening ?? [])
    .map((l) => ({ en: s(l?.en, 200), zh: s(l?.zh, 120), distractors: list(l?.distractors, 120, 3), extra: list(l?.extra, 30, 2).filter((x) => !/\s/.test(x)) }))
    .filter((l) => l.en && l.zh && l.distractors.length >= 2)
    .slice(0, 4)
  const cloze = (raw?.cloze ?? [])
    .map((q) => ({ sentence: s(q?.sentence, 300), answer: s(q?.answer, 40), distractors: list(q?.distractors, 40, 3), zh: s(q?.zh, 200) }))
    .filter((q) => q.answer && q.distractors.length >= 2 && q.sentence.split('____').length === 2)
    .slice(0, 3)
  const reading = (raw?.reading ?? [])
    .map((r) => ({
      passage: s(r?.passage, 800),
      questions: (r?.questions ?? [])
        .map((q) => ({ question: s(q?.question, 200), answer: s(q?.answer, 120), distractors: list(q?.distractors, 120, 3), explain: s(q?.explain, 200) }))
        .filter((q) => q.question && q.answer && q.distractors.length >= 2)
        .slice(0, 2),
    }))
    .filter((r) => r.passage && r.questions.length)
    .slice(0, 2)
  return { words, listening, cloze, reading }
}

const parseProgress = (raw: string | null): QuestProgress => {
  try {
    const p = JSON.parse(raw ?? '') as QuestProgress
    return { stages: p.stages ?? {}, xp: Number(p.xp) || 0 }
  } catch {
    return { stages: {}, xp: 0 }
  }
}

/** 取题库：没有就现出一套（一次 AI 调用） */
quest.post('/:lessonId', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('lessonId'))
  const lesson = await c.env.DB.prepare('SELECT title, level, content, source_text FROM lessons WHERE id = ? AND user_id = ?')
    .bind(id, user)
    .first<{ title: string; level: number; content: string; source_text: string | null }>()
  if (!lesson) return c.json({ error: '找不到这份练习' }, 404)

  const row = await c.env.DB.prepare('SELECT content, progress FROM quests WHERE lesson_id = ? AND user_id = ?')
    .bind(id, user)
    .first<{ content: string; progress: string }>()
  if (row) {
    const q: Quest = { lessonId: id, title: lesson.title, content: JSON.parse(row.content), progress: parseProgress(row.progress) }
    return c.json(q)
  }

  const content = JSON.parse(lesson.content) as LessonContent
  const raw = await generateJson<Partial<QuestContent>>(
    await aiEnv(c.env, user, c.get('admin')),
    questPrompt(content, lesson.source_text?.slice(0, MAX_SOURCE) ?? null, lesson.level),
    questSchema,
    'quest',
    0.5,
  )
  const clean = cleanQuest(raw)
  if (clean.words.length < 2 && clean.listening.length < 2) return c.json({ error: 'AI 这次出的题不完整，再试一次' }, 502)
  const now = Date.now()
  await c.env.DB.prepare('INSERT OR REPLACE INTO quests (lesson_id, user_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, user, JSON.stringify(clean), now, now)
    .run()
  const q: Quest = { lessonId: id, title: lesson.title, content: clean, progress: { stages: {}, xp: 0 } }
  return c.json(q)
})

/** 过关：记下最好成绩、加经验值；过一关也算今天打卡 */
quest.post('/:lessonId/stages/:stage', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('lessonId'))
  const stage = c.req.param('stage') as StageId
  if (!PLAYABLE.includes(stage)) return c.json({ error: '没有这一关' }, 400)
  const body = await c.req.json<{ accuracy?: unknown }>().catch(() => null)
  const accuracy = Math.max(0, Math.min(1, Number(body?.accuracy) || 0))
  const row = await c.env.DB.prepare('SELECT progress FROM quests WHERE lesson_id = ? AND user_id = ?').bind(id, user).first<{ progress: string }>()
  if (!row) return c.json({ error: '找不到这套题' }, 404)
  const p = parseProgress(row.progress)
  const prev = p.stages[stage]
  // 第一次过关拿全部经验；重玩只有拿到满分才补一次满分奖励
  const gained = (prev ? 0 : XP_PER_STAGE) + (accuracy === 1 && prev?.accuracy !== 1 ? XP_PERFECT_BONUS : 0)
  p.stages[stage] = { accuracy: Math.max(accuracy, prev?.accuracy ?? 0), at: Date.now() }
  p.xp += gained
  await c.env.DB.prepare('UPDATE quests SET progress = ?, updated_at = ? WHERE lesson_id = ? AND user_id = ?')
    .bind(JSON.stringify(p), Date.now(), id, user)
    .run()
  const checkin = await checkIn(c.env.DB, user).catch((e) => {
    console.error('checkin failed', e)
    return null
  })
  return c.json({ progress: p, gained, checkin })
})
