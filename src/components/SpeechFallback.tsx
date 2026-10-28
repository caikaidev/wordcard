import { retrySystemSpeech, stop, useSpeaking } from '../audio'

/**
 * An explicit user gesture is required on some iPhone Safari versions when an
 * async cloud failure attempts to trigger speechSynthesis.
 */
export function SpeechFallback() {
  const speech = useSpeaking()
  if (!speech.needsTap || !speech.text) return null
  return (
    <div className="fixed inset-x-3 bottom-[calc(68px+env(safe-area-inset-bottom))] z-[65] mx-auto max-w-[600px] rounded-2xl border border-line bg-surface p-3 shadow-card md:bottom-6" role="status" aria-live="polite">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[14px] font-semibold text-ink">系统朗读需要你点一下</p>
          <p className="m-0 mt-0.5 text-xs leading-relaxed text-muted">iPhone Safari 没能自动启动系统声音，点按钮可重新播放。</p>
        </div>
        <button onClick={retrySystemSpeech} className="shrink-0 rounded-xl border-0 bg-accent px-3.5 py-2.5 text-[13px] font-medium text-on-accent">
          使用系统朗读
        </button>
        <button onClick={stop} aria-label="关闭朗读提示" className="shrink-0 rounded-lg border border-line px-2 py-2 text-sm text-muted">
          ×
        </button>
      </div>
    </div>
  )
}
