import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, lessonIdOf, readerIdOf, savedIdOf, usePath, type Path } from './router'
import { refreshStats, useStats } from './store'
import { Toaster } from './components/ui'
import { PullIndicator, hasNewVersion, usePullToRefresh } from './components/PullToRefresh'
import { IconCards, IconGear, IconList, IconPen, IconPlusCircle, IconSparkle } from './components/icons'
import Review from './pages/Review'
import Add from './pages/Add'
import Library from './pages/Library'
import Remix from './pages/Remix'
import Settings from './pages/Settings'
import Practice from './pages/Practice'
import LessonPage from './pages/Lesson'
import Reader from './pages/Reader'

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
      await refreshStats()
      setRefreshKey((k) => k + 1)
    },
    path !== '/add' && lessonIdOf(path) === null && readerIdOf(path) === null && savedIdOf(path) === null, // 有输入框或需要选中文字的页面不启用
  )
  useEffect(() => {
    refreshStats()
    scroller.current?.scrollTo(0, 0)
  }, [path])

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
        className={`mx-auto flex w-full max-w-[640px] flex-col ${path === '/' ? 'h-full' : 'min-h-full'}`}
        style={ptr.pull ? { transform: `translateY(${ptr.pull * 0.6}px)` } : { transition: 'transform 0.2s' }}
      >
        {path === '/' && <Review />}
        {path === '/add' && <Add />}
        {path === '/library' && <Library />}
        {path === '/remix' && <Remix />}
        {path === '/settings' && <Settings />}
        {path === '/practice' && <Practice />}
        {lessonIdOf(path) !== null && <LessonPage id={lessonIdOf(path)!} />}
        {readerIdOf(path) !== null && <Reader kind="lesson" id={readerIdOf(path)!} />}
        {savedIdOf(path) !== null && <Reader kind="saved" id={savedIdOf(path)!} />}
      </main>
      </div>
      </div>
      {path !== '/remix' && path !== '/settings' && lessonIdOf(path) === null && readerIdOf(path) === null && savedIdOf(path) === null && <MobileTabBar path={path} />}
      <Toaster />
    </div>
  )
}

/** 手机端：底部 Tab */
function MobileTabBar({ path }: { path: Path }) {
  return (
    <>
      <nav className="pb-safe grid shrink-0 grid-cols-4 border-t border-line bg-bg px-3 pt-1 md:hidden">
        {tabs.map((t) => {
          const on = path === t.to || (t.to === '/practice' && (lessonIdOf(path) !== null || readerIdOf(path) !== null || savedIdOf(path) !== null))
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
    <header className="z-40 hidden h-[72px] shrink-0 grid-cols-3 items-center border-b border-line bg-bg/95 px-10 backdrop-blur md:grid">
      <Link to="/" className="font-serif text-[22px] font-medium tracking-tight text-ink no-underline">
        拾句
      </Link>
      <nav className="flex gap-1 justify-self-center rounded-[14px] bg-line-soft p-1">
        {tabs.map((t) => {
          const on = path === t.to || (t.to === '/practice' && (lessonIdOf(path) !== null || readerIdOf(path) !== null || savedIdOf(path) !== null))
          return (
            <Link
              key={t.to}
              to={t.to}
              aria-current={on ? 'page' : undefined}
              className={`flex h-9 items-center rounded-[10px] px-5 text-sm no-underline ${
                on ? 'bg-surface font-semibold text-ink shadow-sm' : 'text-muted-2'
              }`}
            >
              {t.label}
            </Link>
          )
        })}
      </nav>
      <div className="flex items-center gap-2 justify-self-end">
        <Link
          to="/remix"
          className={`flex h-10 items-center gap-1.5 rounded-full border border-line px-3.5 text-sm no-underline ${
            path === '/remix' ? 'bg-invert-bg text-invert-fg' : 'bg-surface text-ink'
          }`}
        >
          <IconSparkle size={16} />
          AI 重组
        </Link>
        <Link
          to="/settings"
          aria-label="设置"
          className={`flex h-10 w-10 items-center justify-center rounded-full border border-line ${
            path === '/settings' ? 'bg-invert-bg text-invert-fg' : 'bg-surface text-ink'
          }`}
        >
          <IconGear size={18} />
        </Link>
        <div className="flex h-10 items-center gap-1.5 rounded-full bg-invert-bg px-4 text-sm text-invert-fg">
          <span className="opacity-70">今日到期</span>
          <span className="tabular font-semibold">{stats?.due ?? '–'}</span>
        </div>
      </div>
    </header>
  )
}
