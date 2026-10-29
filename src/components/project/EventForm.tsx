/**
 * 确认定稿事件：选定稿集与事件类型，摘一段逐字原文作证据并写明理由，保存后才记为已发生。
 * 「AI 识别定稿事件」只把找到的推进填进表单，仍由编剧点保存。伏笔页的计划卡片与状态库侧栏共用。
 */
import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { PLAN_EVENT_META } from '../../domain/constants'
import type { Foreshadow, PlanEventKind, Project } from '../../domain/types'
import { evidenceIn, finalLabel, foreshadowName, sortEvents } from '../../domain/work'
import { newId } from '../../lib/id'
import { identifyEvents } from '../../services/ai'
import type { EventFinding } from '../../services/ai'
import { useProjects } from '../../store/projects'
import { toast } from '../../store/toast'
import { AiButton, latestProject, useAiTask } from '../stage/StageKit'
import { Button, Input, Select } from '../ui'

const KINDS = Object.keys(PLAN_EVENT_META) as PlanEventKind[]

/** auto：打开就先跑一次「AI 识别定稿事件」（超期处理里的「AI 确认定稿」） */
export function EventForm({ project, f, ep, kind, auto, onDone }: { project: Project; f: Foreshadow; ep?: number; kind?: PlanEventKind; auto?: boolean; onDone: () => void }) {
  const patchWork = useProjects((s) => s.patchWork)
  const { running, run } = useAiTask()
  const finals = project.work.scripts.filter((s) => s.ep <= project.spec.totalEpisodes).sort((a, b) => a.ep - b.ep)
  // 默认选还没记过事件的第一集定稿
  const [form, setForm] = useState(() => ({
    ep: ep ?? finals.find((s) => !f.events.some((e) => e.ep === s.ep))?.ep ?? finals.at(-1)?.ep ?? 0,
    kind: kind ?? ((f.events.length ? 'echo' : 'plant') as PlanEventKind),
    quote: '',
    reason: '',
  }))
  const [found, setFound] = useState<EventFinding[] | null>(null)
  const set = (patch: Partial<typeof form>) => setForm((s) => ({ ...s, ...patch }))
  useEffect(() => {
    // identify 在下方声明，没有定稿时组件提前返回、不会走到它
    if (auto && finals.length) void identify()
  }, [auto])

  if (!finals.length) return <p className="rounded-lg bg-canvas px-3 py-2.5 text-[13px] text-ink-500">还没有定稿的正文章节。草稿不计入事件，先在逐集剧本里定稿。</p>

  const script = finals.find((s) => s.ep === form.ep)
  const quote = form.quote.trim()
  const quoted = !!script && evidenceIn(script, quote)
  const dup = f.events.some((e) => e.ep === form.ep && e.kind === form.kind && e.text === quote)
  const ready = quoted && !dup && !!form.reason.trim()

  const pick = (x: EventFinding) => set({ ep: x.ep, kind: x.kind, quote: x.text, reason: x.reason })

  const identify = async () => {
    const cur = latestProject(project.id)
    const now = cur?.work.foreshadows.find((x) => x.id === f.id)
    if (!cur || !now) return
    const out = await run('identify', (signal) => identifyEvents(cur, [now], ep, signal))
    if (!out) return
    setFound(out)
    if (out[0]) pick(out[0])
  }

  const save = () => {
    const cur = latestProject(project.id)
    if (!cur || !ready) return
    const event = { id: newId(), ep: form.ep, kind: form.kind, text: quote, reason: form.reason.trim(), at: new Date().toISOString() }
    patchWork(
      cur.id,
      { foreshadows: cur.work.foreshadows.map((x) => (x.id === f.id ? { ...x, events: sortEvents([...x.events, event]) } : x)) },
      `确认「${foreshadowName(f)}」定稿事件：第 ${form.ep} 集${PLAN_EVENT_META[form.kind].label}`,
    )
    toast(`已记入第 ${form.ep} 集${PLAN_EVENT_META[form.kind].label}`)
    onDone()
  }

  return (
    <div className="space-y-2.5" data-event-form>
      {found && !found.length && <p className="rounded-lg bg-canvas px-3 py-2 text-xs text-ink-500">AI 没在{ep ? `第 ${ep} 集` : ''}定稿正文里找到这条计划的新推进，可以手动摘录原文。</p>}
      {found && found.length > 1 && (
        <div>
          <p className="mb-1 text-xs text-ink-500">AI 找到 {found.length} 处推进，点选填入：</p>
          <ul className="space-y-1">
            {found.map((x) => (
              <li key={`${x.ep}-${x.text}`}>
                <button
                  type="button"
                  onClick={() => pick(x)}
                  className={clsx(
                    'w-full truncate rounded-md border px-2.5 py-1 text-left text-xs',
                    x.ep === form.ep && x.text === quote ? 'border-brand-300 bg-brand-50 text-brand-800' : 'border-line text-ink-700 hover:bg-canvas',
                  )}
                >
                  第 {x.ep} 集 · {PLAN_EVENT_META[x.kind].label} · {x.text}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2.5">
        <Select aria-label="定稿章节" value={form.ep} onChange={(e) => set({ ep: Number(e.target.value) })} className="h-9 text-[13px]">
          {finals.map((s) => (
            <option key={s.ep} value={s.ep}>
              {finalLabel(project, s)}
            </option>
          ))}
        </Select>
        <Select aria-label="事件类型" value={form.kind} onChange={(e) => set({ kind: e.target.value as PlanEventKind })} className="h-9 text-[13px]">
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {PLAN_EVENT_META[k].label}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Input aria-label="证据原文" value={form.quote} onChange={(e) => set({ quote: e.target.value })} invalid={!!quote && !quoted} placeholder="粘贴该定稿章节中的短原文" className="h-9 text-[13px]" />
        <p className={clsx('mt-1 text-xs', quote && !quoted ? 'text-red-600' : 'text-ink-400')}>
          {quote && !quoted ? `第 ${form.ep} 集定稿里没有这段原文，证据必须逐字摘自所选定稿章节。` : dup ? '这个事件已经记过了。' : '证据必须逐字来自所选定稿章节。'}
        </p>
      </div>
      <Input aria-label="确认理由" value={form.reason} onChange={(e) => set({ reason: e.target.value })} placeholder="确认理由" className="h-9 text-[13px]" />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!ready} onClick={save}>
          保存事件
        </Button>
        <AiButton loading={running === 'identify'} disabled={!!running} onClick={identify}>
          AI 识别定稿事件
        </AiButton>
      </div>
    </div>
  )
}
