import clsx from 'clsx'
import { AlertOctagon, AlertTriangle, ArrowRight, CircleDot, PartyPopper } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Card, CardHeader, buttonClass } from '../components/ui'
import type { Project } from '../domain/types'
import { nextTask, projectTodos } from './flow'
import type { Todo } from './flow'

/** 「继续工作」：指到具体要做的那件事，而不只是下一个环节 */
export function ContinueWork({ project }: { project: Project }) {
  const task = nextTask(project)
  if (!task) {
    return (
      <div className="mt-5 flex items-center gap-3 rounded-lg bg-emerald-50 px-4 py-3 text-[13px] text-emerald-900">
        <PartyPopper size={16} className="text-emerald-600" />
        {project.status === 'delivered' ? '项目已交付：全部环节已完成。' : '当前开放的环节都已完成。'}
      </div>
    )
  }
  return (
    <div className="mt-5 flex flex-wrap items-center gap-4 rounded-xl border border-brand-200 bg-brand-50/70 px-4 py-3.5" data-v2="continue">
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium tracking-wider text-brand-600">继续工作</div>
        <div className="mt-0.5 text-[14px] font-semibold text-ink-900">{task.title}</div>
        <div className="mt-0.5 text-xs text-ink-500">{task.desc}</div>
      </div>
      <Link to={task.to} className={buttonClass('primary', 'md')}>
        {task.cta}
        <ArrowRight size={15} />
      </Link>
    </div>
  )
}

const LEVEL_ORDER: Record<Todo['level'], number> = { block: 0, warn: 1, info: 2 }

const LEVEL_ICON: Record<Todo['level'], ReactNode> = {
  block: <AlertOctagon size={15} className="text-red-500" />,
  warn: <AlertTriangle size={15} className="text-amber-500" />,
  info: <CircleDot size={15} className="text-brand-500" />,
}

const PREVIEW = 6

/** 「待处理」：散在各环节、需要编剧确认或处理的事项汇总 */
export function TodoCard({ project }: { project: Project }) {
  const [all, setAll] = useState(false)
  const skip = nextTask(project)?.todoKey
  const todos = projectTodos(project)
    .filter((t) => t.key !== skip)
    .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level])
  if (!todos.length) return null
  const shown = all ? todos : todos.slice(0, PREVIEW)

  return (
    <Card id="todos">
      <CardHeader title="待处理" desc={`${todos.length} 项需要你确认或处理，按严重程度排序`} />
      <ul className="divide-y divide-line">
        {shown.map((t) => (
          <li key={t.key} className="flex items-center gap-3 px-5 py-2.5">
            <span className="shrink-0">{LEVEL_ICON[t.level]}</span>
            <span className={clsx('min-w-0 flex-1 text-[13px]', t.level === 'block' ? 'text-red-700' : 'text-ink-700')}>{t.text}</span>
            <Link to={t.to} className="shrink-0 text-[13px] font-medium text-brand-600 hover:text-brand-700">
              {t.cta} →
            </Link>
          </li>
        ))}
      </ul>
      {todos.length > PREVIEW && (
        <button type="button" onClick={() => setAll((v) => !v)} className="w-full border-t border-line py-2.5 text-[13px] text-ink-500 hover:text-ink-900">
          {all ? '收起' : `展开全部 ${todos.length} 项`}
        </button>
      )}
    </Card>
  )
}
