import { Hono, type Context } from 'hono'
import type { AppEnv, Env } from './env'
import { requireAccess } from './auth'
import { enrich, remix, tts, GeminiError, aiCallCounts, aiLimits, pickSense } from './gemini'
import { lookup, SOURCE_LABEL } from './dictionary'
import { schedule } from '../shared/srs'
import type { CardMeta, Grade, Item, ItemStatus, ItemType, WeeklyReport } from '../shared/types'
import { aiEnv, defaultSettings, loadSettings, saveSettings } from './settings'
import { practice } from './practice'
import { costOf } from '../shared/pricing'
import { parseImport } from '../shared/import'

type Row = Omit<Item, 'meta'> & { meta: string }

const toItem = (r: Row): Item => ({ ...r, meta: safeMeta(r.meta) })

function safeMeta(raw: unknown): CardMeta {
  let m: Partial<CardMeta> = {}
  try {
    m = typeof raw === 'string' ? JSON.parse(raw) : ((raw as Partial<CardMeta>) ?? {})
  } catch {
    /* ignore */
  }
  const s = (v: unknown, max = 1000) => (typeof v === 'string' ? v.slice(0, max) : '')
  return {
    ipa: s(m.ipa, 100),
    pos: s(m.pos, 30),
    meaning: s(m.meaning),
    example: s(m.example),
    exampleZh: s(m.exampleZh),
    highlight: s(m.highlight, 200),
    phrases: Array.isArray(m.phrases)
      ? m.phrases.slice(0, 5).map((p) => ({ text: s(p?.text, 200), meaning: s(p?.meaning, 300) }))
      : [],
    definitionEn: s(m.definitionEn, 600),
    definitionSrc: s(m.definitionSrc, 60),
    memoryTip: s(m.memoryTip, 500) || undefined,
    cloze:
      m.cloze && typeof m.cloze === 'object' && s(m.cloze.answer, 200) && s(m.cloze.sentence, 400).includes('____')
        ? { scene: s(m.cloze.scene, 300), sentence: s(m.cloze.sentence, 400), answer: s(m.cloze.answer, 200) }
        : undefined,
  }
}

/** 列表 / 复习接口附带学习包名 */
const ITEM_COLS = `items.*, (SELECT title FROM packages WHERE packages.id = items.package_id) AS package_title`

const cleanText = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, 500) : '')
const isType = (v: unknown): v is ItemType => v === 'word' || v === 'sentence'
const isStatus = (v: unknown): v is ItemStatus => v === 'active' || v === 'done'

const app = new Hono<AppEnv>().basePath('/api')

type Ctx = Context<AppEnv>
/** 当前登录用户（邮箱）与是否管理员 */
const who = (c: Ctx) => ({ user: c.get('user'), admin: c.get('admin') })
const ai = (c: Ctx) => aiEnv(c.env, c.get('user'), c.get('admin'))

app.use('*', requireAccess)

app.onError((err, c) => {
  if (err instanceof GeminiError) return c.json({ error: err.message }, err.status as 500)
  console.error(err)
  return c.json({ error: '服务器出错了' }, 500)
})

/* ------------------------------ 统计 ------------------------------ */

app.get('/stats', async (c) => {
  const now = Date.now()
  const r = await c.env.DB.prepare(
    `SELECT
       SUM(status = 'active') AS active,
       SUM(status = 'done') AS done,
       SUM(status = 'active' AND due_at <= ?) AS due
     FROM items WHERE user_id = ?`,
  )
    .bind(now, who(c).user)
    .first<{ active: number | null; done: number | null; due: number | null }>()
  return c.json({ active: r?.active ?? 0, done: r?.done ?? 0, due: r?.due ?? 0 })
})

/* ------------------------------ 词库 ------------------------------ */

