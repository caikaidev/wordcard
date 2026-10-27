import type { Grade } from './types'

/**
 * One review card has at most one scheduled grade per session.
 * A same-session retry is ungraded practice, preserving the due date set by the first failure.
 * A revealed first-letter hint is not independent recall and cannot earn "remembered".
 */
export function reviewGradeDecision(grade: Grade, retrying: boolean, hinted: boolean): 'record' | 'practice' | 'hint-blocked' {
  if (retrying) return 'practice'
  if (hinted && grade === 2) return 'hint-blocked'
  return 'record'
}
