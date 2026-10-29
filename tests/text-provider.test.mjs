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
    const prompt = calls[0].request.messages[0].content
    assert.ok(prompt.indexOf('Explain commitment') < prompt.indexOf('输出要求'))
    assert.match(prompt, /字符串数组必须写成 JSON 数组/)
    assert.match(prompt, /最后一个必须是 \} 或 \]。$/)
    assert.equal(logs[0].args[2], '@cf/qwen/qwen3-30b-a3b-fp8')
  } finally { globalThis.fetch = old }
})

test('Qwen retries a shape mismatch once and still does not call Gemini', async () => {
  const { settings, calls } = env()
  const old = globalThis.fetch
  globalThis.fetch = () => { throw new Error('Gemini must not be called') }
  settings.AI.run = async (model, request) => { calls.push({ model, request }); return { response: '{"meaning":"承诺"}' } }
  try {
    await assert.rejects(
      ai.generateJson(settings, 'x', schema, 'enrich'),
      (error) => error instanceof Error && error.message === 'Qwen 返回的 JSON 字段不完整或类型不符。请重试或切换 Gemini',
    )
    assert.equal(calls.length, 2)
    assert.match(calls[1].request.messages[0].content, /对不上 schema/)
  } finally { globalThis.fetch = old }
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

const fence = String.fromCharCode(96).repeat(3)
const questSchema = {
  type: 'OBJECT',
  properties: {
    words: { type: 'ARRAY', items: { type: 'OBJECT', properties: { en: { type: 'STRING' }, zh: { type: 'STRING' } }, required: ['en', 'zh'] } },
    listening: { type: 'ARRAY', items: { type: 'OBJECT', properties: { en: { type: 'STRING' } }, required: ['en'] } },
  },
  required: ['words', 'listening'],
}
const questJson = {
  words: [{ en: 'habit', zh: '习惯' }, { en: 'routine', zh: '惯例' }],
  listening: [{ en: 'I read every day.' }, { en: 'We learn every day.' }],
}

test('Qwen quest JSON survives preamble, think tags, and a markdown fence', async () => {
  const { settings, calls } = env()
  settings.AI.run = async (model, request) => {
    calls.push({ model, request })
    return {
      response: [
        '自查通过。英文能单独听懂，中文也通顺。',
        '<think>干扰项再看一眼</think>',
        fence + 'json',
        JSON.stringify(questJson),
        fence,
        '以上就是这批题。',
      ].join('\n'),
    }
  }
  const result = await ai.generateJson(settings, '请出：words 和 listening', questSchema, 'quest', 0.5)
  assert.deepEqual(result, questJson)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].request.max_tokens, 6500)
})

test('Qwen drops an unfinished tail and keeps the complete quest items', async () => {
  const { settings, calls } = env()
  const raw = JSON.stringify(questJson)
  settings.AI.run = async () => {
    calls.push({})
    return { response: '先给题目：\n' + raw.slice(0, raw.lastIndexOf('We learn')) + 'We learn every' }
  }
  const result = await ai.generateJson(settings, '出题', questSchema, 'quest')
  assert.deepEqual(result.words, questJson.words)
  assert.deepEqual(result.listening, [{ en: 'I read every day.' }])
  assert.equal(calls.length, 1)
})

test('Qwen accepts trailing commas and an already-parsed object response', async () => {
  const { settings } = env()
  settings.AI.run = async () => ({ response: '{"meaning":"承诺","examples":["A",]}' })
  assert.deepEqual(await ai.generateJson(settings, 'x', schema, 'enrich'), { meaning: '承诺', examples: ['A'] })
  settings.AI.run = async () => ({ response: { meaning: '承诺', examples: ['ok'] } })
  assert.deepEqual(await ai.generateJson(settings, 'x', schema, 'enrich'), { meaning: '承诺', examples: ['ok'] })
})

test('a fuller response payload wins over a shorter schema-valid content stub', async () => {
  const { settings } = env()
  settings.AI.run = async () => ({
    response: JSON.stringify(questJson),
    choices: [{ message: { content: { words: [{ en: 'a', zh: '甲' }], listening: [{ en: 'Hi.' }] } } }],
  })
  assert.deepEqual(await ai.generateJson(settings, '出题', questSchema, 'quest'), questJson)
})

