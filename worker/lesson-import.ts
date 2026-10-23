import { Hono, type MiddlewareHandler } from 'hono'
import type { AppEnv, Env } from './env'
import { isAdminEmail } from './auth'
import { aiEnv, loadSettings } from './settings'
import { cleanLesson, generateLesson } from './practice'
import { cleanQuest } from './quest'
import { parseLessonImport, type LessonImportReport } from '../shared/lesson-import'
import { blocked, hit } from './ratelimit'
import type { Level } from '../shared/practice'
import type { QuestContent } from '../shared/quest'

/*
 * 练习导入（shiju-lesson-v1）：调用方按格式传一篇文章，可以连练习内容、闯关题库一起整理好传进来。
 * 给了的部分直接入库、不调 AI；没给 lesson 就用 AI 根据原文出一份；没给 quest 就等第一次闯关时再出。
 * 两个入口：页面上传（走 Cloudflare Access 登录），以及 /api/ext/lessons（带个人令牌，给脚本和 AI 助手用）。
 */

const count = (q: Partial<QuestContent> | null | undefined) =>
  (q?.speaking?.length ?? 0) +
  (q?.words?.length ?? 0) +
  (q?.listening?.length ?? 0) +
  (q?.cloze?.length ?? 0) +
  (q?.reading ?? []).reduce((n, r) => n + (Array.isArray(r?.questions) ? r.questions.length : 0), 0)

