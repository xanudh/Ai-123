import clsx from 'clsx'
import { ArrowRight, CheckCheck, Eye, Layers, Plus, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { ConfirmDialog } from '../../../components/overlay'
import { CheckTab, useCheckTab } from '../../../components/project/CheckTab'
import { LooksEditor } from '../../../components/project/LooksEditor'
import { AiButton, AutoTextarea, CheckList, latestProject, stagePath, useAiTask } from '../../../components/stage/StageKit'
import { Badge, Button, Card, Field, Input, NumberInput } from '../../../components/ui'
import { DRAFT_STATUS_META, EPISODE_RANGE, SCRIPT_BATCH } from '../../../domain/constants'
import { modelLabel, modelOf } from '../../../domain/models'
import { rhythmOnResize } from '../../../domain/rhythm'
import { preWriteCheck } from '../../../domain/state'
import type { EpisodeBlueprint, Project } from '../../../domain/types'
import { blueprintOf, draftLabel, draftsOf, plainText, prevHookOf, scriptOf } from '../../../domain/work'
import { formatDateTime } from '../../../lib/format'
import { BasisInfo } from '../../../components/project/BasisInfo'
import { downBasis } from '../../../domain/basis'
import { draftBlueprints, nextSeed } from '../../../services/ai'
import { startBatch, useBatchRun } from '../../../store/batchRun'
import { useProjects } from '../../../store/projects'
import { useStateFocus } from '../../../store/statePanel'
import { toast } from '../../../store/toast'
import { EpisodeDots } from '../../../v2/EpisodeSteps'
import { FinalizeAll, finalizeRows } from '../script/FinalizeAll'
import { draftPath, finalPath, nextUnwritten, prefillBlueprint } from '../script/ops'
import { writeManual } from '../script/write'

interface Pending {
  title: string
  desc: string
  confirmText: string
  danger?: boolean
  action: () => void
}

const POSITION_TONE: Record<string, 'violet' | 'orange' | 'green' | 'amber' | 'gray'> = {
  开篇: 'violet',
  付费卡点: 'orange',
  转折: 'green',
  高潮: 'amber',
  结局: 'amber',
}

export default function ScriptStage({ project, blocked }: { project: Project; blocked: boolean }) {
  const patchWork = useProjects((s) => s.patchWork)
  const updateProject = useProjects((s) => s.updateProject)
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { running, run } = useAiTask()
  const total = project.spec.totalEpisodes
  const w = project.work
  // 存下来的蓝图（编剧改过、AI 生成过或写过的集）
  const stored = w.blueprints.filter((b) => b.ep <= total)
  // 逐集蓝图（11/5 标注 #89）：每一集都先列出来，没存过的按情节大纲和人物设定预填
  const blueprints = Array.from({ length: total }, (_, i) => blueprintOf(w, i + 1) ?? prefillBlueprint(project, i + 1))
  const outlined = w.outline.filter((o) => o.ep <= total).length
  const next = nextUnwritten(project)

  // ?ep=N 从草稿页 / 目录树跳过来时选中对应的集
  const epParam = Number(params.get('ep')) || 0
  const [selected, setSelected] = useState(() => epParam || Math.min(next, total))
  const [seenParam, setSeenParam] = useState(epParam)
  if (epParam !== seenParam) {
    setSeenParam(epParam)
    if (epParam) setSelected(epParam)
  }
  const [pending, setPending] = useState<Pending | null>(null)
  // 批量写作进度：正在写的集、第几集 / 共几集、本批的模型；页头换模型时也要看
  const batchAt = useBatchRun((s) => (s.run?.projectId === project.id ? s.run : null))
  // 批量写作的集数范围：直接输入集数，结束集可到最后一集，默认从第一个没写过的集起写 SCRIPT_BATCH 集；起始集不能越过没写的集
  const [range, setRange] = useState<{ from: number; to: number } | null>(null)

  const current = blueprints.find((b) => b.ep === selected) ?? blueprints[0]
  const writeEp = current?.ep ?? Math.min(next, total)
  const checks = preWriteCheck(project, writeEp)
  useStateFocus({ kind: 'ep', ep: writeEp })
  // 写作前检查放在状态库侧栏的「检查」标签页
  useCheckTab(checks)
  const writeBlock = checks.find((c) => c.level === 'block')
  const versions = draftsOf(w, writeEp)
  const final = scriptOf(w, writeEp)
  const startMax = Math.min(next, total)
  const batchFrom = Math.min(range?.from ?? startMax, startMax)
  const batchTo = Math.max(batchFrom, Math.min(range?.to ?? batchFrom + SCRIPT_BATCH - 1, total))
  // 每一集都已列出：「+」加在最后，总集数加一，不能超过立项上限
  const canGrow = total < EPISODE_RANGE.max
  // 一键定稿：每集最新一版还是草稿的
  const [finalizing, setFinalizing] = useState(false)
  const toFinalize = finalizeRows(project)

  const setBlueprints = (list: EpisodeBlueprint[], note?: string) => patchWork(project.id, { blueprints: [...list].sort((a, b) => a.ep - b.ep) }, note)

  /** 改一项：还是预填的集，连同预填的内容一起存下来 */
  const update = (ep: number, patch: Partial<EpisodeBlueprint>) => {
    const cur = latestProject(project.id)
    if (!cur) return
    const list = blueprintOf(cur.work, ep) ? cur.work.blueprints.map((b) => (b.ep === ep ? { ...b, ...patch } : b)) : [...cur.work.blueprints, { ...prefillBlueprint(cur, ep), ...patch }]
    setBlueprints(list)
  }

  /** 恢复预填：改过的内容按情节大纲和人物设定重新预填；本集要点（和旧数据里的作者微操指导）留着，有它们就按预填重写一份带上，没有就回到跟着情节大纲走的预填 */
  const reset = (eps: number[] | null, note: string) => {
    const cur = latestProject(project.id)
    if (!cur) return
    const list = cur.work.blueprints.flatMap((b) => {
      if (eps && !eps.includes(b.ep)) return [b]
      return b.points.trim() || b.guidance.trim() ? [{ ...prefillBlueprint(cur, b.ep), guidance: b.guidance, points: b.points }] : []
    })
    setBlueprints(list, note)
  }

  /** AI 结果合并回最新数据：本集要点以等待期间的最新内容为准（作者微操指导 11/4 从页面删掉，旧数据照样带着） */
  const merge = (result: EpisodeBlueprint[], note: string) => {
    const cur = latestProject(project.id)
    if (!cur) return
    const eps = new Set(result.map((b) => b.ep))
    const kept = result.map((b) => {
      const prev = blueprintOf(cur.work, b.ep)
      return prev ? { ...b, guidance: prev.guidance, points: prev.points } : b
    })
    setBlueprints([...cur.work.blueprints.filter((b) => !eps.has(b.ep)), ...kept], note)
  }

  const generateAll = async () => {
    const cur = latestProject(project.id)
    if (!cur) return
    const seed = cur.work.blueprints.length ? nextSeed() : 0
    const result = await run('blueprints', (signal) => draftBlueprints(cur, 1, total, seed, signal))
    if (!result) return
    if (!result.length) {
      toast('还没有集纲：先到情节大纲生成', 'error')
      return
    }
    merge(result, `AI 生成逐集蓝图：${result.length} 集`)
    toast(`已按情节大纲生成 ${result.length} 集蓝图，本集要点已保留`)
  }

  const regenerate = async (ep: number) => {
    const cur = latestProject(project.id)
    if (!cur) return
    const result = await run('one', (signal) => draftBlueprints(cur, ep, ep, nextSeed(), signal))
    if (!result) return
    if (!result.length) {
      toast(`第 ${ep} 集还没有集纲，无法生成蓝图`, 'error')
      return
    }
    merge(result, `重新生成第 ${ep} 集蓝图`)
    toast(`第 ${ep} 集蓝图已重新生成`)
  }

  const add = () => {
    if (!canGrow) return
    const n = total + 1
    setPending({
      title: `加第 ${n} 集？`,
      desc: `新增第 ${n} 集会把总集数从 ${total} 改为 ${n}，节奏框架与阶段分段随之调整（故事架构里也能改总集数）；第 ${n} 集还没有集纲，蓝图先按人物设定预填，到情节大纲生成本集集纲后会按集纲补上。`,
      confirmText: `加到 ${n} 集`,
      action: grow,
    })
  }

  /** 总集数加一；新的最后一集和其他集一样按预填列出来（越界时留下的旧蓝图直接沿用） */
  const grow = () => {
    const cur = latestProject(project.id)
    if (!cur) return
    const n = cur.spec.totalEpisodes + 1
    if (n > EPISODE_RANGE.max) return
    updateProject(project.id, { spec: { ...cur.spec, totalEpisodes: n }, rhythm: rhythmOnResize(cur, n) }, `总集数改为 ${n} 集`)
    setSelected(n)
    toast(`已加到 ${n} 集，第 ${n} 集还没有集纲，先到情节大纲生成`)
  }

  /** 自己写：不用 AI，新建一版列好架子的草稿，直接打开编辑 */
  const writeByHand = (ep: number) => {
    const draft = writeManual(project.id, ep)
    if (draft) navigate(draftPath(project, draft.id))
  }

  /** 按选好的范围逐集写：在页面之外跑，离开这一页也会接着写；遇到不能写的集就停，中途可以停止，已写出的草稿保留 */
  const batch = (from: number, to: number) => {
    setRange(null)
    void startBatch(project.id, from, to)
  }

  /** 范围里有已写过的集：另存新版本前先确认 */
  const askBatch = () => {
    const from = batchFrom
    const to = batchTo
    const written = Array.from({ length: to - from + 1 }, (_, i) => from + i).filter((ep) => scriptOf(w, ep) || draftsOf(w, ep).length)
    if (!written.length) return batch(from, to)
    setPending({
      title: `批量写作第 ${from}–${to} 集？`,
      desc: `第 ${written.join('、')} 集已经写过，会各自另存一版新草稿，原有草稿与正文不受影响。`,
      confirmText: '继续写作',
      action: () => batch(from, to),
    })
  }

  const askGenerate = () =>
    stored.length
      ? setPending({
          title: '重新生成全部蓝图？',
          desc: '出场人物、冲突与钩子会按最新的情节大纲重写；本集要点保留。',
          confirmText: '重新生成',
          action: generateAll,
        })
      : generateAll()

  const askReset = (ep: number) =>
    setPending({
      title: `第 ${ep} 集蓝图恢复预填？`,
      desc: '改过的标题、出场人物、冲突、承接、钩子与人物本集状态，按情节大纲和人物设定重新预填；本集要点保留，草稿与正文不受影响。',
      confirmText: '恢复预填',
      danger: true,
      action: () => reset([ep], `第 ${ep} 集蓝图恢复预填`),
    })

  const askResetAll = () =>
    setPending({
      title: '全部蓝图恢复预填？',
      desc: `${stored.length} 集存过的蓝图都按情节大纲和人物设定重新预填；本集要点保留，草稿箱与正文章节不受影响。`,
      confirmText: '全部恢复',
      danger: true,
      action: () => reset(null, '逐集蓝图全部恢复预填'),
    })

  const checkTab = (
    <CheckTab title={`写作前检查 · 第 ${writeEp} 集`} desc="对照剧本状态库：集纲与蓝图、上一集定稿、钩子承接、人物最新状态">
      <CheckList items={checks} empty="一切就绪，可以开始写作" />
      {(versions.length > 0 || final) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-3 text-[13px]">
          <span className="text-ink-500">本集进度</span>
          {versions.slice(0, 3).map((d) => (
            <Link key={d.id} to={draftPath(project, d.id)} className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-ink-900 hover:bg-canvas">
              {draftLabel(d)}
              <Badge tone={DRAFT_STATUS_META[d.status].tone}>{DRAFT_STATUS_META[d.status].label}</Badge>
            </Link>
          ))}
          {final && (
            <Link to={finalPath(project, writeEp)} className="flex items-center gap-1 font-medium text-brand-600 hover:text-brand-700">
              正文第 {writeEp} 集
              <ArrowRight size={13} />
            </Link>
          )}
        </div>
      )}
      <p className="text-xs text-ink-400">
        {versions.length ? `再次写作会生成 草稿_v${versions[0].version + 1}，原有版本保留在草稿箱` : '写好的草稿放入草稿箱；审稿 / 修稿后定稿，归入正文章节'}
      </p>
    </CheckTab>
  )

  const currentFinal = scriptOf(w, current.ep)
  const currentStored = !!blueprintOf(w, current.ep)
  const currentOutlined = w.outline.some((o) => o.ep === current.ep)
  // 承接没填时默认接上集结尾的钩子，作为输入框提示
  const carryDefault = plainText(prevHookOf(w, current.ep))

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div className="flex items-center gap-2">
            <Layers size={16} className="text-ink-500" />
            <span className="text-[15px] font-semibold text-ink-900">逐集蓝图</span>
            <span className="text-[13px] text-ink-400 tabular-nums">（{total} 集）</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* 一集集纲都没有时不出写作按钮：蓝图按集纲预填，先到情节大纲生成 */}
            {(outlined > 0 || stored.length > 0) && (
              <>
                <span className="flex items-center gap-1 text-[13px] text-ink-500">
                  第
                  <NumberInput
                    aria-label="批量写作起始集"
                    title={`起始集最多到第 ${startMax} 集（要按顺序写，不能跳过没写的集）`}
                    className="h-8 w-14 px-1"
                    value={batchFrom}
                    min={1}
                    max={startMax}
                    disabled={!!running || !!batchAt}
                    onCommit={(from) => setRange({ from, to: Math.min(total, from + SCRIPT_BATCH - 1) })}
                  />
                  –
                  <NumberInput
                    aria-label="批量写作结束集"
                    title={`可写到第 ${total} 集`}
                    className="h-8 w-14 px-1"
                    value={batchTo}
                    min={batchFrom}
                    max={total}
                    disabled={!!running || !!batchAt}
                    onCommit={(to) => setRange({ from: batchFrom, to })}
                  />
                  集
                </span>
                <AiButton
                  variant="secondary"
                  loading={!!batchAt}
                  disabled={blocked || !!running || !!batchAt}
                  title={
                    batchAt
                      ? `本批用 ${modelLabel(batchAt.model)} 写：开写时定下，中途在页头换模型不影响本批`
                      : `按顺序逐集写，用 ${modelLabel(modelOf(project, 'text'))} 写，范围可选到第 ${total} 集；起始集不能越过第 ${startMax} 集（不能跳过没写的集）`
                  }
                  onClick={askBatch}
                >
                  {batchAt ? `正在写第 ${batchAt.ep} 集（${batchAt.i}/${batchAt.n}）…` : '批量写作'}
                </AiButton>
                <BasisInfo title="逐集写作" row={downBasis(project, 'write')} align="right" />
                {batchAt && (
                  <Button variant="ghost" size="sm" title="停止后续集；已写出的草稿保留" onClick={batchAt.stop}>
                    停止
                  </Button>
                )}
              </>
            )}
            {w.drafts.length > 0 && (
              <Button
                variant="secondary"
                size="sm"
                disabled={blocked || !toFinalize.length || !!running}
                title={toFinalize.length ? `${toFinalize.length} 集的最新一版还是草稿：勾选后按集号依次定稿` : '没有待定稿的草稿：每集最新一版都已定稿'}
                onClick={() => setFinalizing(true)}
              >
                <CheckCheck size={14} />
                一键定稿
                {toFinalize.length > 0 && <span className="text-ink-400 tabular-nums">{toFinalize.length}</span>}
              </Button>
            )}
            <AiButton
              variant="secondary"
              loading={running === 'blueprints'}
              disabled={blocked || !!running || !outlined}
              title={outlined ? `按情节大纲生成 ${outlined} 集蓝图，本集要点保留` : '还没有集纲：先到情节大纲生成'}
              onClick={askGenerate}
            >
              AI 生成蓝图
            </AiButton>
            <BasisInfo title="逐集蓝图" row={downBasis(project, 'blueprint')} align="right" />
            <Button
              variant="secondary"
              size="sm"
              className="px-2"
              aria-label="新增一集蓝图"
              title={canGrow ? `加第 ${total + 1} 集（总集数改为 ${total + 1}）` : `总集数已到上限 ${EPISODE_RANGE.max} 集`}
              disabled={!canGrow || !!running}
              onClick={add}
            >
              <Plus size={14} />
            </Button>
            <button
              type="button"
              disabled={!stored.length || !!running}
              title={stored.length ? `${stored.length} 集存过的蓝图按情节大纲和人物设定重新预填` : '每一集都还是预填的'}
              onClick={askResetAll}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RotateCcw size={14} />
              全部恢复预填
            </button>
          </div>
        </div>
      </Card>

      <div className="grid items-start gap-4 lg:grid-cols-[232px_minmax(0,1fr)]">
        {/* 蓝图列表 */}
        <Card className="scrollbar-thin p-1.5 lg:sticky lg:top-stick lg:max-h-stick lg:overflow-y-auto">
          <ul data-bp-list className="space-y-0.5">
            {blueprints.map((b) => {
              const done = !!scriptOf(w, b.ep)
              const n = draftsOf(w, b.ep).length
              const on = b.ep === current.ep
              return (
                <li key={b.ep}>
                  <button
                    type="button"
                    onClick={() => setSelected(b.ep)}
                    aria-current={on || undefined}
                    className={clsx('flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors', on ? 'bg-brand-50' : 'hover:bg-canvas')}
                  >
                    <span
                      title={done ? '已定稿' : undefined}
                      className={clsx(
                        'mt-px flex size-6 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold tabular-nums',
                        done ? 'bg-emerald-100 text-emerald-700' : on ? 'bg-brand-600 text-white' : 'bg-canvas text-ink-500',
                      )}
                    >
                      {b.ep}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className={clsx('block min-w-0 flex-1 truncate text-[13px]', on ? 'font-semibold text-brand-700' : 'font-medium text-ink-900')}>{b.title || `第 ${b.ep} 集`}</span>
                        <EpisodeDots project={project} ep={b.ep} />
                      </span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        <Badge tone={POSITION_TONE[b.position] ?? 'gray'}>{b.position || '未定位'}</Badge>
                        {!blueprintOf(w, b.ep) && !w.outline.some((o) => o.ep === b.ep) && <Badge tone="amber">待集纲</Badge>}
                        {b.points.trim() && <Badge tone="green">有要点</Badge>}
                        {n > 0 && <Badge tone="gray">{n} 稿</Badge>}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </Card>

        {/* 蓝图表单 */}
        <div className="min-w-0 space-y-4">
          <Card>
            <div data-ep-head className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line px-5 py-3">
              <div className="min-w-0">
                {/* 恢复预填放在标题旁，和右边的写作按钮隔开，免得误点；还是预填的集没有 */}
                <div className="flex min-w-0 items-center gap-1">
                  <h3 className="truncate text-[15px] font-semibold text-ink-900">
                    第 {current.ep} 集：{current.title || <span className="text-ink-400">未命名</span>}
                  </h3>
                  {currentStored && (
                    <button
                      type="button"
                      aria-label="恢复预填"
                      title={`第 ${current.ep} 集蓝图按情节大纲和人物设定重新预填`}
                      onClick={() => askReset(current.ep)}
                      className="shrink-0 rounded-md p-1 text-ink-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <RotateCcw size={14} />
                    </button>
                  )}
                </div>
                {/* 标题下的「修改自动保存 · 检查通过」11/5 标注 #92 删掉：写作前检查在状态库的「检查」标签页 */}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <AiButton
                  variant="secondary"
                  loading={running === 'one'}
                  disabled={blocked || !!running || !currentOutlined}
                  title={currentOutlined ? `只${currentStored ? '重新' : ''}生成第 ${current.ep} 集的蓝图，本集要点保留` : `第 ${current.ep} 集还没有集纲：先到情节大纲生成`}
                  onClick={() =>
                    currentStored
                      ? setPending({
                          title: `重新生成第 ${current.ep} 集蓝图？`,
                          desc: '本集标题、出场人物、冲突与钩子会按集纲重新生成；本集要点保留，其他集不受影响。',
                          confirmText: '重新生成',
                          action: () => regenerate(current.ep),
                        })
                      : regenerate(current.ep)
                  }
                >
                  {currentStored ? '重新生成本集蓝图' : 'AI 生成本集蓝图'}
                </AiButton>
                {(final || versions.length > 0) && (
                  <Button
                    variant="secondary"
                    size="sm"
                    title={final ? `打开第 ${current.ep} 集正文` : `打开 ${draftLabel(versions[0])}`}
                    onClick={() => navigate(final ? finalPath(project, current.ep) : draftPath(project, versions[0].id))}
                  >
                    <Eye size={14} />
                    查看本集
                  </Button>
                )}
                {/* 11/5 标注 #93：这里不走 AI，新建一版按本集蓝图列好架子的草稿，去编辑器里自己写；要 AI 写用批量写作 */}
                <Button
                  size="sm"
                  disabled={blocked || !!writeBlock || !!running}
                  title={writeBlock?.text ?? `新建一版第 ${writeEp} 集草稿，按本集蓝图列好开头承接和末尾钩子，中间自己写，不用 AI`}
                  onClick={() => writeByHand(writeEp)}
                >
                  去写第 {writeEp} 集
                  <ArrowRight size={14} />
                </Button>
              </div>
            </div>
            <div className="space-y-4 p-5">
              {!currentStored && !currentOutlined && (
                <p data-bp-no-outline className="flex flex-wrap items-center gap-x-2 rounded-lg bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-800">
                  第 {current.ep} 集还没有集纲：先到情节大纲生成，这里会按集纲和人物设定预填
                  <Link to={`${stagePath(project, 'outline')}?ep=${current.ep}`} className="font-medium text-brand-600 hover:text-brand-700">
                    去情节大纲 →
                  </Link>
                </p>
              )}
              {/* 集号就在卡片标题里，不再单列一个不能改的输入框 */}
              <Field label="本集标题">
                <Input value={current.title} onChange={(e) => update(current.ep, { title: e.target.value })} placeholder="本集标题" />
              </Field>
              {/* 本集定位、主角小目标 11/4 标注删掉（定位仍按节奏框架标在左侧列表里） */}
              <Field label="出场关键人（逗号分隔）" hint="AI 审稿会检查这些人物是否出场">
                <Input value={current.cast} onChange={(e) => update(current.ep, { cast: e.target.value })} placeholder="主角、反派、关键配角" />
              </Field>
              <Field label="实质冲突与转折">
                <AutoTextarea minRows={3} value={current.conflict} onChange={(e) => update(current.ep, { conflict: e.target.value })} placeholder="谁阻碍主角、怎么升级、在哪里反转" />
              </Field>
              <Field label="承接" hint="本集开头接住什么：上集结尾的钩子；不填时默认接上集结尾的钩子">
                <AutoTextarea
                  aria-label="承接"
                  minRows={2}
                  value={current.carry ?? ''}
                  onChange={(e) => update(current.ep, { carry: e.target.value })}
                  placeholder={carryDefault ? `默认接上集结尾：${carryDefault}` : current.ep === 1 ? '第 1 集是开篇，没有上集可承接' : '上集结尾留下的悬念'}
                />
              </Field>
              <Field label="末尾悬念钩子">
                <AutoTextarea minRows={2} value={current.hook} onChange={(e) => update(current.ep, { hook: e.target.value })} placeholder="最后 10 秒留什么让观众点下一集" />
              </Field>
              <Field label="人物本集状态" hint="每个人在哪个场景进来、服化道重点；状态库与导出的剧本开头按这里列，方便拆资产">
                <LooksEditor
                  looks={current.looks ?? []}
                  cast={current.cast.split(/[,，、;；\s]+/).map((n) => n.trim()).filter(Boolean)}
                  onChange={(looks) => update(current.ep, { looks })}
                />
              </Field>

              <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
                <div className="mb-2 flex flex-wrap items-baseline gap-1">
                  <span className="text-[13px] font-semibold text-emerald-700">本集要点</span>
                  <span className="text-xs text-ink-500">（定稿后自动生成{currentFinal ? ` — ${formatDateTime(currentFinal.updatedAt)}` : ''}）</span>
                </div>
                <AutoTextarea
                  aria-label="本集要点"
                  minRows={4}
                  value={current.points}
                  onChange={(e) => update(current.ep, { points: e.target.value })}
                  placeholder="定稿后 AI 会自动填充本集要点（事件进展 / 角色变化），也可以提前手动输入给 AI 作参考"
                  className="font-mono text-[12.5px] leading-6"
                />
              </div>
            </div>
          </Card>

        </div>
      </div>

      {checkTab}
      {finalizing && <FinalizeAll project={project} onClose={() => setFinalizing(false)} />}

      <ConfirmDialog
        open={!!pending}
        onClose={() => setPending(null)}
        onConfirm={() => pending?.action()}
        title={pending?.title ?? ''}
        desc={pending?.desc}
        confirmText={pending?.confirmText}
        danger={pending?.danger}
      />
    </>
  )
}
