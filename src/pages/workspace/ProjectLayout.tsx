import clsx from 'clsx'
import { ChevronLeft, CloudCheck, Copy, Download, Lock, MoreHorizontal, Palette, Settings, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useMatch, useNavigate, useOutletContext, useParams } from 'react-router'
import { ConfirmDialog, Menu } from '../../components/overlay'
import { ProjectModels } from '../../components/project/ModelBits'
import { ModeBadge, ProjectCover, StatusBadge } from '../../components/project/ProjectBits'
import { StatePanel } from '../../components/project/StatePanel'
import { Badge, EmptyState, buttonClass } from '../../components/ui'
import { MODE_META, PALETTES } from '../../domain/constants'
import { MODE_STAGES, STAGES } from '../../domain/pipeline'
import type { Project } from '../../domain/types'
import { downloadText } from '../../lib/download'
import { formatDateTime } from '../../lib/format'
import { useDismiss } from '../../lib/useDismiss'
import { useProject, useProjects } from '../../store/projects'
import { toast } from '../../store/toast'
import { useStatePanel } from '../../store/statePanel'
import { useV2 } from '../../store/uiVersion'
import { StageNav } from '../../v2/StageNav'
import { useNavFold } from '../../v2/navFold'
import { SearchX } from 'lucide-react'
import { ScriptTree } from './script/ScriptTree'

export const useCurrentProject = () => useOutletContext<Project>()

const exportJson = (project: Project) => downloadText(`${project.title || 'project'}.json`, JSON.stringify(project, null, 2), 'application/json')

