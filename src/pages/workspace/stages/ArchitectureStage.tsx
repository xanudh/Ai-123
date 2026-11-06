import clsx from 'clsx'
import { ArrowRight, Check, ChevronRight, CircleCheck, Eraser, Eye, Info, Pencil, Plus, RotateCcw, Save, Square, Trash2, TriangleAlert, Wand2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ConfirmDialog, Modal, UnsavedChangesPrompt } from '../../../components/overlay'
import { BasisInfo } from '../../../components/project/BasisInfo'
import { GenerateButton, PolishButton } from '../../../components/project/PolishButton'
import { RhythmChart } from '../../../components/project/RhythmChart'
import type { RhythmCompare } from '../../../components/project/RhythmChart'
import { RhythmCurveEditor, RhythmFields } from '../../../components/project/RhythmEditor'
import { AiButton, AutoTextarea, EpisodeInput, InlineInput, ReviewBadge, Table, latestProject, stagePath, useAiTask } from '../../../components/stage/StageKit'
import { Badge, Button, Card, Field, Input, MultiSelect, Segmented, Select } from '../../../components/ui'
import { alignEp, alignRhythm, benchRanges, benchSegment, placeBenchEp } from '../../../domain/align'
import { ARCH_REQUIRED, PRINT_KEY, archBasis, archOrder, basisLine, printOf } from '../../../domain/basis'
import type { BasisRow } from '../../../domain/basis'
import { AUDIENCES, EPISODE_RANGE, EPISODE_SECONDS, GENRE_REGION_LABEL, LANGUAGES, MAX_GENRES, MAX_TONES, genreRegions, styleGroups, themeGroups } from '../../../domain/constants'
import { rhythmFromPhases, rhythmOnResize, sameRhythm, secondsHint, validateRhythm } from '../../../domain/rhythm'
import type { ArchItem, Architecture, PlotBeat, Project, RhythmFrame, ScriptLanguage } from '../../../domain/types'
import { PHASE_LIMIT, benchmarkSpec, defaultPhaseName, emptyArchitecture, phaseRanges, rangeLabel } from '../../../domain/work'
import { formatDateTime } from '../../../lib/format'
import { newId } from '../../../lib/id'
import { directionReference, draftArchItem, generateLoglines, nextSeed, proposeDirections } from '../../../services/ai'
import type { ArchDraft, Direction, LoglineCandidate } from '../../../services/ai'
import { useProjects } from '../../../store/projects'
import { toast } from '../../../store/toast'
import { useStageSlot } from '../../../v2/bottomSlot'

/** 带说明图标的字段名，悬停显示说明 */
function Tip({ label, tip }: { label: string; tip: string }) {
  return (
    <span className="inline-flex items-center gap-1" title={tip}>
      {label}
      <Info size={12} className="text-ink-400" aria-label={tip} />
    </span>
  )
}

/** 数字输入：失焦时收回到 min–max，非法输入还原；optional 时留空记为 0（不设） */
function NumberInput({
  value,
  min,
  max,
  onChange,
  label,
  optional,
}: {
  value: number
  min: number
  max: number
  onChange: (v: number) => void
  label: string
  optional?: boolean
}) {
  const show = (v: number) => (optional && !v ? '' : String(v))
  const [text, setText] = useState(show(value))
  useEffect(() => setText(show(value)), [value])
  const commit = () => {
    const n = Math.round(Number(text))
    const v = text.trim() && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : optional ? 0 : value
    setText(show(v))
    if (v !== value) onChange(v)
  }
  return (
    <Input
      aria-label={label}
      inputMode="numeric"
      placeholder={optional ? '无' : undefined}
      value={text}
      onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className="tabular-nums"
    />
  )
}

/** 可折叠的一段设定：标题行右侧放清除 / AI 生成 */

