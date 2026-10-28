import clsx from 'clsx'
import { ArrowLeft, ArrowRight, ClipboardCheck, FileText, Info, Layers, StickyNote, X } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { ConfirmDialog } from '../../../components/overlay'
import { AiButton, CheckList, InlineInput, latestProject, useAiTask } from '../../../components/stage/StageKit'
import { Badge, Card, CardHeader, EmptyState, buttonClass } from '../../../components/ui'
import { DRAFT_STATUS_META } from '../../../domain/constants'
import type { DraftReview, EpisodeDraft } from '../../../domain/types'
import { blueprintOf, draftLabel, draftsOf, scriptOf, wordCount } from '../../../domain/work'
import { formatDateTime } from '../../../lib/format'
import { newId } from '../../../lib/id'
import { nextSeed, reviewDraft, reviseDraft } from '../../../services/ai'
import { useProjects } from '../../../store/projects'
import { useStateFocus } from '../../../store/statePanel'
import { toast } from '../../../store/toast'
import { useCurrentProject } from '../ProjectLayout'
import { ScriptEditor } from './ScriptEditor'
import type { Updater } from './ScriptEditor'
import { MAX_REVISE_ROUNDS, REVIEW_SCOPE, addDraft, draftPath, finalPath, finalizeDraft, linesSig, patchDraft, reviewCounts, reviseRounds, scriptStagePath } from './ops'

/** 定稿按钮：绿色主按钮 */
const finalButton =
  'inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-[13px] font-medium text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50'