app.get('/items', async (c) => {
  const status = c.req.query('status')
  const q = c.req.query('q')?.trim()
  const pkg = Number(c.req.query('package'))
  const where: string[] = ['user_id = ?']
  const args: unknown[] = [who(c).user]
  if (Number.isInteger(pkg) && pkg > 0) {
    where.push('package_id = ?')
    args.push(pkg)
  }
  if (isStatus(status)) {
    where.push('status = ?')
    args.push(status)
  }
  // 只搜原文和看得见的字段（不搜整段 JSON，否则搜 "meaning" 之类会匹配到字段名）；
  // 排序：原文完全一致 → 原文开头 → 原文包含 → 释义 → 例句等，避免例句里顺带出现的词排在前面
  const order: string[] = []
  const orderArgs: unknown[] = []
  if (q) {
    const like = `%${q}%`
    where.push(
      `(text LIKE ? OR json_extract(meta, '$.meaning') LIKE ? OR json_extract(meta, '$.example') LIKE ?
        OR json_extract(meta, '$.exampleZh') LIKE ? OR json_extract(meta, '$.memoryTip') LIKE ?)`,
    )
    args.push(like, like, like, like, like)
    order.push(`CASE WHEN lower(text) = lower(?) THEN 0 WHEN text LIKE ? THEN 1 WHEN text LIKE ? THEN 2
                     WHEN json_extract(meta, '$.meaning') LIKE ? THEN 3 ELSE 4 END`)
    orderArgs.push(q, `${q}%`, like, like)
  }
  order.push(status === 'done' ? 'updated_at DESC' : 'due_at ASC')
  const sql = `SELECT ${ITEM_COLS} FROM items WHERE ${where.join(' AND ')}
               ORDER BY ${order.join(', ')} LIMIT 500`
  const { results } = await c.env.DB.prepare(sql)
    .bind(...args, ...orderArgs)
    .all<Row>()
  return c.json({ items: results.map(toItem) })
})

app.post('/items', async (c) => {
  const body = await c.req.json<{ type?: unknown; text?: unknown; meta?: unknown }>()
  const text = cleanText(body.text)
  if (!text) return c.json({ error: '内容不能为空' }, 400)
  const type: ItemType = isType(body.type) ? body.type : text.includes(' ') && /[.!?]$/.test(text) ? 'sentence' : 'word'
  const now = Date.now()
  try {
    const row = await c.env.DB.prepare(
      `INSERT INTO items (type, text, meta, due_at, created_at, updated_at, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    )
      .bind(type, text, JSON.stringify(safeMeta(body.meta)), now, now, now, who(c).user)
      .first<Row>()
    return c.json({ item: toItem(row!) }, 201)
  } catch (e) {
    if (String(e).includes('UNIQUE')) return c.json({ error: `「${text}」已经在词库里了` }, 409)
    throw e
  }
})

app.patch('/items/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json<{ text?: unknown; meta?: unknown; status?: unknown }>()
  const sets: string[] = []
  const args: unknown[] = []
  if (body.text !== undefined) {
    const text = cleanText(body.text)
    if (!text) return c.json({ error: '内容不能为空' }, 400)
    sets.push('text = ?')
    args.push(text)
  }
  if (body.meta !== undefined) {
    sets.push('meta = ?')
    args.push(JSON.stringify(safeMeta(body.meta)))
  }
  if (isStatus(body.status)) {
    sets.push('status = ?')
    args.push(body.status)
    // 从 DONE 移回来时，让它立刻进入复习
    if (body.status === 'active') {
      sets.push('due_at = ?')
      args.push(Date.now())
    }
  }
  if (!sets.length) return c.json({ error: '没有要修改的内容' }, 400)
  sets.push('updated_at = ?')
  args.push(Date.now(), id, who(c).user)
  const row = await c.env.DB.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ? AND user_id = ? RETURNING *`)
    .bind(...args)
    .first<Row>()
  if (!row) return c.json({ error: '找不到这一条' }, 404)
  return c.json({ item: toItem(row) })
})

/** 老卡片补查英英释义 */
app.post('/items/:id/define', async (c) => {
  const id = Number(c.req.param('id'))
  const row = await c.env.DB.prepare('SELECT * FROM items WHERE id = ? AND user_id = ?').bind(id, who(c).user).first<Row>()
  if (!row) return c.json({ error: '找不到这一条' }, 404)
  const item = toItem(row)
  if (item.type !== 'word') return c.json({ error: '句子没有词典释义' }, 400)
  const env = await ai(c)
  const dict = await lookup(env, item.text)
  if (!dict) return c.json({ error: '词典里没查到这个词' }, 404)
  const pick = await pickSense(env, item.text, dict, item.meta.meaning, item.meta.example)
  if (!pick) return c.json({ error: '词典义项和这张卡的意思对不上，先不填了' }, 404)
  const meta = { ...item.meta, definitionEn: pick.def, definitionSrc: SOURCE_LABEL[dict.source] }
  const updated = await c.env.DB.prepare('UPDATE items SET meta = ?, updated_at = ? WHERE id = ? AND user_id = ? RETURNING *')
    .bind(JSON.stringify(safeMeta(meta)), Date.now(), id, who(c).user)
    .first<Row>()
  return c.json({ item: toItem(updated!) })
})

app.delete('/items/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM items WHERE id = ? AND user_id = ?').bind(Number(c.req.param('id')), who(c).user).run()
  return c.body(null, 204)
})

