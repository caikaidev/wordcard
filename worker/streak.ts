import type { Env } from './env'
import { loadSettings } from './settings'
import { FREEZE_EVERY, FREEZE_MAX, MILESTONES, nextMilestone, type CheckinEvent, type StreakStatus } from '../shared/streak'

const DAY = 86_400_000
const TZ = 8 * 3600_000 // 按北京时间算“哪一天”
export const dayOf = (ts: number) => Math.floor((ts + TZ) / DAY)
const dayStart = (day: number) => day * DAY - TZ

/** 连续天数最多往回看这么多天 */
const LOOKBACK = 2000

type Chain = Map<number, 'done' | 'freeze'>

async function loadChain(db: D1Database, user: string, today: number): Promise<Chain> {
  const { results } = await db
    .prepare('SELECT day, kind FROM checkins WHERE user_id = ? AND day >= ?')
    .bind(user, today - LOOKBACK)
    .all<{ day: number; kind: 'done' | 'freeze' }>()
  return new Map(results.map((r) => [r.day, r.kind]))
}

/** 今天打过卡从今天往回数，否则从昨天往回数；保护卡那天连着不断，但不算进天数 */
export function streakOf(chain: Chain, today: number) {
  let streak = 0
  let lastFreeze: number | null = null
  for (let d = chain.has(today) ? today : today - 1; chain.has(d); d--) {
    if (chain.get(d) === 'done') streak++
    else lastFreeze ??= d
  }
  return { streak, lastFreeze }
}

async function loadState(db: D1Database, user: string) {
  const r = await db.prepare('SELECT freezes, best FROM streaks WHERE user_id = ?').bind(user).first<{ freezes: number; best: number }>()
  return r ?? { freezes: 0, best: 0 }
}

/**
 * 结算断签：上次打卡之后、今天之前漏掉的日子，保护卡够用就逐天补上 freeze，连续天数不断；
 * 不够就什么也不做（断了，保护卡留着下次用）。打卡、查询、发提醒之前都先结算一次，重复调用没有副作用。
 */
async function settle(db: D1Database, user: string, today: number) {
  const last = await db
    .prepare('SELECT MAX(day) AS day FROM checkins WHERE user_id = ? AND day < ?')
    .bind(user, today)
    .first<{ day: number | null }>()
  if (last?.day == null) return
  const gap = today - 1 - last.day
  if (gap <= 0) return
  const { freezes } = await loadState(db, user)
  if (gap > freezes) return
  const now = Date.now()
  const insert = db.prepare(`INSERT OR IGNORE INTO checkins (user_id, day, kind, created_at) VALUES (?, ?, 'freeze', ?)`)
  const res = await db.batch(Array.from({ length: gap }, (_, i) => insert.bind(user, last.day! + 1 + i, now)))
  // 并发时另一边已经补过的日子不重复扣
  const used = res.reduce((n, r) => n + (r.meta.changes ?? 0), 0)
  if (used) await db.prepare('UPDATE streaks SET freezes = MAX(0, freezes - ?) WHERE user_id = ?').bind(used, user).run()
}

/** 今天打卡；今天已经打过就返回 null。连续天数逢 7 送一张保护卡 */
export async function checkIn(db: D1Database, user: string, now = Date.now()): Promise<CheckinEvent | null> {
  const today = dayOf(now)
  await settle(db, user, today)
  const r = await db
    .prepare(`INSERT OR IGNORE INTO checkins (user_id, day, kind, created_at) VALUES (?, ?, 'done', ?)`)
    .bind(user, today, now)
    .run()
  if (!r.meta.changes) return null
  const { streak } = streakOf(await loadChain(db, user, today), today)
  const state = await loadState(db, user)
  const earnedFreeze = streak % FREEZE_EVERY === 0 && state.freezes < FREEZE_MAX
  await db
    .prepare(
      `INSERT INTO streaks (user_id, freezes, best) VALUES (?1, ?2, ?3)
       ON CONFLICT (user_id) DO UPDATE SET freezes = ?2, best = MAX(best, ?3)`,
    )
    .bind(user, state.freezes + (earnedFreeze ? 1 : 0), streak)
    .run()
  return { streak, milestone: MILESTONES.includes(streak), earnedFreeze }
}

/** 复习评分之后：今天复习够了目标张数，或者到期的卡片已经清空，就算打卡 */
export async function checkInAfterReview(env: Env, user: string, now = Date.now()): Promise<CheckinEvent | null> {
  const db = env.DB
  const today = dayOf(now)
  const done = await db.prepare('SELECT 1 FROM checkins WHERE user_id = ? AND day = ?').bind(user, today).first()
  if (done) return null
  const [goal, counts] = await Promise.all([
    loadSettings(env, user).then((s) => s.dailyGoal),
    db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM reviews WHERE user_id = ?1 AND ts >= ?2) AS reviewed,
                (SELECT COUNT(*) FROM items WHERE user_id = ?1 AND status = 'active' AND due_at <= ?3) AS due`,
      )
      .bind(user, dayStart(today), now)
      .first<{ reviewed: number; due: number }>(),
  ])
  const reviewed = counts?.reviewed ?? 0
  if (reviewed >= goal || (reviewed > 0 && !counts?.due)) return checkIn(db, user, now)
  return null
}

export async function streakStatus(env: Env, user: string, now = Date.now()): Promise<StreakStatus & { chain: Chain }> {
  const db = env.DB
  const today = dayOf(now)
  await settle(db, user, today)
  const [chain, state, settings, reviewed] = await Promise.all([
    loadChain(db, user, today),
    loadState(db, user),
    loadSettings(env, user),
    db.prepare('SELECT COUNT(*) AS n FROM reviews WHERE user_id = ? AND ts >= ?').bind(user, dayStart(today)).first<{ n: number }>(),
  ])
  const { streak, lastFreeze } = streakOf(chain, today)
  return {
    streak,
    best: Math.max(state.best, streak),
    today: chain.get(today) === 'done',
    reviewsToday: reviewed?.n ?? 0,
    goal: settings.dailyGoal,
    freezes: state.freezes,
    next: nextMilestone(streak),
    frozenAgo: lastFreeze !== null && today - lastFreeze <= 3 ? today - lastFreeze : null,
    chain,
  }
}
