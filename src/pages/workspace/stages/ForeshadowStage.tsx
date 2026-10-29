import clsx from 'clsx'
import { CircleCheck, Clock, Flag, Pencil, Plus, Trash2, TriangleAlert, X } from 'lucide-react'
import { useState } from 'react'
import { ConfirmDialog, Modal } from '../../../components/overlay'
import { EventForm } from '../../../components/project/EventForm'
import { AiButton, AutoTextarea, EpisodeInput, InlineInput, Stat, latestProject, useAiTask } from '../../../components/stage/StageKit'
import { Badge, Button, Card, EmptyState, Field, Input, Segmented, Select } from '../../../components/ui'
import { FORESHADOW_TYPES, PLAN_EVENT_META } from '../../../domain/constants'
import { buildState, silenceThreshold } from '../../../domain/state'
import type { ForeshadowEntry } from '../../../domain/state'
import type { Foreshadow, ForeshadowType, PlanEventKind, Project } from '../../../domain/types'
import { foreshadowIssue, foreshadowName, newForeshadow, phaseNames, projectPhases, sortEvents } from '../../../domain/work'
import type { ForeshadowStatus } from '../../../domain/work'
import { newId } from '../../../lib/id'
import { draftForeshadows, identifyEvents } from '../../../services/ai'
import type { EventFinding, ForeshadowIdea } from '../../../services/ai'
import { useProjects } from '../../../store/projects'
import { useStateFocus } from '../../../store/statePanel'
import { toast } from '../../../store/toast'

const STATUS_TONE: Record<ForeshadowStatus, 'gray' | 'amber' | 'green'> = { 已计划: 'gray', 已埋设: 'amber', 已回收: 'green' }

const KIND_DOT: Record<PlanEventKind, string> = { plant: 'bg-amber-500', echo: 'bg-brand-500', payoff: 'bg-emerald-500' }

const KINDS = Object.keys(PLAN_EVENT_META) as PlanEventKind[]

/** 叙事线索用“开始 / 结束”，其余用“埋设 / 回收” */
const startLabel = (f: Pick<Foreshadow, 'type'>) => (f.type === '叙事线索' ? '开始' : '埋设')
const endLabel = (f: Pick<Foreshadow, 'type'>) => (f.type === '叙事线索' ? '结束' : '回收')

/* ---------------------------------- 计划表单 ---------------------------------- */

interface FormState {
  title: string
  type: ForeshadowType
  plant: string
  payoff: string
  content: string
}

const toForm = (f: Foreshadow): FormState => ({ title: f.title, type: f.type, plant: String(f.plantEp), payoff: String(f.payoffEp), content: f.content })

function PlanForm({
  total,
  initial,
  submitText,
  onSubmit,
  onCancel,
}: {
  total: number
  initial: Foreshadow
  submitText: string
  onSubmit: (f: Foreshadow) => void
  onCancel?: () => void
}) {
  const [form, setForm] = useState(() => toForm(initial))
  const set = (patch: Partial<FormState>) => setForm((s) => ({ ...s, ...patch }))
  const next: Foreshadow = { ...initial, title: form.title.trim(), type: form.type, content: form.content.trim(), plantEp: Number(form.plant) || 0, payoffEp: Number(form.payoff) || 0 }
  const issue = foreshadowIssue(next, total)
  const digits = (v: string) => v.replace(/[^\d]/g, '').slice(0, 3)

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="标题">
          <Input aria-label="计划标题" value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="如：女主左手腕的旧疤" />
        </Field>
        <Field label="类型">
          <Select aria-label="计划类型" value={form.type} onChange={(e) => set({ type: e.target.value as ForeshadowType })}>
            {FORESHADOW_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </Field>
        <Field label={`计划${startLabel(form)} / 开始集`}>
          <Input aria-label="计划埋设集" inputMode="numeric" value={form.plant} onChange={(e) => set({ plant: digits(e.target.value) })} />
        </Field>
        <Field label={`预计${endLabel(form)} / 结束集`}>
          <Input aria-label="预计回收集" inputMode="numeric" value={form.payoff} onChange={(e) => set({ payoff: digits(e.target.value) })} />
        </Field>
      </div>
      <Field label="作者意图 / 理由" hint="埋什么、怎么收；写作时会按这里注入对应集，并用前几个字在定稿正文里找推进">
        <AutoTextarea aria-label="作者意图" minRows={3} value={form.content} onChange={(e) => set({ content: e.target.value })} placeholder="如：第 1 集只给特写不解释；第 18 集揭示旧疤与当年火灾的关联，让它从小动作升级为关键证据" />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" disabled={!!issue} onClick={() => onSubmit(next)}>
          {submitText}
        </Button>
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            取消
          </Button>
        )}
        {issue && (form.title || form.content) && <span className="text-xs text-red-600">{issue}</span>}
      </div>
    </div>
  )
}

