/**
 * 质检问题上的「AI 修稿」：按这条问题改定稿。先出预览——改了哪几行、哪些留给编剧、对照了哪些设定——
 * 确认后才写进正文，问题记为 AI 已修；重新质检时问题还在的会重新列出来。
 */
import clsx from 'clsx'
import { AlertTriangle, Check, Loader2, ShieldCheck, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Modal } from '../../../components/overlay'
import { AiButton, latestProject, useAiTask } from '../../../components/stage/StageKit'
import { Button } from '../../../components/ui'
import { modelLabel } from '../../../domain/models'
import { speakerLabel } from '../../../domain/scriptFormat'
import type { ModelId, Project, QaIssue, ScriptLine } from '../../../domain/types'
import { plainText, scriptOf } from '../../../domain/work'
import { fixQaIssue } from '../../../services/ai'
import type { QaFix } from '../../../services/ai'
import { useProjects } from '../../../store/projects'
import { toast } from '../../../store/toast'
import { patchScript } from './ops'

/** 落在正文上的问题才能 AI 修稿；付费卡点集纲未审核这类要回到对应环节 */
export const fixableIssue = (p: Project, i: QaIssue) => i.ep !== null && !(i.check === 'paywall' && i.level === 'info') && !!scriptOf(p.work, i.ep)

interface Diff {
  kind: 'edit' | 'add' | 'del'
  no: number
  before?: ScriptLine
  after?: ScriptLine
}

const DIFF = {
  edit: { label: '改', tone: 'bg-amber-50 text-amber-700' },
  add: { label: '加', tone: 'bg-emerald-50 text-emerald-700' },
  del: { label: '删', tone: 'bg-red-50 text-red-600' },
}

/** 按行 id 比对：同一行改了内容、新插入的行、删掉的行 */
function diffLines(before: ScriptLine[], after: ScriptLine[]): Diff[] {
  const old = new Map(before.map((l) => [l.id, l]))
  const kept = new Set(after.map((l) => l.id))
  const out: Diff[] = []
  after.forEach((l, i) => {
    const o = old.get(l.id)
    if (!o) out.push({ kind: 'add', no: i + 1, after: l })
    else if (o.zh !== l.zh || o.speaker !== l.speaker || o.kind !== l.kind || o.en !== l.en) out.push({ kind: 'edit', no: i + 1, before: o, after: l })
  })
  before.forEach((l, i) => !kept.has(l.id) && out.push({ kind: 'del', no: i + 1, before: l }))
  return out.sort((a, b) => a.no - b.no)
}

function lineLabel(l: ScriptLine, en = false) {
  const text = en && l.en ? l.en : plainText(l.zh)
  if (l.kind === 'dialogue') return `${(en ? l.speakerEn : '') || speakerLabel(l) || '（无）'}：${text}`
  return l.kind === 'hook' ? `【集末钩子】${text}` : text
}

function DiffRow({ d }: { d: Diff }) {
  // 只补了英文的行，前后都显示英文
  const enOnly = d.kind === 'edit' && d.before!.zh === d.after!.zh && d.before!.speaker === d.after!.speaker
  return (
    <li data-fix-diff={d.kind} className="grid grid-cols-[28px_minmax(0,1fr)] gap-2 px-3 py-2 text-[12.5px] leading-5">
      <span className={clsx('h-5 rounded text-center text-[11px] leading-5 font-medium', DIFF[d.kind].tone)}>{DIFF[d.kind].label}</span>
      <div className="min-w-0">
        <div className="text-[11px] text-ink-400">
          {d.kind === 'del' ? '原' : ''}第 {d.no} 行{enOnly ? ' · 补译英文' : ''}
        </div>
        {enOnly ? (
          <>
            <div className="text-ink-500">{lineLabel(d.after!)}</div>
            <div className="text-ink-900">{lineLabel(d.after!, true)}</div>
          </>
        ) : (
          <>
            {d.before && <div className={clsx(d.after ? 'text-ink-400 line-through' : 'text-red-600 line-through')}>{lineLabel(d.before)}</div>}
            {d.after && <div className="text-ink-900">{lineLabel(d.after)}</div>}
          </>
        )}
      </div>
    </li>
  )
}

