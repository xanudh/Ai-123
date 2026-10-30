import clsx from 'clsx'
import { useState } from 'react'
import { Link } from 'react-router'
import { Modal } from '../../../components/overlay'
import { latestProject } from '../../../components/stage/StageKit'
import { Badge, Button } from '../../../components/ui'
import type { EpisodeDraft, Project } from '../../../domain/types'
import { draftLabel, draftsOf, scriptOf } from '../../../domain/work'
import { useProjects } from '../../../store/projects'
import { toast } from '../../../store/toast'
import { draftPath, finalizeDraft, linesSig, openBlocks } from './ops'

interface Row {
  d: EpisodeDraft
  /** 最近一份审稿里还没解决的严重问题 */
  blocks: number
  /** 审过稿，且审稿后正文没再改过 */
  reviewed: boolean
  /** 本集已有正文，定稿会替换它 */
  replaces: boolean
}

/** 一键定稿的候选：每集最新一版还是草稿（没定稿、也没被新版本取代）的 */
export function finalizeRows(p: Project): Row[] {
  const rows: Row[] = []
  for (let ep = 1; ep <= p.spec.totalEpisodes; ep++) {
    const d = draftsOf(p.work, ep)[0]
    if (!d || d.status !== 'draft') continue
    const last = d.reviews.at(-1)
    rows.push({ d, blocks: openBlocks(p.work, d).length, reviewed: !!last?.sig && last.sig === linesSig(d), replaces: !!scriptOf(p.work, ep) })
  }
  return rows
}

/** 默认勾上的：审过稿、没有严重问题、不替换已有正文 */
const ready = (r: Row) => !r.blocks && r.reviewed && !r.replaces

/** 一键定稿：每集最新的草稿按集号依次定稿；还有严重问题的不能选，跟单集定稿是同一道关口 */
export function FinalizeAll({ project, onClose }: { project: Project; onClose: () => void }) {
  const patchWork = useProjects((s) => s.patchWork)
  const [rows] = useState(() => finalizeRows(project))
  const [on, setOn] = useState(() => new Set(rows.filter(ready).map((r) => r.d.id)))
  const open = rows.filter((r) => !r.blocks)
  const picked = rows.filter((r) => on.has(r.d.id))

  const toggle = (id: string, value: boolean) =>
    setOn((s) => {
      const next = new Set(s)
      if (value) next.add(id)
      else next.delete(id)
      return next
    })

  const confirm = () => {
    let done = 0
    // 按集号依次定稿：前一集的定稿会更新状态库，后一集的本集要点按它提炼
    for (const r of picked) {
      const cur = latestProject(project.id)
      const d = cur?.work.drafts.find((x) => x.id === r.d.id)
      if (!cur || !d || d.status !== 'draft' || openBlocks(cur.work, d).length) continue
      const result = finalizeDraft(cur, d.id)
      if (!result) continue
      patchWork(project.id, result, `一键定稿：第 ${d.ep} 集（${draftLabel(d)}）`)
      done++
    }
    toast(done ? `已定稿 ${done} 集，归入正文章节；状态库与本集要点已更新` : '没有可定稿的集', done ? 'success' : 'error')
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      width={620}
      title="一键定稿"
      desc="每集取最新一版草稿归入正文章节；最近一次审稿还有严重问题的集不能定稿，先改掉或写明理由保留不改"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button disabled={!picked.length} onClick={confirm}>
            定稿 {picked.length || ''} 集
          </Button>
        </>
      }
    >
      <div className="mb-2 flex items-center gap-3 text-xs text-ink-500">
        <span className="tabular-nums">
          已选 {picked.length} / 可定稿 {open.length} 集
        </span>
        <button type="button" className="text-brand-600 hover:text-brand-700" onClick={() => setOn(new Set(open.map((r) => r.d.id)))}>
          全选
        </button>
        <button type="button" className="text-brand-600 hover:text-brand-700" onClick={() => setOn(new Set())}>
          清空
        </button>
      </div>
      <ul data-finalize-all className="max-h-[56vh] space-y-1.5 overflow-y-auto">
        {rows.map((r) => {
          const checked = on.has(r.d.id)
          return (
            <li key={r.d.id} className={clsx('flex items-center gap-2.5 rounded-lg border px-3 py-2', checked ? 'border-brand-200 bg-brand-50/50' : 'border-line', r.blocks && 'opacity-80')}>
              <input
                type="checkbox"
                aria-label={`定稿第 ${r.d.ep} 集`}
                checked={checked}
                disabled={!!r.blocks}
                onChange={(e) => toggle(r.d.id, e.target.checked)}
                className="accent-brand-600 disabled:cursor-not-allowed"
              />
              <span className="shrink-0 text-[13px] font-medium text-ink-900 tabular-nums">第 {r.d.ep} 集</span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink-700">
                {r.d.title || '未命名'}
                <span className="ml-1.5 text-xs text-ink-400">{draftLabel(r.d)}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                {r.blocks ? (
                  <>
                    <Badge tone="red">{r.blocks} 条严重问题</Badge>
                    <Link to={draftPath(project, r.d.id, r.d.reviews.at(-1)?.id)} className="text-xs text-brand-600 hover:text-brand-700">
                      去处理
                    </Link>
                  </>
                ) : r.reviewed ? (
                  <Badge tone="green">已审稿</Badge>
                ) : (
                  <Badge tone="gray">{r.d.reviews.length ? '审稿后改过' : '未审稿'}</Badge>
                )}
                {r.replaces && <Badge tone="amber">替换现有正文</Badge>}
              </span>
            </li>
          )
        })}
      </ul>
    </Modal>
  )
}
