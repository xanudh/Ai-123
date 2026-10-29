import clsx from 'clsx'
import { BookOpen, ChevronRight, FileText } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { ConfirmDialog } from '../../../components/overlay'
import { AiButton, AutoTextarea, CheckList, InlineInput, latestProject, useAiTask } from '../../../components/stage/StageKit'
import type { CheckItem } from '../../../components/stage/StageKit'
import { Badge, Button, Card, CardHeader, Select } from '../../../components/ui'
import { HOOK_TYPES } from '../../../domain/constants'
import { nodeKind } from '../../../domain/rhythm'
import type { HookType, OutlineEpisode, Plot, Project } from '../../../domain/types'
import { outlineCount, pendingPaywalls, phaseNames, phaseOf, projectPhases, rangeLabel } from '../../../domain/work'
import type { StateFocus } from '../../../domain/snapshot'
import { draftOutline, draftPlot, nextSeed } from '../../../services/ai'
import { useProjects } from '../../../store/projects'
import { useStateFocus } from '../../../store/statePanel'
import { toast } from '../../../store/toast'

const PHASE_NO = ['一', '二', '三', '四', '五', '六', '七', '八']

function outlineChecks(project: Project): CheckItem[] {
  const { rhythm } = project
  const total = project.spec.totalEpisodes
  const list = project.work.outline.filter((o) => o.ep <= total).sort((a, b) => a.ep - b.ep)
  const items: CheckItem[] = []
  if (!project.work.plot?.overview.trim()) items.push({ level: 'info', text: '还没有全剧总览：先总览整部剧，再按阶段写粗纲，集纲会更连贯' })

  // 钩子轮换：相邻两集同类钩子（付费卡点除外）
  for (let i = 1; i < list.length; i++) {
    const [a, b] = [list[i - 1], list[i]]
    if (b.ep === a.ep + 1 && a.hook === b.hook && b.hook !== '付费卡点') items.push({ level: 'warn', text: `第 ${a.ep}–${b.ep} 集连续使用「${b.hook}」钩子，建议轮换` })
  }
  for (const o of list) {
    if (rhythm.paywalls.includes(o.ep) && o.hook !== '付费卡点') items.push({ level: 'warn', text: `第 ${o.ep} 集是付费卡点，钩子类型建议用「付费卡点」` })
    else if (rhythm.twists.includes(o.ep) && o.hook !== '反转') items.push({ level: 'info', text: `第 ${o.ep} 集是大反转集，钩子类型建议用「反转」` })
  }
  const pending = pendingPaywalls(project).map((o) => o.ep)
  if (pending.length) items.push({ level: 'warn', text: `付费卡点集待单独审核：第 ${pending.join('、')} 集` })
  const missing = total - list.length
  if (missing > 0 && list.length) items.push({ level: 'info', text: `还有 ${missing} 集未生成` })
  return items
}

function PositionBadge({ ep, project }: { ep: number; project: Project }) {
  const { rhythm } = project
  const kind = nodeKind(ep, rhythm)
  if (ep === 1) return <Badge tone="violet">开场钩子</Badge>
  if (kind === 'paywall') return <Badge tone="orange">{ep === rhythm.paywalls[0] ? '首付费' : '付费卡点'}</Badge>
  if (kind === 'twist') return <Badge tone="green">大反转</Badge>
  if (kind === 'climax') return <Badge tone="gray">结局高潮</Badge>
  return null
}

const scrollTo = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' }))

