import { useEffect, type ReactNode } from 'react'
import { Link, usePath, type Path } from './router'
import { refreshStats, useStats } from './store'
import { Toaster } from './components/ui'
import { IconCards, IconList, IconPlusCircle, IconSparkle } from './components/icons'
import Review from './pages/Review'
import Add from './pages/Add'
import Library from './pages/Library'
import Remix from './pages/Remix'

const tabs: { to: Path; label: string; icon: ReactNode }[] = [
  { to: '/', label: '复习', icon: <IconCards size={24} /> },
  { to: '/add', label: '添加', icon: <IconPlusCircle size={24} /> },
  { to: '/library', label: '词库', icon: <IconList size={24} /> },
]

export default function App() {
  const path = usePath()
  useEffect(() => {
    refreshStats()
  }, [path])

  return (
    <div className="flex min-h-full flex-col">
      <DesktopHeader path={path} />
      <main className="mx-auto flex w-full max-w-[640px] flex-1 flex-col">
        {path === '/' && <Review />}
        {path === '/add' && <Add />}
        {path === '/library' && <Library />}
        {path === '/remix' && <Remix />}
      </main>
      {path !== '/remix' && <MobileTabBar path={path} />}
      <Toaster />
    </div>
  )
}

/** 手机端：底部 Tab */
function MobileTabBar({ path }: { path: Path }) {
  return (
    <>
      {/* 占位，避免内容被固定的 Tab 挡住 */}
      <div className="h-[calc(68px+max(env(safe-area-inset-bottom),12px))] md:hidden" />
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t border-line bg-bg/95 px-8 pt-2 backdrop-blur md:hidden">
        {tabs.map((t) => {
          const on = path === t.to
          return (
            <Link
              key={t.to}
              to={t.to}
              aria-current={on ? 'page' : undefined}
              className={`flex h-[52px] flex-col items-center justify-center gap-1 text-[11px] no-underline ${
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
    <header className="sticky top-0 z-40 hidden h-[72px] shrink-0 grid-cols-3 items-center border-b border-line bg-bg/95 px-10 backdrop-blur md:grid">
      <Link to="/" className="font-serif text-[22px] font-medium tracking-tight text-ink no-underline">
        词句卡
      </Link>
      <nav className="flex gap-1 justify-self-center rounded-[14px] bg-line-soft p-1">
        {tabs.map((t) => {
          const on = path === t.to
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
        <div className="flex h-10 items-center gap-1.5 rounded-full bg-invert-bg px-4 text-sm text-invert-fg">
          <span className="opacity-70">今日到期</span>
          <span className="tabular font-semibold">{stats?.due ?? '–'}</span>
        </div>
      </div>
    </header>
  )
}
