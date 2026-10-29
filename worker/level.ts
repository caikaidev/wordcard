import { Hono } from 'hono'
import type { AppEnv, Env } from './env'
import { generateJson } from './gemini'
import { aiFrom } from './settings'
import { rankOf, wordAt } from './wordfreq'
import { BANDS, FAKES_PER_TEST, WORDS_PER_BAND, levelOf, type LevelStatus, type TestResult, type TestWord } from '../shared/level'

/*
 * 词汇评级：
 * 1. 测试（约 2 分钟）：每个词频段抽几个词，混进几个假词，只答「认识 / 不认识」。
 *    某段认识的比例 × 这段的词数，加起来就是词汇量；点了假词说明答得松，按比例扣掉（标准的 yes/no 词汇测试修正）。
 * 2. 之后在拾句里新掌握的词（标认识、DONE、间隔 21 天以上）继续往上加：每个词按它所在词频段
 *    「测试时不认识的概率」计入，避免把测试里已经算过的词重复算一遍。
 */

/** 看起来像英语、其实不存在的词（已用 wordfreq 确认词频为 0） */
const FAKE_WORDS = [
  'brelling', 'condiate', 'plorish', 'mintrous', 'scarbish', 'dromple', 'fesmal', 'glandor', 'jarvious', 'kelphant',
  'lunctive', 'morbulent', 'pranticle', 'quavish', 'restiny', 'tworpish', 'vandrous', 'whelpery', 'yorbid', 'zindle',
  'crastic', 'mornity', 'plinder', 'sclavent', 'bordulate', 'obstrate', 'prellow', 'snarbous', 'trembrid',
]

/** 掌握多久算「学会」：间隔到 21 天以上的卡片 */
const MASTERED_INTERVAL = 21

type StoredWord = { word: string; rank: number; meaning?: string }
type BandRatio = { from: number; to: number; ratio: number }

const shuffle = <T,>(a: T[]) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const cleanSchema = {
  type: 'OBJECT',
  properties: {
    words: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { word: { type: 'STRING' }, ok: { type: 'BOOLEAN' }, meaning: { type: 'STRING' } },
        required: ['word', 'ok', 'meaning'],
      },
    },
  },
  required: ['words'],
}

/** 每段多抽一些，让 AI 去掉人名、地名、缩写之类不适合测试的词，顺便给出中文释义 */
async function sampleWords(env: Env): Promise<StoredWord[]> {
  const pool: StoredWord[] = []
  for (const b of BANDS) {
    const picked = new Set<number>()
    while (picked.size < WORDS_PER_BAND * 2) {
      const r = b.from + Math.floor(Math.random() * (b.to - b.from + 1))
      if (wordAt(r)?.length >= 3) picked.add(r)
    }
    for (const r of picked) pool.push({ word: wordAt(r), rank: r })
  }
  const verdict = new Map<string, { ok: boolean; meaning: string }>()
  try {
    const r = await generateJson<{ words: { word: string; ok: boolean; meaning: string }[] }>(
      env,
      `下面是一批英语单词（小写），要用来做词汇量测试。逐个判断：
- ok：是普通英语单词就为 true；人名、地名、品牌、缩写、外语词、拼写变体、粗俗词为 false
- meaning：最常用的中文释义，10 个字以内

${pool.map((w) => w.word).join('\n')}`,
      cleanSchema,
      'level',
      0.2,
      'minimal',
    )
    for (const w of r.words ?? []) if (typeof w.word === 'string') verdict.set(w.word.toLowerCase(), { ok: w.ok !== false, meaning: String(w.meaning ?? '').slice(0, 40) })
  } catch (e) {
    // AI 用不了也能测，只是可能混进个别人名，测完没有释义
    console.warn('level word check failed', e)
  }
  const out: StoredWord[] = []
  for (const b of BANDS) {
    const inBand = pool.filter((w) => w.rank >= b.from && w.rank <= b.to)
    const good = inBand.filter((w) => verdict.get(w.word)?.ok ?? true)
    out.push(...(good.length >= WORDS_PER_BAND ? good : inBand).slice(0, WORDS_PER_BAND).map((w) => ({ ...w, meaning: verdict.get(w.word)?.meaning || undefined })))
  }
  return out
}

/** 假词点了一半以上「认识」：结果不可靠，不计入评级 */
const UNRELIABLE_FAKE_RATE = 0.5

/**
 * 越少见的词认识的比例应该越低：每段只抽几个词，偶尔会出现后面比前面高的波动，
 * 用保序回归（相邻违反就合并取平均）把它抹平成不升的曲线
 */
function nonIncreasing(values: number[]) {
  const blocks: { sum: number; n: number }[] = []
  for (const v of values) {
    blocks.push({ sum: v, n: 1 })
    while (blocks.length > 1 && blocks.at(-2)!.sum / blocks.at(-2)!.n < blocks.at(-1)!.sum / blocks.at(-1)!.n) {
      const last = blocks.pop()!
      blocks.at(-1)!.sum += last.sum
      blocks.at(-1)!.n += last.n
    }
  }
  return blocks.flatMap((b) => Array<number>(b.n).fill(b.sum / b.n))
}

