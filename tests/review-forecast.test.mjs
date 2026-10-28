import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { buildReviewForecast, REVIEW_DAY_MS, REVIEW_FORECAST_SQL, reviewForecastWindow } from '../shared/forecast.ts'

test('Beijing midnight defines the same seven days regardless of viewer timezone', () => {
  const justBeforeMidnight = Date.parse('2026-10-27T15:59:59.999Z')
  const midnight = Date.parse('2026-10-27T16:00:00Z')
  assert.equal(reviewForecastWindow(justBeforeMidnight).start, Date.parse('2026-10-26T16:00:00Z'))
  assert.equal(reviewForecastWindow(midnight).start, midnight)
  assert.equal(buildReviewForecast([], midnight).days[0].date, '2026-10-28')
  assert.equal(buildReviewForecast([], midnight).days[6].date, '2026-11-03')
})

test('SQL groups overdue into today, respects owner/status and excludes the eighth day', () => {
  const now = Date.parse('2026-10-28T02:30:00Z')
  const { start, tomorrow, end } = reviewForecastWindow(now)
  const db = new DatabaseSync(':memory:')
  db.exec("CREATE TABLE items (user_id TEXT, status TEXT, due_at INTEGER)")
  const insert = db.prepare('INSERT INTO items (user_id, status, due_at) VALUES (?, ?, ?)')
  insert.run('alice', 'active', start - 20 * REVIEW_DAY_MS) // overdue
  insert.run('alice', 'active', start + 1) // today
  insert.run('alice', 'active', tomorrow) // tomorrow boundary
  insert.run('alice', 'active', end - 1) // day 7
  insert.run('alice', 'active', end) // day 8: excluded
  insert.run('alice', 'done', start - 5) // completed: excluded
  insert.run('bob', 'active', start - 5) // another user: excluded
  const rows = db.prepare(REVIEW_FORECAST_SQL).all(tomorrow, 'alice', end)
  const r = buildReviewForecast(rows, now)
  assert.deepEqual(r.days.map(d => d.count), [2, 1, 0, 0, 0, 0, 1])
  assert.equal(r.total, 4)
  db.close()
})

test('empty days and unknown buckets are robustly handled', () => {
  const r = buildReviewForecast([{ bucket: -1, n: 9 }, { bucket: 7, n: 1 }, { bucket: 3, n: 2 }], Date.parse('2026-10-28T00:00:00Z'))
  assert.equal(r.days.length, 7)
  assert.deepEqual(r.days.map(x => x.count), [0, 0, 0, 2, 0, 0, 0])
})
