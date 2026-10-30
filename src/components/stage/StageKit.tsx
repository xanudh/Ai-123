/** 各创作环节页面共用的小组件与 AI 任务钩子 */
import clsx from 'clsx'
import { AlertTriangle, ArrowRight, CircleCheck, Info, Loader2, OctagonX, Sparkles } from 'lucide-react'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'
import { Link } from 'react-router'
import type { StageGate } from '../../domain/work'
import { RELATION_KINDS } from '../../domain/constants'
import { STAGES } from '../../domain/pipeline'
import type { Project, StageKey } from '../../domain/types'
import { useProjects } from '../../store/projects'
import { toast } from '../../store/toast'
import { Badge, Button, fillWidth } from '../ui'

export const stagePath = (project: Project, key: StageKey) => (key === 'overview' ? `/projects/${project.id}` : `/projects/${project.id}/stage/${key}`)

/** AI 返回时读取最新的项目，避免覆盖等待期间的编辑 */
export const latestProject = (id: string) => useProjects.getState().projects.find((p) => p.id === id)

/**
 * 可取消的 AI 任务：同一时间只跑一个，离开页面自动取消；失败统一提示。
 * running 为当前任务的标识，用来决定哪个按钮显示加载状态。
 */
export function useAiTask() {
  const [running, setRunning] = useState<string | null>(null)
  const ctrl = useRef<AbortController | null>(null)

  useEffect(() => () => ctrl.current?.abort(), [])

  const run = useCallback(async <T,>(key: string, task: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> => {
    ctrl.current?.abort()
    const c = new AbortController()
    ctrl.current = c
    setRunning(key)
    try {
      return await task(c.signal)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast('生成失败，请重试', 'error')
      return undefined
    } finally {
      if (ctrl.current === c) {
        ctrl.current = null
        setRunning(null)
      }
    }
  }, [])

  const cancel = useCallback(() => {
    ctrl.current?.abort()
    ctrl.current = null
    setRunning(null)
  }, [])

  return { running, run, cancel }
}

export function AiButton({
  loading,
  children,
  variant = 'primary',
  size = 'sm',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; variant?: 'primary' | 'secondary' | 'ghost'; size?: 'sm' | 'md' }) {
  return (
    <Button variant={variant} size={size} aria-busy={loading || undefined} {...rest} disabled={rest.disabled || loading}>
      {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
      {children}
    </Button>
  )
}

/** 上游环节未完成时的提示条 */
export function GateNotice({ project, gate }: { project: Project; gate: StageGate }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-3.5">
      <div className="flex items-center gap-2 text-[13px] text-amber-900">
        <AlertTriangle size={15} className="shrink-0 text-amber-600" />
        {gate.reason}，本环节的 AI 生成暂不可用
      </div>
      <Link to={stagePath(project, gate.to)} className="flex items-center gap-1 text-[13px] font-medium text-amber-900 hover:underline">
        去{STAGES[gate.to].label}
        <ArrowRight size={14} />
      </Link>
    </div>
  )
}

export function ReviewBadge({ approved, pendingText = '待审核' }: { approved: boolean; pendingText?: string }) {
  return approved ? <Badge tone="green">已确认</Badge> : <Badge tone="amber">{pendingText}</Badge>
}

/** 未生成内容的占位条 */
export function Skeleton({ className }: { className?: string }) {
  return <span className={clsx('inline-block h-2.5 rounded bg-ink-900/[0.06]', className ?? 'w-24')} />
}

export function Table({ columns, children, minWidth = 560 }: { columns: ReactNode[]; children: ReactNode; minWidth?: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[13px]" style={{ minWidth }}>
        <thead>
          <tr className="border-b border-line text-xs text-ink-500">
            {columns.map((c, i) => (
              <th key={i} className="px-4 py-2.5 font-medium whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  )
}

/** 宽度不写死：默认 w-full，调用方可以用 w-* 覆盖（见 fillWidth） */
const inlineField =
  'rounded-md border border-transparent bg-transparent px-2 py-1.5 text-[13px] leading-relaxed text-ink-900 placeholder:text-ink-300 transition-colors hover:border-line focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-3 focus:ring-brand-500/15 disabled:hover:border-transparent'

const boxedField =
  'rounded-lg border border-line bg-white px-3 py-2 text-sm leading-relaxed text-ink-900 placeholder:text-ink-400 transition-colors focus:border-brand-500 focus:outline-none focus:ring-3 focus:ring-brand-500/15 disabled:bg-canvas disabled:text-ink-700'

/** 随内容自动增高的多行输入框；inline 样式用于表格内编辑 */
export const AutoTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { inline?: boolean; minRows?: number }>(
  function AutoTextarea({ inline, minRows = 1, className, value, ...rest }, outer) {
    const ref = useRef<HTMLTextAreaElement>(null)
    useImperativeHandle(outer, () => ref.current!)
    useLayoutEffect(() => {
      const el = ref.current
      if (!el) return
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight + 2}px`
    }, [value])
    return <textarea ref={ref} rows={minRows} value={value} className={clsx('block resize-none', inline ? inlineField : boxedField, fillWidth(className), className)} {...rest} />
  },
)

/** 表格内的单行输入 */
export function InlineInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clsx(inlineField, fillWidth(className), className)} {...rest} />
}

/** 关系类型的候选项：配合 `<input list="relation-kinds">` 使用，也可以自己填 */
export function RelationKindList() {
  return (
    <datalist id="relation-kinds">
      {RELATION_KINDS.map((k) => (
        <option key={k} value={k} />
      ))}
    </datalist>
  )
}

/** 集数输入：失焦时收回到 1–max */
export function EpisodeInput({ value, max, onChange, disabled, label }: { value: number; max: number; onChange: (v: number) => void; disabled?: boolean; label: string }) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const commit = () => {
    const n = Math.round(Number(text))
    const v = Number.isFinite(n) && text.trim() ? Math.min(max, Math.max(1, n)) : value
    setText(String(v))
    if (v !== value) onChange(v)
  }
  return (
    <input
      aria-label={label}
      inputMode="numeric"
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className={clsx(inlineField, 'w-16 shrink-0 text-center tabular-nums')}
    />
  )
}

export interface CheckItem {
  level: 'block' | 'warn' | 'info' | 'ok'
  text: string
}

export const CHECK_ICON = {
  block: <OctagonX size={14} className="mt-[3px] shrink-0 text-red-500" />,
  warn: <AlertTriangle size={14} className="mt-[3px] shrink-0 text-amber-500" />,
  info: <Info size={14} className="mt-[3px] shrink-0 text-ink-400" />,
  ok: <CircleCheck size={14} className="mt-[3px] shrink-0 text-emerald-500" />,
}

/** 文案里「第 N 集」「第 3、5 集」「第 3–4 集」的集号做成可点的跳转 */
function EpLinks({ text, onEp }: { text: string; onEp: (ep: number) => void }) {
  return text.split(/(第 [\d、–]+ 集)/).map((part, i) =>
    i % 2 ? (
      <span key={i}>
        {part.split(/(\d+)/).map((s, k) =>
          k % 2 ? (
            <button key={k} type="button" data-ep-link={s} onClick={() => onEp(Number(s))} className="font-medium text-brand-600 underline decoration-brand-200 underline-offset-2 hover:text-brand-700">
              {s}
            </button>
          ) : (
            s
          ),
        )}
      </span>
    ) : (
      part
    ),
  )
}

export function CheckList({ items, empty = '检查通过', onEp }: { items: CheckItem[]; empty?: string; onEp?: (ep: number) => void }) {
  if (!items.length) {
    return (
      <p className="flex items-center gap-2 text-[13px] text-emerald-700">
        {CHECK_ICON.ok}
        {empty}
      </p>
    )
  }
  return (
    <ul className="space-y-1.5">
      {items.map((c, i) => (
        <li key={i} className={clsx('flex gap-2 text-[13px] leading-5', c.level === 'block' ? 'text-red-700' : c.level === 'warn' ? 'text-amber-900' : 'text-ink-700')}>
          {CHECK_ICON[c.level]}
          <span className="min-w-0">{onEp ? <EpLinks text={c.text} onEp={onEp} /> : c.text}</span>
        </li>
      ))}
    </ul>
  )
}

/** 小号统计块 */
export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'green' | 'amber' | 'red' }) {
  return (
    <div className="rounded-lg bg-canvas px-3.5 py-2.5">
      <div className="text-xs text-ink-500">{label}</div>
      <div
        className={clsx(
          'mt-0.5 text-[15px] font-semibold tabular-nums',
          tone === 'green' ? 'text-emerald-700' : tone === 'amber' ? 'text-amber-700' : tone === 'red' ? 'text-red-600' : 'text-ink-900',
        )}
      >
        {value}
      </div>
    </div>
  )
}
