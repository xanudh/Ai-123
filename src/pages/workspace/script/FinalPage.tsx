import clsx from 'clsx'
import { ArrowLeft, ArrowRight, BookOpen, Flag, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useParams, useSearchParams } from 'react-router'
import { AiButton, InlineInput, latestProject, stagePath, useAiTask } from '../../../components/stage/StageKit'
import { PointsView } from '../../../components/project/PointsView'
import { Badge, Card, EmptyState, Segmented, buttonClass, dotBefore } from '../../../components/ui'
import { PLAN_EVENT_META } from '../../../domain/constants'
import type { EpisodeScript, LineNote } from '../../../domain/types'
import { blueprintOf, draftLabel, draftsOf, eventCandidates, foreshadowName, scriptOf, wordCount } from '../../../domain/work'
import { formatDateTime } from '../../../lib/format'
import { extractPoints, translateEpisode } from '../../../services/ai'
import { useProjects } from '../../../store/projects'
import { STATE_TAB, activeTab, usePanelTabs, useStateFocus, useStatePanel } from '../../../store/statePanel'
import { toast } from '../../../store/toast'
import { useV2 } from '../../../store/uiVersion'
import { QaReturnBanner, RelayBar, qaBackPath } from '../../../v2/FinalBits'
import { useCurrentProject } from '../ProjectLayout'
import { ScriptEditor } from './ScriptEditor'
import type { LinePick, Updater } from './ScriptEditor'
import { NotesTab } from './NotesTab'
import { draftPath, finalPath, patchScript, scriptStagePath } from './ops'

type View = 'zh' | 'en_zh'

/** 本集要点 / 标注并入状态库侧栏，与状态库并列成三个标签页 */
const openPanel = (tab: 'points' | 'notes') => {
  const panel = useStatePanel.getState()
  panel.setTab(tab)
  panel.setOpen(true)
}

