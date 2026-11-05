import { ChevronDown, Info, Lock } from 'lucide-react'
import { useState } from 'react'
import { StageNeed, StageNeedText } from '../components/stage/StageNeed'
import { Badge } from '../components/ui'
import type { StageMeta } from '../domain/pipeline'
import type { Project } from '../domain/types'
import { stageState } from '../domain/work'
import { stageDetail } from './flow'

/** 环节页头：说明默认折叠；「去下一步」在页面底部的环节条里（StageBar） */
export function StageHead({ project, meta, index, next }: { project: Project; meta: StageMeta; index: number; next: StageMeta | null }) {
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
              <>
                {detail && <Badge tone={done ? 'green' : 'violet'}>{detail}</Badge>}
                <StageNeed project={project} meta={meta} next={next} />
              </>
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
      {!meta.phase && <StageNeedText meta={meta} />}
    </>
  )
}
