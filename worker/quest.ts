import { difficultyPrompt, isDifficulty, type Difficulty, type DifficultySample } from '../shared/difficulty'
import { Hono } from 'hono'
import type { AppEnv } from './env'
import { generateJson } from './gemini'
import { warmMeloTts } from './melo'
import { aiEnv } from './settings'
import { checkIn } from './streak'
import type { LessonContent } from '../shared/practice'
import { PLAYABLE, unlocked, XP_PER_STAGE, XP_PERFECT_BONUS, type Quest, type QuestContent, type QuestProgress, type StageId } from '../shared/quest'

/* 闯关：给一份练习出一套小题库（认词 / 听 / 读 / 说），AI 只调用一次；判分全在前端本地完成 */

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
    speaking: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { en: str, zh: str }, required: ['en', 'zh'] },
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
  required: ['words', 'listening', 'cloze', 'reading', 'speaking'],
}

function questPrompt(c: LessonContent, source: string | null, level: number, adaptation: string) {
  const words = c.words.map((w) => `- ${w.word}：${w.meaning}（原句：${w.quote}）`).join('\n')
  const exprs = c.expressions.map((e) => `- ${e.pattern}：${e.meaning}（例句：${e.example}）`).join('\n')
  return `你在给英语学习者做一套像多邻国那样的小练习，一题一屏、点选作答。学习者是中文母语，档位 ${level}（1 入门 / 2 进阶 / 3 挑战），档位越低句子越短、干扰项越容易分辨。

${adaptation}

文章标题：${c.title}
概要：${c.summary}

生词：
${words || '（无）'}

句式：
${exprs || '（无）'}

${source ? `原文（可能截断）：\n${source}` : '（没有原文，只能用上面的原句和例句）'}

请出：
1. words：上面每个生词和句式各一条（最多 6 条）。en 用原词或句式原样；zh 是贴合文章语境的简洁中文意思（10 个字以内）；distractors 3 个中文干扰项，词性和长度相近、看起来合理但意思不对，不要和正确答案是近义词。
2. listening：4 个短句，优先从原文里摘，每句尽量 6–14 个词，包含上面的生词或句式。每句必须能脱离上下文独立听懂、语义完整；不得为了词数截断主句、条件句、定语从句或固定表达。找不到合适的原句时，可依据原文含义改写成完整短句，不增加事实。zh 是忠实原意、符合中文母语者习惯的简体中文译文；distractors 3 个中文干扰翻译，和原句话题相关但意思明显不同；extra 2 个不在这句里、但看起来能放进句子的英文单词（排单词题的干扰块）。
3. cloze：3 句原文里的句子，把一个生词或句式里的关键词换成 ____（四个下划线，只出现一次）；answer 是被挖掉的原词（保持句中的形式）；distractors 3 个英文干扰词，词性和形式相同但放进去意思不通或不地道；zh 是整句的中文翻译。
4. reading：1–2 段原文片段（每段 40–90 个词，原样摘录），每段 1–2 道理解题。question 用中文问；answer 和 distractors 都用中文、长度相近，distractors 3 个；explain 用一句中文解释为什么，引用原文关键词。

5. speaking：3 个独立、完整的英文跟读短句（en）和自然中文译文（zh），来自文章内容或忠实改写，不使用带省略号、方括号的句式模板。按口语分项难度选择句长和表达复杂度，入门优先 5–8 词，进阶 8–12 词，挑战 10–16 词。

中文质量要求（适用于所有中文释义、译文、选项和解析）：
- 先理解上下文中的意思，再按中文习惯表达；允许调整语序、拆句，把英语定语从句转成自然的中文分句。不要照搬英语语序、堆叠「的」或机械套用「当……时」。
- 习语和比喻优先表达语境中的实际含义。例如 hit a stumbling block 通常是「遇到困难 / 碰到难题」，不是字面上的「遇到绊脚石」。
- 忠实保留人物、否定、条件、时态和情态的关键区别；不要为了通顺擅自添加「随时」「一定」「请联系我」等原文没有的信息。省略的内容只有在原文上下文明确支持时才能补全。
- 正确答案和每个干扰项都要像中文母语者会说的话，语体和长度尽量一致；干扰项只在含义上出错，不能靠病句或翻译腔让人猜答案，也不能只是正确答案的另一种自然译法。
- 出题后逐条自查：英文单独播放是否表达完整？中文单独读是否通顺？中英文含义是否一致？选项是否只有一个正确？不合格的题先改写或换句，再输出。

示例：
原文 Let me know when you hit a stumbling block I can help with.
不自然：当你遇到我能帮上忙的绊脚石时告诉我。
自然：遇到困难时，如果我能帮上忙，就告诉我。
不要单独截取 When you hit a stumbling block I can help with. 作为听力句子：它只有条件从句，缺少主句；应保留完整句或换一句。

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
  const speaking = (raw?.speaking ?? [])
    .map((q) => ({ en: s(q?.en, 200), zh: s(q?.zh, 120) }))
    .filter((q) => q.en && q.zh && !/\.{3}|…|\[|____/.test(q.en))
    .slice(0, 3)
  return { words, listening, cloze, reading, ...(speaking.length ? { speaking } : {}) }
}

const parseProgress = (raw: string | null): QuestProgress => {
  try {
    const p = JSON.parse(raw ?? '') as QuestProgress
    return { stages: p.stages ?? {}, xp: Number(p.xp) || 0 }
  } catch {
    return { stages: {}, xp: 0 }
  }
}

/** Shared generation routine for interactive requests and the background queue.
 * The INSERT never overwrites an existing bank, preserving saved XP/progress. */
export async function generateQuestBank(env: AppEnv['Bindings'], user: string, admin: boolean, id: number): Promise<QuestContent> {
  const lesson = await env.DB.prepare('SELECT title, level, content, source_text FROM lessons WHERE id = ? AND user_id = ?')
    .bind(id, user).first<{ title: string; level: number; content: string; source_text: string | null }>()
  if (!lesson) throw new Error('找不到这份练习')
  const cached = await env.DB.prepare('SELECT content FROM quests WHERE lesson_id = ? AND user_id = ?')
    .bind(id, user).first<{ content: string }>()
  if (cached) return JSON.parse(cached.content) as QuestContent

  const content = JSON.parse(lesson.content) as LessonContent
  const ai = await aiEnv(env, user, admin)
  const samples = await env.DB.prepare(`
    SELECT stage, difficulty, accuracy FROM (
      SELECT f.stage, f.difficulty, f.accuracy,
        ROW_NUMBER() OVER (PARTITION BY f.stage ORDER BY f.created_at DESC, f.lesson_id DESC) AS n
      FROM quest_feedback f JOIN lessons l ON l.id = f.lesson_id AND l.user_id = f.user_id
      WHERE f.user_id = ? AND l.level = ? AND f.created_at >= ?
    ) WHERE n <= 8 ORDER BY stage, n
  `).bind(user, lesson.level, Date.now() - 90 * 86400_000).all<DifficultySample>()
  const raw = await generateJson<Partial<QuestContent>>(
    ai,
    questPrompt(content, lesson.source_text?.slice(0, MAX_SOURCE) ?? null, lesson.level, difficultyPrompt(samples.results)),
    questSchema,
    'quest',
    0.5,
  )
  const clean = cleanQuest(raw)
  if (clean.words.length < 2 && clean.listening.length < 2) throw new Error('AI 这次出的题不完整，再试一次')
  const now = Date.now()
  await env.DB.prepare(
    'INSERT INTO quests (lesson_id, user_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(lesson_id) DO NOTHING',
  ).bind(id, user, JSON.stringify(clean), now, now).run()
  const saved = await env.DB.prepare('SELECT content FROM quests WHERE lesson_id = ? AND user_id = ?')
    .bind(id, user).first<{ content: string }>()
  return saved ? JSON.parse(saved.content) as QuestContent : clean
}

/** 取题库：没有就现出一套（一次 AI 调用） */
quest.post('/:lessonId', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('lessonId'))
  const lesson = await c.env.DB.prepare('SELECT title, level, content, source_text FROM lessons WHERE id = ? AND user_id = ?')
    .bind(id, user)
    .first<{ title: string; level: number; content: string; source_text: string | null }>()
  if (!lesson) return c.json({ error: '找不到这份练习' }, 404)

  const [row, written, feedbackRows] = await Promise.all([
    c.env.DB.prepare('SELECT content, progress FROM quests WHERE lesson_id = ? AND user_id = ?').bind(id, user).first<{ content: string; progress: string }>(),
    c.env.DB.prepare('SELECT COUNT(DISTINCT idx) AS n FROM submissions WHERE lesson_id = ? AND user_id = ?').bind(id, user).first<{ n: number }>(),
    c.env.DB.prepare('SELECT stage, difficulty FROM quest_feedback WHERE lesson_id = ? AND user_id = ?').bind(id, user).all<{ stage: StageId; difficulty: Difficulty }>(),
  ])
  const feedback = Object.fromEntries(feedbackRows.results.map((r) => [r.stage, r.difficulty]))
  const writeDone = (written?.n ?? 0) >= 3
  if (row) {
    const q: Quest = { lessonId: id, title: lesson.title, content: JSON.parse(row.content), progress: parseProgress(row.progress), feedback, writeDone }
    return c.json(q)
  }

  const job = await c.env.DB.prepare(
    "SELECT id, status, updated_at, lease_until FROM generation_jobs WHERE user_id = ? AND lesson_id = ? AND kind = 'quest'",
  ).bind(user, id).first<{ id: number; status: string; updated_at: number; lease_until: number }>()
  if (job?.status === 'queued' && Date.now() - job.updated_at < 90_000 ||
      job?.status === 'running' && job.lease_until > Date.now()) {
    return c.json({ pending: true, status: job.status }, 202)
  }
  if (job && (job.status === 'queued' || job.status === 'running')) {
    // If Queues failed to run the task, interactive requests must not wait forever.
    await c.env.DB.prepare("UPDATE generation_jobs SET status = 'failed', updated_at = ?, error = 'stale' WHERE id = ? AND updated_at = ?")
      .bind(Date.now(), job.id, job.updated_at).run()
  }
  const clean = await generateQuestBank(c.env, user, c.get('admin'), id)
  // Audio is warmed after a direct generation; background generation is
  // budget-protected and leaves optional TTS to the existing lazy prefetch.
  c.executionCtx.waitUntil(warmMeloTts(await aiEnv(c.env, user, c.get('admin')), clean.listening.map((l) => l.en.replace(/\\s+/g, ' ').trim().slice(0, 500))))
  return c.json({ lessonId: id, title: lesson.title, content: clean, progress: { stages: {}, xp: 0 }, feedback, writeDone })

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
  if (!unlocked(p, stage)) return c.json({ error: '先完成前一关' }, 409)
  const prev = p.stages[stage]
  // 第一次过关拿全部经验；重玩只有拿到满分才补一次满分奖励
  const gained = (prev ? 0 : XP_PER_STAGE) + (stage !== 'speak' && accuracy === 1 && prev?.accuracy !== 1 ? XP_PERFECT_BONUS : 0)
  p.stages[stage] = { accuracy: Math.max(accuracy, prev?.accuracy ?? 0), at: Date.now(), firstAccuracy: prev?.firstAccuracy ?? prev?.accuracy ?? accuracy }
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

/** Difficulty is optional, editable, and never a second completion/XP event. */
quest.put('/:lessonId/stages/:stage/feedback', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('lessonId'))
  const stage = c.req.param('stage') as StageId
  const body = await c.req.json<{ difficulty?: unknown }>().catch(() => null)
  if (!Number.isSafeInteger(id) || id <= 0 || !PLAYABLE.includes(stage) || !isDifficulty(body?.difficulty)) {
    return c.json({ error: '反馈内容不正确' }, 400)
  }
  const row = await c.env.DB.prepare('SELECT progress FROM quests WHERE lesson_id = ? AND user_id = ?')
    .bind(id, user).first<{ progress: string }>()
  if (!row) return c.json({ error: '找不到这套题' }, 404)
  const completed = parseProgress(row.progress).stages[stage]
  if (!completed) return c.json({ error: '完成这一关后再反馈' }, 409)
  const accuracy = stage === 'speak' ? null : completed.firstAccuracy ?? completed.accuracy
  const now = Date.now()
  await c.env.DB.prepare(`
    INSERT INTO quest_feedback (user_id, lesson_id, stage, difficulty, accuracy, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, lesson_id, stage) DO UPDATE SET difficulty = excluded.difficulty, updated_at = excluded.updated_at
  `).bind(user, id, stage, body.difficulty, accuracy, now, now).run()
  return c.json({ difficulty: body.difficulty })
})
