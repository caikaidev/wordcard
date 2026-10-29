import { Hono } from 'hono'
import type { AppEnv, Env } from './env'
import { generateJson } from './gemini'
import { aiEnv, loadSettings } from './settings'
import { isAdminEmail } from './auth'
import { parseDiscoverPassage, takeDiscoverPassage, DISCOVER_PACKAGE, parseSources, sourceLabel, type Discovery, type DiscoverReport, type Source } from '../shared/discover'
import { resolveVocabCount } from '../shared/passages'
import type { CardMeta } from '../shared/types'
import { rankOf } from './wordfreq'
import { vocabEstimate } from './level'

/*
 * 发现新词：读 HN / Reddit 最近的讨论 → 统计每个词出现在多少条内容里 → 去掉太常见的（按词频排名和你的词汇量）、
 * 词库里已有的、你标过「认识」的 → 最常出现的几十个交给 AI，按教练设定挑出值得学的，配上原帖例句。
 */

const UA = 'shiju/1.0 (self-hosted English learning app; https://github.com/caikaidev/wordcard)'
const FETCH_TIMEOUT = 15_000
/** 交给 AI 挑选的候选数 */
const MAX_CANDIDATES = 60
/** 每批最多推荐几个 */
const MAX_PICKS = 10

/* ------------------------------ 读取来源 ------------------------------ */

type Doc = { text: string; url: string | null; source: string }

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'user-agent': UA, accept: 'application/json', ...init?.headers }, signal: AbortSignal.timeout(FETCH_TIMEOUT) })
  if (!res.ok) throw new HttpError(res.status)
  return (await res.json()) as T
}

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`)
  }
}

/** HN：最近的约 500 条评论（Algolia 的公开接口，不需要 key） */
async function fetchHN(env: Env): Promise<Doc[]> {
  const since = Math.floor(Date.now() / 1000) - 86400
  const r = await getJson<{ hits: { objectID: string; comment_text?: string | null }[] }>(
    `${env.SOURCE_TEST_BASE || 'https://hn.algolia.com'}/api/v1/search_by_date?tags=comment&hitsPerPage=500&numericFilters=created_at_i>${since}`,
  )
  return r.hits
    .filter((h) => h.comment_text)
    .map((h) => ({ text: h.comment_text!, url: `https://news.ycombinator.com/item?id=${h.objectID}`, source: 'HN' }))
}

let redditToken: { value: string; exp: number } | null = null

