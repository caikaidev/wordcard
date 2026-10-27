import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reviewGradeDecision } from '../shared/review.ts'

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
