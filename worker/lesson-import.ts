import { Hono, type MiddlewareHandler } from 'hono'
import type { AppEnv, Env } from './env'
import { isAdminEmail } from './auth'
import { aiEnv, loadSettings } from './settings'
import { cleanLesson, generateLesson } from './practice'
import { cleanQuest } from './quest'
import { parseLessonImport, type LessonImportReport } from '../shared/lesson-import'
import type { Level } from '../shared/practice'
import type { QuestContent } from '../shared/quest'

/*
 * 练习导入（shiju-lesson-v1）：调用方按格式传一篇文章，可以连练习内容、闯关题库一起整理好传进来。
 * 给了的部分直接入库、不调 AI；没给 lesson 就用 AI 根据原文出一份；没给 quest 就等第一次闯关时再出。
 * 两个入口：页面上传（走 Cloudflare Access 登录），以及 /api/ext/lessons（带个人令牌，给脚本和 AI 助手用）。
 */

const count = (q: Partial<QuestContent> | null | undefined) =>
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

/** Authorization: Bearer shiju_xxx → 对应的用户；令牌不对一律 401 */
const requireToken: MiddlewareHandler<AppEnv> = async (c, next) => {
  const m = /^Bearer\s+(shiju_[\w-]{20,64})$/.exec(c.req.header('authorization') ?? '')
  if (!m) return c.json({ error: '缺少令牌：请求头加上 Authorization: Bearer shiju_…（在设置页「API 令牌」里创建）' }, 401)
  const hash = await sha256(m[1])
  const row = await c.env.DB.prepare('SELECT id, user_id FROM api_tokens WHERE hash = ?').bind(hash).first<{ id: number; user_id: string }>()
  if (!row) return c.json({ error: '令牌无效或已被删除' }, 401)
  c.executionCtx.waitUntil(c.env.DB.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').bind(Date.now(), row.id).run())
  c.set('user', row.user_id)
  c.set('admin', isAdminEmail(c.env, row.user_id))
  await next()
}

export const ext = new Hono<AppEnv>()

ext.use('*', requireToken)

/** 测试令牌是否可用 */
ext.get('/me', (c) => c.json({ email: c.get('user') }))

ext.post('/lessons', async (c) => {
  const body = await c.req.json().catch(() => null)
  const r = await importLesson(c.env, c.get('user'), c.get('admin'), body, new URL(c.req.url).origin)
  if ('error' in r) return c.json(r, 400)
  return c.json(r, 201)
})
