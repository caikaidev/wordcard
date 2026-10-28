import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const bundle = await build({ entryPoints: ['worker/gemini.ts'], platform: 'node', format: 'esm', bundle: true, write: false })
const ai = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'))
const schema = {
  type: 'OBJECT',
  properties: { meaning: { type: 'STRING' }, examples: { type: 'ARRAY', items: { type: 'STRING' } } },
  required: ['meaning', 'examples'],
}

function env(provider = 'cloudflare') {
  const calls = []
  const logs = []
  const settings = {
    TEXT_PROVIDER: provider,
    GEMINI_TEXT_MODEL: 'gemini-test',
    GEMINI_API_KEY: 'test-key',
    USER_ID: 'alice',
    IS_ADMIN: false,
    AI: { async run(model, request) {
      calls.push({ model, request })
      return { response: JSON.stringify({ meaning: '承诺', examples: ['A commitment matters.'] }), usage: { prompt_tokens: 10, completion_tokens: 20 } }
    } },
    DB: { prepare(sql) {
      let args = []
      return {
        bind(...params) { args = params; return this },
        async first() { return { text: 0, tts: 0, minute: 0, minuteTts: 0, userText: 0, userTts: 0 } },
        async run() { logs.push({ sql, args }); return {} },
      }
    } },
  }
  return { settings, calls, logs }
}

test('default Cloudflare routes to Qwen and never hits Gemini', async () => {
  const { settings, calls, logs } = env()
  const old = globalThis.fetch
  globalThis.fetch = () => { throw new Error('Gemini must not be called') }
  try {
    const result = await ai.generateJson(settings, 'Explain commitment', schema, 'enrich')
    assert.deepEqual(result, { meaning: '承诺', examples: ['A commitment matters.'] })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].model, '@cf/qwen/qwen3-30b-a3b-fp8')
    assert.match(calls[0].request.messages[0].content, /"type":"object"/)
    assert.equal(logs[0].args[2], '@cf/qwen/qwen3-30b-a3b-fp8')
  } finally { globalThis.fetch = old }
})

test('Qwen rejects incomplete JSON without silent Gemini fallback', async () => {
  const { settings, calls } = env()
  settings.AI.run = async (model, request) => { calls.push({ model, request }); return { response: '{"meaning":"承诺"}' } }
  await assert.rejects(ai.generateJson(settings, 'x', schema, 'enrich'), /字段不完整/)
  assert.equal(calls.length, 1)
})

test('Qwen rejects screenshots with actionable switch instructions', async () => {
  const { settings, calls } = env()
  await assert.rejects(ai.generateJson(settings, [{ text: 'Read screenshot' }, { inlineData: { mimeType: 'image/png', data: 'fake' } }], schema, 'lesson'), /切换 Gemini/)
  assert.equal(calls.length, 0)
})

test('Qwen can return an array root, with fenced JSON', async () => {
  const { settings } = env()
  const fence = String.fromCharCode(96).repeat(3)
  settings.AI.run = async () => ({ response: fence + 'json\n["hello", "world"]\n' + fence })
  const result = await ai.generateJson(settings, 'words', { type: 'ARRAY', items: { type: 'STRING' } }, 'remix')
  assert.deepEqual(result, ['hello', 'world'])
})

test('explicit Gemini selection continues using Gemini generateContent endpoint', async () => {
  const { settings, calls } = env('gemini')
  const old = globalThis.fetch
  let requests = 0
  globalThis.fetch = async (url, opts) => {
    requests++
    assert.match(String(url), /gemini-test:generateContent/)
    assert.deepEqual(JSON.parse(opts.body).generationConfig.responseSchema, schema)
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ meaning: '承诺', examples: [] }) }] } }] })
  }
  try {
    const result = await ai.generateJson(settings, 'word', schema, 'enrich')
    assert.equal(result.meaning, '承诺')
    assert.equal(requests, 1)
    assert.equal(calls.length, 0)
  } finally { globalThis.fetch = old }
})
