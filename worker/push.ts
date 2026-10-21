import { Hono } from 'hono'
import { SignJWT, importJWK } from 'jose'
import type { AppEnv, Env } from './env'
import { loadSettings } from './settings'
import { streakStatus } from './streak'
import { RESCUE_HOUR, type StreakStatus } from '../shared/streak'

/*
 * Web Push（每日提醒）：VAPID 签名（RFC 8292）+ aes128gcm 加密负载（RFC 8291），只用 WebCrypto，不依赖 Node 库。
 * 没配置 VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY 时整个功能隐藏，其它功能不受影响。
 */

export interface PushMessage {
  title: string
  body: string
  /** 点通知打开哪个页面 */
  url?: string
  /** 主屏幕图标上的数字（今天到期张数） */
  badge?: number
  tag?: string
}

type Sub = { endpoint: string; p256dh: string; auth: string }

const enc = new TextEncoder()

const b64u = {
  encode(buf: ArrayBuffer | Uint8Array) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
    let s = ''
    for (const b of bytes) s += String.fromCharCode(b)
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  },
  decode(str: string) {
    const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (str.length % 4)) % 4))
    return Uint8Array.from(s, (c) => c.charCodeAt(0))
  },
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

const hkdf = async (salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) =>
  new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt, info },
      await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']),
      bytes * 8,
    ),
  )

/** RFC 8291：用订阅里的 p256dh / auth 加密负载，输出 aes128gcm 格式的请求体 */
export async function encryptPayload(sub: Pick<Sub, 'p256dh' | 'auth'>, plaintext: Uint8Array) {
  const uaPublic = b64u.decode(sub.p256dh)
  const authSecret = b64u.decode(sub.auth)
  const local = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
  const asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', local.publicKey)) as ArrayBuffer)
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  // workers-types 把这个字段写成 $public，运行时实际要的是标准的 public
  const ecdh = { name: 'ECDH', public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm
  const shared = new Uint8Array(await crypto.subtle.deriveBits(ecdh, local.privateKey, 256))

  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)

  // 单条记录：明文后面跟 0x02（最后一条记录的分隔符）
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(plaintext, new Uint8Array([2]))))

  const header = new Uint8Array(16 + 4 + 1 + asPublic.length)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, 4096)
  header[20] = asPublic.length
  header.set(asPublic, 21)
  return concat(header, cipher)
}

/** 填 Secret 时常见的手误：连着「VAPID_PRIVATE_KEY=」一起复制、带了引号或换行，这里都去掉 */
const cleanKey = (v: string | undefined, name: string) =>
  (v ?? '')
    .trim()
    .replace(new RegExp(`^${name}\\s*=\\s*`), '')
    .replace(/^["']|["']$/g, '')
    .trim()

const vapidKeys = (env: Env) => {
  const pub = cleanKey(env.VAPID_PUBLIC_KEY, 'VAPID_PUBLIC_KEY')
  const priv = cleanKey(env.VAPID_PRIVATE_KEY, 'VAPID_PRIVATE_KEY')
  return pub && priv ? { pub, priv } : null
}

let signingKey: { id: string; key: CryptoKey } | null = null

async function vapidAuth(env: Env, endpoint: string) {
  const keys = vapidKeys(env)!
  if (signingKey?.id !== `${keys.pub}|${keys.priv}`) {
    const pub = b64u.decode(keys.pub)
    const key = await importJWK(
      { kty: 'EC', crv: 'P-256', x: b64u.encode(pub.slice(1, 33)), y: b64u.encode(pub.slice(33, 65)), d: keys.priv },
      'ES256',
    )
    signingKey = { id: `${keys.pub}|${keys.priv}`, key: key as CryptoKey }
  }
  const admin = (env.ADMIN_EMAILS ?? '').split(',')[0]?.trim()
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', typ: 'JWT' })
    .setAudience(new URL(endpoint).origin)
    .setExpirationTime('12h')
    .setSubject(env.VAPID_SUBJECT || (admin ? `mailto:${admin}` : 'https://github.com/caikaidev/wordcard'))
    .sign(signingKey.key)
  return `vapid t=${jwt}, k=${keys.pub}`
}

type SendResult = { status: number; detail: string; host: string }

/** 发一条推送；返回推送服务的状态码和它给的原因。404 / 410 说明订阅已失效，0 表示还没发出去就出错了 */
async function send(env: Env, sub: Sub, msg: PushMessage): Promise<SendResult> {
  const host = new URL(sub.endpoint).host
  // 签名失败（-1，多半是私钥格式不对）和加密失败（0，订阅数据有问题）分开报，方便对症处理
  let authorization: string
  try {
    authorization = await vapidAuth(env, sub.endpoint)
  } catch (e) {
    console.error('vapid sign error', e)
    return { status: -1, detail: e instanceof Error ? e.message : String(e), host }
  }
  try {
    const body = await encryptPayload(sub, enc.encode(JSON.stringify(msg)))
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        authorization,
        'content-encoding': 'aes128gcm',
        'content-type': 'application/octet-stream',
        ttl: String(6 * 3600), // 手机离线超过 6 小时就不送了：过时的“今天还没打卡”没有意义
        urgency: 'normal',
        topic: msg.tag ?? 'daily', // 同一主题只保留最新一条
      },
      body,
    })
    const detail = res.ok ? '' : (await res.text().catch(() => '')).slice(0, 300)
    if (!res.ok) console.warn('push failed', host, res.status, detail)
    return { status: res.status, detail, host }
  } catch (e) {
    console.error('push error', host, e)
    return { status: 0, detail: e instanceof Error ? e.message : String(e), host }
  }
}

