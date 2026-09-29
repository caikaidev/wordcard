import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { speak, stop } from '../audio'
import type { RemixResult } from '../../shared/types'
import { Link } from '../router'
import { Highlighted, SpeakButton, errMsg } from '../components/ui'
import { IconBack, IconPlay, IconRefresh, IconSparkle, IconStop } from '../components/icons'

// 切换页面再回来时不重复生成，省额度
let cache: RemixResult | null = null

export default function Remix() {
  const [data, setData] = useState<RemixResult | null>(cache)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showZh, setShowZh] = useState(true)
  const [playing, setPlaying] = useState<number | null>(null)
  const playToken = useRef(0)

  const generate = async (exclude: number[] = []) => {
    stopAll()
    setLoading(true)
    setError(null)
    try {
      const r = await api.remix(exclude)
      cache = r
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
      <div className="flex items-center justify-between px-4 md:px-6">
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

      <div className="flex flex-col gap-3.5 px-6 pt-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-[13px] tracking-wide text-muted">
            <IconSparkle size={14} className="text-accent" />
            {data ? `用 ${data.words.length} 个待复习的词生成` : '用今日到期的词生成'}
          </div>
          <h1 className="m-0 text-2xl font-semibold tracking-tight">AI 重组</h1>
        </div>
        <div className="flex min-h-[34px] flex-wrap gap-2">
          {data?.words.map((w) => (
            <span key={w.id} className="rounded-full border border-line bg-surface px-3 py-1.5 font-serif text-[15px]">
              {w.text}
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 px-6 pt-5">
        {error ? (
          <div className="rounded-[22px] border border-line-soft bg-surface p-6 text-center">
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
          [0, 1, 2].map((i) => (
            <div key={i} className="flex animate-shimmer flex-col gap-2.5 rounded-[22px] border border-line-soft bg-surface p-5">
              <div className="h-5 w-full rounded bg-chip" />
              <div className="h-5 w-3/4 rounded bg-chip" />
              <div className="h-3.5 w-1/2 rounded bg-chip" />
            </div>
          ))
        ) : (
          data.sentences.map((s, i) => (
            <div
              key={i}
              style={{ animationDelay: `${i * 60}ms` }}
              className={`flex animate-rise items-start gap-3 rounded-[22px] border bg-surface py-[18px] pr-4 pl-5 transition-colors ${
                playing === i ? 'border-accent' : 'border-line-soft'
              }`}
            >
              <div className="flex flex-1 flex-col gap-2">
                <div className="font-serif text-lg leading-normal md:text-xl">
                  <Highlighted text={s.en} marks={s.highlights} />
                </div>
                {showZh && <div className="text-[13px] leading-relaxed text-muted md:text-sm">{s.zh}</div>}
              </div>
              <SpeakButton text={s.en} waves={1} label={`播放第 ${i + 1} 句`} />
            </div>
          ))
        )}
      </div>

      <div className="pb-safe grid grid-cols-2 gap-2.5 px-6 pt-4 md:pb-10">
        <button
          onClick={() => generate(data?.words.map((w) => w.id) ?? [])}
          disabled={loading}
          className="flex h-14 items-center justify-center gap-2 rounded-[18px] border border-line bg-transparent text-[15px] font-medium text-ink disabled:opacity-50"
        >
          <IconRefresh size={18} className={loading ? 'animate-spin' : ''} />
          换一组
        </button>
        <button
          onClick={playAll}
          disabled={loading || !data}
          className="flex h-14 items-center justify-center gap-2 rounded-[18px] border-0 bg-invert-bg text-[15px] font-medium text-invert-fg disabled:opacity-50"
        >
          {playing !== null ? <IconStop /> : <IconPlay />}
          {playing !== null ? '停止' : '连续播放'}
        </button>
      </div>
    </div>
  )
}
