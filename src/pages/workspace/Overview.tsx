import clsx from 'clsx'
import { Check, Lock, Pencil } from 'lucide-react'
import { Link } from 'react-router'
import { Badge, Card, CardHeader, Segmented } from '../../components/ui'
import { MODE_META, STATUS_META } from '../../domain/constants'
import { MODE_STAGES, STAGES } from '../../domain/pipeline'
import { estimateChars } from '../../domain/rhythm'
import type { Project, ProjectStatus, StageKey } from '../../domain/types'
import { finalCount, stageState } from '../../domain/work'
import { audienceLabel, durationLabel, formatDateTime, languageLabel } from '../../lib/format'
import { useProjects } from '../../store/projects'
import { toast } from '../../store/toast'
import { useV2 } from '../../store/uiVersion'
import { ContinueWork, TodoCard } from '../../v2/OverviewBits'
import { useCurrentProject } from './ProjectLayout'

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4 py-2.5 text-[13px]">
      <dt className="w-20 shrink-0 text-ink-500">{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  )
}

/** 还没生成的字段：指向对应环节 */
function Missing({ to, children }: { to: StageKey; children: React.ReactNode }) {
  return (
    <Link to={`stage/${to}`} className="text-ink-400 hover:text-brand-600">
      {children} →
    </Link>
  )
}

/** 项目状态：放在创作进度卡的右上角，点选即保存，不走项目设置的保存流程；创作方式见页头标签 */
function StatusPicker({ project }: { project: Project }) {
  const updateProject = useProjects((s) => s.updateProject)
  const change = (status: ProjectStatus) => {
    if (status === project.status) return
    const label = STATUS_META[status].label
    updateProject(project.id, { status }, `项目状态改为「${label}」`)
    toast(`项目状态已改为「${label}」`)
  }

  return (
    <div className="flex items-center gap-2" data-status-card title="用于在项目列表中筛选；正式版会随环节推进自动流转">
      <span className="text-xs text-ink-400">项目状态</span>
      <Segmented
        value={project.status}
        onChange={change}
        options={(Object.keys(STATUS_META) as ProjectStatus[]).map((s) => ({ value: s, label: STATUS_META[s].label }))}
      />
    </div>
  )
}

