import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'
import {
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_OPENAI_MODEL,
  cleanOpenAiApiKey,
  isOpenAiApiKey,
  isOpenAiBaseUrl,
  normalizeOpenAiBaseUrl,
} from '../shared/settings.ts'
import {
  armOpenAiResume,
  chooseAiFailureAction,
  finishOpenAiResume,
  openAiResumePath,
  shouldSendOpenAiOverride,
} from '../shared/ai-failure.ts'

const bundle = await build({
  entryPoints: ['worker/settings.ts'],
  platform: 'node',
  format: 'esm',
  bundle: true,
  write: false,
})
const settings = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'))

function memory() {
  const map = new Map()
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  }
}

function createDb() {
  const globalRows = new Map()
  const userRows = new Map()
  const select = (sql, args) => {
    if (sql.startsWith('SELECT value FROM user_settings')) {
      const value = userRows.get(`${args[0]}\0${args[1]}`)
      return value === undefined ? null : { value }
    }
    if (sql.startsWith('SELECT key, value FROM settings')) {
      return [...globalRows].map(([key, value]) => ({ key, value }))
    }
    if (sql.startsWith('SELECT key, value FROM user_settings')) {
      const rows = []
      for (const [id, value] of userRows) {
        const split = id.indexOf('\0')
        const userId = id.slice(0, split)
        const key = id.slice(split + 1)
        if (userId === args[0]) rows.push({ key, value })
      }
      return rows
    }
    throw new Error('unexpected read ' + sql)
  }
  const apply = (sql, args) => {
    if (sql.startsWith('INSERT INTO user_settings')) {
      userRows.set(`${args[0]}\0${args[1]}`, args[2])
      return
    }
    if (sql.startsWith('DELETE FROM user_settings')) {
      userRows.delete(`${args[0]}\0${args[1]}`)
      return
    }
    if (sql.startsWith('INSERT INTO settings')) {
      globalRows.set(args[0], args[1])
      return
    }
    if (sql.startsWith('DELETE FROM settings')) {
      globalRows.delete(args[0])
      return
    }
    throw new Error('unexpected write ' + sql)
  }
  function prepare(sql) {
    return {
      sql,
      args: [],
      bind(...params) {
        const next = prepare(sql)
        next.args = params
        return next
      },
      async first() {
        const rows = select(sql, this.args)
        return Array.isArray(rows) ? rows[0] ?? null : rows
      },
      async run() {
        apply(sql, this.args)
        return {}
      },
    }
  }
  return {
    prepare,
    async batch(stmts) {
      const out = []
      for (const stmt of stmts) {
        if (stmt.sql.startsWith('SELECT')) out.push({ results: select(stmt.sql, stmt.args) })
        else {
          apply(stmt.sql, stmt.args)
          out.push({ results: [] })
        }
      }
      return out
    },
  }
}

function baseEnv(extra = {}) {
  return {
    GEMINI_TEXT_MODEL: 'gemini-test',
    GEMINI_TTS_MODEL: 'gemini-tts',
    GEMINI_VOICE: 'Kore',
    OPENAI_API_KEY: '',
    OPENAI_TEXT_MODEL: '',
    OPENAI_BASE_URL: '',
    DB: createDb(),
    ...extra,
  }
}

test('OpenAI key and base URL validators', () => {
  assert.equal(DEFAULT_OPENAI_MODEL, 'gpt-6-astra')
  assert.equal(DEFAULT_OPENAI_BASE_URL, 'https://api.openai.com/v1')
  assert.equal(isOpenAiApiKey('  Bearer sk-test-key  '), true)
  assert.equal(cleanOpenAiApiKey('  Bearer sk-test-key  '), 'sk-test-key')
  assert.equal(isOpenAiApiKey('short'), false)
  assert.equal(isOpenAiApiKey('bad key'), false)
  assert.equal(isOpenAiBaseUrl('https://api.openai.com/v1/'), true)
  assert.equal(normalizeOpenAiBaseUrl('https://api.openai.com/v1/'), 'https://api.openai.com/v1')
  assert.equal(isOpenAiBaseUrl('http://localhost:8787/v1'), true)
  assert.equal(isOpenAiBaseUrl('http://evil.com/v1'), false)
  assert.equal(isOpenAiBaseUrl('https://user:pass@example.com/v1'), false)
  assert.equal(isOpenAiBaseUrl('https://example.com/v1?token=1'), false)
})

