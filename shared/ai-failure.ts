export const OPENAI_RESUME_PATH = 'shiju:openai-resume-path'
export const OPENAI_RESUME_ARMED = 'shiju:openai-resume-armed'
export const OPENAI_OVERRIDE_HEADER = 'x-shiju-text-provider'

export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type AiFailureChoice = 'retry' | 'openai' | 'settings' | 'gemini'

/**
 * 重试保持当前提供方。用 OpenAI 重试时，没有 key 就去设置；
 * 切换 Gemini 是单独的动作，会改保存的提供方。
 */
export function chooseAiFailureAction(action: 'retry' | 'openai' | 'gemini', openaiConfigured: boolean): AiFailureChoice {
  switch (action) {
    case 'retry':
      return 'retry'
    case 'gemini':
      return 'gemini'
    case 'openai':
      return openaiConfigured ? 'openai' : 'settings'
    default: {
      const never: never = action
      return never
    }
  }
}

export function armOpenAiResume(store: KeyValueStore, path: string) {
  store.setItem(OPENAI_RESUME_PATH, path)
  store.setItem(OPENAI_RESUME_ARMED, '1')
}

export function openAiResumePath(store: KeyValueStore): string | null {
  if (store.getItem(OPENAI_RESUME_ARMED) !== '1') return null
  const path = store.getItem(OPENAI_RESUME_PATH)
  return path || null
}

export function finishOpenAiResume(store: KeyValueStore, path: string) {
  if (store.getItem(OPENAI_RESUME_PATH) !== path) return
  store.removeItem(OPENAI_RESUME_ARMED)
  store.removeItem(OPENAI_RESUME_PATH)
}

export function clearOpenAiResume(store: KeyValueStore) {
  store.removeItem(OPENAI_RESUME_ARMED)
  store.removeItem(OPENAI_RESUME_PATH)
}

/** 回到失败页之后的请求带上 OpenAI；人还在设置页时不要给保存设置的请求打这个头。 */
export function shouldSendOpenAiOverride(store: KeyValueStore, pathname: string, once: boolean): boolean {
  if (once) return true
  return store.getItem(OPENAI_RESUME_ARMED) === '1' && store.getItem(OPENAI_RESUME_PATH) === pathname && pathname.length > 0
}
