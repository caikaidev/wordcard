import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8')
function worker(fetch, cached, timeout = setTimeout) {
  const handlers = new Map(), stored = new Map()
  const cache = { match: async () => cached, put: async (key, res) => stored.set(key, await res.text()) }
  const context = vm.createContext({
    self: { location: { origin: 'https://shiju.test' }, addEventListener: (type, fn) => handlers.set(type, fn) },
    caches: { open: async () => cache }, fetch, Response, URL, setTimeout: timeout, clearTimeout,
  })
  vm.runInContext(source, context)
  return {
    stored,
    navigate(preloadResponse = Promise.resolve(undefined)) {
      const background = []
      let response
      handlers.get('fetch')({
        request: { method: 'GET', mode: 'navigate', url: 'https://shiju.test/practice' },
        preloadResponse,
        waitUntil: (p) => background.push(p), respondWith: (p) => { response = p },
      })
      return { response, background }
    },
    handlers,
  }
}
function html(text) {
  const res = new Response(text, { headers: { 'content-type': 'text/html' } })
  Object.defineProperty(res, 'type', { value: 'basic' })
  return res
}

test('fast navigation uses network and updates the cached shell', async () => {
  const w = worker(async () => html('new'), html('old'))
  const n = w.navigate()
  assert.equal(await (await n.response).text(), 'new')
  await Promise.all(n.background)
  assert.equal(w.stored.get('/'), 'new')
})

test('slow navigation shows shell after bounded wait while network update finishes', async () => {
  let finish
  const w = worker(() => new Promise((r) => { finish = r }), html('cached'), (callback, ms) => {
    assert.equal(ms, 1500)
    queueMicrotask(callback)
    return 1
  })
  const n = w.navigate()
  assert.equal(await (await n.response).text(), 'cached')
  finish(html('updated'))
  await Promise.all(n.background)
  assert.equal(w.stored.get('/'), 'updated')
})

test('offline navigation uses cached shell and first visit waits for real HTML', async () => {
  const offline = worker(async () => { throw Error('offline') }, html('offline shell'))
  assert.equal(await (await offline.navigate().response).text(), 'offline shell')
  const first = worker(async () => html('first visit'), undefined)
  assert.equal(await (await first.navigate().response).text(), 'first visit')
})

test('navigation preload avoids a duplicate fetch', async () => {
  const w = worker(async () => { throw Error('duplicate fetch') }, html('old'))
  assert.equal(await (await w.navigate(Promise.resolve(html('preloaded'))).response).text(), 'preloaded')
})

test('API data is not intercepted by the service worker', () => {
  const w = worker(async () => { throw Error('unexpected fetch') })
  let intercepted = false
  w.handlers.get('fetch')({
    request: { method: 'GET', mode: 'cors', url: 'https://shiju.test/api/review' },
    respondWith: () => { intercepted = true },
  })
  assert.equal(intercepted, false)
})