function EpisodeBlock({
  project,
  ep,
  o,
  onChange,
  onFocus,
  generate,
}: {
  project: Project
  ep: number
  o: OutlineEpisode | undefined
  onChange: (patch: Partial<OutlineEpisode>) => void
  onFocus: () => void
  generate: { loading: boolean; disabled: boolean; onClick: () => void }
}) {
  const paywall = project.rhythm.paywalls.includes(ep)
  return (
    <div id={`outline-ep-${ep}`} onFocus={onFocus} className={clsx('scroll-mt-4 rounded-lg px-3 py-3', paywall ? 'bg-orange-50/60' : 'hover:bg-canvas/60')}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="shrink-0 text-[14px] font-semibold text-ink-900 tabular-nums">第{ep}集：</span>
        {o ? (
          <InlineInput aria-label={`第 ${ep} 集标题`} value={o.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="本集标题" className="w-52 text-[14px] font-semibold" />
        ) : (
          <span className="text-[13px] text-ink-300">未生成</span>
        )}
        <PositionBadge ep={ep} project={project} />
        <div className="ml-auto flex items-center gap-3">
          {o && paywall && (
            <label className="flex items-center gap-1.5 text-xs whitespace-nowrap">
              <input type="checkbox" checked={o.approved} onChange={(e) => onChange({ approved: e.target.checked })} className="size-3.5 accent-brand-600" aria-label={`第 ${ep} 集付费卡点已审核`} />
              {o.approved ? <span className="text-emerald-700">付费卡点已审核</span> : <span className="text-amber-700">付费卡点待审核</span>}
            </label>
          )}
          <AiButton
            variant={o ? 'ghost' : 'secondary'}
            loading={generate.loading}
            disabled={generate.disabled}
            aria-label={`${o ? '重新生成' : '生成'}第 ${ep} 集集纲`}
            title={o ? `只重新生成第 ${ep} 集的集纲，本段其他集不动` : `只生成第 ${ep} 集的集纲`}
            onClick={generate.onClick}
          >
            {o ? '重新生成集纲' : '生成集纲'}
          </AiButton>
        </div>
      </div>
      {o && (
        <div className="mt-1.5 space-y-1">
          <AutoTextarea inline aria-label={`第 ${ep} 集集纲`} value={o.event} onChange={(e) => onChange({ event: e.target.value })} placeholder="本集发生什么" />
          <div className="flex items-start gap-1">
            <span className="shrink-0 pt-1.5 pl-2 text-[13px] text-ink-500">集末钩子：</span>
            <Select aria-label={`第 ${ep} 集钩子类型`} value={o.hook} onChange={(e) => onChange({ hook: e.target.value as HookType })} className="h-8 w-28 shrink-0 px-2 text-[13px]">
              {HOOK_TYPES.map((h) => (
                <option key={h}>{h}</option>
              ))}
            </Select>
            <AutoTextarea inline aria-label={`第 ${ep} 集结尾钩子`} value={o.hookLine} onChange={(e) => onChange({ hookLine: e.target.value })} placeholder="结尾钩子" className="flex-1" />
          </div>
        </div>
      )}
    </div>
  )
}

export default function OutlineStage({ project, blocked }: { project: Project; blocked: boolean }) {
  const patchWork = useProjects((s) => s.patchWork)
  const { running, run } = useAiTask()
  const total = project.spec.totalEpisodes
  const ranges = projectPhases(project)
  const names = phaseNames(project)
  const plot = project.work.plot
  const byEp = new Map(project.work.outline.filter((o) => o.ep <= total).map((o) => [o.ep, o]))
  const covered = outlineCount(project)
  // 第一个还没生成的集：打开时定位到它所在的阶段
  let nextEp = 1
  while (nextEp <= total && byEp.has(nextEp)) nextEp++
  const plotDone = !!plot?.overview.trim() && ranges.every((_, i) => plot.phases[i]?.trim())
  const hasOverview = !!plot?.overview.trim()
  const hasPlot = hasOverview || !!plot?.phases.some((t) => t.trim())
  const allDone = nextEp > total && plotDone

  // ?ep=N 从单集流程跳过来时定位到这一集；否则定位到第一个还没生成的集
  const [params] = useSearchParams()
  const epParam = Math.min(Number(params.get('ep')) || 0, total)
  const startPhase = phaseOf(epParam || Math.min(nextEp, total), ranges)
  const [phase, setPhase] = useState(startPhase)
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set([startPhase]))
  const [full, setFull] = useState(false)
  // 待确认的覆盖操作：总纲与粗纲 / 只有总纲 / 某一段的集纲 / 某一集的集纲
  const [confirm, setConfirm] = useState<'plot' | 'overview' | { phase: number } | { ep: number } | null>(null)
  // 状态库侧栏跟着选中的层级：总览 → 全剧，阶段 → 粗纲，某一集 → 集纲
  const [level, setLevel] = useState<StateFocus | null>(epParam ? { kind: 'ep', ep: epParam } : null)
  useStateFocus(level ?? { kind: 'phase', index: phase })
  useEffect(() => {
    if (epParam) scrollTo(`outline-ep-${epParam}`)
  }, [epParam])

  const words =
    (plot ? plot.overview.length + plot.phases.join('').length : 0) + [...byEp.values()].reduce((n, o) => n + o.title.length + o.event.length + o.hookLine.length, 0)
  const segments = (plot ? 1 + plot.phases.filter((t) => t.trim()).length : 0) + covered
  const pending = pendingPaywalls(project).length

  const generatePlot = async () => {
    const cur = latestProject(project.id)
    if (!cur) return
    const result = await run('plot', (signal) => draftPlot(cur, signal))
    if (!result) return
    patchWork(project.id, { plot: result }, '生成情节大纲：全剧总览与阶段粗纲')
    toast('总览与各段粗纲已生成，可直接修改')
  }

  /** 只生成总纲（全剧总览），各段粗纲不动 */
  const generateOverview = async () => {
    const cur = latestProject(project.id)
    if (!cur) return
    const result = await run('overview', (signal) => draftPlot(cur, signal))
    if (!result) return
    const latest = latestProject(project.id)?.work.plot
    patchWork(project.id, { plot: { overview: result.overview, phases: latest?.phases ?? ranges.map(() => '') } }, '生成情节大纲：全剧总纲')
    toast('总纲已生成，各段粗纲未改动')
  }

  /** 合并一段集纲：先清掉 a–b 的旧集纲 */
  const mergeOutline = (a: number, b: number, result: OutlineEpisode[]) => {
    const latest = latestProject(project.id)?.work.outline ?? []
    patchWork(project.id, { outline: [...latest.filter((o) => o.ep < a || o.ep > b), ...result].sort((x, y) => x.ep - y.ep) }, `生成分集集纲：${rangeLabel([a, b])}`)
  }

  /** 只生成 / 重新生成这一集的集纲，同段其他集不动 */
  const generateEpisode = async (ep: number, seed: number) => {
    const cur = latestProject(project.id)
    if (!cur) return
    const result = await run(`ep-${ep}`, (signal) => draftOutline(cur, ep, ep, seed, signal))
    if (!result) return
    mergeOutline(ep, ep, result)
    toast(cur.rhythm.paywalls.includes(ep) ? `已生成第 ${ep} 集集纲，付费卡点集待审核` : `已生成第 ${ep} 集集纲`)
    setLevel({ kind: 'ep', ep })
  }

  /** 一键集纲：按这一段的粗纲生成本段全部集纲 */
  const generatePhase = async (i: number, seed: number) => {
    const cur = latestProject(project.id)
    if (!cur) return
    const [a, b] = projectPhases(cur)[i]
    const result = await run(`phase-${i}`, (signal) => draftOutline(cur, a, b, seed, signal))
    if (!result) return
    mergeOutline(a, b, result)
    const paywalls = result.filter((o) => cur.rhythm.paywalls.includes(o.ep)).length
    toast(paywalls ? `已生成第 ${a}–${b} 集，含 ${paywalls} 个付费卡点集待审核` : `已生成第 ${a}–${b} 集`)
    pick(i)
  }

  /** AI 一键生成全部：补齐总览、各段粗纲，再逐段补齐还没生成的集纲；已有内容不覆盖 */
  const generateAll = async () => {
    const done = await run('all', async (signal) => {
      let cur = latestProject(project.id)
      if (!cur) return false
      const old = cur.work.plot
      const oldDone = !!old?.overview.trim() && projectPhases(cur).every((_, i) => old.phases[i]?.trim())
      if (!oldDone) {
        const fresh = await draftPlot(cur, signal)
        const merged: Plot = old
          ? { overview: old.overview.trim() ? old.overview : fresh.overview, phases: fresh.phases.map((t, i) => old.phases[i]?.trim() || t) }
          : fresh
        patchWork(project.id, { plot: merged }, '生成情节大纲：全剧总览与阶段粗纲')
      }
      // 逐段补齐：每段内连续缺失的集一次生成，开场承接上一集的钩子
      for (const [a, b] of projectPhases(cur)) {
        let ep = a
        while (ep <= b) {
          cur = latestProject(project.id)
          if (!cur) return false
          const has = new Set(cur.work.outline.map((o) => o.ep))
          if (has.has(ep)) {
            ep++
            continue
          }
          let end = ep
          while (end < b && !has.has(end + 1)) end++
          mergeOutline(ep, end, await draftOutline(cur, ep, end, 0, signal))
          ep = end + 1
        }
      }
      return true
    })
    if (!done) return
    const cur = latestProject(project.id)
    const paywalls = cur ? pendingPaywalls(cur).length : 0
    toast(paywalls ? `总览、粗纲与全部集纲已生成，${paywalls} 个付费卡点集待审核` : '总览、粗纲与全部集纲已生成')
  }

  const setPlot = (patch: Partial<Plot>) => {
    const cur = latestProject(project.id)
    if (!cur) return
    const base = cur.work.plot ?? { overview: '', phases: ranges.map(() => '') }
    patchWork(project.id, { plot: { ...base, ...patch } })
  }

  const update = (ep: number, patch: Partial<OutlineEpisode>) => {
    const cur = latestProject(project.id)
    if (cur) patchWork(project.id, { outline: cur.work.outline.map((o) => (o.ep === ep ? { ...o, ...patch } : o)) })
  }

  const pick = (p: number, ep?: number) => {
    setLevel(ep ? { kind: 'ep', ep } : { kind: 'phase', index: p })
    setPhase(p)
    setExpanded((s) => new Set(s).add(p))
    scrollTo(ep ? `outline-ep-${ep}` : `outline-phase-${p}`)
  }

  const toggle = (p: number) =>
    setExpanded((s) => {
      const next = new Set(s)
      if (next.has(p)) next.delete(p)
      else next.add(p)
      return next
    })

  const shownPhases = full ? ranges.map((_, i) => i) : [phase]

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div className="flex items-center gap-2">
            <BookOpen size={16} className="text-ink-500" />
            <span className="text-[15px] font-semibold text-ink-900">情节大纲</span>
            <span className="text-[13px] text-ink-400 tabular-nums">
              {segments} 段 · {words.toLocaleString()} 字 · 集纲 {covered}/{total}
            </span>
            {pending > 0 && <Badge tone="orange">付费卡点待审核 {pending}</Badge>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <AiButton
              loading={running === 'all'}
              disabled={blocked || allDone || !!running}
              title={allDone ? '总览、粗纲与集纲都已生成；单段可在段落右上角重新生成' : '补齐总览、各段粗纲与还没生成的集纲；已有内容不覆盖'}
              onClick={generateAll}
            >
              {allDone ? '已全部生成' : 'AI 一键生成全部'}
            </AiButton>
            <Button variant={full ? 'primary' : 'secondary'} size="sm" aria-pressed={full} onClick={() => setFull((v) => !v)}>
              <FileText size={14} />
              完整视图
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        {/* 目录树 */}
        <Card className="h-fit p-2 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
          <button className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[13px] font-semibold text-ink-900 hover:bg-canvas" onClick={() => {
            setLevel({ kind: 'all' })
            scrollTo('outline-overview')
          }}>
            总览
            <span className="text-xs font-normal text-ink-400">{plot ? 1 : 0}</span>
          </button>
          {ranges.map(([a, b], i) => {
            const open = expanded.has(i)
            const n = Array.from({ length: b - a + 1 }, (_, k) => a + k).filter((ep) => byEp.has(ep)).length
            return (
              <div key={i} className="mt-0.5">
                <div className={clsx('flex items-center rounded-md', !full && phase === i ? 'bg-brand-50' : 'hover:bg-canvas')}>
                  <button className="p-1.5 text-ink-400" aria-label={open ? '收起' : '展开'} aria-expanded={open} onClick={() => toggle(i)}>
                    <ChevronRight size={14} className={clsx('transition-transform', open && 'rotate-90')} />
                  </button>
                  <button className="flex min-w-0 flex-1 items-center justify-between py-1.5 pr-2 text-left" onClick={() => pick(i)}>
                    <span className="min-w-0 truncate text-[13px] font-semibold text-ink-900">
                      {names[i]}
                      <span className="ml-1 text-[11px] font-normal text-ink-400 tabular-nums">
                        {a}–{b}
                      </span>
                    </span>
                    <span className={clsx('text-xs tabular-nums', n === b - a + 1 ? 'text-emerald-600' : 'text-ink-400')}>{n}</span>
                  </button>
                </div>
                {open && (
                  <ul className="mb-1 ml-5 border-l border-line pl-1.5">
                    {Array.from({ length: b - a + 1 }, (_, k) => a + k).map((ep) => {
                      const o = byEp.get(ep)
                      return (
                        <li key={ep}>
                          <button className="flex w-full items-baseline gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-canvas" onClick={() => pick(i, ep)}>
                            <span className="w-5 shrink-0 text-right text-[11px] text-ink-300 tabular-nums">{ep}</span>
                            <span className="min-w-0">
                              <span className={clsx('block text-[13px]', o ? 'text-ink-900' : 'text-ink-300')}>第{ep}集</span>
                              {o?.title && <span className="block truncate text-xs text-ink-400">{o.title}</span>}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )
          })}
        </Card>

        {/* 文档 */}
        <div className="min-w-0 space-y-4">
          <Card id="outline-overview" className="scroll-mt-4 p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-[16px] font-semibold text-ink-900">总览</h3>
              <div className="flex flex-wrap items-center gap-2">
                <AiButton
                  variant="secondary"
                  loading={running === 'overview'}
                  disabled={blocked || !!running}
                  title="只生成全剧总览（总纲），各段粗纲不动"
                  onClick={() => (hasOverview ? setConfirm('overview') : generateOverview())}
                >
                  {hasOverview ? '重新生成总纲' : '生成总纲'}
                </AiButton>
                <AiButton variant={hasPlot ? 'secondary' : 'primary'} loading={running === 'plot'} disabled={blocked || !!running} onClick={() => (hasPlot ? setConfirm('plot') : generatePlot())}>
                  {hasPlot ? '重新生成总览与粗纲' : 'AI 生成总览与阶段粗纲'}
                </AiButton>
              </div>
            </div>
            <div className="rounded-lg bg-canvas p-1">
              <AutoTextarea
                inline
                aria-label="全剧总览"
                onFocus={() => setLevel({ kind: 'all' })}
                minRows={6}
                value={plot?.overview ?? ''}
                onChange={(e) => setPlot({ overview: e.target.value })}
                placeholder="先总览整部剧：一句话故事、叙事线架构（主线 / 感情线 / 反派线）、视角规则、爽点与付费节奏、结局走向"
                className="font-mono text-[12.5px] leading-6"
              />
            </div>
          </Card>

          {shownPhases.map((i) => {
            const [a, b] = ranges[i]
            const has = Array.from({ length: b - a + 1 }, (_, k) => a + k).some((ep) => byEp.has(ep))
            return (
              <Card key={i} id={`outline-phase-${i}`} className="scroll-mt-4 overflow-hidden">
                <div className="border-b border-line bg-canvas/50 px-5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-[15px] font-semibold text-ink-900">
                      第{PHASE_NO[i] ?? i + 1}段 · {names[i]}
                    </h3>
                    <span className="text-[13px] text-ink-500 tabular-nums">{rangeLabel([a, b])}</span>
                    <AiButton
                      className="ml-auto"
                      variant={has ? 'secondary' : 'primary'}
                      loading={running === `phase-${i}`}
                      disabled={blocked || !!running}
                      title={`按本段粗纲生成第 ${a}–${b} 集的集纲`}
                      onClick={() => (has ? setConfirm({ phase: i }) : generatePhase(i, 0))}
                    >
                      {has ? '重新生成集纲' : '一键集纲'}
                    </AiButton>
                  </div>
                  <div className="mt-2">
                    <div className="mb-0.5 text-xs font-medium text-ink-500">阶段粗纲</div>
                    <AutoTextarea
                      inline
                      aria-label={`${names[i]}粗纲`}
                      onFocus={() => setLevel({ kind: 'phase', index: i })}
                      minRows={2}
                      value={plot?.phases[i] ?? ''}
                      onChange={(e) => setPlot({ phases: ranges.map((_, k) => (k === i ? e.target.value : (plot?.phases[k] ?? ''))) })}
                      placeholder="这一阶段的剧情走向、关键节点与伏笔推进"
                      className="bg-white"
                    />
                  </div>
                </div>
                <div className="space-y-1 p-3">
                  {Array.from({ length: b - a + 1 }, (_, k) => a + k).map((ep) => (
                    <EpisodeBlock
                      key={ep}
                      project={project}
                      ep={ep}
                      o={byEp.get(ep)}
                      onChange={(patch) => update(ep, patch)}
                      onFocus={() => setLevel({ kind: 'ep', ep })}
                      generate={{
                        loading: running === `ep-${ep}`,
                        disabled: blocked || !!running,
                        onClick: () => (byEp.has(ep) ? setConfirm({ ep }) : generateEpisode(ep, 0)),
                      }}
                    />
                  ))}
                </div>
                {!full && (
                  <div className="flex justify-between border-t border-line px-5 py-2.5">
                    <Button variant="ghost" size="sm" disabled={i === 0} onClick={() => pick(i - 1)}>
                      上一段
                    </Button>
                    <Button variant="ghost" size="sm" disabled={i === ranges.length - 1} onClick={() => pick(i + 1)}>
                      下一段
                      <ChevronRight size={14} />
                    </Button>
                  </div>
                )}
              </Card>
            )
          })}

          {byEp.size > 0 && (
            <Card>
              <CardHeader title="大纲检查" desc="总览、钩子轮换、付费卡点与大反转位置" />
              <div className="px-5 py-4">
                <CheckList items={outlineChecks(project)} empty="钩子轮换正常，付费卡点已全部审核" />
              </div>
            </Card>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirm === 'plot'}
        onClose={() => setConfirm(null)}
        onConfirm={generatePlot}
        title="重新生成总览与阶段粗纲？"
        desc="全剧总览和各段粗纲会被替换；分集集纲不受影响。"
        confirmText="重新生成"
      />
      <ConfirmDialog
        open={confirm === 'overview'}
        onClose={() => setConfirm(null)}
        onConfirm={generateOverview}
        title="重新生成总纲？"
        desc="全剧总览会被替换；各段粗纲与分集集纲不受影响。"
        confirmText="重新生成"
      />
      <ConfirmDialog
        open={typeof confirm === 'object' && confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm || typeof confirm !== 'object') return
          if ('phase' in confirm) generatePhase(confirm.phase, nextSeed())
          else generateEpisode(confirm.ep, nextSeed())
        }}
        title={confirm && typeof confirm === 'object' ? ('phase' in confirm ? `重新生成「${names[confirm.phase]}」的集纲？` : `重新生成第 ${confirm.ep} 集的集纲？`) : ''}
        desc={
          confirm && typeof confirm === 'object'
            ? `${'phase' in confirm ? rangeLabel(ranges[confirm.phase]) : `第 ${confirm.ep} 集`}的集纲（含付费卡点审核状态）会被替换；分集蓝图与已写的剧本不受影响。`
            : ''
        }
        confirmText="重新生成"
      />
    </>
  )
}