/* ------------------------------ 学习包 ------------------------------ */

app.get('/packages', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.title, p.source_url, p.source_type, p.created_at,
            COUNT(i.id) AS total, COALESCE(SUM(i.status = 'done'), 0) AS done,
            COALESCE(SUM(EXISTS (SELECT 1 FROM lesson_cards lc WHERE lc.item_id = i.id AND lc.user_id = p.user_id)), 0) AS practiced,
            COALESCE(SUM(i.status = 'active' AND NOT EXISTS (SELECT 1 FROM lesson_cards lc WHERE lc.item_id = i.id AND lc.user_id = p.user_id)), 0) AS pending,
            (SELECT COUNT(*) FROM lessons l WHERE l.package_id = p.id AND l.user_id = p.user_id) AS lessons
     FROM packages p LEFT JOIN items i ON i.package_id = p.id AND i.user_id = p.user_id
     WHERE p.user_id = ? GROUP BY p.id ORDER BY p.created_at DESC`,
  )
    .bind(who(c).user)
    .all()
  return c.json({ packages: results })
})

/**
 * 导入学习包（shiju-import-v1）：不调 AI，直接入库。
 * 前端把大包切成小批多次提交；包按（用户, 包名）合并，同一个包可以分批、重复导入。
 */
app.post('/import', async (c) => {
  const body = await c.req.json<{ batch?: { offset?: unknown; total?: unknown } }>().catch(() => null)
  const parsed = parseImport(body)
  if (!parsed.ok) return c.json({ error: parsed.error }, 400)
  const { pkg, cards, invalid } = parsed
  const { user } = who(c)
  const now = Date.now()
  const db = c.env.DB
  // 大包分批提交时，前端带上本批在整包里的位置，保证跨批的先后顺序
  const offset = Math.max(0, Number(body?.batch?.offset) || 0)
  const total = Math.max(offset + cards.length, Number(body?.batch?.total) || 0)

  await db
    .prepare(
      `INSERT OR IGNORE INTO packages (user_id, title, source_url, source_type, difficulty_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(user, pkg.title, pkg.source_url ?? null, pkg.source_type ?? null, pkg.difficulty_order ? JSON.stringify(pkg.difficulty_order) : null, now)
    .run()
  const row = await db
    .prepare('SELECT id FROM packages WHERE user_id = ? AND title = ? COLLATE NOCASE')
    .bind(user, pkg.title)
    .first<{ id: number }>()
  const packageId = row!.id

  // 同一个词已经在词库里（不限包）就跳过；按包内顺序错开到期时间（都已到期），复习时先学靠前的
  const insert = db.prepare(
    `INSERT OR IGNORE INTO items (type, text, meta, due_at, created_at, updated_at, user_id, package_id, source_ref, difficulty)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  let added = 0
  for (let i = 0; i < cards.length; i += 50) {
    const chunk = cards.slice(i, i + 50)
    const res = await db.batch(
      chunk.map((card, j) =>
        insert.bind(
          card.type,
          card.text,
          JSON.stringify(safeMeta(card.meta)),
          now - (total - offset - i - j) * 1000,
          now,
          now,
          user,
          packageId,
          card.sourceRef || null,
          card.difficulty,
        ),
      ),
    )
    added += res.reduce((n, r) => n + (r.meta.changes ?? 0), 0)
  }
  return c.json({ packageId, added, skipped: cards.length - added, invalid })
})

/* ------------------------------ 复习 ------------------------------ */

app.get('/review', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT ${ITEM_COLS} FROM items WHERE user_id = ? AND status = 'active' AND due_at <= ? ORDER BY due_at ASC LIMIT 200`,
  )
    .bind(who(c).user, Date.now())
    .all<Row>()
  return c.json({ items: results.map(toItem) })
})

