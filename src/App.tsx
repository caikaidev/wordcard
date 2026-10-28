import { clearReadCache } from './readCache'
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, lessonIdOf, pathIdOf, readerIdOf, savedIdOf, usePath, type Path } from './router'
import { refreshStats, useStats } from './store'
import { Confirmer, Toaster } from './components/ui'
import { SpeechFallback } from './components/SpeechFallback'
import { PullIndicator, hasNewVersion, usePullToRefresh } from './components/PullToRefresh'
import { IconCards, IconGear, IconList, IconPen, IconPlusCircle, IconSparkle } from './components/icons'
import Review from './pages/Review'
const Add = lazy(() => import('./pages/Add'))
const Library = lazy(() => import('./pages/Library'))
const Remix = lazy(() => import('./pages/Remix'))
const Settings = lazy(() => import('./pages/Settings'))
const Practice = lazy(() => import('./pages/Practice'))
const LessonPage = lazy(() => import('./pages/Lesson'))
const Reader = lazy(() => import('./pages/Reader'))
const Weekly = lazy(() => import('./pages/Weekly'))
const Discover = lazy(() => import('./pages/Discover'))
const Level = lazy(() => import('./pages/Level'))
const QuestPage = lazy(() => import('./pages/Quest'))

const tabs: { to: Path; label: string; icon: ReactNode }[] = [
  { to: '/', label: '复习', icon: <IconCards size={22} /> },
  { to: '/practice', label: '练习', icon: <IconPen size={22} /> },
  { to: '/add', label: '添加', icon: <IconPlusCircle size={22} /> },
  { to: '/library', label: '词库', icon: <IconList size={22} /> },
]