/** 配了 Reddit 应用（client credentials）就走官方 OAuth 接口；没配就试公开 JSON，云服务器上经常被拒 */
async function redditBase(env: Env): Promise<{ base: string; headers: Record<string, string> }> {
  if (!env.REDDIT_CLIENT_ID || !env.REDDIT_CLIENT_SECRET) return { base: env.SOURCE_TEST_BASE || 'https://www.reddit.com', headers: {} }
  if (!redditToken || redditToken.exp < Date.now() + 60_000) {
    const r = await getJson<{ access_token?: string; expires_in?: number }>('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: { authorization: `Basic ${btoa(`${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`)}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    })
    if (!r.access_token) throw new Error('Reddit 登录失败，检查 REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET')
    redditToken = { value: r.access_token, exp: Date.now() + (r.expires_in ?? 3600) * 1000 }
  }
  return { base: 'https://oauth.reddit.com', headers: { authorization: `Bearer ${redditToken.value}` } }
}

type RedditThing = { kind: string; data: Record<string, unknown> & { children?: RedditThing[]; replies?: { data?: { children?: RedditThing[] } } | '' } }

/** Reddit：本周热门帖子的标题和正文，加上评论最多的 3 个帖子里的评论 */
async function fetchReddit(env: Env, sub: string): Promise<Doc[]> {
  const { base, headers } = await redditBase(env)
  const label = `r/${sub}`
  const listing = await getJson<{ data: { children: RedditThing[] } }>(`${base}/r/${sub}/top.json?t=week&limit=25&raw_json=1`, { headers })
  const posts = listing.data.children.map((c) => c.data).filter((p) => !p.stickied)
  const docs: Doc[] = posts.map((p) => ({
    text: `${p.title ?? ''}\n${p.selftext ?? ''}`,
    url: `https://www.reddit.com${p.permalink ?? ''}`,
    source: label,
  }))
  const busiest = [...posts].sort((a, b) => Number(b.num_comments ?? 0) - Number(a.num_comments ?? 0)).slice(0, 3)
  const threads = await Promise.allSettled(
    busiest.map((p) => getJson<RedditThing[]>(`${base}/r/${sub}/comments/${p.id}.json?limit=80&depth=3&sort=top&raw_json=1`, { headers })),
  )
  const walk = (things: RedditThing[] | undefined) => {
    for (const t of things ?? []) {
      if (t.kind !== 't1') continue
      if (typeof t.data.body === 'string') docs.push({ text: t.data.body, url: `https://www.reddit.com${t.data.permalink ?? ''}`, source: label })
      if (t.data.replies) walk(t.data.replies.data?.children)
    }
  }
  for (const t of threads) if (t.status === 'fulfilled') walk(t.value[1]?.data.children)
  return docs
}

async function fetchSource(env: Env, s: Source): Promise<Doc[]> {
  return s.kind === 'hn' ? fetchHN(env) : fetchReddit(env, s.sub)
}

function sourceError(env: Env, s: Source, e: unknown) {
  if (e instanceof HttpError) {
    if (s.kind === 'reddit' && (e.status === 403 || e.status === 429) && !env.REDDIT_CLIENT_ID)
      return 'Reddit 拒绝了来自云服务器的请求，配置 REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET 后就能读（见部署文档）'
    if (s.kind === 'reddit' && e.status === 404) return '没有这个版块'
    if (s.kind === 'reddit' && e.status === 403) return '版块是私密的或被封禁了'
    return `读取失败（${e.status}）`
  }
  if (e instanceof DOMException && e.name === 'TimeoutError') return '读取超时'
  return e instanceof Error ? e.message : '读取失败'
}

/* ------------------------------ 统计词频 ------------------------------ */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** HTML / Markdown → 纯文本：去掉代码块、链接地址、标签 */
export function plainText(raw: string) {
  return raw
    .replace(/<pre[\s\S]*?<\/pre>/gi, ' ')
    .replace(/<code[\s\S]*?<\/code>/gi, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/<(p|br|li|div)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[‘’]/g, "'")
}

export type Candidate = { word: string; rank: number; hits: number; example: string; url: string | null; source: string }

/**
 * 统计每个词出现在多少条内容里（同一条里重复出现只算一次，防止刷屏的帖子带偏）；
 * 句中大写多于小写的当作专有名词跳过；只保留词频排名在 cutoff 之后的词
 */
export function extractCandidates(docs: Doc[], cutoff: number, exclude: Set<string>, limit = MAX_CANDIDATES): Candidate[] {
  type Stat = { hits: number; lower: number; upper: number; example: string; exampleScore: number; url: string | null; source: string }
  const stats = new Map<string, Stat>()
  docs.forEach((doc) => {
    const seen = new Set<string>()
    for (const sentence of plainText(doc.text).split(/(?<=[.!?])\s+|\n+/)) {
      const s = sentence.replace(/\s+/g, ' ').trim()
      if (!s) continue
      const tokens = s.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) ?? []
      const words = tokens.length
      tokens.forEach((tok, i) => {
        if (tok.includes("'") || tok.length < 3) return
        if (tok.length > 1 && tok === tok.toUpperCase()) return // 缩写
        const w = tok.toLowerCase()
        // 词表里没有的词（tradeoff、nontrivial 这类合成词）当作很少见；太短的多半是缩写或拼写错误
        const rank = rankOf(w) ?? (w.length >= 5 ? Infinity : 0)
        if (rank <= cutoff || exclude.has(w)) return
        let st = stats.get(w)
        if (!st) {
          st = { hits: 0, lower: 0, upper: 0, example: '', exampleScore: -Infinity, url: null, source: doc.source }
          stats.set(w, st)
        }
        if (i > 0) tok[0] === w[0] ? st.lower++ : st.upper++
        if (!seen.has(w)) {
          seen.add(w)
          st.hits++
        }
        // 例句：6–40 个词、长度接近 18 个词、词在句中是小写的最好
        if (words >= 6 && words <= 40 && s.length <= 300) {
          const score = -Math.abs(words - 18) + (tok[0] === w[0] ? 2 : 0)
          if (score > st.exampleScore) Object.assign(st, { example: s, exampleScore: score, url: doc.url, source: doc.source })
        }
      })
    }
  })
  return [...stats.entries()]
    .filter(([, st]) => st.hits >= 2 && st.example && st.lower >= st.upper)
    .map(([word, st]) => ({ word, rank: rankOf(word) ?? Infinity, hits: st.hits, example: st.example, url: st.url, source: st.source }))
    .sort((a, b) => b.hits - a.hits || b.rank - a.rank)
    .slice(0, limit)
}

