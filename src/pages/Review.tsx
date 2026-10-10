import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '../api'
import { prefetch, speak, stop } from '../audio'
import { previewLabel } from '../../shared/srs'
import { BLANK, clozeOf, contextClozeOf, type Cloze, type Grade, type Item, type ReviewMode } from '../../shared/types'
import { Link } from '../router'
import { libraryJump, refreshStats, useStats } from '../store'
import { Card, Chip, EnglishDefinition, Highlighted, PageTitle, SpeakButton, errMsg, toast } from '../components/ui'
import { useExampleZh } from '../exampleZh'
import { IconAlert, IconCheckCircle, IconChevronRight, IconPlusCircle, IconShare, IconSparkle } from '../components/icons'
import { ShareSheet } from '../components/ShareSheet'

/** 每批张数：到期很多时分批来，先完成一小批，不被总数吓到 */
const BATCH = 20

/** 只在本机记的「看过了」标记（新手引导、快捷键提示） */
const seen = (k: string) => {
  try {
    return localStorage.getItem(k) === '1'
  } catch {
    return true
  }
}
const markSeen = (k: string) => {
  try {
    localStorage.setItem(k, '1')
  } catch {
    /* ignore */
  }
}

const today = () => {
  const d = new Date()
  return `${d.getMonth() + 1}月${d.getDate()}日 周${'日一二三四五六'[d.getDay()]}`
}

