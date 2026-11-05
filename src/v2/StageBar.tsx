import { ArrowRight, CheckCircle2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router'
import { buttonClass } from '../components/ui'
import { STAGES } from '../domain/pipeline'
import type { StageMeta } from '../domain/pipeline'
import type { Project } from '../domain/types'
import { stageGate, stageState } from '../domain/work'
import { useBottomSlot } from './bottomSlot'
import { stageDetail, stageTo } from './flow'

/**
 * 页面底部的环节条，各环节通用（11/4 标注 #74）。左边是状态、右边是按钮（#83：按钮一律靠右）：
 * 本环节自己的状态和按钮由环节用 useStageSlot 分别放进左右两块（如视频的「送入对标剧拆解」、拆解的「一键引用」、故事架构的「确认故事架构」），
 * 「去下一步」排在最右。有自己内容的环节，「去下一步」等本环节完成后才出现；没有的给出本环节进度和去下一步，下一步还进不去就写差什么。
 */
export function StageBar({ project, meta, next }: { project: Project; meta: StageMeta; next: StageMeta | null }) {
  const outer = useBottomSlot((s) => s.el)
  const setInfoEl = useBottomSlot((s) => s.setInfoEl)
  const setActionsEl = useBottomSlot((s) => s.setActionsEl)
  const own = useBottomSlot((s) => s.users > 0)
  if (!outer || meta.phase) return null

  const done = stageState(project, meta.key) === 'done'
  const self = stageGate(project, meta.key)
  const gate = next && stageGate(project, next.key)
  const detail = stageDetail(project, meta.key)
  const go = (key: StageMeta['key'], primary: boolean) => (
    <Link to={stageTo(project, key)} data-stage-next={key} className={buttonClass(primary ? 'primary' : 'secondary', 'md')}>
      去{STAGES[key].label}
      <ArrowRight size={15} />
    </Link>
  )

  // 本环节之外的那一段：状态排在左边，按钮排在最右
  let info: ReactNode = null
  let action: ReactNode = null
  if (self) {
    // 本环节还进不来：指回卡住的那一步
    info = <span className="text-[13px] text-amber-800">{self.reason}</span>
    action = go(self.to, false)
  } else if (next && done) {
    info = !own && (
      <span className="flex items-center gap-1.5 text-[13px] font-medium text-emerald-800">
        <CheckCircle2 size={16} className="text-emerald-600" />
        {meta.label}已完成
      </span>
    )
    action = go(next.key, true)
  } else if (next && !own) {
    if (gate) {
      info = (
        <span className="text-[13px] text-ink-500">
          下一步：{next.label}
          <span className="ml-2 text-ink-400">{gate.reason}</span>
        </span>
      )
    } else {
      info = detail && (
        <span className="text-[13px] text-ink-500">
          {meta.label} · <span className="tabular-nums">{detail}</span>
        </span>
      )
      action = go(next.key, false)
    }
  }
  if (!own && !info && !action) return null

  return createPortal(
    <div data-stage-bar className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        <div ref={setInfoEl} data-stage-own className="flex min-w-0 flex-wrap items-center gap-3 empty:hidden" />
        {own && info && <span aria-hidden className="h-6 w-px bg-line" />}
        {info}
      </div>
      <div data-stage-actions className="ml-auto flex flex-wrap items-center justify-end gap-2">
        <div ref={setActionsEl} className="flex flex-wrap items-center gap-2 empty:hidden" />
        {action}
      </div>
    </div>,
    outer,
  )
}