/* ------------------------------ AI 挑选 ------------------------------ */

const pickSchema = {
  type: 'OBJECT',
  properties: {
    picks: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          index: { type: 'INTEGER' },
          text: { type: 'STRING' },
          ipa: { type: 'STRING' },
          pos: { type: 'STRING' },
          meaning: { type: 'STRING' },
          example: { type: 'STRING' },
          exampleZh: { type: 'STRING' },
          highlight: { type: 'STRING' },
          why: { type: 'STRING' },
        },
        required: ['index', 'text', 'ipa', 'pos', 'meaning', 'example', 'exampleZh', 'highlight', 'why'],
      },
    },
    passage: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING' },
        en: { type: 'STRING' },
        zh: { type: 'STRING' },
      },
      required: ['title', 'en', 'zh'],
    },
  },
  required: ['picks'],
}

type Pick = { index: number; text: string; ipa: string; pos: string; meaning: string; example: string; exampleZh: string; highlight: string; why: string }

function pickPrompt(cands: Candidate[], profile: string, vocab: number) {
  const list = cands.map((c, i) => `${i}. ${c.word}（出现在 ${c.hits} 条内容里）例句：${c.example}`).join('\n')
  return `你是英语教练。下面是最近 Hacker News / Reddit 讨论里反复出现、而学习者大概率还没学的词（已经按词频去掉了最常见的约 ${vocab} 个词），每个词附一句原帖例句。

学习者的情况：
${profile}

请从中挑出最多 ${MAX_PICKS} 个最值得这个学习者学的词，按价值从高到低排列。
挑选原则：
- 优先：在讨论、工作交流里常用，学会了能直接用来表达观点的词
- 跳过：人名、地名、品牌和产品名、编程标识符、缩写、拼写错误、粗俗俚语、过于狭窄的专业术语
- 跳过：词汇量 ${vocab} 左右的学习者基本都认识的词
- 宁缺毋滥，没有合适的可以少挑

每个挑出的词：
- index：上面列表里的序号
- text：词典原形（如 leveraging → leverage）；如果这个词在例句里主要以固定搭配出现，可以写成不超过 4 个词的短语
- ipa：美式音标，带斜杠
- pos：词性缩写，如 v. / n. / adj. / phr.
- meaning：贴合例句语境的简洁中文释义
- example：用原帖例句，可以截短到 30 个词以内，只改明显的错别字，不要改写
- exampleZh：例句的中文翻译
- highlight：例句里这个词实际出现的形式（必须是 example 的子串）
- why：一句中文，不超过 30 个字，说明它在这些讨论里怎么用、为什么值得学

另外写一篇短文 passage，把你挑出的词自然地用进去：
- title：英文标题，不超过 8 个词
- en：120 到 220 个英文词，3 到 6 句，同一场景的连贯短文，不是词表，也不是把例句拼在一起
- 至少让 4 个挑出的词（不够 4 个就全部）以原形或合理词形出现在 en 里
- zh：整段自然的中文
- 不要在短文里逐词解释

候选词：
${list}`
}

/* ------------------------------ 运行一次 ------------------------------ */

const toMeta = (p: Pick): CardMeta & { why: string } => {
  const s = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
  const example = s(p.example, 400)
  const highlight = s(p.highlight, 100)
  return {
    ipa: s(p.ipa, 100),
    pos: s(p.pos, 30),
    meaning: s(p.meaning, 300),
    example,
    exampleZh: s(p.exampleZh, 400),
    highlight: highlight && example.includes(highlight) ? highlight : '',
    phrases: [],
    why: s(p.why, 80),
  }
}