/** look="link"：问题卡片里的小按钮；look="button"：正文页「来自质检」条上的按钮 */
export function QaFixButton({ project, issue, look = 'link' }: { project: Project; issue: QaIssue; look?: 'link' | 'button' }) {
  const patchWork = useProjects((s) => s.patchWork)
  const { running, run } = useAiTask()
  const [fix, setFix] = useState<(QaFix & { model: ModelId; base: ScriptLine[]; at: string }) | null>(null)
  const ep = issue.ep
  if (ep === null || !fixableIssue(project, issue)) return null

  const start = async () => {
    const cur = latestProject(project.id)
    const s = cur && scriptOf(cur.work, ep)
    if (!cur || !s) return
    const result = await run('qa-fix', (signal) => fixQaIssue(cur, s, issue, Date.now() % 997, signal))
    if (result) setFix({ ...result, base: s.lines, at: s.updatedAt })
  }

  const apply = () => {
    const cur = latestProject(project.id)
    const s = cur && scriptOf(cur.work, ep)
    if (!cur || !s || !fix) return
    setFix(null)
    if (s.updatedAt !== fix.at) {
      toast('正文在修稿期间有改动，请重新 AI 修稿', 'error')
      return
    }
    const qa = cur.work.qa
    const mark = (ids: string[] = []) => (ids.includes(issue.id) ? ids : [...ids, issue.id])
    patchWork(
      project.id,
      {
        ...patchScript(cur.work, ep, { lines: fix.lines, ...(fix.translated ? { translated: true } : {}) }),
        ...(qa ? { qa: { ...qa, resolved: mark(qa.resolved), fixed: mark(qa.fixed) } } : {}),
      },
      `AI 修稿：第 ${ep} 集「${issue.title}」`,
    )
    toast(`已按「${issue.title}」改好第 ${ep} 集，重新质检后可交付`)
  }

  const diffs = fix ? diffLines(fix.base, fix.lines) : []
  const busy = running === 'qa-fix'

  return (
    <>
      {look === 'button' ? (
        <AiButton variant="secondary" loading={busy} onClick={start} data-qa-fix>
          AI 修稿
        </AiButton>
      ) : (
        <button type="button" data-qa-fix disabled={busy} onClick={start} title="按这条问题让 AI 改定稿，先预览再写入" className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 disabled:opacity-60">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
          AI 修稿
        </button>
      )}
      {fix && (
        <Modal
          open
          onClose={() => setFix(null)}
          width={620}
          title={`AI 修稿 · 第 ${ep} 集`}
          desc={`按质检问题「${issue.title}」修改定稿 · ${modelLabel(fix.model)} 修稿${diffs.length ? '；确认后才写进正文' : ''}`}
          footer={
            diffs.length ? (
              <>
                <Button variant="secondary" onClick={() => setFix(null)}>
                  取消
                </Button>
                <Button onClick={apply}>应用到定稿</Button>
              </>
            ) : (
              <Button onClick={() => setFix(null)}>知道了</Button>
            )
          }
        >
          <div data-qa-fix-dialog className="space-y-3">
            {fix.changes.length > 0 && (
              <ul className="space-y-1 text-[13px] leading-5">
                {fix.changes.map((c) => (
                  <li key={c} className="flex gap-1.5 text-ink-900">
                    <Check size={14} className="mt-0.5 shrink-0 text-emerald-600" />
                    {c}
                  </li>
                ))}
              </ul>
            )}
            {diffs.length > 0 && <ol className="scrollbar-thin max-h-72 divide-y divide-line overflow-y-auto rounded-lg border border-line">{diffs.map((d) => <DiffRow key={`${d.kind}-${d.no}`} d={d} />)}</ol>}
            {fix.manual.length > 0 && (
              <ul data-fix-manual className="space-y-1 rounded-lg bg-amber-50/70 px-3 py-2 text-[12.5px] leading-5 text-amber-900">
                {fix.manual.map((c) => (
                  <li key={c} className="flex gap-1.5">
                    <AlertTriangle size={13} className="mt-1 shrink-0 text-amber-500" />
                    <span>需人工：{c}</span>
                  </li>
                ))}
              </ul>
            )}
            <div data-fix-checked className="rounded-lg bg-canvas px-3 py-2">
              <div className="flex items-center gap-1 text-xs font-medium text-ink-700">
                <ShieldCheck size={13} className="text-brand-500" />
                已对照原有设定
              </div>
              <ul className="mt-1 space-y-0.5 text-xs leading-5 text-ink-500">
                {fix.checked.map((c) => (
                  <li key={c}>· {c}</li>
                ))}
              </ul>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