/** 推给这个人的所有设备；顺手清掉失效的订阅。返回成功条数和失败原因 */
export async function sendToUser(env: Env, user: string, msg: PushMessage) {
  const failures: SendResult[] = []
  if (!vapidKeys(env)) return { sent: 0, failures }
  const { results } = await env.DB.prepare('SELECT endpoint, p256dh, auth FROM push_subs WHERE user_id = ?').bind(user).all<Sub>()
  let sent = 0
  for (const sub of results) {
    const r = await send(env, sub, msg)
    if (r.status >= 200 && r.status < 300) sent++
    else {
      failures.push(r)
      if (r.status === 404 || r.status === 410) await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(sub.endpoint).run()
    }
  }
  return { sent, failures }
}

/** 把推送服务的拒绝原因翻译成能照着改的话 */
function explain(f: SendResult) {
  const why = f.detail.replace(/\s+/g, ' ').trim()
  const raw = `（${f.host} ${f.status > 0 ? `返回 ${f.status}` : '出错'}${why ? `：${why.slice(0, 120)}` : ''}）`
  if (f.status === -1) return `VAPID 私钥用不了：Secret 里只填生成结果「=」后面那一串，公钥私钥要是同一次生成的，改完重新部署${raw}`
  if (f.status === 0) return `这台设备的订阅数据有问题，或者连不上推送服务：把提醒关掉再打开一次${raw}`
  if (f.status === 404 || f.status === 410) return `这台设备的订阅已经失效（已自动清掉），把提醒关掉再打开一次${raw}`
  if (f.status === 401 || f.status === 403)
    return `推送服务不认这个签名：检查 VAPID_PUBLIC_KEY 和 VAPID_PRIVATE_KEY 是不是同一次生成的一对；如果换过密钥，要把提醒关掉再打开一次${raw}`
  if (f.status === 413) return `通知内容太长${raw}`
  if (f.status === 429) return `推送服务限流了，过几分钟再试${raw}`
  return `推送服务拒绝了这条通知${raw}`
}

/* ------------------------------ 提醒文案 ------------------------------ */

/** 按连续天数、今天还差几张、手里有没有保护卡，写一条有点递进感的提醒 */
export function reminderMessage(s: StreakStatus, due: number, rescue: boolean): PushMessage {
  const left = Math.max(1, Math.min(s.goal - s.reviewsToday, due || s.goal))
  const task = due ? `复习 ${left} 张就能打卡` : '今天没有到期的卡片，做一次练习就能打卡'
  const toNext = s.next - s.streak
  const base = { url: due ? '/' : '/practice', badge: due, tag: 'daily' }
  if (!s.streak) {
    return {
      ...base,
      title: s.best ? `重新开始吧，你最长坚持过 ${s.best} 天` : '今天的英语还没开始',
      body: due ? `${task}，两三分钟的事。` : `${task}。`,
    }
  }
  if (rescue) {
    return {
      ...base,
      title: `🔥 连续 ${s.streak} 天，今晚还没打卡`,
      body: s.freezes
        ? `${task}。不打也没关系，会自动用掉 1 张保护卡（还剩 ${s.freezes} 张）。`
        : `${task}，不然明天就要从 0 开始了。`,
    }
  }
  return {
    ...base,
    title: `🔥 连续 ${s.streak} 天`,
    body: toNext <= 3 ? `${task}，再坚持 ${toNext} 天就到 ${s.next} 天。` : `${task}，保持住。`,
  }
}

