import { useEffect, useRef, useState } from 'react'
import { speak, stop } from '../audio'
import { toast } from './ui'

/** Recordings remain in memory and are released when leaving this sentence. */
export default function SpeakingExercise({ en, zh, bindCheck, onComplete, answered }: {
  en: string; zh: string; answered: boolean
  bindCheck: (fn: (() => void) | null) => void; onComplete: () => void
}) {
  const [heard, setHeard] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'requesting' | 'recording'>('idle')
  const [url, setUrl] = useState<string | null>(null)
  const [replayed, setReplayed] = useState(false)
  const [manual, setManual] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState('')
  const mounted = useRef(true)
  const session = useRef(0)
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const blobUrl = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const playback = useRef<HTMLAudioElement>(null)
  const releaseMic = () => {
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  const endRecording = () => {
    if (recorder.current?.state === 'recording') recorder.current.stop()
  }
  useEffect(() => {
    mounted.current = true
    const hidden = () => { if (document.hidden) endRecording() }
    document.addEventListener('visibilitychange', hidden)
    return () => {
      mounted.current = false
      session.current++
      endRecording()
      releaseMic()
      if (blobUrl.current) URL.revokeObjectURL(blobUrl.current)
      stop()
      document.removeEventListener('visibilitychange', hidden)
    }
  }, [])
  const ready = heard && confirmed && (manual || (!!url && replayed)) && phase === 'idle'
  useEffect(() => {
    bindCheck(ready && !answered ? onComplete : null)
    return () => bindCheck(null)
  }, [ready, answered, bindCheck, onComplete])

  const record = async () => {
    stop()
    playback.current?.pause()
    setError('')
    setConfirmed(false)
    setReplayed(false)
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('当前浏览器不支持录音，可以选择直接跟读。')
      return
    }
    const token = ++session.current
    setPhase('requesting')
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!mounted.current || token !== session.current) { mic.getTracks().forEach((t) => t.stop()); return }
      stream.current = mic
      const mime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported(t))
      const rec = new MediaRecorder(mic, mime ? { mimeType: mime } : undefined)
      recorder.current = rec
      const chunks: Blob[] = []
      rec.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
      rec.onstop = () => {
        releaseMic()
        if (!mounted.current || token !== session.current) return
        setPhase('idle')
        const blob = new Blob(chunks, { type: rec.mimeType || chunks[0]?.type || 'audio/mp4' })
        if (!blob.size) { setError('没有录到声音，请重新录音或选择直接跟读。'); return }
        if (blobUrl.current) URL.revokeObjectURL(blobUrl.current)
        blobUrl.current = URL.createObjectURL(blob)
        setUrl(blobUrl.current)
      }
      rec.onerror = () => {
        releaseMic()
        if (mounted.current && token === session.current) {
          setPhase('idle')
          setError('录音中断了，请重新录音或选择直接跟读。')
        }
      }
      rec.start()
      setPhase('recording')
      timer.current = setTimeout(endRecording, 60_000)
    } catch {
      releaseMic()
      if (mounted.current && token === session.current) {
        setPhase('idle')
        setError('无法使用麦克风，请检查权限，或选择直接跟读。')
      }
    }
  }
  return (
    <div className="flex flex-col gap-4 pb-4">
      <h2 className="m-0 text-xl font-semibold">听一听，开口跟读</h2>
      <p className="m-0 text-sm text-muted">听示范 → 跟读录音 → 回放 → 自评完成</p>
      <div className="rounded-2xl border border-line bg-surface p-4">
        <p className="m-0 font-serif text-xl leading-relaxed">{en}</p>
        <p className="mb-0 text-sm text-muted">{zh}</p>
      </div>
      <button disabled={answered || phase !== 'idle'} onClick={() => {
        playback.current?.pause()
        speak(en, false, () => { if (mounted.current) setHeard(true) }).then((ok) => { if (!ok && mounted.current) toast('未能播放示范，请重试', 'error') })
      }} className="min-h-12 rounded-xl border border-line bg-surface px-4 text-ink disabled:opacity-50">播放示范</button>
      {!manual && <>
        <button disabled={answered || !heard || phase === 'requesting'} onClick={phase === 'recording' ? endRecording : record}
          className="min-h-12 rounded-xl border-0 bg-accent px-4 font-semibold text-on-accent disabled:opacity-50">
          {phase === 'requesting' ? '等待麦克风权限…' : phase === 'recording' ? '停止录音（最长 60 秒）' : url ? '重新录音' : '开始录音'}
        </button>
        {url && <label className="flex flex-col gap-2 text-sm text-muted">回放自己的跟读
          <audio ref={playback} controls src={url} onPlay={() => { stop(); setReplayed(true) }} className="w-full" />
        </label>}
        <p className="m-0 text-xs text-muted">录音只在当前设备回放，离开本题后删除，不上传。</p>
      </>}
      {error && <p role="alert" className="m-0 text-sm text-forgot-fg">{error}</p>}
      <button disabled={answered || phase !== 'idle'} onClick={() => { stop(); playback.current?.pause(); setManual(!manual); setConfirmed(false) }}
        className="min-h-11 border-0 bg-transparent text-sm text-muted underline disabled:opacity-50">{manual ? '改用录音跟读' : '暂不录音，直接跟读'}</button>
      {manual && <p className="m-0 text-sm text-muted">听完示范后，请自己开口跟读，再确认完成。</p>}
      <label className="flex min-h-12 items-center gap-3 rounded-xl border border-line p-3 text-sm">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={answered || !heard || (!manual && !replayed) || phase !== 'idle'} />
        {manual ? '我已开口跟读这句话' : '我已跟读，并回放检查了自己的录音'}
      </label>
      <p className="m-0 text-xs text-muted">本关由你自评完成，不评判发音准确率。</p>
    </div>
  )
}
