import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_COACH_PROFILE,
  LEGACY_INTERVIEW_COACH_PROFILE,
  applyDailyReadingVoice,
  coachExampleHint,
  isDailyReadingGoal,
  lessonPrompt,
  packageLessonPrompt,
  resolveCoachProfile,
} from '../shared/practice.ts'
import {
  buildComprehension,
  buildGuessItems,
  canRevealAnswer,
  decorateSentence,
  feedbackFor,
  formatReadingScore,
  gradeGuess,
  initialGuess,
  lessonListMeaning,
  parseReadingScore,
  splitScoreLabels,
  stepGuess,
} from '../shared/reading.ts'

const text = `Maya bakes bread before sunrise. She sells it to her neighbors.
The bakery is small, but the bread is always fresh.
People should arrive early if they want the warm loaf.`

const words = [
  { word: 'fresh', ipa: '/freʃ/', meaning: '新鲜的', quote: 'The bakery is small, but the bread is always fresh.' },
  { word: 'before', ipa: '', meaning: '在……之前', quote: 'Maya bakes bread before sunrise.' },
]

const OLD_DEFAULT = `我是中文母语的英语学习者，目标是能用英文完成工作面试和日常职场交流。
- 词汇：专业词汇还行，口语、日常和职场表达是短板
- 时间：每次练习 15–30 分钟
- 原则：目标是"能说出来"；先读后查；记句子不记单词
- 反馈：讲解用中文，示例和改写用英文；严格但鼓励；简洁，适合手机阅读`

test('guess blanks the target word, keeps context, and withholds the answer after one miss', () => {
  const items = buildGuessItems(words, text, () => 0)
  const item = items.find((row) => row.word === 'fresh')
  assert.ok(item)
  assert.equal(item.options.length, 4)
  assert.equal(new Set(item.options).size, 4)
  assert.ok(item.options.includes('新鲜的'))
  assert.match(item.masked, /____/)
  assert.match(item.masked, /bread/)
  assert.equal(/\bfresh\b/i.test(item.masked), false)
  assert.ok(item.clues.length > 0)
  assert.equal(item.clues.some((clue) => clue.toLowerCase() === 'fresh'), false)

  let state = stepGuess(initialGuess(), { type: 'clue' })
  assert.equal(state.clue, true)
  assert.equal(state.revealed, false)
  assert.equal(canRevealAnswer(state), false)

  state = stepGuess(initialGuess(), { type: 'answer', hit: false })
  assert.equal(state.wrongs, 1)
  assert.equal(state.clue, true)
  assert.equal(state.revealed, false)
  assert.equal(canRevealAnswer(state), false)
  assert.equal(JSON.stringify(state).includes('新鲜'), false)

  const shown = decorateSentence(item.sentence, [item], new Set(), item.id, true)
  assert.equal(shown.some((tok) => tok.blankId === item.id), true)
  assert.equal(shown.some((tok) => tok.lookup?.toLowerCase() === 'fresh'), false)
  assert.equal(shown.some((tok) => tok.clue), true)
  assert.match(shown.map((tok) => (tok.blankId ? '' : tok.text)).join(''), /bread/)

  state = stepGuess(state, { type: 'answer', hit: false })
  assert.equal(state.revealed, true)
  assert.equal(state.correct, false)
  assert.equal(canRevealAnswer(state), true)

  const correct = stepGuess(initialGuess(), { type: 'answer', hit: true })
  assert.equal(correct.correct, true)
  assert.equal(canRevealAnswer(correct), true)
})

test('lesson detail hides target glosses before read-the-original, reveal still keeps them', () => {
  assert.equal(lessonListMeaning('新鲜的', true), null)
  assert.equal(lessonListMeaning('在……之前', true), null)
  assert.equal(lessonListMeaning('新鲜的', false), '新鲜的')

  const item = buildGuessItems(words, text, () => 0).find((row) => row.word === 'fresh')
  assert.ok(item)
  assert.equal(item.meaning, '新鲜的')
  assert.equal(canRevealAnswer(stepGuess(initialGuess(), { type: 'answer', hit: true })), true)
})

test('short input accepts the word or the gloss, not an unrelated meaning', () => {
  const item = { word: 'fresh', meaning: '新鲜的' }
  assert.equal(gradeGuess('fresh', item), true)
  assert.equal(gradeGuess('  Fresh. ', item), true)
  assert.equal(gradeGuess('新鲜的', item), true)
  assert.equal(gradeGuess('新鲜', item), true)
  assert.equal(gradeGuess('面包', item), false)
  assert.equal(gradeGuess('', item), false)
})

