import { difficultyPrompt, isDifficulty, type Difficulty, type DifficultySample } from '../shared/difficulty'
import { Hono, type Context } from 'hono'
import type { AppEnv } from './env'
import { CloudflareTextError } from './cloudflare-text'
import { generateJson } from './gemini'
import { warmMeloTts } from './melo'
import { appendTail, starterContent, readyCount, stagePrepared, BUFFER_MAX, type QuestPart, type QuestPhase, type QuestBuffer } from '../shared/quest-buffer'
import { aiEnv } from './settings'
import { checkIn } from './streak'
import type { LessonContent } from '../shared/practice'
import { PLAYABLE, unlocked, XP_PER_STAGE, XP_PERFECT_BONUS, type Quest, type QuestContent, type QuestProgress, type StageId } from '../shared/quest'

/* 闯关：给一份练习出一套小题库（认词 / 听 / 读 / 说）。首批只问一次；缺听力时另一次短请求补上，不把整段提示再跑一遍。判分在前端本地完成 */

export const quest = new Hono<AppEnv>()

/** 出题时给 AI 的原文长度上限。首批只出认词和听力，原文过长时模型会把 listening 写丢，连着两次都失败。 */
const MAX_SOURCE = 6000
const STARTER_SOURCE = 1600

const STARTER_QUALITY = `中文质量要求：
- 中文单独读要通顺，先按语境意思再按中文习惯写，不要照搬英语语序。
- 干扰项不能是正确答案的另一种译法，也不能靠病句让人猜。
- 听力 en 必须是脱离上下文也能听懂的完整句子。
- 自查只在内部完成，不要写进回复。`

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
            items: { type: 'OBJECT', properties: { question: str, answer: str, distractors: strs, explain: str }, required: ['question', 'answer', 'distractors'] },
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

/** Two bounded batches, not a request per screen. Full remains available for compatibility. */
function phasePrompt(prompt: string, part: QuestPart, existing?: QuestContent): string {
  if (part === 'full') return prompt
  const begin = prompt.indexOf('请出：')
  const end = prompt.indexOf('中文质量要求')
  const requirements = part === 'starter'
    ? `只生成首批认词与听力题，严格返回 words 和 listening 两个字段：
1. words：5 个不同的词或完整表达，优先使用上面的生词和句式，不够时从原文补充。en 为英文，zh 为简洁中文意思，distractors 为 3 个中文干扰项。不得为了凑数重复。
2. listening：4 个独立完整的短句，尽量 6–14 词，来自原文或忠实改写。en 英文，zh 自然中文译文，distractors 为 3 个不同的干扰译文，extra 为 2 个不在原句里的英文单词。
此批不生成阅读、填空或跟读题。`
    : `只补充后半套题，严格返回 cloze、reading、speaking 三个字段：
1. cloze：3 句原文中的完整句子，每句恰好一个 ____；answer 为原词，distractors 为 3 个词性相同、但不正确的词，zh 为整句译文。
2. reading：1–2 段 40–90 词的原文，每段 1–2 题。passage 为原文；questions 中 question、answer、distractors（3 项）、explain 都用自然中文。
3. speaking：3 个独立完整的英文跟读短句（en）及中文译文（zh），忠实原文，不使用省略号或占位符。
不要重出、修改或返回首批题目。已生成的听力句子：${existing?.listening.map((l) => l.en).join(' / ') ?? ''}`
  if (part === 'starter') return prompt.slice(0, begin) + requirements + '\n\n' + STARTER_QUALITY
  return prompt.slice(0, begin) + requirements + '\n\n' + prompt.slice(end)
}

function phaseSchema(part: QuestPart) {
  if (part === 'full') return questSchema
  const keys = part === 'starter' ? ['words', 'listening'] : ['cloze', 'reading', 'speaking']
  return { type: 'OBJECT', properties: Object.fromEntries(keys.map((key) => [key, questSchema.properties[key as keyof typeof questSchema.properties]])), required: keys }
}

