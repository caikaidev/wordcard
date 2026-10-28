import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
const bundle = await build({ entryPoints: ['src/quest-buffer-session.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const { createQuestBufferSession } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'))

const q = {
  lessonId: 1, title: 'Test', writeDone: false, progress: { stages: {}, xp: 0 },
  content: {
    words: ['one','two','three','four','five'].map(en => ({ en, zh: en, distractors: ['a','b'] })),
    listening: [1,2,3,4].map(i => ({ en: `sentence ${i}`, zh: '中文', distractors: ['a','b'], extra: [] })),
    cloze: [], reading: [],
  },
  buffer: { phase: 'starter', ready: 10, target: 20, status: 'idle' },
}
const complete = { ...q, buffer: { phase: 'complete', ready: 20, target: 20, status: 'done' } }
const waiting = { ...q, buffer: { ...q.buffer, status: 'queued' } }
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { resolve, promise } }

function setup(overrides = {}) {
  const timers = new Map(), seen = [], errors = [], states = []
  const calls = { start: 0, read: 0, refill: 0, complete: 0 }
  let next = 1, visible = true
  const ports = {
    start: async () => { calls.start++; return q },
    read: async () => { calls.read++; return waiting },
    refill: async () => { calls.refill++; return { status: 'queued' } },
    complete: async () => { calls.complete++; return complete },
    onQuest: x => seen.push(x), onError: x => errors.push(x), onRefill: x => states.push(x),
    visible: () => visible,
    schedule(fn) { const id = next++; timers.set(id, fn); return id },
    cancel(id) { timers.delete(id) },
    ...overrides,
  }
  const session = createQuestBufferSession(ports)
  const tick = async () => { const entry = timers.entries().next().value; if (entry) { timers.delete(entry[0]); entry[1](); await flush() } }
  return { session, ports, calls, seen, states, timers, errors, tick, hide() { visible = false; session.visibilityChanged() }, show() { visible = true; session.visibilityChanged() } }
}

test('no refill before low water; exactly one request at five remaining; reads never generate', async () => {
  const s = setup()
  await s.session.load()
  s.session.consume(q, 'words', 4); await flush()
  assert.equal(s.calls.refill, 0)
  s.session.consume(q, 'words', 5); await flush()
  assert.equal(s.calls.refill, 1)
  assert.equal(s.calls.read, 1)
  s.session.consume(q, 'words', 6); s.session.consume(q, 'words', 9); await flush()
  assert.equal(s.calls.refill, 1)
  s.ports.read = async () => { s.calls.read++; return complete }
  await s.tick()
  assert.equal(s.seen.at(-1).buffer.phase, 'complete')
  assert.equal(s.calls.start, 1)
  assert.equal(s.calls.complete, 0)
  assert.equal(s.timers.size, 0)
  s.session.close()
})

test('late initial reply after unmount cannot restart polling or publish another lesson', async () => {
  const d = deferred(), s = setup({ start: () => d.promise })
  const loading = s.session.load()
  s.session.close()
  d.resolve({ pending: true, status: 'running' }); await loading
  assert.equal(s.timers.size, 0)
  assert.equal(s.seen.length, 0)
  s.session.consume(q, 'listen', 4); await flush()
  assert.equal(s.calls.refill, 0)
})

test('late refill reply and late GET reply are ignored after exit', async () => {
  const d = deferred(), s = setup({ refill: () => d.promise })
  await s.session.load()
  s.session.consume(q, 'words', 5); await flush()
  s.session.close(); d.resolve({ status: 'queued' }); await flush()
  assert.equal(s.calls.read, 0)
  assert.equal(s.timers.size, 0)

  const read = deferred(), t = setup({ read: () => read.promise })
  await t.session.load(); t.session.consume(q, 'words', 5); await flush()
  t.session.close(); read.resolve(complete); await flush()
  assert.equal(t.seen.length, 1)
  assert.equal(t.timers.size, 0)
})

test('hidden tabs pause polling and generation admission; foreground resumes one chain', async () => {
  const s = setup()
  await s.session.load(); s.hide()
  s.session.consume(q, 'words', 5); await flush()
  assert.equal(s.calls.refill, 0)
  s.show(); await flush()
  assert.equal(s.calls.refill, 1)
  assert.equal(s.timers.size, 1)
  s.hide(); assert.equal(s.timers.size, 0)
  s.show(); s.show(); assert.equal(s.timers.size, 1)
  s.session.close()
})

test('budget refusal keeps ready items and never falls back to automatic interactive inference', async () => {
  const s = setup({ refill: async () => ({ status: 'budget' }) })
  await s.session.load(); s.session.consume(q, 'words', 5); await flush()
  assert.equal(s.seen.at(-1).buffer.ready, 10)
  assert.equal(s.calls.start, 1)
  assert.equal(s.calls.complete, 0)
  assert.equal(s.calls.read, 0)
  assert.match(s.states.at(-1).message, /交互额度/)
  assert.equal(s.states.at(-1).busy, false)
  assert.equal(s.timers.size, 0)
  await s.session.complete()
  assert.equal(s.calls.complete, 1, 'only an explicit action calls the completion endpoint')
  assert.equal(s.seen.at(-1).buffer.phase, 'complete')
  s.session.close()
})

test('polling uses GET only and has a finite deadline even when task stays running', async () => {
  let starts = 0
  const s = setup({ start: async () => { starts++; return { pending: true, status: 'running' } }, read: async () => ({ pending: true, status: 'running' }) })
  await s.session.load()
  for (let i = 0; i < 90; i++) await s.tick()
  assert.equal(starts, 1)
  assert.equal(s.timers.size, 0)
  assert.match(s.errors.at(-1), /停止自动检查/)
  s.session.close()
})

test('outdated GET cannot overwrite explicit successful completion', async () => {
  const d = deferred(), s = setup({ read: () => d.promise })
  await s.session.load(); s.session.consume(q, 'words', 5); await flush()
  await s.session.complete()
  d.resolve(waiting); await flush()
  assert.equal(s.seen.at(-1).buffer.phase, 'complete')
  assert.equal(s.timers.size, 0)
  s.session.close()
})