export default function App() {
  const path = usePath()
  const scroller = useRef<HTMLDivElement>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const ptr = usePullToRefresh(
    scroller,
    async () => {
      // 有新部署的版本就整页重新加载，否则只重新拉取当前页数据
      if (await hasNewVersion()) return window.location.reload()
      clearReadCache()
      await refreshStats()
      setRefreshKey((k) => k + 1)
    },
    path !== '/add' && path !== '/discover' && path !== '/level' && lessonIdOf(path) === null && readerIdOf(path) === null && pathIdOf(path) === null && savedIdOf(path) === null, // 有输入框或需要选中文字的页面不启用
  )
  useEffect(() => {
    refreshStats()
    scroller.current?.scrollTo(0, 0)
  }, [path])
  // 从后台切回来（手机上常常隔了很久）：顺手拉一次数据，登录过期的话 api 会立刻带去重新登录，
  // 而不是等用户点了按钮才报错
  useEffect(() => {
    let hiddenAt = 0
    const onVisibility = () => {
      if (document.hidden) hiddenAt = Date.now()
      else if (hiddenAt && Date.now() - hiddenAt > 5 * 60_000) {
        clearReadCache()
        refreshStats()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // 整页固定为可视高度：内容区自己滚动，底部 Tab 永远不会盖住按钮
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <DesktopHeader path={path} />
      <div className="relative flex min-h-0 flex-1 flex-col">
      <PullIndicator {...ptr} />
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <main
        key={refreshKey}
        // 复习页锁定为一屏高：卡片内部滚动，评分按钮始终可见；其他页面正常整页滚动
        className={`mx-auto flex w-full max-w-[640px] flex-col ${path === '/' || pathIdOf(path) !== null ? 'h-full' : 'min-h-full'}`}
        style={ptr.pull ? { transform: `translateY(${ptr.pull * 0.6}px)` } : { transition: 'transform 0.2s' }}
      >
        <Suspense fallback={<div role="status" className="m-4 h-40 animate-shimmer rounded-2xl bg-surface" aria-label="正在加载页面" />}>
        {path === '/' && <Review />}
        {path === '/add' && <Add />}
        {path === '/library' && <Library />}
        {path === '/remix' && <Remix />}
        {path === '/weekly' && <Weekly />}
        {path === '/discover' && <Discover />}
        {path === '/level' && <Level />}
        {pathIdOf(path) !== null && <QuestPage id={pathIdOf(path)!} />}
        {path === '/settings' && <Settings />}
        {path === '/practice' && <Practice />}
        {lessonIdOf(path) !== null && <LessonPage id={lessonIdOf(path)!} />}
        {readerIdOf(path) !== null && <Reader kind="lesson" id={readerIdOf(path)!} />}
        {savedIdOf(path) !== null && <Reader kind="saved" id={savedIdOf(path)!} />}
        </Suspense>
      </main>
      </div>
      </div>
      {path !== '/remix' && path !== '/settings' && path !== '/discover' && path !== '/level' && lessonIdOf(path) === null && readerIdOf(path) === null && pathIdOf(path) === null && savedIdOf(path) === null && <MobileTabBar path={path} />}
      <Confirmer />
      <Toaster />
      <SpeechFallback />
    </div>
  )
}

/** 手机端：底部 Tab */
function MobileTabBar({ path }: { path: Path }) {
  return (
    <>
      <nav className="pb-safe grid shrink-0 grid-cols-4 border-t border-line bg-bg px-3 pt-1 md:hidden">
        {tabs.map((t) => {
          const on = path === t.to || (t.to === '/add' && path === '/discover') || (t.to === '/practice' && (lessonIdOf(path) !== null || readerIdOf(path) !== null || pathIdOf(path) !== null || savedIdOf(path) !== null))
          return (
            <Link
              key={t.to}
              to={t.to}
              aria-current={on ? 'page' : undefined}
              className={`flex h-12 flex-col items-center justify-center gap-0.5 text-[11px] no-underline ${
                on ? 'font-semibold text-ink' : 'text-muted'
              }`}
            >
              {t.icon}
              {t.label}
            </Link>
          )
        })}
      </nav>
    </>
  )
}

/** 电脑端：顶部分段导航 */
function DesktopHeader({ path }: { path: Path }) {
  const stats = useStats()
  return (
    <header className="z-40 hidden h-[72px] shrink-0 grid-cols-[minmax(0,1fr)_max-content_max-content] items-center gap-4 border-b border-line bg-bg/95 px-5 backdrop-blur md:grid xl:grid-cols-[minmax(0,1fr)_max-content_minmax(0,1fr)] xl:px-10">
      <Link to="/" className="shrink-0 whitespace-nowrap font-serif text-[22px] font-medium tracking-tight text-ink no-underline">
        拾句
      </Link>
      <nav className="flex gap-1 justify-self-center rounded-[14px] bg-line-soft p-1">
        {tabs.map((t) => {
          const on = path === t.to || (t.to === '/add' && path === '/discover') || (t.to === '/practice' && (lessonIdOf(path) !== null || readerIdOf(path) !== null || pathIdOf(path) !== null || savedIdOf(path) !== null))
          return (
            <Link
              key={t.to}
              to={t.to}
              aria-current={on ? 'page' : undefined}
              className={`flex h-9 shrink-0 items-center whitespace-nowrap rounded-[10px] px-3 text-sm no-underline xl:px-5 ${
                on ? 'bg-surface font-semibold text-ink shadow-sm' : 'text-muted-2'
              }`}
            >
              {t.label}
            </Link>
          )
        })}
      </nav>
      <div className="flex shrink-0 items-center gap-2 justify-self-end whitespace-nowrap">
        <Link
          to="/remix"
          title="用今天要复习的词，AI 现编几句新例句帮你巩固"
          className={`flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-line px-3.5 text-sm no-underline ${
            path === '/remix' ? 'bg-invert-bg text-invert-fg' : 'bg-surface text-ink'
          }`}
        >
          <IconSparkle size={16} />
          AI 重组
        </Link>
        <Link
          to="/settings"
          aria-label="设置"
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line ${
            path === '/settings' ? 'bg-invert-bg text-invert-fg' : 'bg-surface text-ink'
          }`}
        >
          <IconGear size={18} />
        </Link>
        <div
          className="flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-invert-bg px-4 text-sm text-invert-fg"
          title={stats?.due ? `今天有 ${stats.due} 张到期，分批复习，每批 20 张，做完一批就可以停` : undefined}
        >
          {stats && stats.due > 0 ? (
            <>
              <span className="opacity-70">{stats.due > 20 ? '先来 20 张' : `今日 ${stats.due} 张`}</span>
              <span className="tabular font-semibold">约 {Math.max(1, Math.round((Math.min(stats.due, 20) * 10) / 60))} 分钟</span>
            </>
          ) : (
            <>
              <span className="opacity-70">今日到期</span>
              <span className="tabular font-semibold">{stats?.due ?? '–'}</span>
            </>
          )}
        </div>
      </div>
    </header>
  )
}

