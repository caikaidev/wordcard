import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildStage, routeStatus, unlocked, speakingSentences } from '../shared/quest.ts'
import { difficultyAdjustments, difficultyPrompt } from '../shared/difficulty.ts'

const bank = { words: [], listening: [{ en: 'I read every day.', zh: '我每天阅读。', distractors: [], extra: [] }], cloze: [], reading: [] }
test('reading unlocks speaking, then speaking unlocks writing', () => {
  const p = { stages: { words: {}, listen: {}, read: {} }, xp: 0 }
  assert.equal(routeStatus(p, false).next, 'speak')
  assert.equal(unlocked(p, 'speak'), true)
  assert.equal(unlocked(p, 'write'), false)
  p.stages.speak = {}
  assert.equal(routeStatus(p, false).next, 'write')
  assert.equal(unlocked(p, 'write'), true)
  assert.equal(routeStatus(p, true).next, null)
  assert.equal(routeStatus(p, true).total, 5)
})
test('old banks derive speaking without changing old content/progress', () => {
  assert.deepEqual(buildStage('speak', bank), [{ kind: 'speak', en: 'I read every day.', zh: '我每天阅读。' }])
  assert.equal(bank.speaking, undefined)
  assert.equal(routeStatus({ stages: { words: {}, listen: {}, read: {} }, xp: 45 }, true).next, 'speak')
})
test('speaking prefers dedicated sentences, deduplicates, skips templates', () => {
  const result = speakingSentences({ ...bank, speaking: [
    { en: 'I read every day.', zh: '每天阅读。' }, { en: 'Then I ... for [time].', zh: '模板' },
    { en: 'We learn together.', zh: '一起学。' }, { en: 'Practice makes progress.', zh: '练习带来进步。' },
  ] })
  assert.equal(result.length, 3)
  assert.equal(result.filter(x => x.en === 'I read every day.').length, 1)
  assert.ok(result.every(x => !x.en.includes('...')))
})
test('single feedback does not change difficulty; stage signals stay isolated', () => {
  const hard = { stage: 'listen', difficulty: 'hard', accuracy: 1 }
  assert.equal(difficultyAdjustments([hard]).listen, 0)
  const adjusted = difficultyAdjustments([hard, hard, hard])
  assert.equal(adjusted.listen, -1)
  assert.equal(adjusted.words, 0)
  assert.equal(adjusted.speak, 0)
})
test('easy but low accuracy never increases difficulty; speaking uses self report', () => {
  const easy = { stage: 'read', difficulty: 'easy', accuracy: 0.4 }
  assert.equal(difficultyAdjustments([easy, easy, easy]).read, 0)
  const oral = { stage: 'speak', difficulty: 'easy', accuracy: null }
  assert.equal(difficultyAdjustments([oral, oral, oral]).speak, 1)
})
test('only recent eight samples count and mixed feedback stays neutral', () => {
  const hard = { stage: 'words', difficulty: 'hard', accuracy: 0.5 }
  const right = { ...hard, difficulty: 'right' }
  assert.equal(difficultyAdjustments([...Array(8).fill(right), ...Array(30).fill(hard)]).words, 0)
  assert.equal(difficultyAdjustments([hard, right, { ...hard, difficulty: 'easy', accuracy: 1 }]).words, 0)
  assert.match(difficultyPrompt([]), /不改变用户选择的档位/)
})
