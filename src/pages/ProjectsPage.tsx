import { FolderPlus, LayoutGrid, List, Plus, Search, SearchX } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { PageHeader } from '../components/layout/AppShell'
import { ConfirmDialog } from '../components/overlay'
import { ModeBadge, ProjectCard, ProjectCover, StatusBadge } from '../components/project/ProjectBits'
import { Badge, Button, Card, EmptyState, Segmented, buttonClass } from '../components/ui'
import { MODE_META, STATUS_META } from '../domain/constants'
import type { Project, ProjectMode, ProjectStatus } from '../domain/types'
import { timeAgo } from '../lib/format'
import { useProjects } from '../store/projects'
import { toast } from '../store/toast'
import { useV2 } from '../store/uiVersion'
import { CardProgress } from '../v2/CardProgress'

type SortKey = 'updated' | 'created' | 'title'

const selectClass =
  'h-9 rounded-lg border border-line bg-white px-2.5 text-[13px] text-ink-700 focus:border-brand-500 focus:outline-none'

function matches(p: Project, q: string) {
  const hay = [p.title, p.titleEn, p.logline, p.idea, ...p.genres].join(' ').toLowerCase()
  return hay.includes(q.toLowerCase())
}

export default function ProjectsPage() {
  const navigate = useNavigate()
  const v2 = useV2()
  const [params, setParams] = useSearchParams()
  const { projects, duplicateProject, deleteProject, restoreSamples } = useProjects()
  const [mode, setMode] = useState<ProjectMode | 'all'>('all')
  const [status, setStatus] = useState<ProjectStatus | 'all'>('all')
  const [sort, setSort] = useState<SortKey>('updated')
  const [layout, setLayout] = useState<'grid' | 'list'>('grid')
  const [pendingDelete, setPendingDelete] = useState<Project | null>(null)
  const q = params.get('q') ?? ''

  const visible = useMemo(() => {
    const list = projects.filter(
      (p) => (mode === 'all' || p.mode === mode) && (status === 'all' || p.status === status) && (!q || matches(p, q)),
    )
    return list.sort((a, b) =>
      sort === 'title' ? a.title.localeCompare(b.title, 'zh') : sort === 'created' ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt),
    )
  }, [projects, mode, status, q, sort])

  const setQuery = (value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set('q', value)
    else next.delete('q')
    setParams(next, { replace: true })
  }

  const actions = (p: Project) => ({
    onDuplicate: () => {
      duplicateProject(p.id)
      toast('已复制项目')
    },
    onDelete: () => setPendingDelete(p),
  })

  return (
    <div className="px-6 py-8 xl:px-8">
      <PageHeader
        title="我的剧本"
        desc={`共 ${projects.length} 个项目`}
        actions={
          <Link to="/projects/new" className={buttonClass()}>
            <Plus size={16} />
            新建剧本
          </Link>
        }
      />

      {projects.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FolderPlus size={22} />}
            title="还没有项目"
            desc="新建一个项目，从核心设定开始；也可以载入示例项目先看看效果。"
            action={
              <div className="flex gap-2">
                <Button variant="secondary" onClick={restoreSamples}>
                  载入示例项目
                </Button>
                <Link to="/projects/new" className={buttonClass()}>
                  新建剧本
                </Link>
              </div>
            }
          />
        </Card>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-400" />
              <input
                value={q}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索剧名、核心设定、题材"
                className="h-9 w-60 rounded-lg border border-line bg-white pr-3 pl-8 text-[13px] placeholder:text-ink-400 focus:border-brand-500 focus:outline-none"
              />
            </div>
            <select aria-label="创作方式" className={selectClass} value={mode} onChange={(e) => setMode(e.target.value as ProjectMode | 'all')}>
              <option value="all">全部方式</option>
              {(Object.keys(MODE_META) as ProjectMode[]).map((m) => (
                <option key={m} value={m}>
                  {MODE_META[m].label}
                </option>
              ))}
            </select>
            <select aria-label="状态" className={selectClass} value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus | 'all')}>
              <option value="all">全部状态</option>
              {(Object.keys(STATUS_META) as ProjectStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_META[s].label}
                </option>
              ))}
            </select>
            <select aria-label="排序" className={selectClass} value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="updated">最近更新</option>
              <option value="created">创建时间</option>
              <option value="title">剧名</option>
            </select>
            <div className="ml-auto">
              <Segmented
                value={layout}
                onChange={setLayout}
                options={[
                  { value: 'grid', label: <LayoutGrid size={15} aria-label="卡片视图" /> },
                  { value: 'list', label: <List size={15} aria-label="列表视图" /> },
                ]}
              />
            </div>
          </div>

          {visible.length === 0 ? (
            <Card>
              <EmptyState
                icon={<SearchX size={22} />}
                title="没有匹配的项目"
                desc="换个关键词或清除筛选条件试试。"
                action={
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setQuery('')
                      setMode('all')
                      setStatus('all')
                    }}
                  >
                    清除筛选
                  </Button>
                }
              />
            </Card>
          ) : layout === 'grid' ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-4">
              {visible.map((p) => (
                <ProjectCard key={p.id} project={p} {...actions(p)} footer={v2 && <CardProgress project={p} />} />
              ))}
            </div>
          ) : (
            <Card className="overflow-hidden">
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-line bg-canvas text-ink-500">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">项目</th>
                    <th className="px-4 py-2.5 font-medium">方式</th>
                    <th className="px-4 py-2.5 font-medium">题材</th>
                    <th className="px-4 py-2.5 text-right font-medium">集数</th>
                    <th className="px-4 py-2.5 font-medium">状态</th>
                    <th className="px-4 py-2.5 font-medium">更新</th>
                    <th className="w-24 px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((p) => (
                    <tr key={p.id} className="cursor-pointer border-t border-line first:border-t-0 hover:bg-canvas/60" onClick={() => navigate(`/projects/${p.id}`)}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <ProjectCover project={p} compact className="h-10 w-8 shrink-0 rounded-md" />
                          <div className="min-w-0">
                            <div className="truncate font-medium text-ink-900">{p.title}</div>
                            <div className="max-w-80 truncate text-xs text-ink-500">{p.logline || p.idea}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <ModeBadge mode={p.mode} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          {p.genres.slice(0, 2).map((g) => (
                            <Badge key={g} tone="violet">
                              {g}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{p.spec.totalEpisodes}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={p.status} />
                      </td>
                      <td className="px-4 py-3 text-ink-500">{timeAgo(p.updatedAt)}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          className="text-xs text-red-600 hover:underline"
                          onClick={(e) => {
                            e.stopPropagation()
                            setPendingDelete(p)
                          }}
                        >
                          删除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) return
          deleteProject(pendingDelete.id)
          toast('项目已删除')
        }}
        danger
        title="删除项目？"
        desc={pendingDelete ? `《${pendingDelete.title}》及其全部设定将被删除，此操作无法撤销。` : undefined}
        confirmText="删除"
      />
    </div>
  )
}
