import clsx from 'clsx'
import { Clapperboard, Copy, Film, MoreHorizontal, PenLine, Trash2, Video } from 'lucide-react'
import { useId } from 'react'
import { Link } from 'react-router'
import { MODE_META, PALETTES, STATUS_META } from '../../domain/constants'
import type { Project, ProjectMode } from '../../domain/types'
import { timeAgo } from '../../lib/format'
import { Menu } from '../overlay'
import { Badge } from '../ui'

export const MODE_ICON: Record<ProjectMode, typeof Film> = {
  original: PenLine,
  adaptation: Clapperboard,
  video: Video,
}

export function ProjectCover({
  project,
  className,
  compact,
}: {
  project: Pick<Project, 'palette' | 'titleEn' | 'mode'>
  className?: string
  /** 紧凑模式只保留色块与纹理，用于列表缩略图 */
  compact?: boolean
}) {
  const [from, to] = PALETTES[project.palette % PALETTES.length]
  const Icon = MODE_ICON[project.mode]
  const patternId = `film-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  return (
    <div className={clsx('relative overflow-hidden', className)} style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}>
      <svg className="absolute inset-0 h-full w-full opacity-[0.12]" aria-hidden>
        <defs>
          <pattern id={patternId} width="18" height="18" patternUnits="userSpaceOnUse">
            <rect x="2" y="2" width="6" height="9" rx="1.5" fill="white" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>
      {!compact && (
        <>
          <Icon className="absolute top-3 right-3 text-white/70" size={16} />
          <div className="absolute inset-x-0 bottom-0 p-3">
            <div className="line-clamp-1 text-[11px] font-medium tracking-wide text-white/75 uppercase">{project.titleEn || 'Untitled'}</div>
          </div>
        </>
      )}
    </div>
  )
}

export function StatusBadge({ status }: { status: Project['status'] }) {
  const meta = STATUS_META[status]
  return <Badge tone={meta.tone}>{meta.label}</Badge>
}

export function ModeBadge({ mode }: { mode: ProjectMode }) {
  const Icon = MODE_ICON[mode]
  return (
    <Badge tone="gray">
      <Icon size={11} />
      {MODE_META[mode].short}
    </Badge>
  )
}

export function ProjectCard({
  project,
  onDuplicate,
  onDelete,
}: {
  project: Project
  onDuplicate: () => void
  onDelete: () => void
}) {
  return (
    <Link
      to={`/projects/${project.id}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-line bg-white shadow-card transition hover:-translate-y-0.5 hover:shadow-pop"
    >
      <ProjectCover project={project} className="h-28" />
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-1 text-[15px] font-semibold text-ink-900 group-hover:text-brand-700">{project.title}</h3>
          <Menu
            trigger={(p) => (
              <button {...p} className="-mt-1 -mr-1.5 rounded-md p-1 text-ink-400 hover:bg-canvas hover:text-ink-700" aria-label="更多操作">
                <MoreHorizontal size={16} />
              </button>
            )}
            items={[
              { label: '复制项目', icon: <Copy size={14} />, onSelect: onDuplicate },
              { label: '删除项目', icon: <Trash2 size={14} />, danger: true, onSelect: onDelete },
            ]}
          />
        </div>
        <p className="mt-1 line-clamp-2 min-h-10 text-[13px] leading-5 text-ink-500">{project.logline || project.idea || '尚未填写核心设定'}</p>
        <div className="mt-3 flex flex-wrap gap-1">
          {project.genres.slice(0, 3).map((g) => (
            <Badge key={g} tone="violet">
              {g}
            </Badge>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-xs text-ink-500">
          <div className="flex items-center gap-1.5">
            <StatusBadge status={project.status} />
            <ModeBadge mode={project.mode} />
            {project.sample && <Badge tone="amber">示例</Badge>}
          </div>
          <span className="tabular-nums">
            {project.spec.totalEpisodes} 集 · {timeAgo(project.updatedAt)}
          </span>
        </div>
      </div>
    </Link>
  )
}
