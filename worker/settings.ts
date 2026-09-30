import type { Env } from './env'
import { COACH_PROFILE_MAX, isSafeId, type Settings } from '../shared/settings'
import { DEFAULT_COACH_PROFILE, isLevel } from '../shared/practice'

/** 读取页面上保存的设置，覆盖 wrangler.jsonc 的默认值 */
export async function loadSettings(env: Env): Promise<Settings> {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>()
  const m = Object.fromEntries(results.map((r) => [r.key, r.value]))
  const level = Number(m.practiceLevel)
  return {
    textModel: isSafeId(m.textModel) ? m.textModel : env.GEMINI_TEXT_MODEL,
    ttsModel: isSafeId(m.ttsModel) ? m.ttsModel : env.GEMINI_TTS_MODEL,
    voice: isSafeId(m.voice) ? m.voice : env.GEMINI_VOICE,
    practiceLevel: isLevel(level) ? level : 1,
    coachProfile: typeof m.coachProfile === 'string' && m.coachProfile.trim() ? m.coachProfile : DEFAULT_COACH_PROFILE,
  }
}

export function defaultSettings(env: Env): Settings {
  return {
    textModel: env.GEMINI_TEXT_MODEL,
    ttsModel: env.GEMINI_TTS_MODEL,
    voice: env.GEMINI_VOICE,
    practiceLevel: 1,
    coachProfile: DEFAULT_COACH_PROFILE,
  }
}

/** 把页面上选的模型/音色套进 env，供 Gemini 调用使用 */
export async function aiEnv(env: Env): Promise<Env> {
  const s = await loadSettings(env)
  return { ...env, GEMINI_TEXT_MODEL: s.textModel, GEMINI_TTS_MODEL: s.ttsModel, GEMINI_VOICE: s.voice }
}

/** 校验并保存；null 或空字符串表示恢复默认。返回错误信息或 null */
export async function saveSettings(env: Env, body: Record<string, unknown>): Promise<string | null> {
  const stmts: D1PreparedStatement[] = []
  const upsert = (k: string, v: string) =>
    env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, v)
  const reset = (k: string) => env.DB.prepare('DELETE FROM settings WHERE key = ?').bind(k)

  for (const k of ['textModel', 'ttsModel', 'voice'] as const) {
    const v = body[k]
    if (v === undefined) continue
    if (v === null || v === '') stmts.push(reset(k))
    else if (isSafeId(v)) stmts.push(upsert(k, v))
    else return `${k} 格式不对：只能包含字母、数字、点、横线`
  }
  if (body.practiceLevel !== undefined) {
    const lv = Number(body.practiceLevel)
    if (!isLevel(lv)) return 'practiceLevel 只能是 1、2、3'
    stmts.push(upsert('practiceLevel', String(lv)))
  }
  if (body.coachProfile !== undefined) {
    const v = body.coachProfile
    if (v === null || (typeof v === 'string' && !v.trim())) stmts.push(reset('coachProfile'))
    else if (typeof v === 'string') stmts.push(upsert('coachProfile', v.trim().slice(0, COACH_PROFILE_MAX)))
    else return 'coachProfile 必须是文本'
  }
  if (stmts.length) await env.DB.batch(stmts)
  return null
}