test('final answer in message.content wins over a prose response field', async () => {
  const { settings, calls } = env()
  settings.AI.run = async () => {
    calls.push({})
    return {
      response: '我先用中文解释一下 commitment 的用法，这不是要返回的 JSON。',
      choices: [{ message: { content: [
        { type: 'thinking', text: JSON.stringify({ meaning: '错', examples: ['x'] }) },
        { type: 'text', text: JSON.stringify({ meaning: '承诺', examples: ['A commitment matters.'] }) },
      ] } }],
    }
  }
  const result = await ai.generateJson(settings, 'Explain commitment', schema, 'enrich')
  assert.deepEqual(result, { meaning: '承诺', examples: ['A commitment matters.'] })
  assert.equal(calls.length, 1)
})

test('closed think draft is ignored; unclosed think is retried without calling Gemini', async () => {
  const { settings, calls } = env()
  const old = globalThis.fetch
  globalThis.fetch = () => { throw new Error('Gemini must not be called') }
  settings.AI.run = async () => ({
    response: `<think>${JSON.stringify({ meaning: '错', examples: ['x'] })}</think>\n${JSON.stringify({ meaning: '承诺', examples: ['A'] })}`,
  })
  try {
    assert.deepEqual(await ai.generateJson(settings, 'x', schema, 'enrich'), { meaning: '承诺', examples: ['A'] })
    let n = 0
    settings.AI.run = async (model, request) => {
      calls.push({ model, request })
      n++
      if (n === 1) return { response: '<think>{"meaning":"错","examples":["x"]} 还在想' }
      return { response: JSON.stringify({ meaning: '承诺', examples: ['B'] }) }
    }
    assert.deepEqual(await ai.generateJson(settings, 'x', schema, 'enrich'), { meaning: '承诺', examples: ['B'] })
    assert.equal(calls.length, 2)
    assert.match(calls[1].request.messages[0].content, /上一次没有返回合法 JSON/)
  } finally { globalThis.fetch = old }
})

test('prose message parts are not mistaken for a JSON object', async () => {
  const { settings, calls } = env()
  settings.AI.run = async () => {
    calls.push({})
    return { choices: [{ message: { content: [{ type: 'text', text: '抱歉，这次写不出来。' }] } }] }
  }
  await assert.rejects(
    ai.generateJson(settings, 'x', schema, 'enrich'),
    (error) => error instanceof Error && error.message === 'Qwen 返回的不是合法 JSON。请重试或切换 Gemini',
  )
  assert.equal(calls.length, 2)
})

test('unparseable Qwen output is retried once, then keeps the original error', async () => {
  const { settings, calls } = env()
  const old = globalThis.fetch
  globalThis.fetch = () => { throw new Error('Gemini must not be called') }
  settings.AI.run = async (model, request) => {
    calls.push({ model, request })
    return { response: '抱歉，这次写不出来。' }
  }
  try {
    await assert.rejects(
      ai.generateJson(settings, 'x', schema, 'enrich'),
      (error) => error instanceof Error && error.message === 'Qwen 返回的不是合法 JSON。请重试或切换 Gemini',
    )
    assert.equal(calls.length, 2)
  } finally { globalThis.fetch = old }
})

test('a cut-off first reply retries; a later capacity error is not hidden', async () => {
  const { settings, calls } = env()
  let n = 0
  settings.AI.run = async () => {
    n++
    calls.push({})
    if (n === 1) return { response: '{"meaning":"承' }
    return { response: JSON.stringify({ meaning: '承诺', examples: ['A'] }) }
  }
  assert.deepEqual(await ai.generateJson(settings, 'x', schema, 'enrich'), { meaning: '承诺', examples: ['A'] })
  assert.equal(calls.length, 2)
  n = 0
  calls.length = 0
  settings.AI.run = async () => {
    n++
    calls.push({})
    if (n === 1) return { response: 'not json' }
    throw new Error('3040 out of capacity')
  }
  await assert.rejects(ai.generateJson(settings, 'x', schema, 'enrich'), /容量不足/)
  assert.equal(calls.length, 2)
})

