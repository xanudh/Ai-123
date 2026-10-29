import { ArrowRight } from 'lucide-react'
import { useNavigate } from 'react-router'
import type { Project } from '../domain/types'
import { nextTask, projectProgress } from './flow'

/** 版本二的项目卡片底部：环节进度 + 一步回到上次的工作 */
export function CardProgress({ project }: { project: Project }) {
  const navigate = useNavigate()
  const { stages, done, finals, total } = projectProgress(project)
  const task = nextTask(project)

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center gap-2 text-[11px] text-ink-500 tabular-nums">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-ink-900/[0.06]">
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(done / Math.max(1, stages)) * 100}%` }} />
        </div>
        <span>
          {done}/{stages} 环节 · 定稿 {finals}/{total} 集
        </span>
      </div>
      {task && (
        <button
          type="button"
          onClick={(e) => {
            // 卡片整体是链接：按钮另有去处
            e.preventDefault()
            e.stopPropagation()
            navigate(task.to)
          }}
          className="flex w-full items-center gap-1 rounded-lg bg-brand-50 px-2.5 py-1.5 text-left text-xs text-brand-700 transition-colors hover:bg-brand-100"
        >
          <span className="shrink-0 font-medium">下一步 ·</span>
          <span className="min-w-0 flex-1 truncate">{task.title}</span>
          <ArrowRight size={13} className="shrink-0" />
        </button>
      )}
    </div>
  )
}