const listeningSchema = {
  type: 'OBJECT',
  properties: { listening: questSchema.properties.listening },
  required: ['listening'],
}

function listeningPrompt(content: LessonContent, source: string | null): string {
  const lines = [...content.words.map((w) => w.quote), ...content.expressions.map((e) => e.example)]
    .map((line) => line.trim()).filter(Boolean).slice(0, 6)
  return `只补听力，严格返回 JSON 对象 {"listening":[...]}，不要 words。
listening 要 4 句独立完整的短句，每句 6–14 个词。每项字段：en 英文原句，zh 自然中文译文，distractors 3 个中文干扰译文，extra 2 个不在原句里的英文单词。没有合适单词时 extra 用 []。
优先用下面的原句；不够就按原意改写成完整句，不增加事实。
${lines.length ? `原句：\n${lines.map((line) => `- ${line}`).join('\n')}` : '（没有单独摘出的原句）'}
${source ? `原文节选：\n${source.slice(0, 800)}` : ''}`
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

/** 模型没交出可用认词时，用练习里已经有的词和释义。干扰项只取同篇其他释义，不另编。 */
function lessonWordItems(content: LessonContent): QuestContent['words'] {
  const pool: { en: string; zh: string }[] = []
  for (const item of [...content.words.map((w) => ({ en: w.word, zh: w.meaning })), ...content.expressions.map((e) => ({ en: e.pattern, zh: e.meaning }))]) {
    const en = s(item.en, 80)
    const zh = s(item.zh, 40)
    if (!en || !zh || pool.some((picked) => picked.en.toLowerCase() === en.toLowerCase())) continue
    pool.push({ en, zh })
  }
  return pool.slice(0, 5).map((item) => ({
    en: item.en,
    zh: item.zh,
    distractors: pool.map((other) => other.zh).filter((zh) => zh !== item.zh).slice(0, 3),
  })).filter((item) => item.distractors.length >= 2)
}

function mergeListening(current: QuestContent['listening'], extra: QuestContent['listening']): QuestContent['listening'] {
  if (extra.length >= 2) return extra.slice(0, 4)
  const seen = new Set(current.map((item) => item.en))
  const merged = [...current]
  for (const item of extra) {
    if (seen.has(item.en)) continue
    seen.add(item.en)
    merged.push(item)
  }
  return merged.slice(0, 4)
}

type AiEnv = Parameters<typeof generateJson>[0]

function loosePayload(error: unknown): Partial<QuestContent> | undefined {
  if (error instanceof CloudflareTextError) {
    if (!error.message.includes('字段不完整') && !error.message.includes('不是合法 JSON')) return undefined
    const partial = error.partial
    if (partial && typeof partial === 'object' && !Array.isArray(partial)) return partial as Partial<QuestContent>
    return {}
  }
  if (error instanceof Error && error.message.includes('不是合法 JSON')) return {}
  return undefined
}

/** 首批不把同一篇长提示连问两遍。对得上就用；认词不够就用练习里的词；听力不够再单独补一次。 */
async function generateStarter(ai: AiEnv, content: LessonContent, starterPrompt: string, source: string | null): Promise<Partial<QuestContent>> {
  const loose = async (prompt: string, schema: unknown) => {
    try {
      return await generateJson<Partial<QuestContent>>(ai, prompt, schema, 'quest', 0.4, 'low', undefined, false)
    } catch (error) {
      const payload = loosePayload(error)
      if (payload) return payload
      throw error
    }
  }
  let clean = cleanQuest(await loose(phasePrompt(starterPrompt, 'starter'), phaseSchema('starter')))
  if (clean.words.length < 2) {
    const local = lessonWordItems(content)
    if (local.length >= 2) clean = { ...clean, words: local }
  }
  if (clean.listening.length < 2) {
    const more = cleanQuest(await loose(listeningPrompt(content, source), listeningSchema)).listening
    clean = { ...clean, listening: mergeListening(clean.listening, more) }
  }
  return clean
}

const parseProgress = (raw: string | null): QuestProgress => {
  try {
    const p = JSON.parse(raw ?? '') as QuestProgress
    return { stages: p.stages ?? {}, xp: Number(p.xp) || 0 }
  } catch {
    return { stages: {}, xp: 0 }
  }
}

export class QuestBusyError extends Error {
  constructor() { super('题目正在准备中'); this.name = 'QuestBusyError' }
}

const GENERATION_LEASE_MS = 5 * 60_000

type BankRow = { content: string; progress: string; ready_phase: QuestPhase }
const bankRow = (env: AppEnv['Bindings'], user: string, id: number) => env.DB.prepare(
  'SELECT content, progress, ready_phase FROM quests WHERE lesson_id = ? AND user_id = ?',
).bind(id, user).first<BankRow>()

/** Both HTTP and Queue use this lease. A stale owner cannot overwrite a newer bank.
 * A lease bounds crash recovery; it is not an upstream exactly-once billing guarantee. */
export async function generateQuestBank(
  env: AppEnv['Bindings'], user: string, admin: boolean, id: number, part: QuestPart = 'full', background = false,
): Promise<QuestContent> {
  const lesson = await env.DB.prepare('SELECT title, level, content, source_text FROM lessons WHERE id = ? AND user_id = ?')
    .bind(id, user).first<{ title: string; level: number; content: string; source_text: string | null }>()
  if (!lesson) throw new Error('找不到这份练习')
  const initial = await bankRow(env, user, id)
  if (initial && (initial.ready_phase === 'complete' || part === 'starter')) return JSON.parse(initial.content)
  if (!initial && part === 'tail') throw new Error('请先准备首批题目')

  const owner = crypto.randomUUID()
  const now = Date.now()
  const claimed = await env.DB.prepare(
    'INSERT INTO quest_generation_locks (lesson_id, owner, expires_at) VALUES (?, ?, ?) ' +
    'ON CONFLICT(lesson_id) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at ' +
    'WHERE quest_generation_locks.expires_at <= ? RETURNING owner',
  ).bind(id, owner, now + GENERATION_LEASE_MS, now).first<{ owner: string }>()
  if (claimed?.owner !== owner) throw new QuestBusyError()

  try {
    const cached = await bankRow(env, user, id)
    if (cached && (cached.ready_phase === 'complete' || part === 'starter')) return JSON.parse(cached.content)
    // A partial bank must only be appended to, even via an old full-generation caller.
    const effectivePart = cached ? 'tail' : part
    const existing = cached ? JSON.parse(cached.content) as QuestContent : undefined
    const ai = await aiEnv(env, user, admin)
    if (background && (ai.TEXT_PROVIDER !== 'cloudflare' || env.AI_DISABLED === 'true')) throw new Error('Cloudflare-only background generation is disabled')
    const content = JSON.parse(lesson.content) as LessonContent
    const samples = await env.DB.prepare(`
      SELECT stage, difficulty, accuracy FROM (
        SELECT f.stage, f.difficulty, f.accuracy,
          ROW_NUMBER() OVER (PARTITION BY f.stage ORDER BY f.created_at DESC, f.lesson_id DESC) AS n
        FROM quest_feedback f JOIN lessons l ON l.id = f.lesson_id AND l.user_id = f.user_id
        WHERE f.user_id = ? AND l.level = ? AND f.created_at >= ?
      ) WHERE n <= 8 ORDER BY stage, n
    `).bind(user, lesson.level, Date.now() - 90 * 86400_000).all<DifficultySample>()
    const sourceLimit = effectivePart === 'starter' ? STARTER_SOURCE : MAX_SOURCE
    const source = lesson.source_text?.slice(0, sourceLimit) ?? null
    const prompt = questPrompt(content, source, lesson.level, difficultyPrompt(samples.results))
    const raw = effectivePart === 'starter'
      ? await generateStarter(ai, content, prompt, source)
      : await generateJson<Partial<QuestContent>>(ai, phasePrompt(prompt, effectivePart, existing), phaseSchema(effectivePart), 'quest', 0.5)
    const clean = cleanQuest(raw)
    if (effectivePart === 'tail') {
      if (!existing || !clean.speaking?.length || clean.cloze.length + clean.reading.length < 2)
        throw new Error('AI 这次补充的题不完整，请重试')
    } else if (effectivePart === 'starter') {
      if (clean.words.length < 2 || clean.listening.length < 2) throw new Error('AI 这次出的首批题不完整，请重试')
    } else if (clean.words.length < 2 && clean.listening.length < 2) {
      throw new Error('AI 这次出的题不完整，再试一次')
    }
    const next = effectivePart === 'tail' ? appendTail(existing!, clean)
      : effectivePart === 'starter' ? starterContent(clean) : clean
    const phase: QuestPhase = effectivePart === 'starter' ? 'starter' : 'complete'
    const savedAt = Date.now()
    if (cached) {
      await env.DB.prepare(
        "UPDATE quests SET content = ?, ready_phase = 'complete', updated_at = ? " +
        "WHERE lesson_id = ? AND user_id = ? AND ready_phase = 'starter' " +
        'AND EXISTS (SELECT 1 FROM lessons WHERE id = ? AND user_id = ?) ' +
        'AND EXISTS (SELECT 1 FROM quest_generation_locks WHERE lesson_id = ? AND owner = ?)',
      ).bind(JSON.stringify(next), savedAt, id, user, id, user, id, owner).run()
    } else {
      await env.DB.prepare(
        'INSERT INTO quests (lesson_id,user_id,content,ready_phase,created_at,updated_at) ' +
        'SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM lessons WHERE id = ? AND user_id = ?) ' +
        'AND EXISTS (SELECT 1 FROM quest_generation_locks WHERE lesson_id = ? AND owner = ?) ' +
        'ON CONFLICT(lesson_id) DO NOTHING',
      ).bind(id, user, JSON.stringify(next), phase, savedAt, savedAt, id, user, id, owner).run()
    }
    const saved = await bankRow(env, user, id)
    if (!saved) throw new Error('找不到这份练习，生成结果未保存')
    if (phase === 'complete' && saved.ready_phase !== 'complete') throw new QuestBusyError()
    return JSON.parse(saved.content) as QuestContent
  } finally {
    await env.DB.prepare('DELETE FROM quest_generation_locks WHERE lesson_id = ? AND owner = ?')
      .bind(id, owner).run().catch((error) => console.error('release quest lease failed', error))
  }
}

/** Polling is read-only: a failure or budget refusal can never silently start AI. */
async function snapshot(c: Context<AppEnv>) {
  const user = c.get('user'), id = Number(c.req.param('lessonId'))
  if (!Number.isSafeInteger(id) || id <= 0) return null
  const lesson = await c.env.DB.prepare('SELECT title FROM lessons WHERE id = ? AND user_id = ?')
    .bind(id, user).first<{ title: string }>()
  if (!lesson) return null
  const row = await bankRow(c.env, user, id)
  const kind = row?.ready_phase === 'starter' ? 'quest_tail' : 'quest'
  const job = await c.env.DB.prepare('SELECT status, updated_at, lease_until FROM generation_jobs WHERE user_id = ? AND lesson_id = ? AND kind = ?')
    .bind(user, id, kind).first<{ status: QuestBuffer['status']; updated_at: number; lease_until: number }>()
  const lock = await c.env.DB.prepare('SELECT expires_at FROM quest_generation_locks WHERE lesson_id = ?')
    .bind(id).first<{ expires_at: number }>()
  const now = Date.now()
  const status: QuestBuffer['status'] = lock && lock.expires_at > now ? 'running'
    : job?.status === 'queued' && now - job.updated_at < 90_000 ? 'queued'
    : job?.status === 'running' && job.lease_until > now ? 'running'
    : job && job.status !== 'done' ? 'failed' : 'idle'
  if (!row) return { pending: true as const, status }
  const content = JSON.parse(row.content) as QuestContent
  const [written, feedback] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(DISTINCT idx) AS n FROM submissions WHERE lesson_id = ? AND user_id = ?').bind(id, user).first<{ n: number }>(),
    c.env.DB.prepare('SELECT stage, difficulty FROM quest_feedback WHERE lesson_id = ? AND user_id = ?').bind(id, user).all<{ stage: StageId; difficulty: Difficulty }>(),
  ])
  const q: Quest = {
    lessonId: id, title: lesson.title, content, progress: parseProgress(row.progress), writeDone: (written?.n ?? 0) >= 3,
    feedback: Object.fromEntries(feedback.results.map((r) => [r.stage, r.difficulty])),
    buffer: { phase: row.ready_phase, ready: readyCount(content, row.ready_phase), target: BUFFER_MAX, status: row.ready_phase === 'complete' ? 'done' : status },
  }
  return q
}