app.post('/review/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const { grade } = await c.req.json<{ grade?: unknown }>()
  if (grade !== 0 && grade !== 1 && grade !== 2) return c.json({ error: 'grade 必须是 0/1/2' }, 400)
  const cur = await c.env.DB.prepare('SELECT interval FROM items WHERE id = ? AND user_id = ?')
    .bind(id, who(c).user)
    .first<{ interval: number }>()
  if (!cur) return c.json({ error: '找不到这一条' }, 404)
  const now = Date.now()
  const next = schedule(cur.interval, grade as Grade, now)
  const row = await c.env.DB.prepare(
    `UPDATE items SET interval = ?, due_at = ?, reps = reps + 1, lapses = lapses + ?, updated_at = ?
     WHERE id = ? RETURNING *`,
  )
    .bind(next.interval, next.dueAt, grade === 0 ? 1 : 0, now, id)
    .first<Row>()
  // 评分流水：每周回顾用；记录失败不影响复习
  await c.env.DB.prepare('INSERT INTO reviews (user_id, item_id, grade, ts) VALUES (?, ?, ?, ?)')
    .bind(who(c).user, id, grade, now)
    .run()
    .catch((e) => console.error('log review failed', e))
  return c.json({ item: toItem(row!) })
})

/* ------------------------------ 每周回顾 ------------------------------ */

const WEEK_DAY = 86_400_000
const WEEK_TZ = 8 * 3600_000 // 北京时间，周一为一周的第一天

app.get('/weekly', async (c) => {
  const offset = Math.min(0, Math.max(-52, Math.trunc(Number(c.req.query('offset'))) || 0))
  const user = who(c).user
  const db = c.env.DB
  const now = Date.now()
  const today = Math.floor((now + WEEK_TZ) / WEEK_DAY)
  // 1970-01-01 是周四，所以 (day + 3) % 7 = 0 的那天是周一
  const mondayDay = today - ((today + 3) % 7) + offset * 7
  const start = mondayDay * WEEK_DAY - WEEK_TZ
  const end = start + 7 * WEEK_DAY

  const itemCounts = (from: number, to: number) =>
    db
      .prepare(
        `SELECT COALESCE(SUM(created_at >= ?1 AND created_at < ?2), 0) AS added,
                COALESCE(SUM(created_at >= ?1 AND created_at < ?2 AND package_id IS NOT NULL), 0) AS addedImported,
                COALESCE(SUM(status = 'done' AND updated_at >= ?1 AND updated_at < ?2), 0) AS mastered
         FROM items WHERE user_id = ?3`,
      )
      .bind(from, to, user)
  const reviewCount = (from: number, to: number) =>
    db.prepare('SELECT COUNT(*) AS n FROM reviews WHERE user_id = ? AND ts >= ? AND ts < ?').bind(user, from, to)

  const [cur, prev, prevReviews, perDay, practice, trouble, since] = await db.batch<Record<string, number | string | null>>([
    itemCounts(start, end),
    itemCounts(start - 7 * WEEK_DAY, start),
    reviewCount(start - 7 * WEEK_DAY, start),
    db
      .prepare(
        `SELECT CAST((ts + ?) / ? AS INTEGER) AS day, COUNT(*) AS n, SUM(grade = 2) AS remembered, SUM(grade = 0) AS forgot
         FROM reviews WHERE user_id = ? AND ts >= ? AND ts < ? GROUP BY day`,
      )
      .bind(WEEK_TZ, WEEK_DAY, user, start, end),
    db
      .prepare(
        `SELECT COUNT(DISTINCT CAST((created_at + ?) / ? AS INTEGER)) AS days, COUNT(*) AS n
         FROM submissions WHERE user_id = ? AND created_at >= ? AND created_at < ?`,
      )
      .bind(WEEK_TZ, WEEK_DAY, user, start, end),
    db
      .prepare(
        `SELECT i.text AS text, COUNT(*) AS n FROM reviews r JOIN items i ON i.id = r.item_id
         WHERE r.user_id = ? AND r.grade = 0 AND r.ts >= ? AND r.ts < ? GROUP BY r.item_id ORDER BY n DESC, i.text LIMIT 3`,
      )
      .bind(user, start, end),
    db.prepare('SELECT MIN(ts) AS ts FROM reviews WHERE user_id = ?').bind(user),
  ])

  const days = Array<number>(7).fill(0)
  let reviews = 0
  let remembered = 0
  let forgot = 0
  for (const r of perDay.results as unknown as { day: number; n: number; remembered: number; forgot: number }[]) {
    const i = r.day - mondayDay
    if (i >= 0 && i < 7) days[i] = r.n
    reviews += r.n
    remembered += r.remembered
    forgot += r.forgot
  }
  const p = practice.results[0] as { days: number; n: number }
  const cc = cur.results[0] as { added: number; addedImported: number; mastered: number }
  const pc = prev.results[0] as { added: number; mastered: number }
  const report: WeeklyReport = {
    offset,
    start,
    end,
    todayIdx: today >= mondayDay && today < mondayDay + 7 ? today - mondayDay : -1,
    perDay: days,
    added: cc.added,
    addedImported: cc.addedImported,
    reviews,
    remembered,
    forgot,
    mastered: cc.mastered,
    practiceDays: p.days,
    practiceSubmissions: p.n,
    trouble: trouble.results as unknown as { text: string; n: number }[],
    prev: { added: pc.added, reviews: (prevReviews.results[0] as { n: number }).n, mastered: pc.mastered },
    logSince: ((since.results[0] as { ts: number | null }).ts ?? null),
  }
  return c.json(report)
})

