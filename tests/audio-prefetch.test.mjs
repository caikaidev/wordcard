import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const bundle = await build({ entryPoints: ['src/audio.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
let seq = 0
async function freshAudio() {
  // Each test gets independent ready/pending/queue state.
  return import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64') + '#prefetch-' + ++seq)
}

async function until(condition) {
  for (let i = 0; i < 100; i++) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail('timed out waiting for audio prefetch')
}

test('a pending cache-only miss is promoted to one full TTS generation', async () => {
  const originalFetch = globalThis.fetch
  const urls = []
  let resolveCache
  const cache = new Promise((resolve) => { resolveCache = resolve })
  try {
    globalThis.fetch = async (url) => {
      urls.push(url)
      if (url.includes('cached=1')) return cache
      return {
        ok: true, status: 200,
        headers: { get: () => 'audio/mpeg' },
        blob: async () => new Blob([Uint8Array.of(73, 68, 51)], { type: 'audio/mpeg' }),
      }
    }
    const audio = await freshAudio()
    audio.prefetchCached(['hello'])
    audio.prefetch(['hello'])
    audio.prefetch(['hello'])
    assert.equal(urls.length, 1, 'do not start a full generation before R2 probe completes')
    resolveCache({ status: 204, headers: { get: () => null } })
    await until(() => urls.length === 2)
    assert.match(urls[0], /cached=1/)
    assert.doesNotMatch(urls[1], /cached=1/)
    await until(() => audio.getSpeechStatus().text === null)
    audio.prefetch(['hello'])
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(urls.length, 2, 'a ready or in-flight clip is not generated twice')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('R2 cache hit satisfies a queued full prewarm without invoking AI', async () => {
  const originalFetch = globalThis.fetch
  const urls = []
  let resolveCache
  const cache = new Promise((resolve) => { resolveCache = resolve })
  try {
    globalThis.fetch = async (url) => {
      urls.push(url)
      if (!url.includes('cached=1')) throw Error('unexpected new synthesis on cache hit')
      return cache
    }
    const audio = await freshAudio()
    audio.prefetchCached(['already-cached'])
    audio.prefetch(['already-cached'])
    resolveCache({
      status: 200,
      headers: { get: () => 'audio/mpeg' },
      blob: async () => new Blob([Uint8Array.of(73, 68, 51)], { type: 'audio/mpeg' }),
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(urls.length, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('cache-only misses never spend inference quota without a prewarm request', async () => {
  const originalFetch = globalThis.fetch
  const urls = []
  try {
    globalThis.fetch = async (url) => {
      urls.push(url)
      return { status: 204, headers: { get: () => null } }
    }
    const audio = await freshAudio()
    audio.prefetchCached(['optional-example'])
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(urls.length, 1)
    assert.match(urls[0], /cached=1/)
  } finally {
    globalThis.fetch = originalFetch
  }
})
