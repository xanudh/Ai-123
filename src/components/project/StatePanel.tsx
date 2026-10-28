import clsx from 'clsx'
import { AlertTriangle, ChevronLeft, ChevronRight, ChevronsRight, Database, ExternalLink, Flag, Link2, MapPin, ScrollText, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { episodeSnapshot, overallSnapshot, phaseSnapshot } from '../../domain/snapshot'
import type { CastEntry, ForeshadowAt, StateFocus } from '../../domain/snapshot'
import type { Project } from '../../domain/types'
import { foreshadowName, phaseOf, projectPhases, rangeLabel } from '../../domain/work'
import type { ForeshadowStatus } from '../../domain/work'
import { useStatePanel } from '../../store/statePanel'
import { CheckList } from '../stage/StageKit'
import { Badge, Segmented } from '../ui'

type Tab = 'ep' | 'phase' | 'all'

const STATUS_TONE: Record<ForeshadowStatus, 'gray' | 'amber' | 'green'> = { 已计划: 'gray', 已埋设: 'amber', 已回收: 'green' }
const ROLE_TONE = (role: string | null) => (role === '主角' ? 'violet' : role === '反派' ? 'red' : role ? 'gray' : 'amber')
const NODE_TONE: Record<string, 'violet' | 'orange' | 'green' | 'gray'> = { 开场钩子: 'violet', 首付费: 'orange', 付费卡点: 'orange', 大反转: 'green', 结局高潮: 'gray' }

function Section({ icon, title, count, children }: { icon: ReactNode; title: string; count?: number; children: ReactNode }) {
  return (
    <section className="border-t border-line px-4 py-3">
      <h4 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-ink-900">
        <span className="text-ink-400">{icon}</span>
        {title}
        {count !== undefined && <span className="font-normal text-ink-400 tabular-nums">{count}</span>}
      </h4>
      {children}
    </section>
  )
}

const Empty = ({ children }: { children: ReactNode }) => <p className="text-xs text-ink-400">{children}</p>

function CastList({ cast, phase }: { cast: CastEntry[]; phase?: boolean }) {
  if (!cast.length) return <Empty>{phase ? '本段还没有出场人物' : '本集还没有可识别的出场人物'}</Empty>
  return (
    <ul className="space-y-2">
      {cast.map((c) => (
        <li key={c.name} className="text-[12.5px] leading-5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium text-ink-900">{c.name}</span>
            <Badge tone={ROLE_TONE(c.role)}>{c.role ?? '未登记'}</Badge>
            {c.first && <Badge tone="violet">{phase ? '本段首次出场' : '首次出场'}</Badge>}
            {c.changed && <Badge tone="amber">{phase ? '本段有变化' : '本集有变化'}</Badge>}
            {phase && <span className="ml-auto text-xs text-ink-400 tabular-nums">{c.episodes ? `出场 ${c.episodes} 集` : '集纲提到'}</span>}
          </div>
          <p className="mt-0.5 text-ink-700">
            {c.state || <span className="text-ink-300">还没有状态记录</span>}
            {c.state && c.stateEp !== null && <span className="ml-1.5 text-[11px] text-ink-400 tabular-nums">第 {c.stateEp} 集后</span>}
          </p>
        </li>
      ))}
    </ul>
  )
}

function ForeshadowList({ list, empty }: { list: ForeshadowAt[]; empty: string }) {
  if (!list.length) return <Empty>{empty}</Empty>
  return (
    <ul className="space-y-2">
      {list.map((f) => (
        <li key={f.item.id} className="text-[12.5px] leading-5">
          <div className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate font-medium text-ink-900" title={foreshadowName(f.item)}>
              {foreshadowName(f.item) || '未命名计划'}
            </span>
            <Badge tone={STATUS_TONE[f.status]}>{f.status}</Badge>
          </div>
          <p className="text-xs text-ink-400 tabular-nums">
            {f.item.type} · 计划第 {f.item.plantEp} → {f.item.payoffEp} 集
            {f.plantedIn !== null && ` · 实际第 ${f.plantedIn}${f.paidIn !== null ? ` → ${f.paidIn}` : ''} 集`}
          </p>
          {f.task && <p className="text-brand-700">{f.task}</p>}
          {f.alert && (
            <p className="flex items-start gap-1 text-amber-800">
              <AlertTriangle size={12} className="mt-1 shrink-0" />
              {f.alert}
            </p>
          )}
        </li>
      ))}
    </ul>
  )
}

function Stepper({ label, onPrev, onNext }: { label: ReactNode; onPrev?: () => void; onNext?: () => void }) {
  const btn = 'rounded-md p-1 text-ink-500 hover:bg-canvas hover:text-ink-900 disabled:opacity-30 disabled:hover:bg-transparent'
  return (
    <div className="flex items-center gap-1">
      <button type="button" className={btn} aria-label="上一个" disabled={!onPrev} onClick={onPrev}>
        <ChevronLeft size={15} />
      </button>
      <span className="min-w-16 text-center text-[13px] font-semibold text-ink-900 tabular-nums">{label}</span>
      <button type="button" className={btn} aria-label="下一个" disabled={!onNext} onClick={onNext}>
        <ChevronRight size={15} />
      </button>
    </div>
  )
}

/* ---------------------------------- 本集 ---------------------------------- */

function EpisodeView({ project, ep, draftId }: { project: Project; ep: number; draftId?: string }) {
  const s = episodeSnapshot(project, ep, draftId)
  return (
    <>
      <div className="space-y-2 px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[14px] font-semibold text-ink-900">{s.title || `第 ${ep} 集`}</span>
          {s.node && <Badge tone={NODE_TONE[s.node]}>{s.node}</Badge>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
          <span>
            {s.phaseName} · {rangeLabel(s.range)}
          </span>
          <Badge tone={s.basis === 'final' ? 'green' : s.basis === 'draft' ? 'amber' : 'gray'}>{s.basisLabel}</Badge>
        </div>
        {s.node === '大反转' && <p className="text-[12.5px] text-emerald-800">本集是大反转节点，需要反转剧情</p>}
        {(s.node === '付费卡点' || s.node === '首付费') && <p className="text-[12.5px] text-orange-800">付费卡点：结尾要卡在悬念最高处</p>}
        {s.event && <p className="line-clamp-4 text-[12.5px] leading-5 text-ink-700">{s.event}</p>}
        <dl className="space-y-1 text-[12.5px] leading-5">
          {s.hookIn && (
            <div className="flex gap-2">
              <dt className="shrink-0 text-ink-400">承接上集</dt>
              <dd className="min-w-0 text-ink-700">“{s.hookIn}”</dd>
            </div>
          )}
          {s.hookOut && (
            <div className="flex gap-2">
              <dt className="shrink-0 text-ink-400">本集钩子</dt>
              <dd className="min-w-0 text-ink-700">“{s.hookOut}”</dd>
            </div>
          )}
        </dl>
      </div>

      <Section icon={<Flag size={14} />} title="伏笔与线索" count={s.foreshadows.length}>
        <ForeshadowList list={s.foreshadows} empty="本集没有要埋、要收或进行中的伏笔" />
      </Section>

      <Section icon={<Users size={14} />} title="人物 · 截至本集" count={s.cast.length}>
        <CastList cast={s.cast} />
      </Section>

      {s.relations.length > 0 && (
        <Section icon={<Link2 size={14} />} title="同场关系" count={s.relations.length}>
          <ul className="space-y-1 text-[12.5px] leading-5">
            {s.relations.map((r, i) => (
              <li key={i}>
                <span className="text-ink-900">
                  {r.a} <span className="text-ink-300">↔</span> {r.b}
                </span>
                {r.kind && <span className="ml-1.5 text-brand-700">{r.kind}</span>}
                {r.label && <span className="ml-1.5 text-ink-500">{r.label}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section icon={<MapPin size={14} />} title="场景" count={s.scenes.length}>
        {s.scenes.length ? (
          <ul className="space-y-1 text-[12.5px] leading-5">
            {s.scenes.map((c) => (
              <li key={c.place} className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-ink-900">{c.place}</span>
                {c.before.length ? (
                  <span className="shrink-0 text-xs text-ink-400 tabular-nums">第 {c.before.slice(-3).join('、')} 集用过</span>
                ) : (
                  <Badge tone="violet">新场景</Badge>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <Empty>{s.basis === 'final' || s.basis === 'draft' ? '正文里没有场景标题' : '还没有正文，场景待定'}</Empty>
        )}
      </Section>

      {s.checks && (
        <Section icon={<ScrollText size={14} />} title="写作前检查">
          <CheckList items={s.checks} empty="一切就绪，可以开始写作" />
        </Section>
      )}
    </>
  )
}

/* ---------------------------------- 本阶段 ---------------------------------- */

function PhaseView({ project, index }: { project: Project; index: number }) {
  const s = phaseSnapshot(project, index)
  return (
    <>
      <div className="space-y-2 px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-[14px] font-semibold text-ink-900">{s.name}</span>
          <span className="text-xs text-ink-500 tabular-nums">{rangeLabel(s.range)}</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Meter label="集纲" value={s.outlined} total={s.size} />
          <Meter label="定稿" value={s.finals} total={s.size} />
        </div>
        {s.nodes.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {s.nodes.map((n) => (
              <Badge key={n.ep} tone={NODE_TONE[n.label]}>
                第 {n.ep} 集 · {n.label}
              </Badge>
            ))}
          </div>
        )}
        {s.rough ? <p className="line-clamp-6 text-[12.5px] leading-5 whitespace-pre-wrap text-ink-700">{s.rough}</p> : <Empty>还没有阶段粗纲</Empty>}
      </div>

      <Section icon={<Flag size={14} />} title="伏笔与线索" count={s.foreshadows.length}>
        <ForeshadowList list={s.foreshadows} empty="本段没有计划中的伏笔" />
      </Section>

      <Section icon={<Users size={14} />} title="人物 · 截至段末" count={s.cast.length}>
        <CastList cast={s.cast} phase />
      </Section>

      <Section icon={<MapPin size={14} />} title="场景" count={s.scenes.length}>
        {s.scenes.length ? (
          <ul className="space-y-1 text-[12.5px] leading-5">
            {s.scenes.map((c) => (
              <li key={c.place} className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-ink-900">{c.place}</span>
                <span className="shrink-0 text-xs text-ink-400 tabular-nums">{c.episodes.length} 集</span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>本段定稿后汇总</Empty>
        )}
      </Section>
    </>
  )
}

function Meter({ label, value, total }: { label: string; value: number; total: number }) {
  return (
    <div className="rounded-lg bg-canvas px-3 py-2">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-ink-500">{label}</span>
        <span className="font-semibold text-ink-900 tabular-nums">
          {value} / {total}
        </span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink-900/[0.06]">
        <div className={clsx('h-full rounded-full', value >= total ? 'bg-emerald-500' : 'bg-brand-500')} style={{ width: `${total ? (value / total) * 100 : 0}%` }} />
      </div>
    </div>
  )
}

/* ---------------------------------- 全剧 ---------------------------------- */

function OverallView({ project }: { project: Project }) {
  const s = overallSnapshot(project)
  const { lib } = s
  const count = (st: ForeshadowStatus) => lib.foreshadows.filter((f) => f.status === st).length
  const chars = lib.characters.filter((c) => c.role || c.firstEp !== null)
  return (
    <>
      <div className="space-y-2 px-4 py-3">
        <p className="text-[13px] text-ink-700">
          {s.latestEp ? (
            <>
              已定稿至<span className="mx-1 font-semibold text-ink-900 tabular-nums">第 {s.latestEp} 集</span>· 处在「{s.phaseName}」
            </>
          ) : (
            '还没有定稿：全剧状态只从正文章节（定稿）汇总'
          )}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Meter label="集纲" value={s.outlined} total={s.total} />
          <Meter label="定稿" value={s.finals} total={s.total} />
        </div>
        {s.drafting > 0 && <p className="text-xs text-ink-500">另有 {s.drafting} 集草稿未定稿，不计入全剧状态</p>}
      </div>

      <Section icon={<AlertTriangle size={14} />} title="需处理" count={s.alerts.length}>
        {s.alerts.length ? (
          <ul className="space-y-1.5 text-[12.5px] leading-5">
            {s.alerts.map((f) => (
              <li key={f.item.id}>
                <span className="font-medium text-ink-900">{foreshadowName(f.item)}</span>
                <span className="ml-1.5 text-amber-800">{f.overdue}</span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>没有逾期或沉寂的伏笔</Empty>
        )}
      </Section>

      <Section icon={<Flag size={14} />} title="伏笔与线索" count={lib.foreshadows.length}>
        <div className="mb-2 flex flex-wrap gap-1.5 text-xs">
          <Badge>已计划 {count('已计划')}</Badge>
          <Badge tone="amber">已埋设 · 待回收 {count('已埋设')}</Badge>
          <Badge tone="green">已回收 {count('已回收')}</Badge>
        </div>
        <ForeshadowList list={lib.foreshadows.filter((f) => f.status === '已埋设').map((f) => ({ ...f, task: null, alert: null }))} empty="没有进行中的伏笔" />
      </Section>

      <Section icon={<Users size={14} />} title="人物 · 最新状态" count={chars.length}>
        {chars.length ? (
          <ul className="space-y-2">
            {chars.map((c) => (
              <li key={c.name} className="text-[12.5px] leading-5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium text-ink-900">{c.name}</span>
                  <Badge tone={ROLE_TONE(c.role)}>{c.role ?? '未登记'}</Badge>
                  <span className="ml-auto text-xs text-ink-400 tabular-nums">{c.firstEp === null ? '未出场' : `第 ${c.firstEp}${c.lastEp !== c.firstEp ? `–${c.lastEp}` : ''} 集`}</span>
                </div>
                <p className="mt-0.5 text-ink-700">
                  {c.state || <span className="text-ink-300">还没有状态记录</span>}
                  {c.state && <span className="ml-1.5 text-[11px] text-ink-400 tabular-nums">第 {c.stateEp} 集后</span>}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>还没有人物</Empty>
        )}
      </Section>

      <Section icon={<MapPin size={14} />} title="场景" count={lib.scenes.length}>
        {lib.scenes.length ? (
          <ul className="space-y-1 text-[12.5px] leading-5">
            {lib.scenes.slice(0, 10).map((c) => (
              <li key={c.place} className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-ink-900">{c.place}</span>
                <span className="shrink-0 text-xs text-ink-400 tabular-nums">{c.episodes.length} 集</span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>定稿后自动汇总</Empty>
        )}
      </Section>

      <div className="border-t border-line px-4 py-3">
        <Link to={`/projects/${project.id}/state`} className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700">
          <ExternalLink size={12} />
          打开完整状态库（含定稿日志）
        </Link>
      </div>
    </>
  )
}

/* ---------------------------------- 侧栏 ---------------------------------- */

const tabsOf = (f: StateFocus): Tab[] => (f.kind === 'ep' ? ['ep', 'phase', 'all'] : f.kind === 'phase' ? ['phase', 'all'] : ['all'])
const TAB_LABEL: Record<Tab, string> = { ep: '本集', phase: '本阶段', all: '全剧' }

/** 剧本状态库侧栏：情节大纲、伏笔与线索、逐集剧本页面可随时展开核对 */
export function StatePanel({ project }: { project: Project }) {
  const { open, focus, setOpen } = useStatePanel()
  const total = project.spec.totalEpisodes
  const ranges = projectPhases(project)

  // 页面层级变了就回到页面选中的位置；侧栏里翻集 / 翻段只是临时查看
  const focusKey = focus ? JSON.stringify(focus) : ''
  const [seen, setSeen] = useState(focusKey)
  const [view, setView] = useState<StateFocus | null>(focus)
  const [tab, setTab] = useState<Tab>(focus ? tabsOf(focus)[0] : 'all')
  if (focusKey !== seen) {
    setSeen(focusKey)
    setView(focus)
    if (focus && (!view || focus.kind !== view.kind || !tabsOf(focus).includes(tab))) setTab(tabsOf(focus)[0])
  }

  useEffect(() => {
    if (!open || !focus) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[role="dialog"]')) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, focus, setOpen])

  if (!focus || !view) return null

  const alerts = overallSnapshot(project).alerts.length

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="展开剧本状态库"
        className="fixed top-1/3 right-0 z-30 flex flex-col items-center gap-1.5 rounded-l-xl border border-r-0 border-line bg-white px-2 py-3 text-[13px] font-medium text-ink-700 shadow-pop transition-colors hover:text-brand-700"
      >
        <Database size={15} className="text-brand-600" />
        <span className="[writing-mode:vertical-rl]">状态库</span>
        {alerts > 0 && <span className="rounded-full bg-amber-100 px-1.5 text-[11px] text-amber-800 tabular-nums">{alerts}</span>}
      </button>
    )
  }

  const ep = view.kind === 'ep' ? view.ep : null
  const phase = view.kind === 'phase' ? view.index : ep !== null ? phaseOf(ep, ranges) : phaseOf(1, ranges)
  const stepEp = (d: number) => ep !== null && setView({ kind: 'ep', ep: ep + d })
  const stepPhase = (d: number) => setView(ep !== null ? { kind: 'ep', ep: ranges[phase + d][0] } : { kind: 'phase', index: phase + d })

  return (
    <aside aria-label="剧本状态库" className="fixed top-0 right-0 z-30 flex h-dvh w-[380px] max-w-[92vw] animate-fade-in flex-col border-l border-line bg-white shadow-pop">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex items-center gap-1.5 text-[14px] font-semibold text-ink-900">
          <Database size={15} className="text-brand-600" />
          剧本状态库
        </div>
        <button type="button" aria-label="收起剧本状态库" title="收起（Esc）" onClick={() => setOpen(false)} className="rounded-md p-1 text-ink-400 hover:bg-canvas hover:text-ink-700">
          <ChevronsRight size={16} />
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
        <Segmented<Tab> value={tab} onChange={setTab} options={tabsOf(focus).map((t) => ({ value: t, label: TAB_LABEL[t] }))} />
        {tab === 'ep' && ep !== null && <Stepper label={`第 ${ep} 集`} onPrev={ep > 1 ? () => stepEp(-1) : undefined} onNext={ep < total ? () => stepEp(1) : undefined} />}
        {tab === 'phase' && <Stepper label={`第 ${phase + 1} 段`} onPrev={phase > 0 ? () => stepPhase(-1) : undefined} onNext={phase < ranges.length - 1 ? () => stepPhase(1) : undefined} />}
      </div>
      {JSON.stringify(view) !== focusKey && (
        <button type="button" onClick={() => setView(focus)} className="mx-4 mb-2 rounded-md bg-brand-50 px-2.5 py-1.5 text-left text-xs text-brand-700 hover:bg-brand-100">
          正在查看其他位置 · 回到当前页面选中的位置
        </button>
      )}

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto pb-4">
        {tab === 'ep' && ep !== null ? (
          <EpisodeView project={project} ep={ep} draftId={view.kind === 'ep' && focus.kind === 'ep' && focus.ep === ep ? focus.draftId : undefined} />
        ) : tab === 'phase' ? (
          <PhaseView project={project} index={phase} />
        ) : (
          <OverallView project={project} />
        )}
      </div>
    </aside>
  )
}