/* ------------------------------ AI ------------------------------ */

app.post('/enrich', async (c) => {
  const body = await c.req.json<{ text?: unknown; type?: unknown; context?: unknown }>()
  const text = cleanText(body.text)
  if (!text) return c.json({ error: '内容不能为空' }, 400)
  const env = await ai(c)
  const hint = isType(body.type) ? body.type : undefined
  const context = typeof body.context === 'string' ? body.context.trim().slice(0, 600) : undefined
  const dict = hint === 'sentence' ? null : await lookup(env, text)
  const r = await enrich(env, text, hint, dict, context || undefined)
  // 用户拼错了、AI 纠正之后，用纠正后的词再查一次词典
  if (!dict && r.type === 'word' && r.text.toLowerCase() !== text.toLowerCase()) {
    const d2 = await lookup(env, r.text)
    const pick = d2 && (await pickSense(env, r.text, d2, r.meta.meaning, r.meta.example))
    if (pick && d2) r.meta = { ...r.meta, definitionEn: pick.def, definitionSrc: SOURCE_LABEL[d2.source] }
  }
  return c.json(r)
})

/** 阅读时点词查义：只查词典，不调 AI、不花钱 */
app.get('/lookup', async (c) => {
  const word = (c.req.query('word') ?? '').trim().slice(0, 60)
  if (!word) return c.json({ error: '缺少 word' }, 400)
  const d = await lookup(c.env, word)
  return c.json(d ? { source: SOURCE_LABEL[d.source], senses: d.senses.slice(0, 6) } : { source: '', senses: [] })
})

app.post('/remix', async (c) => {
  const body = await c.req.json<{ exclude?: unknown }>().catch(() => ({}) as { exclude?: unknown })
  const exclude = Array.isArray(body.exclude) ? body.exclude.map(Number).filter(Number.isFinite).slice(0, 200) : []
  const notIn = exclude.length ? `AND id NOT IN (${exclude.map(() => '?').join(',')})` : ''

  // 优先用今天到期的词，不够 3 个再从其它进行中的词里随机补
  const user = who(c).user
  const due = await c.env.DB.prepare(
    `SELECT * FROM items WHERE user_id = ? AND status = 'active' AND due_at <= ? ${notIn} ORDER BY RANDOM() LIMIT 5`,
  )
    .bind(user, Date.now(), ...exclude)
    .all<Row>()
  let rows = due.results
  if (rows.length < 3) {
    const taken = [...exclude, ...rows.map((r) => r.id)]
    const notIn2 = taken.length ? `AND id NOT IN (${taken.map(() => '?').join(',')})` : ''
    const more = await c.env.DB.prepare(
      `SELECT * FROM items WHERE user_id = ? AND status = 'active' ${notIn2} ORDER BY RANDOM() LIMIT ?`,
    )
      .bind(user, ...taken, 5 - rows.length)
      .all<Row>()
    rows = rows.concat(more.results)
  }
  if (!rows.length && exclude.length) {
    // 换一组时没有别的词了，就不再排除，从全部进行中的词里重新抽
    const all = await c.env.DB.prepare(`SELECT * FROM items WHERE user_id = ? AND status = 'active' ORDER BY RANDOM() LIMIT 5`)
      .bind(user)
      .all<Row>()
    rows = all.results
  }
  if (!rows.length) return c.json({ error: '词库里还没有进行中的词，先去添加几个吧' }, 400)

  const items = rows.map(toItem)
  const sentences = await remix(
    await ai(c),
    items.map((i) => ({ text: i.text, meaning: i.meta.meaning })),
  )
  return c.json({ words: items.map((i) => ({ id: i.id, text: i.text })), sentences })
})

