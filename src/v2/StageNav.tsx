import clsx from 'clsx'
import { Check, LayoutDashboard, Lock, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import type { CSSProperties } from 'react'
import { NavLink } from 'react-router'
import { MODE_STAGES, STAGES } from '../domain/pipeline'
import type { Project, StageKey } from '../domain/types'
import { stageGate, stageState } from '../domain/work'
import { ScriptTree } from '../pages/workspace/script/ScriptTree'
import { projectProgress, stageDetail } from './flow'
import { useNavFold } from './navFold'

function StageIcon({ project, stage, index }: { project: Project; stage: StageKey; index: number }) {
  if (stage === 'overview') return <LayoutDashboard size={14} className="text-ink-400" />
  const state = stageState(project, stage)
  if (state === 'done') {
    return (
      <span className="flex size-4 items-center justify-center rounded-full bg-emerald-500 text-white" aria-label="已完成">
        <Check size={10} strokeWidth={3} />
      </span>
    )
  }
  if (state === 'locked') return <Lock size={12} className="mx-0.5 text-ink-300" aria-label="未开放" />
  const gate = stageGate(project, stage)
  if (gate) return <Lock size={12} className="mx-0.5 text-amber-500" aria-label={gate.reason} />
  return (
    <span
      aria-label={state === 'active' ? '进行中' : '未开始'}
      className={clsx(
        'flex size-4 items-center justify-center rounded-full border text-[9px] tabular-nums',
        state === 'active' ? 'border-brand-500 bg-brand-50 font-semibold text-brand-700' : 'border-ink-300 text-ink-400',
      )}
    >
      {index + 1}
    </span>
  )
}

/** 版本二的创作流程导航：白底面板，每个环节带状态与进度摘要，被拦住的环节悬停可见原因；可收起成一列图标 */
export function StageNav({ project }: { project: Project }) {
  const stages = MODE_STAGES[project.mode]
  const progress = projectProgress(project)
  const { collapsed, toggle } = useNavFold()
  const pct = `${(progress.done / Math.max(1, progress.stages)) * 100}%`

  return (
    <nav
      data-collapsed={collapsed || undefined}
      className="scrollbar-thin rounded-xl border border-line bg-white p-2 shadow-card lg:sticky lg:top-4 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto"
      aria-label="创作流程"
      // 草稿箱 / 正文章节树在白底上改用浅灰悬停、浅蓝选中
      style={{ '--tree-hover': 'var(--color-canvas)', '--tree-active': 'var(--color-brand-50)' } as CSSProperties}
    >
      {collapsed ? (
        <div className="mb-2 flex flex-col items-center gap-1.5 border-b border-line pb-2">
          <button type="button" onClick={toggle} aria-label="展开创作流程" title="展开创作流程" className="rounded-md p-1.5 text-ink-500 hover:bg-canvas hover:text-ink-900">
            <PanelLeftOpen size={16} />
          </button>
          <span className="text-[10px] text-ink-500 tabular-nums" title={`${progress.done}/${progress.stages} 环节完成`}>
            {progress.done}/{progress.stages}
          </span>
        </div>
      ) : (
        <div className="mb-2 border-b border-line px-1 pb-2.5">
          <div className="mb-2 flex items-center justify-between gap-2 pl-1.5">
            <span className="text-[13px] font-semibold text-ink-900">创作流程</span>
            <span className="flex items-center gap-1">
              <span className="text-[11px] text-ink-500 tabular-nums">
                {progress.done}/{progress.stages} 环节完成
              </span>
              <button type="button" onClick={toggle} aria-label="收起创作流程" title="收起创作流程" className="rounded-md p-1 text-ink-400 hover:bg-canvas hover:text-ink-900">
                <PanelLeftClose size={15} />
              </button>
            </span>
          </div>
          <div className="mx-1.5 h-1 overflow-hidden rounded-full bg-ink-900/[0.06]">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: pct }} />
          </div>
        </div>
      )}
      <ol className="space-y-0.5">
        {stages.map((key, i) => {
          const meta = STAGES[key]
          const detail = stageDetail(project, key)
          const gate = key === 'overview' ? null : stageGate(project, key)
          return (
            <li key={key}>
              <NavLink
                to={key === 'overview' ? '.' : `stage/${key}`}
                end={key !== 'script'}
                title={collapsed ? [meta.label, detail, gate?.reason].filter(Boolean).join(' · ') : gate?.reason}
                aria-label={collapsed ? meta.label : undefined}
                className={({ isActive }) =>
                  clsx(
                    'flex h-9 items-center rounded-lg text-[13px] transition-colors',
                    collapsed ? 'justify-center' : 'gap-2.5 px-2.5',
                    isActive ? 'bg-brand-50 font-medium text-brand-700' : 'text-ink-700 hover:bg-canvas',
                  )
                }
              >
                <span className="flex w-4 shrink-0 justify-center">
                  <StageIcon project={project} stage={key} index={i} />
                </span>
                {!collapsed && (
                  <>
                    <span className="flex-1 truncate">{meta.label}</span>
                    {detail && <span className="shrink-0 text-[11px] font-normal text-ink-400 tabular-nums">{detail}</span>}
                  </>
                )}
              </NavLink>
              {!collapsed && key === 'script' && (project.work.drafts.length > 0 || project.work.scripts.length > 0) && <ScriptTree project={project} />}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
