/**
 * 合并剧本的「AI 校对」：文本模型查出没按模板输出的集、人名写法不一、同音错别字，
 * 先列出改法和例句，编剧勾选确认后才写进剧本；被概括掉的台词重整补不回来，提示重新转写那一集。
 */
import clsx from 'clsx'
import { AlertTriangle, RotateCcw, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Modal } from '../../../components/overlay'
import { Button } from '../../../components/ui'
import { modelLabel } from '../../../domain/models'
import type { MergedScript, ModelId, ProofItem, ProofKind } from '../../../domain/types'
import { formatDateTime } from '../../../lib/format'

const GROUPS: { kind: ProofKind; label: string }[] = [
  { kind: 'template', label: '没按模板输出的集' },
  { kind: 'name', label: '人名写法不一' },
  { kind: 'typo', label: '同音错别字' },
]

const epList = (eps: number[]) => `第 ${eps.join('、')} 集`

/** 能改的才可勾选；只剩被概括台词的集校对改不了，只能重新转写 */
export const canApply = (i: ProofItem) => i.count > 0

function ItemCard({ item, on, onToggle, onRetranscribe }: { item: ProofItem; on: boolean; onToggle: () => void; onRetranscribe: (ep: number) => void }) {
  const fixable = canApply(item)
  return (
    <li data-proof-item={item.id} className={clsx('rounded-lg border px-3 py-2.5', fixable && on ? 'border-brand-200 bg-brand-50/30' : 'border-line')}>
      <label className={clsx('flex items-start gap-2', fixable && 'cursor-pointer')}>
        {fixable ? (
          <input type="checkbox" checked={on} onChange={onToggle} aria-label={`应用：${item.text}`} className="mt-1 accent-brand-600" />
        ) : (
          <AlertTriangle size={14} className="mt-[3px] shrink-0 text-amber-500" />
        )}
        <span className="min-w-0 flex-1 text-[13px] font-medium text-ink-900">{item.text}</span>
        <span className="shrink-0 text-xs text-ink-400">
          {!fixable ? '校对改不了' : item.kind === 'template' ? `改 ${item.count} 行` : `${item.count} 处 · ${epList(item.eps)}`}
        </span>
      </label>
      <div className="mt-1.5 space-y-1.5 pl-[22px]">
        {item.problems && (
          <ul className="text-xs leading-5 text-ink-500">
            {item.problems.map((p) => (
              <li key={p.label}>
                · {p.label} {p.count} 处
              </li>
            ))}
          </ul>
        )}
        {item.samples.length > 0 && (
          <ul className="divide-y divide-line rounded-md bg-canvas text-[12.5px] leading-5">
            {item.samples.map((s) => (
              <li key={s.before} className="px-2.5 py-1.5">
                <div className="text-ink-400 line-through">{s.before}</div>
                <div className="text-ink-900">{s.after}</div>
              </li>
            ))}
          </ul>
        )}
        {item.lost && item.ep !== undefined && (
          <div data-proof-lost className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs leading-5 text-amber-900">
            <AlertTriangle size={13} className="shrink-0 text-amber-500" />
            <span className="min-w-0 flex-1">
              {fixable ? '另有' : '有'} {item.lost.count} 处来回的台词被概括成一句叙述（如「{item.lost.sample}」），按模板重整补不回来
            </span>
            <button type="button" data-retranscribe onClick={() => onRetranscribe(item.ep!)} className="flex items-center gap-1 font-medium text-amber-900 underline hover:no-underline">
              <RotateCcw size={12} />
              重新转写第 {item.ep} 集
            </button>
          </div>
        )}
      </div>
    </li>
  )
}

/** 校对结果：分三组列出，默认全选，确认后才写进剧本 */
export function ProofreadDialog({ items, model, onClose, onApply, onRetranscribe }: { items: ProofItem[]; model: ModelId; onClose: () => void; onApply: (picked: ProofItem[]) => void; onRetranscribe: (ep: number) => void }) {
  const [off, setOff] = useState<Set<string>>(new Set())
  const picked = items.filter((i) => canApply(i) && !off.has(i.id))
  const toggle = (id: string) =>
    setOff((s) => {
      const next = new Set(s)
      if (!next.delete(id)) next.add(id)
      return next
    })
  return (
    <Modal
      open
      onClose={onClose}
      width={640}
      title={`AI 校对：查出 ${items.length} 项`}
      desc={`${modelLabel(model)} 校对 · 只按模板重整格式、统一人名写法、改同音错字，不改剧情和台词意思；勾选要改的，确认后才写进剧本`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button disabled={!picked.length} onClick={() => onApply(picked)}>
            应用选中的 {picked.length} 项
          </Button>
        </>
      }
    >
      <div data-proofread-dialog className="scrollbar-thin max-h-[60vh] space-y-4 overflow-y-auto">
        {GROUPS.map((g) => {
          const list = items.filter((i) => i.kind === g.kind)
          if (!list.length) return null
          return (
            <section key={g.kind} data-proof-group={g.kind}>
              <h4 className="mb-1.5 text-xs font-medium text-ink-500">
                {g.label} {list.length}
              </h4>
              <ul className="space-y-2">
                {list.map((i) => (
                  <ItemCard key={i.id} item={i} on={!off.has(i.id)} onToggle={() => toggle(i.id)} onRetranscribe={onRetranscribe} />
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </Modal>
  )
}

/** 合并剧本左栏：最近一次 AI 校对改了什么；还没校对时提醒 */
export function ProofRecordBox({ merged }: { merged: MergedScript }) {
  const r = merged.proofread
  if (!r) {
    return (
      <div data-proofread-record="none" className="rounded-lg border border-dashed border-amber-200 bg-amber-50/50 px-3.5 py-2.5 text-xs leading-5 text-amber-900">
        还没 AI 校对：人名写法不一、同音错字和没按模板输出的集，会原样带进拆解
      </div>
    )
  }
  return (
    <div data-proofread-record="done" className="rounded-lg bg-canvas px-3.5 py-2.5">
      <div className="mb-1.5 flex items-center gap-1 text-xs text-ink-500">
        <Sparkles size={12} className="text-brand-500" />
        AI 校对{r.model ? ` · ${modelLabel(r.model)}` : ''}
        <span className="ml-auto text-ink-400">{formatDateTime(r.at)}</span>
      </div>
      {r.applied.length ? (
        <ul className="space-y-1 text-[13px]">
          {r.applied.map((a) => (
            <li key={a.text} className="flex items-start gap-1.5">
              <span className="flex-1">{a.text}</span>
              <span className="text-ink-500 tabular-nums">{a.count}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-ink-700">{r.found ? `查出 ${r.found} 项，没有应用` : '没发现问题'}</p>
      )}
      {r.applied.length > 0 && r.found > r.applied.length && <p className="mt-1 text-xs text-ink-400">另有 {r.found - r.applied.length} 项没有应用</p>}
    </div>
  )
}
