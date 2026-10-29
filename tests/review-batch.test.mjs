import { test } from 'node:test'
import assert from 'node:assert/strict'
import { batchProgress, reduceBatch, resumeOrStart } from '../shared/review-batch.ts'

const now = new Date(2026, 9, 29, 12, 0, 0)

const item = (id) => ({
  id,
  type: 'word',
  text: `word${id}`,
  meta: { ipa: '', pos: '', meaning: '义', example: '', exampleZh: '', highlight: '', phrases: [] },
  status: 'active',
  interval: 0,
  due_at: 1,
  reps: 0,
  lapses: 0,
  created_at: 1,
  updated_at: 1,
})

const due = (n) => Array.from({ length: n }, (_, i) => item(i + 1))

const remember = (state) => reduceBatch(state, { type: 'record', grade: 2, updated: state.queue[0] })

test('a full batch of 20 settles and the next batch says 新一批', () => {
  let state = resumeOrStart(null, due(25), now)
  assert.equal(state.phase, 'active')
  assert.equal(state.batchSize, 20)
  assert.equal(batchProgress(state).label, '1/20')
  for (let i = 0; i < 20; i++) state = remember(state)
  assert.equal(state.phase, 'resting')
  assert.equal(state.queue.length, 5)
  assert.equal(state.reviewed, 20)
  assert.equal(state.sessionGraded, 20)
  assert.equal(state.batchIndex, 20)
  assert.equal(batchProgress(state).label, '20/20')
  const finishedId = state.batchId
  state = reduceBatch(state, { type: 'continue' })
  assert.equal(state.phase, 'active')
  assert.equal(state.isNewBatch, true)
  assert.notEqual(state.batchId, finishedId)
  assert.equal(state.batchIndex, 0)
  assert.equal(state.batchSize, 5)
  assert.equal(batchProgress(state).label, '新一批 · 1/5')
})

test('忘了 goes to the tail and a second pass does not grade again', () => {
  let state = resumeOrStart(null, due(4), now)
  const first = state.queue[0]
  state = reduceBatch(state, { type: 'record', grade: 0, updated: { ...first, due_at: 999 } })
  assert.equal(state.queue.at(-1).id, first.id)
  assert.equal(state.againIds.includes(first.id), true)
  assert.equal(state.sessionGraded, 1)
  assert.equal(state.reviewed, 0)
  assert.equal(state.batchIndex, 1)
  assert.equal(batchProgress(state).label, '2/4')
  assert.equal(batchProgress(state).retrying, 1)
  while (state.queue[0].id !== first.id) state = remember(state)
  const graded = state.sessionGraded
  state = reduceBatch(state, { type: 'record', grade: 2, updated: state.queue[0] })
  assert.equal(state.sessionGraded, graded)
  assert.equal(state.againIds.includes(first.id), false)
  assert.equal(state.queue.some((card) => card.id === first.id), false)
})

test('skip keeps the card out of this round and does not rewind progress', () => {
  let state = resumeOrStart(null, due(5), now)
  const first = state.queue[0].id
  state = reduceBatch(state, { type: 'skip' })
  assert.equal(state.queue.some((card) => card.id === first), false)
  assert.equal(state.skipped[0].id, first)
  assert.equal(state.batchIndex, 0)
  assert.equal(state.sessionGraded, 0)
  assert.equal(batchProgress(state).label, '1/5')
  state = remember(state)
  const index = state.batchIndex
  const shown = state.queue[0].id
  state = reduceBatch(state, { type: 'skip' })
  assert.equal(state.batchIndex, index)
  assert.equal(batchProgress(state).label, '2/5')
  assert.equal(state.skipped.at(-1).id, shown)
  state = reduceBatch(state, { type: 'restore-skipped' })
  assert.equal(state.skipped.length, 0)
  assert.equal(state.queue.some((card) => card.id === first), true)
})

test('browser back restores the same batch instead of restarting at 1', () => {
  const storage = new Map()
  const persist = (state) => storage.set('batch', JSON.parse(JSON.stringify(state)))
  const read = () => storage.get('batch') ?? null
  const cards = due(20)
  let state = resumeOrStart(read(), cards, now)
  persist(state)
  for (let i = 0; i < 3; i++) state = remember(state)
  persist(state)
  assert.equal(state.batchIndex, 3)
  assert.equal(state.sessionGraded, 3)
  const graded = new Set(state.gradedIds)
  const stillDue = cards.filter((card) => !graded.has(card.id))
  const restored = resumeOrStart(read(), stillDue, now)
  assert.equal(restored.batchId, state.batchId)
  assert.equal(restored.batchIndex, 3)
  assert.equal(restored.sessionGraded, 3)
  assert.equal(restored.phase, 'active')
  assert.equal(restored.isNewBatch, false)
  assert.equal(batchProgress(restored).label, '4/20')
  assert.equal(restored.queue.length, 17)
})

test('a forgotten card still reappears after leaving and coming back', () => {
  const cards = due(6)
  let state = resumeOrStart(null, cards, now)
  const first = state.queue[0]
  state = reduceBatch(state, { type: 'record', grade: 0, updated: { ...first, due_at: now.getTime() + 600000 } })
  state = remember(state)
  const saved = JSON.parse(JSON.stringify(state))
  const graded = new Set(saved.gradedIds)
  const stillDue = cards.filter((card) => !graded.has(card.id) || saved.againIds.includes(card.id))
  const restored = resumeOrStart(saved, stillDue.filter((card) => card.id !== first.id), now)
  assert.equal(restored.queue.at(-1).id, first.id)
  assert.equal(restored.againIds.includes(first.id), true)
  assert.equal(batchProgress(restored).label, '3/6')
})

test('finishing the batch and coming back with more cards opens 新一批', () => {
  let state = resumeOrStart(null, due(2), now)
  state = remember(state)
  state = remember(state)
  assert.equal(state.phase, 'done')
  const saved = JSON.parse(JSON.stringify(state))
  const again = resumeOrStart(saved, due(3).map((card) => ({ ...card, id: card.id + 10 })), now)
  assert.equal(again.isNewBatch, true)
  assert.equal(again.phase, 'active')
  assert.equal(batchProgress(again).label, '新一批 · 1/3')
  assert.equal(again.sessionGraded, 2)
})

test('a new batch keeps its 新一批 label after the browser back button', () => {
  let state = resumeOrStart(null, due(22), now)
  for (let i = 0; i < 20; i++) state = remember(state)
  state = reduceBatch(state, { type: 'continue' })
  assert.equal(batchProgress(state).label, '新一批 · 1/2')
  state = remember(state)
  const saved = JSON.parse(JSON.stringify(state))
  const restored = resumeOrStart(saved, saved.queue.filter((card) => !saved.gradedIds.includes(card.id)), now)
  assert.equal(restored.isNewBatch, true)
  assert.equal(restored.batchId, state.batchId)
  assert.equal(batchProgress(restored).label, '新一批 · 2/2')
})

test('leaving on the rest screen does not start a new batch by itself', () => {
  let state = resumeOrStart(null, due(22), now)
  for (let i = 0; i < 20; i++) state = remember(state)
  assert.equal(state.phase, 'resting')
  const saved = JSON.parse(JSON.stringify(state))
  const graded = new Set(saved.gradedIds)
  const stillDue = due(22).filter((card) => !graded.has(card.id))
  const restored = resumeOrStart(saved, stillDue, now)
  assert.equal(restored.phase, 'resting')
  assert.equal(restored.batchId, state.batchId)
  assert.equal(restored.isNewBatch, false)
  assert.equal(batchProgress(restored).label, '20/20')
})
