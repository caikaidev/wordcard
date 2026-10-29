import { finishOpenAiResume, openAiResumePath } from '../shared/ai-failure'

export const OPENAI_RETRY_DRAFT = 'shiju:openai-retry-draft'
export const OPENAI_RESUME_EVENT = 'shiju-openai-resume'

export type OpenAiRetryDraft =
  | { kind: 'practice'; source: 'url' | 'text' | 'image'; url: string; text: string; level: number; images?: { mime: string; data: string }[] }
  | { kind: 'package'; packageId: number; level: number; repeat: boolean }
  | { kind: 'grade'; lessonId: number; idx: number; text: string }
  | { kind: 'translate'; indexes: number[] }
  | { kind: 'lookup' }
  | { kind: 'define'; itemId: number }
  | { kind: 'quest'; lessonId: number; tail: boolean }
  | { kind: 'import'; body: unknown }

const KINDS = new Set<OpenAiRetryDraft['kind']>(['practice', 'package', 'grade', 'translate', 'lookup', 'define', 'quest', 'import'])

export function stashOpenAiDraft(draft: OpenAiRetryDraft): boolean {
  const write = (value: OpenAiRetryDraft) => sessionStorage.setItem(OPENAI_RETRY_DRAFT, JSON.stringify(value))
  try {
    write(draft)
    return true
  } catch {
    if (draft.kind === 'practice' && draft.images?.length) {
      try {
        write({ ...draft, images: undefined })
        return true
      } catch {
        return false
      }
    }
    return false
  }
}

export function readOpenAiDraft(): OpenAiRetryDraft | null {
  try {
    const raw = sessionStorage.getItem(OPENAI_RETRY_DRAFT)
    if (!raw) return null
    const value = JSON.parse(raw) as OpenAiRetryDraft
    if (!value || typeof value !== 'object' || !KINDS.has(value.kind)) return null
    return value
  } catch {
    return null
  }
}

export function clearOpenAiDraft() {
  try {
    sessionStorage.removeItem(OPENAI_RETRY_DRAFT)
  } catch {
    /* 存储不可用时忽略 */
  }
}

export function resumeMatches(path: string): boolean {
  try {
    return openAiResumePath(sessionStorage) === path
  } catch {
    return false
  }
}

/** 请求已经同步发出之后再清标记。StrictMode 的清理会取消这次定时器，第二次挂载仍能带上 OpenAI。 */
export function scheduleFinishOpenAiResume(path: string) {
  const timer = setTimeout(() => {
    try {
      finishOpenAiResume(sessionStorage, path)
      clearOpenAiDraft()
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event(OPENAI_RESUME_EVENT))
  }, 0)
  return () => clearTimeout(timer)
}

export function levelOf(n: number): 1 | 2 | 3 {
  return n === 2 || n === 3 ? n : 1
}