quest.get('/:lessonId', async (c) => {
  const q = await snapshot(c)
  if (!q) return c.json({ error: '找不到这份练习' }, 404)
  return c.json(q, 'pending' in q ? 202 : 200)
})

async function startGeneration(c: Context<AppEnv>, part: 'starter' | 'tail') {
  const q = await snapshot(c)
  if (!q) return c.json({ error: '找不到这份练习' }, 404)
  if (!('pending' in q) && (part === 'starter' || q.buffer?.phase === 'complete')) return c.json(q)
  if ('pending' in q && part === 'tail') return c.json({ error: '请先准备首批题目' }, 409)
  const status = 'pending' in q ? q.status : q.buffer?.status
  if (status === 'queued' || status === 'running') return c.json({ pending: true, status }, 202)
  try {
    const clean = await generateQuestBank(c.env, c.get('user'), c.get('admin'), Number(c.req.param('lessonId')), part)
    if (part === 'starter') {
      c.executionCtx.waitUntil(aiEnv(c.env, c.get('user'), c.get('admin'))
        .then((ai) => warmMeloTts(ai, clean.listening.map((l) => l.en.replace(/\s+/g, ' ').trim().slice(0, 500)))))
    }
    const fresh = await snapshot(c)
    return fresh ? c.json(fresh) : c.json({ error: '找不到这份练习' }, 404)
  } catch (error) {
    if (error instanceof QuestBusyError) return c.json({ pending: true, status: 'running' }, 202)
    if (error instanceof Error && /不完整/.test(error.message)) return c.json({ error: error.message }, 502)
    throw error
  }
}

quest.post('/:lessonId', (c) => startGeneration(c, 'starter'))
// Explicit user action only, never used by automatic status polling.
quest.post('/:lessonId/complete', (c) => startGeneration(c, 'tail'))

/** 过关：记下最好成绩、加经验值；过一关也算今天打卡 */
quest.post('/:lessonId/stages/:stage', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('lessonId'))
  const stage = c.req.param('stage') as StageId
  if (!PLAYABLE.includes(stage)) return c.json({ error: '没有这一关' }, 400)
  const body = await c.req.json<{ accuracy?: unknown }>().catch(() => null)
  const accuracy = Math.max(0, Math.min(1, Number(body?.accuracy) || 0))
  const row = await bankRow(c.env, user, id)
  if (!row) return c.json({ error: '找不到这套题' }, 404)
  if (!stagePrepared(row.ready_phase, stage)) return c.json({ error: '这一关的题目还在准备中' }, 409)
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