/** 节奏曲线下方的冲突主线分段：与曲线的集数轴对齐（左 30 / 右 12 与 RhythmChart 的内边距一致） */
function MainLineStrip({ ranges, beats, total, aligned, bench }: { ranges: [number, number][]; beats: PlotBeat[]; total: number; aligned: boolean; bench?: boolean }) {
  const pos = (ep: number) => (total <= 1 ? 0 : Math.min(1, Math.max(0, (ep - 1) / (total - 1))))
  return (
    <div className="mt-3 border-t border-line pt-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-medium text-ink-700">冲突主线设定</span>
        <span className="text-ink-500">{aligned ? (bench ? '节点按对标剧分段对位' : '付费卡点落在每段结尾，大反转在段中') : '节奏已手动调整，与主线分段不完全一致；点「恢复推荐」可重新对齐'}</span>
      </div>
      <div className="relative h-10" style={{ marginLeft: 30, marginRight: 12 }}>
        {ranges.map(([from, to], i) => {
          // 段与段的分界放在两集之间
          const left = i === 0 ? 0 : pos(from - 0.5)
          const right = i === ranges.length - 1 ? 1 : pos(to + 0.5)
          return (
            <div
              key={i}
              title={`${beats[i]?.beat ?? ''} · ${rangeLabel([from, to])}${beats[i]?.content ? `：${beats[i].content}` : ''}`}
              className={clsx('absolute inset-y-0 overflow-hidden rounded-md px-1.5 py-1', i % 2 ? 'bg-brand-100' : 'bg-brand-50')}
              style={{ left: `calc(${left * 100}% + 1px)`, width: `calc(${(right - left) * 100}% - 2px)` }}
            >
              <div className="truncate text-[11px] leading-4 font-medium text-ink-900">{beats[i]?.beat}</div>
              <div className="truncate text-[10px] leading-4 text-ink-500 tabular-nums">{from === to ? from : `${from}–${to}`} 集</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** 对标剧虚线：仿写按分段对位放到我们的集数轴上（对不上的段不画） */
function benchCompare(project: Project): RhythmCompare | undefined {
  const bd = project.work.breakdown?.episodes.length ? project.work.breakdown : null
  if (!bd) return undefined
  const total = project.spec.totalEpisodes
  return {
    emotion: bd.episodes.map((e) => e.emotion),
    paywalls: bd.episodes.filter((e) => e.paywall).map((e) => e.ep),
    place: bd.episodes.map((e) => placeBenchEp(project, e.ep, total)),
    aligned: Array.from({ length: total }, (_, i) => alignEp(project, i + 1)),
  }
}

/**
 * 节奏框架：放在冲突主线表格下面。付费卡点集（第一个即首付费）、大反转集、结局高潮起始集三项常显，直接改集数（11/5）；
 * 曲线默认收起（目标情绪打分还没有合适的依据，曲线只是示意，以分段和卡点为准）。
 * 跟冲突主线绑定，先定主线再生成；仿写按对标剧的节奏分段换算；生成后可本地微调，保存后写回项目。
 */
function RhythmBlock({
  project,
  ranges,
  beats,
  locked,
  row,
  generated,
  fresh,
  onGenerated,
}: {
  project: Project
  ranges: [number, number][]
  beats: PlotBeat[]
  locked: boolean
  row: BasisRow | null
  /** 按冲突主线生成过（没生成过就是立项时的默认节奏） */
  generated: boolean
  /** 逐项生成刚生成到这里 */
  fresh: boolean
  onGenerated: (rhythm: RhythmFrame) => void
}) {
  const updateProject = useProjects((s) => s.updateProject)
  const total = project.spec.totalEpisodes
  const [rhythm, setRhythm] = useState(project.rhythm)
  const [open, setOpen] = useState(false)
  const bench = project.mode !== 'original' && project.work.breakdown ? alignRhythm(project) : null
  const recommended = bench?.paywalls.length ? bench : rhythmFromPhases(ranges, total)
  const ready = beats.every((b) => b.content.trim())
  const dirty = !sameRhythm(rhythm, project.rhythm)
  const invalid = validateRhythm(rhythm, total).some((i) => i.level === 'error')
  const compare = benchCompare(project)
  const how = bench?.paywalls.length ? '按对标剧的节奏分段对位换算：对标剧每个节点先找它在哪一段，再落到我们对应那段的同一位置' : '按冲突主线分段生成：每段结尾设付费卡点，段中设大反转，最后一段为结局高潮区'

  useEffect(() => setRhythm(project.rhythm), [project.rhythm])

  const save = () => {
    updateProject(project.id, { rhythm }, `调整节奏框架：首付费第 ${rhythm.paywalls[0]} 集`)
    toast('节奏框架已保存')
  }

  const generate = () => {
    setRhythm(recommended)
    updateProject(project.id, { rhythm: recommended }, `按冲突主线生成节奏框架：首付费第 ${recommended.paywalls[0] ?? '—'} 集`)
    onGenerated(recommended)
    toast(`${bench?.paywalls.length ? '节奏框架已按对标剧分段换算' : '节奏框架已按冲突主线生成'}，可直接改下面的集数`)
  }
  const strip = <MainLineStrip ranges={ranges} beats={beats} total={total} aligned={sameRhythm(rhythm, recommended)} bench={!!bench?.paywalls.length} />

  return (
    <div data-rhythm className={clsx('mt-4 rounded-lg border transition-shadow', fresh ? 'border-brand-300 ring-3 ring-brand-500/10' : 'border-line')}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-4 pt-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1 text-[13px] font-semibold text-ink-900">
            节奏框架
            {row && <BasisInfo title="节奏框架" row={row} />}
          </div>
          <p className="mt-0.5 text-xs leading-5 text-ink-500">
            {generated ? `${how}；情节大纲与写作都以这张表为准` : locked ? '沿用立项时的默认节奏，没有按冲突主线生成过' : '先定冲突主线，再点「生成节奏框架」；下面是立项时的默认节奏，也可以直接改'}
          </p>
        </div>
        {!locked && (
          <div className="flex shrink-0 gap-2">
            {dirty && (
              <>
                <Button variant="ghost" size="sm" onClick={() => setRhythm(project.rhythm)}>
                  放弃修改
                </Button>
                <Button size="sm" onClick={save} disabled={invalid}>
                  <Save size={14} />
                  保存节奏
                </Button>
              </>
            )}
            <Button variant={ready && !generated ? 'secondary' : 'ghost'} size="sm" disabled={!ready} title={ready ? (row ? `生成逻辑：${basisLine(row)}` : undefined) : '先填完冲突主线各段的剧情'} onClick={generate}>
              <Wand2 size={14} />
              生成节奏框架
            </Button>
          </div>
        )}
      </div>
      <div className="px-4 pt-3 pb-4">
        <RhythmFields rhythm={locked ? project.rhythm : rhythm} total={total} onChange={setRhythm} disabled={locked} />
      </div>
      <div className="border-t border-line">
        <button
          type="button"
          data-rhythm-toggle
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex w-full items-center gap-1 px-4 py-2.5 text-left text-[13px] font-medium text-ink-700 hover:text-brand-700"
          title={open ? '收起节奏曲线' : '展开节奏曲线：目标情绪曲线，也可以在曲线上点选付费卡点和大反转'}
        >
          <ChevronRight size={14} className={clsx('text-ink-400 transition-transform', open && 'rotate-90')} />
          节奏曲线
          {!open && <span className="ml-1 text-xs font-normal text-ink-400">已收起，点开看曲线、在曲线上点选卡点</span>}
        </button>
        {open && (
          <div className="px-4 pb-4">
            <p className="mb-3 flex items-start gap-1.5 text-xs leading-5 text-ink-500">
              <Info size={13} className="mt-[3px] shrink-0 text-ink-400" />
              曲线上的目标情绪强度只是示意：现在还没有合适的打分依据，以冲突主线的分段和付费卡点、大反转、结局高潮这几个节点为准
            </p>
            {locked ? (
              <>
                <RhythmChart rhythm={project.rhythm} total={total} compare={compare} />
                {strip}
              </>
            ) : (
              <RhythmCurveEditor rhythm={rhythm} total={total} onChange={setRhythm} recommended={recommended} chartFooter={strip} compare={compare} />
            )}
          </div>
        )}
      </div>
      <UnsavedChangesPrompt dirty={dirty} desc="节奏框架有未保存的修改，离开后将丢失。" />
    </div>
  )
}


function PlanLines({ text }: { text: string }) {
  return (
    <dl className="space-y-0.5">
      {text
        .split('\n')
        .filter((l) => l.trim())
        .map((line, i) => {
          const [k, ...rest] = line.split('：')
          return rest.length ? (
            <div key={i}>
              <dt className="inline font-medium text-ink-700">{k}：</dt>
              <dd className="inline">{rest.join('：')}</dd>
            </div>
          ) : (
            <div key={i}>{line}</div>
          )
        })}
    </dl>
  )
}

/** AI 框架方向：3 个方向在弹窗里并排对比，选一个确定后再录入；每个方向写全核心设定、世界观、金手指、故事背景，主角人设往后按顺序往下推 */
function DirectionDialog({
  directions,
  adaptation,
  overwrite,
  refreshing,
  onRefresh,
  onPick,
  onClose,
}: {
  directions: Direction[]
  /** 仿写在主角人设后面还有创新点 */
  adaptation: boolean
  overwrite: boolean
  refreshing: boolean
  onRefresh: () => void
  onPick: (d: Direction) => void
  onClose: () => void
}) {
  const [picked, setPicked] = useState<string | null>(null)
  const chosen = directions.find((d) => d.id === picked)
  const h = 'mb-1 text-[11px] font-semibold tracking-wide text-ink-400'
  const what = '核心设定、世界观、金手指、故事背景'

  return (
    <Modal
      open
      onClose={onClose}
      width={1080}
      title="AI 框架方向"
      desc={`3 个方向对比${what}，选一个后点「确定录入」；主角人设${adaptation ? '、创新点' : ''}、冲突主线在下面按顺序往下推`}
      footer={
        <>
          <span className="mr-auto self-center text-xs text-ink-500">{overwrite ? `录入后会覆盖当前的${what}` : `录入后可继续逐项修改`}</span>
          <AiButton variant="ghost" size="md" loading={refreshing} onClick={onRefresh}>
            换一批
          </AiButton>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button disabled={!chosen || refreshing} onClick={() => chosen && onPick(chosen)}>
            <Check size={15} />
            确定录入
          </Button>
        </>
      }
    >
      <div role="radiogroup" aria-label="AI 方向" className={clsx('grid max-h-[66vh] gap-3 overflow-y-auto pb-1 lg:grid-cols-3', refreshing && 'opacity-50')}>
        {directions.map((d) => {
          const on = d.id === picked
          return (
            <label
              key={d.id}
              className={clsx(
                'flex cursor-pointer flex-col gap-3 rounded-xl border p-4 text-xs leading-5 text-ink-500 transition-colors',
                on ? 'border-brand-500 bg-brand-50/40 ring-2 ring-brand-100' : 'border-line hover:border-brand-200',
              )}
            >
              <input type="radio" name="direction" className="sr-only" checked={on} onChange={() => setPicked(d.id)} />
              <div className="flex items-start gap-2">
                <span className={clsx('mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border', on ? 'border-brand-600 bg-brand-600' : 'border-ink-300 bg-white')}>
                  {on && <span className="size-1.5 rounded-full bg-white" />}
                </span>
                <div className="min-w-0">
                  <Badge tone="violet">{d.title}</Badge>
                  <p className="mt-1.5 text-[13px] leading-5 text-ink-700">{d.pitch}</p>
                </div>
              </div>
              <section data-dir-part="logline">
                <div className={h}>核心设定</div>
                <p className="text-[13px] leading-6 font-medium text-ink-900">{d.logline}</p>
              </section>
              {(
                [
                  ['world', '世界观', d.world],
                  ['goldenFinger', '金手指', d.goldenFinger],
                  ['background', '故事背景', d.background],
                ] as const
              ).map(([key, label, text]) => (
                <section key={key} data-dir-part={key}>
                  <div className={h}>{label}</div>
                  <PlanLines text={text} />
                </section>
              ))}
            </label>
          )
        })}
      </div>
    </Modal>
  )
}

type TextItem = 'goldenFinger' | 'heroSetup' | 'world' | 'background' | 'highlights' | 'writingRules'

const ITEM_TITLE: Record<ArchItem, string> = {
  logline: '核心设定',
  plan: '整体框架',
  innovations: '创新点',
  goldenFinger: '金手指 / 核心卖点',
  heroSetup: '主角人设',
  world: '世界观设定',
  background: '故事背景',
  highlights: '核心亮点',
  factions: '主要势力',
  formula: '爽点公式',
  mainLine: '冲突主线',
  rhythm: '节奏框架',
  writingRules: '全局写作要求',
  references: '参考作品',
}

const PLACEHOLDER: Partial<Record<TextItem, string>> = {
  goldenFinger: '金手指：名字\n首次出现：第几集（什么事）。\n核心能力：· 能力名：来历，能做到什么。这是其物理 / 社会层面的硬金手指。\n表现方式：· 首集展示 · 渐进释放：A → B → C · 权威认证\n与主线强相关：前期被隐藏导致被羞辱，后期逐步释放成为打脸武器',
  heroSetup: '可以一句话，也可以按人物卡写全：\n主角：\n性别：\n年龄：\n外貌：\n性格：\n背景：\n能力：\n动机：\n弧光：\n备注：\n关系备注：',
  world: '世界总览：整个故事设定的世界是什么样的、有什么规则\n阵营设定：· 阵营名（狼人 / 吸血鬼 / 异能者……）：设定、谁在里面\n主要地点：· 地名：是什么地方、谁的地盘、在这里发生什么（教会、领地、北境这类私设要写细）',
  background: '一段话讲完整个故事：主角是谁、处境如何 → 谁为了什么、用什么手段步步紧逼 → 转机 → 反派变本加厉 → 高潮 → 结局，主角的身份怎么变',
  highlights: '期待值：\n· 核心爽点：你以为……其实……\n· 观众等着看：哪几场（真相揭开、身份翻转、反派报应）\n· 情感期待：感情线上观众在等什么\n情绪：\n· 主打情绪：爽 / 虐 / 甜 / 紧张……\n· 情绪走向：先压到哪 → 第一次爽在哪 → 怎么反转 → 结局',
  writingRules: '每集写作都会带上的要求：篇幅、钩子、台词风格、视角、禁止项……',
}

const HINT: Partial<Record<ArchItem, string>> = {
  world: '总分写：先总说整个世界，再分写各阵营的设定（狼人、吸血鬼、克苏鲁规则怪谈、异能……），最后写细主要发生地点——教会、领地、北境这类专有名词都是私设',
  goldenFinger: '最重要的是讲清能力是什么：可以命名，每项能力写来历、能做到什么、是哪个层面的硬金手指；然后是首次出现、表现方式、与主线强相关',
  background: '写成故事简介：一段话从主角的处境讲到结局，谁为了什么、用什么手段逼主角，转机在哪，主角最后从什么变成什么',
  highlights: '参考故事的期待值和情绪：期待值是观众为什么追下去（核心爽点、等着看哪几场、情感期待），情绪是主打什么情绪、一路怎么起伏',
  heroSetup: '写成人物卡的，人物设定 AI 生成时按卡拆到人物小传',
}

interface Pending {
  title: string
  desc: string
  confirmText: string
  danger?: boolean
  action: () => void
}

export default function ArchitectureStage({ project, blocked }: { project: Project; blocked: boolean }) {
  const { patchWork, updateProject } = useProjects()
  const { running, run, cancel } = useAiTask()
  const [directions, setDirections] = useState<Direction[] | null>(null)
  const [loglines, setLoglines] = useState<LoglineCandidate[]>([])
  // 换一批时仍以编剧自己写的核心设定为种子，不在候选上层层叠加
  const loglineSeed = useRef('')
  // AI 生成的结果先放这里，采用时连同标记、依据指纹一起存
  const drafts = useRef<Partial<Record<ArchItem, ArchDraft>>>({})
  const [issues, setIssues] = useState<string[]>([])
  const [pending, setPending] = useState<Pending | null>(null)
  // 逐项生成：刚生成的那一项，停在这里等编剧看过再继续
  const [justMade, setJustMade] = useState<ArchItem | null>(null)
  // 状态条放进页面底部的环节条
  const slot = useStageSlot()

  const total = project.spec.totalEpisodes
  const arch = project.work.architecture ?? emptyArchitecture(total)
  const count = arch.mainLine.length
  const ranges = phaseRanges(total, arch.phaseEnds, count)
  const bd = project.work.breakdown
  const adaptation = project.mode !== 'original'
  const approved = arch.status === 'approved'
  const titleOf = (item: ArchItem) => ITEM_TITLE[item]
  // 仿写冲突主线：先看对标剧拆解出来的，再到「修改冲突主线」里定我们的
  const [lineTab, setLineTab] = useState<'ours' | 'bench'>('bench')
  const reference = directionReference(project)
  // 页面从上往下的顺序就是生成顺序：每一项只读排在它前面的项
  const order = archOrder(project)

  const save = (patch: Partial<Architecture>, note?: string) => {
    const cur = latestProject(project.id)
    if (!cur) return
    const base = cur.work.architecture ?? emptyArchitecture(cur.spec.totalEpisodes)
    patchWork(cur.id, { architecture: { ...base, ...patch } }, note)
  }

  /** 采用 AI 生成的一项：内容、每行的来源标记、当时的依据指纹一起存 */
  const applyDraft = (item: ArchItem, d: ArchDraft, note: string) => {
    const cur = latestProject(project.id)
    if (!cur) return
    const base = cur.work.architecture ?? emptyArchitecture(cur.spec.totalEpisodes)
    const row = archBasis(cur, item)
    const patch: Partial<Architecture> =
      item === 'innovations' ? { innovations: d.innovations ?? [] } : item === 'mainLine' ? { mainLine: d.mainLine ?? base.mainLine } : item === 'logline' || item === 'rhythm' ? {} : { [item]: d.text }
    const prints = row ? { ...cur.work.prints, [PRINT_KEY.arch(item)]: printOf(cur, row.deps) } : cur.work.prints
    patchWork(cur.id, { architecture: { ...base, ...patch, marks: { ...base.marks, [item]: d.marks } }, prints }, note)
    if (item === 'logline') updateProject(cur.id, { logline: d.text })
    if (item === 'rhythm' && d.rhythm) updateProject(cur.id, { rhythm: d.rhythm })
  }

  /** 记下某一项此刻的依据（忽略「依据已改」、手动生成节奏时用） */
  const stamp = (item: ArchItem) => {
    const cur = latestProject(project.id)
    const row = cur && archBasis(cur, item)
    if (cur && row) patchWork(cur.id, { prints: { ...cur.work.prints, [PRINT_KEY.arch(item)]: printOf(cur, row.deps) } })
  }

  const setSpec = (patch: Partial<Project['spec']>, note: string) => {
    const cur = latestProject(project.id)
    if (!cur) return
    const spec = { ...cur.spec, ...patch }
    updateProject(cur.id, { spec, rhythm: rhythmOnResize(cur, spec.totalEpisodes) }, note)
  }

  // 「完全按对标剧」：集数与单集时长跟着对标剧走，拆解 / 转写出结果后自动同步
  const follow = adaptation && !!project.spec.followBenchmark
  const bench = benchmarkSpec(project)
  const benchPatch = {
    ...(bench.episodes && bench.episodes !== total ? { totalEpisodes: bench.episodes } : {}),
    ...(bench.seconds && bench.seconds !== project.spec.episodeSeconds ? { episodeSeconds: bench.seconds } : {}),
  }
  const benchKey = JSON.stringify(benchPatch)
  useEffect(() => {
    if (follow && benchKey !== '{}') setSpec(JSON.parse(benchKey), '按对标剧同步集数与单集时长')
  }, [follow, benchKey])

  const propose = async () => {
    const cur = latestProject(project.id)
    if (!cur) return
    const result = await run('directions', (signal) => proposeDirections(cur, nextSeed(), signal))
    if (result) setDirections(result)
  }

  /** 方向里的世界观、金手指、故事背景一起录入；依据指纹按录入后的样子记，之后核心设定再改会标「依据已改」 */
  const pickDirection = (d: Direction) => {
    save({ world: d.world, goldenFinger: d.goldenFinger, background: d.background }, `采用 AI 方向：${d.title}`)
    updateProject(project.id, { logline: d.logline })
    for (const item of ['world', 'goldenFinger', 'background'] as const) stamp(item)
    setDirections(null)
    setIssues([])
    toast(`已录入「${d.title}」：核心设定、世界观、金手指、故事背景都已更新`)
  }

  /** 这一项有没有内容 */
  const filledOf = (p: Project, item: ArchItem) => {
    const a = p.work.architecture ?? emptyArchitecture(p.spec.totalEpisodes)
    if (item === 'logline') return !!p.logline.trim()
    if (item === 'innovations') return a.innovations.some((x) => x.ours.trim())
    if (item === 'mainLine') return a.mainLine.every((b) => b.content.trim())
    if (item === 'rhythm') return !!p.work.prints?.[PRINT_KEY.arch('rhythm')]
    return !!(a[item] as string).trim()
  }

  /** 逐项生成会生成的项：原创的核心设定由编剧写；节奏框架放在冲突主线下面，排在它后面 */
  const autoItems = order.filter((i) => !(i === 'logline' && !adaptation)).flatMap((i): ArchItem[] => (i === 'mainLine' ? ['mainLine', 'rhythm'] : [i]))
  /** 下一个空着的项；节奏框架要等冲突主线填完 */
  const nextOf = (p: Project) => autoItems.find((i) => !filledOf(p, i) && !(i === 'rhythm' && !filledOf(p, 'mainLine')))
  const nextEmpty = nextOf(project)

  /** 逐项生成到冲突主线时只补空着的段：编剧写了剧情的段不覆盖（比如后来新加了一段） */
  const keepOwnBeats = (p: Project, d: ArchDraft): ArchDraft => {
    const own = (p.work.architecture ?? emptyArchitecture(p.spec.totalEpisodes)).mainLine
    if (!d.mainLine || !own.some((b) => b.content.trim())) return d
    const kept = (i: number) => !!own[i]?.content.trim()
    return { ...d, mainLine: d.mainLine.map((b, i) => (kept(i) ? { ...b, content: own[i].content } : b)), marks: d.marks.filter((_, i) => !kept(i)) }
  }

  /** 冲突主线生成后顺带按分段生成节奏框架；已经生成过的不动（可能手动调过），冲突主线变了会标「依据已改」 */
  const followRhythm = async (signal: AbortSignal) => {
    const p = latestProject(project.id)
    if (!p || filledOf(p, 'rhythm') || !filledOf(p, 'mainLine')) return false
    const d = await draftArchItem(p, 'rhythm', nextSeed(), signal)
    applyDraft('rhythm', d, `按冲突主线生成节奏框架：首付费第 ${d.rhythm?.paywalls[0] ?? '—'} 集`)
    return true
  }

  /** 逐项生成：每次只生成下一个空着的项，生成完停下来等编剧看；读编剧写的和排在它前面的项，已有内容不覆盖 */
  const generateNext = async () => {
    const cur = latestProject(project.id)
    if (!cur) return
    if (!adaptation && !cur.logline.trim()) return toast('先写核心设定（或点「填入立项灵感」），后面每一项都从它推出来', 'error')
    const item = nextOf(cur)
    if (!item) return
    const r = await run('fill', async (signal) => {
      const d = await draftArchItem(cur, item, nextSeed(), signal)
      applyDraft(item, item === 'mainLine' ? keepOwnBeats(cur, d) : d, `AI 生成${titleOf(item)}`)
      return { rhythm: item === 'mainLine' && (await followRhythm(signal)) }
    })
    if (!r) return
    setJustMade(item)
    const after = latestProject(project.id)
    const next = after && nextOf(after)
    toast(next ? `已生成「${titleOf(item)}」${r.rhythm ? '和节奏框架' : ''}；看过、改好再继续生成下一项「${titleOf(next)}」` : `已生成「${titleOf(item)}」，各项都有内容了；看过各项的「补充」再确认故事架构`)
    requestAnimationFrame(() => document.querySelector(`[data-node=${item === 'rhythm' ? 'mainLine' : item}]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  /** 确认前要补齐的：各项里只有核心设定必填（11/4 标注），其余都可以空着 */
  const missing = (): string[] => [
    ...(adaptation || project.genres.length ? [] : ['题材类型未选']),
    ...(project.audience ? [] : ['目标受众未选']),
    ...order.filter((item) => ARCH_REQUIRED.includes(item) && !filledOf(project, item)).map((item) => `${titleOf(item)}未填写`),
  ]

  const confirm = () => {
    const found = missing()
    setIssues(found)
    if (found.length) return toast('还有未完成的项', 'error')
    save({ status: 'approved', mainLine: arch.mainLine.map((b, i) => ({ ...b, range: rangeLabel(ranges[i]) })) }, '确认故事架构')
    setJustMade(null)
    toast('故事架构已确认，可以开始人物设定')
  }

  const reopen = () => {
    save({ status: 'pending' }, '修改故事架构')
    toast('可以改了；改完重新确认。下游已生成的内容会标「依据已改」，不会自动重写')
  }

  const proposeLoglines = async () => {
    const cur = latestProject(project.id) ?? project
    if (!loglines.some((c) => c.logline === cur.logline)) loglineSeed.current = cur.logline
    const list = await run('loglines', (signal) => generateLoglines({ idea: loglineSeed.current, genres: cur.genres, audience: cur.audience, tones: cur.tones }, signal))
    if (list) setLoglines(list)
  }
  // 确认前就实时列出还差什么
  const live = !approved && !blocked ? missing() : null

  const setBeat = (i: number, patch: Partial<PlotBeat>) => save({ mainLine: arch.mainLine.map((b, j) => (j === i ? { ...b, ...patch } : b)) })
  const setInnovation = (id: string, patch: { theirs?: string; ours?: string }) => save({ innovations: arch.innovations.map((x) => (x.id === id ? { ...x, ...patch } : x)) })

  /** 调整第 i 段的结束集：后面的段顺延，每段至少 1 集，最后一段收在总集数 */
  const setPhaseEnd = (i: number, v: number) => {
    const ends = ranges.map(([, to]) => to)
    ends[i] = Math.max(ranges[i][0], Math.min(v, total - (ends.length - 1 - i)))
    for (let j = i + 1; j < ends.length; j++) ends[j] = Math.max(ends[j], ends[j - 1] + 1)
    ends[ends.length - 1] = total
    const next = phaseRanges(total, ends, count)
    save({ phaseEnds: ends, mainLine: arch.mainLine.map((b, k) => ({ ...b, range: rangeLabel(next[k]) })) }, `冲突主线「${arch.mainLine[i].beat}」调整为${rangeLabel(next[i])}`)
  }

  const resetPhases = () => {
    const next = phaseRanges(total, null, count)
    save({ phaseEnds: null, mainLine: arch.mainLine.map((b, k) => ({ ...b, range: rangeLabel(next[k]) })) }, '冲突主线恢复默认分段')
  }

  /** 增删一段后的分段：ends 为各段结束集；情节大纲的阶段总览随段落一起增删 */
  const reshape = (mainLine: PlotBeat[], ends: number[], plotPhases: (phases: string[]) => string[], note: string) => {
    const cur = latestProject(project.id)
    if (!cur) return
    const next = phaseRanges(total, ends, mainLine.length)
    const base = cur.work.architecture ?? emptyArchitecture(total)
    const plot = cur.work.plot && { ...cur.work.plot, phases: plotPhases(ranges.map((_, k) => cur.work.plot?.phases[k] ?? '')) }
    patchWork(cur.id, { architecture: { ...base, phaseEnds: ends, mainLine: mainLine.map((b, k) => ({ ...b, range: rangeLabel(next[k]) })) }, plot }, note)
  }

  /** 在第 i 段后面插入一段：把第 i 段对半拆开；仿写新加的段默认不对位 */
  const addPhase = (i: number) => {
    const [from, to] = ranges[i]
    if (to <= from) return toast(`「${arch.mainLine[i].beat}」只有 1 集，拆不出新的一段`, 'error')
    const ends = ranges.map(([, e]) => e)
    ends.splice(i, 0, from + Math.floor((to - from - 1) / 2))
    const beat = defaultPhaseName(count)
    // 已有的段先把对位写死，免得插入后默认对位整体错开
    const fixed = arch.mainLine.map((b, k) => (adaptation && bd ? { ...b, bench: benchSegment(project, k) } : b))
    const mainLine = [...fixed.slice(0, i + 1), { beat, range: '', content: '', ...(adaptation && bd ? { bench: -1 } : {}) }, ...fixed.slice(i + 1)]
    reshape(mainLine, ends, (ph) => [...ph.slice(0, i + 1), '', ...ph.slice(i + 1)], `冲突主线新增一段「${beat}」`)
  }

  /** 删掉第 i 段：集数并入前一段（删第一段时并入后一段） */
  const removePhase = (i: number) => {
    const ends = ranges.map(([, e]) => e)
    ends.splice(Math.max(0, i - 1), 1)
    const fixed = arch.mainLine.map((b, k) => (adaptation && bd ? { ...b, bench: benchSegment(project, k) } : b))
    const mainLine = fixed.filter((_, k) => k !== i)
    reshape(mainLine, ends, (ph) => ph.filter((_, k) => k !== i), `冲突主线删除「${arch.mainLine[i].beat}」`)
  }

  /** 已有内容时先确认再覆盖 */
  const guard = (filled: boolean, next: Pending) => (filled ? setPending(next) : next.action())

  /* ------------------------------ 每一项的标题行 ------------------------------ */

  /** 标题 + ⓘ 依据 + 说明 + 右侧按钮；序号在左侧的节点上（11/4 起不再显示「依据说明」「依据已改」这两行） */
  const head = (item: ArchItem, actions?: ReactNode, opts: { hint?: ReactNode } = {}) => {
    const row = archBasis(project, item)
    const hint = opts.hint ?? HINT[item]
    return (
      <>
        <div className="mb-2 flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <div className="min-w-0">
            <h4 data-item-title className="flex flex-wrap items-center gap-1 text-[15px] leading-7 font-semibold text-ink-900">
              {titleOf(item)}
              {ARCH_REQUIRED.includes(item) && <span className="text-red-500">*</span>}
              {row && <BasisInfo title={titleOf(item)} row={row} />}
            </h4>
            {hint && <p className="text-xs leading-5 text-ink-500">{hint}</p>}
          </div>
          {actions && !approved && <div className="flex shrink-0 items-center gap-1 pt-0.5">{actions}</div>}
        </div>
      </>
    )
  }

  /** 单项的「AI 生成」：空着直接填，有内容先对比；采用时连同标记和依据指纹一起存 */
  const generateButton = (item: ArchItem) => {
    const row = archBasis(project, item)
    const value = item === 'logline' ? project.logline : (arch[item as TextItem] ?? '')
    return (
      <GenerateButton
        value={value}
        label={titleOf(item)}
        basis={row ? basisLine(row) : '编剧写的内容'}
        disabled={blocked || !!running}
        generate={async (signal) => {
          const d = await draftArchItem(latestProject(project.id) ?? project, item, nextSeed(), signal)
          drafts.current[item] = d
          return d.text
        }}
        onApply={(text) => {
          const d = drafts.current[item]
          if (d && d.text === text) applyDraft(item, d, `AI 生成${titleOf(item)}`)
          else if (item === 'logline') updateProject(project.id, { logline: text })
          else save({ [item]: text })
        }}
      />
    )
  }

  /** 纯文本的一项：AI 生成 → AI 润色 → 清除 */
  const textItem = (item: TextItem, minRows = 4) => {
    const value = arch[item]
    const locked = approved
    const split = item === 'heroSetup' && arch.heroSplitAt
    const actions = (
      <>
        {!split && generateButton(item)}
        {!split && <PolishButton value={value} label={titleOf(item)} disabled={blocked} onApply={(text) => save({ [item]: text }, `AI 润色${titleOf(item)}`)} />}
        {!split && (
          <Button
            variant="ghost"
            size="sm"
            disabled={!value.trim()}
            aria-label={`清除${titleOf(item)}`}
            title={`清除${titleOf(item)}`}
            onClick={() => setPending({ title: `清除${titleOf(item)}？`, desc: '这一项的内容会被清空。', confirmText: '清除', danger: true, action: () => save({ [item]: '' }, `清除${titleOf(item)}`) })}
          >
            <Eraser size={14} />
          </Button>
        )}
      </>
    )
    return (
      <div data-item={item} key={item}>
        {head(item, actions)}
        {split ? (
          <div data-hero-split className="rounded-lg border border-line bg-canvas/50 px-3.5 py-2.5">
            <p className="text-[13px] leading-6 whitespace-pre-wrap text-ink-700">{value}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-line pt-2 text-xs text-ink-500">
              <span>已于 {formatDateTime(arch.heroSplitAt!)} 拆到人物设定，主角以人物设定为准</span>
              <Link to={stagePath(project, 'characters')} className="font-medium text-brand-600 hover:text-brand-700">
                去人物设定修改 →
              </Link>
              {!locked && (
                <button
                  type="button"
                  className="text-ink-500 hover:text-ink-900"
                  onClick={() =>
                    setPending({
                      title: '仍在这里改主角人设？',
                      desc: '人物设定里主角的小传不会跟着变；下次人物设定 AI 生成时才会按新的人物卡补空着的项。',
                      confirmText: '在这里改',
                      action: () => save({ heroSplitAt: undefined }, '主角人设改回在故事架构里改'),
                    })
                  }
                >
                  仍在这里改
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            <AutoTextarea aria-label={titleOf(item)} minRows={minRows} value={value} disabled={locked} onChange={(e) => save({ [item]: e.target.value })} placeholder={PLACEHOLDER[item]} />
          </>
        )}
      </div>
    )
  }

  /* ---------------------------------- 各项 ---------------------------------- */

  const directionButtons = !approved && (
    <>
      <div className="flex flex-wrap gap-2">
        <AiButton variant="secondary" loading={running === 'directions' && !directions} disabled={blocked || !!running} onClick={propose}>
          AI 框架方向
        </AiButton>
      </div>
      {reference && (
        <p data-arch-reference className="-mt-2 flex items-start gap-1.5 text-xs leading-5 text-ink-500">
          <Info size={13} className="mt-[3px] shrink-0 text-ink-400" />
          AI 出方向时会带上对标剧拆解的全部结果：{reference.used.join('、')}；不带：{reference.skipped.join('、')}
        </p>
      )}
    </>
  )

  const loglineItem = (
    <div data-item="logline" key="logline">
      {head(
        'logline',
        <>
          {!project.logline.trim() && project.idea.trim() && (
            <button className="px-1 text-xs text-ink-500 hover:text-brand-600" onClick={() => updateProject(project.id, { logline: project.idea })}>
              填入立项灵感
            </button>
          )}
          {adaptation ? (
            generateButton('logline')
          ) : (
            <AiButton
              variant="ghost"
              loading={running === 'loglines'}
              disabled={blocked || !!running || (!project.logline.trim() && !project.genres.length)}
              onClick={proposeLoglines}
              title={project.logline.trim() || project.genres.length ? `生成逻辑：${basisLine(archBasis(project, 'logline')!)}；给 3 个候选` : '先写几个字，或在基本信息里选题材类型'}
              data-generate="核心设定"
            >
              {loglines.length ? '换一批' : 'AI 生成'}
            </AiButton>
          )}
          <PolishButton value={project.logline} label="核心设定" onApply={(text) => updateProject(project.id, { logline: text }, 'AI 润色核心设定')} />
        </>,
        { hint: `一句话、一段话都可以：至少讲清主角是谁、核心困境、反常规点${adaptation ? '，在对标剧上改了什么' : ''}；后面每一项都从这里取材，没有想法就点下面的「AI 框架方向」` },
      )}
      <AutoTextarea
        aria-label="核心设定"
        minRows={3}
        value={project.logline}
        disabled={approved}
        onChange={(e) => updateProject(project.id, { logline: e.target.value })}
        placeholder="如：被丈夫和闺蜜联手害死的女主重生回到婚礼前夜，这一次她要亲手把婚礼变成他们的审判庭"
      />
      {!approved && !adaptation && loglines.length > 0 && (
        <ul data-logline-ideas className="mt-2 space-y-2">
          {loglines.map((c) => {
            const selected = project.logline === c.logline
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => updateProject(project.id, { logline: c.logline }, 'AI 生成核心设定：选用候选')}
                  className={clsx(
                    'flex w-full items-start gap-3 rounded-lg border bg-white px-3.5 py-2.5 text-left transition-colors',
                    selected ? 'border-brand-500 ring-3 ring-brand-500/10' : 'border-line hover:border-brand-200',
                  )}
                >
                  <span className={clsx('mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border', selected ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-300')}>
                    {selected && <Check size={11} strokeWidth={3} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] leading-relaxed text-ink-900">{c.logline}</span>
                  </span>
                </button>
              </li>
            )
          })}
          <li>
            <button className="text-xs text-ink-500 hover:text-ink-900" onClick={() => setLoglines([])}>
              收起候选
            </button>
          </li>
        </ul>
      )}
    </div>
  )

  // 创新点只有仿写有（11/4 第五轮：原创不要，原创没有它的依据，也不渲染）：设定写完后和对标剧比，对标剧怎么做 → 我们怎么做
  const hasInnovations = arch.innovations.length > 0
  const innovationsItem = adaptation && (
    <div data-item="innovations" key="innovations">
      {head(
        'innovations',
        <AiButton
          variant="ghost"
          loading={running === 'innovations'}
          disabled={blocked || !!running}
          data-generate="创新点"
          title={`生成逻辑：${basisLine(archBasis(project, 'innovations')!)}`}
          onClick={() =>
            guard(hasInnovations, {
              title: '重新生成创新点？',
              desc: '现在的创新点会被新结果覆盖。',
              confirmText: '重新生成',
              action: async () => {
                const d = await run('innovations', (signal) => draftArchItem(latestProject(project.id) ?? project, 'innovations', nextSeed(), signal))
                if (d) applyDraft('innovations', d, 'AI 生成创新点')
              },
            })
          }
        >
          AI 生成
        </AiButton>,
        { hint: `设定写完后和对标剧比：对标剧怎么做 → 我们怎么做，一般 3 条以上 · 共 ${arch.innovations.length} 条` },
      )}
      <ul className="divide-y divide-line rounded-lg border border-line">
        {arch.innovations.map((x) => (
          <li key={x.id} className="flex items-start gap-1 px-2 py-1.5">
            <AutoTextarea inline aria-label="对标剧怎么做" value={x.theirs} disabled={approved} onChange={(e) => setInnovation(x.id, { theirs: e.target.value })} placeholder="对标剧怎么做" className="flex-1 text-ink-500" />
            <ArrowRight size={14} className="mt-2.5 shrink-0 text-brand-400" />
            <AutoTextarea inline aria-label="我们怎么做" value={x.ours} disabled={approved} onChange={(e) => setInnovation(x.id, { ours: e.target.value })} placeholder="我们怎么做" className="flex-1" />
            {!approved && (
              <button className="mt-1 rounded p-1 text-ink-300 hover:bg-red-50 hover:text-red-600" aria-label="删除创新点" onClick={() => save({ innovations: arch.innovations.filter((y) => y.id !== x.id) })}>
                <Trash2 size={14} />
              </button>
            )}
          </li>
        ))}
        {!hasInnovations && <li className="px-4 py-3 text-xs text-ink-400">还没有创新点，可由 AI 生成或手动添加</li>}
      </ul>
      {!approved && (
        <Button variant="ghost" size="sm" className="mt-1.5" onClick={() => save({ innovations: [...arch.innovations, { id: newId(), theirs: '', ours: '' }] })}>
          <Plus size={14} />
          添加创新点
        </Button>
      )}
    </div>
  )

  const hasMainLine = arch.mainLine.some((b) => b.content.trim())
  const benchList = bd ? benchRanges(bd) : []
  // 仿写：冲突主线分两张表（我们的 / 对标剧拆解出来的），表头一样
  const benchLine = adaptation && bd?.mainLine.length ? bd : null
  const mainLineItem = (
    <div data-item="mainLine" key="mainLine">
      {head(
        'mainLine',
        <>
          {arch.phaseEnds && (
            <Button variant="ghost" size="sm" onClick={resetPhases}>
              <RotateCcw size={13} />
              恢复默认分段
            </Button>
          )}
          <AiButton
            variant="ghost"
            loading={running === 'mainline'}
            disabled={blocked || !!running}
            data-generate="冲突主线"
            title={`生成逻辑：${basisLine(archBasis(project, 'mainLine')!)}`}
            onClick={() =>
              guard(hasMainLine, {
                title: '重新生成冲突主线？',
                desc: '各段剧情会被 AI 结果覆盖；段落名与分段保留。',
                confirmText: '重新生成',
                action: async () => {
                  const r = await run('mainline', async (signal) => {
                    const d = await draftArchItem(latestProject(project.id) ?? project, 'mainLine', nextSeed(), signal)
                    applyDraft('mainLine', d, 'AI 生成冲突主线')
                    return { rhythm: await followRhythm(signal) }
                  })
                  if (!r) return
                  toast(r.rhythm ? '冲突主线已生成，节奏框架也按分段生成好了（在冲突主线下面）' : '冲突主线已生成；节奏框架没动，要按新分段更新就点「生成节奏框架」')
                },
              })
            }
          >
            AI 生成
          </AiButton>
        </>,
        { hint: '默认五段式：段落可增删，段落名、集数与剧情都可改；下面是节奏框架（付费卡点、大反转、结局高潮），按这里的分段生成' },
      )}
      {benchLine && (
        <div data-line-tabs className="mb-2 flex flex-wrap items-center gap-3">
          <Segmented
            value={lineTab}
            onChange={setLineTab}
            options={[
              { value: 'bench', label: '对标剧（拆解）' },
              { value: 'ours', label: '修改冲突主线' },
            ]}
          />
          <span className="text-xs text-ink-500">
            {lineTab === 'ours' ? (
              '编剧自己定：段落、每段集数、剧情都可以改，可增删段；表头和对标剧那张一样'
            ) : (
              <>
                对标剧拆解出来的，只读；到「修改冲突主线」里对照着定我们的段落和每段集数 ·{' '}
                <Link to={stagePath(project, 'breakdown')} className="font-medium text-brand-600 hover:text-brand-700">
                  去对标剧拆解修改
                </Link>
              </>
            )}
          </span>
        </div>
      )}
      {benchLine && lineTab === 'bench' ? (
        <div data-line-table="bench" className="overflow-hidden rounded-lg border border-line bg-canvas/40">
          <Table columns={['段落', '集数', '剧情']} minWidth={700}>
            {benchLine.mainLine.map((b, k) => (
              <tr key={k} className="align-top">
                <td className="w-40 px-4 py-2.5 font-medium text-ink-900">{b.beat}</td>
                <td className="w-44 px-4 py-2.5 whitespace-nowrap text-ink-500 tabular-nums">{benchList[k] ? rangeLabel(benchList[k]) : b.range}</td>
                <td className="px-4 py-2.5 leading-relaxed text-ink-700">{b.content || '—'}</td>
              </tr>
            ))}
          </Table>
        </div>
      ) : (
        <div data-line-table="ours" className="overflow-hidden rounded-lg border border-line">
          <Table columns={[...(approved ? [] : ['']), '段落', '集数', '剧情']} minWidth={700}>
            {arch.mainLine.map((b, i) => {
              const [from, to] = ranges[i] ?? [1, total]
              const last = i === arch.mainLine.length - 1
              return (
                <tr key={i} className="align-top">
                  {!approved && (
                    <td className="w-16 px-1 py-1.5 whitespace-nowrap">
                      <button
                        type="button"
                        aria-label={`在「${b.beat}」后新增一段`}
                        title="在这段后面新增一段（把这段对半拆开）"
                        disabled={count >= PHASE_LIMIT.max || to <= from}
                        onClick={() => addPhase(i)}
                        className="rounded p-1.5 text-ink-400 hover:bg-canvas hover:text-brand-600 disabled:pointer-events-none disabled:opacity-30"
                      >
                        <Plus size={14} />
                      </button>
                      <button
                        type="button"
                        aria-label={`删除「${b.beat}」`}
                        title="删除这段，集数并入相邻一段"
                        disabled={count <= PHASE_LIMIT.min}
                        onClick={() =>
                          guard(!!b.content.trim(), {
                            title: `删除「${b.beat}」？`,
                            desc: '这段的剧情与情节大纲里对应的阶段总览会一起删除，集数并入相邻一段。',
                            confirmText: '删除',
                            action: () => removePhase(i),
                          })
                        }
                        className="rounded p-1.5 text-ink-400 hover:bg-canvas hover:text-red-600 disabled:pointer-events-none disabled:opacity-30"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  )}
                  <td className="w-40 px-2 py-1.5">
                    <InlineInput aria-label={`第 ${i + 1} 段段落名`} value={b.beat} disabled={approved} onChange={(e) => setBeat(i, { beat: e.target.value })} className="font-medium" />
                  </td>
                  <td className="w-44 px-2 py-1.5 whitespace-nowrap text-ink-500 tabular-nums">
                    {last || approved ? (
                      <span className="inline-block px-2 py-1.5">{rangeLabel([from, to])}</span>
                    ) : (
                      <span className="flex items-center gap-1">
                        <span className="pl-2">第 {from}–</span>
                        <EpisodeInput label={`${b.beat}结束集`} value={to} max={total - (arch.mainLine.length - 1 - i)} onChange={(v) => setPhaseEnd(i, v)} />
                        <span>集</span>
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <AutoTextarea inline aria-label={`我们的剧情：${b.beat}`} value={b.content} disabled={approved} onChange={(e) => setBeat(i, { content: e.target.value })} placeholder="这一段发生什么" />
                  </td>
                </tr>
              )
            })}
          </Table>
        </div>
      )}
      <RhythmBlock
        key={`${project.id}-${total}`}
        project={project}
        ranges={ranges}
        beats={arch.mainLine}
        locked={approved}
        row={archBasis(project, 'rhythm')}
        generated={filledOf(project, 'rhythm')}
        fresh={justMade === 'rhythm'}
        onGenerated={() => stamp('rhythm')}
      />
    </div>
  )

  const content = (item: ArchItem): ReactNode => {
    const dir = directionButtons && (
      <div key="dir" className="mt-3 space-y-3">
        {directionButtons}
      </div>
    )
    switch (item) {
      case 'logline':
        return [loglineItem, dir]
      case 'innovations':
        return innovationsItem
      case 'mainLine':
        return mainLineItem
      case 'heroSetup':
        return textItem('heroSetup', 5)
      case 'goldenFinger':
        return textItem('goldenFinger', 5)
      default:
        return textItem(item as TextItem)
    }
  }

  /** 逐项生成停下来时，刚生成的那一项下面的提示：看过再继续 */
  const stepBar = (
    <div data-step-review className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-brand-200 bg-brand-50/60 px-3.5 py-2.5 text-[13px] text-ink-700">
      <Eye size={14} className="shrink-0 text-brand-600" />
      <span className="min-w-0 flex-1">{nextEmpty ? 'AI 刚生成了这一项，先停在这里：看过、改好再往下生成' : 'AI 刚生成了这一项，各项都有内容了：看过各项的「补充」再确认故事架构'}</span>
      {nextEmpty && (
        <AiButton size="sm" data-step-next loading={running === 'fill'} disabled={blocked || !!running} onClick={generateNext}>
          继续生成「{titleOf(nextEmpty)}」
        </AiButton>
      )}
      <button type="button" className="text-xs text-ink-500 hover:text-ink-900" onClick={() => setJustMade(null)}>
        知道了
      </button>
    </div>
  )

  /** 每一项是一个节点：左边序号（有内容实心）+ 竖线连到下一项，右边是这一项；节奏框架放在冲突主线下面，不单独排号 */
  const render = (item: ArchItem, i: number) => {
    const filled = filledOf(project, item)
    const here = justMade === item || (item === 'mainLine' && justMade === 'rhythm')
    const last = i === order.length - 1
    return (
      <section key={item} data-node={item} className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-3" style={{ scrollMarginTop: 'calc(var(--stick, 0px) + 1rem)' }}>
        <div className="relative flex justify-center">
          <span
            data-item-no
            title={filled ? '已有内容' : '还没有内容'}
            className={clsx(
              'relative z-10 grid size-7 place-items-center rounded-full text-[13px] font-semibold tabular-nums transition-colors',
              filled ? 'bg-brand-600 text-white' : 'border border-ink-200 bg-white text-ink-500',
              here && 'ring-4 ring-brand-100',
            )}
          >
            {i + 1}
          </span>
          {!last && <span aria-hidden className={clsx('absolute top-8 bottom-1 w-px', filled ? 'bg-brand-200' : 'bg-line')} />}
        </div>
        <div className={clsx('min-w-0', !last && 'pb-8')}>
          {content(item)}
          {here && !approved && stepBar}
        </div>
      </section>
    )
  }

  /** 状态条：状态、还差什么、AI 生成下一项、确认；放进页面底部的环节条（11/4 标注 #74；状态靠左、按钮靠右 #83，确认后最右接「去人物设定」） */
  const issueList = !live && issues.length > 0 && (
    <ul className="max-h-28 space-y-1 overflow-y-auto rounded-lg bg-red-50 px-4 py-2.5 text-[13px] text-red-700">
      {issues.map((t) => (
        <li key={t}>· {t}</li>
      ))}
    </ul>
  )
  const status = (
    <div className="flex min-w-0 items-center gap-2 text-[13px] text-ink-500">
      <ReviewBadge approved={approved} pendingText="草稿" />
      {approved ? (
        '已确认，各项只读；要改就点「修改故事架构」，改完重新确认'
      ) : live ? (
        live.length ? (
          <span data-live-missing className="flex min-w-0 items-center gap-1.5 text-amber-800">
            <TriangleAlert size={14} className="shrink-0" />
            <span className="truncate" title={live.join('；')}>
              确认前还差 <span className="font-medium tabular-nums">{live.length}</span> 项：{live.slice(0, 3).join('；')}
              {live.length > 3 && ` 等`}
            </span>
          </span>
        ) : (
          <span data-live-missing className="flex items-center gap-1.5 text-emerald-800">
            <CircleCheck size={14} className="shrink-0" />
            必填项已填完，可以确认
          </span>
        )
      ) : (
        <span className="truncate">修改自动保存；带 * 的确认前要有内容（AI 生成的也算）</span>
      )}
    </div>
  )
  const actions = (
    <>
      {approved ? (
        <Button variant="secondary" size="md" disabled={blocked} onClick={reopen}>
          <Pencil size={13} />
          修改故事架构
        </Button>
      ) : (
        <div className="flex gap-2">
          {running === 'fill' && (
            <Button variant="ghost" size="md" onClick={cancel} title="停下这一项，已生成的保留">
              <Square size={12} />
              停止
            </Button>
          )}
          {(nextEmpty || running === 'fill') && (
            <AiButton
              variant="secondary"
              size="md"
              loading={running === 'fill'}
              disabled={blocked || !!running}
              data-fill-next
              title="每次只生成一项（下一个空着的），生成完停下来等你看；看过、改好再继续。每一项读排在它前面的内容，已有内容不覆盖"
              onClick={generateNext}
            >
              {nextEmpty ? `${justMade ? '继续生成' : 'AI 生成'}「${titleOf(nextEmpty)}」` : 'AI 生成'}
            </AiButton>
          )}
          <Button size="md" disabled={blocked} onClick={confirm} title="逐项检查必填后确认">
            <Check size={14} />
            确认故事架构
          </Button>
        </div>
      )}
    </>
  )

  // 题材类型、风格元素的选项跟着目标市场走（目标市场在项目设置里改）
  const regions = genreRegions(project.markets)
  const jpkrOnly = regions.length === 1 && regions[0] === 'jpkr'
  const regionAside = (max: number) => (
    <span data-genre-region className="text-xs text-ink-400" title="选项跟着目标市场：选了日韩给日韩的，其余市场给欧美的；目标市场在项目设置里改">
      {regions.map((r) => GENRE_REGION_LABEL[r]).join(' + ')} · 最多 {max} 个
    </span>
  )

  return (
    <>
      <Card>
        <div className="border-b border-line px-5 py-4">
          <h3 className="text-[15px] font-semibold text-ink-900">基本信息</h3>
        </div>
        <div className="space-y-4 p-5">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="题材类型" error={project.genres.length || adaptation ? null : '至少选择 1 个'} aside={regionAside(MAX_GENRES)}>
              <MultiSelect value={project.genres} options={themeGroups(project.markets)} max={MAX_GENRES} invalid={!project.genres.length && !adaptation} onChange={(genres) => updateProject(project.id, { genres })} placeholder={jpkrOnly ? '如：财阀继承 / 反派千金' : '如：狼人传说 / 都市豪门'} />
            </Field>
            <Field label="风格元素" aside={regionAside(MAX_TONES)}>
              <MultiSelect value={project.tones} options={styleGroups(project.markets)} max={MAX_TONES} onChange={(tones) => updateProject(project.id, { tones })} placeholder={jpkrOnly ? '如：溺爱甜宠 / 和服' : '如：爽感复仇虐渣 / 狼人印记'} />
            </Field>
            <Field label="目标受众" required>
              <Select aria-label="目标受众" value={project.audience} onChange={(e) => updateProject(project.id, { audience: e.target.value as Project['audience'] })}>
                <option value="">请选择</option>
                {AUDIENCES.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="总集数" required>
              {follow ? (
                <Input aria-label="总集数" disabled value={`${total} 集 · 按对标剧`} />
              ) : (
                <NumberInput label="总集数" value={total} min={EPISODE_RANGE.min} max={EPISODE_RANGE.max} onChange={(v) => setSpec({ totalEpisodes: v }, `总集数改为 ${v} 集`)} />
              )}
            </Field>
            <Field label={<Tip label="单集时长（秒）" tip="逐集剧本按时长换算篇幅；竖屏短剧常见 60–120 秒" />} required hint={secondsHint(project.spec.episodeSeconds)}>
              {follow ? (
                <Input aria-label="单集时长" disabled value={`${project.spec.episodeSeconds} 秒${bench.seconds ? ' · 按对标剧' : ''}`} />
              ) : (
                <NumberInput
                  label="单集时长"
                  value={project.spec.episodeSeconds}
                  min={EPISODE_SECONDS.min}
                  max={EPISODE_SECONDS.max}
                  onChange={(v) => setSpec({ episodeSeconds: v }, `单集时长改为 ${v} 秒`)}
                />
              )}
            </Field>
            <Field label={<Tip label="剧本语言" tip="英文剧本 + 中文对照时，中文创作与审核，定稿后一键把台词译成英文" />} hint={LANGUAGES.find((l) => l.value === project.spec.language)?.hint}>
              <Select aria-label="剧本语言" value={project.spec.language} onChange={(e) => setSpec({ language: e.target.value as ScriptLanguage }, '修改剧本语言')}>
                {LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {adaptation && (
            <label data-follow-benchmark className="-mt-1 flex items-start gap-2 text-[13px] text-ink-700">
              <input
                type="checkbox"
                checked={follow}
                onChange={(e) => updateProject(project.id, { spec: { ...project.spec, followBenchmark: e.target.checked } }, e.target.checked ? '集数与单集时长改为完全按对标剧' : '集数与单集时长改为自己定')}
                className="mt-0.5 size-3.5 accent-brand-600"
              />
              <span>
                完全按对标剧的集数和单集时长来
                <span className="ml-1.5 text-xs text-ink-400">
                  {follow
                    ? bench.episodes
                      ? `对标剧 ${bench.episodes} 集${bench.seconds ? `，平均每集 ${bench.seconds} 秒` : '；单集时长没有视频可量，沿用当前设置'}`
                      : '对标剧还没拆解，拆解后自动同步'
                    : '想快速出稿时勾上，两项跟着对标剧走'}
                </span>
              </span>
            </label>
          )}
        </div>
      </Card>


      <Card id="arch-items" className={clsx(approved && 'border-emerald-200')}>
        <div className="border-b border-line px-5 py-3.5">
          <h3 className="text-[15px] font-semibold text-ink-900">各项设定</h3>
          <p data-arch-order className="mt-0.5 text-xs leading-5 text-ink-500">
            {order.map((i) => (i === 'mainLine' ? '冲突主线（含节奏框架）' : titleOf(i))).join(' → ')}
          </p>
          {!approved && <p className="mt-0.5 text-xs leading-5 text-ink-400">从上往下一项项写，每一项只读排在它前面的项；AI 每次只生成一项，停下来等你看过再继续</p>}
        </div>
        <div className="p-5">{order.map(render)}</div>
      </Card>

      {slot && (
        <>
          {createPortal(
            <div data-arch-bar className="flex min-w-0 flex-col gap-2">
              {issueList}
              {status}
            </div>,
            slot.info,
          )}
          {createPortal(<div className="flex flex-wrap items-center gap-2">{actions}</div>, slot.actions)}
        </>
      )}

      {directions && (
        <DirectionDialog
          directions={directions}
          adaptation={adaptation}
          overwrite={[project.logline, arch.world, arch.goldenFinger, arch.background].some((t) => !!t.trim())}
          refreshing={running === 'directions'}
          onRefresh={propose}
          onPick={pickDirection}
          onClose={() => setDirections(null)}
        />
      )}
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