/** 已经在词库、标过认识、推荐过的词：都不再推荐 */
async function excluded(db: D1Database, user: string) {
  const [items, known, seen] = await db.batch<{ w: string }>([
    db.prepare('SELECT lower(text) AS w FROM items WHERE user_id = ?').bind(user),
    db.prepare('SELECT lower(word) AS w FROM known_words WHERE user_id = ?').bind(user),
    // 推荐过的词：原形和帖子里的原词（如 move the goalposts ← goalposts）都算
    db.prepare(`SELECT lower(text) AS w FROM discoveries WHERE user_id = ?1 UNION SELECT lower(json_extract(meta, '$.from')) FROM discoveries WHERE user_id = ?1`).bind(user),
  ])
  return new Set([...items.results, ...known.results, ...seen.results].map((r) => r.w).filter(Boolean))
}

/** 词汇量选「自动」时，用词汇评级的估算；还没测过就按 5000 */
async function vocabCutoff(env: Env, user: string, level: number) {
  if (level) return level
  const est = await vocabEstimate(env, user)
  return resolveVocabCount(0, est.vocab)
}

export async function runDiscover(env: Env, user: string, admin: boolean): Promise<{ report: DiscoverReport; ids: number[] }> {
  const settings = await loadSettings(env, user)
  const sources = parseSources(settings.discoverSources)
  const results = await Promise.allSettled(sources.map((s) => fetchSource(env, s)))
  const report: DiscoverReport = { sources: [], candidates: 0, added: 0 }
  const docs: Doc[] = []
  results.forEach((r, i) => {
    const label = sourceLabel(sources[i])
    if (r.status === 'fulfilled') {
      docs.push(...r.value)
      report.sources.push({ label, docs: r.value.length })
    } else {
      console.warn('discover source failed', label, r.reason)
      report.sources.push({ label, docs: 0, error: sourceError(env, sources[i], r.reason) })
    }
  })
  if (!docs.length) return { report, ids: [] }

  const skip = await excluded(env.DB, user)
  const cutoff = await vocabCutoff(env, user, settings.vocabLevel)
  const cands = extractCandidates(docs, cutoff, skip)
  report.candidates = cands.length
  if (!cands.length) return { report, ids: [] }

  const ai = await aiEnv(env, user, admin)
  const generated = await generateJson<{ picks: Pick[]; passage?: { title?: string; en?: string; zh?: string } }>(
    ai,
    pickPrompt(cands, settings.coachProfile, cutoff),
    pickSchema,
    'discover',
    0.4,
  )
  const picks = generated.picks
  const now = Date.now()
  const insert = env.DB.prepare(
    `INSERT OR IGNORE INTO discoveries (user_id, text, meta, source, url, hits, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  )
  const stmts: D1PreparedStatement[] = []
  const taken = new Set<string>()
  const planned: { text: string; meta: ReturnType<typeof toMeta>; from: string; source: string; url: string | null; hits: number }[] = []
  for (const p of (picks ?? []).slice(0, MAX_PICKS)) {
    const c = cands[p.index]
    const text = typeof p.text === 'string' ? p.text.trim().replace(/\s+/g, ' ').slice(0, 60) : ''
    const key = text.toLowerCase()
    // AI 还原成原形之后，可能撞上词库里已有的词
    if (!c || !text || skip.has(key) || taken.has(key)) continue
    taken.add(key)
    const meta = toMeta(p)
    if (!meta.meaning) continue
    if (!meta.example) Object.assign(meta, { example: c.example, highlight: c.example.includes(c.word) ? c.word : '' })
    planned.push({ text, meta, from: c.word, source: c.source, url: c.url, hits: c.hits })
  }
  const passage = takeDiscoverPassage(generated.passage, planned.map((row) => row.text), now)
  report.passage = !!passage
  for (const row of planned) {
    stmts.push(
      insert.bind(user, row.text, JSON.stringify({ ...row.meta, from: row.from, ...(passage ? { passage } : {}) }), row.source, row.url, row.hits, now),
    )
  }
  const res = stmts.length ? await env.DB.batch<{ id: number }>(stmts) : []
  const ids = res.flatMap((r) => r.results.map((x) => x.id))
  report.added = ids.length
  return { report, ids }
}

type DiscoveryRow = { id: number; text: string; meta: string; source: string; url: string | null; hits: number; created_at: number }

const toDiscovery = (r: DiscoveryRow): Discovery => {
  let m: Partial<CardMeta & { why: string; from: string; passage?: unknown }> = {}
  try {
    m = JSON.parse(r.meta)
  } catch {
    /* 坏数据当空的 */
  }
  const { why = '', from: _, passage: passageRaw, ...meta } = m
  return {
    id: r.id,
    text: r.text,
    meta: { ipa: '', pos: '', meaning: '', example: '', exampleZh: '', highlight: '', phrases: [], ...meta },
    why,
    source: r.source,
    url: r.url,
    hits: r.hits,
    created_at: r.created_at,
    passage: parseDiscoverPassage(passageRaw),
  }
}

/** 把候选词加进词库（放进「社区热词」学习包），返回实际新增的条数 */
export async function addToLibrary(db: D1Database, user: string, ids: number[]) {
  if (!ids.length) return 0
  const now = Date.now()
  await db
    .prepare(`INSERT OR IGNORE INTO packages (user_id, title, source_type, created_at) VALUES (?, ?, 'community', ?)`)
    .bind(user, DISCOVER_PACKAGE, now)
    .run()
  const pkg = await db.prepare('SELECT id FROM packages WHERE user_id = ? AND title = ? COLLATE NOCASE').bind(user, DISCOVER_PACKAGE).first<{ id: number }>()
  const { results } = await db
    .prepare(`SELECT * FROM discoveries WHERE user_id = ? AND status = 'new' AND id IN (${ids.map(() => '?').join(',')})`)
    .bind(user, ...ids)
    .all<DiscoveryRow>()
  if (!results.length) return 0
  const stmts = results.flatMap((r) => {
    const d = toDiscovery(r)
    return [
      db
        .prepare(
          `INSERT OR IGNORE INTO items (type, text, meta, due_at, created_at, updated_at, user_id, package_id, source_ref)
           VALUES ('word', ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(d.text, JSON.stringify(d.meta), now, now, now, user, pkg?.id ?? null, d.source),
      db.prepare(`UPDATE discoveries SET status = 'added' WHERE id = ?`).bind(d.id),
    ]
  })
  const res = await db.batch(stmts)
  return res.filter((_, i) => i % 2 === 0).reduce((n, r) => n + (r.meta.changes ?? 0), 0)
}

