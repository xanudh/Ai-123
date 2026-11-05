import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router'
import { NEED_LABEL, STAGE_NEED } from '../../domain/pipeline'
import type { StageMeta } from '../../domain/pipeline'
import type { Project } from '../../domain/types'
import { Badge } from '../ui'
import { stagePath } from './StageKit'

/** 环节页头上的「必做 / 可一键 / 可跳过」：悬停看说明；能整步跳过的给一个直接去下一步的入口 */
export function StageNeed({ project, meta, next }: { project: Project; meta: StageMeta; next: StageMeta | null }) {
  const need = STAGE_NEED[meta.key]
  if (!need) return null
  return (
    <span data-stage-need={need.level} className="inline-flex items-center gap-2 text-[13px] font-normal">
      <span title={need.text}>
        <Badge tone={need.level === 'skip' ? 'gray' : need.level === 'quick' ? 'violet' : 'amber'}>{NEED_LABEL[need.level]}</Badge>
      </span>
      {need.level === 'skip' && next && (
        <Link to={stagePath(project, next.key)} className="inline-flex items-center gap-0.5 text-xs text-ink-500 hover:text-brand-600" title={need.text}>
          跳过这一步，去{next.label}
          <ArrowRight size={12} />
        </Link>
      )}
    </span>
  )
}

/** 页头下方的一行说明：这一步哪些能跳 */
export function StageNeedText({ meta }: { meta: StageMeta }) {
  const need = STAGE_NEED[meta.key]
  return need ? <p className="-mt-2 text-xs text-ink-500">{need.text}</p> : null
}