export default function FinalPage() {
  const project = useCurrentProject()
  const ep = Number(useParams().ep)
  const patchWork = useProjects((s) => s.patchWork)
  const { running, run } = useAiTask()
  const [view, setView] = useState<View>('en_zh')
  const v2 = useV2()
  const [params] = useSearchParams()
  // 正文里选中的段落：状态库侧栏「标注」给它加标注
  const [pick, setPick] = useState<LinePick | null>(null)
  useStateFocus(ep > 0 ? { kind: 'ep', ep } : null)

  const w = project.work
  const script = scriptOf(w, ep)
  const notes = script?.notes ?? []
  usePanelTabs(
    script
      ? [
          { key: 'points', label: '本集要点' },
          { key: STATE_TAB, label: '状态库' },
          { key: 'notes', label: '标注', count: notes.length },
        ]
      : null,
  )
  const slot = useStatePanel((s) => s.slot)
  const sideTab = useStatePanel((s) => activeTab(s.tabs, s.tab))
  if (!script) {
    const newest = draftsOf(w, ep)[0]
    return (
      <Card>
        <EmptyState
          icon={<BookOpen size={22} />}
          title={`第 ${ep} 集还没有正文`}
          desc="草稿定稿后才会归入正文章节。"
          action={
            <Link to={newest ? draftPath(project, newest.id) : `${scriptStagePath(project)}?ep=${ep}`} className={buttonClass()}>
              {newest ? `打开 ${draftLabel(newest)}` : '去写这一集'}
            </Link>
          }
        />
      </Card>
    )
  }

  const bilingual = project.spec.language !== 'zh'
  const hasEn = script.lines.some((l) => l.en)
  const showEn = bilingual && view === 'en_zh'
  const source = w.drafts.find((d) => d.id === script.draftId)
  const blueprint = blueprintOf(w, ep)
  const eps = w.scripts.map((s) => s.ep)
  const prev = Math.max(0, ...eps.filter((e) => e < ep))
  const next = Math.min(Infinity, ...eps.filter((e) => e > ep))
  const candidates = w.foreshadows.flatMap((f) => eventCandidates(f, [script]).map((c) => ({ f, c })))
  // 版本二：从质检「去改正文」过来时带着问题
  const fromQa = v2 && params.get('from') === 'qa'
  const qaIssue = fromQa ? w.qa?.issues.find((i) => i.id === params.get('issue') && i.ep === ep) : undefined

  /** 在最新数据上改本集正文 */
  const patch = (fn: (s: EpisodeScript) => Partial<EpisodeScript>, note?: string) => {
    const cur = latestProject(project.id)
    const s = cur && scriptOf(cur.work, ep)
    if (cur && s) patchWork(project.id, patchScript(cur.work, ep, fn(s)), note)
  }
  const setLines: Updater<EpisodeScript['lines'][number]> = (update) => patch((s) => ({ lines: update(s.lines) }))
  const setNotes: Updater<LineNote> = (update) => patch((s) => ({ notes: update(s.notes ?? []) }))

  const translate = async () => {
    const cur = latestProject(project.id)
    const s = cur && scriptOf(cur.work, ep)
    if (!cur || !s) return
    const result = await run('translate', (signal) => translateEpisode(cur, s.lines, signal))
    if (!result) return
    // 只回填翻译期间没被改过的行
    const done = new Map(result.lines.filter((l) => l.en).map((l) => [l.id, l]))
    patch(
      (x) => ({
        lines: x.lines.map((l) => {
          const t = done.get(l.id)
          return !l.en && t && t.zh === l.zh ? { ...l, en: t.en } : l
        }),
        translated: true,
      }),
      `一键翻译：第 ${ep} 集`,
    )
    setView('en_zh')
    toast(result.missing ? `已翻译；${result.missing} 句改写过的台词需接入模型后翻译` : '已翻译全部台词')
  }

  const refreshPoints = () => {
    const cur = latestProject(project.id)
    const s = cur && scriptOf(cur.work, ep)
    if (!cur || !s || !blueprintOf(cur.work, ep)) return
    const points = extractPoints(cur, s)
    patchWork(project.id, { blueprints: cur.work.blueprints.map((b) => (b.ep === ep ? { ...b, points } : b)) }, `重新提炼第 ${ep} 集要点`)
    toast('本集要点已按当前正文重新提炼')
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        {fromQa ? (
          <Link to={qaIssue ? qaBackPath(project, qaIssue) : `${stagePath(project, 'qa')}?ep=${ep}`} className="inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900">
            <ArrowLeft size={14} />
            返回质检
          </Link>
        ) : (
          <Link to={`${scriptStagePath(project)}?ep=${ep}`} className="inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900">
            <ArrowLeft size={14} />
            分集蓝图
          </Link>
        )}
        <div className="flex items-center gap-1">
          {prev > 0 && (
            <Link to={finalPath(project, prev)} className={buttonClass('ghost', 'sm')}>
              <ArrowLeft size={14} />第 {prev} 集
            </Link>
          )}
          {Number.isFinite(next) && (
            <Link to={finalPath(project, next)} className={buttonClass('ghost', 'sm')}>
              第 {next} 集<ArrowRight size={14} />
            </Link>
          )}
        </div>
      </div>

      {/* 顶栏：标题 · 字数 · 来源 · 翻译 / 对照 */}
      <Card className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-5 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-[15px] font-semibold text-ink-900 tabular-nums">第 {ep} 集</span>
            <InlineInput aria-label="本集标题" value={script.title} onChange={(e) => patch(() => ({ title: e.target.value }))} placeholder="本集标题" className="w-48 text-[15px] font-semibold" />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs whitespace-nowrap text-ink-500">
            <Badge tone="green">已定稿</Badge>
            {source && (
              <Link to={draftPath(project, source.id)} className="hover:text-brand-600">
                来自 {draftLabel(source)}
              </Link>
            )}
            <span className={clsx(dotBefore, 'tabular-nums')}>{wordCount(script).toLocaleString()} 字</span>
            <span className={dotBefore}>{formatDateTime(script.updatedAt)} 更新</span>
            <button type="button" data-open-notes onClick={() => openPanel('notes')} className={clsx(dotBefore, notes.length ? 'text-amber-700 hover:text-amber-800' : 'hover:text-brand-600')}>
              {notes.length ? `${notes.length} 条标注` : '加标注'}
            </button>
          </div>
        </div>
        {bilingual && (
          <div className="flex flex-wrap items-center gap-2">
            {hasEn && (
              <Segmented<View>
                value={view}
                onChange={setView}
                options={[
                  { value: 'zh', label: '中文' },
                  { value: 'en_zh', label: '中英对照' },
                ]}
              />
            )}
            <AiButton variant="secondary" loading={running === 'translate'} disabled={!!running} onClick={translate}>
              {script.translated ? '补译台词' : '一键翻译'}
            </AiButton>
          </div>
        )}
      </Card>

      {qaIssue && <QaReturnBanner project={project} issue={qaIssue} />}
      {v2 && !fromQa && <RelayBar project={project} ep={ep} />}

      <ScriptEditor
        project={project}
        lines={script.lines}
        readOnly={false}
        showEn={showEn}
        onLines={setLines}
        notes={notes}
        onNotes={setNotes}
        onPick={setPick}
        focusLineId={qaIssue?.lineId}
        tips={[
          `状态库按正文汇总；改过的中文台词英文会清空，可再点${script.translated ? '「补译台词」' : '「一键翻译」'}`,
          '要标注某段：点选后在状态库的「标注」里写下，作为改正文时的待办提醒',
        ]}
      />

      {/* 本集要点（含伏笔推进候选）/ 标注：填进状态库侧栏对应的标签页；人物状态在要点的「角色动态」与状态库标签页里 */}
      {slot &&
        createPortal(
          sideTab === 'points' ? (
            <div className="space-y-4 px-4">
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-ink-400">提炼自定稿正文，写下一集时注入 AI</span>
                  {blueprint && (
                    <button type="button" title="按当前正文重新提炼" onClick={refreshPoints} className="inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700">
                      <RefreshCw size={12} />
                      重新提炼
                    </button>
                  )}
                </div>
                {blueprint?.points ? (
                  <PointsView points={blueprint.points} />
                ) : (
                  <p className="text-xs text-ink-400">
                    {blueprint ? '还没有要点' : '本集蓝图已删除，'}
                    {!blueprint && (
                      <Link to={`${scriptStagePath(project)}?ep=${ep}`} className="text-brand-600 hover:text-brand-700">
                        去补一份
                      </Link>
                    )}
                  </p>
                )}
              </div>

              <div className="border-t border-line pt-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-[13px] font-medium text-ink-900">
                    <Flag size={13} className="text-ink-400" />
                    伏笔推进候选
                  </span>
                  {candidates.length > 0 && (
                    <Link to={stagePath(project, 'foreshadow')} className="text-xs text-brand-600 hover:text-brand-700">
                      去确认
                    </Link>
                  )}
                </div>
                {candidates.length ? (
                  <ul className="space-y-2.5">
                    {candidates.map(({ f, c }) => (
                      <li key={f.id} className="text-[12.5px] leading-5">
                        <div className="flex items-center gap-1.5">
                          <Badge tone={PLAN_EVENT_META[c.kind].tone}>{PLAN_EVENT_META[c.kind].label}</Badge>
                          <span className="truncate font-medium text-ink-900">{foreshadowName(f)}</span>
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-ink-500">{c.text}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-ink-400">没有待确认的推进</p>
                )}
                <p className="mt-2 text-xs text-ink-400">正文里命中伏笔检索词的行，确认后才计入状态库</p>
              </div>

            </div>
          ) : sideTab === 'notes' ? (
            <NotesTab lines={script.lines} notes={notes} pick={pick} onNotes={setNotes} footer="改正文时的待办提醒，改完可在正文里删掉" />
          ) : null,
          slot,
        )}
    </div>
  )
}
