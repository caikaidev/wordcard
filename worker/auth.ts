import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { MiddlewareHandler } from 'hono'
import type { Env } from './env'

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

/**
 * 校验 Cloudflare Access 签发的 JWT。
 * 即使有人绕过 Access（比如直接访问 workers.dev 域名），没有合法 JWT 也拿不到任何数据。
 * 没配置 ACCESS_TEAM_DOMAIN / ACCESS_AUD 时默认拒绝（fail closed）。
 */
export const requireAccess: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  if (c.env.AUTH_DISABLED === 'true') return next()

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
  try {
    await jwtVerify(token, jwks, { issuer: `https://${team}`, audience: aud })
  } catch {
    return c.json({ error: '登录已失效，请刷新页面' }, 403)
  }
  return next()
}
