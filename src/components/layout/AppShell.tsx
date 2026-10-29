import clsx from 'clsx'
import {
  Bell,
  Clapperboard,
  FolderKanban,
  HelpCircle,
  LayoutDashboard,
  PenLine,
  Plus,
  Radar,
  Search,
  ShieldCheck,
  Video,
} from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router'
import { VersionBar } from '../../v2/VersionBar'
import { buttonClass } from '../ui'

interface NavItem {
  to: string
  label: string
  icon: typeof PenLine
  tag?: string
  end?: boolean
}

const NAV: { title?: string; items: NavItem[] }[] = [
  {
    items: [
      { to: '/', label: '工作台', icon: LayoutDashboard, end: true },
      { to: '/projects', label: '我的剧本', icon: FolderKanban },
    ],
  },
  {
    title: '创作',
    items: [
      { to: '/projects/new?mode=original', label: '原创剧本', icon: PenLine },
      { to: '/modules/adaptation', label: '对标剧仿写', icon: Clapperboard },
      { to: '/modules/video', label: '视频转剧本', icon: Video },
    ],
  },
  {
    title: '工具',
    items: [
      { to: '/modules/radar', label: '选题雷达', icon: Radar, tag: '规划' },
      { to: '/modules/qa', label: '质检交付', icon: ShieldCheck },
    ],
  },
]

/** 全局侧边栏：按评审意见暂不显示，首页直接是「我的剧本」；需要时把 SHOW_SIDEBAR 改回 true */
const SHOW_SIDEBAR = false

function Sidebar() {
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-white">
      <Link to="/" className="flex h-16 items-center gap-2.5 px-5">
        <img src="/logo.svg" alt="" className="size-8" />
        <div className="leading-tight">
          <div className="text-[15px] font-semibold tracking-tight">智影魔方</div>
          <div className="text-[11px] text-ink-500">剧本 Agent</div>
        </div>
      </Link>

      <nav className="scrollbar-thin flex-1 space-y-5 overflow-y-auto px-3 py-3">
        {NAV.map((group, gi) => (
          <div key={gi}>
            {group.title && <div className="mb-1.5 px-2.5 text-[11px] font-medium tracking-wider text-ink-400">{group.title}</div>}
            <ul className="space-y-0.5">
              {group.items.map(({ to, label, icon: Icon, tag, end }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    end={end}
                    className={({ isActive }) =>
                      clsx(
                        'flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors',
                        isActive && !to.includes('?') ? 'bg-brand-50 font-medium text-brand-700' : 'text-ink-700 hover:bg-canvas',
                      )
                    }
                  >
                    <Icon size={17} strokeWidth={1.8} />
                    <span className="flex-1">{label}</span>
                    {tag && <span className="rounded bg-ink-900/[0.05] px-1.5 text-[10px] leading-4 text-ink-500">{tag}</span>}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="m-3 rounded-xl border border-dashed border-brand-200 bg-brand-50/60 p-3">
        <div className="text-[13px] font-medium text-brand-800">演示版本 · 三期</div>
        <p className="mt-1 text-xs leading-5 text-ink-500">数据保存在当前浏览器；AI 结果为本地模拟，接入模型后替换。</p>
      </div>

      <div className="flex items-center gap-2.5 border-t border-line px-4 py-3">
        <div className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-700 text-xs font-semibold text-white">编</div>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[13px] font-medium">编剧工作室</div>
          <div className="truncate text-[11px] text-ink-500">团队版 · 3 席</div>
        </div>
      </div>
    </aside>
  )
}

function Topbar() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  return (
    <header className="flex h-16 shrink-0 items-center gap-6 border-b border-line bg-white/80 px-6 backdrop-blur xl:px-8">
      {!SHOW_SIDEBAR && (
        <Link to="/projects" className="flex shrink-0 items-center gap-2.5" aria-label="我的剧本">
          <img src="/logo.svg" alt="" className="size-8" />
          <div className="leading-tight">
            <div className="text-[15px] font-semibold tracking-tight">智影魔方</div>
            <div className="text-[11px] text-ink-500">剧本 Agent</div>
          </div>
        </Link>
      )}
      <form
        className="relative w-full max-w-sm"
        onSubmit={(e) => {
          e.preventDefault()
          navigate(`/projects${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`)
        }}
      >
        <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索项目、剧名、题材…"
          className="h-9 w-full rounded-lg border border-transparent bg-canvas pr-3 pl-9 text-sm placeholder:text-ink-400 focus:border-brand-500 focus:bg-white focus:outline-none"
        />
      </form>
      <div className="ml-auto flex items-center gap-1">
        <button className="rounded-lg p-2 text-ink-500 hover:bg-canvas hover:text-ink-900" aria-label="帮助">
          <HelpCircle size={18} />
        </button>
        <button className="relative rounded-lg p-2 text-ink-500 hover:bg-canvas hover:text-ink-900" aria-label="通知">
          <Bell size={18} />
          <span className="absolute top-2 right-2 size-1.5 rounded-full bg-red-500" />
        </button>
        <Link to="/projects/new" className={buttonClass('primary', 'md', 'ml-2')}>
          <Plus size={16} />
          新建剧本
        </Link>
      </div>
    </header>
  )
}

export function AppShell() {
  return (
    <div className="flex h-full">
      {SHOW_SIDEBAR && <Sidebar />}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="scrollbar-thin flex-1 overflow-y-auto">
          <Outlet />
        </main>
        <VersionBar />
      </div>
    </div>
  )
}

export function PageHeader({ title, desc, actions, back }: { title: ReactNode; desc?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {back}
        <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
        {desc && <p className="mt-1 text-sm text-ink-500">{desc}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
