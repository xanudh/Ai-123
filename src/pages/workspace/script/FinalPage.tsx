import { ArrowLeft, ArrowRight, BookOpen, Flag, Info, RefreshCw, Users } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { AiButton, InlineInput, latestProject, stagePath, useAiTask } from '../../../components/stage/StageKit'
import { Badge, Button, Card, CardHeader, EmptyState, Segmented, buttonClass } from '../../../components/ui'
import { PLAN_EVENT_META } from '../../../domain/constants'
import type { EpisodeScript } from '../../../domain/types'
import { blueprintOf, draftLabel, draftsOf, eventCandidates, foreshadowName, scriptOf, wordCount } from '../../../domain/work'
import { formatDateTime } from '../../../lib/format'
import { extractPoints, translateEpisode } from '../../../services/ai'
import { useProjects } from '../../../store/projects'
import { useStateFocus } from '../../../store/statePanel'
import { toast } from '../../../store/toast'
import { useCurrentProject } from '../ProjectLayout'
import { ScriptEditor } from './ScriptEditor'
import type { Updater } from './ScriptEditor'
import { draftPath, finalPath, patchScript, scriptStagePath } from './ops'

type View = 'zh' | 'en_zh'

export default function FinalPage() {
  const project = useCurrentProject()
  const ep = Number(useParams().ep)
  const patchWork = useProjects((s) => s.patchWork)
  const { running, run } = useAiTask()
  const [view, setView] = useState<View>('en_zh')
  useStateFocus(ep > 0 ? { kind: 'ep', ep } : null)

  const w = project.work
  const script = scriptOf(w, ep)
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
  const states = Object.entries(script.states)

  /** 在最新数据上改本集正文 */
  const patch = (fn: (s: EpisodeScript) => Partial<EpisodeScript>, note?: string) => {
    const cur = latestProject(project.id)
    const s = cur && scriptOf(cur.work, ep)
    if (cur && s) patchWork(project.id, patchScript(cur.work, ep, fn(s)), note)
  }
  const setLines: Updater<EpisodeScript['lines'][number]> = (update) => patch((s) => ({ lines: update(s.lines) }))

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
        <Link to={`${scriptStagePath(project)}?ep=${ep}`} className="inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900">
          <ArrowLeft size={14} />
          分集蓝图
        </Link>
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
      <Card className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="shrink-0 text-[15px] font-semibold text-ink-900 tabular-nums">第 {ep} 集 —</span>
          <InlineInput aria-label="本集标题" value={script.title} onChange={(e) => patch(() => ({ title: e.target.value }))} placeholder="本集标题" className="w-56 text-[15px] font-semibold" />
          <span className="text-[13px] text-ink-500 tabular-nums">{wordCount(script).toLocaleString()} 字</span>
          <Badge tone="green">已定稿</Badge>
          {source && (
            <Link to={draftPath(project, source.id)} className="text-xs text-ink-400 hover:text-brand-600">
              来自 {draftLabel(source)}
            </Link>
          )}
          <span className="text-xs text-ink-400">{formatDateTime(script.updatedAt)} 更新</span>
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

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_272px]">
        <div className="min-w-0 space-y-3">
          <p className="flex items-center gap-1.5 text-xs text-ink-400">
            <Info size={13} className="shrink-0" />
            正文修改自动保存，状态库按正文汇总；改过的中文台词英文会清空，可再点{script.translated ? '「补译台词」' : '「一键翻译」'}。
          </p>
          <ScriptEditor project={project} lines={script.lines} readOnly={false} showEn={showEn} onLines={setLines} />
        </div>

        {/* 侧栏：本集要点 / 伏笔推进 / 人物状态 */}
        <div className="space-y-4 xl:sticky xl:top-4">
          <Card>
            <CardHeader
              title="本集要点"
              desc="写下一集时注入 AI"
              action={
                blueprint && (
                  <Button size="sm" variant="ghost" className="h-7 px-2" title="按当前正文重新提炼" onClick={refreshPoints}>
                    <RefreshCw size={13} />
                    重新提炼
                  </Button>
                )
              }
            />
            {blueprint?.points ? (
              <p className="px-4 py-3 font-mono text-[12px] leading-5 whitespace-pre-wrap text-ink-700">{blueprint.points}</p>
            ) : (
              <p className="px-4 py-3 text-xs text-ink-400">
                {blueprint ? '还没有要点' : '本集蓝图已删除，'}
                {!blueprint && (
                  <Link to={`${scriptStagePath(project)}?ep=${ep}`} className="text-brand-600 hover:text-brand-700">
                    去补一份
                  </Link>
                )}
              </p>
            )}
          </Card>

          <Card>
            <CardHeader
              title={<span className="flex items-center gap-1.5"><Flag size={14} className="text-ink-400" />伏笔推进候选</span>}
              desc="正文里命中伏笔检索词的行，确认后才计入状态库"
              action={
                candidates.length > 0 && (
                  <Link to={stagePath(project, 'foreshadow')} className="text-xs text-brand-600 hover:text-brand-700">
                    去确认
                  </Link>
                )
              }
            />
            {candidates.length ? (
              <ul className="space-y-2.5 px-4 py-3">
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
              <p className="px-4 py-3 text-xs text-ink-400">没有待确认的推进</p>
            )}
          </Card>

          <Card>
            <CardHeader title={<span className="flex items-center gap-1.5"><Users size={14} className="text-ink-400" />人物状态</span>} desc="本集结束时，回写状态库" />
            {states.length ? (
              <dl className="space-y-1.5 px-4 py-3 text-[12.5px] leading-5">
                {states.map(([name, state]) => (
                  <div key={name} className="flex gap-2">
                    <dt className="w-16 shrink-0 truncate font-medium text-ink-900">{name}</dt>
                    <dd className="min-w-0 flex-1 text-ink-700">{state}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="px-4 py-3 text-xs text-ink-400">没有人物状态变化</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
