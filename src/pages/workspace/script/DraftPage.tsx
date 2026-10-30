import clsx from 'clsx'
import { AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCircle2, ClipboardCheck, FileText, Info, Lightbulb, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { ConfirmDialog } from '../../../components/overlay'
import { ReviewButton, WriteButton } from '../../../components/project/ModelBits'
import { AiButton, InlineInput, latestProject, useAiTask } from '../../../components/stage/StageKit'
import { Badge, Card, EmptyState, buttonClass, dotBefore } from '../../../components/ui'
import { DRAFT_STATUS_META } from '../../../domain/constants'
import { modelLabel, modelOf } from '../../../domain/models'
import { REVIEW_BASIS, basisLabel } from '../../../domain/review'
import { preWriteCheck } from '../../../domain/state'
import type { DraftReview, DraftRevision, EpisodeDraft, ModelId, Project } from '../../../domain/types'
import { blueprintOf, carryOf, draftLabel, draftsOf, plainText, scriptOf, wordCount } from '../../../domain/work'
import { formatDateTime } from '../../../lib/format'
import { newId } from '../../../lib/id'
import { nextSeed, reviewDraft, reviseDraft } from '../../../services/ai'
import { useProjects } from '../../../store/projects'
import { STATE_TAB, activeTab, openPanelTab, usePanelTabs, useStateFocus, useStatePanel } from '../../../store/statePanel'
import { toast } from '../../../store/toast'
import { useV2 } from '../../../store/uiVersion'
import { writeDraft } from './write'
import { EpisodeSteps } from '../../../v2/EpisodeSteps'
import { DRAFT_ACTION_LABEL, draftAdvice } from '../../../v2/flow'
import { useCurrentProject } from '../ProjectLayout'
import { NotesTab } from './NotesTab'
import { ScriptEditor } from './ScriptEditor'
import type { LinePick, Updater } from './ScriptEditor'
import { MAX_REVISE_ROUNDS, addDraft, draftPath, finalPath, finalizeDraft, linesSig, openBlocks, patchDraft, reviewBase, reviewCounts, reviseRounds, scriptStagePath } from './ops'
import { FinalGate, KeptList, ReviewItems } from './ReviewItems'

/** 定稿按钮：绿色主按钮 */
const finalButton =
  'inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-[13px] font-medium text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50'

/** 本集蓝图 / 审核报告 / 标注并入状态库侧栏，与状态库并列成四个标签页 */
type SideTab = 'blueprint' | 'reviews' | 'notes'

/** 展开状态库侧栏并切到某个标签页 */
const openPanel = (tab: SideTab) => openPanelTab(tab)

/** 审稿结果的一句话概括：先说严重问题，其次建议，都没有时给通过语 */
const reviewGist = (r: DraftReview) => (r.items.find((i) => i.level === 'block') ?? r.items.find((i) => i.level === 'warn') ?? r.items.find((i) => i.level === 'ok'))?.text ?? '没有发现问题'

/** 版本二：定稿不是建议的下一步时降为描边按钮，仍可直接点 */
const finalOutline =
  'inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 text-[13px] font-medium text-emerald-700 shadow-sm transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50'

/** 修稿记录：这一版按哪份审稿改的、改了什么、哪些意见留给编剧 */
function RevisionCard({ revision, source, project }: { revision: DraftRevision; source?: EpisodeDraft; project: Project }) {
  return (
    <div data-revision className="mx-3 rounded-lg border border-line bg-canvas/60 px-3 py-2.5">
      <div className="text-xs text-ink-500">
        {source ? (
          <Link to={draftPath(project, source.id, revision.reviewId)} className="font-medium text-ink-900 hover:text-brand-600">
            {draftLabel(source)}
          </Link>
        ) : (
          '上一版'
        )}
        {revision.reviewNo ? ` 按审稿 #${revision.reviewNo} 改出这一版` : ' 按标注与自检改出这一版（修稿前没有审稿）'}
      </div>
      <ul className="mt-1.5 space-y-1 text-[12.5px] leading-5">
        {revision.changes.map((c) => (
          <li key={c} className="flex gap-1.5 text-ink-900">
            <Check size={13} className="mt-1 shrink-0 text-emerald-600" />
            {c}
          </li>
        ))}
        {revision.manual.map((c) => (
          <li key={c} className="flex gap-1.5 text-amber-800">
            <AlertTriangle size={13} className="mt-1 shrink-0 text-amber-500" />
            <span>需人工：{c}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function DraftPage() {
  const project = useCurrentProject()
  const { draftId } = useParams()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const patchWork = useProjects((s) => s.patchWork)
  const { running, run } = useAiTask()
  const [confirmFinal, setConfirmFinal] = useState(false)
  const [gate, setGate] = useState(false)
  const [notice, setNotice] = useState<DraftReview | null>(null)
  // 点审稿意见里的原句：正文滚到那一行并高亮
  const [focusLine, setFocusLine] = useState<string | null>(null)
  // 正文里选中的段落：状态库侧栏「标注」给它加标注
  const [pick, setPick] = useState<LinePick | null>(null)
  const v2 = useV2()

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 10000)
    return () => clearTimeout(t)
  }, [notice])

  const draft = project.work.drafts.find((d) => d.id === draftId)
  useStateFocus(draft ? { kind: 'ep', ep: draft.ep, draftId: draft.id } : null)
  usePanelTabs(
    draft
      ? [
          { key: 'blueprint', label: '本集蓝图' },
          { key: 'reviews', label: '审核报告', count: draft.reviews.length },
          { key: STATE_TAB, label: '状态库' },
          { key: 'notes', label: '标注', count: draft.notes.length },
        ]
      : null,
  )
  const slot = useStatePanel((s) => s.slot)
  const sideTab = useStatePanel((s) => activeTab(s.tabs, s.tab))
  // 打开某份审核报告（审稿完成、或从目录点进来）时，侧栏切到审核报告
  const reviewParam = params.get('review')
  useEffect(() => {
    if (reviewParam) openPanel('reviews')
  }, [reviewParam])
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
  const carry = carryOf(w, draft.ep)
  const review = draft.reviews.find((r) => r.id === params.get('review'))
  const reviewNo = (r: DraftReview) => draft.reviews.indexOf(r) + 1
  // 兜底：修稿轮数有上限；正文没改过不重复审稿
  const rounds = reviseRounds(w, draft.ep)
  const reviseCapped = rounds >= MAX_REVISE_ROUNDS
  const lastReview = draft.reviews.at(-1)
  const sig = linesSig(draft)
  const reviewed = !!lastReview?.sig && lastReview.sig === sig
  // 已经审过当前正文的模型：它们不重复审，换个模型还能再审一遍（没记模型的旧审稿算项目的文本模型）
  const textModel = modelOf(project, 'text')
  const reviewedBy = [...new Set(draft.reviews.filter((r) => r.sig === sig).map((r) => r.model ?? textModel))]
  const source = draft.from ? w.drafts.find((d) => d.id === draft.from) : undefined
  // AI 修稿出来的版本：审稿是复审，对照修稿依据的那份审稿
  const base = reviewBase(w, draft)
  const baseNo = base && source ? `${draftLabel(source)} 的审稿 #${source.reviews.indexOf(base.review) + 1}` : ''
  const blocks = openBlocks(w, draft)
  const nextLabel = `草稿_v${(newest?.version ?? draft.version) + 1}`
  // 重新生成和写新一集走同一套写作前检查
  const writeBlock = preWriteCheck(project, draft.ep).find((c) => c.level === 'block')
  // 版本二：按审稿状态推荐下一步，只有推荐的按钮是主按钮
  const advice = v2 ? draftAdvice(project, draft) : null
  const suggested = (action: 'review' | 'revise') => (advice?.action === action ? 'primary' : 'secondary')

  /** 在最新数据上改本草稿 */
  const patch = (fn: (d: EpisodeDraft) => Partial<EpisodeDraft>, note?: string) => {
    const cur = latestProject(project.id)
    const d = cur?.work.drafts.find((x) => x.id === draft.id)
    if (cur && d) patchWork(project.id, patchDraft(cur.work, d.id, fn(d)), note)
  }
  const setLines: Updater<EpisodeDraft['lines'][number]> = (update) => patch((d) => ({ lines: update(d.lines) }))
  const setNotes: Updater<EpisodeDraft['notes'][number]> = (update) => patch((d) => ({ notes: update(d.notes) }))

  /** 只对本集重新写一版正文：生成下一个版本号的草稿，当前版本保留在草稿箱 */
  const regenerate = async (model?: ModelId) => {
    const created = await writeDraft(project.id, draft.ep, run, model)
    if (created) navigate(draftPath(project, created.id))
  }

  /** AI 修稿：审过稿就逐条按审稿意见改（默认最近一份，也可在某份报告里点「按这份意见修稿」），没审稿按标注与自检改 */
  const revise = async (basisId?: string) => {
    const cur = latestProject(project.id)
    const d = cur?.work.drafts.find((x) => x.id === draft.id)
    if (!cur || !d) return
    if (reviseRounds(cur.work, d.ep) >= MAX_REVISE_ROUNDS) return toast(`第 ${d.ep} 集已 AI 修稿 ${MAX_REVISE_ROUNDS} 轮，请人工修改或直接定稿`, 'error')
    const basis = d.reviews.find((r) => r.id === basisId) ?? d.reviews.at(-1)
    const result = await run('revise', (signal) => reviseDraft(cur, d, nextSeed(), basis, signal))
    if (!result) return
    const latest = latestProject(project.id)
    if (!latest) return
    const revision: DraftRevision = { ...(basis && { reviewId: basis.id, reviewNo: d.reviews.indexOf(basis) + 1 }), changes: result.changes, manual: result.manual }
    const { draft: created, drafts } = addDraft(latest.work, d.ep, { title: d.title, lines: result.lines, states: d.states, model: result.model }, d.id, revision)
    patchWork(project.id, { drafts }, `AI 修稿：第 ${d.ep} 集 ${draftLabel(created)}${basis ? `（按审稿 #${revision.reviewNo}）` : ''}`)
    toast(`已生成 ${draftLabel(created)}${basis ? `（按审稿 #${revision.reviewNo}）` : ''}${result.manual.length ? `，${result.manual.length} 条意见需人工处理` : ''}`)
    navigate(draftPath(project, created.id))
    // 新版本打开时侧栏停在审核报告，先看这一版按意见改了什么
    openPanel('reviews')
  }

  /** AI 审稿：修稿出来的版本默认复审（只查上一轮意见与改过的段落），full 全量重审；model：这次换用的模型 */
  const audit = async (kind?: 'full', model?: ModelId) => {
    const cur = latestProject(project.id)
    const d = cur?.work.drafts.find((x) => x.id === draft.id)
    if (!cur || !d) return
    const result = await run('review', (signal) => reviewDraft(cur, d, { base: reviewBase(cur.work, d), kind }, signal, model))
    if (!result) return
    const r: DraftReview = { id: newId(), at: new Date().toISOString(), ...result, sig: linesSig(d) }
    const via = model && model !== modelOf(cur, 'text') ? `（换用 ${modelLabel(model)}）` : ''
    patch((x) => ({ reviews: [...x.reviews, r] }), `AI 审稿：第 ${d.ep} 集 ${draftLabel(d)}${via}`)
    setNotice(r)
    setParams({ review: r.id })
  }

  /** 定稿：最近一份审稿里还有没解决的严重问题时先过关口——改掉，或写明理由保留不改 */
  const tryFinalize = () => {
    const cur = latestProject(project.id)
    const d = cur?.work.drafts.find((x) => x.id === draft.id)
    if (cur && d && openBlocks(cur.work, d).length) return setGate(true)
    if (final) setConfirmFinal(true)
    else finalize()
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

      {/* 顶栏：标题 · 字数 · 状态 · 修稿 / 审稿 / 定稿；叠在正文格式栏之上，下拉菜单与说明浮层不被遮住 */}
      <Card className="relative z-40 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-5 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-[15px] font-semibold text-ink-900 tabular-nums">第 {draft.ep} 集</span>
            {editable ? (
              <InlineInput aria-label="本集标题" value={draft.title} onChange={(e) => patch(() => ({ title: e.target.value }))} placeholder="本集标题" className="w-48 text-[15px] font-semibold" />
            ) : (
              <span className="truncate text-[15px] font-semibold text-ink-900">{draft.title || '未命名'}</span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs whitespace-nowrap text-ink-500">
            {/* 版本名里已经有「草稿」，状态只在已修稿 / 已定稿时单独标出 */}
            {draft.status !== 'draft' && <Badge tone={meta.tone}>{meta.label}</Badge>}
            <span>{draftLabel(draft)}</span>
            <span data-draft-model className={clsx(dotBefore, !draft.model && 'text-ink-400')} title={draft.model ? `这一版由 ${modelLabel(draft.model)} ${draft.revision ? '修稿生成' : '写出'}` : '这一版写于加入模型选择之前，没有记下模型'}>
              {draft.model ? `${modelLabel(draft.model)} ${draft.revision ? '修稿' : '生成'}` : '模型未记录'}
            </span>
            <span className={clsx(dotBefore, 'tabular-nums')}>{wordCount(draft).toLocaleString()} 字</span>
            <button type="button" data-open-notes onClick={() => openPanel('notes')} className={clsx(dotBefore, draft.notes.length ? 'text-amber-700 hover:text-amber-800' : 'hover:text-brand-600')}>
              {draft.notes.length ? `${draft.notes.length} 条标注` : '加标注'}
            </button>
            {draft.revision && (
              <button type="button" onClick={() => openPanel('reviews')} className={clsx(dotBefore, 'hover:text-brand-600')}>
                {draft.revision.reviewNo ? `按审稿 #${draft.revision.reviewNo} 修改` : 'AI 修稿生成'}
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <WriteButton
            project={project}
            variant="secondary"
            loading={running === 'write'}
            disabled={!!running || !!writeBlock}
            title={writeBlock ? writeBlock.text : `只对第 ${draft.ep} 集按蓝图重新写一版正文，生成 ${nextLabel}；当前版本保留在草稿箱`}
            onWrite={regenerate}
          >
            重新生成
          </WriteButton>
          <AiButton
            variant={suggested('revise')}
            loading={running === 'revise'}
            disabled={!!running || reviseCapped}
            title={
              reviseCapped
                ? `本集已 AI 修稿 ${MAX_REVISE_ROUNDS} 轮：请按审稿意见人工修改，或直接定稿`
                : `${lastReview ? `按审稿 #${draft.reviews.length} 的意见逐条修改（AI 改不动、保留不改的不动）` : '还没审稿：按标注与自检修改（先 AI 审稿，可按审稿意见逐条改）'}${draft.notes.length ? `，${draft.notes.length} 条标注一并改写` : ''}，生成 ${nextLabel}（第 ${rounds + 1}/${MAX_REVISE_ROUNDS} 轮）`
            }
            onClick={() => revise()}
          >
            AI 修稿
          </AiButton>
          <span className="flex items-center gap-1">
            <ReviewButton
              project={project}
              draft={draft}
              reviewed={reviewedBy}
              variant={suggested('review')}
              loading={running === 'review'}
              busy={!!running}
              title={
                reviewedBy.includes(textModel)
                  ? '正文自上次审稿后没有改动，无需重复审稿；想听第二意见可点 ▾ 换个模型再审'
                  : base
                    ? `复审：只查${baseNo}的意见改没改掉、改过的段落有没有新问题；要从头查用审核报告里的「全量重审」`
                    : undefined
              }
              onReview={(model) => audit(undefined, model)}
            >
              AI 审稿
            </ReviewButton>
            <span className="group relative">
              <button type="button" aria-label="审稿范围说明" className="flex rounded-md p-1 text-ink-400 hover:text-ink-700 focus:text-ink-700 focus:outline-none">
                <Info size={15} />
              </button>
              <div
                role="tooltip"
                className="invisible absolute top-full right-0 z-30 mt-1.5 w-80 rounded-lg border border-line bg-white p-3 text-left opacity-0 shadow-pop transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
              >
                <div className="mb-1.5 text-[13px] font-medium text-ink-900">AI 审稿检查什么</div>
                <p className="mb-1.5 text-xs leading-5 text-ink-500">每条意见都写明依据和正文原句；说不出依据的只算建议。AI 写作也按这几项写。</p>
                <ul className="space-y-1 text-xs leading-5 text-ink-700">
                  {REVIEW_BASIS.map((x) => (
                    <li key={x.key} className="flex gap-1.5">
                      <span className="mt-2 size-1 shrink-0 rounded-full bg-ink-300" />
                      <span>
                        <span className="font-medium text-ink-900">{x.label}</span>：{x.covers}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 border-t border-line pt-2 text-xs leading-5 text-ink-500">
                  不会无限循环：修稿后的复审只查上一轮意见改没改掉、改过的段落；两轮没改掉或改好又出现的标为「AI 改不动」，交给你处理；你保留不改的不再提。只有严重问题拦定稿，同一集最多 AI 修稿 {MAX_REVISE_ROUNDS} 轮。
                </p>
              </div>
            </span>
          </span>
          <button type="button" className={advice && advice.action !== 'final' ? finalOutline : finalButton} disabled={draft.status === 'final' || !!running} onClick={tryFinalize}>
            <ClipboardCheck size={14} />
            {draft.status === 'final' ? '已定稿' : '定稿'}
          </button>
        </div>
        {v2 && (
          <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-2.5">
            <EpisodeSteps project={project} ep={draft.ep} here={newest?.id === draft.id ? (params.get('review') ? '审稿' : '草稿') : undefined} />
            {advice && (
              <span className="flex min-w-0 items-start gap-1.5 text-[13px] text-ink-700" data-v2="advice">
                <Lightbulb size={14} className="mt-0.5 shrink-0 text-brand-500" />
                <span>
                  建议下一步：<span className="font-medium text-brand-700">{DRAFT_ACTION_LABEL[advice.action]}</span>
                  <span className="text-ink-500"> —— {advice.text}</span>
                </span>
              </span>
            )}
          </div>
        )}
      </Card>

      {reviseCapped && draft.status === 'draft' && (
        <p className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-900">
          <Info size={14} className="shrink-0 text-amber-600" />
          本集已 AI 修稿 {MAX_REVISE_ROUNDS} 轮，自动修稿已停止：请按审稿意见人工修改这一版
          {blocks.length ? `；剩下的 ${blocks.length} 个严重问题改掉或写明理由保留不改后即可定稿` : '，或直接定稿'}。
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

      <ScriptEditor
        project={project}
        ep={draft.ep}
        lines={draft.lines}
        readOnly={!editable}
        showEn={false}
        onLines={setLines}
        notes={draft.notes}
        onNotes={setNotes}
        onPick={setPick}
        focusLineId={focusLine}
        tips={['要标注某段：点选后在状态库的「标注」里写下问题，AI 修稿时一并改写']}
      />

      {/* 本集蓝图 / 审核报告 / 标注：填进状态库侧栏对应的标签页 */}
      {slot &&
        createPortal(
          sideTab === 'blueprint' ? (
            <div className="px-4">
              <div className="mb-2.5 flex items-baseline justify-between gap-2">
                <span className="truncate text-[13px] font-medium text-ink-900">
                  第 {draft.ep} 集{blueprint?.title ? ` · ${blueprint.title}` : ''}
                </span>
                <Link to={`${scriptStagePath(project)}?ep=${draft.ep}`} className="shrink-0 text-xs text-brand-600 hover:text-brand-700">
                  编辑
                </Link>
              </div>
              {blueprint ? (
                <dl className="space-y-2.5 text-[12.5px] leading-5">
                  {[
                    { k: '定位', v: blueprint.position },
                    { k: '小目标', v: blueprint.goal },
                    { k: '冲突与转折', v: blueprint.conflict },
                    { k: '承接', v: carry ? plainText(carry.text) : '', note: carry?.auto ? '默认接上集结尾' : undefined },
                    { k: '末尾钩子', v: blueprint.hook },
                    { k: '作者微操指导', v: blueprint.guidance },
                  ]
                    .filter(({ v }) => v.trim())
                    .map(({ k, v, note }) => (
                      <div key={k}>
                        <dt className="text-ink-400">
                          {k}
                          {note && <span className="ml-1.5 text-[11px] text-ink-300">{note}</span>}
                        </dt>
                        <dd className="text-ink-900">{v}</dd>
                      </div>
                    ))}
                </dl>
              ) : (
                <p className="text-xs text-ink-400">本集还没有蓝图</p>
              )}
              {draft.basis && (
                <div data-write-basis className="mt-4 border-t border-line pt-3">
                  <div className="mb-1.5 text-[13px] font-medium text-ink-900">写作依据</div>
                  <p className="mb-2 text-xs text-ink-400">AI 写这一版时对照的设定，和审稿是同一份清单</p>
                  <ul className="space-y-1.5 text-[12.5px] leading-5">
                    {draft.basis.map((b) => (
                      <li key={b.basis} className="flex gap-2">
                        <span className="w-16 shrink-0 text-ink-400">{basisLabel(b.basis)}</span>
                        <span className="min-w-0 text-ink-900">{b.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : sideTab === 'reviews' ? (
            <div className="space-y-2">
              {draft.revision && <RevisionCard revision={draft.revision} source={source} project={project} />}
              {reviews.length ? (
                <ul className="px-1.5">
                  {reviews.map((r) => {
                    const { block, warn } = reviewCounts(r, w, draft.ep)
                    const shown = review?.id === r.id
                    const recheck = r.kind === 'recheck'
                    return (
                      <li key={r.id}>
                        <button
                          type="button"
                          aria-expanded={shown}
                          onClick={() => setParams(shown ? {} : { review: r.id })}
                          className={clsx('flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[13px]', shown ? 'bg-brand-50' : 'hover:bg-canvas')}
                        >
                          <span className="font-medium text-ink-900">#{reviewNo(r)}</span>
                          <span className="flex-1 text-xs text-ink-400">
                            {r.kind === 'recheck' ? '复审 · ' : r.baseId ? '全量 · ' : ''}
                            {r.model ? `${modelLabel(r.model)} · ` : ''}
                            {formatDateTime(r.at)}
                          </span>
                          <span className="text-xs tabular-nums">
                            <span className={block ? 'text-red-600' : 'text-ink-400'}>{block} 严重</span>
                            <span className="text-ink-300"> · </span>
                            <span className={warn ? 'text-amber-700' : 'text-ink-400'}>{warn} 建议</span>
                          </span>
                        </button>
                        {shown && (
                          <div data-review-detail className="space-y-2.5 px-2.5 pt-1 pb-3">
                            <div className="text-xs text-ink-500">
                              评分 <span className={clsx('text-[13px] font-semibold tabular-nums', r.score >= 4 ? 'text-emerald-700' : r.score >= 3 ? 'text-amber-700' : 'text-red-600')}>{r.score} / 5</span>
                              {r.model && <span data-review-model> · {modelLabel(r.model)} 审稿</span>}
                            </div>
                            {r.baseId && (
                              <div data-review-kind className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-canvas px-2.5 py-1.5 text-xs leading-5 text-ink-500">
                                <span>
                                  {recheck ? '复审：只查' : '全量重审，并跟踪'}
                                  {baseNo || '上一轮审稿'}的意见{recheck ? '改没改掉、改过的段落有没有新问题' : ''}
                                </span>
                                {recheck && r.id === lastReview?.id && editable && (
                                  <button type="button" data-full-review disabled={!!running} onClick={() => audit('full', r.model)} className="font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50">
                                    全量重审
                                  </button>
                                )}
                              </div>
                            )}
                            <ReviewItems
                              project={project}
                              ep={draft.ep}
                              items={r.items}
                              canKeep={draft.status !== 'final'}
                              onLocate={(id) => {
                                setFocusLine(null)
                                requestAnimationFrame(() => setFocusLine(id))
                              }}
                            />
                            {block + warn > 0 && (
                              <div className="flex flex-wrap items-center gap-2 pt-1">
                                <AiButton size="sm" variant="secondary" loading={running === 'revise'} disabled={!!running || reviseCapped} title={reviseCapped ? `本集已 AI 修稿 ${MAX_REVISE_ROUNDS} 轮` : undefined} onClick={() => revise(r.id)}>
                                  按这份意见修稿
                                </AiButton>
                                <span className="text-xs text-ink-400">生成 {nextLabel}，原版本保留</span>
                              </div>
                            )}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="px-4 text-xs text-ink-400">{draft.revision ? '这一版还没审过：再点「AI 审稿」确认意见都改到了' : '点击页面上方「AI 审稿」生成审核报告'}</p>
              )}
              <KeptList project={project} ep={draft.ep} />
            </div>
          ) : sideTab === 'notes' ? (
            <NotesTab lines={draft.lines} notes={draft.notes} pick={pick} onNotes={setNotes} footer="AI 修稿时一并改写" />
          ) : null,
          slot,
        )}

      {/* 审稿完成的提示框：只给结论，详情在状态库侧栏的审核报告里看 */}
      {notice && (
        <div role="status" data-review-notice className="fixed top-20 left-1/2 z-50 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 animate-slide-up rounded-xl border border-line bg-white p-4 shadow-pop">
          {(() => {
            const { block, warn } = reviewCounts(notice)
            const passed = !block && !warn
            const tally = (s: string) => notice.items.filter((i) => i.status === s).length
            const stuck = tally('stuck') + tally('back')
            return (
              <div className="flex gap-3">
                {block ? <AlertTriangle size={20} className="mt-0.5 shrink-0 text-red-500" /> : passed ? <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-emerald-500" /> : <Info size={20} className="mt-0.5 shrink-0 text-amber-500" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[14px] font-semibold text-ink-900">{notice.kind === 'recheck' ? '复审完成' : '审稿完成'}</span>
                    <span className={clsx('text-[13px] font-semibold tabular-nums', notice.score >= 4 ? 'text-emerald-700' : notice.score >= 3 ? 'text-amber-700' : 'text-red-600')}>{notice.score} / 5</span>
                    <span className="text-xs text-ink-500 tabular-nums">
                      {block} 严重 · {warn} 建议
                    </span>
                    {notice.model && <span className="ml-auto text-xs text-ink-400">{modelLabel(notice.model)} 审稿</span>}
                  </div>
                  {notice.baseId && (
                    <p data-recheck-tally className="mt-1 text-xs text-ink-500">
                      上一轮意见：已改掉 {tally('fixed')} · 仍在 {tally('still')}
                      {stuck ? ` · AI 改不动 ${stuck}（交给你处理）` : ''}
                      {tally('new') ? ` · 新发现 ${tally('new')}` : ''}
                    </p>
                  )}
                  <p className="mt-1 text-[13px] leading-5 text-ink-700">{passed ? '审稿通过，可以定稿' : reviewGist(notice)}</p>
                  <div className="mt-3 flex justify-end gap-2">
                    <button type="button" onClick={() => setNotice(null)} className={buttonClass('ghost', 'sm')}>
                      知道了
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        openPanel('reviews')
                        setNotice(null)
                        requestAnimationFrame(() => document.querySelector('[data-review-detail]')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
                      }}
                      className={buttonClass('secondary', 'sm')}
                    >
                      查看详情
                    </button>
                  </div>
                </div>
                <button type="button" aria-label="关闭提示" onClick={() => setNotice(null)} className="-mt-1 -mr-1 self-start rounded-md p-1 text-ink-400 hover:bg-canvas hover:text-ink-700">
                  <X size={14} />
                </button>
              </div>
            )
          })()}
        </div>
      )}

      {gate && (
        <FinalGate
          project={project}
          draft={draft}
          items={blocks}
          stale={!reviewed}
          onClose={() => setGate(false)}
          onReview={() => {
            setGate(false)
            audit()
          }}
          onPass={() => {
            setGate(false)
            if (final) setConfirmFinal(true)
            else finalize()
          }}
        />
      )}

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