export default function Review() {
  const [queue, setQueue] = useState<Item[] | null>(null)
  const [reviewed, setReviewed] = useState(0)
  const [sharing, setSharing] = useState(false)
  // 本次跳过的卡片：不评分、不改复习时间，只在这一轮里先放一边
  const [skipped, setSkipped] = useState<Item[]>([])
  // 本轮点过「忘了」、排到队尾等着再来一次的卡片 id
  const [again, setAgain] = useState<Set<number>>(new Set())
  const [drag, setDrag] = useState(0)
  const touch = useRef<{ x: number; y: number; horizontal?: boolean } | null>(null)
  const [flipped, setFlipped] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stats = useStats()
  // 复习方式读到之前先不出卡片，免得「只产出」模式下第一张先闪一下英文正面
  const [modeSetting, setMode] = useState<ReviewMode | null>(null)
  const mode = modeSetting ?? 'mixed'
  useEffect(() => {
    api
      .settings()
      .then((r) => setMode(r.current.reviewMode))
      .catch(() => setMode('mixed'))
  }, [])
  // 本批的目标张数（已复习数达到它就停下来休息一下）
  const [batchEnd, setBatchEnd] = useState(BATCH)
  const [guide, setGuide] = useState(() => !seen('guide-v1'))
  const [keysHint, setKeysHint] = useState(() => !seen('keys-hint-v1'))
  const closeGuide = () => {
    markSeen('guide-v1')
    setGuide(false)
  }

  // 从导航点进来时焦点还留在导航链接上，第一次按空格会被当成「点链接」而没反应
  useEffect(() => {
    const el = document.activeElement as HTMLElement | null
    if (el && el !== document.body && el.closest('nav, header')) el.blur()
  }, [])

  const load = useCallback(async () => {
    setError(null)
    try {
      const { items } = await api.review()
      setQueue(items)
      setReviewed(0)
      setBatchEnd(BATCH)
      setSkipped([])
      setAgain(new Set())
      setFlipped(false)
    } catch (e) {
      setError(errMsg(e))
    }
  }, [])

  useEffect(() => {
    load()
    return () => stop()
  }, [load])

  // 这一批做完了、还有剩余：先停下来，让用户决定继续还是到此为止
  const resting = !!queue && queue.length > 0 && reviewed >= batchEnd
  const card = resting || guide || !modeSetting ? undefined : queue?.[0]
  // 这张卡用哪种方式：混合模式下新卡先认读，之后认读 / 产出交替（按复习次数奇偶）
  const context = mode === 'context'
  const cloze = card ? (context ? contextClozeOf(card) : clozeOf(card)) : null
  const wantProduction = !!card && (context || mode === 'production' || (mode === 'mixed' && card.reps % 2 === 1))
  const production = !!cloze && wantProduction
  // 没有例句可挖空的卡片：产出模式下改成「看中文，说出英文」，而不是退回到直接显示英文
  const recall = !cloze && wantProduction && !context && !!card?.meta.meaning
  const total = reviewed + (queue?.length ?? 0) + skipped.length
  // 进度条只算当前这一批，总数大时也不会显得遥遥无期
  const batchStart = batchEnd - BATCH
  const batchTotal = Math.min(BATCH, total - batchStart)
  const batchDone = Math.max(0, reviewed - batchStart)
  const retrying = queue ? queue.filter((x) => again.has(x.id)).length : 0
  const isAgain = !!card && again.has(card.id)

  // 提前准备当前卡片的发音，点播放时基本秒出。
  // Gemini TTS 每天只有 100 次额度，所以只预取最常点的单词发音，例句等你点了再生成
  useEffect(() => {
    if (queue?.length) prefetch([queue[0].text])
  }, [queue])

  const advance = (requeue?: Item) => {
    stop()
    if (card) {
      setAgain((s) => {
        const n = new Set(s)
        if (requeue) n.add(card.id)
        else n.delete(card.id)
        return n
      })
    }
    setQueue((q) => {
      if (!q) return q
      const rest = q.slice(1)
      return requeue ? [...rest, requeue] : rest
    })
    setReviewed((n) => n + (requeue ? 0 : 1))
    setFlipped(false)
  }

  const skip = () => {
    if (!card || busy) return
    stop()
    setSkipped((l) => [...l, card])
    setQueue((q) => (q ? q.slice(1) : q))
    setFlipped(false)
    setDrag(0)
  }

  const restoreSkipped = () => {
    setQueue((q) => [...(q ?? []), ...skipped])
    setSkipped([])
    setFlipped(false)
  }

  // 手机上把卡片往左滑 = 跳过
  const onTouchStart = (e: React.TouchEvent) => {
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }
  const onTouchMove = (e: React.TouchEvent) => {
    const t = touch.current
    if (!t) return
    const dx = e.touches[0].clientX - t.x
    const dy = e.touches[0].clientY - t.y
    if (t.horizontal === undefined) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
      t.horizontal = Math.abs(dx) > Math.abs(dy)
    }
    if (t.horizontal) setDrag(Math.min(0, dx))
  }
  const onTouchEnd = () => {
    const horizontal = touch.current?.horizontal
    touch.current = null
    if (horizontal && drag < -90) skip()
    else setDrag(0)
  }

  const grade = async (g: Grade) => {
    if (!card || busy) return
    setBusy(true)
    try {
      const { item } = await api.grade(card.id, g)
      // “忘了”的卡 10 分钟后到期，这里直接放到本轮队尾再来一次；给个反馈，免得看起来像没生效
      if (g === 0) {
        const name = card.text.length > 16 ? `${card.text.slice(0, 16)}…` : card.text // 句子卡很长，提示里只放开头
        toast(queue && queue.length > 1 ? `「${name}」稍后再来一次` : `「${name}」马上再来一次`)
      }
      advance(g === 0 ? item : undefined)
      refreshStats()
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const markDone = async () => {
    if (!card || busy) return
    setBusy(true)
    try {
      await api.update(card.id, { status: 'done' })
      toast(`「${card.text}」已标记 DONE`)
      advance()
      refreshStats()
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  // 电脑端快捷键：空格翻转 · 1/2/3 评分 · P 播放 · D 标记 DONE
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {})
  keyRef.current = (e: KeyboardEvent) => {
    if (!card || e.metaKey || e.ctrlKey || e.altKey) return
    const t = e.target as HTMLElement
    if (t.closest('input, textarea, [contenteditable], [role="dialog"], [role="alertdialog"]')) return
    const k = e.key.toLowerCase()
    if (keysHint && ['1', '2', '3', ' ', 'p', 'd', 's'].includes(k)) {
      markSeen('keys-hint-v1')
      setKeysHint(false)
    }
    if (k === ' ' || k === 'enter') {
      // 焦点在按钮上时空格 / 回车照常「点」那个按钮；导航链接上的空格当作翻转
      if (t.closest('button') || (t.closest('a') && k === 'enter')) return
      e.preventDefault()
      if (!flipped) setFlipped(true)
    } else if (flipped && (k === '1' || k === '2' || k === '3')) {
      grade((Number(k) - 1) as Grade)
    } else if (k === 'p') {
      speak(card.text)
    } else if (k === 'd' && flipped) {
      markDone()
    } else if (k === 's' || k === 'arrowright') {
      skip()
    }
  }
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  return (
    <div className="pt-safe flex min-h-0 flex-1 flex-col px-4 md:px-6 md:pt-10">
      <div className="md:hidden">
        <PageTitle
          eyebrow="今日复习"
          title={today()}
          right={
            <div className="flex items-center gap-2">
              <Link
                to="/remix"
                aria-label="AI 重组：用今天要复习的词造几个新句子"
                title="AI 重组：用今天要复习的词造几个新句子"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface text-ink"
              >
                <IconSparkle />
              </Link>
              <div className="flex h-10 items-center gap-1.5 rounded-full bg-invert-bg px-3.5 text-[13px] text-invert-fg">
                <span className="opacity-70">本批剩</span>
                <span className="tabular font-semibold">{queue ? Math.min(queue.length, Math.max(0, batchEnd - reviewed)) : '–'}</span>
              </div>
            </div>
          }
        />
      </div>

      <div className="mt-3.5 flex items-center gap-3 md:mt-0 md:gap-4">
        <div className="h-[3px] flex-1 overflow-hidden rounded-sm bg-line">
          <div
            className="h-[3px] rounded-sm bg-accent transition-[width] duration-500"
            style={{ width: batchTotal > 0 ? `${Math.round((batchDone / batchTotal) * 100)}%` : '0%' }}
          />
        </div>
        <div className={`tabular text-xs text-muted md:text-[13px] ${total ? '' : 'invisible'}`}>
          {total > BATCH && <span className="text-faint">第 {Math.floor(batchStart / BATCH) + 1} 批 · </span>}
          {card ? Math.min(batchDone + 1, batchTotal) : batchDone} / {batchTotal}
          {retrying > 0 && (
            <span className="text-faint" title="点了「忘了」的卡片，这一轮结束前会再出现一次">
              {' '}
              · 待重来 {retrying}
            </span>
          )}
          {skipped.length > 0 && <span className="text-faint"> · 跳过 {skipped.length}</span>}
        </div>
        {card && (
          <button
            onClick={skip}
            disabled={busy}
            aria-label="跳过这张（仅本次）"
            title="跳过这张，仅本次有效（手机上也可以左滑卡片）"
            className="-my-1 flex h-8 items-center gap-1 rounded-full border border-line bg-surface px-3 text-xs text-muted-2 disabled:opacity-40"
          >
            跳过
            <IconChevronRight size={14} />
          </button>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col pt-3 pb-3 md:flex-none md:pt-5 md:pb-4">
        {error ? (
          <Empty icon={<IconAlert size={26} />} tone="error" title="加载失败" desc={error} action={<button className={btnPrimary} onClick={load}>重试</button>} />
        ) : !queue || !modeSetting ? (
          <Card className="min-h-[300px] flex-1 animate-shimmer md:h-[440px] md:flex-none" />
        ) : guide && queue.length > 0 ? (
          <Guide due={queue.length} onClose={closeGuide} />
        ) : resting ? (
          <Empty
            icon={<span className="text-2xl">🎉</span>}
            title={`这一批 ${BATCH} 张完成了`}
            desc={`还剩 ${queue.length} 张，大约 ${minutesOf(Math.min(queue.length, BATCH))} 分钟一批。休息一下，或者现在继续。没复习完的明天还在，不会丢。`}
            action={
              <div className="flex gap-2.5">
                <Link to="/practice" className={`${btnGhost} no-underline`}>
                  先到这里
                </Link>
                <button className={btnPrimary} onClick={() => setBatchEnd(reviewed + BATCH)}>
                  再来 {Math.min(queue.length, BATCH)} 张
                </button>
              </div>
            }
          />
        ) : !card && skipped.length > 0 ? (
          <Empty
            title={`还有 ${skipped.length} 张跳过的卡片`}
            desc={`${reviewed ? `本轮已复习 ${reviewed} 张。` : ''}跳过的卡片不会改变复习时间，下次打开还会出现。`}
            action={
              <div className="flex gap-2.5">
                <Link to="/practice" className={`${btnGhost} no-underline`}>
                  先到这里
                </Link>
                <button className={btnPrimary} onClick={restoreSkipped}>
                  现在复习它们
                </button>
              </div>
            }
          />
        ) : !card ? (
          <Empty
            icon={reviewed ? <span className="animate-rise text-3xl">🎉</span> : undefined}
            title={reviewed ? '今日完成！' : stats && stats.active + stats.done === 0 ? '词库还是空的' : '现在没有要复习的'}
            desc={
              reviewed
                ? `今天复习了 ${reviewed} 张卡片，坚持就是最难的部分，你做到了。想再巩固，可以用「AI 重组」把这些词放进新句子里读一遍。`
                : stats && stats.active + stats.done === 0
                  ? '先添加几个单词或句子，AI 会帮你补全释义和例句。'
                  : '到期的卡片会自动出现在这里。'
            }
            action={
              <div className="flex flex-col items-center gap-3">
                <div className="flex gap-2.5">
                  <Link to="/add" className={`${btnGhost} no-underline`}>
                    <IconPlusCircle size={18} /> 添加
                  </Link>
                  {stats && stats.active > 0 && (
                    <Link to="/remix" className={`${btnPrimary} no-underline`}>
                      <IconSparkle size={18} /> AI 重组
                    </Link>
                  )}
                </div>
                <Link to="/weekly" className="text-[13px] text-accent no-underline">
                  看看本周回顾 ›
                </Link>
                {reviewed > 0 && (
                  <button
                    onClick={() => setSharing(true)}
                    className="flex h-10 items-center gap-1.5 rounded-xl border-0 bg-accent-soft px-4 text-[13px] font-medium text-accent"
                  >
                    <IconShare size={16} /> 生成分享卡片
                  </button>
                )}
                <ShareSheet open={sharing} onClose={() => setSharing(false)} reviewed={reviewed} />
              </div>
            }
          />
        ) : (
          <div
            className={`flex min-h-0 flex-1 flex-col md:flex-none ${drag ? '' : 'transition-transform duration-200'}`}
            style={{ transform: drag ? `translateX(${drag}px) rotate(${drag / 40}deg)` : undefined, opacity: drag ? Math.max(0.4, 1 + drag / 300) : undefined, touchAction: 'pan-y' }}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onTouchCancel={onTouchEnd}
          >
            <Card
              key={`${card.id}-${flipped}-${reviewed}-${skipped.length}`}
              className="flex min-h-[240px] flex-1 animate-flip flex-col overflow-hidden md:max-h-[min(640px,calc(100dvh-260px))] md:min-h-[440px] md:flex-none"
            >
              {flipped ? (
                <Back
                  item={card}
                  cloze={production && !context ? cloze : null}
                  onDone={markDone}
                  busy={busy}
                  onUpdate={(item) => setQueue((q) => (q ? q.map((x) => (x.id === item.id ? { ...x, ...item } : x)) : q))}
                />
              ) : (
                recall ? (
                  <RecallFront item={card} onFlip={() => setFlipped(true)} again={isAgain} />
                ) : production && cloze ? (
                  <ProductionFront cloze={cloze} onFlip={() => setFlipped(true)} context={context} source={card.package_title ? `出自《${card.package_title}》${card.source_ref ? ` · ${card.source_ref}` : ''}` : ''} again={isAgain} />
                ) : (
                  <Front item={card} onFlip={() => setFlipped(true)} again={isAgain} />
                )
              )}
            </Card>
          </div>
        )}
      </div>

      {card && (
        <div className="pb-3 md:pb-0">
          {!flipped ? (
            <button
              onClick={() => setFlipped(true)}
              className="h-[52px] w-full rounded-[14px] border-0 bg-invert-bg text-base font-medium tracking-wide text-invert-fg md:h-16"
            >
              显示答案
            </button>
          ) : (
            <div className="grid grid-cols-3 gap-2.5 md:gap-3">
              <GradeButton k="1" label="忘了" hint={previewLabel(card.interval, 0)} cls="bg-forgot-bg text-forgot-fg" onClick={() => grade(0)} disabled={busy} />
              <GradeButton k="2" label="模糊" hint={previewLabel(card.interval, 1)} cls="bg-hazy-bg text-ink" onClick={() => grade(1)} disabled={busy} />
              <GradeButton k="3" label="记得" hint={previewLabel(card.interval, 2)} cls="bg-accent text-on-accent" onClick={() => grade(2)} disabled={busy} />
            </div>
          )}
          <div
            className={`mt-5 hidden text-center text-xs md:block ${keysHint ? 'rounded-xl bg-accent-soft px-3 py-2.5 text-accent' : 'text-muted'}`}
          >
            {keysHint && <span className="font-medium">键盘更快：</span>}
            空格 翻转 · 1 / 2 / 3 评分 · P 播放 · D 已掌握（标记 DONE，不再复习） · S 跳过
            {keysHint && (
              <button
                onClick={() => {
                  markSeen('keys-hint-v1')
                  setKeysHint(false)
                }}
                className="ml-2 border-0 bg-transparent p-0 text-xs text-accent underline underline-offset-2"
              >
                知道了
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const btnPrimary =
  'flex h-12 items-center justify-center gap-2 rounded-2xl border-0 bg-invert-bg px-5 text-[15px] font-medium text-invert-fg'
const btnGhost =
  'flex h-12 items-center justify-center gap-2 rounded-2xl border border-line bg-surface px-5 text-[15px] font-medium text-ink'

/** 本轮「忘了」后重新出现的卡片标记 */
function AgainBadge() {
  return (
    <span title="刚才点了「忘了」，再来一次" className="rounded-full bg-forgot-bg px-2.5 py-1 text-xs font-medium whitespace-nowrap text-forgot-fg">
      重来一次
    </span>
  )
}

function Front({ item, onFlip, again = false }: { item: Item; onFlip: () => void; again?: boolean }) {
  const isWord = item.type === 'word'
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pt-4 pb-5 md:px-12 md:py-10" onClick={onFlip}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Chip>{isWord ? '单词' : '句子'}</Chip>
          {again && <AgainBadge />}
        </div>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center-safe gap-3 py-2 text-center">
        <div
          className={`font-serif font-medium tracking-tight ${
            isWord ? 'text-[40px] leading-[1.1] md:text-[56px]' : 'text-[22px] leading-snug md:text-[30px]'
          }`}
        >
          {item.text}
        </div>
        {item.meta.ipa && <div className="font-serif text-base text-muted italic md:text-lg">{item.meta.ipa}</div>}
        <div className="mt-3">
          <SpeakButton text={item.text} size={48} label={isWord ? '播放发音' : '播放句子'} />
        </div>
      </div>
      <div className="text-center text-[13px] text-muted">{isWord ? '先在心里回想释义' : '先在心里回想意思'}</div>
    </div>
  )
}

/** 产出正面（没有例句可挖空时）：看中文释义，说出英文 */
function RecallFront({ item, onFlip, again = false }: { item: Item; onFlip: () => void; again?: boolean }) {
  const [hint, setHint] = useState(false)
  const isWord = item.type === 'word'
  const hintText = item.text
    .split(/\s+/)
    .map((w) => (w.length <= 1 ? w : `${w[0]}${'_'.repeat(Math.min(w.length - 1, 8))}`))
    .join(' ')
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pt-4 pb-5 md:px-12 md:py-10" onClick={onFlip}>
      <div className="flex shrink-0 items-center gap-1.5">
        <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium whitespace-nowrap text-accent">产出 · 说出英文</span>
        {again && <AgainBadge />}
      </div>
      <div className="flex flex-1 flex-col items-center justify-center-safe gap-3 py-2 text-center">
        {item.meta.pos && <div className="font-serif text-[15px] text-muted italic">{item.meta.pos}</div>}
        <div className={`font-medium ${isWord ? 'text-[26px] leading-snug md:text-[34px]' : 'text-[19px] leading-relaxed md:text-[24px]'}`}>
          {item.meta.meaning}
        </div>
        {hint ? (
          <div className="font-serif text-xl tracking-wider text-accent">{hintText}</div>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation()
              setHint(true)
            }}
            className="border-0 bg-transparent p-0 text-[13px] text-muted underline decoration-line underline-offset-4"
          >
            提示首字母
          </button>
        )}
      </div>
      <div className="text-center text-[13px] text-muted">{isWord ? '先说出对应的英文单词，再看答案' : '先试着用英文说出这句话，再看答案'}</div>
    </div>
  )
}

/** 大概需要几分钟（每张约 10 秒） */
const minutesOf = (n: number) => Math.max(1, Math.round((n * 10) / 60))

/** 第一次打开时的 3 步新手引导 */
function Guide({ due, onClose }: { due: number; onClose: () => void }) {
  const steps: [string, string][] = [
    ['看卡片，先在心里回想', '正面是单词或句子，想想它的意思；有时是中文情境填空，要你说出英文。想好了点「显示答案」（电脑上按空格）。'],
    ['按记忆程度打分', '「忘了」10 分钟后再来一次；「模糊」「记得」会隔几天再出现，按钮上写着下次出现的时间。彻底掌握的点「已掌握」（DONE），以后不再复习。'],
    ['复习完还想练？', `右上角 ✨「AI 重组」会用今天要复习的词现编几句新例句；「练习」页可以贴一篇文章，写几句英文让 AI 批改。`],
  ]
  return (
    <Card className="flex flex-1 animate-rise flex-col gap-4 overflow-y-auto p-6 md:min-h-[440px] md:flex-none md:p-10">
      <div>
        <div className="text-xs tracking-wide text-muted">第一次来？30 秒了解怎么用</div>
        <div className="mt-1 text-xl font-semibold">今天有 {due} 张卡片要复习</div>
        <div className="mt-1 text-[13px] text-muted">
          每批 {BATCH} 张，一批大约 {minutesOf(Math.min(due, BATCH))} 分钟，做完一批可以随时停下。
        </div>
      </div>
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {steps.map(([t, d], i) => (
          <li key={t} className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">{i + 1}</span>
            <div>
              <div className="text-[15px] font-medium">{t}</div>
              <div className="text-[13px] leading-relaxed text-muted">{d}</div>
            </div>
          </li>
        ))}
      </ol>
      <div className="flex-1" />
      <button onClick={onClose} className={`${btnPrimary} shrink-0`}>
        开始第一批
      </button>
    </Card>
  )
}

/** 产出正面：中文情境 + 挖空句子，先说出空里的表达 */
function ProductionFront({ cloze, onFlip, context = false, source = '', again = false }: { cloze: Cloze; onFlip: () => void; context?: boolean; source?: string; again?: boolean }) {
  const [hint, setHint] = useState(false)
  const [before, after] = cloze.sentence.split(BLANK)
  // 提示：每个词只露首字母，如 "pose a risk to" → "p… a r… t…"
  const hintText = cloze.answer
    .split(/\s+/)
    .map((w) => (w.length <= 1 ? w : `${w[0]}…`))
    .join(' ')
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pt-4 pb-5 md:px-12 md:py-10" onClick={onFlip}>
      <div className="flex items-center justify-between">
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium whitespace-nowrap text-accent">
            {context ? '语境 · 原句填空' : '产出 · 说出来'}
          </span>
          {again && <AgainBadge />}
        </div>
        {source && <span className="truncate pl-3 text-xs text-muted">{source}</span>}
      </div>
      <div className="flex flex-1 flex-col justify-center-safe gap-5 py-2">
        {cloze.scene && <p className="m-0 text-[15px] leading-relaxed text-muted-2 md:text-[17px]">{cloze.scene}</p>}
        <p className="m-0 font-serif text-[22px] leading-normal md:text-[28px]">
          {before}
          <span className="mx-0.5 inline-block min-w-[3.5em] border-b-2 border-accent text-center text-accent">
            {hint ? hintText : '\u00a0'}
          </span>
          {after}
        </p>
        {!hint && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              setHint(true)
            }}
            className="self-start border-0 bg-transparent p-0 text-[13px] text-muted underline decoration-line underline-offset-4"
          >
            提示首字母
          </button>
        )}
      </div>
      <div className="text-center text-[13px] text-muted">{context ? '回想原文里这句话，空里是什么，再看答案' : '先大声说出空里的表达，再看答案'}</div>
    </div>
  )
}

function Back({
  item,
  cloze,
  onDone,
  busy,
  onUpdate,
}: {
  item: Item
  cloze?: Cloze | null
  onDone: () => void
  busy: boolean
  onUpdate: (item: Item) => void
}) {
  const [defining, setDefining] = useState(false)
  const translating = useExampleZh(item, onUpdate)
  const define = async () => {
    setDefining(true)
    try {
      onUpdate((await api.define(item.id)).item)
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setDefining(false)
    }
  }
  const m = item.meta
  const isWord = item.type === 'word'
  const filled = cloze ? cloze.sentence.replace(BLANK, cloze.answer) : ''
  const scrollRef = useRef<HTMLDivElement>(null)
  const more = useMoreBelow(scrollRef)
  return (
    <div ref={scrollRef} className="relative flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-5 pt-5 pb-3 md:px-12 md:py-10">
      {cloze && (
        <div className="mb-4 flex items-start gap-2 rounded-xl bg-accent-soft/60 px-3.5 py-3 md:mb-6">
          <div className="flex-1">
            <div className="mb-1 text-xs text-muted">{cloze.scene}</div>
            <div className="font-serif text-[18px] leading-normal md:text-[21px]">
              <Highlighted text={filled} marks={[cloze.answer]} />
            </div>
          </div>
          <SpeakButton text={filled} size={36} variant="ghost" waves={1} label="播放整句" />
        </div>
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1 md:flex-row md:items-baseline md:gap-4">
          <div
            className={`font-serif font-medium tracking-tight ${
              isWord ? 'text-[28px] leading-[1.1] md:text-[44px]' : 'text-[19px] leading-snug md:text-[26px]'
            }`}
          >
            {item.text}
          </div>
          {m.ipa && <div className="font-serif text-base text-muted italic md:text-lg">{m.ipa}</div>}
        </div>
        <SpeakButton text={item.text} size={44} />
      </div>

      <div className="my-4 h-px bg-divider md:my-7" />

      <div className="flex items-baseline gap-2.5">
        {m.pos && <span className="font-serif text-[15px] text-muted italic md:text-[17px]">{m.pos}</span>}
        <span className="text-base leading-relaxed font-medium md:text-xl">{m.meaning || '（暂无释义）'}</span>
      </div>
      {m.definitionEn ? (
        <EnglishDefinition text={m.definitionEn} source={m.definitionSrc} word={item.text} className="mt-1.5 text-[15px] md:text-[17px]" />
      ) : (
        isWord && (
          <button
            onClick={define}
            disabled={defining}
            className="mt-1 -ml-1 self-start border-0 bg-transparent px-1 py-1 text-xs text-muted underline decoration-line underline-offset-4 disabled:opacity-50"
          >
            {defining ? '查词典中…' : '查英英释义'}
          </button>
        )
      )}

      {m.example && (
        <div className="mt-5 flex flex-col gap-1.5 md:mt-7 md:gap-2">
          <div className="flex items-center justify-between">
            <div className="text-xs tracking-wider text-muted">例句</div>
            <div className="-my-3 -mr-3">
              <SpeakButton text={m.example} variant="ghost" size={44} waves={1} label="播放例句" />
            </div>
          </div>
          <div className="font-serif text-lg leading-normal md:text-[23px]">
            <Highlighted text={m.example} marks={[m.highlight]} />
          </div>
          {m.exampleZh ? (
            <div className="text-sm leading-relaxed text-muted md:text-[15px]">{m.exampleZh}</div>
          ) : (
            translating && <div className="animate-shimmer text-sm text-faint">正在翻译例句…</div>
          )}
        </div>
      )}

      {m.phrases.length > 0 && (
        <div className="mt-4 flex flex-col gap-1 md:mt-5">
          <div className="text-xs tracking-wider text-muted">{isWord ? '搭配' : '重点短语'}</div>
          {m.phrases.map((p, i) => (
            <div key={i} className="text-sm leading-relaxed">
              <span className="font-serif text-base">{p.text}</span>
              <span className="ml-2 text-muted">{p.meaning}</span>
            </div>
          ))}
        </div>
      )}

      {m.memoryTip && (
        <div className="mt-4 rounded-xl bg-chip px-3.5 py-2.5 text-sm leading-relaxed text-muted-2 md:mt-5">💡 {m.memoryTip}</div>
      )}

      <div className="min-h-4 flex-1" />
      {item.package_id && item.package_title && (
        <Link
          to="/library"
          onClick={() => {
            libraryJump.packageId = item.package_id ?? null
          }}
          className="mb-1 self-start text-xs text-muted no-underline"
        >
          来自《{item.package_title}》{item.source_ref && ` · ${item.source_ref}`} ›
        </Link>
      )}
      <button
        onClick={onDone}
        disabled={busy}
        className="flex h-11 items-center gap-1.5 self-start border-0 bg-transparent px-1 text-[13px] text-muted hover:text-ink"
      >
        <IconCheckCircle size={18} />
        已掌握，标记 DONE（不再复习）
      </button>
      {/* 还有内容没看完时，底部渐隐提示可以继续往下滚 */}
      <div
        aria-hidden
        className={`pointer-events-none sticky -bottom-3 -mx-5 -mb-3 h-12 shrink-0 bg-gradient-to-t from-surface to-transparent transition-opacity duration-200 md:-mx-12 ${
          more ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ marginTop: '-3rem' }}
      />
    </div>
  )
}

function GradeButton(p: { k: string; label: string; hint: string; cls: string; onClick: () => void; disabled: boolean }) {
  return (
    <button
      onClick={p.onClick}
      disabled={p.disabled}
      className={`flex h-[52px] flex-col items-center justify-center gap-0 rounded-[14px] border-0 transition active:scale-[0.97] disabled:opacity-60 md:h-16 md:flex-row md:gap-2.5 ${p.cls}`}
    >
      <span className="hidden h-[22px] w-[22px] items-center justify-center rounded-md border border-current/35 text-xs md:flex">
        {p.k}
      </span>
      <span className="text-[15px] font-semibold md:text-base">{p.label}</span>
      <span className="text-[11px] opacity-85 md:text-[13px]">{p.hint}</span>
    </button>
  )
}

function Empty({
  title,
  desc,
  action,
  icon = <IconCheckCircle size={26} />,
  tone = 'ok',
}: {
  title: string
  desc: string
  action?: ReactNode
  icon?: ReactNode
  tone?: 'ok' | 'error'
}) {
  return (
    <Card className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center md:h-[440px]">
      <div
        className={`mb-2 flex h-14 w-14 items-center justify-center rounded-full ${
          tone === 'error' ? 'bg-forgot-bg text-forgot-fg' : 'bg-accent-soft text-accent'
        }`}
      >
        {icon}
      </div>
      <div className="text-xl font-semibold">{title}</div>
      <div className="max-w-[320px] text-sm leading-relaxed text-muted">{desc}</div>
      {action && <div className="mt-3">{action}</div>}
    </Card>
  )
}

/** 滚动容器下方是否还有没看到的内容 */
function useMoreBelow(ref: React.RefObject<HTMLElement | null>) {
  const [more, setMore] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 8)
    check()
    el.addEventListener('scroll', check, { passive: true })
    const ro = new ResizeObserver(check)
    ro.observe(el)
    for (const child of Array.from(el.children)) ro.observe(child)
    return () => {
      el.removeEventListener('scroll', check)
      ro.disconnect()
    }
  }, [ref])
  return more
}
