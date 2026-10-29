import { useEffect, useState } from 'react'
import { api, type PassageDetail } from '../api'
import { Link, navigate, passagePath } from '../router'
import { errMsg, toast } from '../components/ui'
import { IconBack, IconSparkle } from '../components/icons'
import { TappableExample, WordLookupSheet } from '../components/WordLookupSheet'

/** 分级短文：先读英文，点词查词典；读完才解锁下一篇。不展示整篇中文。 */
export default function Passage({ id }: { id: string }) {
  const [passage, setPassage] = useState<PassageDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [nextId, setNextId] = useState<string | null>(null)
  const [pick, setPick] = useState<{ text: string; context: string } | null>(null)
  const [making, setMaking] = useState(false)

  useEffect(() => {
    setPassage(null)
    setError(null)
    setDone(false)
    setNextId(null)
    api
      .passage(id)
      .then((p) => {
        setPassage(p)
        setDone(p.state === 'done')
        setNextId(p.nextId)
      })
      .catch((e) => setError(errMsg(e)))
  }, [id])

  const complete = async () => {
    if (!passage || busy) return
    setBusy(true)
    try {
      const r = await api.completePassage(passage.id)
      setDone(true)
      setNextId(r.nextId)
      toast(r.nextId ? '这篇读完了，下一篇已解锁' : '这一档的短文都读完了')
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const makeLesson = async () => {
    if (!passage || making) return
    setMaking(true)
    try {
      const r = await api.createLesson({ text: passage.text })
      navigate(`/practice/${r.id}`)
    } catch (e) {
      toast(errMsg(e), 'error')
      setMaking(false)
    }
  }

  const paragraphs = passage?.text.split(/\n+/) ?? []

  return (
    <div className="pt-safe flex flex-1 flex-col pb-28 md:pt-8">
      <div className="flex items-center px-2 md:px-6">
        <Link to="/practice" aria-label="返回练习" className="-ml-1 flex h-11 w-11 items-center justify-center text-ink md:-ml-3">
          <IconBack size={22} />
        </Link>
      </div>
      {!passage && !error ? (
        <div className="mx-4 mt-4 h-64 animate-shimmer rounded-2xl bg-surface md:mx-6" />
      ) : error ? (
        <div className="mx-4 mt-6 rounded-2xl border border-line-soft bg-surface p-6 text-center md:mx-6">
          <p className="m-0 text-sm leading-relaxed text-muted">{error}</p>
          <Link to="/practice" className="mt-4 inline-flex h-11 items-center rounded-2xl bg-invert-bg px-5 text-sm text-invert-fg no-underline">
            回到练习
          </Link>
        </div>
      ) : passage ? (
        <article className="px-4 md:px-6">
          <div className="text-[13px] tracking-wide text-muted">
            {passage.bandName}档 · 约 {passage.words} 词 · 点词查义
          </div>
          <h1 className="m-0 mt-1 font-serif text-[26px] leading-tight font-medium">{passage.title}</h1>
          <div className="mt-4 flex flex-col gap-4 font-serif text-[17px] leading-relaxed text-ink md:text-xl">
            {paragraphs.map((para, i) => (
              <p key={i} className="m-0">
                <TappableExample text={para} onLookup={(word) => setPick({ text: word, context: para })} />
              </p>
            ))}
          </div>
        </article>
      ) : null}

      {passage && (
        <div className="pb-safe fixed inset-x-0 bottom-0 z-20 border-t border-line bg-bg/95 px-4 pt-3 backdrop-blur md:static md:border-0 md:bg-transparent md:px-6 md:pt-6">
          <div className="mx-auto flex w-full max-w-[640px] flex-col gap-2">
            {done ? (
              <div className="flex gap-2">
                {nextId ? (
                  <button
                    onClick={() => navigate(passagePath(nextId))}
                    className="h-12 flex-1 rounded-[14px] border-0 bg-invert-bg text-[15px] font-medium text-invert-fg"
                  >
                    下一篇
                  </button>
                ) : (
                  <Link to="/practice" className="flex h-12 flex-1 items-center justify-center rounded-[14px] border-0 bg-invert-bg text-[15px] font-medium text-invert-fg no-underline">
                    这一档读完了
                  </Link>
                )}
                <button
                  onClick={makeLesson}
                  disabled={making}
                  className="flex h-12 items-center justify-center gap-1.5 rounded-[14px] border border-line bg-surface px-4 text-[14px] text-ink disabled:opacity-50"
                >
                  <IconSparkle size={16} /> {making ? '正在出练习…' : '出练习'}
                </button>
              </div>
            ) : (
              <button
                onClick={complete}
                disabled={busy}
                className="h-12 rounded-[14px] border-0 bg-invert-bg text-[15px] font-medium text-invert-fg disabled:opacity-50"
              >
                {busy ? '记下来…' : '读完了，解锁下一篇'}
              </button>
            )}
          </div>
        </div>
      )}

      {pick && <WordLookupSheet text={pick.text} context={pick.context} onClose={() => setPick(null)} />}
    </div>
  )
}
