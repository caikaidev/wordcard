import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { build } from 'esbuild'

// Bundle the actual Worker router, then run its D1 SQL against SQLite.
const bundle = await build({ entryPoints: ['worker/quest.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const { quest } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text + '\n//# sourceURL=quest-worker-test.mjs').toString('base64'))
const { Hono } = await import('hono')
const app = new Hono()
app.use('*', async (c, next) => { c.set('user', c.req.header('x-test-user') || 'alice'); c.set('admin', false); await next() })
app.route('/quest', quest)

function setup() {
  const sqlite = new DatabaseSync(':memory:')
  for (const file of readdirSync('migrations').filter(f => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync('migrations/' + file, 'utf8'))
  const db = { prepare(sql) {
    let args = []
    const statement = {
      bind(...values) { args = values; return statement },
      async first() { return sqlite.prepare(sql).get(...args) ?? null },
      async all() { return { results: sqlite.prepare(sql).all(...args) } },
      async run() {
        if (/^\s*SELECT/i.test(sql)) return { results: sqlite.prepare(sql).all(...args), meta: { changes: 0 } }
        const r = sqlite.prepare(sql).run(...args)
        return { meta: { changes: Number(r.changes) } }
      },
    }
    return statement
  }, async batch(statements) { return Promise.all(statements.map(s => s.run())) } }
  const env = { DB: db, AUDIO: { head: async () => ({}) }, GEMINI_API_KEY: 'test-only', GEMINI_TEXT_MODEL: 'gemini-test', GEMINI_VOICE: 'test' }
  const tasks = []
  const context = { waitUntil: p => tasks.push(p), passThroughOnException() {} }
  const request = (path, method = 'POST', body, user = 'alice') => app.request('/quest' + path, { method, headers: { 'content-type': 'application/json', 'x-test-user': user }, ...(body ? { body: JSON.stringify(body) } : {}) }, env, context)
  const content = { title: 'Test', summary: 'test', words: [], expressions: [], tasks: [], speaking: [] }
  const bank = { words: [{ en: 'habit', zh: '习惯', distractors: ['甲', '乙'] }, { en: 'routine', zh: '惯例', distractors: ['甲', '乙'] }], listening: [{ en: 'I read every day.', zh: '我每天阅读。', distractors: ['甲', '乙'], extra: [] }], cloze: [], reading: [], speaking: [{ en: 'We learn together.', zh: '我们一起学。' }] }
  const lesson = (id, progress, owner = 'alice', level = 2) => {
    sqlite.prepare('INSERT INTO lessons (id, created_at, level, title, content, user_id) VALUES (?, ?, ?, ?, ?, ?)').run(id, Date.now(), level, 'Test', JSON.stringify(content), owner)
    if (progress) sqlite.prepare('INSERT INTO quests (lesson_id, user_id, content, progress, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, owner, JSON.stringify(bank), JSON.stringify(progress), Date.now(), Date.now())
  }
  return { sqlite, request, lesson, bank, tasks }
}

test('speech unlocks after reading, has completion XP only, and does not award XP twice', async () => {
  const s = setup()
  s.lesson(1, { stages: { words: { accuracy: 1 }, listen: { accuracy: 1 }, read: { accuracy: 1 } }, xp: 45 })
  let response = await s.request('/1/stages/speak', 'POST', { accuracy: 1 })
  assert.equal(response.status, 200)
  let body = await response.json()
  assert.equal(body.gained, 10)
  assert.equal(body.progress.xp, 55)
  body = await (await s.request('/1/stages/speak', 'POST', { accuracy: 1 })).json()
  assert.equal(body.gained, 0)
  assert.equal(body.progress.xp, 55)
  s.lesson(2, { stages: {}, xp: 0 })
  assert.equal((await s.request('/2/stages/speak', 'POST', { accuracy: 1 })).status, 409)
  s.sqlite.close()
})

test('feedback validates ownership, completion and enum; updates one row without XP changes', async () => {
  const s = setup()
  s.lesson(1, { stages: { words: { accuracy: 1, firstAccuracy: 0.5 } }, xp: 15 })
  assert.equal((await s.request('/1/stages/words/feedback', 'PUT', { difficulty: 'bad' })).status, 400)
  assert.equal((await s.request('/1/stages/words/feedback', 'PUT', { difficulty: 'easy' }, 'bob')).status, 404)
  assert.equal((await s.request('/1/stages/listen/feedback', 'PUT', { difficulty: 'easy' })).status, 409)
  assert.equal((await s.request('/1/stages/words/feedback', 'PUT', { difficulty: 'easy' })).status, 200)
  const first = s.sqlite.prepare('SELECT * FROM quest_feedback').get()
  assert.equal(first.accuracy, 0.5)
  await s.request('/1/stages/words', 'POST', { accuracy: 1 })
  await s.request('/1/stages/words/feedback', 'PUT', { difficulty: 'hard' })
  const rows = s.sqlite.prepare('SELECT * FROM quest_feedback').all()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].difficulty, 'hard')
  assert.equal(rows[0].created_at, first.created_at)
  assert.equal(rows[0].accuracy, 0.5)
  const snapshot = await (await s.request('/1')).json()
  assert.equal(snapshot.feedback.words, 'hard')
  assert.equal(snapshot.progress.xp, 15)
  s.sqlite.close()
})

test('new generation uses recent same-user, same-level feedback; cached banks are untouched', async () => {
  const s = setup()
  for (let i = 1; i <= 3; i++) {
    s.lesson(i, { stages: { listen: { accuracy: 1 } }, xp: 15 })
    await s.request(`/${i}/stages/listen/feedback`, 'PUT', { difficulty: 'hard' })
  }
  for (let i = 4; i <= 6; i++) {
    s.lesson(i, { stages: { read: { accuracy: 1 } }, xp: 15 }, 'bob')
    await s.request(`/${i}/stages/read/feedback`, 'PUT', { difficulty: 'hard' }, 'bob')
    s.lesson(i + 10, { stages: { read: { accuracy: 1 } }, xp: 15 }, 'alice', 3)
    await s.request(`/${i + 10}/stages/read/feedback`, 'PUT', { difficulty: 'hard' })
  }
  s.lesson(20)
  const originalFetch = globalThis.fetch
  let prompt = '', calls = 0
  globalThis.fetch = async (_url, options) => {
    calls++
    prompt = JSON.parse(options.body).contents[0].parts[0].text
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(s.bank) }] } }] })
  }
  try {
    const response = await s.request('/20')
    assert.equal(response.status, 200, await response.clone().text())
    assert.match(prompt, /听力：在当前档位内稍降低难度/)
    assert.match(prompt, /阅读：保持当前档位的常规难度/)
    assert.match(prompt, /speaking：3 个独立/)
    assert.equal(calls, 1)
    const cached = await (await s.request('/20')).json()
    assert.deepEqual(cached.content.speaking, s.bank.speaking)
    assert.equal(calls, 1)
    await Promise.all(s.tasks)
  } finally { globalThis.fetch = originalFetch; s.sqlite.close() }
})
