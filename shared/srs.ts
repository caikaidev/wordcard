import type { Grade } from './types'

const MIN = 60_000
const DAY = 86_400_000

/**
 * 极简间隔重复（SM-2 的简化版）：
 * - 忘了：10 分钟后再出现，间隔重置为 1 天
 * - 模糊：间隔 × 1.2（首次 1 天）
 * - 记得：间隔 × 2.5（首次 3 天）
 */
export function schedule(interval: number, grade: Grade, now = Date.now()) {
  if (grade === 0) return { interval: 1, dueAt: now + 10 * MIN }
  let next: number
  if (grade === 1) next = interval <= 0 ? 1 : Math.max(1, Math.round(interval * 1.2))
  else next = interval <= 0 ? 3 : Math.max(interval + 1, Math.round(interval * 2.5))
  next = Math.min(next, 365)
  return { interval: next, dueAt: now + next * DAY }
}

/** 按钮上显示的“下次出现”文案 */
export function previewLabel(interval: number, grade: Grade) {
  if (grade === 0) return '10 分钟'
  const { interval: d } = schedule(interval, grade)
  if (d >= 30) return `${Math.round(d / 30)} 个月`
  return `${d} 天`
}

/** 词库里显示“今天 / 明天 / 3 天后” */
export function dueLabel(dueAt: number, now = Date.now()) {
  if (dueAt <= now) return '今天'
  const startOfToday = new Date(now).setHours(0, 0, 0, 0)
  const days = Math.floor((dueAt - startOfToday) / DAY)
  if (days <= 0) return '今天'
  if (days === 1) return '明天'
  if (days < 7) return `${days} 天后`
  if (days < 30) return `${Math.round(days / 7)} 周后`
  return `${Math.round(days / 30)} 个月后`
}
