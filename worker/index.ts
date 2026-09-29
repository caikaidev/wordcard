import { Hono } from 'hono'
import type { Env } from './env'
import { requireAccess } from './auth'
import { enrich, remix, tts, GeminiError } from './gemini'
import { schedule } from '../shared/srs'
import type { CardMeta, Grade, Item, ItemStatus, ItemType } from '../shared/types'

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
  }
}

const cleanText = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, 500) : '')
const isType = (v: unknown): v is ItemType => v === 'word' || v === 'sentence'
const isStatus = (v: unknown): v is ItemStatus => v === 'active' || v === 'done'

const app = new Hono<{ Bindings: Env }>().basePath('/api')

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
     FROM items`,
  )
    .bind(now)
    .first<{ active: number | null; done: number | null; due: number | null }>()
  return c.json({ active: r?.active ?? 0, done: r?.done ?? 0, due: r?.due ?? 0 })
})

/* ------------------------------ 词库 ------------------------------ */

app.get('/items', async (c) => {
  const status = c.req.query('status')
  const q = c.req.query('q')?.trim()
  const where: string[] = []
  const args: unknown[] = []
  if (isStatus(status)) {
    where.push('status = ?')
    args.push(status)
  }
  if (q) {
    where.push('(text LIKE ? OR meta LIKE ?)')
    args.push(`%${q}%`, `%${q}%`)
  }
  const sql = `SELECT * FROM items ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY ${status === 'done' ? 'updated_at DESC' : 'due_at ASC'} LIMIT 500`
  const { results } = await c.env.DB.prepare(sql)
    .bind(...args)
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
      `INSERT INTO items (type, text, meta, due_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
    )
      .bind(type, text, JSON.stringify(safeMeta(body.meta)), now, now, now)
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
  args.push(Date.now(), id)
  const row = await c.env.DB.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ? RETURNING *`)
    .bind(...args)
    .first<Row>()
  if (!row) return c.json({ error: '找不到这一条' }, 404)
  return c.json({ item: toItem(row) })
})

app.delete('/items/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM items WHERE id = ?').bind(Number(c.req.param('id'))).run()
  return c.body(null, 204)
})

/* ------------------------------ 复习 ------------------------------ */

app.get('/review', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM items WHERE status = 'active' AND due_at <= ? ORDER BY due_at ASC LIMIT 200`,
  )
    .bind(Date.now())
    .all<Row>()
  return c.json({ items: results.map(toItem) })
})

app.post('/review/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const { grade } = await c.req.json<{ grade?: unknown }>()
  if (grade !== 0 && grade !== 1 && grade !== 2) return c.json({ error: 'grade 必须是 0/1/2' }, 400)
  const cur = await c.env.DB.prepare('SELECT interval FROM items WHERE id = ?').bind(id).first<{ interval: number }>()
  if (!cur) return c.json({ error: '找不到这一条' }, 404)
  const now = Date.now()
  const next = schedule(cur.interval, grade as Grade, now)
  const row = await c.env.DB.prepare(
    `UPDATE items SET interval = ?, due_at = ?, reps = reps + 1, lapses = lapses + ?, updated_at = ?
     WHERE id = ? RETURNING *`,
  )
    .bind(next.interval, next.dueAt, grade === 0 ? 1 : 0, now, id)
    .first<Row>()
  return c.json({ item: toItem(row!) })
})

/* ------------------------------ AI ------------------------------ */

app.post('/enrich', async (c) => {
  const body = await c.req.json<{ text?: unknown; type?: unknown }>()
  const text = cleanText(body.text)
  if (!text) return c.json({ error: '内容不能为空' }, 400)
  return c.json(await enrich(c.env, text, isType(body.type) ? body.type : undefined))
})

app.post('/remix', async (c) => {
  const body = await c.req.json<{ exclude?: unknown }>().catch(() => ({}) as { exclude?: unknown })
  const exclude = Array.isArray(body.exclude) ? body.exclude.map(Number).filter(Number.isFinite).slice(0, 200) : []
  const notIn = exclude.length ? `AND id NOT IN (${exclude.map(() => '?').join(',')})` : ''

  // 优先用今天到期的词，不够 3 个再从其它进行中的词里随机补
  const due = await c.env.DB.prepare(
    `SELECT * FROM items WHERE status = 'active' AND due_at <= ? ${notIn} ORDER BY RANDOM() LIMIT 5`,
  )
    .bind(Date.now(), ...exclude)
    .all<Row>()
  let rows = due.results
  if (rows.length < 3) {
    const taken = [...exclude, ...rows.map((r) => r.id)]
    const notIn2 = taken.length ? `AND id NOT IN (${taken.map(() => '?').join(',')})` : ''
    const more = await c.env.DB.prepare(
      `SELECT * FROM items WHERE status = 'active' ${notIn2} ORDER BY RANDOM() LIMIT ?`,
    )
      .bind(...taken, 5 - rows.length)
      .all<Row>()
    rows = rows.concat(more.results)
  }
  if (!rows.length && exclude.length) {
    // 换一组时没有别的词了，就不再排除，从全部进行中的词里重新抽
    const all = await c.env.DB.prepare(`SELECT * FROM items WHERE status = 'active' ORDER BY RANDOM() LIMIT 5`).all<Row>()
    rows = all.results
  }
  if (!rows.length) return c.json({ error: '词库里还没有进行中的词，先去添加几个吧' }, 400)

  const items = rows.map(toItem)
  const sentences = await remix(
    c.env,
    items.map((i) => ({ text: i.text, meaning: i.meta.meaning })),
  )
  return c.json({ words: items.map((i) => ({ id: i.id, text: i.text })), sentences })
})

app.get('/tts', async (c) => {
  const text = cleanText(c.req.query('text'))
  if (!text) return c.json({ error: 'text 不能为空' }, 400)
  const slow = c.req.query('slow') === '1'

  const keySource = `${c.env.GEMINI_TTS_MODEL}|${c.env.GEMINI_VOICE}|${slow ? 'slow' : 'normal'}|${text}`
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(keySource))
  const key = `tts/${[...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')}.wav`

  const headers = {
    'content-type': 'audio/wav',
    // 同一个 URL 永远对应同一段音频，浏览器可以放心长期缓存
    'cache-control': 'private, max-age=31536000, immutable',
  }

  const cached = await c.env.AUDIO.get(key)
  if (cached) return new Response(cached.body, { headers })

  const wav = await tts(c.env, text, slow)
  await c.env.AUDIO.put(key, wav, { httpMetadata: { contentType: 'audio/wav' }, customMetadata: { text: text.slice(0, 200) } })
  return new Response(wav, { headers })
})

app.all('*', (c) => c.json({ error: 'Not found' }, 404))

export default app satisfies ExportedHandler<Env>