/* ---------------------------------- 批量确认定稿事件 ---------------------------------- */

interface FindingRow extends EventFinding {
  key: string
  on: boolean
}

/** AI 把所有计划在定稿正文里的推进一次找出来，按计划分组勾选；确认后才记为已发生 */
function BatchDialog({ project, found, onClose }: { project: Project; found: EventFinding[]; onClose: () => void }) {
  const patchWork = useProjects((s) => s.patchWork)
  const [rows, setRows] = useState<FindingRow[]>(() => found.map((x) => ({ ...x, key: newId(), on: true })))
  const picked = rows.filter((r) => r.on)
  const groups = project.work.foreshadows.map((f) => ({ f, rows: rows.filter((r) => r.foreshadowId === f.id) })).filter((g) => g.rows.length)

  const setRow = (key: string, patch: Partial<FindingRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const confirm = () => {
    const cur = latestProject(project.id)
    if (!cur || !picked.length) return
    const at = new Date().toISOString()
    patchWork(
      cur.id,
      {
        foreshadows: cur.work.foreshadows.map((f) => {
          const mine = picked.filter((r) => r.foreshadowId === f.id)
          return mine.length ? { ...f, events: sortEvents([...f.events, ...mine.map((r) => ({ id: newId(), ep: r.ep, kind: r.kind, text: r.text, reason: r.reason, at }))]) } : f
        }),
      },
      `批量确认定稿事件 ${picked.length} 个`,
    )
    toast(`已记入 ${picked.length} 个定稿事件`)
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      width={680}
      title="AI 批量确认定稿事件"
      desc="AI 在定稿正文里找到了这些推进，证据均逐字摘自定稿；勾选确认后才记为已发生"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button disabled={!picked.length} onClick={confirm}>
            确认 {picked.length || ''} 个事件
          </Button>
        </>
      }
    >
      <div className="max-h-[60vh] space-y-4 overflow-y-auto">
        {groups.map(({ f, rows: list }) => (
          <section key={f.id}>
            <h4 className="mb-1.5 text-[13px] font-semibold text-ink-900">{foreshadowName(f) || '未命名计划'}</h4>
            <ul className="space-y-1.5">
              {list.map((r) => (
                <li key={r.key} className={clsx('flex items-start gap-2.5 rounded-lg border px-3 py-2', r.on ? 'border-brand-200 bg-brand-50/50' : 'border-line')}>
                  <input type="checkbox" aria-label={`确认：${foreshadowName(f)} 第 ${r.ep} 集`} checked={r.on} onChange={(e) => setRow(r.key, { on: e.target.checked })} className="mt-1.5 accent-brand-600" />
                  <span className="mt-1 shrink-0 text-[13px] font-medium tabular-nums">第 {r.ep} 集</span>
                  <Select aria-label="事件类型" value={r.kind} onChange={(e) => setRow(r.key, { kind: e.target.value as PlanEventKind })} className="h-7 w-20 shrink-0 px-2 text-xs">
                    {KINDS.map((k) => (
                      <option key={k} value={k}>
                        {PLAN_EVENT_META[k].label}
                      </option>
                    ))}
                  </Select>
                  <span className="min-w-0 flex-1 pt-1 text-[13px] leading-5">
                    <span className="text-ink-900">{r.text}</span>
                    <span className="mt-0.5 block text-xs text-ink-400">{r.reason}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  )
}

/* ---------------------------------- 计划卡片 ---------------------------------- */

function PlanCard({
  project,
  entry,
  threshold,
  onEdit,
  onRemove,
}: {
  project: Project
  entry: ForeshadowEntry
  threshold: number
  onEdit: () => void
  onRemove: () => void
}) {
  const patchWork = useProjects((s) => s.patchWork)
  const [confirming, setConfirming] = useState(false)
  const f = entry.item
  const issue = foreshadowIssue(f, project.spec.totalEpisodes)
  const removeEvent = (id: string) => {
    const cur = latestProject(project.id)
    if (cur) patchWork(cur.id, { foreshadows: cur.work.foreshadows.map((x) => (x.id === f.id ? { ...x, events: x.events.filter((e) => e.id !== id) } : x)) })
  }

  return (
    <Card id={`plan-${f.id}`} className={clsx('p-5', entry.overdue && 'border-amber-200')}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-ink-900">{foreshadowName(f) || '未命名计划'}</h3>
          <p className="mt-0.5 text-xs text-ink-500 tabular-nums">
            {f.type} · {startLabel(f)}/开始 {f.plantEp} · 预计{endLabel(f)}/结束 {f.payoffEp}
          </p>
        </div>
        <Badge tone={STATUS_TONE[entry.status]}>{entry.status}</Badge>
      </div>
      {f.content && <p className="mt-3 text-[13px] leading-6 whitespace-pre-wrap text-ink-700">{f.content}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className={clsx('flex items-center gap-1', threshold > 0 && entry.silence >= threshold ? 'text-amber-700' : 'text-ink-500')}>
          <Clock size={13} />
          沉寂 {entry.silence} 集
        </span>
        {issue ? (
          <span className="flex items-center gap-1 text-red-600">
            <TriangleAlert size={13} />
            {issue}
          </span>
        ) : (
          entry.overdue && (
            <span className="flex items-center gap-1 text-amber-700">
              <TriangleAlert size={13} />
              {entry.overdue}
            </span>
          )
        )}
      </div>
      {f.events.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {sortEvents(f.events).map((e) => (
            <li key={e.id} className="group flex items-start gap-2 text-[13px] leading-5">
              <CircleCheck size={14} className="mt-[3px] shrink-0 text-emerald-500" />
              <span className="min-w-0 flex-1 text-ink-700">
                <span className="font-medium text-ink-900 tabular-nums">第 {e.ep} 集</span> · 已{PLAN_EVENT_META[e.kind].label} · {e.text}
                {e.reason && <span className="block text-xs text-ink-400">理由：{e.reason}</span>}
              </span>
              <button className="rounded p-0.5 text-ink-300 opacity-0 group-hover:opacity-100 hover:text-red-600 focus:opacity-100" aria-label="撤销这个事件" onClick={() => removeEvent(e.id)}>
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={onEdit}>
          <Pencil size={13} />
          编辑
        </Button>
        <button
          type="button"
          aria-expanded={confirming}
          onClick={() => setConfirming((v) => !v)}
          className={clsx(
            'inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium shadow-sm transition-colors',
            confirming ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-line bg-white text-ink-900 hover:bg-canvas',
          )}
        >
          确认定稿事件
        </button>
        <Button variant="ghost" size="sm" className="text-ink-500" onClick={onRemove}>
          <Trash2 size={13} />
          删除
        </Button>
      </div>
      {confirming && (
        <div className="mt-4 border-t border-line pt-4">
          <EventForm project={project} f={f} onDone={() => setConfirming(false)} />
        </div>
      )}
    </Card>
  )
}

/* ---------------------------------- AI 建议 ---------------------------------- */

interface IdeaRow {
  f: Foreshadow
  why: string
  on: boolean
  /** 计划里已有同名的，不能重复录入 */
  exists: boolean
}

/** AI 建议的伏笔先在弹窗里勾选、微调，确认后才录入计划 */
function SuggestDialog({ project, ideas, onClose, onConfirm }: { project: Project; ideas: ForeshadowIdea[]; onClose: () => void; onConfirm: (list: Foreshadow[]) => void }) {
  const total = project.spec.totalEpisodes
  const [rows, setRows] = useState<IdeaRow[]>(() => {
    const titles = new Set(project.work.foreshadows.map((f) => foreshadowName(f)))
    return ideas.map((x) => ({ f: x.foreshadow, why: x.why, on: false, exists: titles.has(foreshadowName(x.foreshadow)) }))
  })
  const selectable = rows.filter((r) => !r.exists)
  const picked = rows.filter((r) => r.on && !r.exists)
  const allOn = selectable.length > 0 && selectable.every((r) => r.on)
  const invalid = picked.filter((r) => foreshadowIssue(r.f, total)).length
  const setRow = (id: string, patch: Partial<IdeaRow>) => setRows((list) => list.map((r) => (r.f.id === id ? { ...r, ...patch } : r)))
  const setF = (id: string, patch: Partial<Foreshadow>) => setRows((list) => list.map((r) => (r.f.id === id ? { ...r, f: { ...r.f, ...patch } } : r)))

  return (
    <Modal
      open
      onClose={onClose}
      width={760}
      title="AI 建议的伏笔与线索"
      desc="对照已确定的情节大纲给出建议：勾选要用的、按需改标题和集数，确认后才录入计划"
      footer={
        <>
          <span className="mr-auto self-center text-xs text-ink-500">{invalid ? <span className="text-red-600">{invalid} 条集数有误：回收 / 结束集必须晚于埋设 / 开始集</span> : `已选 ${picked.length} / ${selectable.length} 条`}</span>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button disabled={!picked.length || invalid > 0} onClick={() => onConfirm(picked.map((r) => r.f))}>
            确定录入{picked.length ? ` ${picked.length} 条` : ''}
          </Button>
        </>
      }
    >
      <div className="mb-2 flex items-center justify-between text-xs text-ink-500">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={allOn} disabled={!selectable.length} onChange={(e) => setRows((list) => list.map((r) => (r.exists ? r : { ...r, on: e.target.checked })))} className="accent-brand-600" />
          全选
        </label>
        <span>共 {rows.length} 条建议{rows.length > selectable.length && `，${rows.length - selectable.length} 条已在计划中`}</span>
      </div>
      <ul className="max-h-[56vh] space-y-2 overflow-y-auto pr-1">
        {rows.map((r) => {
          const issue = r.on ? foreshadowIssue(r.f, total) : null
          return (
            <li key={r.f.id} className={clsx('rounded-lg border px-3 py-2.5', r.exists ? 'border-line bg-canvas/60 opacity-60' : r.on ? 'border-brand-200 bg-brand-50/50' : 'border-line')}>
              <div className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  aria-label={`选择：${foreshadowName(r.f)}`}
                  checked={r.on && !r.exists}
                  disabled={r.exists}
                  onChange={(e) => setRow(r.f.id, { on: e.target.checked })}
                  className="mt-2 accent-brand-600"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={r.f.type === '叙事线索' ? 'gray' : 'violet'}>{r.f.type}</Badge>
                    <InlineInput aria-label="标题" value={r.f.title} disabled={r.exists} onChange={(e) => setF(r.f.id, { title: e.target.value })} className="min-w-40 flex-1 font-medium" />
                    {r.exists ? (
                      <Badge tone="green">已在计划中</Badge>
                    ) : (
                      <span className="flex items-center gap-1 text-xs whitespace-nowrap text-ink-500">
                        {startLabel(r.f)}
                        <EpisodeInput label={`${startLabel(r.f)}集`} value={r.f.plantEp} max={total} onChange={(v) => setF(r.f.id, { plantEp: v })} />
                        → {endLabel(r.f)}
                        <EpisodeInput label={`${endLabel(r.f)}集`} value={r.f.payoffEp} max={total} onChange={(v) => setF(r.f.id, { payoffEp: v })} />
                      </span>
                    )}
                  </div>
                  <p className="mt-1 px-2 text-[13px] leading-5 text-ink-700">{r.f.content}</p>
                  <p className="mt-0.5 px-2 text-xs leading-5 text-ink-400">{r.why}</p>
                  {issue && <p className="mt-0.5 px-2 text-xs text-red-600">{issue}</p>}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </Modal>
  )
}

/* ---------------------------------- 剧情树 ---------------------------------- */

function PlotTree({ project, entries, latestEp }: { project: Project; entries: ForeshadowEntry[]; latestEp: number }) {
  const total = project.spec.totalEpisodes
  const ranges = projectPhases(project)
  const names = phaseNames(project)
  const pos = (ep: number) => `${((ep - 0.5) / total) * 100}%`
  const groups = FORESHADOW_TYPES.map((type) => ({ type, list: entries.filter((e) => e.item.type === type) })).filter((g) => g.list.length)

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <div className="min-w-[760px]">
          {/* 五段式分段 */}
          <div className="grid grid-cols-[220px_minmax(0,1fr)] border-b border-line bg-canvas/60 text-xs text-ink-500">
            <div className="px-4 py-2.5 font-medium">全剧 {total} 集</div>
            <div className="relative flex">
              {ranges.map(([from, to], i) => (
                <div key={i} className="border-l border-line px-2 py-2.5" style={{ width: `${((to - from + 1) / total) * 100}%` }}>
                  <div className="truncate font-medium text-ink-700">{names[i]}</div>
                  <div className="tabular-nums">
                    {from}–{to}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {groups.map((g) => (
            <div key={g.type}>
              <div className="border-b border-line bg-white px-4 py-2 text-[13px] font-semibold text-ink-900">
                {g.type}
                <span className="ml-1.5 font-normal text-ink-400">{g.list.length}</span>
              </div>
              {g.list.map((e) => {
                const f = e.item
                const from = Math.max(1, Math.min(f.plantEp, total))
                const to = Math.max(from, Math.min(f.payoffEp, total))
                return (
                  <div key={f.id} className="grid grid-cols-[220px_minmax(0,1fr)] border-b border-line last:border-b-0">
                    <div className="flex min-w-0 items-center gap-2 py-2.5 pr-3 pl-7">
                      <span className="text-ink-300">└</span>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-ink-700" title={foreshadowName(f)}>
                        {foreshadowName(f) || '未命名计划'}
                      </span>
                      <Badge tone={STATUS_TONE[e.status]}>{e.status}</Badge>
                    </div>
                    <div className="relative h-11">
                      {ranges.slice(1).map(([start]) => (
                        <span key={start} className="absolute inset-y-0 border-l border-line/70" style={{ left: `${((start - 1) / total) * 100}%` }} />
                      ))}
                      {latestEp > 0 && <span className="absolute inset-y-0 border-l-2 border-dashed border-brand-300" style={{ left: `${(latestEp / total) * 100}%` }} title={`已定稿至第 ${latestEp} 集`} />}
                      <span
                        className={clsx('absolute top-1/2 h-2 -translate-y-1/2 rounded-full', e.overdue ? 'bg-amber-200' : f.type === '叙事线索' ? 'bg-sky-100' : 'bg-brand-100')}
                        style={{ left: `${((from - 1) / total) * 100}%`, width: `${((to - from + 1) / total) * 100}%` }}
                        title={`计划：第 ${f.plantEp} 集${startLabel(f)} → 第 ${f.payoffEp} 集${endLabel(f)}`}
                      />
                      {/* 计划节点：空心；确认事件：实心 */}
                      {[from, to].map((ep, i) => (
                        <span key={i} className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink-300 bg-white" style={{ left: pos(ep) }} />
                      ))}
                      {f.events
                        .filter((ev) => ev.ep <= total)
                        .map((ev) => (
                          <span
                            key={ev.id}
                            className={clsx('absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white', KIND_DOT[ev.kind])}
                            style={{ left: pos(ev.ep) }}
                            title={`第 ${ev.ep} 集 · 已${PLAN_EVENT_META[ev.kind].label}：${ev.text}`}
                          />
                        ))}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-2.5 text-xs text-ink-500">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full border-2 border-ink-300 bg-white" />
          计划节点
        </span>
        {KINDS.map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className={clsx('size-2.5 rounded-full', KIND_DOT[k])} />
            已{PLAN_EVENT_META[k].label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="h-3 border-l-2 border-dashed border-brand-300" />
          已定稿进度
        </span>
      </div>
    </Card>
  )
}

/* ---------------------------------- 页面 ---------------------------------- */

export default function ForeshadowStage({ project, blocked }: { project: Project; blocked: boolean }) {
  const patchWork = useProjects((s) => s.patchWork)
  const { running, run } = useAiTask()
  const [view, setView] = useState<'list' | 'tree'>('list')
  const [formKey, setFormKey] = useState(0)
  const [editing, setEditing] = useState<string | null>(null)
  const [batch, setBatch] = useState<EventFinding[] | null>(null)
  const [removing, setRemoving] = useState<Foreshadow | null>(null)
  const [ideas, setIdeas] = useState<ForeshadowIdea[] | null>(null)
  const total = project.spec.totalEpisodes
  const items = project.work.foreshadows
  const lib = buildState(project)
  const threshold = silenceThreshold(project)
  const count = (s: ForeshadowStatus) => lib.foreshadows.filter((e) => e.status === s).length
  const alerts = lib.foreshadows.filter((e) => e.overdue || foreshadowIssue(e.item, total)).length
  // 状态库侧栏看写作进度上的当前集：第一个还没定稿的集
  useStateFocus({ kind: 'ep', ep: Math.min(total, lib.latestEp + 1) })

  const save = (next: Foreshadow[], note?: string) => patchWork(project.id, { foreshadows: next }, note)

  const suggest = async () => {
    const cur = latestProject(project.id)
    if (!cur) return
    const result = await run('foreshadow', (signal) => draftForeshadows(cur, signal))
    if (result) setIdeas(result)
  }

  const hasFinals = project.work.scripts.some((s) => s.ep <= total)
  const identifyAll = async () => {
    const cur = latestProject(project.id)
    if (!cur) return
    const found = await run('batch', (signal) => identifyEvents(cur, cur.work.foreshadows, undefined, signal))
    if (!found) return
    if (found.length) setBatch(found)
    else toast('定稿正文里没有找到待确认的伏笔推进')
  }

  const adopt = (list: Foreshadow[]) => {
    const now = latestProject(project.id)?.work.foreshadows ?? []
    save([...now, ...list], `录入 AI 建议的伏笔与线索 ${list.length} 条`)
    setIdeas(null)
    toast(`已录入 ${list.length} 条计划，可逐条编辑`)
  }

  const create = (f: Foreshadow) => {
    const cur = latestProject(project.id)
    if (!cur) return
    save([...cur.work.foreshadows, f], `新建计划：${foreshadowName(f)}`)
    setFormKey((k) => k + 1)
    toast('计划已保存')
  }

  const replace = (f: Foreshadow) => {
    const cur = latestProject(project.id)
    if (!cur) return
    save(cur.work.foreshadows.map((x) => (x.id === f.id ? f : x)))
    setEditing(null)
  }

  const remove = (f: Foreshadow) => {
    const cur = latestProject(project.id)
    if (cur) save(cur.work.foreshadows.filter((x) => x.id !== f.id), `删除计划：${foreshadowName(f)}`)
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[13px] leading-6 text-ink-500">
          大纲定下来之后再埋伏笔：对照集纲设置埋设与预计回收集；活跃计划会自动注入后续写作，{threshold > 0 ? `逾期或沉寂（≥ ${threshold} 集）时提醒` : '逾期时提醒'}。只有人工确认的定稿内容才记为已发生事件。
        </p>
        <div className="flex items-center gap-2">
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'tree', label: '剧情树' },
              { value: 'list', label: '计划清单' },
            ]}
          />
          <AiButton size="md" loading={running === 'foreshadow'} disabled={blocked || !!running} onClick={suggest}>
            AI 建议伏笔与线索
          </AiButton>
          <AiButton
            size="md"
            variant="secondary"
            loading={running === 'batch'}
            disabled={!items.length || !hasFinals || !!running}
            title={!items.length ? '还没有伏笔计划' : !hasFinals ? '还没有定稿的正文章节，草稿不计入事件' : 'AI 在全部定稿里找各条计划的推进，勾选确认后才记入'}
            onClick={identifyAll}
          >
            AI 批量确认定稿
          </AiButton>
        </div>
      </div>

      {items.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="已计划" value={count('已计划')} />
          <Stat label="已埋设 · 待回收" value={count('已埋设')} tone={count('已埋设') ? 'amber' : undefined} />
          <Stat label="已回收" value={count('已回收')} tone={count('已回收') ? 'green' : undefined} />
          <Stat label="需处理" value={alerts} tone={alerts ? 'red' : undefined} />
        </div>
      )}

      {view === 'tree' ? (
        items.length ? (
          <PlotTree project={project} entries={lib.foreshadows} latestEp={lib.latestEp} />
        ) : (
          <Card>
            <EmptyState icon={<Flag size={22} />} title="还没有计划" desc="在计划清单里新建，或让 AI 建议伏笔与叙事线索" />
          </Card>
        )
      ) : (
        <>
          <Card className="p-5">
            <h3 className="mb-4 flex items-center gap-1.5 text-[15px] font-semibold text-ink-900">
              <Plus size={16} />
              新建计划
            </h3>
            <PlanForm key={formKey} total={total} initial={newForeshadow({ payoffEp: Math.min(total, 10) })} submitText="保存计划" onSubmit={create} />
          </Card>

          {lib.foreshadows.map((e) =>
            editing === e.item.id ? (
              <Card key={e.item.id} className="border-brand-200 p-5">
                <h3 className="mb-4 text-[15px] font-semibold text-ink-900">编辑计划</h3>
                <PlanForm total={total} initial={e.item} submitText="保存修改" onSubmit={replace} onCancel={() => setEditing(null)} />
              </Card>
            ) : (
              <PlanCard
                key={e.item.id}
                project={project}
                entry={e}
                threshold={threshold}
                onEdit={() => setEditing(e.item.id)}
                onRemove={() => setRemoving(e.item)}
              />
            ),
          )}

          {!items.length && (
            <p className="text-center text-xs text-ink-400">
              {blocked ? '确定情节大纲后，AI 可以对照集纲建议伏笔与线索' : '人物秘密、隐藏身份、关键道具、前情恩怨与叙事线索逐条计划，回收 / 结束集必须晚于埋设 / 开始集'}
            </p>
          )}
        </>
      )}

      {batch && <BatchDialog project={project} found={batch} onClose={() => setBatch(null)} />}
      {ideas && <SuggestDialog project={project} ideas={ideas} onClose={() => setIdeas(null)} onConfirm={adopt} />}
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove(removing)}
        danger
        title="删除计划？"
        desc={`「${removing ? foreshadowName(removing) : ''}」及其已确认的定稿事件会被删除。`}
        confirmText="删除"
      />
    </>
  )
}
