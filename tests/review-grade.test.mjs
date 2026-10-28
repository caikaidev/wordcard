import { test } from 'node:test'
import assert from 'node:assert/strict'
import { REVIEW_GRADE_UPDATE_SQL, reviewGradeDecision } from '../shared/review.ts'
import { DatabaseSync } from 'node:sqlite'

test('first attempt grades normally without a hint', () => {
  for (const grade of [0, 1, 2]) {
    assert.equal(reviewGradeDecision(grade, false, false), 'record')
  }
})

test('viewing a hint prevents reporting independent recall', () => {
  assert.equal(reviewGradeDecision(0, false, true), 'record')
  assert.equal(reviewGradeDecision(1, false, true), 'record')
  assert.equal(reviewGradeDecision(2, false, true), 'hint-blocked')
})

test('a retry never writes another grade, even when a hint was shown', () => {
  for (const grade of [0, 1, 2]) {
    assert.equal(reviewGradeDecision(grade, true, false), 'practice')
    assert.equal(reviewGradeDecision(grade, true, true), 'practice')
  }
})

test('only one concurrent or repeated grade can schedule a card', () => {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE items (
    id INTEGER PRIMARY KEY, user_id TEXT, status TEXT, interval INTEGER,
    due_at INTEGER, reps INTEGER, lapses INTEGER, updated_at INTEGER
  )`)
  const now = 1800000000000
  const insert = db.prepare('INSERT INTO items VALUES (?, ?, ?, 0, ?, 0, 0, 0)')
  insert.run(1, 'alice', 'active', now - 1)
  insert.run(2, 'bob', 'active', now - 1)
  insert.run(3, 'alice', 'done', now - 1)
  const grade = (id, user, dueAt, rating = 0) => db.prepare(REVIEW_GRADE_UPDATE_SQL)
    .get(1, dueAt, rating === 0 ? 1 : 0, now, id, user, now)
  const updated = grade(1, 'alice', now + 600000)
  assert.equal(updated.reps, 1)
  assert.equal(updated.lapses, 1)
  assert.equal(updated.due_at, now + 600000)
  assert.equal(grade(1, 'alice', now + 86400000, 2), undefined,
    'same-session retry must not replace 10-minute due date')
  assert.equal(grade(2, 'alice', now + 600000), undefined, 'different user cannot grade')
  assert.equal(grade(3, 'alice', now + 600000), undefined, 'DONE cards cannot grade')
  assert.equal(db.prepare('SELECT due_at FROM items WHERE id = 1').get().due_at, now + 600000)
  db.close()
})
