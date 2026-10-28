import { ArrowRight, ChevronRight, FolderPlus, Lock, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ConfirmDialog } from '../components/overlay'
import { MODE_ICON, ProjectCard } from '../components/project/ProjectBits'
import { Badge, Button, Card, Chip, EmptyState, buttonClass } from '../components/ui'
import { GENRES, MAX_GENRES, MODE_META } from '../domain/constants'
import { MASTER_FLOW } from '../domain/pipeline'
import type { ProjectMode } from '../domain/types'
import { SAMPLE_IDEAS } from '../services/ai'
import { useProjects } from '../store/projects'
import { toast } from '../store/toast'

const QUICK_GENRES = GENRES.slice(0, 9)

export default function Dashboard() {
  const navigate = useNavigate()
  const { projects, duplicateProject, deleteProject } = useProjects()
  const [idea, setIdea] = useState('')
  const [genres, setGenres] = useState<string[]>([])
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  const start = () => {
    const params = new URLSearchParams({ mode: 'original' })
    if (idea.trim()) params.set('idea', idea.trim())
    if (genres.length) params.set('genres', genres.join(','))
    navigate(`/projects/new?${params}`)
  }

  const toggleGenre = (g: string) =>
    setGenres((cur) => (cur.includes(g) ? cur.filter((x) => x !== g) : cur.length >= MAX_GENRES ? cur : [...cur, g]))

  const weekAgo = Date.now() - 7 * 86_400_000
  const stats = [
    { label: '全部项目', value: projects.length },
    { label: '创作中', value: projects.filter((p) => p.status === 'writing').length },
    { label: '本周新建', value: projects.filter((p) => new Date(p.createdAt).getTime() > weekAgo).length },
    { label: '规划总集数', value: projects.reduce((n, p) => n + p.spec.totalEpisodes, 0) },
  ]

  const recent = [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3)
  const target = projects.find((p) => p.id === pendingDelete)

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      {/* 一句话开始创作 */}
      <section className="relative overflow-hidden rounded-2xl border border-brand-100 bg-gradient-to-br from-white via-brand-50/70 to-brand-100/60 px-8 py-8">
        <div className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-brand-300/25 blur-3xl" />
        <div className="relative max-w-3xl">
          <Badge tone="violet">
            <Sparkles size={11} />
            出海短剧剧本 Agent
          </Badge>
          <h1 className="mt-3 text-[28px] font-semibold tracking-tight">写一句话，开始一部出海爆款短剧</h1>
          <p className="mt-1.5 text-sm text-ink-500">从灵感到 70 集可拍剧本：定核心设定 → 人物 → 情节大纲 → 逐集剧本 → 质检交付</p>

          <div className="mt-6 rounded-xl border border-line bg-white p-3 shadow-card focus-within:border-brand-400 focus-within:ring-3 focus-within:ring-brand-500/10">
            <textarea
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) start()
              }}
              rows={2}
              maxLength={200}
              placeholder="例：被丈夫和闺蜜联手害死的女主，重生回到婚礼前夜……"
              className="w-full resize-none bg-transparent px-1 text-[15px] leading-relaxed placeholder:text-ink-400 focus:outline-none"
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
                <span>试试：</span>
                {SAMPLE_IDEAS.slice(0, 2).map((s) => (
                  <button key={s} onClick={() => setIdea(s)} className="max-w-56 truncate rounded-md bg-canvas px-2 py-1 hover:bg-brand-50 hover:text-brand-700">
                    {s}
                  </button>
                ))}
              </div>
              <Button onClick={start} className="shrink-0">
                开始创作
                <ArrowRight size={15} />
              </Button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-ink-500">题材</span>
            {QUICK_GENRES.map((g) => (
              <Chip key={g} selected={genres.includes(g)} disabled={!genres.includes(g) && genres.length >= MAX_GENRES} onClick={() => toggleGenre(g)}>
                {g}
              </Chip>
            ))}
          </div>
        </div>
      </section>

      {/* 创作方式 */}
      <section className="mt-8 grid gap-4 md:grid-cols-3">
        {(Object.keys(MODE_META) as ProjectMode[]).map((mode) => {
          const meta = MODE_META[mode]
          const Icon = MODE_ICON[mode]
          const available = meta.phase === null
          return (
            <Link
              key={mode}
              to={available ? `/projects/new?mode=${mode}` : `/modules/${mode}`}
              className="group rounded-xl border border-line bg-white p-5 shadow-card transition hover:border-brand-200 hover:shadow-pop"
            >
              <div className="flex items-center justify-between">
                <div className="flex size-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                  <Icon size={19} />
                </div>
                <span className="flex gap-1">
                  {meta.primary && <Badge tone="violet">主流程</Badge>}
                  {available ? <Badge tone="green">可用</Badge> : <Badge tone="gray"><Lock size={10} />{meta.phase}</Badge>}
                </span>
              </div>
              <div className="mt-4 text-xs text-ink-500">{meta.entry}</div>
              <h3 className="mt-0.5 font-semibold">{meta.label}</h3>
              <p className="mt-1 text-[13px] leading-5 text-ink-500">{meta.desc}</p>
              <div className="mt-4 flex items-center gap-1 text-[13px] font-medium text-brand-600">
                {available ? '新建剧本' : '了解规划'}
                <ChevronRight size={14} className="transition group-hover:translate-x-0.5" />
              </div>
            </Link>
          )
        })}
      </section>

      {/* 数据概览 */}
      <section className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="px-5 py-4">
            <div className="text-[13px] text-ink-500">{s.label}</div>
            <div className="mt-1 text-2xl font-semibold">{s.value}</div>
          </Card>
        ))}
      </section>

      {/* 最近项目 */}
      <section className="mt-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">最近项目</h2>
          <Link to="/projects" className="flex items-center gap-0.5 text-[13px] font-medium text-brand-600 hover:text-brand-700">
            查看全部
            <ChevronRight size={14} />
          </Link>
        </div>
        {recent.length ? (
          <div className="grid gap-4 md:grid-cols-3">
            {recent.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                onDuplicate={() => {
                  duplicateProject(p.id)
                  toast('已复制项目')
                }}
                onDelete={() => setPendingDelete(p.id)}
              />
            ))}
          </div>
        ) : (
          <Card>
            <EmptyState
              icon={<FolderPlus size={22} />}
              title="还没有项目"
              desc="写一句灵感，或者直接新建一个项目开始。"
              action={
                <Link to="/projects/new" className={buttonClass()}>
                  新建剧本
                </Link>
              }
            />
          </Card>
        )}
      </section>

      {/* 生产流水线 */}
      <section className="mt-8">
        <h2 className="mb-4 text-base font-semibold">剧本生产流水线</h2>
        <Card className="overflow-x-auto p-5">
          <ol className="flex min-w-[860px] items-stretch">
            {MASTER_FLOW.map((step, i) => (
              <li key={step.label} className="flex flex-1 items-center">
                <div className="flex-1 rounded-lg bg-canvas px-3 py-2.5 text-center">
                  <div className="text-[11px] text-ink-400 tabular-nums">0{i + 1}</div>
                  <div className="text-[13px] font-medium">{step.label}</div>
                  <div className="mt-0.5 text-[11px] text-ink-500">{step.hint}</div>
                </div>
                {i < MASTER_FLOW.length - 1 && <ChevronRight size={14} className="mx-1 shrink-0 text-ink-300" />}
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-ink-500">数据回流的结论会反哺下一轮选题，形成闭环。</p>
        </Card>
      </section>

      <ConfirmDialog
        open={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) return
          deleteProject(pendingDelete)
          toast('项目已删除')
        }}
        danger
        title="删除项目？"
        desc={target ? `《${target.title}》及其全部设定将被删除，此操作无法撤销。` : undefined}
        confirmText="删除"
      />
    </div>
  )
}
