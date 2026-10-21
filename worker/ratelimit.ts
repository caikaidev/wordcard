/**
 * 固定窗口限流，存在 D1 里（Cloudflare 自带的限流绑定只支持 10 / 60 秒的窗口，不够用）。
 * 一条 UPSERT 完成「过期就重置、没过期就 +1」，并发时不会多放行。
 */
export async function hit(db: D1Database, key: string, limit: number, windowMs: number, now = Date.now()) {
  const r = await db
    .prepare(
      `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
       ON CONFLICT (key) DO UPDATE SET
         count = CASE WHEN window_start <= ?2 - ?3 THEN 1 ELSE count + 1 END,
         window_start = CASE WHEN window_start <= ?2 - ?3 THEN ?2 ELSE window_start END
       RETURNING window_start, count`,
    )
    .bind(key, now, windowMs)
    .first<{ window_start: number; count: number }>()
  const count = r?.count ?? 1
  const start = r?.window_start ?? now
  return { ok: count <= limit, retryAfter: Math.max(1, Math.ceil((start + windowMs - now) / 1000)) }
}

/** 只查不计数：被封禁期间不用再写库 */
export async function blocked(db: D1Database, key: string, limit: number, windowMs: number, now = Date.now()) {
  const r = await db.prepare('SELECT window_start, count FROM rate_limits WHERE key = ?').bind(key).first<{ window_start: number; count: number }>()
  if (!r || r.window_start <= now - windowMs || r.count < limit) return null
  return Math.max(1, Math.ceil((r.window_start + windowMs - now) / 1000))
}