/** 点击封面更换配色；small：环节页的单行页头里用小封面 */
function CoverPicker({ project, small }: { project: Project; small?: boolean }) {
  const updateProject = useProjects((s) => s.updateProject)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, open, setOpen)

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="更换封面配色"
        title="更换封面配色"
        className="group relative block rounded-lg"
      >
        <ProjectCover project={project} compact className={clsx('rounded-lg shadow-card', small ? 'h-9 w-7 rounded-md' : 'h-16 w-12')} />
        <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-ink-900/30 text-white opacity-0 transition-opacity group-hover:opacity-100">
          <Palette size={small ? 12 : 16} />
        </span>
      </button>
      {open && (
        <div className="absolute top-full left-0 z-30 mt-2 animate-fade-in rounded-lg border border-line bg-white p-3 shadow-pop">
          <div className="mb-2 text-xs text-ink-500">封面配色</div>
          <div className="flex gap-2">
            {PALETTES.map(([from, to], i) => (
              <button
                key={from}
                type="button"
                onClick={() => updateProject(project.id, { palette: i })}
                aria-label={`封面配色 ${i + 1}`}
                aria-pressed={project.palette === i}
                className={clsx('size-6 rounded-full ring-offset-2 transition', project.palette === i ? 'ring-2 ring-brand-500' : 'hover:scale-110')}
                style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function ProjectLayout() {
  const { id } = useParams()
  const project = useProject(id)
  const navigate = useNavigate()
  const { duplicateProject, deleteProject } = useProjects()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const v2 = useV2()
  // 状态库侧栏展开时，宽屏上给它让出位置，不压住页面右侧
  const docked = useStatePanel((s) => s.open && !!s.focus)
  const navCollapsed = useNavFold((s) => s.collapsed)
  // 概览是项目首页，页头完整展示；进了具体环节只留一行，把高度让给正文
  const isOverview = !!useMatch('/projects/:id')
  // 环节页的页头吸顶（随时能换模型）；量出高度写进 --stick，页面里其他吸顶块据此让位
  const rootRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const root = rootRef.current
    const head = headRef.current
    if (!root) return
    if (!head) {
      root.style.removeProperty('--stick')
      return
    }
    const sync = () => root.style.setProperty('--stick', `${head.offsetHeight}px`)
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(head)
    return () => ro.disconnect()
  }, [isOverview, !!project])

  if (!project) {
    return (
      <div className="px-6 py-16 xl:px-8">
        <EmptyState
          icon={<SearchX size={22} />}
          title="项目不存在"
          desc="它可能已被删除，或链接有误。"
          action={
            <Link to="/projects" className={buttonClass()}>
              返回剧本列表
            </Link>
          }
        />
      </div>
    )
  }

  const stages = MODE_STAGES[project.mode]

  const badges = (
    <>
      <StatusBadge status={project.status} />
      <span className="inline-flex" title={`创作方式：${MODE_META[project.mode].label}（创建后不可更改）`}>
        <ModeBadge mode={project.mode} />
      </span>
      {project.sample && <Badge tone="amber">示例</Badge>}
    </>
  )
  const actions = (
    <div className="flex items-center gap-2">
      {v2 && (
        <span className="mr-1 flex items-center gap-1 text-xs text-ink-400" title="项目数据自动保存在当前浏览器">
          <CloudCheck size={14} className="text-emerald-500" />
          已自动保存 · {formatDateTime(project.updatedAt)}
        </span>
      )}
      {/* 模型是整个项目的选择，各环节都在页头看得到、随时可换 */}
      <ProjectModels project={project} size={isOverview ? 'md' : 'sm'} />
      <Link to="settings" className={buttonClass('secondary', isOverview ? 'md' : 'sm')}>
        <Settings size={isOverview ? 15 : 14} />
        项目设置
      </Link>
      <Menu
        trigger={(p) => (
          <button {...p} className={isOverview ? buttonClass('secondary', 'md', 'px-2.5') : buttonClass('secondary', 'sm')} aria-label="更多操作">
            <MoreHorizontal size={16} />
          </button>
        )}
        items={[
          {
            label: '复制项目',
            icon: <Copy size={14} />,
            onSelect: () => {
              const copy = duplicateProject(project.id)
              if (copy) {
                toast('已复制项目')
                navigate(`/projects/${copy.id}`)
              }
            },
          },
          { label: '导出 JSON', icon: <Download size={14} />, onSelect: () => exportJson(project) },
          { label: '删除项目', icon: <Trash2 size={14} />, danger: true, onSelect: () => setConfirmDelete(true) },
        ]}
      />
    </div>
  )

  return (
    <div ref={rootRef} className={clsx('px-6 py-6 xl:px-8', docked && 'xl:pr-[404px]')}>
      {isOverview ? (
        <>
          <Link to="/projects" className="mb-4 inline-flex items-center gap-0.5 text-[13px] text-ink-500 hover:text-ink-900">
            <ChevronLeft size={15} />
            我的剧本
          </Link>
          {/* 叠在页面内容之上：模型菜单不被下面的卡片盖住 */}
          <header className="relative z-[45] mb-6 flex flex-wrap items-center gap-4">
            <CoverPicker project={project} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-[22px] font-semibold tracking-tight">{project.title}</h1>
                {badges}
              </div>
              <p className="mt-0.5 truncate text-sm text-ink-500">{project.titleEn || project.logline}</p>
            </div>
            {actions}
          </header>
        </>
      ) : (
        <header
          ref={headRef}
          data-project-head
          className={clsx(
            'sticky top-0 z-[45] -mx-6 -mt-3 mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 bg-canvas/90 px-6 py-3 backdrop-blur xl:-mx-8 xl:px-8',
            docked && 'xl:mr-0 xl:pr-0',
          )}
        >
          <Link to="/projects" className="inline-flex shrink-0 items-center gap-0.5 text-[13px] text-ink-500 hover:text-ink-900">
            <ChevronLeft size={15} />
            我的剧本
          </Link>
          <span className="text-ink-300">/</span>
          <CoverPicker project={project} small />
          <Link to="." className="min-w-0 truncate hover:text-brand-700" title="项目概览">
            <h1 className="truncate text-base font-semibold tracking-tight">{project.title}</h1>
          </Link>
          {badges}
          <span className="flex-1" />
          {actions}
        </header>
      )}

      <div className={clsx('grid items-start gap-6', v2 && navCollapsed ? 'lg:grid-cols-[52px_minmax(0,1fr)]' : v2 ? 'lg:grid-cols-[248px_minmax(0,1fr)]' : 'lg:grid-cols-[232px_minmax(0,1fr)]')}>
        {v2 ? (
          <StageNav project={project} />
        ) : (
          <nav data-stage-nav className="scrollbar-thin lg:sticky lg:top-stick lg:max-h-stick lg:overflow-y-auto">
            <div className="mb-2 px-2.5 text-[11px] font-medium tracking-wider text-ink-400">创作流程</div>
            <ol className="space-y-0.5">
              {stages.map((key, i) => {
                const meta = STAGES[key]
                return (
                  <li key={key}>
                    <NavLink
                      to={key === 'overview' ? '.' : `stage/${key}`}
                      end={key !== 'script'}
                      className={({ isActive }) =>
                        clsx(
                          'flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors',
                          isActive ? 'bg-white font-medium text-brand-700 shadow-card' : 'text-ink-700 hover:bg-white/70',
                        )
                      }
                    >
                      <span className="w-4 text-center text-[11px] text-ink-400 tabular-nums">{i + 1}</span>
                      <span className="flex-1 truncate">{meta.label}</span>
                      {meta.phase && <Lock size={12} className="text-ink-300" />}
                    </NavLink>
                    {key === 'script' && (project.work.drafts.length > 0 || project.work.scripts.length > 0) && <ScriptTree project={project} />}
                  </li>
                )
              })}
            </ol>
          </nav>
        )}

        <div className="min-w-0">
          <Outlet context={project} />
        </div>
      </div>

      <StatePanel project={project} />

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          deleteProject(project.id)
          toast('项目已删除')
          navigate('/projects', { replace: true })
        }}
        danger
        title="删除项目？"
        desc={`《${project.title}》及其全部设定将被删除，此操作无法撤销。`}
        confirmText="删除"
      />
    </div>
  )
}