export default function DraftPage() {
  const project = useCurrentProject()
  const { draftId } = useParams()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const patchWork = useProjects((s) => s.patchWork)
  const { running, run } = useAiTask()
  const [confirmFinal, setConfirmFinal] = useState(false)

  const draft = project.work.drafts.find((d) => d.id === draftId)
  useStateFocus(draft ? { kind: 'ep', ep: draft.ep, draftId: draft.id } : null)
  if (!draft) {
    return (
      <Card>
        <EmptyState
          icon={<FileText size={22} />}
          title="草稿不存在"
          desc="它可能已被删除。"
          action={
            <Link to={scriptStagePath(project)} className={buttonClass()}>
              返回逐集剧本
            </Link>
          }
        />
      </Card>
    )
  }

  const w = project.work
  const editable = draft.status === 'draft'
  const meta = DRAFT_STATUS_META[draft.status]
  const newest = draftsOf(w, draft.ep)[0]
  const final = scriptOf(w, draft.ep)
  const blueprint = blueprintOf(w, draft.ep)
  const reviews = [...draft.reviews].reverse()
  const review = draft.reviews.find((r) => r.id === params.get('review'))
  const reviewNo = (r: DraftReview) => draft.reviews.indexOf(r) + 1
  // 兜底：修稿轮数有上限；正文没改过不重复审稿
  const rounds = reviseRounds(w, draft.ep)
  const reviseCapped = rounds >= MAX_REVISE_ROUNDS
  const lastReview = draft.reviews.at(-1)
  const reviewed = !!lastReview?.sig && lastReview.sig === linesSig(draft)

  /** 在最新数据上改本草稿 */
  const patch = (fn: (d: EpisodeDraft) => Partial<EpisodeDraft>, note?: string) => {
    const cur = latestProject(project.id)
    const d = cur?.work.drafts.find((x) => x.id === draft.id)
    if (cur && d) patchWork(project.id, patchDraft(cur.work, d.id, fn(d)), note)
  }
  const setLines: Updater<EpisodeDraft['lines'][number]> = (update) => patch((d) => ({ lines: update(d.lines) }))
  const setNotes: Updater<EpisodeDraft['notes'][number]> = (update) => patch((d) => ({ notes: update(d.notes) }))

  const revise = async () => {
    const cur = latestProject(project.id)
    const d = cur?.work.drafts.find((x) => x.id === draft.id)
    if (!cur || !d) return
    if (reviseRounds(cur.work, d.ep) >= MAX_REVISE_ROUNDS) return toast(`第 ${d.ep} 集已 AI 修稿 ${MAX_REVISE_ROUNDS} 轮，请人工修改或直接定稿`, 'error')
    const result = await run('revise', (signal) => reviseDraft(cur, d, nextSeed(), signal))
    if (!result) return
    const latest = latestProject(project.id)
    if (!latest) return
    const { draft: created, drafts } = addDraft(latest.work, d.ep, { title: d.title, lines: result.lines, states: d.states }, d.id)
    patchWork(project.id, { drafts }, `AI 修稿：第 ${d.ep} 集 ${draftLabel(created)}`)
    toast(`已生成 ${draftLabel(created)}：${result.changes.join('；')}`)
    navigate(draftPath(project, created.id))
  }

  const audit = async () => {
    const cur = latestProject(project.id)
    const d = cur?.work.drafts.find((x) => x.id === draft.id)
    if (!cur || !d) return
    const result = await run('review', (signal) => reviewDraft(cur, d, signal))
    if (!result) return
    const r: DraftReview = { id: newId(), at: new Date().toISOString(), ...result, sig: linesSig(d) }
    patch((x) => ({ reviews: [...x.reviews, r] }), `AI 审稿：第 ${d.ep} 集 ${draftLabel(d)}`)
    const { block, warn } = reviewCounts(r)
    toast(block ? `审稿完成：${block} 项严重问题` : warn ? `审稿完成：${warn} 条建议` : '审稿通过，可以定稿')
    setParams({ review: r.id })
  }

  const finalize = () => {
    const cur = latestProject(project.id)
    if (!cur) return
    const result = finalizeDraft(cur, draft.id)
    if (!result) return
    patchWork(project.id, result, `定稿：第 ${draft.ep} 集（${draftLabel(draft)}）`)
    toast(`第 ${draft.ep} 集已定稿，归入正文章节；状态库与本集要点已更新`)
    navigate(finalPath(project, draft.ep))
  }

  return (
    <div className="space-y-4">
      <Link to={`${scriptStagePath(project)}?ep=${draft.ep}`} className="inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900">
        <ArrowLeft size={14} />
        分集蓝图
      </Link>

      {/* 顶栏：标题 · 字数 · 状态 · 修稿 / 审稿 / 定稿 */}
      <Card className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="shrink-0 text-[15px] font-semibold text-ink-900 tabular-nums">第 {draft.ep} 集 —</span>
          {editable ? (
            <InlineInput aria-label="本集标题" value={draft.title} onChange={(e) => patch(() => ({ title: e.target.value }))} placeholder="本集标题" className="w-56 text-[15px] font-semibold" />
          ) : (
            <span className="truncate text-[15px] font-semibold text-ink-900">{draft.title || '未命名'}</span>
          )}
          <span className="text-[13px] text-ink-400">v{draft.version}</span>
          <span className="text-[13px] text-ink-500 tabular-nums">{wordCount(draft).toLocaleString()} 字</span>
          <Badge tone={meta.tone}>{meta.label}</Badge>
          {draft.notes.length > 0 && <Badge tone="amber">{draft.notes.length} 条标注</Badge>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AiButton
            variant="secondary"
            loading={running === 'revise'}
            disabled={!!running || reviseCapped}
            title={
              reviseCapped
                ? `本集已 AI 修稿 ${MAX_REVISE_ROUNDS} 轮：请按审稿意见人工修改，或直接定稿`
                : `按标注与审稿意见改出新版本 草稿_v${(newest?.version ?? draft.version) + 1}（第 ${rounds + 1}/${MAX_REVISE_ROUNDS} 轮）`
            }
            onClick={revise}
          >
            AI 修稿
          </AiButton>
          <span className="flex items-center gap-1">
            <AiButton variant="secondary" loading={running === 'review'} disabled={!!running || reviewed} title={reviewed ? '正文自上次审稿后没有改动，无需重复审稿' : undefined} onClick={audit}>
              AI 审稿
            </AiButton>
            <span className="group relative">
              <button type="button" aria-label="审稿范围说明" className="flex rounded-md p-1 text-ink-400 hover:text-ink-700 focus:text-ink-700 focus:outline-none">
                <Info size={15} />
              </button>
              <div
                role="tooltip"
                className="invisible absolute top-full right-0 z-30 mt-1.5 w-80 rounded-lg border border-line bg-white p-3 text-left opacity-0 shadow-pop transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
              >
                <div className="mb-1.5 text-[13px] font-medium text-ink-900">AI 审稿检查什么</div>
                <ul className="space-y-1 text-xs leading-5 text-ink-700">
                  {REVIEW_SCOPE.map((x) => (
                    <li key={x} className="flex gap-1.5">
                      <span className="mt-2 size-1 shrink-0 rounded-full bg-ink-300" />
                      {x}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 border-t border-line pt-2 text-xs leading-5 text-ink-500">
                  兜底：正文没改动时不重复审稿；同一集最多 AI 修稿 {MAX_REVISE_ROUNDS} 轮，之后请人工修改或直接定稿，避免审稿与修稿无限循环。
                </p>
              </div>
            </span>
          </span>
          <button type="button" className={finalButton} disabled={draft.status === 'final' || !!running} onClick={() => (final ? setConfirmFinal(true) : finalize())}>
            <ClipboardCheck size={14} />
            {draft.status === 'final' ? '已定稿' : '定稿'}
          </button>
        </div>
      </Card>

      {reviseCapped && draft.status === 'draft' && (
        <p className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-900">
          <Info size={14} className="shrink-0 text-amber-600" />
          本集已 AI 修稿 {MAX_REVISE_ROUNDS} 轮，自动修稿已停止：请按审稿意见人工修改这一版，或直接定稿。
        </p>
      )}
      {draft.status === 'revised' && (
        <p className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-900">
          <Info size={14} className="shrink-0 text-amber-600" />
          这个版本已被新版本取代（只读）。可以继续标注后 AI 修稿，或直接以这个版本定稿。
          {newest && newest.id !== draft.id && (
            <Link to={draftPath(project, newest.id)} className="font-medium hover:underline">
              打开最新的 {draftLabel(newest)}
            </Link>
          )}
        </p>
      )}
      {draft.status === 'final' && (
        <p className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-[13px] text-emerald-900">
          <Info size={14} className="shrink-0 text-emerald-600" />
          这个版本已定稿并归入正文章节（只读）；正文请在正文章节里修改，或 AI 修稿生成新版本。
          <Link to={finalPath(project, draft.ep)} className="flex items-center gap-0.5 font-medium hover:underline">
            打开正文第 {draft.ep} 集
            <ArrowRight size={13} />
          </Link>
        </p>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_272px]">
        <div className="min-w-0 space-y-4">
          {review && (
            <Card>
              <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <h3 className="text-[15px] font-semibold text-ink-900">审查报告 #{reviewNo(review)}</h3>
                  <span className="text-xs text-ink-400">{formatDateTime(review.at)}</span>
                  <span className={clsx('text-[13px] font-semibold tabular-nums', review.score >= 4 ? 'text-emerald-700' : review.score >= 3 ? 'text-amber-700' : 'text-red-600')}>{review.score} / 5</span>
                </div>
                <button type="button" aria-label="关闭审查报告" onClick={() => setParams({})} className="rounded-md p-1 text-ink-400 hover:bg-canvas hover:text-ink-700">
                  <X size={15} />
                </button>
              </div>
              <div className="space-y-3 px-5 py-4">
                <CheckList items={review.items} />
                <p className="text-xs text-ink-400">AI 修稿会按审稿意见与标注改出新版本，原版本保留在草稿箱</p>
              </div>
            </Card>
          )}

          <p className="text-xs text-ink-400">
            {editable ? '点选任意一段：上方浮出工具条，可标注、添加到助手，或用 AI 改写 / 润色 / 扩写 / 续写 / 改成对话；框选部分文字时只改选中的部分。修改自动保存。' : '只读版本：点选一段仍可添加标注，AI 修稿时会按标注改写。'}
          </p>
          <ScriptEditor project={project} lines={draft.lines} readOnly={!editable} showEn={false} onLines={setLines} notes={draft.notes} onNotes={setNotes} />
        </div>

        {/* 侧栏：审查报告 / 标注 / 本集蓝图 */}
        <div className="space-y-4 xl:sticky xl:top-4">
          <Card>
            <CardHeader title="审查报告" desc={reviews.length ? `${reviews.length} 份` : '还没有审稿'} />
            {reviews.length ? (
              <ul className="p-1.5">
                {reviews.map((r) => {
                  const { block, warn } = reviewCounts(r)
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => setParams({ review: r.id })}
                        className={clsx('flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[13px]', review?.id === r.id ? 'bg-brand-50' : 'hover:bg-canvas')}
                      >
                        <span className="font-medium text-ink-900">#{reviewNo(r)}</span>
                        <span className="flex-1 text-xs text-ink-400">{formatDateTime(r.at)}</span>
                        <span className="text-xs tabular-nums">
                          <span className={block ? 'text-red-600' : 'text-ink-400'}>{block} 严重</span>
                          <span className="text-ink-300"> · </span>
                          <span className={warn ? 'text-amber-700' : 'text-ink-400'}>{warn} 建议</span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="px-5 py-3 text-xs text-ink-400">点击上方「AI 审稿」生成审查报告</p>
            )}
          </Card>

          <Card>
            <CardHeader title={<span className="flex items-center gap-1.5"><StickyNote size={14} className="text-amber-500" />标注</span>} desc={draft.notes.length ? `${draft.notes.length} 条，AI 修稿时一并改写` : '点选一行即可标注'} />
            {draft.notes.length > 0 && (
              <ul className="space-y-1.5 px-4 py-3">
                {draft.notes.map((n) => {
                  const at = draft.lines.findIndex((l) => l.id === n.lineId)
                  return (
                    <li key={n.id} className="text-[12.5px] leading-5">
                      <span className="mr-1 text-ink-400 tabular-nums">{at >= 0 ? `第 ${at + 1} 行` : '原行已删除'}</span>
                      <span className="text-ink-900">{n.text}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title={<span className="flex items-center gap-1.5"><Layers size={14} className="text-ink-400" />本集蓝图</span>}
              action={
                <Link to={`${scriptStagePath(project)}?ep=${draft.ep}`} className="text-xs text-brand-600 hover:text-brand-700">
                  编辑
                </Link>
              }
            />
            {blueprint ? (
              <dl className="space-y-2 px-4 py-3 text-[12.5px] leading-5">
                {[
                  ['定位', blueprint.position],
                  ['小目标', blueprint.goal],
                  ['冲突与转折', blueprint.conflict],
                  ['末尾钩子', blueprint.hook],
                  ['作者微操指导', blueprint.guidance],
                ]
                  .filter(([, v]) => v.trim())
                  .map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-ink-400">{k}</dt>
                      <dd className="text-ink-900">{v}</dd>
                    </div>
                  ))}
              </dl>
            ) : (
              <p className="px-4 py-3 text-xs text-ink-400">本集还没有蓝图</p>
            )}
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirmFinal}
        onClose={() => setConfirmFinal(false)}
        onConfirm={finalize}
        title={`以 ${draftLabel(draft)} 定稿？`}
        desc={`第 ${draft.ep} 集已有正文，定稿后会被这个版本替换；原来的定稿版本保留在草稿箱（已修稿）。`}
        confirmText="定稿并替换"
      />
    </div>
  )
}
