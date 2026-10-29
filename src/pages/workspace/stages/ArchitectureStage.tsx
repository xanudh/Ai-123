import clsx from 'clsx'
import { ArrowRight, Check, ChevronRight, CircleCheck, Eraser, Info, Plus, RotateCcw, Save, Trash2, TriangleAlert, Wand2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ConfirmDialog, Modal, UnsavedChangesPrompt } from '../../../components/overlay'
import { RhythmEditor } from '../../../components/project/RhythmEditor'
import { AiButton, AutoTextarea, EpisodeInput, InlineInput, ReviewBadge, Table, latestProject, useAiTask } from '../../../components/stage/StageKit'
import { Badge, Button, Card, Field, Input, MultiSelect, Select } from '../../../components/ui'
import { AUDIENCES, CATEGORIES, EPISODE_RANGE, EPISODE_SECONDS, GENRES, LANGUAGES, MAX_GENRES, STORY_STRUCTURES, VIEWPOINTS } from '../../../domain/constants'
import { rhythmForTotal, rhythmFromPhases, sameRhythm, secondsHint, validateRhythm } from '../../../domain/rhythm'
import type { Architecture, Audience, PlotBeat, Project, ScriptLanguage, StoryStructure } from '../../../domain/types'
import { PHASE_LIMIT, SILENCE_DEFAULT, defaultPhaseName, emptyArchitecture, phaseRanges, rangeLabel } from '../../../domain/work'
import { newId } from '../../../lib/id'
import { architectureIssues, draftArchitecture, draftMainLine, draftSection, evaluateIdea, nextSeed, proposeDirections, viewpointRule } from '../../../services/ai'
import type { ArchitectureSection, Direction, IdeaReview } from '../../../services/ai'
import { useProjects } from '../../../store/projects'
import { toast } from '../../../store/toast'
import { useV2 } from '../../../store/uiVersion'

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
function Section({
  title,
  filled,
  open,
  onToggle,
  actions,
  children,
}: {
  title: string
  filled: boolean
  open: boolean
  onToggle: () => void
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="border-b border-line last:border-b-0">
      <div className="flex items-center gap-3 px-5 py-3.5">
        <button className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={open} onClick={onToggle}>
          <ChevronRight size={16} className={clsx('shrink-0 text-ink-400 transition-transform', open && 'rotate-90')} />
          <span className="text-[14px] font-semibold text-ink-900">{title}</span>
          {!filled && <span className="text-xs text-ink-400">未填写</span>}
        </button>
        {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
      </div>
      {open && <div className="animate-fade-in px-5 pb-5 pl-11">{children}</div>}
    </section>
  )
}

/** 节奏曲线下方的冲突主线分段：与曲线的集数轴对齐（左 30 / 右 12 与 RhythmChart 的内边距一致） */
function MainLineStrip({ ranges, beats, total, aligned }: { ranges: [number, number][]; beats: PlotBeat[]; total: number; aligned: boolean }) {
  const pos = (ep: number) => (total <= 1 ? 0 : Math.min(1, Math.max(0, (ep - 1) / (total - 1))))
  return (
    <div className="mt-3 border-t border-line pt-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-medium text-ink-700">冲突主线设定</span>
        <span className="text-ink-500">{aligned ? '付费卡点落在每段结尾，大反转在段中' : '节奏已手动调整，与主线分段不完全一致；点「恢复推荐」可重新对齐'}</span>
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
      <ol className="mt-3 grid gap-x-6 gap-y-1.5 text-xs leading-5 md:grid-cols-2">
        {beats.map((b, i) => (
          <li key={i} className="flex min-w-0 gap-2">
            <span className="shrink-0 font-medium text-ink-700">{b.beat}</span>
            <span className="shrink-0 text-ink-400 tabular-nums">{ranges[i] ? rangeLabel(ranges[i]) : ''}</span>
            <span className={clsx('line-clamp-2 min-w-0', b.content.trim() ? 'text-ink-500' : 'text-ink-300')}>{b.content.trim() || '未填写'}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** 节奏框架：跟冲突主线绑定，先定主线再生成；生成后可本地微调，保存后写回项目 */
function RhythmBlock({ project, ranges, beats }: { project: Project; ranges: [number, number][]; beats: PlotBeat[] }) {
  const updateProject = useProjects((s) => s.updateProject)
  const total = project.spec.totalEpisodes
  const [rhythm, setRhythm] = useState(project.rhythm)
  const [manual, setManual] = useState(false)
  const recommended = rhythmFromPhases(ranges, total)
  const ready = beats.every((b) => b.content.trim())
  const dirty = !sameRhythm(rhythm, project.rhythm)
  const invalid = validateRhythm(rhythm, total).some((i) => i.level === 'error')
  const showEditor = ready || manual || dirty

  const save = () => {
    updateProject(project.id, { rhythm }, `调整节奏框架：首付费第 ${rhythm.paywalls[0]} 集`)
    toast('节奏框架已保存')
  }

  const generate = () => {
    setRhythm(recommended)
    updateProject(project.id, { rhythm: recommended }, `按冲突主线生成节奏框架：首付费第 ${recommended.paywalls[0] ?? '—'} 集`)
    toast('节奏框架已按冲突主线生成，可在折线图上微调')
  }

  return (
    <div className="rounded-lg border border-line">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-ink-900">节奏框架</div>
          <p className="mt-0.5 text-xs text-ink-500">按冲突主线分段生成：每段结尾设付费卡点，段中设大反转，最后一段为结局高潮区；情节大纲与写作都以这张表为准</p>
        </div>
        <div className="flex gap-2">
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
          <Button variant={ready && !dirty ? 'secondary' : 'ghost'} size="sm" disabled={!ready} title={ready ? undefined : '先填完冲突主线各段的剧情'} onClick={generate}>
            <Wand2 size={14} />
            生成节奏框架
          </Button>
        </div>
      </div>
      {showEditor ? (
        <div className="p-4">
          <RhythmEditor
            rhythm={rhythm}
            total={total}
            onChange={setRhythm}
            recommended={recommended}
            chartFooter={<MainLineStrip ranges={ranges} beats={beats} total={total} aligned={sameRhythm(rhythm, recommended)} />}
          />
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
          <p className="text-[13px] text-ink-500">
            先定冲突主线，再点「生成节奏框架」。目前沿用立项时的默认节奏（首付费第 {project.rhythm.paywalls[0] ?? '—'} 集）。
          </p>
          <Button variant="ghost" size="sm" onClick={() => setManual(true)}>
            直接编辑节奏
          </Button>
        </div>
      )}
      <UnsavedChangesPrompt dirty={dirty} desc="节奏框架有未保存的修改，离开后将丢失。" />
    </div>
  )
}

function ReviewPanel({ review, adoptText, onAdopt, onClose }: { review: IdeaReview; adoptText: string; onAdopt: () => void; onClose: () => void }) {
  return (
    <div className="animate-fade-in rounded-lg border border-line bg-canvas/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-[13px] font-medium">可行性</span>
          <span className="flex gap-1" aria-label={`可行性 ${review.score} 分`}>
            {[1, 2, 3, 4, 5].map((i) => (
              <span key={i} className={clsx('size-2.5 rounded-full', i <= review.score ? 'bg-brand-500' : 'bg-ink-900/10')} />
            ))}
          </span>
          <span className="text-[13px] text-ink-700">{review.verdict}</span>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            收起
          </Button>
          <Button size="sm" onClick={onAdopt}>
            {adoptText}
          </Button>
        </div>
      </div>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <ul className="space-y-1.5">
          {review.pros.map((t) => (
            <li key={t} className="flex gap-2 text-[13px] text-ink-700">
              <CircleCheck size={14} className="mt-[3px] shrink-0 text-emerald-500" />
              {t}
            </li>
          ))}
        </ul>
        <ul className="space-y-1.5">
          {review.risks.map((t) => (
            <li key={t} className="flex gap-2 text-[13px] text-amber-900">
              <TriangleAlert size={14} className="mt-[3px] shrink-0 text-amber-500" />
              {t}
            </li>
          ))}
        </ul>
      </div>
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

/** AI 给出的 3 个方向：弹窗里并排对比，选一个确定后再录入 */
function DirectionDialog({
  directions,
  planLabel,
  overwrite,
  refreshing,
  onRefresh,
  onPick,
  onClose,
}: {
  directions: Direction[]
  planLabel: string
  overwrite: boolean
  refreshing: boolean
  onRefresh: () => void
  onPick: (d: Direction) => void
  onClose: () => void
}) {
  const [picked, setPicked] = useState<string | null>(null)
  const chosen = directions.find((d) => d.id === picked)
  const h = 'mb-1 text-[11px] font-semibold tracking-wide text-ink-400'

  return (
    <Modal
      open
      onClose={onClose}
      width={1080}
      title="AI 给出的 3 个方向"
      desc={`对比${planLabel}、核心设定、冲突主线与创新点，选一个方向后点「确定录入」`}
      footer={
        <>
          <span className="mr-auto self-center text-xs text-ink-500">{overwrite ? `录入后会覆盖当前的${planLabel}、核心设定、爽点公式、冲突主线与创新点` : `录入后可继续逐项修改`}</span>
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
              <section>
                <div className={h}>{planLabel}</div>
                <PlanLines text={d.plan} />
              </section>
              <section>
                <div className={h}>核心设定</div>
                <p className="text-[13px] leading-6 font-medium text-ink-900">{d.logline}</p>
              </section>
              <section>
                <div className={h}>冲突主线</div>
                <ol className="space-y-1.5">
                  {d.mainLine.map((b, i) => (
                    <li key={i}>
                      <span className="font-medium text-ink-700">{b.beat}</span>
                      <span className="ml-1.5 text-ink-400 tabular-nums">{b.range}</span>
                      <div>{b.content}</div>
                    </li>
                  ))}
                </ol>
              </section>
              <section>
                <div className={h}>创新点</div>
                <ul className="space-y-1.5">
                  {d.innovations.map((x) => (
                    <li key={x.id}>
                      <span className="text-ink-400">{x.theirs}</span>
                      <ArrowRight size={11} className="mx-1 inline text-brand-400" />
                      <span className="text-ink-700">{x.ours}</span>
                    </li>
                  ))}
                </ul>
              </section>
              {d.formula && (
                <section>
                  <div className={h}>爽点公式</div>
                  <p>{d.formula}</p>
                </section>
              )}
            </label>
          )
        })}
      </div>
    </Modal>
  )
}

type TextKey = ArchitectureSection | 'references'
type SectionKey = 'core' | TextKey

/** 纯文本设定段落；参考作品只能手填 */
const TEXT_SECTIONS: { key: TextKey; title: string; placeholder: string }[] = [
  { key: 'world', title: '世界观 / 初始设定', placeholder: '故事发生在什么样的环境里：时代、地点、规则、核心秘密与前情恩怨……' },
  { key: 'goldenFinger', title: '金手指 / 核心卖点', placeholder: '主角的依仗是什么，观众为什么追下去……' },
  { key: 'heroSetup', title: '主角人设', placeholder: '一句话主角人设；完整小传在人物设定里展开' },
  { key: 'writingRules', title: '全局写作要求', placeholder: '每集写作都会带上的要求：篇幅、钩子、台词风格、视角……' },
  { key: 'references', title: '参考作品', placeholder: '参考哪些作品的风格或体系……' },
]

const textPatch = (key: TextKey, text: string) => {
  const patch: Partial<Architecture> = {}
  patch[key] = text
  return patch
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
  const { running, run } = useAiTask()
  const [review, setReview] = useState<IdeaReview | null>(null)
  const [directions, setDirections] = useState<Direction[] | null>(null)
  const [issues, setIssues] = useState<string[]>([])
  const [pending, setPending] = useState<Pending | null>(null)
  const [open, setOpen] = useState<Set<SectionKey>>(() => new Set(['core']))
  const v2 = useV2()

  const total = project.spec.totalEpisodes
  const arch = project.work.architecture ?? emptyArchitecture(total)
  const count = arch.mainLine.length
  const ranges = phaseRanges(total, arch.phaseEnds, count)
  const bd = project.work.breakdown
  const adaptation = project.mode !== 'original'
  const approved = arch.status === 'approved'
  const planLabel = adaptation ? '改写方案' : '整体框架'
  // 仿写项目还没开始时，用立项灵感作为改写想法的起点
  const idea = project.work.architecture ? arch.idea : project.idea
  // 原创项目以核心设定为起点：评估、提方向都围绕它
  const seedText = adaptation ? idea : project.logline
  const hasCore = !!arch.formula || arch.mainLine.some((b) => b.content) || arch.innovations.length > 0
  const hasMainLine = arch.mainLine.some((b) => b.content.trim())
  const structureHint = STORY_STRUCTURES.find((s) => s.value === arch.structure)?.hint

  const toggle = (key: SectionKey) =>
    setOpen((s) => {
      const next = new Set(s)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const save = (patch: Partial<Architecture>, note?: string) => {
    const cur = latestProject(project.id)
    if (!cur) return
    const base = cur.work.architecture ?? { ...emptyArchitecture(cur.spec.totalEpisodes), idea }
    patchWork(cur.id, { architecture: { ...base, ...patch } }, note)
  }

  const setSpec = (patch: Partial<Project['spec']>, note: string) => {
    const cur = latestProject(project.id)
    if (!cur) return
    const spec = { ...cur.spec, ...patch }
    const ends = cur.work.architecture?.phaseEnds
    const n = cur.work.architecture?.mainLine.length
    const before = cur.spec.totalEpisodes
    // 节奏原本就是按主线生成的，总集数变了就按新分段重新生成；否则只把越界的节点收回
    const fromPhases = sameRhythm(cur.rhythm, rhythmFromPhases(phaseRanges(before, ends, n), before))
    const rhythm = before === spec.totalEpisodes ? cur.rhythm : fromPhases ? rhythmFromPhases(phaseRanges(spec.totalEpisodes, ends, n), spec.totalEpisodes) : rhythmForTotal(cur.rhythm, before, spec.totalEpisodes)
    updateProject(cur.id, { spec, rhythm }, note)
  }

  const evaluate = async () => {
    const cur = latestProject(project.id)
    if (!cur) return
    const result = await run('evaluate', (signal) => evaluateIdea(cur, seedText, signal))
    if (result) setReview(result)
  }

  const propose = async () => {
    const cur = latestProject(project.id)
    if (!cur) return
    const result = await run('directions', (signal) => proposeDirections(cur, nextSeed(), signal))
    if (result) setDirections(result)
  }

  const pickDirection = (d: Direction) => {
    save({ plan: d.plan, idea: adaptation && !idea.trim() ? d.logline : idea, formula: d.formula, mainLine: d.mainLine, innovations: d.innovations }, `采用 AI 方向：${d.title}`)
    updateProject(project.id, { logline: d.logline })
    setDirections(null)
    setReview(null)
    setIssues([])
    toast(`已录入「${d.title}」：${planLabel}、核心设定、冲突主线与创新点都已更新`)
  }

  const generateCore = async () => {
    const cur = latestProject(project.id)
    if (!cur) return
    const draft = await run('core', (signal) => draftArchitecture(cur, nextSeed(), signal))
    if (!draft) return
    save({ formula: draft.formula, mainLine: draft.mainLine, innovations: draft.innovations }, 'AI 生成核心大纲')
    if (!latestProject(project.id)?.logline.trim()) updateProject(project.id, { logline: draft.logline })
    setIssues([])
    setOpen((s) => new Set(s).add('core'))
    toast('核心大纲已生成，请逐项修改后确认')
  }

  const generateMainLine = async () => {
    const cur = latestProject(project.id)
    if (!cur) return
    const mainLine = await run('mainline', (signal) => draftMainLine(cur, nextSeed(), signal))
    if (!mainLine) return
    save({ mainLine }, 'AI 生成冲突主线')
    toast('冲突主线已生成：确认后点「生成节奏框架」')
  }

  const generateSection = async (key: ArchitectureSection, title: string) => {
    const cur = latestProject(project.id)
    if (!cur) return
    const text = await run(key, (signal) => draftSection(cur, key, signal))
    if (text === undefined) return
    save(textPatch(key, text), `AI 生成${title}`)
    setOpen((s) => new Set(s).add(key))
  }

  /** 已有内容时先确认再覆盖 */
  const guard = (filled: boolean, next: Pending) => (filled ? setPending(next) : next.action())

  const missing = () => [...(project.logline.trim() ? [] : ['核心设定未填写']), ...architectureIssues(arch)]
  // 版本二：确认前就实时列出还差什么
  const live = v2 && !approved && !blocked ? missing() : null

  const confirm = () => {
    const found = missing()
    setIssues(found)
    if (found.length) {
      setOpen((s) => new Set(s).add('core'))
      return toast('核心大纲还有未完成的项', 'error')
    }
    save({ status: 'approved', mainLine: arch.mainLine.map((b, i) => ({ ...b, range: rangeLabel(ranges[i]) })) }, '确认故事架构')
    toast('故事架构已确认，可以开始人物设定')
  }

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

  /** 增删一段后的分段：ends 为各段结束集；情节大纲的粗纲随段落一起增删 */
  const reshape = (mainLine: PlotBeat[], ends: number[], plotPhases: (phases: string[]) => string[], note: string) => {
    const cur = latestProject(project.id)
    if (!cur) return
    const next = phaseRanges(total, ends, mainLine.length)
    const base = cur.work.architecture ?? { ...emptyArchitecture(total), idea }
    const plot = cur.work.plot && { ...cur.work.plot, phases: plotPhases(ranges.map((_, k) => cur.work.plot?.phases[k] ?? '')) }
    patchWork(cur.id, { architecture: { ...base, phaseEnds: ends, mainLine: mainLine.map((b, k) => ({ ...b, range: rangeLabel(next[k]) })) }, plot }, note)
  }

  /** 在第 i 段后面插入一段：把第 i 段对半拆开 */
  const addPhase = (i: number) => {
    const [from, to] = ranges[i]
    if (to <= from) return toast(`「${arch.mainLine[i].beat}」只有 1 集，拆不出新的一段`, 'error')
    const ends = ranges.map(([, e]) => e)
    ends.splice(i, 0, from + Math.floor((to - from - 1) / 2))
    const beat = defaultPhaseName(count)
    const mainLine = [...arch.mainLine.slice(0, i + 1), { beat, range: '', content: '' }, ...arch.mainLine.slice(i + 1)]
    reshape(mainLine, ends, (ph) => [...ph.slice(0, i + 1), '', ...ph.slice(i + 1)], `冲突主线新增一段「${beat}」`)
  }

  /** 删掉第 i 段：集数并入前一段（删第一段时并入后一段） */
  const removePhase = (i: number) => {
    const ends = ranges.map(([, e]) => e)
    ends.splice(Math.max(0, i - 1), 1)
    const mainLine = arch.mainLine.filter((_, k) => k !== i)
    reshape(mainLine, ends, (ph) => ph.filter((_, k) => k !== i), `冲突主线删除「${arch.mainLine[i].beat}」`)
  }

  return (
    <>
      <Card className={clsx('px-5 py-4', approved && 'border-emerald-200', live && 'sticky top-2 z-20')}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[13px] text-ink-500">
            <ReviewBadge approved={approved} pendingText="草稿" />
            {approved ? '核心大纲已锁定，取消确认后可修改；节奏框架与其余设定随时可调，修改自动保存' : '填好核心大纲后确认，人物设定、情节大纲与伏笔都会以这里为准；修改自动保存'}
          </div>
          {approved ? (
            <Button variant="secondary" size="sm" onClick={() => save({ status: 'pending' }, '取消确认故事架构')}>
              取消确认
            </Button>
          ) : (
            <Button size="sm" disabled={blocked} onClick={confirm}>
              <Check size={14} />
              确认故事架构
            </Button>
          )}
        </div>
        {live &&
          (live.length ? (
            <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 px-4 py-2.5 text-[13px] text-amber-800">
              <TriangleAlert size={14} className="mt-0.5 shrink-0" />
              <span>
                确认前还差 <span className="font-medium tabular-nums">{live.length}</span> 项：{live.slice(0, 3).join('；')}
                {live.length > 3 && ` 等`}
              </span>
            </div>
          ) : (
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-2.5 text-[13px] text-emerald-800">
              <CircleCheck size={14} className="shrink-0" />
              核心大纲已填完，可以确认
            </div>
          ))}
        {!live && issues.length > 0 && (
          <ul className="mt-3 space-y-1 rounded-lg bg-red-50 px-4 py-3 text-[13px] text-red-700">
            {issues.map((t) => (
              <li key={t}>· {t}</li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <div className="border-b border-line px-5 py-4">
          <h3 className="text-[15px] font-semibold text-ink-900">基本信息</h3>
        </div>
        <div className="space-y-4 p-5">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="类型">
              <Select aria-label="类型" value={project.category} onChange={(e) => updateProject(project.id, { category: e.target.value }, `类型改为「${e.target.value}」`)}>
                {!(CATEGORIES as readonly string[]).includes(project.category) && <option value={project.category}>{project.category || '选择类型'}</option>}
                {CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field label="细分类型" error={project.genres.length ? null : '至少选择 1 个'} aside={<span className="text-xs text-ink-400">最多 {MAX_GENRES} 个</span>}>
              <MultiSelect value={project.genres} options={GENRES} max={MAX_GENRES} invalid={!project.genres.length} onChange={(genres) => updateProject(project.id, { genres })} placeholder="如：重生 / 复仇 / 豪门" />
            </Field>
            <Field label="目标受众">
              <Select aria-label="目标受众" value={project.audience} onChange={(e) => updateProject(project.id, { audience: e.target.value as Audience })}>
                {AUDIENCES.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label} · {a.hint}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            <Field label={<Tip label="故事结构" tip="单线 / 双线 / 多线决定情节大纲里有几条叙事线并行" />} hint={structureHint}>
              <Select aria-label="故事结构" value={arch.structure} onChange={(e) => save({ structure: e.target.value as StoryStructure }, `故事结构改为「${e.target.value}」`)}>
                {STORY_STRUCTURES.map((s) => (
                  <option key={s.value}>{s.value}</option>
                ))}
              </Select>
            </Field>
            <Field label={<Tip label="叙事视角" tip="写作时镜头跟谁走、观众知道多少" />} hint={viewpointRule(arch.viewpoint)}>
              <Select aria-label="叙事视角" value={arch.viewpoint} onChange={(e) => save({ viewpoint: e.target.value })}>
                {VIEWPOINTS.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </Select>
            </Field>
            <Field label="总集数" required hint={`${EPISODE_RANGE.min}–${EPISODE_RANGE.max} 集`}>
              <NumberInput label="总集数" value={total} min={EPISODE_RANGE.min} max={EPISODE_RANGE.max} onChange={(v) => setSpec({ totalEpisodes: v }, `总集数改为 ${v} 集`)} />
            </Field>
            <Field label={<Tip label="单集时长（秒）" tip="逐集剧本按时长换算篇幅；竖屏短剧常见 60–120 秒" />} required hint={secondsHint(project.spec.episodeSeconds)}>
              <NumberInput
                label="单集时长"
                value={project.spec.episodeSeconds}
                min={EPISODE_SECONDS.min}
                max={EPISODE_SECONDS.max}
                onChange={(v) => setSpec({ episodeSeconds: v }, `单集时长改为 ${v} 秒`)}
              />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            <div className="md:col-span-2">
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
            <div className="md:col-span-2">
              <Field
                label={<Tip label="沉寂提醒阈值（集）" tip="已埋设的伏笔 / 叙事线索连续多少集没有推进，就在伏笔与状态库里提醒" />}
                hint={arch.silenceThreshold ? `连续 ${arch.silenceThreshold} 集没推进就提醒` : '默认无：不做沉寂提醒，只提醒逾期'}
                aside={
                  arch.silenceThreshold !== SILENCE_DEFAULT && (
                    <button className="flex items-center gap-1 text-xs text-ink-500 hover:text-brand-600" onClick={() => save({ silenceThreshold: SILENCE_DEFAULT })}>
                      <RotateCcw size={12} />
                      恢复默认（无）
                    </button>
                  )
                }
              >
                <NumberInput label="沉寂提醒阈值" optional value={arch.silenceThreshold} min={1} max={20} onChange={(v) => save({ silenceThreshold: v })} />
              </Field>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <Section
          title="核心大纲"
          filled={hasCore || !!arch.plan}
          open={open.has('core')}
          onToggle={() => toggle('core')}
          actions={
            !approved && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!hasCore}
                  onClick={() =>
                    setPending({
                      title: '清除核心大纲？',
                      desc: `爽点公式、创新点与冲突主线（含分段）会被清空；${planLabel}和核心设定保留。`,
                      confirmText: '清除',
                      danger: true,
                      action: () => save({ formula: '', mainLine: emptyArchitecture(total).mainLine, phaseEnds: null, innovations: [] }, '清除核心大纲'),
                    })
                  }
                >
                  <Eraser size={14} />
                  清除
                </Button>
                <AiButton
                  variant="secondary"
                  loading={running === 'core'}
                  disabled={blocked || !!running}
                  onClick={() =>
                    guard(hasCore, {
                      title: '重新生成核心大纲？',
                      desc: `爽点公式、创新点与冲突主线会被新结果覆盖；${planLabel}和核心设定保留。`,
                      confirmText: '重新生成',
                      action: generateCore,
                    })
                  }
                >
                  AI 生成
                </AiButton>
              </>
            )
          }
        >
          <div className="space-y-5">
            {adaptation ? (
              <Field label="你的改写想法" hint={approved ? '核心大纲已确认，取消确认后可修改' : undefined}>
                <AutoTextarea
                  aria-label="改写想法"
                  minRows={2}
                  value={idea}
                  disabled={approved}
                  onChange={(e) => save({ idea: e.target.value })}
                  placeholder="如：保留拒婚—归来结构，把狼人换成黑手党家族，女主是对立家族遗落的继承人"
                />
              </Field>
            ) : (
              <Field
                label="核心设定"
                required
                hint={approved ? '核心大纲已确认，取消确认后可修改' : '主角是谁 + 核心困境 + 反常规设定'}
                aside={
                  !approved &&
                  !project.logline.trim() &&
                  project.idea.trim() && (
                    <button className="text-xs text-ink-500 hover:text-brand-600" onClick={() => updateProject(project.id, { logline: project.idea })}>
                      填入立项灵感
                    </button>
                  )
                }
              >
                <AutoTextarea
                  aria-label="核心设定"
                  minRows={2}
                  value={project.logline}
                  disabled={approved}
                  onChange={(e) => updateProject(project.id, { logline: e.target.value })}
                  placeholder="如：被丈夫和闺蜜联手害死的女主重生回到婚礼前夜，这一次她要亲手把婚礼变成他们的审判庭"
                />
              </Field>
            )}
            {!approved && (
              <div className="flex flex-wrap gap-2">
                <AiButton loading={running === 'evaluate'} disabled={blocked || !seedText.trim() || !!running} onClick={evaluate}>
                  AI 评估可行性
                </AiButton>
                <AiButton variant="secondary" loading={running === 'directions' && !directions} disabled={blocked || !!running} onClick={propose}>
                  {adaptation ? '没有想法？AI 给出 3 个方向' : 'AI 给出 3 个方向'}
                </AiButton>
              </div>
            )}
            {review && (
              <ReviewPanel
                review={review}
                adoptText={`采用为${planLabel}`}
                onClose={() => setReview(null)}
                onAdopt={() => {
                  save({ plan: review.plan, idea }, `AI 评估${adaptation ? '改写想法' : '核心设定'}，采用为${planLabel}`)
                  setReview(null)
                  toast(`已写入${planLabel}`)
                }}
              />
            )}
            <Field label={planLabel} hint="保留什么、改动什么、爽点在哪；AI 生成核心大纲时会参考这里">
              <AutoTextarea aria-label={planLabel} minRows={3} value={arch.plan} disabled={approved} onChange={(e) => save({ plan: e.target.value })} placeholder="可直接填写，也可以从上方 AI 结果中采用" />
            </Field>

            <div className="grid gap-4 md:grid-cols-2">
              {adaptation && (
                <Field label="核心设定" required hint="主角是谁 + 核心困境 + 反常规设定">
                  <AutoTextarea aria-label="核心设定" value={project.logline} disabled={approved} onChange={(e) => updateProject(project.id, { logline: e.target.value })} />
                </Field>
              )}
              <Field label="爽点公式" hint="选填：每 X 集一次什么爽感">
                <Input aria-label="爽点公式" value={arch.formula} disabled={approved} onChange={(e) => save({ formula: e.target.value })} placeholder="如：每 3 集一次打脸，每 10 集一次身份升级" />
              </Field>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between text-[13px]">
                <span className="font-medium text-ink-700">
                  创新点<span className="ml-0.5 text-red-500">*</span>
                  <span className="ml-2 font-normal text-ink-400">{adaptation ? '对标剧怎么做 → 我们怎么做' : '同类爆款怎么做 → 我们怎么做'}，建议 3–5 条</span>
                </span>
                <span className="text-xs text-ink-500 tabular-nums">{arch.innovations.length} 条</span>
              </div>
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
                {!arch.innovations.length && <li className="px-4 py-3 text-xs text-ink-400">还没有创新点，可由 AI 生成或手动添加</li>}
              </ul>
              {!approved && (
                <Button variant="ghost" size="sm" className="mt-1.5" onClick={() => save({ innovations: [...arch.innovations, { id: newId(), theirs: '', ours: '' }] })}>
                  <Plus size={14} />
                  添加创新点
                </Button>
              )}
            </div>

            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13px] font-medium text-ink-700">
                  冲突主线<span className="ml-0.5 text-red-500">*</span>
                  <span className="ml-2 font-normal text-ink-400">默认五段式：段落可增删，段落名、集数与剧情都可改；先定主线，再生成节奏框架</span>
                </span>
                {!approved && (
                  <div className="flex gap-1.5">
                    {arch.phaseEnds && (
                      <Button variant="ghost" size="sm" onClick={resetPhases}>
                        <RotateCcw size={13} />
                        恢复默认分段
                      </Button>
                    )}
                    <AiButton
                      variant="secondary"
                      loading={running === 'mainline'}
                      disabled={blocked || !!running}
                      onClick={() =>
                        guard(hasMainLine, {
                          title: '重新生成冲突主线？',
                          desc: '各段剧情会被 AI 结果覆盖；段落名与分段保留。',
                          confirmText: '重新生成',
                          action: generateMainLine,
                        })
                      }
                    >
                      AI 生成
                    </AiButton>
                  </div>
                )}
              </div>
              <div className="overflow-hidden rounded-lg border border-line">
                <Table columns={[...(approved ? [] : ['']), '段落', '集数', '我们的剧情', ...(bd ? ['对标剧'] : [])]} minWidth={bd ? 940 : 700}>
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
                                  desc: '这段的剧情与情节大纲里对应的粗纲会一起删除，集数并入相邻一段。',
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
                        <td className="w-28 px-2 py-1.5">
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
                        {bd && <td className="w-64 px-4 py-3 text-xs leading-5 text-ink-500">{bd.mainLine[i]?.content || '—'}</td>}
                      </tr>
                    )
                  })}
                </Table>
              </div>
            </div>

            <RhythmBlock key={`${project.id}-${total}`} project={project} ranges={ranges} beats={arch.mainLine} />
          </div>
        </Section>

        {TEXT_SECTIONS.map((s) => {
          const value = arch[s.key]
          const filled = !!value.trim()
          return (
            <Section
              key={s.key}
              title={s.title}
              filled={filled}
              open={open.has(s.key)}
              onToggle={() => toggle(s.key)}
              actions={
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!filled}
                    onClick={() =>
                      setPending({ title: `清除${s.title}？`, desc: '这一段的内容会被清空。', confirmText: '清除', danger: true, action: () => save(textPatch(s.key, ''), `清除${s.title}`) })
                    }
                  >
                    <Eraser size={14} />
                    清除
                  </Button>
                  {s.key !== 'references' && (
                    <AiButton
                      variant="secondary"
                      loading={running === s.key}
                      disabled={blocked || !!running}
                      onClick={() => {
                        const key = s.key as ArchitectureSection
                        guard(filled, {
                          title: `重新生成${s.title}？`,
                          desc: '当前内容会被 AI 结果覆盖。',
                          confirmText: '重新生成',
                          action: () => generateSection(key, s.title),
                        })
                      }}
                    >
                      AI 生成
                    </AiButton>
                  )}
                </>
              }
            >
              <AutoTextarea aria-label={s.title} minRows={s.key === 'references' ? 2 : 4} value={value} onChange={(e) => save(textPatch(s.key, e.target.value))} placeholder={s.placeholder} />
            </Section>
          )
        })}
      </Card>

      {directions && (
        <DirectionDialog
          directions={directions}
          planLabel={planLabel}
          overwrite={hasCore || !!arch.plan.trim()}
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
