import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { build } from 'esbuild'
import { d1Args } from './d1-bind.mjs'
import { Hono } from 'hono'

const bundle = await build({ stdin: { contents: `
  export { quest, generateQuestBank } from './worker/quest'
  export { prepareQuest, processGenerationBatch } from './worker/generation-jobs'
  export * from './shared/quest-buffer'
`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false })
const { quest, generateQuestBank, prepareQuest, processGenerationBatch, readyCount, remainingReady } = await import(
  'data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text + '\n//# sourceURL=buffer-worker-test.mjs').toString('base64'))

const full = {
  words: ['habit','routine','practice','learn','read'].map((en, i) => ({ en, zh: `正确${i}`, distractors: ['甲','乙','丙'] })),
  listening: ['We practice every day.', 'I read every morning.', 'They learn in school.', 'We share useful ideas.']
    .map((en) => ({ en, zh: '正确译文', distractors: ['甲','乙','丙'], extra: ['park','bike'] })),
  cloze: ['I ____ every day.', 'We ____ together.', 'They ____ books.']
    .map((sentence) => ({ sentence, answer: 'read', distractors: ['eat','sleep','walk'], zh: '正确译文' })),
  reading: [1,2].map((n) => ({ passage: `Passage ${n}.`, questions: [1,2].map((i) => ({ question: `问题${i}`, answer: '正确', distractors: ['甲','乙','丙'], explain: '解析' })) })),
  speaking: ['We practice every day.', 'We share new ideas.', 'Reading makes us happy.'].map((en) => ({ en, zh: '正确译文' })),
}

function setup() {
  const sqlite = new DatabaseSync(':memory:')
  for (const f of readdirSync('migrations').filter(f => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync('migrations/' + f, 'utf8'))
  const db = { prepare(sql) {
    let args = []
    const statement = {
      bind(...values) { args = values; return statement },
      async first() { return sqlite.prepare(sql).get(...d1Args(sql, args)) ?? null },
      async all() { return { results: sqlite.prepare(sql).all(...d1Args(sql, args)) } },
      async run() {
        if (/^\s*SELECT/i.test(sql)) return statement.all()
        return { meta: { changes: Number(sqlite.prepare(sql).run(...d1Args(sql, args)).changes) } }
      },
    }
    return statement
  }, async batch(statements) { return Promise.all(statements.map(s => s.run())) } }
  const calls = [], sent = [], tasks = []
  const env = {
    DB: db, AUDIO: { head: async () => ({}) },
    AI: { async run(model, input) { calls.push({ model, input }); return { response: JSON.stringify(full) } } },
    GENERATION_QUEUE: { async send(message) { sent.push(message) } },
    GEMINI_TEXT_MODEL: 'test', GEMINI_TTS_MODEL: 'test', GEMINI_VOICE: 'test',
  }
  const lesson = (id, user = 'alice') => sqlite.prepare(
    'INSERT INTO lessons (id,created_at,level,title,content,user_id) VALUES (?,?,?,?,?,?)',
  ).run(id, Date.now(), 2, 'Test', JSON.stringify({ title: 'Test', summary: '', words: [], expressions: [], tasks: [], speaking: [] }), user)
  const app = new Hono()
  app.use('*', async (c, next) => { c.set('user', c.req.header('x-user') || 'alice'); c.set('admin', false); await next() })
  app.route('/quest', quest)
  const request = (path, method = 'GET', user = 'alice', body) => app.request('/quest' + path, {
    method, headers: { 'x-user': user, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
  }, env, { waitUntil(p) { tasks.push(p) }, passThroughOnException() {} })
  const deliver = async (id) => {
    const outcome = { ack: 0, retry: 0 }
    await processGenerationBatch({ messages: [{ body: { jobId: id }, attempts: 1,
      ack() { outcome.ack++ }, retry() { outcome.retry++ } }] }, env)
    return outcome
  }
  return { sqlite, env, lesson, calls, sent, tasks, request, deliver }
}

test('new bank serves ten ready screens, tail appends to twenty without rewriting progress', async () => {
  const s = setup()
  try {
    s.lesson(1)
    const first = await s.request('/1', 'POST')
    assert.equal(first.status, 200, await first.clone().text())
    const q = await first.json()
    assert.equal(q.buffer.phase, 'starter')
    assert.equal(q.buffer.ready, 10)
    assert.equal(q.content.cloze.length, 0)
    assert.equal(q.content.speaking, undefined)
    assert.equal(s.calls.length, 1)
    const prompt = s.calls[0].input.messages[0].content
    assert.match(prompt, /只生成首批认词与听力题/)
    const progress = JSON.stringify({ stages: { words: { accuracy: 1, firstAccuracy: 1, at: 1 } }, xp: 15 })
    s.sqlite.prepare('UPDATE quests SET progress = ? WHERE lesson_id = 1').run(progress)
    assert.equal((await prepareQuest(s.env, 'alice', 1)).status, 'cached', 'opening lesson does not auto-fill tail')
    const job = await prepareQuest(s.env, 'alice', 1, true)
    assert.equal(job.status, 'queued')
    assert.equal((await prepareQuest(s.env, 'alice', 1, true)).jobId, job.jobId)
    assert.equal(s.sent.length, 1)
    assert.equal((await s.deliver(job.jobId)).ack, 1)
    const filled = await (await s.request('/1')).json()
    assert.equal(filled.buffer.phase, 'complete')
    assert.equal(filled.buffer.ready, 20)
    assert.deepEqual(filled.content.words, q.content.words)
    assert.deepEqual(filled.content.listening, q.content.listening)
    assert.equal(s.sqlite.prepare('SELECT progress FROM quests').get().progress, progress)
    assert.equal(s.calls.length, 2)
    assert.match(s.calls[1].input.messages[0].content, /只补充后半套题/)
    await s.deliver(job.jobId)
    await s.request('/1', 'POST')
    await s.request('/1/complete', 'POST')
    assert.equal(s.calls.length, 2, 'cached, complete and redelivered tasks spend no inference')
    await Promise.all(s.tasks)
  } finally { s.sqlite.close() }
})

test('polling is read-only, unavailable stages cannot award XP, and ownership is enforced', async () => {
  const s = setup()
  try {
    s.lesson(1)
    assert.equal((await s.request('/1')).status, 202)
    assert.equal(s.calls.length, 0)
    assert.equal((await s.request('/1', 'POST', 'bob')).status, 404)
    await s.request('/1', 'POST')
    s.sqlite.prepare('UPDATE quests SET progress = ?').run(JSON.stringify({ stages: { words: { accuracy: 1 }, listen: { accuracy: 1 } }, xp: 30 }))
    assert.equal((await s.request('/1/stages/read', 'POST', 'alice', { accuracy: 1 })).status, 409)
    s.sqlite.prepare("INSERT INTO generation_jobs (user_id,lesson_id,kind,status,created_at,updated_at) VALUES ('alice',1,'quest_tail','failed',?,?)").run(Date.now(), Date.now())
    for (let i = 0; i < 4; i++) assert.equal((await s.request('/1')).status, 200)
    assert.equal(s.calls.length, 1)
    assert.equal((await s.request('/1/complete', 'POST')).status, 200, 'explicit request can recover a failed tail')
    assert.equal(s.calls.length, 2)
    await Promise.all(s.tasks)
  } finally { s.sqlite.close() }
})

test('atomic per-user reservations admit three concurrent tasks, including executing the last reservation', async () => {
  const s = setup()
  try {
    for (let i = 1; i <= 6; i++) s.lesson(i)
    const jobs = await Promise.all([1,2,3,4,5,6].map(id => prepareQuest(s.env, 'alice', id)))
    assert.equal(jobs.filter(j => j.status === 'queued').length, 3)
    assert.equal(jobs.filter(j => j.status === 'budget').length, 3)
    for (const j of jobs.filter(j => j.jobId)) assert.equal((await s.deliver(j.jobId)).ack, 1)
    assert.equal(s.calls.length, 3, 'the admitted third job is not blocked by counting itself')
    assert.equal(s.sqlite.prepare("SELECT COUNT(*) n FROM generation_jobs WHERE status='done'").get().n, 3)
  } finally { s.sqlite.close() }
})

test('atomic global quota holds under multiple users; switching to Gemini prevents background inference', async () => {
  const s = setup()
  try {
    const requests = []
    for (let i = 1; i <= 15; i++) { const user = `user-${i}`; s.lesson(i, user); requests.push(prepareQuest(s.env, user, i)) }
    const jobs = await Promise.all(requests)
    assert.equal(jobs.filter(j => j.status === 'queued').length, 12)
    assert.equal(s.sent.length, 12)
    s.sqlite.exec("INSERT INTO user_settings (user_id,key,value) VALUES ('user-1','textProvider','gemini')")
    await s.deliver(jobs[0].jobId)
    assert.equal(s.calls.length, 0)
    assert.equal(s.sqlite.prepare('SELECT status FROM generation_jobs WHERE id=?').get(jobs[0].jobId).status, 'failed')
  } finally { s.sqlite.close() }
})

test('HTTP and Queue races share one generation lease', async () => {
  const s = setup()
  let started, release
  const began = new Promise(r => { started = r }), gate = new Promise(r => { release = r })
  try {
    s.lesson(1)
    s.env.AI.run = async () => { s.calls.push(1); started(); await gate; return { response: JSON.stringify(full) } }
    const job = await prepareQuest(s.env, 'alice', 1)
    const work = s.deliver(job.jobId)
    await began
    const response = await s.request('/1', 'POST')
    assert.equal(response.status, 202)
    assert.equal(s.calls.length, 1)
    release(); await work
    assert.equal((await s.request('/1', 'POST')).status, 200)
    assert.equal(s.calls.length, 1)
  } finally { release(); s.sqlite.close() }
})

test('deleted lessons cannot be resurrected by an in-flight generation', async () => {
  const s = setup()
  let started, release
  const began = new Promise(r => { started = r }), gate = new Promise(r => { release = r })
  try {
    s.lesson(1)
    s.env.AI.run = async () => { started(); await gate; return { response: JSON.stringify(full) } }
    const work = generateQuestBank(s.env, 'alice', false, 1, 'starter')
    await began
    s.sqlite.exec('DELETE FROM lessons WHERE id=1')
    release()
    await assert.rejects(work, /找不到/)
    assert.equal(s.sqlite.prepare('SELECT COUNT(*) n FROM quests').get().n, 0)
    assert.equal(s.sqlite.prepare('SELECT COUNT(*) n FROM quest_generation_locks').get().n, 0)
  } finally { release(); s.sqlite.close() }
})

test('failed tail leaves starter usable; retry count is bounded in D1, not just message metadata', async () => {
  const s = setup()
  try {
    s.lesson(1)
    await generateQuestBank(s.env, 'alice', false, 1, 'starter')
    const original = s.sqlite.prepare('SELECT content FROM quests').get().content
    const job = await prepareQuest(s.env, 'alice', 1, true)
    let failedCalls = 0
    s.env.AI.run = async () => { failedCalls++; throw new Error('3040 temporary capacity') }
    for (let i = 0; i < 5; i++) await s.deliver(job.jobId)
    assert.equal(failedCalls, 3)
    assert.equal(s.sqlite.prepare('SELECT content FROM quests').get().content, original)
    assert.equal(s.sqlite.prepare('SELECT status FROM generation_jobs WHERE id=?').get(job.jobId).status, 'failed')
  } finally { s.sqlite.close() }
})

test('migration preserves old queue ids, completed content and progress', () => {
  const db = new DatabaseSync(':memory:')
  try {
    for (const f of readdirSync('migrations').filter(f => f.endsWith('.sql') && f < '0020').sort()) db.exec(readFileSync('migrations/'+f,'utf8'))
    db.prepare('INSERT INTO quests (lesson_id,user_id,content,progress,created_at,updated_at) VALUES (1,?,?,?,?,?)')
      .run('alice', JSON.stringify(full), '{"stages":{},"xp":42}', 1, 1)
    db.exec("INSERT INTO generation_jobs (id,user_id,lesson_id,kind,status,created_at,updated_at) VALUES (42,'alice',1,'quest','queued',1,1)")
    db.exec(readFileSync('migrations/0020_quest_ready_buffer.sql','utf8'))
    const q = db.prepare('SELECT * FROM quests').get()
    assert.equal(q.ready_phase, 'complete')
    assert.equal(q.progress, '{"stages":{},"xp":42}')
    assert.equal(q.content, JSON.stringify(full))
    assert.equal(db.prepare('SELECT id FROM generation_jobs').get().id, 42)
  } finally { db.close() }
})

test('ready inventory counts first attempts only and excludes completed stages', () => {
  const content = { ...full, cloze: [], reading: [], speaking: undefined }
  const q = { content, progress: { stages: {}, xp: 0 } }
  assert.equal(readyCount(content, 'starter'), 10)
  assert.equal(remainingReady(q, 'words', 4), 6)
  assert.equal(remainingReady(q, 'words', 5), 5)
  assert.equal(remainingReady(q, 'words', 100), 4)
  q.progress.stages.words = { accuracy: 1, at: 1 }
  assert.equal(remainingReady(q, 'listen', 1), 3)
})
