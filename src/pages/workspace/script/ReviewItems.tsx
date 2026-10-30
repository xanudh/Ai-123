/**
 * 审核报告里的意见：每条写明依据（哪项设定、原文是什么）和正文里的原句；
 * 修稿后的复审标出改掉 / 仍在 / AI 改不动；编剧可以保留不改（严重问题要写理由），之后的审稿不再提。
 */
import clsx from 'clsx'
import { RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { Modal } from '../../../components/overlay'
import { CHECK_ICON, latestProject } from '../../../components/stage/StageKit'
import { Badge, Button, buttonClass } from '../../../components/ui'
import { STATUS_LABEL, basisLabel, itemKey, keptOf } from '../../../domain/review'
import type { EpisodeDraft, Project, ReviewItem } from '../../../domain/types'
import { useProjects } from '../../../store/projects'
import { toast } from '../../../store/toast'
import { keepIssue, unkeepIssue } from './ops'

const STATUS_TONE = { new: 'violet', still: 'amber', stuck: 'red', back: 'red', fixed: 'green' } as const

/** 在最新数据上记一条保留不改 */
function useKeep(project: Project, ep: number) {
  const patchWork = useProjects((s) => s.patchWork)
  return {
    keep: (item: ReviewItem, reason?: string) => {
      const cur = latestProject(project.id)
      if (!cur) return
      patchWork(project.id, keepIssue(cur.work, ep, item, reason), `保留不改：第 ${ep} 集「${item.text}」`)
      toast('已保留不改：之后的审稿不再提这条')
    },
    unkeep: (key: string) => {
      const cur = latestProject(project.id)
      if (!cur) return
      patchWork(project.id, unkeepIssue(cur.work, ep, key), `撤销保留：第 ${ep} 集`)
    },
  }
}

/** 依据与原句：依据写设定里的那句话，原句可点，定位到正文那一行 */
function Evidence({ item, onLocate }: { item: ReviewItem; onLocate?: (lineId: string) => void }) {
  if (!item.ref && !item.quote) return null
  return (
    <div className="mt-1 space-y-0.5 text-xs leading-5 text-ink-500">
      {item.ref && (
        <div data-review-ref>
          <span className="text-ink-400">依据：</span>
          {item.ref}
        </div>
      )}
      {item.quote && (
        <div>
          <span className="text-ink-400">原文：</span>
          {item.lineId && onLocate ? (
            <button type="button" data-review-quote onClick={() => onLocate(item.lineId!)} className="text-left text-ink-700 hover:text-brand-600 hover:underline" title="在正文里定位到这一行">
              「{item.quote}」
            </button>
          ) : (
            <span className="text-ink-700">「{item.quote}」</span>
          )}
        </div>
      )}
    </div>
  )
}

function ItemRow({ project, ep, item, canKeep, onLocate }: { project: Project; ep: number; item: ReviewItem; canKeep: boolean; onLocate?: (lineId: string) => void }) {
  const { keep, unkeep } = useKeep(project, ep)
  const kept = keptOf(project.work.keeps, ep).get(itemKey(item))
  const [asking, setAsking] = useState(false)
  const [reason, setReason] = useState('')
  const open = item.level === 'block' || item.level === 'warn'
  return (
    <li data-review-item={itemKey(item)} data-status={item.status} className={clsx('flex gap-2 text-[13px] leading-5', kept ? 'text-ink-400' : item.level === 'block' ? 'text-red-700' : item.level === 'warn' ? 'text-amber-900' : 'text-ink-700')}>
      {CHECK_ICON[item.level]}
      <div className="min-w-0 flex-1">
        <span className={clsx(kept && 'line-through decoration-ink-300')}>{item.text}</span>
        {(item.basis || item.status) && (
          <span className="ml-1.5 inline-flex flex-wrap gap-1 align-[1px]">
            {item.basis && <Badge>{basisLabel(item.basis)}</Badge>}
            {item.status && <Badge tone={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</Badge>}
          </span>
        )}
        <Evidence item={item} onLocate={onLocate} />
        {kept ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-ink-500">
            <span data-kept>已保留不改{kept.reason ? `：${kept.reason}` : ''}</span>
            <button type="button" onClick={() => unkeep(kept.key)} className="flex items-center gap-0.5 text-brand-600 hover:text-brand-700">
              <RotateCcw size={11} />
              撤销
            </button>
          </div>
        ) : (
          open &&
          canKeep &&
          (asking ? (
            <form
              className="mt-1.5 flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault()
                if (!reason.trim()) return
                keep(item, reason)
                setAsking(false)
              }}
            >
              <input
                autoFocus
                aria-label="保留理由"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setAsking(false)}
                placeholder="严重问题要写理由，如：这里是刻意的反常"
                className="h-7 min-w-0 flex-1 rounded-md border border-line bg-white px-2 text-xs text-ink-900 focus:border-brand-400 focus:outline-none"
              />
              <button type="submit" disabled={!reason.trim()} className={buttonClass('secondary', 'sm')}>
                保留
              </button>
              <button type="button" onClick={() => setAsking(false)} className={buttonClass('ghost', 'sm')}>
                取消
              </button>
            </form>
          ) : (
            <button
              type="button"
              data-keep
              onClick={() => (item.level === 'block' ? setAsking(true) : keep(item))}
              title={item.level === 'block' ? '严重问题保留不改要写理由' : '一键保留：之后的审稿不再提'}
              className="mt-0.5 text-xs text-ink-400 hover:text-brand-600"
            >
              保留不改
            </button>
          ))
        )}
      </div>
    </li>
  )
}

