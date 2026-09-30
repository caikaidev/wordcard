import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { MiddlewareHandler } from 'hono'
import type { AppEnv, Env } from './env'

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

/**
 * 校验 Cloudflare Access 签发的 JWT。
 * 即使有人绕过 Access（比如直接访问 workers.dev 域名），没有合法 JWT 也拿不到任何数据。
 * 没配置 ACCESS_TEAM_DOMAIN / ACCESS_AUD 时默认拒绝（fail closed）。
 */
export const requireAccess: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.env.AUTH_DISABLED === 'true') {
    // 本地开发：用 DEV_USER 模拟登录（可在请求头 x-dev-user 里临时切换，方便测试多用户）
    return withUser(c, c.req.header('x-dev-user') || c.env.DEV_USER || 'dev@localhost', next)
  }

  const team = c.env.ACCESS_TEAM_DOMAIN?.replace(/^https?:\/\//, '').replace(/\/$/, '')
  const aud = c.env.ACCESS_AUD
  if (!team || !aud) {
    return c.json({ error: '服务端未配置 Cloudflare Access（ACCESS_TEAM_DOMAIN / ACCESS_AUD）' }, 500)
  }

  const token =
    c.req.header('cf-access-jwt-assertion') ??
    c.req.header('cookie')?.match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1]
  if (!token) return c.json({ error: '未登录' }, 401)

  let jwks = jwksCache.get(team)
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`https://${team}/cdn-cgi/access/certs`))
    jwksCache.set(team, jwks)
  }
  let email = ''
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: `https://${team}`, audience: aud })
    email = typeof payload.email === 'string' ? payload.email : ''
  } catch {
    return c.json({ error: '登录已失效，请刷新页面' }, 403)
  }
  if (!email) return c.json({ error: '登录信息里没有邮箱，请联系管理员' }, 403)
  return withUser(c, email, next)
}

export const isAdminEmail = (env: Env, email: string) =>
  (env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase())

// 每个 Worker 实例只尝试认领一次旧数据
let claimed = false

async function withUser(c: Parameters<MiddlewareHandler<AppEnv>>[0], rawEmail: string, next: () => Promise<void>) {
  const email = rawEmail.trim().toLowerCase()
  const admin = isAdminEmail(c.env, email)
  c.set('user', email)
  c.set('admin', admin)
  if (admin && !claimed) {
    claimed = true
    await claimLegacyData(c.env, email).catch((e) => {
      claimed = false
      console.error('claimLegacyData failed', e)
    })
  }
  await next()
}

/** 多用户改造前的数据没有归属（user_id 为空），归到管理员名下；个人设置也一并迁过去 */
async function claimLegacyData(env: Env, email: string) {
  const db = env.DB
  await db.batch([
    ...['items', 'lessons', 'submissions', 'usage'].map((t) => db.prepare(`UPDATE ${t} SET user_id = ? WHERE user_id = ''`).bind(email)),
    db
      .prepare(
        `INSERT OR IGNORE INTO user_settings (user_id, key, value)
         SELECT ?, key, value FROM settings WHERE key IN ('practiceLevel', 'coachProfile', 'reviewMode')`,
      )
      .bind(email),
  ])
}
