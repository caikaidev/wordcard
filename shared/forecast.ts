/** Seven calendar days beginning today, measured in the app's Beijing (UTC+8) day boundary. */
export const REVIEW_DAY_MS = 86_400_000
const BEIJING_OFFSET_MS = 8 * 3_600_000

export interface ReviewForecast {
  /** UTC timestamp of today's Beijing midnight. */
  start: number
  days: { date: string; count: number }[]
  total: number
}

/** Include overdue cards in today's bucket; exclude DONE and other users in SQL. */
export const REVIEW_FORECAST_SQL = `
  SELECT CASE WHEN due_at < ?1 THEN 0
              ELSE CAST((due_at - ?1) / 86400000 AS INTEGER) + 1 END AS bucket,
         COUNT(*) AS n
    FROM items
   WHERE user_id = ?2 AND status = 'active' AND due_at < ?3
   GROUP BY bucket ORDER BY bucket
`

export function reviewForecastWindow(now = Date.now()) {
  const start = Math.floor((now + BEIJING_OFFSET_MS) / REVIEW_DAY_MS) * REVIEW_DAY_MS - BEIJING_OFFSET_MS
  return { start, tomorrow: start + REVIEW_DAY_MS, end: start + 7 * REVIEW_DAY_MS }
}

/** Database rows are grouped by SQL; the UI always receives seven days, including zeros. */
export function buildReviewForecast(rows: { bucket: number; n: number }[], now = Date.now()): ReviewForecast {
  const { start } = reviewForecastWindow(now)
  const counts = Array<number>(7).fill(0)
  for (const { bucket, n } of rows) {
    if (Number.isInteger(bucket) && bucket >= 0 && bucket < 7 && Number.isFinite(n)) counts[bucket] += n
  }
  const days = counts.map((count, i) => ({
    date: new Date(start + i * REVIEW_DAY_MS + BEIJING_OFFSET_MS).toISOString().slice(0, 10),
    count,
  }))
  return { start, days, total: counts.reduce((a, n) => a + n, 0) }
}
