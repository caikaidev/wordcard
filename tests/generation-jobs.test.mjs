import { d1Args } from './d1-bind.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { build } from 'esbuild'

const bundle = await build({ entryPoints: ['worker/generation-jobs.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const { prepareQuest, processGenerationBatch } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'))

function setup() {
  const sqlite = new DatabaseSync(':memory:')
  for (const file of readdirSync('migrations').filter(f => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync('migrations/' + file, 'utf8'))
  const db = {
    prepare(sql) {
      let params = []
      const statement = {
        bind(...args) { params = args; return statement },
        async first() { return sqlite.prepare(sql).get(...d1Args(sql, params)) ?? null },
        async all() { return { results: sqlite.prepare(sql).all(...d1Args(sql, params)) } },
        async run() { const r = sqlite.prepare(sql).run(...d1Args(sql, params)); return { meta: { changes: Number(r.changes) } } },
      }
      return statement
    },
    async batch(statements) { return Promise.all(statements.map(s => s.all())) },
  }
  const sends = []
  const calls = []
  const bank = {
    words: [{ en: 'habit', zh: '习惯', distractors: ['甲', '乙'] }, { en: 'routine', zh: '惯例', distractors: ['甲', '乙'] }],
    listening: [{ en: 'I read every day.', zh: '我每天阅读。', distractors: ['甲', '乙'], extra: [] }, { en: 'We learn every day.', zh: '我们每天学习。', distractors: ['甲', '乙'], extra: [] }],
    cloze: [], reading: [], speaking: [{ en: 'We learn together.', zh: '我们一起学习。' }],
  }
  const env = {
    DB: db,
    AI: { async run(model) { calls.push(model); return { response: JSON.stringify(bank), usage: { prompt_tokens: 10, completion_tokens: 12 } } } },
    GENERATION_QUEUE: { async send(msg) { sends.push(msg) } },
    GEMINI_TEXT_MODEL: 'gemini-test', GEMINI_TTS_MODEL: 'test', GEMINI_VOICE: 'test',
    DAILY_TEXT_LIMIT: '300', USER_DAILY_TEXT_LIMIT: '60', PER_MINUTE_LIMIT: '40',
  }
  const lesson = (id, user = 'alice') => {
    sqlite.prepare('INSERT INTO lessons (id, created_at, level, title, content, user_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, Date.now(), 2, 'Test', JSON.stringify({ title: 'Test', summary: 'test', words: [], expressions: [], tasks: [], speaking: [] }), user)
  }
  const message = id => {
    let acked = 0, retried = 0
    return { body: { jobId: id }, attempts: 1, ack() { acked++ }, retry() { retried++ }, get acked() { return acked }, get retried() { return retried } }
  }
  return { sqlite, env, lesson, sends, calls, message }
}

test('prepare is idempotent; one enqueue for duplicate calls and isolated users', async () => {
  const s = setup()
  try {
    s.lesson(1)
    const first = await prepareQuest(s.env, 'alice', 1)
    const second = await prepareQuest(s.env, 'alice', 1)
    assert.equal(first.status, 'queued')
    assert.equal(second.status, 'queued')
    assert.equal(first.jobId, second.jobId)
    assert.equal(s.sends.length, 1)
    assert.equal((await prepareQuest(s.env, 'bob', 1)).status, 'unavailable')
    assert.equal(s.sqlite.prepare('SELECT COUNT(*) n FROM generation_jobs').get().n, 1)
  } finally { s.sqlite.close() }
})

test('consumer writes bank once, acknowledges redelivery and keeps existing bank', async () => {
  const s = setup()
  try {
    s.lesson(1)
    const job = await prepareQuest(s.env, 'alice', 1)
    const first = s.message(job.jobId)
    await processGenerationBatch({ messages: [first] }, s.env)
    assert.equal(first.acked, 1)
    assert.equal(first.retried, 0)
    assert.equal(s.calls.length, 1)
    assert.equal(s.sqlite.prepare('SELECT status FROM generation_jobs WHERE id = ?').get(job.jobId).status, 'done')
    assert.equal(s.sqlite.prepare('SELECT COUNT(*) n FROM quests').get().n, 1)
    const redelivered = s.message(job.jobId)
    await processGenerationBatch({ messages: [redelivered] }, s.env)
    assert.equal(redelivered.acked, 1)
    assert.equal(s.calls.length, 1)
    assert.equal((await prepareQuest(s.env, 'alice', 1)).status, 'cached')
  } finally { s.sqlite.close() }
})

test('background quota limits to three tasks per user and never invokes Gemini', async () => {
  const s = setup()
  try {
    for (let i = 1; i <= 4; i++) s.lesson(i)
    for (let i = 1; i <= 3; i++) assert.equal((await prepareQuest(s.env, 'alice', i)).status, 'queued')
    assert.equal((await prepareQuest(s.env, 'alice', 4)).status, 'budget')
    assert.equal(s.sends.length, 3)
    s.sqlite.exec("INSERT INTO user_settings (user_id, key, value) VALUES ('bob', 'textProvider', 'gemini')")
    s.lesson(10, 'bob')
    assert.equal((await prepareQuest(s.env, 'bob', 10)).status, 'budget')
    assert.equal(s.sends.length, 3)
  } finally { s.sqlite.close() }
})

test('queue failure records failed task and never produces a silent generation', async () => {
  const s = setup()
  try {
    s.lesson(1)
    s.env.GENERATION_QUEUE.send = async () => { throw Error('queue unavailable') }
    const result = await prepareQuest(s.env, 'alice', 1)
    assert.equal(result.status, 'unavailable')
    assert.equal(s.sqlite.prepare('SELECT status FROM generation_jobs').get().status, 'failed')
    assert.equal(s.calls.length, 0)
  } finally { s.sqlite.close() }
})
