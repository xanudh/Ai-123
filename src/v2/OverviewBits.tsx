import clsx from 'clsx'
import { AlertOctagon, AlertTriangle, ArrowRight, Check, CheckCircle2, CircleDot, PartyPopper, Undo2 } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Card, CardHeader, buttonClass } from '../components/ui'
import type { Project } from '../domain/types'
import { nextTask, projectTodos } from './flow'
import type { Todo } from './flow'
import { useTodoDone } from './todoDone'
import { toast } from '../store/toast'

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
  const [showDone, setShowDone] = useState(false)
  const marked = useTodoDone((s) => s.done[project.id])
  const mark = useTodoDone((s) => s.mark)
  const restore = useTodoDone((s) => s.restore)
  const skip = nextTask(project)?.todoKey
  const list = projectTodos(project)
    .filter((t) => t.key !== skip)
    .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level])
  // 标记时的文字和现在一致才算已处理；情况变了重新出现
  const isDone = (t: Todo) => marked?.[t.key] === t.text
  const todos = list.filter((t) => !isDone(t))
  const done = list.filter(isDone)
  if (!list.length) return null
  const shown = all ? todos : todos.slice(0, PREVIEW)

  return (
    <Card id="todos">
      <CardHeader title="待处理" desc={todos.length ? `${todos.length} 项需要你确认或处理，按严重程度排序` : '都已处理'} />
      <ul className="divide-y divide-line">
        {shown.map((t) => (
          <li key={t.key} className="flex items-center gap-3 px-5 py-2.5">
            <span className="shrink-0">{LEVEL_ICON[t.level]}</span>
            <span className={clsx('min-w-0 flex-1 text-[13px]', t.level === 'block' ? 'text-red-700' : 'text-ink-700')}>{t.text}</span>
            <button
              type="button"
              title="收起这条提醒；情况有变化（数量、集数变了）时会重新出现"
              onClick={() => {
                mark(project.id, t.key, t.text)
                toast('已标记处理，可在「已处理」里恢复')
              }}
              className="flex shrink-0 items-center gap-1 text-[13px] text-ink-400 hover:text-ink-700"
            >
              <Check size={14} />
              标记已处理
            </button>
            <Link to={t.to} className="shrink-0 text-[13px] font-medium text-brand-600 hover:text-brand-700">
              {t.cta} →
            </Link>
          </li>
        ))}
        {showDone &&
          done.map((t) => (
            <li key={t.key} data-todo-done className="flex items-center gap-3 bg-canvas/50 px-5 py-2.5">
              <CheckCircle2 size={15} className="shrink-0 text-emerald-500" />
              <span className="min-w-0 flex-1 text-[13px] text-ink-400">{t.text}</span>
              <button type="button" onClick={() => restore(project.id, t.key)} className="flex shrink-0 items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900">
                <Undo2 size={14} />
                恢复
              </button>
            </li>
          ))}
      </ul>
      {(todos.length > PREVIEW || done.length > 0) && (
        <div className="flex border-t border-line text-[13px] text-ink-500">
          {todos.length > PREVIEW && (
            <button type="button" onClick={() => setAll((v) => !v)} className="flex-1 py-2.5 hover:text-ink-900">
              {all ? '收起' : `展开全部 ${todos.length} 项`}
            </button>
          )}
          {done.length > 0 && (
            <button type="button" aria-expanded={showDone} onClick={() => setShowDone((v) => !v)} className="flex-1 py-2.5 hover:text-ink-900">
              {showDone ? '隐藏已处理' : `已处理 ${done.length} 项`}
            </button>
          )}
        </div>
      )}
    </Card>
  )
}