/** 每段认识的比例，扣掉乱点：p' = (p - f) / (1 - f)，f 是假词被点「认识」的比例 */
export function scoreTest(words: StoredWord[], known: Set<string>) {
  const fakes = words.filter((w) => !w.rank)
  const fakesClaimed = fakes.filter((w) => known.has(w.word)).length
  const f = fakes.length ? fakesClaimed / fakes.length : 0
  const raw = BANDS.map((b) => {
    const inBand = words.filter((w) => w.rank >= b.from && w.rank <= b.to)
    const p = inBand.length ? inBand.filter((w) => known.has(w.word)).length / inBand.length : 0
    return f >= 1 ? 0 : Math.max(0, Math.min(1, (p - f) / (1 - f)))
  })
  const bands: BandRatio[] = nonIncreasing(raw).map((ratio, i) => ({ from: BANDS[i].from, to: BANDS[i].to, ratio }))
  const vocab = Math.round(bands.reduce((n, b) => n + (b.to - b.from + 1) * b.ratio, 0))
  return { vocab, bands, fakesClaimed, fakesShown: fakes.length, unreliable: f >= UNRELIABLE_FAKE_RATE }
}

/** 测试之后新掌握的词，按「测试时这段不认识的概率」计入；词表外的少见词按 1 个算 */
const gainOf = (word: string, bands: BandRatio[]) => {
  const r = rankOf(word)
  const band = r ? bands.find((b) => r >= b.from && r <= b.to) : undefined
  return band ? 1 - band.ratio : 1
}

/** 已掌握的单词（不含短语）及第一次掌握的时间 */
async function masteredWords(db: D1Database, user: string) {
  const { results } = await db
    .prepare(
      `SELECT lower(word) AS w, created_at AS ts FROM known_words WHERE user_id = ?1
       UNION ALL
       SELECT lower(text), updated_at FROM items WHERE user_id = ?1 AND type = 'word' AND (status = 'done' OR interval >= ?2)`,
    )
    .bind(user, MASTERED_INTERVAL)
    .all<{ w: string; ts: number }>()
  const first = new Map<string, number>()
  for (const r of results) {
    if (!/^[a-z][a-z'-]*$/.test(r.w)) continue
    first.set(r.w, Math.min(first.get(r.w) ?? Infinity, r.ts))
  }
  return first
}

export async function vocabEstimate(env: Env, user: string, now = Date.now()): Promise<LevelStatus> {
  const [test, mastered] = await Promise.all([
    env.DB.prepare('SELECT vocab, bands, done_at FROM vocab_tests WHERE user_id = ? AND vocab IS NOT NULL ORDER BY done_at DESC LIMIT 1')
      .bind(user)
      .first<{ vocab: number; bands: string; done_at: number }>(),
    masteredWords(env.DB, user),
  ])
  let recent = 0
  for (const ts of mastered.values()) if (ts > now - 30 * 86_400_000) recent++
  if (!test) return { vocab: null, level: null, tested: null, gained: 0, mastered: mastered.size, recent }
  let bands: BandRatio[] = []
  try {
    bands = JSON.parse(test.bands)
  } catch {
    /* 坏数据就当每段都不认识 */
  }
  let gained = 0
  for (const [w, ts] of mastered) if (ts > test.done_at) gained += gainOf(w, bands)
  const vocab = Math.round(test.vocab + gained)
  return { vocab, level: levelOf(vocab), tested: { vocab: test.vocab, at: test.done_at }, gained: Math.round(gained), mastered: mastered.size, recent }
}

/* ------------------------------ 接口 ------------------------------ */

export const level = new Hono<AppEnv>()

level.get('/', async (c) => c.json(await vocabEstimate(c.env, c.get('user'))))

/** 出一套题：存下来（交卷时用来判分），只把词发给前端 */
level.post('/test', async (c) => {
  const user = c.get('user')
  const real = await sampleWords(await aiFrom(c))
  const fakes = shuffle([...FAKE_WORDS]).slice(0, FAKES_PER_TEST).map((word) => ({ word, rank: 0 }))
  const words = shuffle([...real, ...fakes])
  const row = await c.env.DB.prepare('INSERT INTO vocab_tests (user_id, words, created_at) VALUES (?, ?, ?) RETURNING id')
    .bind(user, JSON.stringify(words), Date.now())
    .first<{ id: number }>()
  return c.json({ id: row!.id, words: words.map((w) => w.word) })
})

/** 交卷：known 是点了「认识」的词 */
level.post('/test/:id', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const body = await c.req.json<{ known?: unknown }>().catch(() => null)
  const known = new Set(Array.isArray(body?.known) ? body.known.filter((w): w is string => typeof w === 'string').map((w) => w.toLowerCase()) : [])
  const row = await c.env.DB.prepare('SELECT words, done_at FROM vocab_tests WHERE id = ? AND user_id = ?').bind(id, user).first<{ words: string; done_at: number | null }>()
  if (!row) return c.json({ error: '找不到这次测试，重新开始一次吧' }, 404)
  if (row.done_at) return c.json({ error: '这次测试已经交过了' }, 409)
  const words = JSON.parse(row.words) as StoredWord[]
  const score = scoreTest(words, known)
  const now = Date.now()
  // 认识的真词记下来：「发现新词」不再推荐。时间记成交卷那一刻，估算时不会重复计入
  // 结果不可靠时只记下交过卷，不计入评级，也不把「认识」的词记下来
  const knownReal = score.unreliable ? [] : words.filter((w) => w.rank && known.has(w.word))
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE vocab_tests SET vocab = ?, bands = ?, done_at = ? WHERE id = ?').bind(
      score.unreliable ? null : score.vocab,
      JSON.stringify(score.bands),
      now,
      id,
    ),
    ...knownReal.map((w) => c.env.DB.prepare('INSERT OR IGNORE INTO known_words (user_id, word, created_at) VALUES (?, ?, ?)').bind(user, w.word, now)),
  ])
  const result: TestResult = {
    ...score,
    level: levelOf(score.vocab),
    unknown: words.filter((w) => w.rank && !known.has(w.word)).map((w): TestWord => ({ word: w.word, meaning: w.meaning })),
  }
  return c.json(result)
})
