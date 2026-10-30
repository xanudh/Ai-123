import clsx from 'clsx'
import { Check, ChevronDown } from 'lucide-react'
import { forwardRef, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { useDismiss } from '../lib/useDismiss'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg' | 'caret'

const buttonBase =
  'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50'

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white shadow-sm hover:bg-brand-700 active:bg-brand-800',
  secondary: 'border border-line bg-white text-ink-900 shadow-sm hover:bg-canvas',
  ghost: 'text-ink-700 hover:bg-ink-900/5',
  danger: 'bg-red-600 text-white shadow-sm hover:bg-red-700',
}

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-9 px-4 text-sm',
  lg: 'h-11 px-5 text-[15px]',
  // 拆分按钮右侧的 ▾：和 sm 同高、窄一些
  caret: 'h-8 w-6 text-[13px]',
}

export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', className?: string) {
  return clsx(buttonBase, buttonVariants[variant], buttonSizes[size], className)
}

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }
>(function Button({ variant = 'primary', size = 'md', className, type = 'button', ...rest }, ref) {
  return <button ref={ref} type={type} className={buttonClass(variant, size, className)} {...rest} />
})

type BadgeTone = 'gray' | 'violet' | 'amber' | 'green' | 'red' | 'orange'

const badgeTones: Record<BadgeTone, string> = {
  gray: 'bg-ink-900/[0.06] text-ink-700',
  violet: 'bg-brand-100 text-brand-700',
  amber: 'bg-amber-100 text-amber-800',
  green: 'bg-emerald-100 text-emerald-800',
  red: 'bg-red-100 text-red-700',
  orange: 'bg-orange-100 text-orange-800',
}

/** 信息行里的分隔圆点：挂在每项前面，换行时圆点跟着这一项走，不会悬在行尾 */
export const dotBefore = "before:mr-2 before:text-ink-300 before:content-['·']"

export function Badge({ tone = 'gray', children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4', badgeTones[tone], className)}>
      {children}
    </span>
  )
}

export function Card({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <div id={id} className={clsx('rounded-xl border border-line bg-white shadow-card', className)}>
      {children}
    </div>
  )
}

export function CardHeader({ title, desc, action }: { title: ReactNode; desc?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
      <div>
        <h3 className="text-[15px] font-semibold text-ink-900">{title}</h3>
        {desc && <p className="mt-0.5 text-[13px] text-ink-500">{desc}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

export function Field({
  label,
  required,
  hint,
  error,
  children,
  aside,
}: {
  label: ReactNode
  required?: boolean
  hint?: ReactNode
  error?: string | null
  children: ReactNode
  aside?: ReactNode
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label className="text-[13px] font-medium text-ink-700">
          {label}
          {required && <span className="ml-0.5 text-red-500">*</span>}
        </label>
        {aside}
      </div>
      {children}
      {error ? (
        <p className="mt-1.5 text-xs text-red-600">{error}</p>
      ) : (
        hint && <p className="mt-1.5 text-xs text-ink-500">{hint}</p>
      )}
    </div>
  )
}

/**
 * 调用方传了同类工具类就不加默认值。不能简单叠加：Tailwind 按值排序输出，
 * 同时写 w-full 和 w-28、h-10 和 h-8 时，CSS 里排在后面的那个总会生效，与 class 顺序无关。
 */
const unlessGiven = (className: string | undefined, prefix: RegExp, fallback: string) => (className?.split(/\s+/).some((c) => prefix.test(c)) ? undefined : fallback)

/** 输入框默认占满一行；调用方传了宽度（w-*）就用调用方的 */
export const fillWidth = (className?: string) => unlessGiven(className, /^w-/, 'w-full')

/** 默认高度与左右内边距，同样可被调用方的 h-* / px-* / pl-* / pr-* 覆盖 */
const fieldSize = (className: string | undefined, height?: string) => clsx(unlessGiven(className, /^p[xlr]-/, 'px-3'), height && unlessGiven(className, /^h-/, height))

const inputBase =
  'rounded-lg border bg-white text-sm text-ink-900 placeholder:text-ink-400 transition-colors focus:outline-none focus:ring-3 focus:ring-brand-500/15'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className, invalid, ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={clsx(inputBase, fillWidth(className), fieldSize(className, 'h-10'), invalid ? 'border-red-400 focus:border-red-500' : 'border-line focus:border-brand-500', className)}
        {...rest}
      />
    )
  },
)

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function Textarea({ className, invalid, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        className={clsx(inputBase, fillWidth(className), fieldSize(className), 'resize-none py-2.5 leading-relaxed', invalid ? 'border-red-400' : 'border-line focus:border-brand-500', className)}
        {...rest}
      />
    )
  },
)

