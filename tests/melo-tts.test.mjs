import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

// Bundle the actual Worker logic; no Cloudflare or Gemini credentials needed.
const bundle = await build({ entryPoints: ['worker/melo.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const melo = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'))
const { MELO_MODEL, decodeMeloResult, meloTtsKey, generateMeloTts, warmMeloTts, getOrGenerateMeloTts, classifyMeloError } = melo
const mp3 = Uint8Array.from([73, 68, 51, ...Array(48).fill(0)])
const audio = btoa(String.fromCharCode(...mp3))

function setup(overrides = {}) {
  const state = { calls: [], recorded: [], cached: new Map(), locks: new Map(), counts: { text: 0, tts: 0, minute: 0, minuteTts: 0, userText: 0, userTts: 0 } }
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
            if (sql.startsWith('INSERT INTO tts_generation_locks')) {
              const [key, owner, expiresAt, now] = params
              const existing = state.locks.get(key)
              if (existing && existing.expiresAt > now) return null
              state.locks.set(key, { owner, expiresAt })
              return { owner }
            }
            assert.match(sql, /FROM usage/)
            return state.counts
          },
          async run() {
            if (sql.startsWith('DELETE FROM tts_generation_locks')) {
              const [key, owner] = params
              if (state.locks.get(key)?.owner === owner) state.locks.delete(key)
            } else {
              state.recorded.push({ sql, params })
            }
            return { meta: { changes: 1 } }
          },
        }
      },
    },
    AUDIO: {
      async get(key) {
        const content = state.cached.get(key)
        return content ? { body: content, httpMetadata: { contentType: 'audio/mpeg' } } : null
      },
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
  assert.deepEqual(decodeMeloResult({ audio }), { bytes: mp3, mimeType: 'audio/mpeg' })
  assert.throws(() => decodeMeloResult({ audio: btoa('not mp3') }), /音频/)
  assert.throws(() => decodeMeloResult({ message: 'no audio' }), /没有返回音频/)
})

test('cache key is deterministic and distinct from historical Gemini WAV', async () => {
  const a = await meloTtsKey('I need more practice.')
  assert.equal(a, await meloTtsKey('I need more practice.'))
  assert.notEqual(a, await meloTtsKey('I need less practice.'))
  assert.match(a, /^tts\/melo-v2\/[a-f0-9]{64}\.audio$/)
})

test('MeloTTS is the only invoked provider, in English, and logs a new synthesis', async () => {
  const { env, state } = setup()
  const result = await generateMeloTts(env, 'hello')
  assert.deepEqual(result, { bytes: mp3, mimeType: 'audio/mpeg' })
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

test('Cloudflare quota and capacity errors are distinguished', () => {
  assert.match(classifyMeloError(new Error('3036: free allocation exceeded')).message, /免费 Neurons 已耗尽/)
  assert.match(classifyMeloError(new Error('3040 Out of Capacity')).message, /不是免费额度用完/)
  assert.equal(classifyMeloError(new Error('3040 Out of Capacity')).status, 503)
  assert.match(classifyMeloError(new Error('429 too many requests')).message, /不能据此认定/)
  assert.match(classifyMeloError({ code: 5035 }).message, /Workers Paid/)
  assert.match(classifyMeloError(new Error('some internal exception')).message, /不是已确认的额度不足/)
})

const wav = Uint8Array.from([
  82,73,70,70, 40,0,0,0, 87,65,86,69, 102,109,116,32,
  16,0,0,0,1,0,1,0,128,187,0,0,0,119,1,0,
  2,0,16,0,100,97,116,97,4,0,0,0,0,0,0,0,
])
test('MeloTTS WAV base64 is returned as actual WAV instead of rejected as non-MP3', () => {
  assert.deepEqual(decodeMeloResult({ audio: btoa(String.fromCharCode(...wav)) }), { bytes: wav, mimeType: 'audio/wav' })
  assert.deepEqual(decodeMeloResult(wav), { bytes: wav, mimeType: 'audio/wav' })
})
test('invalid unknown audio includes diagnostic header only', () => {
  assert.throws(() => decodeMeloResult({audio: btoa('NOT_AUDIO_CONTENT_1000')}), /文件头/)
})

test('single-flight: two concurrent requests synthesize once and share R2 result', async () => {
  const { env, state } = setup()
  let signalStarted, release
  const started = new Promise((resolve) => { signalStarted = resolve })
  const gate = new Promise((resolve) => { release = resolve })
  env.AI.run = async (model, input) => {
    state.calls.push({ model, input })
    signalStarted()
    await gate
    return { audio }
  }
  const first = getOrGenerateMeloTts(env, 'concurrent word')
  await started
  const second = getOrGenerateMeloTts(env, 'concurrent word')
  await new Promise((resolve) => setTimeout(resolve, 30))
  release()
  const [generated, reused] = await Promise.all([first, second])
  assert.equal(state.calls.length, 1)
  assert.equal(state.recorded.length, 1)
  assert.equal(generated.mimeType, 'audio/mpeg')
  assert.equal(reused.mimeType, 'audio/mpeg')
  assert.equal(reused.cacheHit, true)
  assert.equal(state.locks.size, 0)
})

test('failed synthesis releases the lease and allows retry', async () => {
  const { env, state } = setup()
  env.AI.run = async () => { throw new Error('3040 Out of Capacity') }
  await assert.rejects(getOrGenerateMeloTts(env, 'retry word'), /容量不足/)
  assert.equal(state.locks.size, 0)
  env.AI.run = async () => ({ audio })
  const result = await getOrGenerateMeloTts(env, 'retry word')
  assert.equal(result.cacheHit, false)
  assert.equal(state.cached.size, 1)
})
