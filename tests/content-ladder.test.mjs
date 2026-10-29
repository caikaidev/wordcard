import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  PASSAGES,
  bandOf,
  countWords,
  ladderView,
  passageById,
  resolveVocabCount,
} from '../shared/passages.ts'
import {
  discoverArticles,
  shouldAutoEnroll,
  takeDiscoverPassage,
} from '../shared/discover.ts'
import {
  REMIX_ATTEMPT_MS,
  REMIX_ATTEMPTS,
  REMIX_TIMEOUT_SEC,
  normalizeRemixSentences,
  remixCoherent,
  remixFailure,
  remixPassageText,
  remixPrompt,
  remixReady,
  remixRetryPrompt,
  selectRemixTargets,
  shallowRankFloor,
} from '../shared/remix.ts'

const FAR = [
  'leverage',
  'consensus',
  'paradigm',
  'coherent',
  'reluctance',
  'discrepancy',
  'ambiguity',
  'undermine',
  'provisional',
  'contingent',
  'inherent',
  'friction',
  'tangible',
  'plausible',
  'implicit',
  'bandwidth',
  'backlog',
  'threshold',
  'momentum',
  'incentive',
  'deliberate',
  'negotiate',
  'assumption',
  'interpret',
  'colleague',
]

const hasStem = (text, word) => new RegExp(`\\b${word}`, 'i').test(text)

test('each graded passage is 150–300 words and stays inside its band', () => {
  assert.equal(PASSAGES.length >= 12, true)
  for (const band of [3000, 5000, 8000, 12000]) {
    assert.equal(PASSAGES.filter((p) => p.band === band).length >= 3, true, `band ${band}`)
  }
  for (const p of PASSAGES) {
    assert.equal(p.words, countWords(p.text), p.id)
    assert.equal(p.words >= 150 && p.words <= 300, true, `${p.id} has ${p.words} words`)
    assert.equal(passageById(p.id)?.id, p.id)
  }
  for (const p of PASSAGES.filter((p) => p.band === 3000)) {
    const hit = FAR.filter((word) => hasStem(p.text, word))
    assert.deepEqual(hit, [], `${p.id} uses words far above the beginner band: ${hit.join(', ')}`)
  }
  const upper = ['coherent', 'tangible', 'plausible', 'reluctance', 'implicit', 'paradigm', 'discrepancy', 'ambiguity']
  for (const p of PASSAGES.filter((p) => p.band === 12000)) {
    const hit = upper.filter((word) => hasStem(p.text, word))
    assert.equal(hit.length >= 3, true, `${p.id} should actually sit in the top band`)
  }
})

test('beginner band never gets a default recommendation above its ladder', () => {
  assert.equal(bandOf(3000), 3000)
  assert.equal(resolveVocabCount(3000, 18000), 3000)
  const ladder = ladderView(3000, 18000, [])
  assert.equal(ladder.band, 3000)
  assert.equal(ladder.source, 'setting')
  assert.ok(ladder.today)
  assert.equal(PASSAGES.find((p) => p.id === ladder.today.id)?.band, 3000)
  assert.equal(ladder.items.every((item) => item.band === 3000), true)
  assert.equal(ladder.items.some((item) => item.band >= 8000), false)
  assert.equal(ladder.items[0].state, 'current')
  assert.equal(ladder.items[1].state, 'locked')
  assert.equal(ladder.items[1].excerpt, undefined)
  assert.equal(JSON.stringify(ladder).includes('Against a tidy paradigm'), false)

  const auto = ladderView(0, 2500, [])
  assert.equal(auto.band, 3000)
  assert.equal(auto.source, 'estimate')
  assert.equal(auto.items.every((item) => item.band === 3000), true)

  const unset = ladderView(0, null, [])
  assert.equal(unset.band, 5000)
  assert.equal(unset.source, 'default')
})

test('finishing one passage unlocks only the next one', () => {
  const first = ladderView(5000, null, [])
  const id = first.items[0].id
  const next = ladderView(5000, null, [id])
  assert.equal(next.items[0].state, 'done')
  assert.equal(next.items[1].state, 'current')
  assert.equal(next.items[2].state, 'locked')
  assert.equal(next.today.id, next.items[1].id)
  assert.notEqual(next.items[1].excerpt, undefined)
  const full = passageById(next.items[1].id)
  assert.notEqual(next.items[1].excerpt, full.text)
  const done = ladderView(5000, null, next.items.map((item) => item.id))
  assert.equal(done.today, null)
  assert.equal(done.items.every((item) => item.state === 'done'), true)
})

