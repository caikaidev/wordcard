import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { prefetch, speak, stop } from '../audio'
import { REMIX_TIMEOUT_SEC } from '../../shared/remix'
import type { RemixResult } from '../../shared/types'
import { Link } from '../router'
import { GlossSpan } from '../components/GlossText'
import { WaitProgress, errMsg } from '../components/ui'
import { IconBack, IconPlay, IconRefresh, IconSparkle, IconStop } from '../components/icons'

// 切换页面再回来时不重复生成，省额度
let cache: RemixResult | null = null

export default function Remix() {
  const [data, setData] = useState<RemixResult | null>(cache)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showZh, setShowZh] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const [playing, setPlaying] = useState<number | null>(null)
  const playToken = useRef(0)

  const generate = async (exclude: number[] = []) => {
    stopAll()
    setLoading(true)
    setError(null)
    try {
      const r = await api.remix(exclude)
      prefetch(r.sentences.map((x) => x.en))
      cache = r
      setPicked(null)
      setData(r)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!cache) generate()
    return () => stopAll()
  }, [])

  const stopAll = () => {
    playToken.current++
    setPlaying(null)
    stop()
  }

  const playAll = async () => {
    if (!data) return
    if (playing !== null) return stopAll()
    const token = ++playToken.current
    for (let i = 0; i < data.sentences.length; i++) {
      if (token !== playToken.current) return
      setPlaying(i)
      const ok = await speak(data.sentences[i].en)
      if (!ok || token !== playToken.current) break
      await new Promise((r) => setTimeout(r, 600))
    }
    if (token === playToken.current) setPlaying(null)
  }

  return (
    <div className="pt-safe flex flex-1 flex-col md:pt-8">
      <div className="flex items-center justify-between px-2 pr-4 md:px-6">
        <Link
          to="/"
          aria-label="返回复习"
          className="-ml-1 flex h-11 w-11 items-center justify-center text-ink md:-ml-3"
        >
          <IconBack size={22} />
        </Link>
        <button
          onClick={() => setShowZh(!showZh)}
          className="h-9 rounded-full border border-line bg-surface px-3.5 text-[13px] text-ink"
        >
          {showZh ? '隐藏中文' : '显示中文'}
        </button>
      </div>

      <div className="flex flex-col gap-3 px-4 pt-1 md:px-6">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-[13px] tracking-wide text-muted">
            <IconSparkle size={14} className="text-accent" />
            {data ? `用 ${data.words.length} 个词写成一段` : '用今日到期的词写成一段'}
          </div>
          <h1 className="m-0 text-[22px] font-semibold tracking-tight md:text-2xl">AI 重组</h1>
          <p className="m-0 text-xs leading-relaxed text-muted">先读英文。点亮的词再看意思，中文默认先藏着。</p>
        </div>
        {!!data?.skipped?.length && (
          <p className="m-0 text-xs leading-relaxed text-faint">已跳过过浅的词：{data.skipped.join('、')}</p>
        )}
      </div>

      <div className="flex flex-col gap-2.5 px-4 pt-4 pb-3 md:px-6">
        {error ? (
          <div className="rounded-2xl border border-line-soft bg-surface p-6 text-center">
            <div className="text-sm leading-relaxed text-muted">{error}</div>
            <div className="mt-4 flex justify-center gap-2">
              <button onClick={() => generate()} className="h-11 rounded-2xl border-0 bg-invert-bg px-5 text-sm text-invert-fg">
                重试
              </button>
              <Link to="/add" className="flex h-11 items-center rounded-2xl border border-line px-5 text-sm text-ink no-underline">
                去添加
              </Link>
            </div>
          </div>
        ) : loading || !data ? (
          <>
            <WaitNote />
            <div className="flex animate-shimmer flex-col gap-2.5 rounded-2xl border border-line-soft bg-surface p-5">
              <div className="h-5 w-full rounded bg-chip" />
              <div className="h-5 w-11/12 rounded bg-chip" />
              <div className="h-5 w-4/5 rounded bg-chip" />
              <div className="h-5 w-2/3 rounded bg-chip" />
            </div>
          </>
        ) : (
          <PassageBlock data={data} showZh={showZh} playing={playing} picked={picked} onPick={setPicked} />
        )}
      </div>

      <div className="pb-safe sticky bottom-0 mt-auto grid grid-cols-2 gap-2.5 bg-bg px-4 pt-3 md:px-6 md:pb-10">
        <button
          onClick={() => generate(data?.words.map((w) => w.id) ?? [])}
          disabled={loading}
          className="flex h-[52px] items-center justify-center gap-2 rounded-[14px] border border-line bg-transparent text-[15px] font-medium text-ink disabled:opacity-50"
        >
          <IconRefresh size={18} className={loading ? 'animate-spin' : ''} />
          换一组
        </button>
        <button
          onClick={playAll}
          disabled={loading || !data}
          className="flex h-[52px] items-center justify-center gap-2 rounded-[14px] border-0 bg-invert-bg text-[15px] font-medium text-invert-fg disabled:opacity-50"
        >
          {playing !== null ? <IconStop /> : <IconPlay />}
          {playing !== null ? '停止' : '连续播放'}
        </button>
      </div>
    </div>
  )
}

/** 生成期间的进度说明：阶段文案 + 已等待秒数；超过 15 秒说明比平时慢，并告知多久会超时 */
function glossOf(form: string, data: RemixResult) {
  const key = form.toLowerCase()
  return data.words.find((w) => key.includes(w.text.toLowerCase()) || w.text.toLowerCase().includes(key))?.meaning || ''
}

function PassageBlock({
  data,
  showZh,
  playing,
  picked,
  onPick,
}: {
  data: RemixResult
  showZh: boolean
  playing: number | null
  picked: string | null
  onPick: (form: string) => void
}) {
  const meaning = picked ? glossOf(picked, data) : ''
  return (
    <article className="animate-rise rounded-2xl border border-line-soft bg-surface px-4 py-4">
      <p className="m-0 font-serif text-[17px] leading-relaxed md:text-xl">
        {data.sentences.map((s, i) => (
          <span key={i} className={playing === i ? 'rounded-sm bg-accent-soft' : undefined}>
            <GlossSpan text={s.en} forms={s.highlights} active={picked} onPick={onPick} />
            {i < data.sentences.length - 1 ? ' ' : ''}
          </span>
        ))}
      </p>
      {picked && (
        <p className="mt-3 mb-0 text-[14px] leading-relaxed text-ink">
          <span className="font-serif text-accent">{picked}</span>
          {meaning ? <span className="text-muted"> · {meaning}</span> : <span className="text-muted"> · 这个词在上面的句子里</span>}
        </p>
      )}
      {showZh && <p className="mt-3 mb-0 text-[13px] leading-relaxed text-muted md:text-sm">{data.sentences.map((s) => s.zh).filter(Boolean).join('')}</p>}
    </article>
  )
}

function WaitNote() {
  return (
    <WaitProgress
      stages={[
        [0, '正在挑掉过浅的词…'],
        [3, 'AI 正在写成同一段短文…通常 5–15 秒'],
        [18, '上一稿没有连上，正在重写…'],
      ]}
      timeout={REMIX_TIMEOUT_SEC}
      timeoutHint={`到 ${REMIX_TIMEOUT_SEC} 秒还没写好会停下来，点「重试」即可`}
    />
  )
}