/** 定时任务（每天早上）：开了「自动」的人，找一批新词直接加进复习 */
export async function autoDiscover(env: Env) {
  const { results } = await env.DB.prepare(`SELECT user_id FROM user_settings WHERE key = 'discoverAuto' AND value = '1'`).all<{ user_id: string }>()
  for (const { user_id: user } of results) {
    try {
      const { ids } = await runDiscover(env, user, isAdminEmail(env, user))
      await addToLibrary(env.DB, user, ids)
    } catch (e) {
      console.error('auto discover failed', user, e)
    }
  }
}

/* ------------------------------ 接口 ------------------------------ */

export const discover = new Hono<AppEnv>()

discover.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM discoveries WHERE user_id = ? AND status = 'new' ORDER BY created_at DESC, hits DESC LIMIT 100`,
  )
    .bind(c.get('user'))
    .all<DiscoveryRow>()
  return c.json({ items: results.map(toDiscovery), redditAuth: !!(c.env.REDDIT_CLIENT_ID && c.env.REDDIT_CLIENT_SECRET) })
})

discover.post('/run', async (c) => {
  const { report, ids } = await runDiscover(c.env, c.get('user'), c.get('admin'))
  return c.json({ report, count: ids.length })
})

const idsOf = (v: unknown) => (Array.isArray(v) ? v.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 200) : [])

/** 学：加进词库 */
discover.post('/add', async (c) => {
  const body = await c.req.json<{ ids?: unknown }>().catch(() => null)
  const added = await addToLibrary(c.env.DB, c.get('user'), idsOf(body?.ids))
  return c.json({ added })
})

/** 认识：记下来，以后不再推荐 */
discover.post('/known', async (c) => {
  const body = await c.req.json<{ ids?: unknown }>().catch(() => null)
  const ids = idsOf(body?.ids)
  if (!ids.length) return c.json({ known: 0 })
  const user = c.get('user')
  const marks = ids.map(() => '?').join(',')
  const now = Date.now()
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO known_words (user_id, word, created_at)
       SELECT user_id, text, ? FROM discoveries WHERE user_id = ? AND id IN (${marks})`,
    ).bind(now, user, ...ids),
    c.env.DB.prepare(`UPDATE discoveries SET status = 'known' WHERE user_id = ? AND status = 'new' AND id IN (${marks})`).bind(user, ...ids),
  ])
  return c.json({ known: ids.length })
})