test('remix drops shallow words and asks for one coherent passage', () => {
  assert.equal(shallowRankFloor(3000), 800)
  assert.equal(shallowRankFloor(8000), 3200)
  const ranks = { the: 1, time: 80, good: 200, leverage: 8410, consensus: 5916 }
  const picked = selectRemixTargets(
    [
      { text: 'the' },
      { text: 'time' },
      { text: 'good' },
      { text: 'leverage' },
      { text: 'consensus' },
    ],
    (word) => ranks[word],
    8000,
  )
  assert.deepEqual(picked.kept.map((item) => item.text), ['leverage', 'consensus', 'good'])
  assert.deepEqual(picked.dropped, ['the', 'time'])

  const phrase = selectRemixTargets([{ text: 'move the goalposts' }, { text: 'the' }], (word) => (word === 'move' || word === 'the' ? 5 : undefined), 8000)
  assert.equal(phrase.kept.some((item) => item.text === 'move the goalposts'), true)

  const prompt = remixPrompt([{ text: 'leverage', meaning: '利用' }])
  assert.match(prompt, /连贯/)
  assert.match(prompt, /3 到 5/)
  assert.match(prompt, /不要写三句互不相关/)
  assert.match(prompt, /同一件事/)
  assert.equal(REMIX_ATTEMPTS, 2)
  assert.equal(REMIX_ATTEMPTS * REMIX_ATTEMPT_MS < REMIX_TIMEOUT_SEC * 1000, true)

  const raw = [
    { en: 'Lina opened the shop before sunrise.', zh: '丽娜日出前开了店。', highlights: ['shop', 'missing'] },
    { en: 'She saved the warm bread for her neighbor.', zh: '她把热面包留给邻居。', highlights: ['bread'] },
    { en: 'By noon the street was busy and kind.', zh: '中午时街道热闹而和气。', highlights: [] },
    { en: 'too short', zh: '', highlights: [] },
  ]
  const sentences = normalizeRemixSentences(raw)
  assert.equal(sentences[0].highlights.includes('missing'), false)
  assert.equal(remixReady(sentences.slice(0, 2)), false)
  assert.equal(remixReady(sentences.slice(0, 3)), true)
  assert.equal(remixCoherent(sentences.slice(0, 3)), true)
  assert.equal(remixFailure(sentences.slice(0, 3)), null)
  assert.match(remixPassageText(sentences.slice(0, 3)), /opened the shop.*warm bread.*street was busy/)

  const scattered = [
    { en: 'Teams leverage the new process to ship the release.' },
    { en: 'Gardeners reached a consensus about the tomato beds.' },
    { en: 'Her reluctance to travel surprised the orchestra.' },
    { en: 'The invoice showed a discrepancy in the final total.' },
  ]
  assert.equal(remixReady(scattered), true)
  assert.equal(remixCoherent(scattered), false)
  assert.match(remixFailure(scattered), /各说各的/)
  const glued = [
    { en: 'Then the chef baked the bread before sunrise.' },
    { en: 'Then the pilot landed the plane in heavy rain.' },
    { en: 'Then the judge closed the hearing for the day.' },
  ]
  assert.equal(remixCoherent(glued), false)
  const retry = remixRetryPrompt([{ text: 'leverage', meaning: '利用' }], scattered)
  assert.match(retry, /上一稿被拒绝/)
  assert.match(retry, /Teams leverage/)
})

