import clsx from 'clsx'
import { ChevronLeft, Copy, Download, Lock, MoreHorizontal, Palette, Settings, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link, NavLink, Outlet, useNavigate, useOutletContext, useParams } from 'react-router'
import { ConfirmDialog, Menu } from '../../components/overlay'
import { ModeBadge, ProjectCover, StatusBadge } from '../../components/project/ProjectBits'
import { StatePanel } from '../../components/project/StatePanel'
import { Badge, EmptyState, buttonClass } from '../../components/ui'
import { PALETTES } from '../../domain/constants'
import { MODE_STAGES, STAGES } from '../../domain/pipeline'
import type { Project } from '../../domain/types'
import { downloadText } from '../../lib/download'
import { useDismiss } from '../../lib/useDismiss'
import { useProject, useProjects } from '../../store/projects'
import { toast } from '../../store/toast'
import { SearchX } from 'lucide-react'
import { ScriptTree } from './script/ScriptTree'

export const useCurrentProject = () => useOutletContext<Project>()

const exportJson = (project: Project) => downloadText(`${project.title || 'project'}.json`, JSON.stringify(project, null, 2), 'application/json')

/** 点击封面更换配色 */
function CoverPicker({ project }: { project: Project }) {
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
        <ProjectCover project={project} compact className="h-16 w-12 rounded-lg shadow-card" />
        <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-ink-900/30 text-white opacity-0 transition-opacity group-hover:opacity-100">
          <Palette size={16} />
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

  if (!project) {
    return (
      <div className="mx-auto max-w-6xl px-8 py-16">
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

  return (
    <div className="mx-auto max-w-7xl px-8 py-6">
      <Link to="/projects" className="mb-4 inline-flex items-center gap-0.5 text-[13px] text-ink-500 hover:text-ink-900">
        <ChevronLeft size={15} />
        我的剧本
      </Link>

      <header className="mb-6 flex flex-wrap items-center gap-4">
        <CoverPicker project={project} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-[22px] font-semibold tracking-tight">{project.title}</h1>
            <StatusBadge status={project.status} />
            <ModeBadge mode={project.mode} />
            {project.sample && <Badge tone="amber">示例</Badge>}
          </div>
          <p className="mt-0.5 truncate text-sm text-ink-500">{project.titleEn || project.logline}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="settings" className={buttonClass('secondary')}>
            <Settings size={15} />
            项目设置
          </Link>
          <Menu
            trigger={(p) => (
              <button {...p} className={buttonClass('secondary', 'md', 'px-2.5')} aria-label="更多操作">
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
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[232px_minmax(0,1fr)]">
        <nav className="scrollbar-thin lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
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
