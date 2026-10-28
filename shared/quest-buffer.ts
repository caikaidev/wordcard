import { buildStage, type Quest, type QuestContent, type StageId } from './quest'

export type QuestPhase = 'starter' | 'complete'
export type QuestPart = 'starter' | 'tail' | 'full'
export const BUFFER_LOW_WATER = 5
export const BUFFER_TARGET = 10
export const BUFFER_MAX = 20
export const STARTER_STAGES: StageId[] = ['words', 'listen']

export interface QuestBuffer {
  phase: QuestPhase
  ready: number
  target: number
  status: 'idle' | 'queued' | 'running' | 'done' | 'failed'
}

/** A word-pair screen + five word choices + four listening screens = ten.
 * Sparse/invalid model output is never padded with duplicate questions. */
export function starterContent(c: QuestContent): QuestContent {
  return { words: c.words.slice(0, 5), listening: c.listening.slice(0, 4), cloze: [], reading: [] }
}

/** Append only the future stages. Never change questions the learner has seen. */
export function appendTail(starter: QuestContent, tail: QuestContent): QuestContent {
  return {
    ...starter,
    cloze: tail.cloze.slice(0, 3),
    reading: tail.reading.slice(0, 2).map((r) => ({ ...r, questions: r.questions.slice(0, 2) })),
    speaking: (tail.speaking ?? []).slice(0, 3),
  }
}

export function stagePrepared(phase: QuestPhase | undefined, stage: StageId): boolean {
  return phase !== 'starter' || STARTER_STAGES.includes(stage) || stage === 'write'
}

export function readyCount(content: QuestContent, phase: QuestPhase): number {
  const stages: StageId[] = phase === 'starter' ? STARTER_STAGES : ['words', 'listen', 'read', 'speak']
  return stages.reduce((n, s) => n + buildStage(s, content, () => 0).length, 0)
}

/** Retry exercises do not consume new inventory. Passed stages don't count twice. */
export function remainingReady(q: Quest, stage: StageId, consumed: number): number {
  return STARTER_STAGES.reduce((n, s) => {
    if (q.progress.stages[s]) return n
    const count = buildStage(s, q.content, () => 0).length
    const used = s === stage ? Math.min(count, Math.max(0, consumed)) : 0
    return n + count - used
  }, 0)
}
