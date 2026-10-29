import { ArrowRight, CheckCircle2, ChevronDown, Info, Lock } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Badge, buttonClass } from '../components/ui'
import type { StageMeta } from '../domain/pipeline'
import type { Project } from '../domain/types'
import { stageState } from '../domain/work'
import { stageDetail, stageTo } from './flow'

const firstClause = (text: string) => text.split(/[，；：。]/)[0]

/** 版本二的环节页头：说明默认折叠；本环节完成后出现「下一步」条 */
export function StageHeadV2({ project, meta, index, next }: { project: Project; meta: StageMeta; index: number; next: StageMeta | null }) {
  const [showSummary, setShowSummary] = useState(false)
  const done = stageState(project, meta.key) === 'done'
  const detail = stageDetail(project, meta.key)

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          {/* 需求文档里的出处（如「第五步 · 逐集剧本生成」）编号与这里的步数不一致，只放在悬停提示里 */}
          <div className="text-xs text-ink-500 tabular-nums" title={`需求文档：${meta.source}`}>
            第 {index + 1} 步
          </div>
          <h2 className="mt-1 flex items-center gap-2 text-lg font-semibold">
            {meta.label}
            {meta.phase ? (
              <Badge tone="gray">
                <Lock size={10} />
                {meta.phase}
              </Badge>
            ) : (
              detail && <Badge tone={done ? 'green' : 'violet'}>{detail}</Badge>
            )}
          </h2>
        </div>
        {!meta.phase && (
          <button
            type="button"
            aria-expanded={showSummary}
            onClick={() => setShowSummary((v) => !v)}
            className="flex items-center gap-1 text-xs text-ink-500 hover:text-ink-900"
          >
            <Info size={13} />
            环节说明
            <ChevronDown size={13} className={showSummary ? 'rotate-180 transition-transform' : 'transition-transform'} />
          </button>
        )}
      </div>
      {!meta.phase && showSummary && <p className="-mt-2 max-w-3xl animate-fade-in text-[13px] leading-6 text-ink-500">{meta.summary}</p>}

      {done && next && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3" data-v2="next-stage">
          <CheckCircle2 size={18} className="shrink-0 text-emerald-600" />
          <div className="min-w-0 flex-1 text-[13px]">
            <span className="font-medium text-emerald-900">{meta.label}已完成</span>
            <span className="mx-1.5 text-emerald-300">·</span>
            <span className="text-emerald-800">
              下一步：{next.label}
              <span className="text-emerald-700/70"> —— {firstClause(next.summary)}</span>
            </span>
          </div>
          <Link to={stageTo(project, next.key)} className={buttonClass('primary', 'sm')}>
            去{next.label}
            <ArrowRight size={14} />
          </Link>
        </div>
      )}
    </>
  )
}
