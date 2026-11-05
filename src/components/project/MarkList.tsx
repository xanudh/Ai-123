import clsx from 'clsx'
import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import type { ArchMark, MarkSource } from '../../domain/types'

export const MARK_META: Record<MarkSource, { label: string; tone: string; desc: string }> = {
  given: { label: '原文', tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200', desc: '编剧写明的，直接用' },
  inferred: { label: '推断', tone: 'bg-brand-50 text-brand-700 ring-brand-200', desc: '从依据里推出来的' },
  filled: { label: '补充', tone: 'bg-amber-50 text-amber-800 ring-amber-200', desc: '依据里没有，用题材常识补的；确认时重点看' },
}

/** 现在内容里还对得上的标记：编剧改过的行不再标 */
export function liveMarks(lines: string[], marks: ArchMark[] | undefined) {
  if (!marks?.length) return []
  const pool = [...marks]
  return lines.flatMap((line) => {
    const at = pool.findIndex((m) => m.text.trim() === line.trim())
    return at < 0 ? [] : pool.splice(at, 1)
  })
}

/**
 * AI 生成后附的依据说明：每行标原文 / 推断 / 补充，以及从哪一项来。
 * 默认收起，只显示各有几行；「补充」有内容时标黄提醒。
 */
export function MarkList({ lines, marks, label }: { lines: string[]; marks: ArchMark[] | undefined; label: string }) {
  const [open, setOpen] = useState(false)
  const live = liveMarks(lines, marks)
  if (!live.length) return null
  const count = (src: MarkSource) => live.filter((m) => m.src === src).length
  return (
    <div data-marks={label} className="mt-1.5 text-xs">
      <button type="button" onClick={() => setOpen(!open)} className="flex flex-wrap items-center gap-1.5 text-ink-500 hover:text-ink-900" aria-expanded={open}>
        <ChevronRight size={12} className={clsx('transition-transform', open && 'rotate-90')} />
        依据说明
        {(['given', 'inferred', 'filled'] as const).map((src) =>
          count(src) ? (
            <span key={src} className={clsx('rounded px-1.5 py-px ring-1 ring-inset', MARK_META[src].tone)}>
              {MARK_META[src].label} {count(src)}
            </span>
          ) : null,
        )}
        {count('filled') > 0 && <span className="text-amber-700">· 确认时重点看「补充」</span>}
      </button>
      {open && (
        <ul className="mt-1.5 space-y-1 rounded-lg border border-line bg-canvas/50 px-3 py-2">
          {live.map((m, i) => (
            <li key={i} className="flex items-start gap-2 leading-5">
              <span className={clsx('mt-px shrink-0 rounded px-1.5 ring-1 ring-inset', MARK_META[m.src].tone)} title={MARK_META[m.src].desc}>
                {MARK_META[m.src].label}
              </span>
              <span className="min-w-0 flex-1 text-ink-700">{m.text}</span>
              <span className="shrink-0 text-ink-400">{m.from}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
