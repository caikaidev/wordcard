import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

// Bundle the actual Worker logic; no Cloudflare or Gemini credentials needed.
const bundle = await build({ entryPoints: ['worker/melo.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const melo = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'))
const { MELO_MODEL, decodeMeloResult, meloTtsKey, generateMeloTts, warmMeloTts } = melo
const mp3 = Uint8Array.from([73, 68, 51, ...Array(48).fill(0)])
const audio = btoa(String.fromCharCode(...mp3))

function setup(overrides = {}) {
  const state = { calls: [], recorded: [], cached: new Map(), counts: { text: 0, tts: 0, minute: 0, minuteTts: 0, userText: 0, userTts: 0 } }
  const env = {
    USER_ID: 'alice',
    IS_ADMIN: false,
    DAILY_TTS_LIMIT: '120',
    USER_DAILY_TTS_LIMIT: '60',
    PER_MINUTE_LIMIT: '40',
    TTS_PER_MINUTE_LIMIT: '8',
    DB: {
      prepare(sql) {
        let params = []
        return {
          bind(...args) { params = args; return this },
          async first() {
            assert.match(sql, /FROM usage/)
            return state.counts
          },
          async run() {
            state.recorded.push({ sql, params })
            return { meta: { changes: 1 } }
          },
        }
      },
    },
    AUDIO: {
      async head(key) { return state.cached.has(key) ? { size: state.cached.get(key).length } : null },
      async put(key, content) { state.cached.set(key, content) },
    },
    AI: {
      async run(model, input) { state.calls.push({ model, input }); return { audio } },
    },
    ...overrides,
  }
  return { env, state }
}

test('decoder accepts MP3 bytes and rejects unexpected payload', () => {
  assert.deepEqual(decodeMeloResult({ audio }), mp3)
  assert.throws(() => decodeMeloResult({ audio: btoa('not mp3') }), /音频|MP3/)
  assert.throws(() => decodeMeloResult({ message: 'no audio' }), /没有返回音频/)
})

test('cache key is deterministic and distinct from historical Gemini WAV', async () => {
  const a = await meloTtsKey('I need more practice.')
  assert.equal(a, await meloTtsKey('I need more practice.'))
  assert.notEqual(a, await meloTtsKey('I need less practice.'))
  assert.match(a, /^tts\/melo-v1\/[a-f0-9]{64}\.mp3$/)
})

test('MeloTTS is the only invoked provider, in English, and logs a new synthesis', async () => {
  const { env, state } = setup()
  const result = await generateMeloTts(env, 'hello')
  assert.deepEqual(result, mp3)
  assert.deepEqual(state.calls, [{ model: MELO_MODEL, input: { prompt: 'hello', lang: 'en' } }])
  assert.equal(state.recorded.length, 1)
  assert.equal(state.recorded[0].params[1], 'tts')
  assert.equal(state.recorded[0].params[2], MELO_MODEL)
})

test('per-user and global application limits reject new synthesis', async () => {
  const { env, state } = setup()
  state.counts.userTts = 60
  await assert.rejects(generateMeloTts(env, 'hello'), /个人新语音/)
  state.counts.userTts = 0
  state.counts.tts = 120
  await assert.rejects(generateMeloTts(env, 'hello'), /应用上限/)
  assert.equal(state.calls.length, 0)
})

test('Cloudflare free allocation failure does not fall back to Gemini', async () => {
  const { env, state } = setup({ AI: { async run() { throw new Error('429 daily free allocation of neurons exceeded') } } })
  await assert.rejects(generateMeloTts(env, 'hello'), (e) => e.status === 429)
  assert.equal(state.recorded.length, 0)
})

test('prewarming only generates once for repeated or cached text', async () => {
  const { env, state } = setup()
  await warmMeloTts(env, ['hello', 'hello'])
  await warmMeloTts(env, ['hello'])
  assert.equal(state.calls.length, 1)
  assert.equal(state.recorded.length, 1)
  assert.equal(state.cached.size, 1)
})
