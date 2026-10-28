import { ArrowLeft, Info } from 'lucide-react'
import { useNavigate } from 'react-router'
import { useCurrentProject } from './ProjectLayout'
import StateStage from './stages/StateStage'

/**
 * 原「剧本状态库」环节页：已从创作流程移出，改为情节大纲 / 伏笔 / 逐集剧本里的侧栏。
 * 这里保留完整视图（含定稿日志），侧栏方案不合适时可直接放回流程。
 */
export default function StateLibraryPage() {
  const project = useCurrentProject()
  const navigate = useNavigate()
  return (
    <div className="space-y-4">
      <button type="button" onClick={() => navigate(-1)} className="inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900">
        <ArrowLeft size={14} />
        返回
      </button>
      <div>
        <h2 className="text-lg font-semibold">剧本状态库 · 完整视图</h2>
        <p className="mt-1 flex items-start gap-1.5 text-[13px] leading-6 text-ink-500">
          <Info size={14} className="mt-[5px] shrink-0 text-ink-400" />
          状态库已改为侧栏：在情节大纲、伏笔与线索、逐集剧本里随时展开核对。这里保留原来的完整页面，按全部定稿汇总。
        </p>
      </div>
      <StateStage project={project} />
    </div>
  )
}