app.get('/tts', async (c) => {
  const text = cleanText(c.req.query('text'))
  if (!text) return c.json({ error: 'text 不能为空' }, 400)
  const slow = c.req.query('slow') === '1'

  const env = await ai(c)
  const key = await ttsKey(env, text, slow)

  const headers = {
    'content-type': 'audio/wav',
    // 同一个 URL 永远对应同一段音频，浏览器可以放心长期缓存
    'cache-control': 'private, max-age=31536000, immutable',
  }

  const cached = await c.env.AUDIO.get(key)
  if (cached) return new Response(cached.body, { headers })

  const wav = await tts(env, text, slow)
  await c.env.AUDIO.put(key, wav, { httpMetadata: { contentType: 'audio/wav' }, customMetadata: { text: text.slice(0, 200) } })
  return new Response(wav, { headers })
})

/* ------------------------------ 设置 ------------------------------ */

app.get('/settings', async (c) => {
  const { user, admin } = who(c)
  return c.json({ current: await loadSettings(c.env, user), defaults: defaultSettings(c.env), me: { email: user, admin } })
})

app.put('/settings', async (c) => {
  const { user, admin } = who(c)
  const err = await saveSettings(c.env, user, admin, await c.req.json<Record<string, unknown>>())
  if (err) return c.json({ error: err }, err.includes('管理员') ? 403 : 400)
  return c.json({ current: await loadSettings(c.env, user), me: { email: user, admin } })
})

app.route('/practice', practice)

/* ------------------------------ 用量与费用预估 ------------------------------ */

const TZ_OFFSET = 8 * 3600_000 // 按北京时间划分自然月

function monthStart(now: number, back = 0) {
  const d = new Date(now + TZ_OFFSET)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1) - TZ_OFFSET
}

app.get('/usage', async (c) => {
  const now = Date.now()
  const thisMonth = monthStart(now)
  const lastMonth = monthStart(now, 1)
  const { user, admin } = who(c)
  // 按 用户 × 天 × 模型 × 类型 汇总（单价可能随日期变化），再在这里算钱
  const { results: all } = await c.env.DB.prepare(
    `SELECT user_id, kind, model, CAST((ts + ?) / 86400000 AS INTEGER) AS day, COUNT(*) AS calls,
            SUM(input_tokens) AS input, SUM(output_tokens) AS output
     FROM usage WHERE ts >= ? ${admin ? '' : 'AND user_id = ?'} GROUP BY user_id, kind, model, day`,
  )
    .bind(TZ_OFFSET, lastMonth, ...(admin ? [] : [user]))
    .all<{ user_id: string; kind: string; model: string; day: number; calls: number; input: number; output: number }>()
  const results = all.filter((r) => r.user_id === user)

  // 管理员额外看到：本月每个人花了多少
  const byUser = new Map<string, { calls: number; cost: number }>()
  if (admin) {
    for (const r of all) {
      const ts = r.day * 86400000 - TZ_OFFSET + 12 * 3600_000
      if (ts < thisMonth) continue
      const u = byUser.get(r.user_id) ?? { calls: 0, cost: 0 }
      u.calls += r.calls
      u.cost += costOf(r.model, ts, r.input, r.output) ?? 0
      byUser.set(r.user_id, u)
    }
  }

  type Bucket = { calls: number; input: number; output: number; cost: number; unpriced: number }
  const empty = (): Bucket => ({ calls: 0, input: 0, output: 0, cost: 0, unpriced: 0 })
  const cur = { total: empty(), byKind: {} as Record<string, Bucket> }
  const prev = empty()

  for (const r of results) {
    const ts = r.day * 86400000 - TZ_OFFSET + 12 * 3600_000 // 当天中午，用来套单价
    const cost = costOf(r.model, ts, r.input, r.output)
    const target = ts >= thisMonth ? [cur.total, (cur.byKind[r.kind] ??= empty())] : [prev]
    for (const b of target) {
      b.calls += r.calls
      b.input += r.input
      b.output += r.output
      if (cost === null) b.unpriced += r.calls
      else b.cost += cost
    }
  }

  // 按本月已过天数线性外推到月底
  const nextMonth = monthStart(now, -1)
  const elapsed = Math.max((now - thisMonth) / 86400000, 1)
  const days = (nextMonth - thisMonth) / 86400000
  const counts = await aiCallCounts(await ai(c))
  const limits = aiLimits(c.env)
  return c.json({
    month: cur,
    lastMonth: prev,
    projected: (cur.total.cost / elapsed) * days,
    // 管理员看全站额度；普通用户看自己的个人额度
    today: admin
      ? { text: counts.text, tts: counts.tts, textLimit: limits.text, ttsLimit: limits.tts, disabled: limits.disabled }
      : { text: counts.userText, tts: counts.userTts, textLimit: limits.userText, ttsLimit: limits.userTts, disabled: limits.disabled },
    users: admin
      ? [...byUser.entries()].map(([email, v]) => ({ email: email || '（未归属）', ...v })).sort((a, b) => b.cost - a.cost)
      : undefined,
  })
})