export async function importLesson(env: Env, user: string, admin: boolean, raw: unknown, origin: string): Promise<{ error: string } | LessonImportReport> {
  const parsed = parseLessonImport(raw)
  if (!parsed.ok) return { error: parsed.error }
  const d = parsed.data
  const settings = await loadSettings(env, user)
  const level: Level = d.level ?? settings.practiceLevel

  let generatedLesson = false
  let content
  if (d.lesson) {
    content = cleanLesson({ ...d.lesson, title: d.lesson.title || d.title }, level)
  } else {
    content = await generateLesson(await aiEnv(env, user, admin), settings.coachProfile, level, d.text!)
    generatedLesson = true
    if (d.title) content.title = d.title
  }
  if (!content.title || content.title === 'Untitled') content.title = d.title || 'Untitled'

  const quest = d.quest ? cleanQuest(d.quest) : null
  const hasQuest = !!quest && count(quest) > 0
  const dropped = d.quest ? Math.max(0, count(d.quest) - count(quest)) : 0

  const now = Date.now()
  const row = await env.DB.prepare(
    'INSERT INTO lessons (created_at, level, source_url, title, content, user_id, source_text) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
  )
    .bind(now, level, d.sourceUrl, content.title, JSON.stringify(content), user, d.text)
    .first<{ id: number }>()
  const id = row!.id
  if (hasQuest) {
    await env.DB.prepare('INSERT INTO quests (lesson_id, user_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .bind(id, user, JSON.stringify(quest), now, now)
      .run()
  }
  return { id, title: content.title, generatedLesson, hasQuest, dropped, url: `${origin}/practice/${id}${hasQuest ? '/path' : ''}` }
}

/* ------------------------------ 个人令牌 ------------------------------ */

async function sha256(text: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const newToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return `shiju_${btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
}

const MAX_TOKENS = 10

/** 令牌管理（在登录后的页面里用） */
export const tokens = new Hono<AppEnv>()

tokens.get('/', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id, name, prefix, created_at, last_used_at FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC')
    .bind(c.get('user'))
    .all()
  return c.json({ tokens: results })
})

tokens.post('/', async (c) => {
  const user = c.get('user')
  const body = await c.req.json<{ name?: unknown }>().catch(() => null)
  const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 40) : '未命名'
  const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ?').bind(user).first<{ n: number }>()
  if ((n?.n ?? 0) >= MAX_TOKENS) return c.json({ error: `最多 ${MAX_TOKENS} 个令牌，先删掉不用的` }, 400)
  const token = newToken()
  const row = await c.env.DB.prepare('INSERT INTO api_tokens (user_id, name, hash, prefix, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id')
    .bind(user, name, await sha256(token), token.slice(0, 12), Date.now())
    .first<{ id: number }>()
  // 明文只在这里返回一次
  return c.json({ id: row!.id, name, token }, 201)
})

tokens.delete('/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM api_tokens WHERE id = ? AND user_id = ?').bind(Number(c.req.param('id')), c.get('user')).run()
  return c.body(null, 204)
})

/* ------------------------------ 外部接口 /api/ext ------------------------------ */

/* 防护：
 * - 令牌是 24 字节随机数（猜不出来），库里只存 SHA-256，泄露数据库也拿不到明文
 * - 同一个 IP 10 分钟内令牌错 10 次，之后 10 分钟内直接拒绝，不再查库
 * - 请求体最大 1 MB；导入按用户限流（换令牌也绕不过）：两次之间至少隔几分钟、每天有上限，都可以在 wrangler.jsonc 里调
 */
const AUTH_FAIL_LIMIT = 10
const AUTH_FAIL_WINDOW = 10 * 60_000
const MAX_BODY = 1024 * 1024
const DAY = 86_400_000

const num = (v: string | undefined, d: number) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d)
export const extLimits = (env: Env) => ({
  /** 两次导入至少间隔多少秒 */
  interval: Math.max(0, num(env.EXT_IMPORT_INTERVAL, 180)),
  /** 每人 24 小时内最多导入几次（从第一次调用开始算） */
  daily: Math.max(1, num(env.EXT_IMPORT_DAILY_LIMIT, 30)),
})

const tooMany = (c: Parameters<MiddlewareHandler<AppEnv>>[0], retryAfter: number, why: string) => {
  c.header('retry-after', String(retryAfter))
  const wait = retryAfter >= 3600 ? `${Math.ceil(retryAfter / 3600)} 小时` : retryAfter >= 60 ? `${Math.ceil(retryAfter / 60)} 分钟` : `${retryAfter} 秒`
  return c.json({ error: `${why}，${wait}后再试`, retryAfter }, 429)
}

/** Authorization: Bearer shiju_xxx → 对应的用户；令牌不对一律 401 */
const requireToken: MiddlewareHandler<AppEnv> = async (c, next) => {
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown'
  const failKey = `authfail:${ip}`
  const wait = await blocked(c.env.DB, failKey, AUTH_FAIL_LIMIT, AUTH_FAIL_WINDOW)
  if (wait) return tooMany(c, wait, '令牌错误次数太多')

  const fail = async (msg: string) => {
    await hit(c.env.DB, failKey, AUTH_FAIL_LIMIT, AUTH_FAIL_WINDOW)
    return c.json({ error: msg }, 401)
  }
  const m = /^Bearer\s+(shiju_[\w-]{20,64})$/.exec(c.req.header('authorization') ?? '')
  if (!m) return fail('缺少令牌：请求头加上 Authorization: Bearer shiju_…（在设置页「API 令牌」里创建）')
  const hash = await sha256(m[1])
  const row = await c.env.DB.prepare('SELECT id, user_id FROM api_tokens WHERE hash = ?').bind(hash).first<{ id: number; user_id: string }>()
  if (!row) return fail('令牌无效或已被删除')
  c.executionCtx.waitUntil(c.env.DB.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').bind(Date.now(), row.id).run())
  c.set('user', row.user_id)
  c.set('admin', isAdminEmail(c.env, row.user_id))
  await next()
}

export const ext = new Hono<AppEnv>()

ext.use('*', requireToken)

/** 测试令牌是否可用；顺便告诉调用方限流规则 */
ext.get('/me', async (c) => {
  const r = await hit(c.env.DB, `me:${c.get('user')}`, 30, 60_000)
  if (!r.ok) return tooMany(c, r.retryAfter, '调用太频繁')
  const lim = extLimits(c.env)
  return c.json({ email: c.get('user'), limits: { importIntervalSeconds: lim.interval, importDailyLimit: lim.daily } })
})

ext.post('/lessons', async (c) => {
  if (Number(c.req.header('content-length') ?? 0) > MAX_BODY) return c.json({ error: '请求体太大，最多 1 MB' }, 413)
  const text = await c.req.text()
  if (text.length > MAX_BODY) return c.json({ error: '请求体太大，最多 1 MB' }, 413)
  let body: unknown = null
  try {
    body = JSON.parse(text)
  } catch {
    return c.json({ error: '请求体不是合法的 JSON' }, 400)
  }
  // 先检查格式（不花钱、不计次），格式对了再计入限流，调试时传错格式不会被卡住
  const parsed = parseLessonImport(body)
  if (!parsed.ok) return c.json({ error: parsed.error }, 400)

  const user = c.get('user')
  const lim = extLimits(c.env)
  // 先查间隔再计每日次数：被间隔挡下的请求不占每日额度
  if (lim.interval) {
    const gap = await hit(c.env.DB, `import:${user}`, 1, lim.interval * 1000)
    if (!gap.ok) return tooMany(c, gap.retryAfter, `导入太频繁：每 ${lim.interval < 60 ? `${lim.interval} 秒` : `${Math.round(lim.interval / 60)} 分钟`}最多一次`)
  }
  const day = await hit(c.env.DB, `import-day:${user}`, lim.daily, DAY)
  if (!day.ok) return tooMany(c, day.retryAfter, `24 小时内已经导入 ${lim.daily} 次了`)

  const r = await importLesson(c.env, user, c.get('admin'), body, new URL(c.req.url).origin)
  if ('error' in r) return c.json(r, 400)
  return c.json(r, 201)
})
