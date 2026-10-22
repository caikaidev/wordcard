import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { cachedRead, readCached, clearReadCache, beginWrite } from '../src/readCache.ts'

beforeEach(clearReadCache)

test('repeat tab visits share a read, with independent copies for consumers', async () => {
  let calls = 0
  const load = async () => { calls++; return { items: [1, 2] } }
  const [a, b] = await Promise.all([cachedRead('/review', load), cachedRead('/review', load)])
  a.items.pop()
  assert.deepEqual(b.items, [1, 2])
  assert.deepEqual(await cachedRead('/review', load), { items: [1, 2] })
  assert.equal(calls, 1)
})

test('expired entries are not shown or reused', async () => {
  const now = Date.now
  try {
    Date.now = () => 1000
    await cachedRead('/stats', async () => ({ due: 1 }))
    Date.now = () => 31_001
    assert.equal(readCached('/stats'), null)
    assert.deepEqual(await cachedRead('/stats', async () => ({ due: 2 })), { due: 2 })
  } finally { Date.now = now }
})

test('writes clear old values and prevent earlier reads from repopulating them', async () => {
  let resolveOld
  const old = cachedRead('/items', () => new Promise((r) => { resolveOld = r }))
  const finish = beginWrite()
  resolveOld({ items: ['deleted'] })
  await old
  assert.equal(readCached('/items'), null)
  await cachedRead('/items', async () => ({ items: ['during write'] }))
  assert.equal(readCached('/items'), null)
  finish()
  assert.deepEqual(await cachedRead('/items', async () => ({ items: [] })), { items: [] })
})

test('refresh detaches older in-flight reads without removing a newer request', async () => {
  let oldResolve, newResolve
  const old = cachedRead('/stats', () => new Promise((r) => { oldResolve = r }))
  clearReadCache()
  const fresh = cachedRead('/stats', () => new Promise((r) => { newResolve = r }))
  oldResolve({ due: 99 })
  await old
  let calls = 0
  const joined = cachedRead('/stats', async () => { calls++; return { due: 99 } })
  newResolve({ due: 1 })
  assert.deepEqual(await fresh, { due: 1 })
  assert.deepEqual(await joined, { due: 1 })
  assert.equal(calls, 0)
})

test('failed requests are retried; query variants are separate', async () => {
  await assert.rejects(cachedRead('/items?status=active', async () => { throw Error('offline') }))
  await cachedRead('/items?status=active', async () => ({ items: ['active'] }))
  await cachedRead('/items?status=done', async () => ({ items: ['done'] }))
  assert.deepEqual(readCached('/items?status=active'), { items: ['active'] })
  assert.deepEqual(readCached('/items?status=done'), { items: ['done'] })
})

test('cache size is bounded and manual refresh discards all values', async () => {
  for (let i = 0; i < 81; i++) await cachedRead(`/items?q=${i}`, async () => ({ i }))
  assert.equal(readCached('/items?q=0'), null)
  assert.deepEqual(readCached('/items?q=80'), { i: 80 })
  clearReadCache()
  assert.equal(readCached('/items?q=80'), null)
})
