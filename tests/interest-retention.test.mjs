import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PASSAGES, countWords, ladderView, nextPassagePreview, nextReadableId, passageById } from '../shared/passages.ts'
import { glossFor } from '../shared/passage-gloss.ts'
import {
  beyondBand,
  coldStartPath,
  completionLines,
  matchingSenseIndex,
  passageReadingAids,
  readingMinutes,
} from '../shared/retention.ts'

const lines = readFileSync(new URL('../shared/wordfreq-en.txt', import.meta.url), 'utf8').trimEnd().split('\n')
const ranks = new Map(lines.map((word, i) => [word, i + 1]))
const rankOf = (word) => ranks.get(word)

test('cold start opens practice, refresh and in-app review stay put', () => {
  assert.equal(coldStartPath('/', 'navigate'), '/practice')
  assert.equal(coldStartPath('/', 'reload'), null)
  assert.equal(coldStartPath('/', 'back_forward'), null)
  assert.equal(coldStartPath('/practice', 'navigate'), null)
  assert.equal(coldStartPath('/add', 'navigate'), null)
  const router = readFileSync(new URL('../src/router.tsx', import.meta.url), 'utf8')
  assert.match(router, /coldStartPath/)
  assert.match(router, /shiju:cold-start/)
})

test('today card states minutes, streak, and a secondary review entry', () => {
  assert.equal(readingMinutes(0), 1)
  assert.equal(readingMinutes(90), 1)
  assert.equal(readingMinutes(200), 2)
  const home = readFileSync(new URL('../src/components/PassageHome.tsx', import.meta.url), 'utf8')
  assert.match(home, /今天的下一步/)
  assert.match(home, /开始阅读/)
  assert.match(home, /readingMinutes/)
  assert.match(home, /连续/)
  assert.match(home, /to="\/"/)
  const practice = readFileSync(new URL('../src/pages/Practice.tsx', import.meta.url), 'utf8')
  const hero = practice.indexOf('<PassageHome />')
  assert.ok(hero >= 0)
  assert.equal(practice.slice(0, hero).includes('<StatsCard'), false)
})

test('touch screens do not get the review keyboard hint', () => {
  const review = readFileSync(new URL('../src/pages/Review.tsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
  assert.match(review, /空格 翻转/)
  assert.match(review, /忘了/)
  assert.match(review, /模糊/)
  assert.match(review, /记得/)
  assert.match(review, /review-keyboard-hint/)
  assert.match(css, /pointer:\s*coarse/)
  assert.match(css, /\.review-keyboard-hint/)
})

test('finishing a passage previews the next title without unlocking further', () => {
  const ladder = ladderView(5000, null, [])
  const first = ladder.items[0].id
  assert.equal(nextPassagePreview(ladder.items, first), null)
  assert.equal(nextReadableId(ladder.items, first), null)
  const done = ladderView(5000, null, [first])
  const preview = nextPassagePreview(done.items, first)
  assert.ok(preview)
  assert.equal(preview.id, done.items[1].id)
  assert.equal(preview.title, passageById(done.items[1].id).title)
  assert.equal(done.items[2].state, 'locked')
  assert.equal(nextPassagePreview(done.items, done.items[2].id), null)

  const page = readFileSync(new URL('../src/pages/Passage.tsx', import.meta.url), 'utf8')
  assert.match(page, /下一篇/)
  assert.match(page, /出练习/)
  assert.match(page, /completionLines/)
  assert.match(page, /记下这一篇/)
  assert.match(page, /连续/)
  const linesOf = completionLines(186, 3)
  assert.deepEqual(linesOf, ['+1 篇', '读了 186 词', '查了 3 词'])
  assert.equal(completionLines(180, null).length >= 2, true)
  assert.equal(completionLines(180, null).some((line) => line.startsWith('查了')), false)
})

test('default marks stay sparse and every marked word has a sentence gloss', () => {
  assert.equal(beyondBand('the', rankOf, 3000), false)
  assert.equal(beyondBand('Mary', rankOf, 3000), false)
  assert.equal(beyondBand('a', rankOf, 3000), false)
  assert.equal(beyondBand('tradeoff', rankOf, 12000), true)
  assert.equal(beyondBand('follow-up', rankOf, 12000), false)

  for (const passage of PASSAGES) {
    const aids = passageReadingAids(passage.text, passage.band, rankOf, glossFor)
    const total = countWords(passage.text)
    assert.equal(aids.marks.length > 0, true, passage.id)
    assert.equal(aids.marks.length < total * 0.4, true, `${passage.id} marks ${aids.marks.length}/${total}`)
    for (const word of aids.marks) {
      assert.ok(aids.gloss[word]?.zh, `${passage.id} missing gloss for ${word}`)
      assert.ok(aids.gloss[word].hint, `${passage.id} missing hint for ${word}`)
    }
    assert.equal(aids.marks.includes('the'), false, passage.id)
    assert.equal(aids.marks.includes('mary'), false)
  }
})

test('first tap is a gloss popover; more opens the dictionary and can highlight a sense', () => {
  const peek = readFileSync(new URL('../src/components/WordPeek.tsx', import.meta.url), 'utf8')
  const passage = readFileSync(new URL('../src/pages/Passage.tsx', import.meta.url), 'utf8')
  const sheet = readFileSync(new URL('../src/components/WordLookupSheet.tsx', import.meta.url), 'utf8')
  assert.match(peek, /本句里/)
  assert.match(peek, /看意思/)
  assert.match(peek, /更多/)
  assert.equal(peek.includes('dict.senses'), false)
  assert.match(passage, /标全部/)
  assert.match(passage, /先猜/)
  assert.match(passage, /WordPeek/)
  assert.match(passage, /senseHint/)
  assert.match(sheet, /这句里的意思/)
  const senses = [
    { def: 'a round fruit that grows on a tree' },
    { def: 'the company that makes computers' },
  ]
  assert.equal(matchingSenseIndex(senses, 'round fruit tree'), 0)
  assert.equal(matchingSenseIndex(senses, 'computer company'), 1)
  assert.equal(matchingSenseIndex(senses, 'zzzz'), -1)
  assert.equal(matchingSenseIndex([{ def: 'only one' }], ''), 0)

  const review = readFileSync(new URL('../src/pages/Review.tsx', import.meta.url), 'utf8')
  const back = review.slice(review.indexOf('function Back'), review.indexOf('function GradeButton'))
  assert.match(back, /WordLookupSheet/)
  assert.equal(back.includes('WordPeek'), false)
  assert.equal(back.includes('mark='), false)
})