test('complete JSON that misses fields retries once, even with a trailing note', async () => {
  const { settings, calls } = env()
  settings.AI.run = async () => {
    calls.push({})
    return { response: '{"meaning":"承诺"}\n自查完成。' }
  }
  await assert.rejects(ai.generateJson(settings, 'x', schema, 'enrich'), /字段不完整/)
  assert.equal(calls.length, 2)
})

test('quest JSON keeps good items when one field is missing or a list is a string', async () => {
  const { settings, calls } = env()
  const tolerant = {
    type: 'OBJECT',
    properties: {
      words: {
        type: 'ARRAY',
        items: { type: 'OBJECT', properties: { en: { type: 'STRING' }, zh: { type: 'STRING' }, distractors: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['en', 'zh', 'distractors'] },
      },
      listening: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: { en: { type: 'STRING' }, zh: { type: 'STRING' }, distractors: { type: 'ARRAY', items: { type: 'STRING' } }, extra: { type: 'ARRAY', items: { type: 'STRING' } } },
          required: ['en', 'zh', 'distractors', 'extra'],
        },
      },
    },
    required: ['words', 'listening'],
  }
  settings.AI.run = async () => {
    calls.push({})
    return { response: JSON.stringify({
      words: [{ en: 'habit', zh: '习惯', distractors: '甲，乙，丙' }, { en: 'routine' }],
      listening: { en: 'I read every day.', zh: '我每天阅读。', distractors: ['甲', '乙'] },
    }) }
  }
  const result = await ai.generateJson(settings, '出题', tolerant, 'quest')
  assert.deepEqual(result, {
    words: [{ en: 'habit', zh: '习惯', distractors: ['甲', '乙', '丙'] }],
    listening: [{ en: 'I read every day.', zh: '我每天阅读。', distractors: ['甲', '乙'], extra: [] }],
  })
  assert.equal(calls.length, 1)
})

test('a missing root field retries; a later complete reply is used', async () => {
  const { settings, calls } = env()
  const old = globalThis.fetch
  globalThis.fetch = () => { throw new Error('Gemini must not be called') }
  let n = 0
  settings.AI.run = async () => {
    n++
    calls.push({})
    if (n === 1) return { response: JSON.stringify({ words: [{ en: 'habit', zh: '习惯', distractors: ['甲', '乙'] }] }) }
    return { response: JSON.stringify(questJson) }
  }
  try {
    assert.deepEqual(await ai.generateJson(settings, '出题', questSchema, 'quest'), questJson)
    assert.equal(calls.length, 2)
  } finally { globalThis.fetch = old }
})

test('dropping every array item does not pretend the payload is empty', async () => {
  const { settings, calls } = env()
  const strict = {
    type: 'OBJECT',
    properties: {
      words: { type: 'ARRAY', items: { type: 'OBJECT', properties: { en: { type: 'STRING' }, zh: { type: 'STRING' } }, required: ['en', 'zh'] } },
    },
    required: ['words'],
  }
  settings.AI.run = async () => {
    calls.push({})
    return { response: '{"words":[{"en":"habit"},{"en":"routine"}]}' }
  }
  await assert.rejects(ai.generateJson(settings, '出题', strict, 'quest'), /字段不完整/)
  assert.equal(calls.length, 2)
})

test('numeric strings coerce to integers; an inner fragment still gets one retry', async () => {
  const { settings, calls } = env()
  const indexSchema = { type: 'OBJECT', properties: { senseIndex: { type: 'INTEGER' } }, required: ['senseIndex'] }
  settings.AI.run = async () => ({ response: '{"senseIndex":"2"}' })
  assert.deepEqual(await ai.generateJson(settings, 'pick', indexSchema, 'enrich'), { senseIndex: 2 })
  let n = 0
  settings.AI.run = async () => {
    n++
    calls.push({})
    if (n === 1) return { response: '先看这句 [1, 2, 3]' }
    return { response: JSON.stringify({ meaning: '承诺', examples: ['A'] }) }
  }
  assert.deepEqual(await ai.generateJson(settings, 'x', schema, 'enrich'), { meaning: '承诺', examples: ['A'] })
  assert.equal(calls.length, 2)
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
