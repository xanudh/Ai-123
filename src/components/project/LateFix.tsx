/**
 * 伏笔超期处理：计划的埋设 / 回收集已经写过去了还没确认，不只提醒，还要编剧决定这条计划还要不要。
 * AI 确认定稿（可能已经写了只是没确认）· 还要，改期 · 不要了（删除计划）。状态库侧栏的本集与全剧共用。
 */
import { useState } from 'react'
import { PLAN_EVENT_META } from '../../domain/constants'
import type { Foreshadow, Project } from '../../domain/types'
import type { LateStep } from '../../domain/work'
import { foreshadowName } from '../../domain/work'
import { useProjects } from '../../store/projects'
import { toast } from '../../store/toast'
import { ConfirmDialog } from '../overlay'
import { latestProject } from '../stage/StageKit'
import { Button, Select } from '../ui'
import { EventForm } from './EventForm'

type Mode = 'confirm' | 'move' | null

export function LateFix({ project, f, late, onDone }: { project: Project; f: Foreshadow; late: LateStep; onDone: () => void }) {
  const patchWork = useProjects((s) => s.patchWork)
  const [mode, setMode] = useState<Mode>(null)
  const [removing, setRemoving] = useState(false)
  const total = project.spec.totalEpisodes
  const label = PLAN_EVENT_META[late.kind].label
  // 改期只能改到还没定稿的集，否则改完马上又超期
  const written = Math.max(0, ...project.work.scripts.map((s) => s.ep))
  const first = written + 1
  // 埋设改期要给回收留出至少一集
  const last = late.kind === 'plant' ? total - 1 : total
  const options = Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => first + i)
  const [to, setTo] = useState(options[0] ?? 0)
  // 埋设改到回收集或之后：回收同步顺延
  const payoff = late.kind === 'plant' && to >= f.payoffEp ? Math.min(total, f.payoffEp + (to - f.plantEp)) : f.payoffEp
  const name = `「${foreshadowName(f)}」`

  const save = (list: (fs: Foreshadow[]) => Foreshadow[], note: string) => {
    const cur = latestProject(project.id)
    if (!cur) return
    patchWork(cur.id, { foreshadows: list(cur.work.foreshadows) }, note)
    toast(note)
    onDone()
  }

  const move = () => {
    if (!to) return
    const patch = late.kind === 'plant' ? { plantEp: to, payoffEp: Math.max(payoff, to + 1) } : { payoffEp: to }
    save((fs) => fs.map((x) => (x.id === f.id ? { ...x, ...patch } : x)), `${name}改到第 ${to} 集${label}`)
  }

  const tab = (m: Exclude<Mode, null>, text: string, disabled?: boolean, title?: string) => (
    <Button size="sm" variant={mode === m ? 'primary' : 'secondary'} disabled={disabled} title={title} onClick={() => setMode(mode === m ? null : m)}>
      {text}
    </Button>
  )

  return (
    <div className="space-y-2.5" data-late-fix>
      <p className="text-xs leading-5 text-ink-500">
        计划第 {late.ep} 集{label}，已超出 {late.by} 集还没确认。这条{f.type}还要吗？
      </p>
      <div className="flex flex-wrap gap-1.5">
        {tab('confirm', 'AI 确认定稿', !project.work.scripts.length, '可能已经写进定稿、只是还没确认：AI 在定稿里找证据，填进表单后由你保存')}
        {tab('move', '还要，改期', !options.length, options.length ? `改到第 ${first} 集以后${label}` : '已写到最后，没有可改的集')}
        <button type="button" className="inline-flex h-8 items-center rounded-lg px-3 text-[13px] font-medium text-red-600 hover:bg-red-50" onClick={() => setRemoving(true)}>
          不要了
        </button>
      </div>

      {mode === 'confirm' && <EventForm project={project} f={f} kind={late.kind} auto onDone={onDone} />}
      {mode === 'move' && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-[13px] text-ink-700">
            改到第
            <Select aria-label={`改期${label}集`} value={to} onChange={(e) => setTo(Number(e.target.value))} className="h-8 w-16 px-2 text-[13px]">
              {options.map((ep) => (
                <option key={ep} value={ep}>
                  {ep}
                </option>
              ))}
            </Select>
            集{label}
            <Button size="sm" className="ml-auto" onClick={move}>
              保存
            </Button>
          </div>
          {late.kind === 'plant' && payoff !== f.payoffEp && <p className="text-xs text-ink-400">回收同步顺延到第 {Math.max(payoff, to + 1)} 集</p>}
        </div>
      )}

      <ConfirmDialog
        open={removing}
        onClose={() => setRemoving(false)}
        onConfirm={() => save((fs) => fs.filter((x) => x.id !== f.id), `删除计划：${foreshadowName(f)}`)}
        title="不要这条计划了？"
        desc={`${name}会从伏笔计划里删除${f.events.length ? '，已确认的定稿事件一并删除' : ''}；正文不受影响。`}
        confirmText="删除"
        danger
      />
    </div>
  )
}