test('comprehension has 3–5 questions and wrong answers carry a sentence from the passage', () => {
  const questions = buildComprehension(
    { title: 'Fresh bread', summary: "Maya's small bakery sells fresh bread early in the morning.", text, words },
    () => 0,
  )
  assert.ok(questions.length >= 3 && questions.length <= 5)
  const kinds = new Set(questions.map((q) => q.kind))
  assert.ok(kinds.has('主旨'))
  assert.ok(kinds.has('细节'))
  assert.ok(kinds.has('指代') || kinds.has('语气'))
  const flat = text.replace(/\s+/g, ' ').trim()
  for (const question of questions) {
    assert.equal(question.options.length, 4)
    assert.ok(question.options.includes(question.answer))
    for (const line of question.evidence.split('\n')) {
      assert.ok(flat.includes(line.replace(/\s+/g, ' ').trim()), `${question.kind} evidence missing: ${line}`)
    }
    const wrong = question.options.find((option) => option !== question.answer)
    const missed = feedbackFor(question, wrong)
    assert.equal(missed.correct, false)
    assert.equal(missed.evidence, question.evidence)
    assert.equal(feedbackFor(question, question.answer).correct, true)
    assert.equal(feedbackFor(question, question.answer).evidence, null)
  }
  const ref = questions.find((q) => q.kind === '指代')
  if (ref) assert.equal(ref.answer, 'Maya')
  const tone = questions.find((q) => q.kind === '语气')
  assert.ok(tone)
  assert.equal(tone.answer, '给出建议或要求')
  assert.match(tone.evidence, /should/)
})

test('reading score stays separate from writing score', () => {
  const labels = splitScoreLabels({ correct: 4, total: 5 }, 2)
  assert.equal(labels.reading, '阅读 4/5')
  assert.equal(labels.writing, '写作 2/3')
  assert.equal(labels.reading.includes('写作'), false)
  assert.equal(formatReadingScore(null), '阅读未检查')
  assert.deepEqual(parseReadingScore({ correct: 4, total: 5 }), { correct: 4, total: 5 })
  assert.deepEqual(parseReadingScore('{"correct":3,"total":3}'), { correct: 3, total: 3 })
  assert.equal(parseReadingScore({ correct: 1.5, total: 3 }), null)
  assert.equal(parseReadingScore({ correct: 6, total: 5 }), null)
  assert.equal(parseReadingScore({ correct: 0, total: 0 }), null)
})

test('default reading goal drops interview templates from output tasks', () => {
  assert.equal(OLD_DEFAULT, LEGACY_INTERVIEW_COACH_PROFILE)
  assert.equal(resolveCoachProfile(OLD_DEFAULT), DEFAULT_COACH_PROFILE)
  assert.equal(resolveCoachProfile('  '), DEFAULT_COACH_PROFILE)
  assert.match(DEFAULT_COACH_PROFILE, /入门日常阅读/)
  assert.doesNotMatch(DEFAULT_COACH_PROFILE, /面试/)
  assert.equal(isDailyReadingGoal(DEFAULT_COACH_PROFILE), true)
  assert.equal(isDailyReadingGoal(OLD_DEFAULT), true)
  assert.equal(isDailyReadingGoal('我要准备面试'), false)

  for (const profile of [DEFAULT_COACH_PROFILE, OLD_DEFAULT, '']) {
    const prompt = lessonPrompt(profile, 1, 'Maya bakes bread.')
    assert.doesNotMatch(prompt, /面试|interviewer|用于面试回答|模拟面试官/)
    assert.match(prompt, /入门日常阅读/)
    assert.doesNotMatch(prompt, /工作或经历/)
    const packaged = packageLessonPrompt(profile, 2, 'Bread', 'Ch1', [{ text: 'fresh', meaning: '新鲜的', example: 'The bread is fresh.' }])
    assert.doesNotMatch(packaged, /面试|interviewer|模拟面试官|用于面试回答/)
    assert.match(packaged, /日常生活/)
  }
  assert.match(coachExampleHint(DEFAULT_COACH_PROFILE), /日常生活/)
  assert.doesNotMatch(coachExampleHint(DEFAULT_COACH_PROFILE), /工作|面试/)

  const customPrompt = lessonPrompt('我要准备面试', 1, 'Maya bakes bread.')
  assert.match(customPrompt, /我要准备面试/)
  assert.doesNotMatch(customPrompt, /模拟面试官|用于面试回答/)

  const content = {
    title: 'T',
    fit: 'ok',
    fitNote: '',
    summary: 's',
    words: [],
    expressions: [{ pattern: 'in an interview, ...', meaning: '用于面试回答', example: 'Tell the interviewer.' }],
    tasks: [
      { goal: '讲清楚', prompt: '把这段经历用于面试回答', template: 'In an interview I would say' },
      { goal: '有观点', prompt: '假设面试官问你是否同意', template: '' },
      { goal: '连到自己', prompt: '连到你的工作面试经历', template: '' },
    ],
    speaking: [{ question: 'What would you tell an interviewer?', hint: '模拟面试官会追问' }],
  }
  const daily = applyDailyReadingVoice(content, DEFAULT_COACH_PROFILE)
  const blob = JSON.stringify({ tasks: daily.tasks, speaking: daily.speaking, expressions: daily.expressions })
  assert.doesNotMatch(blob, /面试|interviewer|in an interview/i)
  const kept = applyDailyReadingVoice(content, '我的目标是工作面试，请模拟面试官。')
  assert.match(kept.tasks[0].prompt, /用于面试回答/)
  assert.match(kept.speaking[0].hint, /模拟面试官/)
})