/** 定时任务（每小时一次）：到了某人设定的钟点、今天还没打卡，就提醒一下 */
export async function sendReminders(env: Env, now = Date.now()) {
  if (!vapidKeys(env)) return
  const hour = new Date(now + 8 * 3600_000).getUTCHours()
  const { results } = await env.DB.prepare('SELECT DISTINCT user_id FROM push_subs').all<{ user_id: string }>()
  for (const { user_id: user } of results) {
    try {
      const { reminderHour } = await loadSettings(env, user)
      if (reminderHour < 0 || (hour !== reminderHour && hour !== RESCUE_HOUR)) continue
      const s = await streakStatus(env, user, now)
      if (s.today) continue
      // 22 点那条只发给手里有连续天数、而且设定的钟点比它早的人
      const rescue = hour !== reminderHour
      if (rescue && (!s.streak || reminderHour > RESCUE_HOUR)) continue
      const due = await env.DB.prepare(`SELECT COUNT(*) AS n FROM items WHERE user_id = ? AND status = 'active' AND due_at <= ?`)
        .bind(user, now)
        .first<{ n: number }>()
      await sendToUser(env, user, reminderMessage(s, due?.n ?? 0, rescue))
    } catch (e) {
      console.error('reminder failed', user, e)
    }
  }
}

/* ------------------------------ 接口 ------------------------------ */

export const push = new Hono<AppEnv>()

push.get('/key', (c) => c.json({ key: vapidKeys(c.env)?.pub ?? null }))

push.post('/subscribe', async (c) => {
  const body = await c.req.json<{ endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }>().catch(() => null)
  const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : ''
  const p256dh = typeof body?.keys?.p256dh === 'string' ? body.keys.p256dh : ''
  const auth = typeof body?.keys?.auth === 'string' ? body.keys.auth : ''
  let url: URL | null = null
  try {
    url = new URL(endpoint)
  } catch {
    /* 下面统一报错 */
  }
  if (!url || url.protocol !== 'https:' || endpoint.length > 1000 || !/^[\w-]{80,100}$/.test(p256dh) || !/^[\w-]{16,30}$/.test(auth)) {
    return c.json({ error: '订阅信息不完整' }, 400)
  }
  await c.env.DB.prepare(
    `INSERT INTO push_subs (endpoint, user_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
  )
    .bind(endpoint, c.get('user'), p256dh, auth, Date.now())
    .run()
  return c.body(null, 204)
})

push.post('/unsubscribe', async (c) => {
  const body = await c.req.json<{ endpoint?: unknown }>().catch(() => null)
  if (typeof body?.endpoint === 'string') {
    await c.env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?').bind(body.endpoint, c.get('user')).run()
  }
  return c.body(null, 204)
})

push.post('/test', async (c) => {
  if (!vapidKeys(c.env)) return c.json({ error: '服务器还没配置推送密钥（VAPID）' }, 400)
  const user = c.get('user')
  const s = await streakStatus(c.env, user)
  const due = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM items WHERE user_id = ? AND status = 'active' AND due_at <= ?`)
    .bind(user, Date.now())
    .first<{ n: number }>()
  const msg = s.today
    ? { title: '拾句 · 测试提醒', body: `今天已经打卡了，连续 ${s.streak} 天。提醒会在你设定的钟点发出。`, url: '/', tag: 'test' }
    : reminderMessage(s, due?.n ?? 0, false)
  const { sent, failures } = await sendToUser(c.env, user, msg)
  if (!sent) {
    if (!failures.length) return c.json({ error: '服务器上没有这台设备的订阅，把提醒关掉再打开一次' }, 404)
    return c.json({ error: `没有发出去：${explain(failures[0])}` }, 502)
  }
  // 有的设备成功、有的失败：也告诉一声
  return c.json({ sent, failed: failures.length, note: failures.length ? explain(failures[0]) : undefined })
})