test('failure actions keep retry, one-shot OpenAI, and a real Gemini switch apart', () => {
  assert.equal(chooseAiFailureAction('retry', false), 'retry')
  assert.equal(chooseAiFailureAction('openai', true), 'openai')
  assert.equal(chooseAiFailureAction('openai', false), 'settings')
  assert.equal(chooseAiFailureAction('gemini', false), 'gemini')
  const store = memory()
  assert.equal(shouldSendOpenAiOverride(store, '/settings', false), false)
  armOpenAiResume(store, '/practice/3/path')
  assert.equal(openAiResumePath(store), '/practice/3/path')
  assert.equal(shouldSendOpenAiOverride(store, '/practice/3/path', false), true)
  assert.equal(shouldSendOpenAiOverride(store, '/settings', false), false)
  assert.equal(shouldSendOpenAiOverride(store, '/settings', true), true)
  finishOpenAiResume(store, '/practice/3/path')
  assert.equal(openAiResumePath(store), null)
})

test('settings store a personal OpenAI key without echoing it', async () => {
  const env = baseEnv()
  assert.match(await settings.saveSettings(env, 'alice', false, { textProvider: 'claude' }), /textProvider/)
  assert.match(await settings.saveSettings(env, 'alice', false, { openaiBaseUrl: 'http://evil.com/v1' }), /Base URL/)
  assert.match(await settings.saveSettings(env, 'alice', false, { openaiApiKey: 'bad key' }), /API key/)
  assert.match(await settings.saveSettings(env, 'alice', false, { textModel: 'gemini-x' }), /管理员/)
  assert.equal(await settings.saveSettings(env, 'alice', false, { openaiModel: 'gpt-4o-mini' }), null)
  assert.equal(await settings.saveSettings(env, 'alice', false, {
    textProvider: 'openai',
    openaiApiKey: '  Bearer sk-user-key  ',
    openaiBaseUrl: 'https://example.com/v1/',
  }), null)
  const loaded = await settings.loadSettings(env, 'alice')
  assert.equal(loaded.textProvider, 'openai')
  assert.equal(loaded.openaiModel, 'gpt-4o-mini')
  assert.equal(loaded.openaiBaseUrl, 'https://example.com/v1')
  assert.equal(loaded.openaiKeySet, true)
  assert.equal(loaded.openaiKeySource, 'user')
  assert.equal('openaiApiKey' in loaded, false)
  const ai = await settings.aiEnv(env, 'alice', false)
  assert.equal(ai.TEXT_PROVIDER, 'openai')
  assert.equal(ai.OPENAI_API_KEY, 'sk-user-key')
  assert.equal(ai.OPENAI_BASE_URL, 'https://example.com/v1')
  await settings.saveSettings(env, 'alice', false, { textProvider: 'cloudflare' })
  const forced = await settings.aiEnv(env, 'alice', false, 'openai')
  assert.equal(forced.TEXT_PROVIDER, 'openai')
  assert.equal(forced.OPENAI_API_KEY, 'sk-user-key')
  assert.equal(settings.openAiRequestOverride('openai'), 'openai')
  assert.equal(settings.openAiRequestOverride('gemini'), undefined)
})

test('a server OpenAI key is used when the user has not saved one', async () => {
  const env = baseEnv({ OPENAI_API_KEY: 'sk-server-key', OPENAI_TEXT_MODEL: 'gpt-6-luna' })
  const loaded = await settings.loadSettings(env, 'bob')
  assert.equal(loaded.openaiKeySet, true)
  assert.equal(loaded.openaiKeySource, 'server')
  assert.equal(loaded.openaiModel, 'gpt-6-luna')
  assert.equal(loaded.textProvider, 'cloudflare')
  assert.equal('openaiApiKey' in loaded, false)
  const ai = await settings.aiEnv(env, 'bob', false)
  assert.equal(ai.OPENAI_API_KEY, 'sk-server-key')
  assert.equal(ai.TEXT_PROVIDER, 'cloudflare')
})

test('the settings page and failure dialog expose the OpenAI controls', () => {
  const dialog = readFileSync('src/components/AiFailureDialog.tsx', 'utf8')
  assert.match(dialog, /用 OpenAI 重试/)
  assert.match(dialog, /切换 Gemini/)
  assert.match(dialog, />\s*重试\s*</)
  const page = readFileSync('src/pages/Settings.tsx', 'utf8')
  const shared = readFileSync('shared/settings.ts', 'utf8')
  assert.match(page, /DEFAULT_OPENAI_MODEL/)
  assert.match(page, /DEFAULT_OPENAI_BASE_URL/)
  assert.match(page, /openai-api-key/)
  assert.match(shared, /gpt-6-astra/)
  assert.match(shared, /https:\/\/api\.openai\.com\/v1/)
})