export function Select({ className, invalid, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select
      className={clsx(inputBase, fillWidth(className), fieldSize(className, 'h-10'), 'disabled:bg-canvas disabled:text-ink-700', invalid ? 'border-red-400 focus:border-red-500' : 'border-line focus:border-brand-500', className)}
      {...rest}
    />
  )
}

/**
 * 可直接键入的整数（集数等）：回车或失焦时生效，并限制在 min–max；↑ / ↓ 逐个加减，Esc 撤销输入。
 * 打字途中的半截数字（想输 15 先敲了 1）不会立刻生效。
 */
export function NumberInput({
  value,
  min,
  max,
  onCommit,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'min' | 'max' | 'type' | 'onChange'> & { value: number; min: number; max: number; onCommit: (value: number) => void }) {
  const [text, setText] = useState<string | null>(null)
  const commit = (n: number) => {
    setText(null)
    if (!Number.isFinite(n)) return
    const v = Math.min(max, Math.max(min, Math.round(n)))
    if (v !== value) onCommit(v)
  }
  return (
    <Input
      {...rest}
      type="text"
      inputMode="numeric"
      value={text ?? String(value)}
      onChange={(e) => setText(e.target.value.replace(/\D/g, ''))}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => text !== null && commit(text ? Number(text) : NaN)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          if (text !== null) commit(text ? Number(text) : NaN)
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault()
          commit(Number(text || value) + (e.key === 'ArrowUp' ? 1 : -1))
        } else if (e.key === 'Escape' && text !== null) {
          // 只撤销输入，不连带关闭外层面板
          e.stopPropagation()
          setText(null)
        }
      }}
      className={clsx('text-center tabular-nums', className)}
    />
  )
}

/** 可多选的标签按钮 */
export function Chip({
  selected,
  disabled,
  onClick,
  children,
}: {
  selected: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'h-8 rounded-lg border px-3 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        selected
          ? 'border-brand-500 bg-brand-50 font-medium text-brand-700'
          : 'border-line bg-white text-ink-700 hover:border-ink-300',
      )}
    >
      {children}
    </button>
  )
}

/** 多选下拉框：已选项以标签显示在框内，达到上限后其余选项禁用 */
export function MultiSelect({
  value,
  options,
  onChange,
  max = Infinity,
  placeholder = '请选择',
  invalid,
}: {
  value: string[]
  options: readonly string[]
  onChange: (v: string[]) => void
  max?: number
  placeholder?: string
  invalid?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useDismiss(ref, open, setOpen)

  const toggle = (o: string) => {
    if (value.includes(o)) onChange(value.filter((x) => x !== o))
    else if (value.length < max) onChange([...value, o])
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          inputBase,
          'flex min-h-10 w-full items-center gap-2 py-1.5 text-left',
          invalid ? 'border-red-400 focus:border-red-500' : open ? 'border-brand-500' : 'border-line focus:border-brand-500',
        )}
      >
        <span className="flex min-w-0 flex-1 flex-wrap gap-1">
          {value.length ? (
            value.map((v) => (
              <span key={v} className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[13px] leading-5 text-brand-700">
                {v}
              </span>
            ))
          ) : (
            <span className="text-ink-400">{placeholder}</span>
          )}
        </span>
        <ChevronDown size={16} className={clsx('shrink-0 text-ink-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div
          role="listbox"
          aria-multiselectable="true"
          className="scrollbar-thin absolute inset-x-0 top-full z-30 mt-1 max-h-64 animate-fade-in overflow-y-auto rounded-lg border border-line bg-white p-1 shadow-pop"
        >
          {options.map((o) => {
            const selected = value.includes(o)
            return (
              <button
                key={o}
                type="button"
                role="option"
                aria-selected={selected}
                disabled={!selected && value.length >= max}
                onClick={() => toggle(o)}
                className={clsx(
                  'flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-[13px] disabled:cursor-not-allowed disabled:opacity-40',
                  selected ? 'font-medium text-brand-700' : 'text-ink-700',
                  'enabled:hover:bg-canvas',
                )}
              >
                {o}
                {selected && <Check size={14} strokeWidth={2.5} />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** 单选分段控件 */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-canvas p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'h-8 rounded-md px-3.5 text-[13px] transition-colors',
            o.value === value ? 'bg-white font-medium text-ink-900 shadow-card' : 'text-ink-500 hover:text-ink-900',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function EmptyState({ icon, title, desc, action }: { icon: ReactNode; title: string; desc?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-brand-50 text-brand-600">{icon}</div>
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {desc && <p className="mt-1 max-w-sm text-sm text-ink-500">{desc}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