export default function Overview() {
  const project = useCurrentProject()
  const v2 = useV2()
  const { spec, rhythm, work: w } = project
  const all = MODE_STAGES[project.mode]
  const stages = all.filter((k) => k !== 'overview')
  const state = (key: StageKey) => stageState(project, key)
  const nextKey = stages.find((k) => state(k) === 'active') ?? stages.find((k) => state(k) === 'todo')
  const next = nextKey && STAGES[nextKey]
  const arch = w.architecture
  const cast = w.characters.filter((c) => c.name.trim())

  return (
    <div className="space-y-6">
      {/* 流程进度 */}
      <Card>
        <CardHeader
          title="创作进度"
          desc={`${MODE_META[project.mode].label} · 共 ${all.length} 个环节 · 已定稿 ${finalCount(project)} / ${spec.totalEpisodes} 集`}
          action={<StatusPicker project={project} />}
        />
        <div className="overflow-x-auto px-5 py-5">
          <ol className="flex min-w-[640px] items-start">
            {all.map((key, i) => {
              const meta = STAGES[key]
              const s = state(key)
              return (
                <li key={key} className="relative flex flex-1 flex-col items-center text-center">
                  {i < all.length - 1 && <span className={clsx('absolute top-3.5 left-1/2 h-px w-full', s === 'done' ? 'bg-brand-300' : 'bg-line')} />}
                  <Link to={key === 'overview' ? '.' : `stage/${key}`} className="group relative z-10 flex flex-col items-center">
                    <span
                      className={clsx(
                        'flex size-7 items-center justify-center rounded-full text-xs font-semibold tabular-nums ring-4 ring-white transition-transform group-hover:scale-110',
                        s === 'done' && 'bg-brand-600 text-white',
                        s === 'active' && 'bg-brand-50 text-brand-700 outline-2 outline-brand-500',
                        (s === 'todo' || s === 'locked') && 'bg-canvas text-ink-400',
                      )}
                    >
                      {s === 'done' ? <Check size={14} strokeWidth={3} /> : s === 'locked' ? <Lock size={12} /> : i + 1}
                    </span>
                    <span className={clsx('mt-2 text-xs', s === 'done' || s === 'active' ? 'font-medium text-ink-900' : 'text-ink-500')}>{key === 'overview' ? '立项完成' : meta.label}</span>
                  </Link>
                </li>
              )
            })}
          </ol>
          {v2 ? (
            <ContinueWork project={project} />
          ) : (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-canvas px-4 py-3">
              {next ? (
                <>
                  <div className="text-[13px]">
                    <span className="text-ink-500">下一步：</span>
                    <span className="font-medium">{next.label}</span>
                    <span className="text-ink-500"> —— {next.summary.split(/[，；：]/)[0]}</span>
                  </div>
                  <Link to={`stage/${next.key}`} className="text-[13px] font-medium text-brand-600 hover:text-brand-700">
                    去{next.label} →
                  </Link>
                </>
              ) : (
                <div className="text-[13px] text-ink-700">当前开放的环节都已完成；质检交付将在后续版本开放。</div>
              )}
            </div>
          )}
        </div>
      </Card>

      {v2 && <TodoCard project={project} />}

      <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
        {/* 项目设定 */}
        <Card>
          <CardHeader
            title="项目设定"
            action={
              <Link to="settings" className="flex items-center gap-1 text-[13px] text-brand-600 hover:text-brand-700">
                <Pencil size={13} />
                编辑
              </Link>
            }
          />
          <dl className="divide-y divide-line px-5 py-1">
            <KV label="题材">
              <div className="flex flex-wrap gap-1">
                {project.genres.map((g) => (
                  <Badge key={g} tone="violet">
                    {g}
                  </Badge>
                ))}
              </div>
            </KV>
            <KV label="受众 / 基调">
              {audienceLabel(project.audience)}
              {project.tones.length > 0 && ` · ${project.tones.join(' / ')}`}
            </KV>
            <KV label="目标市场">{project.markets.join('、')}</KV>
            <KV label="发行平台">{project.platforms.join('、') || '—'}</KV>
            <KV label="剧本语言">{languageLabel(spec.language)}</KV>
            <KV label="单集">
              {durationLabel(spec.episodeSeconds)} · 约 {estimateChars(spec.episodeSeconds)} 字
            </KV>
            {project.benchmark && (
              <KV label="对标剧">
                {project.benchmark.title}
                <span className="text-ink-500">
                  {' '}
                  · {project.benchmark.platform}
                  {project.benchmark.episodes ? ` · ${project.benchmark.episodes} 集` : ''}
                </span>
              </KV>
            )}
          </dl>
        </Card>

        {/* 一页故事架构卡 */}
        <Card>
          <CardHeader
            title="故事架构卡"
            desc="编剧拿着这张卡，应该能一句话讲清：这是个什么故事、爽在哪、跟市面上的剧哪里不一样（闸门②）"
            action={arch?.status === 'approved' ? <Badge tone="green">已确认</Badge> : <Badge tone="gray">草稿</Badge>}
          />
          <dl className="divide-y divide-line px-5 py-1">
            <KV label="核心设定">{project.logline || <span className="text-ink-400">未填写，可在项目设置中补充</span>}</KV>
            <KV label="爽点公式">{arch?.formula.trim() || <Missing to="architecture">在故事架构中生成</Missing>}</KV>
            <KV label="人物">
              {cast.length ? (
                <>
                  {cast
                    .slice(0, 4)
                    .map((c) => `${c.name}（${c.role}）`)
                    .join('、')}
                  {cast.length > 4 && <span className="text-ink-500"> 等 {cast.length} 人</span>}
                </>
              ) : (
                <Missing to="characters">在人物设定中生成</Missing>
              )}
            </KV>
            <KV label="节奏">
              共 {spec.totalEpisodes} 集，首付费第 {rhythm.paywalls[0] ?? '—'} 集，反转在 {rhythm.twists.join(' / ') || '—'} 集
              <Link to="stage/architecture" className="ml-2 text-brand-600 hover:text-brand-700">
                在故事架构中调整
              </Link>
            </KV>
            <KV label="创新点">
              {arch?.innovations.length ? (
                <ul className="space-y-1">
                  {arch.innovations.slice(0, 3).map((n) => (
                    <li key={n.id}>
                      {n.theirs && <span className="text-ink-500">{n.theirs} → </span>}
                      {n.ours}
                    </li>
                  ))}
                </ul>
              ) : (
                <Missing to="architecture">{project.benchmark ? `对标《${project.benchmark.title}》，在故事架构中逐条列出` : '在故事架构中生成'}</Missing>
              )}
            </KV>
          </dl>
        </Card>
      </div>

      {/* 动态 */}
      <Card>
        <CardHeader title="项目动态" />
        <ol className="px-5 py-3">
          {[...project.activity].reverse().map((a, i) => (
            <li key={`${a.at}-${i}`} className="flex gap-3 py-2 text-[13px]">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-400" />
              <span className="flex-1">{a.text}</span>
              <span className="text-ink-400 tabular-nums">{formatDateTime(a.at)}</span>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  )
}