/** 一份审核报告的全部意见：没解决的在前，复审里已改掉的收在最后 */
export function ReviewItems({ project, ep, items, canKeep, onLocate }: { project: Project; ep: number; items: ReviewItem[]; canKeep: boolean; onLocate?: (lineId: string) => void }) {
  const fixed = items.filter((i) => i.status === 'fixed')
  const rest = items.filter((i) => i.status !== 'fixed')
  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {rest.map((i) => (
          <ItemRow key={itemKey(i)} project={project} ep={ep} item={i} canKeep={canKeep} onLocate={onLocate} />
        ))}
      </ul>
      {fixed.length > 0 && (
        <details data-review-fixed className="group text-xs">
          <summary className="cursor-pointer list-none text-emerald-700 hover:text-emerald-800">已改掉 {fixed.length} 条 ▸</summary>
          <ul className="mt-1.5 space-y-1.5">
            {fixed.map((i) => (
              <ItemRow key={itemKey(i)} project={project} ep={ep} item={i} canKeep={false} />
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

/** 本集保留不改的意见：之后的审稿都不再提，可撤销 */
export function KeptList({ project, ep }: { project: Project; ep: number }) {
  const { unkeep } = useKeep(project, ep)
  const kept = [...keptOf(project.work.keeps, ep).values()]
  if (!kept.length) return null
  return (
    <details data-kept-list className="mx-3 rounded-lg border border-line px-3 py-2 text-xs">
      <summary className="cursor-pointer list-none text-ink-500 hover:text-ink-900">本集保留不改 {kept.length} 条：审稿不再提 ▸</summary>
      <ul className="mt-2 space-y-1.5">
        {kept.map((k) => (
          <li key={k.key} className="flex items-start justify-between gap-2">
            <span className="min-w-0 text-ink-700">
              {k.level === 'block' && <span className="text-red-600">严重 · </span>}
              {k.text}
              {k.reason && <span className="text-ink-400"> —— {k.reason}</span>}
            </span>
            <button type="button" onClick={() => unkeep(k.key)} className="shrink-0 text-brand-600 hover:text-brand-700">
              撤销
            </button>
          </li>
        ))}
      </ul>
    </details>
  )
}

/**
 * 定稿前的关口：最近一份审稿里还有没解决的严重问题时弹出——要么回去改，要么逐条写明理由保留不改。
 * 正文在审稿后改过时，提示先重新审稿确认。
 */
export function FinalGate({ project, draft, items, stale, onClose, onReview, onPass }: { project: Project; draft: EpisodeDraft; items: ReviewItem[]; stale: boolean; onClose: () => void; onReview: () => void; onPass: () => void }) {
  const patchWork = useProjects((s) => s.patchWork)
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const ready = items.every((i) => reasons[itemKey(i)]?.trim())
  const keepAll = () => {
    const cur = latestProject(project.id)
    if (!cur) return
    const work = items.reduce((w, i) => ({ ...w, ...keepIssue(w, draft.ep, i, reasons[itemKey(i)]) }), cur.work)
    patchWork(project.id, { keeps: work.keeps }, `保留不改 ${items.length} 个严重问题：第 ${draft.ep} 集`)
    onPass()
  }
  return (
    <Modal
      open
      onClose={onClose}
      width={560}
      title={`还有 ${items.length} 个严重问题没解决`}
      desc="严重问题要么改掉，要么写明理由保留不改，才能定稿；保留的意见之后的审稿不再提。"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            回去修改
          </Button>
          <Button disabled={!ready} onClick={keepAll} title={ready ? undefined : '每条都写上保留的理由'}>
            保留并定稿
          </Button>
        </>
      }
    >
      <div data-final-gate className="max-h-[50vh] space-y-3 overflow-y-auto">
        {stale && (
          <p className="flex flex-wrap items-center gap-x-2 rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
            正文在这份审稿之后改过：如果已经改掉了，
            <button type="button" onClick={onReview} className="font-medium text-amber-900 underline hover:no-underline">
              先重新审稿确认
            </button>
          </p>
        )}
        <ul className="space-y-3">
          {items.map((i) => (
            <li key={itemKey(i)} className="text-[13px] leading-5">
              <div className="flex gap-2 text-red-700">
                {CHECK_ICON.block}
                <span className="min-w-0">
                  {i.text}
                  {i.basis && <Badge className="ml-1.5 align-[1px]">{basisLabel(i.basis)}</Badge>}
                  {i.status && <Badge tone={STATUS_TONE[i.status]} className="ml-1 align-[1px]">{STATUS_LABEL[i.status]}</Badge>}
                </span>
              </div>
              <div className="pl-[22px]">
                <Evidence item={i} />
                <input
                  aria-label={`保留理由：${i.text}`}
                  value={reasons[itemKey(i)] ?? ''}
                  onChange={(e) => setReasons((r) => ({ ...r, [itemKey(i)]: e.target.value }))}
                  placeholder="保留不改的理由（必填）"
                  className="mt-1.5 h-8 w-full rounded-md border border-line bg-white px-2.5 text-[13px] text-ink-900 focus:border-brand-400 focus:outline-none"
                />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  )
}