test('discover results collapse into passage cards and do not require saving', () => {
  const passage = {
    title: 'A late bus',
    en: 'The commuters waited by the closed road while a delay turned into a long conversation about the schedule. A woman checked the time, then told the man beside her that the office could start without them. He laughed, because the meeting was his, and said the notes could wait on the table until morning. Rain kept the crowd close together. Someone shared a story about a missed train and a kind stranger. The group stopped treating the pause as a problem and started treating it as an unexpected break. When the bus finally arrived, people boarded slowly, still talking about the schedule and the delay. The evening was later than planned, but nobody called it a disaster, and the city felt a little smaller in a good way.',
    zh: '通勤的人等在封闭的路口。一次延误变成了关于日程的长谈。',
    batch: 10,
  }
  assert.equal(takeDiscoverPassage({ title: 'Too short', en: 'Only a few words here about delay.', zh: '' }, ['delay'], 1), null)
  assert.equal(takeDiscoverPassage(passage, ['notaword', 'another'], 10), null)
  const kept = takeDiscoverPassage(passage, ['delay', 'schedule'], 10)
  assert.equal(kept?.title, 'A late bus')

  const word = (id, text, extra = {}) => ({
    id,
    text,
    meta: { ipa: '', pos: 'n.', meaning: `${text}的意思`, example: `People mentioned ${text} today.`, exampleZh: '例句。', highlight: text, phrases: [] },
    why: '值得学',
    source: 'HN',
    url: null,
    hits: 2,
    created_at: 10,
    ...extra,
  })
  const articles = discoverArticles([
    word(1, 'delay', { passage: kept }),
    word(2, 'schedule', { passage: kept }),
    word(3, 'commute', { passage: kept }),
  ])
  assert.equal(articles.length, 1)
  assert.equal(articles[0].composed, true)
  assert.equal(articles[0].words.length, 3)
  assert.match(articles[0].en, /delay/)

  const legacy = discoverArticles([word(4, 'alpha', { created_at: 4, passage: undefined }), word(5, 'beta', { created_at: 4, passage: undefined })])
  assert.equal(legacy.length, 1)
  assert.equal(legacy[0].composed, false)
  assert.match(legacy[0].en, /alpha/)
  assert.match(legacy[0].en, /beta/)

  const discoverSrc = readFileSync(new URL('../worker/discover.ts', import.meta.url), 'utf8')
  const run = discoverSrc.slice(discoverSrc.indexOf('export async function runDiscover'), discoverSrc.indexOf('type DiscoveryRow'))
  assert.equal(run.includes('addToLibrary'), false)
  const manual = discoverSrc.slice(discoverSrc.indexOf("discover.post('/run'"), discoverSrc.indexOf('const idsOf'))
  assert.equal(manual.includes('addToLibrary'), false)
  assert.match(manual, /enrolled: 0/)
  const auto = discoverSrc.slice(discoverSrc.indexOf('export async function autoDiscover'), discoverSrc.indexOf('/* ------------------------------ 接口'))
  assert.match(auto, /shouldAutoEnroll/)
  assert.match(auto, /addToLibrary/)
  const settings = readFileSync(new URL('../worker/settings.ts', import.meta.url), 'utf8')
  assert.match(settings, /discoverAuto: false/)
  assert.match(settings, /shouldAutoEnroll\(um\.discoverAuto\)/)
  assert.equal(shouldAutoEnroll(undefined), false)
  assert.equal(shouldAutoEnroll(false), false)
  assert.equal(shouldAutoEnroll('0'), false)
  assert.equal(shouldAutoEnroll(null), false)
  assert.equal(shouldAutoEnroll('1'), true)
  assert.equal(shouldAutoEnroll(1), true)
  assert.equal(shouldAutoEnroll(true), true)

  const page = readFileSync(new URL('../src/pages/Discover.tsx', import.meta.url), 'utf8')
  assert.match(page, /aria-label="自动加入复习"/)
  assert.match(page, /role="switch"/)
  assert.match(page, /const \[autoAdd, setAutoAdd\] = useState\(false\)/)
  assert.match(page, /关（默认）/)
  assert.equal(page.includes('type="checkbox"'), false)
  const pick = page.slice(page.indexOf('onPick={(form)'), page.indexOf('/>', page.indexOf('onPick={(form)')))
  assert.equal(pick.includes('onLearn'), false)
  assert.equal(pick.includes('learnDiscoveries'), false)

  const gemini = readFileSync(new URL('../worker/gemini.ts', import.meta.url), 'utf8')
  assert.match(gemini, /remixCoherent/)
  assert.match(gemini, /remixRetryPrompt/)
  assert.match(gemini, /REMIX_ATTEMPTS/)
})

test('the browser bundle is not handed the locked passage catalog', () => {
  const files = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.(ts|tsx)$/.test(name)) files.push(path)
    }
  }
  walk('src')
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(/import\s+[\s\S]*?from\s+['"][^'"]*shared\/passages['"]/g)) {
      assert.match(match[0], /^import type\b/, `${file} must not ship passage text to the browser`)
    }
  }
})
