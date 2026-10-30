import clsx from 'clsx'
import { ArrowRight, CheckCheck, Eye, Layers, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { ConfirmDialog } from '../../../components/overlay'
import { CheckLink, CheckTab, useCheckTab } from '../../../components/project/CheckTab'
import { WriteButton } from '../../../components/project/ModelBits'
import { AiButton, AutoTextarea, CheckList, latestProject, useAiTask } from '../../../components/stage/StageKit'
import { Badge, Button, Card, EmptyState, Field, Input, NumberInput, Select, dotBefore } from '../../../components/ui'
import { DRAFT_STATUS_META, EPISODE_POSITIONS, EPISODE_RANGE, SCRIPT_BATCH } from '../../../domain/constants'
import { modelLabel, modelOf } from '../../../domain/models'
import { rhythmOnResize } from '../../../domain/rhythm'
import { buildState, preWriteCheck } from '../../../domain/state'
import type { EpisodeBlueprint, Foreshadow, ModelId, Project } from '../../../domain/types'
import { blueprintOf, draftLabel, draftsOf, foreshadowName, plainText, prevHookOf, scriptOf } from '../../../domain/work'
import { formatDateTime } from '../../../lib/format'
import { draftBlueprints, nextSeed, positionOf, writeEpisode } from '../../../services/ai'
import { setBatchRun, useBatchRun } from '../../../store/batchRun'
import { useProjects } from '../../../store/projects'
import { useStateFocus } from '../../../store/statePanel'
import { toast } from '../../../store/toast'
import { useV2 } from '../../../store/uiVersion'
import { EpisodeDots, EpisodeSteps } from '../../../v2/EpisodeSteps'
import { FinalizeAll, finalizeRows } from '../script/FinalizeAll'
import { addDraft, draftPath, finalPath, nextUnwritten } from '../script/ops'
import { writeDraft } from '../script/write'

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

/** 手动新增的蓝图：有集纲时按集纲预填 */
function blankBlueprint(p: Project, ep: number): EpisodeBlueprint {
  const o = p.work.outline.find((x) => x.ep === ep)
  return { ep, title: o?.title ?? '', position: positionOf(p, ep), cast: '', goal: '', conflict: o?.event ?? '', hook: o?.hookLine ?? '', guidance: '', points: '' }
}

export default function ScriptStage({ project, blocked }: { project: Project; blocked: boolean }) {
  const patchWork = useProjects((s) => s.patchWork)
  const updateProject = useProjects((s) => s.updateProject)
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { running, run, cancel } = useAiTask()
  const v2 = useV2()
  const total = project.spec.totalEpisodes
  const w = project.work
  const blueprints = w.blueprints.filter((b) => b.ep <= total).sort((a, b) => a.ep - b.ep)
  const outlined = w.outline.filter((o) => o.ep <= total).length
  const next = nextUnwritten(project)

  // ?ep=N 从草稿页 / 目录树跳过来时选中对应的集
  const epParam = Number(params.get('ep')) || 0
  const [selected, setSelected] = useState(() => epParam || (blueprints.some((b) => b.ep === next) ? next : (blueprints[0]?.ep ?? 1)))
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
  let firstMissing = 1
  while (firstMissing <= total && blueprints.some((b) => b.ep === firstMissing)) firstMissing++
  // 全部集都有蓝图时「+」加在最后：总集数加一，不能超过立项上限
  const canGrow = firstMissing > total && total < EPISODE_RANGE.max
  // 一键定稿：每集最新一版还是草稿的
  const [finalizing, setFinalizing] = useState(false)
  const toFinalize = finalizeRows(project)

  const setBlueprints = (list: EpisodeBlueprint[], note?: string) => patchWork(project.id, { blueprints: [...list].sort((a, b) => a.ep - b.ep) }, note)

  const update = (ep: number, patch: Partial<EpisodeBlueprint>) => {
    const cur = latestProject(project.id)
    if (cur) patchWork(project.id, { blueprints: cur.work.blueprints.map((b) => (b.ep === ep ? { ...b, ...patch } : b)) })
  }

  /** AI 结果合并回最新数据：作者微操指导与要点以等待期间的最新内容为准 */
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
    merge(result, `AI 生成分集蓝图：${result.length} 集`)
    toast(`已按情节大纲生成 ${result.length} 集蓝图，作者微操指导与要点已保留`)
    if (!current) setSelected(result.some((b) => b.ep === next) ? next : result[0].ep)
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
    const cur = latestProject(project.id)
    if (!cur) return
    if (firstMissing <= total) {
      setBlueprints([...cur.work.blueprints, blankBlueprint(cur, firstMissing)], `新增第 ${firstMissing} 集蓝图`)
      setSelected(firstMissing)
      return
    }
    if (!canGrow) return
    const n = total + 1
    setPending({
      title: `加第 ${n} 集？`,
      desc: `全部 ${total} 集都已有蓝图。新增第 ${n} 集会把总集数从 ${total} 改为 ${n}，节奏框架与阶段分段随之调整（故事架构里也能改总集数）；第 ${n} 集还没有集纲，蓝图先空着由你填写，或到情节大纲生成本集集纲后再点「重新生成本集蓝图」。`,
      confirmText: `加到 ${n} 集`,
      action: grow,
    })
  }

  /** 总集数加一，并给新的最后一集建一份空蓝图（越界时留下的旧蓝图直接沿用） */
  const grow = () => {
    const cur = latestProject(project.id)
    if (!cur) return
    const n = cur.spec.totalEpisodes + 1
    if (n > EPISODE_RANGE.max) return
    updateProject(project.id, { spec: { ...cur.spec, totalEpisodes: n }, rhythm: rhythmOnResize(cur, n) }, `总集数改为 ${n} 集`)
    const latest = latestProject(project.id)
    if (latest && !blueprintOf(latest.work, n)) setBlueprints([...latest.work.blueprints, blankBlueprint(latest, n)], `新增第 ${n} 集蓝图`)
    setSelected(n)
    toast(`已加到 ${n} 集，第 ${n} 集蓝图待填写`)
  }

  const markWriting = () => {
    if (latestProject(project.id)?.status === 'draft') updateProject(project.id, { status: 'writing' })
  }

  const write = async (ep: number, model?: ModelId) => {
    const draft = await writeDraft(project.id, ep, run, model)
    if (draft) navigate(draftPath(project, draft.id))
  }

  /** 按选好的范围逐集写；遇到不能写的集就停，中途可以停止，已写出的草稿保留 */
  const batch = async (from: number, to: number) => {
    const start = latestProject(project.id)
    if (!start) return
    // 整批用开写时的文本模型：中途在页头换模型，本批剩下的集仍用它写完，同一批文风一致
    const model = modelOf(start, 'text')
    let done = 0
    const result = await run('batch', async (signal) => {
      for (let ep = from; ep <= to; ep++) {
        const cur = latestProject(project.id)
        if (!cur) break
        const block = preWriteCheck(cur, ep).find((c) => c.level === 'block')
        if (block) return { stop: `第 ${ep} 集：${block.text}` }
        setBatchRun({ projectId: project.id, model, ep, i: ep - from + 1, n: to - from + 1, stop: cancel })
        const content = await writeEpisode(cur, ep, 0, signal, model)
        const latest = latestProject(project.id)
        if (!latest) break
        patchWork(project.id, { drafts: addDraft(latest.work, ep, content).drafts }, `批量写作：第 ${ep} 集草稿`)
        done++
      }
      return { stop: '' }
    })
    setBatchRun(null)
    setRange(null)
    if (done) markWriting()
    if (!result) {
      if (done) toast(`已停止批量写作，写出的 ${done} 集草稿已保存`)
    } else if (done) {
      toast(`已用 ${modelLabel(model)} 写出 ${done} 集草稿，逐集审稿后定稿${result.stop ? `（${result.stop}）` : ''}`)
    } else if (result.stop) {
      toast(result.stop, 'error')
    }
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
    blueprints.length
      ? setPending({
          title: '重新生成全部蓝图？',
          desc: '定位、出场人物、小目标、冲突与钩子会按最新的情节大纲重写；作者微操指导与本集要点保留。',
          confirmText: '重新生成',
          action: generateAll,
        })
      : generateAll()

  const askRemove = (ep: number) =>
    setPending({
      title: `删除第 ${ep} 集蓝图？`,
      desc: '本集的定位、出场人物、小目标、冲突、钩子、作者微操指导与要点都会删除；草稿与正文不受影响。',
      confirmText: '删除',
      danger: true,
      action: () => {
        const cur = latestProject(project.id)
        if (cur) setBlueprints(cur.work.blueprints.filter((b) => b.ep !== ep), `删除第 ${ep} 集蓝图`)
      },
    })

  const askClear = () =>
    setPending({
      title: '清空全部蓝图？',
      desc: `${blueprints.length} 集蓝图（含作者微操指导与定稿要点）都会删除；草稿箱与正文章节不受影响。`,
      confirmText: '清空',
      danger: true,
      action: () => setBlueprints([], '清空全部分集蓝图'),
    })

  const checkTab = (
    <CheckTab title={`写作前检查 · 第 ${writeEp} 集`} desc="对照剧本状态库：集纲与蓝图、上一集定稿、伏笔到期、钩子承接、人物最新状态">
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

  const positions = current ? [...new Set<string>([...EPISODE_POSITIONS, current.position].filter(Boolean))] : []
  const currentFinal = current && scriptOf(w, current.ep)
  // 承接没填时默认接上集结尾的钩子，作为输入框提示
  const carryDefault = current ? plainText(prevHookOf(w, current.ep)) : ''
  // 承接也可能是前几集埋下、到本集该响的伏笔：已埋（或计划已埋）还没回收的，按回收集排
  const carryForeshadows = current
    ? buildState(project, current.ep)
        .foreshadows.filter((f) => f.item.plantEp < current.ep && f.item.payoffEp >= current.ep && f.paidIn === null)
        .sort((a, b) => a.item.payoffEp - b.item.payoffEp)
        .slice(0, 4)
    : []
  const carryPhrase = (f: Foreshadow) => `第 ${f.plantEp} 集埋下的「${foreshadowName(f)}」在本集响起`

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div className="flex items-center gap-2">
            <Layers size={16} className="text-ink-500" />
            <span className="text-[15px] font-semibold text-ink-900">分集蓝图</span>
            <span className="text-[13px] text-ink-400 tabular-nums">（{blueprints.length} 集）</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* 没有蓝图时不出写作按钮：先生成蓝图 */}
            {blueprints.length > 0 && (
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
                    disabled={!!running}
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
                    disabled={!!running}
                    onCommit={(to) => setRange({ from: batchFrom, to })}
                  />
                  集
                </span>
                <AiButton
                  variant="secondary"
                  loading={running === 'batch'}
                  disabled={blocked || !!running}
                  title={
                    batchAt
                      ? `本批用 ${modelLabel(batchAt.model)} 写：开写时定下，中途在页头换模型不影响本批`
                      : `按顺序逐集写，用 ${modelLabel(modelOf(project, 'text'))} 写，范围可选到第 ${total} 集；起始集不能越过第 ${startMax} 集（不能跳过没写的集）`
                  }
                  onClick={askBatch}
                >
                  {running === 'batch' && batchAt ? `正在写第 ${batchAt.ep} 集（${batchAt.i}/${batchAt.n}）…` : '批量写作'}
                </AiButton>
                {running === 'batch' && (
                  <Button variant="ghost" size="sm" title="停止后续集；已写出的草稿保留" onClick={cancel}>
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
            <AiButton variant="secondary" loading={running === 'blueprints'} disabled={blocked || !!running} onClick={askGenerate}>
              AI 生成蓝图
            </AiButton>
            <Button
              variant="secondary"
              size="sm"
              className="px-2"
              aria-label="新增一集蓝图"
              title={
                firstMissing <= total
                  ? `新增第 ${firstMissing} 集蓝图`
                  : canGrow
                    ? `全部 ${total} 集都已有蓝图：点击加第 ${total + 1} 集（总集数改为 ${total + 1}）`
                    : `全部 ${total} 集都已有蓝图，总集数已到上限 ${EPISODE_RANGE.max} 集`
              }
              disabled={(firstMissing > total && !canGrow) || !!running}
              onClick={add}
            >
              <Plus size={14} />
            </Button>
            <button
              type="button"
              disabled={!blueprints.length || !!running}
              onClick={askClear}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Trash2 size={14} />
              清空全部蓝图
            </button>
          </div>
        </div>
      </Card>

      {!current ? (
        <>
          <Card>
            <EmptyState
              icon={<Layers size={22} />}
              title="还没有分集蓝图"
              desc="蓝图是写作前的预览设定：本集定位、出场人物、主角小目标、冲突与转折、末尾钩子，以及作者微操指导。先按情节大纲生成，确认后再点击写作。"
              action={
                <AiButton size="md" loading={running === 'blueprints'} disabled={blocked || !outlined || !!running} onClick={generateAll}>
                  AI 生成蓝图（{outlined} 集）
                </AiButton>
              }
            />
          </Card>
        </>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[232px_minmax(0,1fr)]">
          {/* 蓝图列表 */}
          <Card className="scrollbar-thin p-1.5 lg:sticky lg:top-stick lg:max-h-stick lg:overflow-y-auto">
            <ul className="space-y-0.5">
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
                        {v2 ? (
                          <span className="flex items-center gap-2">
                            <span className={clsx('block min-w-0 flex-1 truncate text-[13px]', on ? 'font-semibold text-brand-700' : 'font-medium text-ink-900')}>{b.title || `第 ${b.ep} 集`}</span>
                            <EpisodeDots project={project} ep={b.ep} />
                          </span>
                        ) : (
                          <span className={clsx('block truncate text-[13px]', on ? 'font-semibold text-brand-700' : 'font-medium text-ink-900')}>{b.title || `第 ${b.ep} 集`}</span>
                        )}
                        <span className="mt-1 flex flex-wrap gap-1">
                          <Badge tone={POSITION_TONE[b.position] ?? 'gray'}>{b.position || '未定位'}</Badge>
                          {b.guidance.trim() && <Badge tone="violet">有指导</Badge>}
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
                  {/* 删除放在标题旁，和右边的写作按钮隔开，免得误点 */}
                  <div className="flex min-w-0 items-center gap-1">
                    <h3 className="truncate text-[15px] font-semibold text-ink-900">
                      第 {current.ep} 集：{current.title || <span className="text-ink-400">未命名</span>}
                    </h3>
                    <button
                      type="button"
                      aria-label="删除此集"
                      title={`删除第 ${current.ep} 集蓝图`}
                      onClick={() => askRemove(current.ep)}
                      className="shrink-0 rounded-md p-1 text-ink-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <span className="flex items-center text-xs text-ink-400">
                    修改自动保存
                    <CheckLink items={checks} className={clsx(dotBefore, 'ml-2')} />
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <AiButton
                    variant="secondary"
                    loading={running === 'one'}
                    disabled={blocked || !!running}
                    title={`只重新生成第 ${current.ep} 集的蓝图，作者微操指导与本集要点保留`}
                    onClick={() =>
                      setPending({
                        title: `重新生成第 ${current.ep} 集蓝图？`,
                        desc: '本集标题、定位、出场人物、小目标、冲突与钩子会按集纲重新生成；作者微操指导与本集要点保留，其他集不受影响。',
                        confirmText: '重新生成',
                        action: () => regenerate(current.ep),
                      })
                    }
                  >
                    重新生成本集蓝图
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
                  <WriteButton
                    project={project}
                    loading={running === 'write'}
                    disabled={blocked || !!writeBlock || !!running}
                    title={writeBlock?.text ?? `按第 ${writeEp} 集蓝图写作`}
                    onWrite={(model) => write(writeEp, model)}
                  >
                    写作第 {writeEp} 集
                  </WriteButton>
                </div>
              </div>
              {v2 && <EpisodeSteps project={project} ep={current.ep} here="蓝图" className="border-b border-line bg-canvas/40 px-5 py-2.5" />}
              <div className="space-y-4 p-5">
                {/* 集号就在卡片标题里，不再单列一个不能改的输入框 */}
                <Field label="本集标题">
                  <Input value={current.title} onChange={(e) => update(current.ep, { title: e.target.value })} placeholder="本集标题" />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="本集定位" hint="按节奏框架预填，可改">
                    <Select value={current.position} onChange={(e) => update(current.ep, { position: e.target.value })}>
                      {positions.map((p) => (
                        <option key={p}>{p}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="出场关键人（逗号分隔）" hint="AI 审稿会检查这些人物是否出场">
                    <Input value={current.cast} onChange={(e) => update(current.ep, { cast: e.target.value })} placeholder="主角、反派、关键配角" />
                  </Field>
                </div>
                <Field label="主角小目标（本集最想解决的事）">
                  <Input value={current.goal} onChange={(e) => update(current.ep, { goal: e.target.value })} placeholder="这一集主角最想做成的一件事" />
                </Field>
                <Field label="实质冲突与转折">
                  <AutoTextarea minRows={3} value={current.conflict} onChange={(e) => update(current.ep, { conflict: e.target.value })} placeholder="谁阻碍主角、怎么升级、在哪里反转" />
                </Field>
                <Field label="承接" hint="本集开头接住什么：上集结尾的钩子，或前几集埋下、本集要响的伏笔；不填时默认接上集结尾的钩子">
                  <AutoTextarea
                    aria-label="承接"
                    minRows={2}
                    value={current.carry ?? ''}
                    onChange={(e) => update(current.ep, { carry: e.target.value })}
                    placeholder={carryDefault ? `默认接上集结尾：${carryDefault}` : current.ep === 1 ? '第 1 集是开篇，没有上集可承接' : '上集结尾留下的悬念、前几集埋下的伏笔'}
                  />
                  {carryForeshadows.length > 0 && (
                    <div data-carry-foreshadows className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="text-ink-400">接住前文埋点：</span>
                      {carryForeshadows.map((f) => {
                        const phrase = carryPhrase(f.item)
                        const base = current.carry?.trim() || carryDefault
                        const added = base.includes(`「${foreshadowName(f.item)}」`)
                        return (
                          <button
                            key={f.item.id}
                            type="button"
                            disabled={added}
                            title={added ? '已写进承接' : `${f.item.content}（第 ${f.item.plantEp} 集埋 · 第 ${f.item.payoffEp} 集收）`}
                            onClick={() => update(current.ep, { carry: [base, phrase].filter(Boolean).join('；') })}
                            className="inline-flex items-center gap-1 rounded-full border border-line bg-white px-2 py-0.5 text-ink-700 transition-colors enabled:hover:border-brand-300 enabled:hover:text-brand-700 disabled:cursor-default disabled:opacity-50"
                          >
                            <Plus size={12} />「{foreshadowName(f.item)}」
                            <span className="text-ink-400">{f.item.payoffEp === current.ep ? '本集回收' : `第 ${f.item.payoffEp} 集收`}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </Field>
                <Field label="末尾悬念钩子">
                  <AutoTextarea minRows={2} value={current.hook} onChange={(e) => update(current.ep, { hook: e.target.value })} placeholder="最后 10 秒留什么让观众点下一集" />
                </Field>

                <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-4">
                  <div className="mb-2 flex flex-wrap items-baseline gap-1">
                    <span className="text-[13px] font-semibold text-brand-700">作者微操指导</span>
                    <span className="text-xs text-ink-500">（写稿时会作为最高优先级注入 AI — 可覆盖蓝图）</span>
                  </div>
                  <AutoTextarea
                    aria-label="作者微操指导"
                    minRows={3}
                    value={current.guidance}
                    onChange={(e) => update(current.ep, { guidance: e.target.value })}
                    placeholder={'我想在这集加入一个意外的背叛…\n让反派在这集露出破绽…\n（不填则完全按蓝图走）'}
                  />
                </div>

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
                    placeholder="定稿后 AI 会自动填充本集要点（事件进展 / 角色变化 / 伏笔埋点），也可以提前手动输入给 AI 作参考"
                    className="font-mono text-[12.5px] leading-6"
                  />
                </div>
              </div>
            </Card>

          </div>
        </div>
      )}

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