/* ------------------------------ 音频缓存管理 ------------------------------ */

/** R2 免费额度：10 GB 存储 */
const R2_FREE_BYTES = 10 * 1024 ** 3

async function ttsKey(env: Env, text: string, slow: boolean) {
  // v2：旧缓存里的音频带了朗读说明前缀，换个 key 让它们失效
  const keySource = `v2|${env.GEMINI_TTS_MODEL}|${env.GEMINI_VOICE}|${slow ? 'slow' : 'normal'}|${text}`
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(keySource))
  return `tts/${[...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')}.wav`
}

async function listAudio(bucket: R2Bucket) {
  const objects: { key: string; size: number }[] = []
  let cursor: string | undefined
  do {
    const page = await bucket.list({ prefix: 'tts/', cursor, limit: 1000 })
    for (const o of page.objects) objects.push({ key: o.key, size: o.size })
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return objects
}

/** 词库里（所有人的进行中 + DONE）所有词条正在用的音频 key —— 缓存是共享的 */
async function usedKeys(env: Env) {
  const { results } = await env.DB.prepare('SELECT text, meta FROM items').all<{ text: string; meta: string }>()
  const keys = new Set<string>()
  for (const r of results) {
    const m = safeMeta(r.meta)
    for (const t of [r.text, m.example]) {
      const text = cleanText(t)
      if (text) keys.add(await ttsKey(env, text, false))
    }
  }
  return keys
}

/** 音频缓存是全站共用的，统计和清理只有管理员能做 */
app.use('/storage/*', async (c, next) => (c.get('admin') ? next() : c.json({ error: '只有管理员可以管理音频缓存' }, 403)))
app.use('/storage', async (c, next) => (c.get('admin') ? next() : c.json({ error: '只有管理员可以管理音频缓存' }, 403)))

app.get('/storage', async (c) => {
  const [objects, used] = await Promise.all([listAudio(c.env.AUDIO), usedKeys(await ai(c))])
  const unused = objects.filter((o) => !used.has(o.key))
  const sum = (l: { size: number }[]) => l.reduce((n, o) => n + o.size, 0)
  return c.json({
    count: objects.length,
    bytes: sum(objects),
    unusedCount: unused.length,
    unusedBytes: sum(unused),
    limitBytes: R2_FREE_BYTES,
  })
})

app.post('/storage/cleanup', async (c) => {
  const { mode } = await c.req.json<{ mode?: unknown }>().catch(() => ({ mode: undefined }))
  if (mode !== 'unused' && mode !== 'all') return c.json({ error: 'mode 必须是 unused 或 all' }, 400)
  const objects = await listAudio(c.env.AUDIO)
  const used = mode === 'unused' ? await usedKeys(await ai(c)) : new Set<string>()
  const doomed = objects.filter((o) => !used.has(o.key))
  for (let i = 0; i < doomed.length; i += 1000) {
    await c.env.AUDIO.delete(doomed.slice(i, i + 1000).map((o) => o.key))
  }
  return c.json({ deleted: doomed.length, freedBytes: doomed.reduce((n, o) => n + o.size, 0) })
})

app.all('*', (c) => c.json({ error: 'Not found' }, 404))

export default app satisfies ExportedHandler<Env>
