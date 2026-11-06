import clsx from 'clsx'
import { AlertTriangle, RotateCcw, X } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { defaultRhythm, validateRhythm } from '../../domain/rhythm'
import type { RhythmFrame } from '../../domain/types'
import { Button, Field, Input, Segmented } from '../ui'
import { RhythmChart } from './RhythmChart'
import type { RhythmCompare } from './RhythmChart'

function EpisodeListEditor({
  label,
  marker,
  values,
  total,
  onChange,
  disabled,
}: {
  label: string
  marker: React.ReactNode
  values: number[]
  total: number
  onChange: (v: number[]) => void
  /** 故事架构确认后只读 */
  disabled?: boolean
}) {
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)

  const add = () => {
    const n = Number(input)
    if (!Number.isInteger(n) || n < 1 || n > total) {
      setError(`请输入 1–${total} 之间的集数`)
      return
    }
    setError(null)
    setInput('')
    if (!values.includes(n)) onChange([...values, n].sort((a, b) => a - b))
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-ink-700">
        {marker}
        {label}
      </div>
      <div className={clsx('flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-line px-2 py-1.5', disabled ? 'bg-canvas/60' : 'bg-white')}>
        {values.map((v) => (
          <span key={v} className={clsx('inline-flex h-7 items-center gap-1 rounded-md bg-canvas text-[13px] tabular-nums', disabled ? 'px-2' : 'pr-1 pl-2')}>
            第 {v} 集
            {!disabled && (
              <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} className="rounded p-0.5 text-ink-400 hover:bg-ink-900/5 hover:text-ink-700" aria-label={`移除第 ${v} 集`}>
                <X size={12} />
              </button>
            )}
          </span>
        ))}
        {disabled && !values.length && <span className="px-1 text-[13px] text-ink-400">无</span>}
        {!disabled && (
          <input
            value={input}
            onChange={(e) => {
              setInput(e.target.value.replace(/\D/g, ''))
              setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                add()
              }
            }}
            onBlur={() => input && add()}
            placeholder="+ 集数"
            inputMode="numeric"
            aria-label={`添加${label}`}
            className="h-7 w-16 bg-transparent px-1 text-[13px] placeholder:text-ink-400 focus:outline-none"
          />
        )}
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}

/**
 * 节奏框架的三项：付费卡点集（第一个即首付费）、大反转集、结局高潮起始集，输入集数设置。
 * 故事架构里直接放在冲突主线表格下面（11/5），曲线另外收起
 */
export function RhythmFields({
  rhythm,
  total,
  onChange,
  disabled,
}: {
  rhythm: RhythmFrame
  total: number
  onChange: (r: RhythmFrame) => void
  /** 故事架构确认后只读，不提示问题 */
  disabled?: boolean
}) {
  const issues = disabled ? [] : validateRhythm(rhythm, total)
  const setRhythm = (p: Partial<RhythmFrame>) => onChange({ ...rhythm, ...p })

  return (
    <div data-rhythm-fields className="space-y-3">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <EpisodeListEditor
          label="付费卡点集（第一个即首付费）"
          marker={<span className="size-2 rotate-45 rounded-[2px] bg-paywall" />}
          values={rhythm.paywalls}
          total={total}
          onChange={(paywalls) => setRhythm({ paywalls })}
          disabled={disabled}
        />
        <EpisodeListEditor
          label="大反转集"
          marker={<span className="size-2 rounded-full bg-twist" />}
          values={rhythm.twists}
          total={total}
          onChange={(twists) => setRhythm({ twists })}
          disabled={disabled}
        />
        <Field label="结局高潮起始集" hint={`第 ${rhythm.climaxFrom}–${total} 集为结局高潮区，情绪持续拉满`}>
          {disabled ? (
            <div aria-label="结局高潮起始集" className="flex h-10 w-28 items-center rounded-lg border border-line bg-canvas/60 px-3 text-sm tabular-nums">
              {rhythm.climaxFrom}
            </div>
          ) : (
            <Input
              type="number"
              aria-label="结局高潮起始集"
              min={1}
              max={total}
              value={rhythm.climaxFrom}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (Number.isInteger(n) && n >= 1 && n <= total) setRhythm({ climaxFrom: n })
              }}
              className="w-28 tabular-nums"
            />
          )}
        </Field>
      </div>

      {issues.length > 0 && (
        <ul className="space-y-1.5">
          {issues.map((i) => (
            <li
              key={i.text}
              className={clsx('flex items-start gap-2 rounded-lg px-3 py-2 text-[13px]', i.level === 'error' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800')}
            >
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              {i.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** 节奏曲线编辑：点曲线设置付费卡点 / 大反转；三项集数在 RhythmFields 里改 */
export function RhythmCurveEditor({
  rhythm,
  total,
  onChange,
  recommended,
  chartFooter,
  compare,
}: {
  rhythm: RhythmFrame
  total: number
  onChange: (r: RhythmFrame) => void
  /** 「恢复推荐」用的节奏；不传时按总集数取默认节奏 */
  recommended?: RhythmFrame
  /** 曲线下方的附加内容，如冲突主线分段 */
  chartFooter?: ReactNode
  /** 叠在曲线上的对标剧对比线 */
  compare?: RhythmCompare
}) {
  const [brush, setBrush] = useState<'paywalls' | 'twists'>('paywalls')

  const pick = (ep: number) => {
    const list = rhythm[brush]
    onChange({ ...rhythm, [brush]: list.includes(ep) ? list.filter((x) => x !== ep) : [...list, ep].sort((a, b) => a - b) })
  }

  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[13px] text-ink-500">
          点击曲线设置
          <Segmented
            value={brush}
            onChange={setBrush}
            options={[
              { value: 'paywalls', label: '付费卡点' },
              { value: 'twists', label: '大反转' },
            ]}
          />
        </div>
        <Button variant="ghost" size="sm" onClick={() => onChange(recommended ?? defaultRhythm(total))}>
          <RotateCcw size={13} />
          恢复推荐
        </Button>
      </div>
      <RhythmChart rhythm={rhythm} total={total} onPick={pick} compare={compare} />
      {chartFooter}
    </div>
  )
}
