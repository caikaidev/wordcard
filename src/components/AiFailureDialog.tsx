import { useEffect, useState } from 'react'
import { chooseAiFailureAction, armOpenAiResume, type AiFailureChoice } from '../../shared/ai-failure'
import { ApiError, api, retryNextWithOpenAI } from '../api'
import { navigate } from '../router'
import { errMsg, toast } from './ui'
import { OPENAI_RESUME_EVENT } from '../openai-retry'

type FailureReq = {
  id: number
  message: string
  openaiConfigured: boolean
  retry: () => void
  beforeSettings?: () => void
}

let current: FailureReq | null = null
const listeners = new Set<(req: FailureReq | null) => void>()

function publish(req: FailureReq | null) {
  current = req
  listeners.forEach((listener) => listener(req))
}

/** 可切换的文本生成失败才弹窗。返回 true 表示已经接手，调用方不必再 toast 同一句。 */
export function reportAiFailure(error: unknown, retry: () => void, beforeSettings?: () => void): boolean {
  if (!(error instanceof ApiError) || !error.switchable) return false
  publish({
    id: Date.now(),
    message: error.message,
    openaiConfigured: error.openaiConfigured,
    retry,
    beforeSettings,
  })
  return true
}

async function switchToGemini(retry: () => void) {
  try {
    await api.saveSettings({ textProvider: 'gemini' })
    toast('已切换为 Gemini')
    retry()
  } catch (error) {
    toast(errMsg(error), 'error')
  }
}

function runChoice(req: FailureReq, action: 'retry' | 'openai' | 'gemini') {
  const choice: AiFailureChoice = chooseAiFailureAction(action, req.openaiConfigured)
  switch (choice) {
    case 'retry':
      publish(null)
      req.retry()
      return
    case 'openai':
      publish(null)
      retryNextWithOpenAI()
      req.retry()
      return
    case 'settings':
      publish(null)
      req.beforeSettings?.()
      try {
        armOpenAiResume(sessionStorage, window.location.pathname)
      } catch {
        toast('浏览器拦下了设置暂存，请直接打开设置填写 OpenAI API key', 'error')
        return
      }
      window.dispatchEvent(new Event(OPENAI_RESUME_EVENT))
      if (window.location.pathname === '/settings') {
        document.getElementById('openai-api-key')?.focus()
        toast('填写 OpenAI API key 并保存，会自动再试一次')
        return
      }
      navigate('/settings')
      return
    case 'gemini':
      publish(null)
      void switchToGemini(req.retry)
      return
    default: {
      const never: never = choice
      return never
    }
  }
}

export function AiFailureDialog() {
  const [req, setReq] = useState<FailureReq | null>(current)
  useEffect(() => {
    listeners.add(setReq)
    return () => void listeners.delete(setReq)
  }, [])
  useEffect(() => {
    if (!req) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') publish(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [req])
  if (!req) return null
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 md:items-center" onClick={() => publish(null)}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label="文本生成失败"
        onClick={(event) => event.stopPropagation()}
        className="pb-safe flex w-full max-w-sm animate-rise flex-col gap-4 rounded-t-3xl bg-bg p-5 md:rounded-3xl"
      >
        <div>
          <h2 className="m-0 text-[17px] font-semibold">这次没有生成成功</h2>
          <p className="mt-2 mb-0 text-[15px] leading-relaxed text-muted">{req.message}</p>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <button type="button" onClick={() => runChoice(req, 'retry')} className="h-11 rounded-2xl border border-line bg-transparent text-[15px] text-ink">
            重试
          </button>
          <button type="button" onClick={() => runChoice(req, 'openai')} className="h-11 rounded-2xl border-0 bg-invert-bg text-[15px] font-medium text-invert-fg">
            用 OpenAI 重试
          </button>
        </div>
        <button type="button" onClick={() => runChoice(req, 'gemini')} className="h-11 rounded-2xl border border-line bg-surface text-[15px] font-medium text-ink">
          切换 Gemini
        </button>
        <p className="m-0 text-xs leading-relaxed text-muted">
          {req.openaiConfigured
            ? '「用 OpenAI 重试」只对这一次生效，不会改掉当前提供方。切换 Gemini 会保存为之后的默认。'
            : '还没有可用的 OpenAI key。点「用 OpenAI 重试」会打开设置，保存后自动回到这里再试一次。'}
        </p>
      </div>
    </div>
  )
}
