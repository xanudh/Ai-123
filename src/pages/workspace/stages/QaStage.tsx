/**
 * 质检交付：顶部质检总结（总分 → 分项）与全部问题，按分项角度 / 级别筛；
 * 下面左侧章节目录，中间是定稿正文（问题行与字段标色），右侧逐条看本集问题。正文上的问题可直接 AI 修稿。
 */
import clsx from 'clsx'
import { AlertTriangle, ArrowUpRight, CircleCheck, ClipboardCheck, Download, Info, Loader2, OctagonX, ShieldCheck, Undo2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ConfirmDialog } from '../../../components/overlay'
import { AiButton, latestProject, stagePath, useAiTask } from '../../../components/stage/StageKit'
import { Badge, Button, Card } from '../../../components/ui'
import { QA_CHECKS, STAGES } from '../../../domain/pipeline'
import type { EpisodeScript, Project, QaCheckKey, QaIssue, QaReport, ScriptLine } from '../../../domain/types'
import { plainText, qaStale } from '../../../domain/work'
import { downloadText } from '../../../lib/download'
import { modelLabel } from '../../../domain/models'
import { formatDateTime } from '../../../lib/format'
import { QA_STEPS, innovationLanding, runQa } from '../../../services/ai'
import { useProjects } from '../../../store/projects'
import { toast } from '../../../store/toast'
import { useV2 } from '../../../store/uiVersion'
import { finalPath } from '../script/ops'
import { QaFixButton } from '../script/QaFix'

type Level = QaIssue['level']
type Selection = number | 'global'

const LEVELS: Level[] = ['block', 'warn', 'info']

/** 严重程度：状态色 + 图标 + 文字，颜色不单独承担信息 */
const LEVEL: Record<Level, { label: string; Icon: typeof OctagonX; icon: string; row: string; mark: string; dot: string }> = {
  block: { label: '严重', Icon: OctagonX, icon: 'text-red-500', row: 'bg-red-50 shadow-[inset_3px_0_0_var(--color-red-500)]', mark: 'bg-red-200/80', dot: 'bg-red-500' },
  warn: { label: '建议', Icon: AlertTriangle, icon: 'text-amber-500', row: 'bg-amber-50 shadow-[inset_3px_0_0_var(--color-amber-400)]', mark: 'bg-amber-200/80', dot: 'bg-amber-400' },
  info: { label: '提示', Icon: Info, icon: 'text-sky-500', row: 'bg-sky-50 shadow-[inset_3px_0_0_var(--color-sky-400)]', mark: 'bg-sky-200/80', dot: 'bg-sky-400' },
}

const rank = (l: Level) => LEVELS.indexOf(l)
const byLevel = (a: QaIssue, b: QaIssue) => rank(a.level) - rank(b.level)
const CHECK_LABEL = Object.fromEntries(QA_CHECKS.map((c) => [c.key, c.label])) as Record<QaCheckKey, string>
const shortLabel = (label: string) => label.replace(/终检|对比|专项|落地|合规/, '')

function LevelIcon({ level, size = 14, className }: { level: Level; size?: number; className?: string }) {
  const { Icon, icon, label } = LEVEL[level]
  return <Icon size={size} className={clsx('shrink-0', icon, className)} aria-label={label} />
}

function gradeOf(score: number, blocks: number) {
  if (blocks) return { text: `${blocks} 个严重问题待处理`, tone: 'red' as const, Icon: OctagonX }
  if (score >= 90) return { text: '优秀 · 可以交付', tone: 'green' as const, Icon: CircleCheck }
  if (score >= 75) return { text: '良好 · 处理剩余问题后交付', tone: 'amber' as const, Icon: AlertTriangle }
  if (score >= 60) return { text: '需修改', tone: 'amber' as const, Icon: AlertTriangle }
  return { text: '不建议交付', tone: 'red' as const, Icon: OctagonX }
}

/** 分项得分条：填充色随分数档变化，底轨用同一色系的浅色 */
function Meter({ score }: { score: number }) {
  const [fill, track] = score >= 85 ? ['bg-brand-500', 'bg-brand-100'] : score >= 70 ? ['bg-amber-400', 'bg-amber-100'] : ['bg-red-500', 'bg-red-100']
  return (
    <div className={clsx('h-1.5 overflow-hidden rounded-full', track)} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score}>
      <div className={clsx('h-full rounded-full', fill)} style={{ width: `${Math.max(score, 2)}%` }} />
    </div>
  )
}

/** 去修改：有集数的问题回到正文章节；付费卡点集纲与全剧问题回到对应环节。版本二去正文时带上问题，改完可直接返回 */
function fixOf(p: Project, i: QaIssue, v2 = false) {
  if (i.ep !== null && !(i.check === 'paywall' && i.level === 'info')) return { to: `${finalPath(p, i.ep)}${v2 ? `?from=qa&issue=${i.id}` : ''}`, label: '去改正文' }
  const key = QA_CHECKS.find((c) => c.key === i.check)?.to ?? 'script'
  return { to: stagePath(p, key), label: `去${STAGES[key].label}` }
}

/** 把问题片段在行内标色；重叠时保留先出现的 */
function highlight(text: string, quotes: { text: string; level: Level }[]): ReactNode {
  const marks: { from: number; to: number; level: Level }[] = []
  for (const q of quotes) {
    if (!q.text) continue
    for (let i = text.indexOf(q.text); i >= 0; i = text.indexOf(q.text, i + q.text.length)) marks.push({ from: i, to: i + q.text.length, level: q.level })
  }
  if (!marks.length) return text
  marks.sort((a, b) => a.from - b.from || rank(a.level) - rank(b.level))
  const out: ReactNode[] = []
  let pos = 0
  for (const m of marks) {
    if (m.from < pos) continue
    if (m.from > pos) out.push(text.slice(pos, m.from))
    out.push(
      <mark key={m.from} className={clsx('rounded-[3px] px-0.5 text-ink-900', LEVEL[m.level].mark)}>
        {text.slice(m.from, m.to)}
      </mark>,
    )
    pos = m.to
  }
  if (pos < text.length) out.push(text.slice(pos))
  return out
}

const epRanges = (eps: number[]) => {
  const out: [number, number][] = []
  for (const ep of eps) {
    const last = out.at(-1)
    if (last && ep === last[1] + 1) last[1] = ep
    else out.push([ep, ep])
  }
  return out.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join('、')
}

function lineText(l: ScriptLine, en: boolean) {
  const text = plainText(l.zh)
  const zh = l.kind === 'dialogue' ? `${l.speaker ?? ''}：${text}` : l.kind === 'hook' ? `【集末钩子】${text}` : text
  if (!en || !l.en) return zh
  return `${zh}\n${l.kind === 'dialogue' ? `${l.speakerEn || l.speaker || ''}: ` : ''}${l.en}`
}

/** 可交付剧本包：项目信息 + 质检结论 + 全部定稿正文 */
function packageText(p: Project, scripts: EpisodeScript[], report: QaReport | null) {
  const head = [
    `《${p.title}》${p.titleEn ? ` ${p.titleEn}` : ''}`,
    p.logline && `核心设定：${p.logline}`,
    `共 ${p.spec.totalEpisodes} 集，已定稿 ${scripts.length} 集 · 单集约 ${p.spec.episodeSeconds} 秒`,
    report && `质检：${report.score} 分（${formatDateTime(report.at)}）· ${report.checks.map((c) => `${CHECK_LABEL[c.key]} ${c.score}`).join(' / ')}`,
  ].filter(Boolean)
  const eps = scripts.map((s) => [`第 ${s.ep} 集　${s.title}`, '', ...s.lines.map((l) => lineText(l, p.spec.language !== 'zh' && s.translated))].join('\n'))
  return [head.join('\n'), ...eps].join('\n\n\n')
}

/* ---------------------------------- 总结 ---------------------------------- */

function Summary({
  report,
  open,
  check,
  onCheck,
  level,
  onLevel,
  children,
}: {
  report: QaReport
  open: QaIssue[]
  check: QaCheckKey | null
  onCheck: (k: QaCheckKey | null) => void
  level: Level | 'all'
  onLevel: (l: Level | 'all') => void
  children: ReactNode
}) {
  const blocks = open.filter((i) => i.level === 'block').length
  const grade = gradeOf(report.score, blocks)
  // 横排：左边总分，右边各分项；点分项（角度）或级别，下方全部问题跟着筛
  return (
    <Card id="qa-summary" className="overflow-hidden">
      <div className="flex flex-col gap-3 p-3 lg:flex-row">
        <div className="shrink-0 px-2 pt-1 lg:w-44 lg:border-r lg:border-line lg:pr-4">
          <div className="text-xs text-ink-500">质检总分</div>
          <div className="mt-0.5 flex items-baseline gap-1">
            <span className="text-5xl font-semibold tracking-tight text-ink-900">{report.score}</span>
            <span className="text-sm text-ink-400">/ 100</span>
          </div>
          <Badge tone={grade.tone} className="mt-2">
            <grade.Icon size={12} />
            {grade.text}
          </Badge>
          <div className="mt-3 -ml-1.5 flex flex-wrap gap-0.5 text-xs text-ink-500">
            {LEVELS.map((l) => {
              const on = level === l
              return (
                <button
                  key={l}
                  aria-pressed={on}
                  title={on ? '取消筛选' : `只看${LEVEL[l].label}问题`}
                  onClick={() => onLevel(on ? 'all' : l)}
                  className={clsx('flex items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors', on ? 'bg-brand-50 text-brand-700' : 'hover:bg-canvas')}
                >
                  <LevelIcon level={l} size={12} />
                  {LEVEL[l].label}
                  <span className="font-medium text-ink-900 tabular-nums">{open.filter((i) => i.level === l).length}</span>
                </button>
              )
            })}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-4">
            {QA_CHECKS.map((c) => {
              const r = report.checks.find((x) => x.key === c.key)
              if (!r) return null
              const on = check === c.key
              return (
                <li key={c.key}>
                  <button
                    aria-pressed={on}
                    title={on ? '取消筛选' : `只看${c.label}的问题`}
                    onClick={() => onCheck(on ? null : c.key)}
                    className={clsx('w-full rounded-lg px-2 py-2 text-left transition-colors', on ? 'bg-brand-50' : 'hover:bg-canvas')}
                  >
                    <div className="flex items-baseline justify-between gap-2 text-[13px]">
                      <span className={clsx('font-medium', on ? 'text-brand-700' : 'text-ink-900')}>{c.label}</span>
                      <span className="font-semibold text-ink-700 tabular-nums">{r.score}</span>
                    </div>
                    <div className="mt-1.5">
                      <Meter score={r.score} />
                    </div>
                    <p className="mt-1 text-[11px] leading-4 text-ink-500">{r.summary}</p>
                  </button>
                </li>
              )
            })}
          </ul>
          <p className="mt-1 px-2 text-[11px] leading-4 text-ink-400">总分按权重加权：{QA_CHECKS.map((c) => `${shortLabel(c.label)} ${Math.round(c.weight * 100)}%`).join(' + ')}</p>
        </div>
      </div>
      {children}
    </Card>
  )
}

/** 全部问题里的一行：整行宽，问题与建议一行读完，右侧是处理动作 */
function IssueRow({ project, issue, active, done, fixed, onPick, onToggle }: { project: Project; issue: QaIssue; active: boolean; done: boolean; fixed: boolean; onPick: () => void; onToggle: () => void }) {
  const fix = fixOf(project, issue, useV2())
  return (
    <li data-qa-row={issue.id} className={clsx('flex flex-wrap items-start gap-x-4 gap-y-1 px-5 py-2 transition-colors', active ? 'bg-brand-50/60' : 'hover:bg-canvas/60', done && 'opacity-60')}>
      <button className="flex min-w-0 flex-1 items-start gap-2 text-left" onClick={onPick}>
        <LevelIcon level={issue.level} className="mt-[3px]" />
        <span className="w-14 shrink-0 text-xs leading-5 text-ink-500 tabular-nums">{issue.ep === null ? '全剧' : `第 ${issue.ep} 集`}</span>
        <span className="min-w-0 text-[13px] leading-5">
          <span className={clsx('font-medium text-ink-900', done && 'line-through')}>{issue.title}</span>
          <span className="ml-1.5 text-[11px] text-ink-400">{CHECK_LABEL[issue.check]}</span>
          <span className="block text-xs text-ink-500">
            {issue.detail}
            <span className="text-ink-700"> · 建议：{issue.suggestion}</span>
          </span>
        </span>
      </button>
      <div className="ml-auto flex shrink-0 items-center gap-3 pt-0.5">
        <Link to={fix.to} className="flex items-center gap-0.5 text-xs text-brand-600 hover:text-brand-700">
          {fix.label}
          <ArrowUpRight size={12} />
        </Link>
        {!done && <QaFixButton project={project} issue={issue} />}
        {done && fixed && <span className="text-xs text-emerald-700">AI 已修稿</span>}
        <button onClick={onToggle} className="flex items-center gap-1 text-xs text-ink-500 hover:text-ink-900">
          {done ? <Undo2 size={12} /> : <CircleCheck size={12} />}
          {done ? '恢复' : '标记已处理'}
        </button>
      </div>
    </li>
  )
}

function Counts({ issues }: { issues: QaIssue[] }) {
  if (!issues.length) return <CircleCheck size={13} className="shrink-0 text-emerald-500" aria-label="无待处理问题" />
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {LEVELS.filter((l) => l !== 'info').map((l) => {
        const n = issues.filter((i) => i.level === l).length
        return n ? (
          <span key={l} className="flex items-center gap-0.5 text-[11px] text-ink-700 tabular-nums" title={`${n} 个${LEVEL[l].label}问题`}>
            <span className={clsx('size-1.5 rounded-full', LEVEL[l].dot)} />
            {n}
          </span>
        ) : null
      })}
      {issues.every((i) => i.level === 'info') && <span className="text-[11px] text-ink-400 tabular-nums">{issues.length} 提示</span>}
    </span>
  )
}

function Directory({
  scripts,
  report,
  open,
  current,
  missing,
  onSelect,
}: {
  scripts: EpisodeScript[]
  report: QaReport
  open: QaIssue[]
  current: Selection | null
  missing: number
  onSelect: (s: Selection) => void
}) {
  const global = open.filter((i) => i.ep === null)
  const row = (active: boolean) => clsx('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors', active ? 'bg-brand-50' : 'hover:bg-canvas')
  return (
    <div className="px-3 py-3">
      <div className="mb-1 px-2 text-[11px] font-medium tracking-wider text-ink-400">章节目录</div>
      <ul className="space-y-0.5">
        <li>
          <button className={row(current === 'global')} onClick={() => onSelect('global')}>
            <span className="w-11 shrink-0 text-xs text-ink-500">全剧</span>
            <span className={clsx('min-w-0 flex-1 truncate text-[13px]', current === 'global' ? 'font-medium text-brand-700' : 'text-ink-900')}>创新点落地</span>
            <Counts issues={global} />
          </button>
        </li>
        {scripts.map((s) => {
          const checked = report.versions[s.ep] !== undefined
          const active = current === s.ep
          return (
            <li key={s.ep}>
              <button className={row(active)} onClick={() => onSelect(s.ep)}>
                <span className="w-11 shrink-0 text-xs text-ink-500 tabular-nums">第 {s.ep} 集</span>
                <span className={clsx('min-w-0 flex-1 truncate text-[13px]', active ? 'font-medium text-brand-700' : 'text-ink-900')}>{s.title}</span>
                {checked ? <Counts issues={open.filter((i) => i.ep === s.ep)} /> : <span className="shrink-0 text-[11px] text-ink-400">未质检</span>}
              </button>
            </li>
          )
        })}
      </ul>
      {missing > 0 && <p className="px-2 pt-2 text-[11px] leading-4 text-ink-400">另有 {missing} 集未定稿，不在质检范围内</p>}
    </div>
  )
}

/* ---------------------------------- 中栏 ---------------------------------- */

function LineBody({ l, quotes }: { l: ScriptLine; quotes: { text: string; level: Level }[] }) {
  if (l.kind === 'scene') return <div className="font-semibold text-ink-900">{highlight(plainText(l.zh), quotes)}</div>
  if (l.kind === 'dialogue') {
    return (
      <div className="flex items-start">
        <span className={clsx('w-16 shrink-0 text-right font-semibold', l.speaker?.trim() ? 'text-ink-900' : 'text-red-600')}>{l.speaker?.trim() ? highlight(l.speaker, quotes) : '（无）'}</span>
        <span className="text-ink-400">：</span>
        <span className="min-w-0 flex-1 text-ink-900">{highlight(plainText(l.zh), quotes)}</span>
      </div>
    )
  }
  if (l.kind === 'hook') {
    return (
      <div className="rounded-md border-l-2 border-brand-300 bg-white/70 px-2 py-0.5">
        <div className="text-[11px] font-medium text-brand-700">集末钩子</div>
        <div className="font-medium text-ink-900">{highlight(plainText(l.zh), quotes)}</div>
      </div>
    )
  }
  return <div className="text-ink-700">{highlight(plainText(l.zh), quotes)}</div>
}

function ScriptView({
  project,
  script,
  issues,
  checked,
  activeId,
  onPick,
}: {
  project: Project
  script: EpisodeScript
  issues: QaIssue[]
  checked: boolean
  activeId: string | null
  onPick: (i: QaIssue) => void
}) {
  const v2 = useV2()
  const byLine = new Map<string, QaIssue[]>()
  for (const i of issues) if (i.lineId) byLine.set(i.lineId, [...(byLine.get(i.lineId) ?? []), i].sort(byLevel))
  // 整集问题：没定位到行，或定位的行已经不在正文里
  const whole = issues.filter((i) => !i.lineId || !script.lines.some((l) => l.id === i.lineId)).sort(byLevel)

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold text-ink-900">
            第 {script.ep} 集 · {script.title}
          </h3>
          <p className="mt-0.5 text-xs text-ink-500">{checked ? `定稿正文 · ${issues.length ? `${issues.length} 个待处理问题，问题行与字段已标色` : '没有待处理的问题'}` : '这一集在质检后才定稿，重新质检后才会标出问题'}</p>
        </div>
        <Link to={`${finalPath(project, script.ep)}${v2 ? '?from=qa' : ''}`} className="flex shrink-0 items-center gap-0.5 text-[13px] text-brand-600 hover:text-brand-700">
          去改正文
          <ArrowUpRight size={14} />
        </Link>
      </div>
      {whole.length > 0 && (
        <ul className="space-y-0.5 border-b border-line bg-canvas/50 px-2 py-2">
          {whole.map((i) => (
            <li key={i.id}>
              <button
                onClick={() => onPick(i)}
                className={clsx('flex w-full items-start gap-2 rounded-md px-2 py-1 text-left text-[13px] leading-5', i.id === activeId ? 'bg-brand-50 ring-1 ring-brand-300' : 'hover:bg-white')}
              >
                <LevelIcon level={i.level} className="mt-[3px]" />
                <span className="min-w-0">
                  <span className="font-medium text-ink-900">整集 · {i.title}</span>
                  <span className="ml-1.5 text-xs text-ink-500">{i.detail}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="text-[13px] leading-6">
        {script.lines.map((l, idx) => {
          const list = byLine.get(l.id) ?? []
          const top = list[0]
          const active = list.some((i) => i.id === activeId)
          return (
            <div
              key={l.id}
              id={`qa-line-${l.id}`}
              onClick={() => top && onPick(list.find((i) => i.id === activeId) ? list[(list.findIndex((i) => i.id === activeId) + 1) % list.length] : top)}
              className={clsx(
                'grid scroll-mt-24 grid-cols-[40px_minmax(0,1fr)] border-b border-line/60 last:border-b-0',
                top ? clsx(LEVEL[top.level].row, 'cursor-pointer') : '',
                active && 'outline-2 -outline-offset-2 outline-brand-400',
              )}
            >
              <div className="pt-1.5 pr-2 text-right text-[11px] text-ink-300 tabular-nums select-none">{idx + 1}</div>
              <div className="min-w-0 py-1.5 pr-3">
                <LineBody l={l} quotes={list.filter((i) => i.quote).map((i) => ({ text: i.quote!, level: i.level }))} />
                {list.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {list.map((i) => (
                      <span key={i.id} className={clsx('inline-flex items-center gap-1 rounded bg-white/90 px-1.5 text-[11px] leading-5 text-ink-700', i.id === activeId && 'ring-1 ring-brand-300')}>
                        <LevelIcon level={i.level} size={11} />
                        {i.title}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

/** 全剧层面：创新点逐条落地情况 */
function GlobalView({ project, issues, activeId, onPick }: { project: Project; issues: QaIssue[]; activeId: string | null; onPick: (i: QaIssue) => void }) {
  const list = innovationLanding(project)
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <h3 className="text-[15px] font-semibold text-ink-900">全剧 · 创新点落地</h3>
          <p className="mt-0.5 text-xs text-ink-500">按故事架构里的创新点，在已定稿正文里逐条检索</p>
        </div>
        <Link to={stagePath(project, 'architecture')} className="flex items-center gap-0.5 text-[13px] text-brand-600 hover:text-brand-700">
          去故事架构
          <ArrowUpRight size={14} />
        </Link>
      </div>
      {list.length ? (
        <ul className="divide-y divide-line">
          {list.map((x) => {
            const issue = issues.find((i) => i.check === 'innovation' && (i.quote ? i.quote === x.key : !x.key && i.detail.includes(x.ours.slice(0, 10))))
            const level: Level | null = x.eps.length ? null : x.key ? 'warn' : 'info'
            return (
              <li
                key={x.id}
                onClick={() => issue && onPick(issue)}
                className={clsx('flex items-start gap-3 px-4 py-3', level && LEVEL[level].row, issue && 'cursor-pointer', issue && issue.id === activeId && 'outline-2 -outline-offset-2 outline-brand-400')}
              >
                {level ? <LevelIcon level={level} className="mt-1" /> : <CircleCheck size={14} className="mt-1 shrink-0 text-emerald-500" aria-label="已落地" />}
                <div className="min-w-0 flex-1 text-[13px] leading-6">
                  <div className="text-ink-500">{x.theirs || '—'}</div>
                  <div className="text-ink-900">{level && x.key ? highlight(x.ours, [{ text: x.key, level }]) : x.ours}</div>
                </div>
                <div className="w-28 shrink-0 text-right text-xs leading-6 text-ink-500">
                  {x.eps.length ? `第 ${epRanges(x.eps)} 集` : x.key ? `未找到「${x.key}」` : '需人工确认'}
                </div>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="px-4 py-8 text-center text-[13px] text-ink-400">故事架构里还没有创新点</p>
      )}
    </Card>
  )
}

/* ---------------------------------- 右栏：本集问题 ---------------------------------- */

function IssueItem({ project, issue, active, done, fixed, onPick, onToggle }: { project: Project; issue: QaIssue; active: boolean; done: boolean; fixed: boolean; onPick: () => void; onToggle: () => void }) {
  const fix = fixOf(project, issue, useV2())
  return (
    <li id={`qa-issue-${issue.id}`} className={clsx('scroll-mt-4 rounded-lg border px-3 py-2.5 transition-colors', active ? 'border-brand-300 bg-brand-50/50' : 'border-line bg-white', done && 'opacity-60')}>
      <button className="flex w-full items-start gap-2 text-left" onClick={onPick}>
        <LevelIcon level={issue.level} className="mt-[3px]" />
        <span className="min-w-0 flex-1">
          <span className={clsx('block text-[13px] leading-5 font-medium text-ink-900', done && 'line-through')}>{issue.title}</span>
          <span className="mt-0.5 block text-[11px] text-ink-500">
            {issue.ep === null ? '全剧' : `第 ${issue.ep} 集`} · {CHECK_LABEL[issue.check]} · {LEVEL[issue.level].label}
          </span>
        </span>
      </button>
      <p className="mt-1.5 pl-6 text-xs leading-5 text-ink-700">{issue.detail}</p>
      <p className="mt-1.5 ml-6 rounded-md bg-canvas px-2 py-1.5 text-xs leading-5 text-ink-700">
        <span className="font-medium text-ink-900">建议：</span>
        {issue.suggestion}
      </p>
      <div className="mt-2 flex items-center gap-3 pl-6">
        <Link to={fix.to} className="flex items-center gap-0.5 text-xs text-brand-600 hover:text-brand-700">
          {fix.label}
          <ArrowUpRight size={12} />
        </Link>
        {!done && <QaFixButton project={project} issue={issue} />}
        {done && fixed && <span className="text-xs text-emerald-700">AI 已修稿</span>}
        <button onClick={onToggle} className="ml-auto flex items-center gap-1 text-xs text-ink-500 hover:text-ink-900">
          {done ? <Undo2 size={12} /> : <CircleCheck size={12} />}
          {done ? '恢复' : '标记已处理'}
        </button>
      </div>
    </li>
  )
}

/* ---------------------------------- 页面 ---------------------------------- */

function Running() {
  const [step, setStep] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setStep((s) => Math.min(s + 1, QA_STEPS.length - 1)), 280)
    return () => clearInterval(t)
  }, [])
  return (
    <ol className="space-y-2">
      {QA_STEPS.map((s, i) => (
        <li key={s} className={clsx('flex items-center gap-2 text-[13px]', i <= step ? 'text-ink-900' : 'text-ink-400')}>
          {i < step ? <CircleCheck size={14} className="text-emerald-500" /> : i === step ? <Loader2 size={14} className="animate-spin text-brand-500" /> : <span className="mx-[3px] size-2 rounded-full bg-ink-300" />}
          {s}
        </li>
      ))}
    </ol>
  )
}

export default function QaStage({ project, blocked }: { project: Project; blocked: boolean }) {
  const { patchWork, updateProject } = useProjects()
  const { running, run } = useAiTask()
  // 版本二：从正文页「返回质检」回来时，回到原来那条问题（已处理就接着看同一集的下一条）
  const [params] = useSearchParams()
  const [back] = useState(() => {
    const issues = project.work.qa?.issues ?? []
    const resolvedIds = project.work.qa?.resolved ?? []
    const from = issues.find((i) => i.id === params.get('issue'))
    const ep = from ? from.ep : Number(params.get('ep')) || null
    if (!from && !ep) return null
    const open = issues.filter((i) => !resolvedIds.includes(i.id))
    const target = from && !resolvedIds.includes(from.id) ? from : (open.find((i) => i.ep === ep) ?? null)
    return { sel: (ep ?? 'global') as Selection, issue: target }
  })
  const [sel, setSel] = useState<Selection | null>(back?.sel ?? null)
  const [activeId, setActiveId] = useState<string | null>(back?.issue?.id ?? null)
  const [level, setLevel] = useState<Level | 'all'>('all')
  const [allLevel, setAllLevel] = useState<Level | 'all'>('all')
  const [check, setCheck] = useState<QaCheckKey | null>(null)
  const [showResolved, setShowResolved] = useState(false)
  const [confirmDeliver, setConfirmDeliver] = useState(false)
  const [scrollTo, setScrollTo] = useState<{ id: string; target: 'line' | 'issue' } | null>(back?.issue ? { id: back.issue.id, target: 'issue' } : null)

  const total = project.spec.totalEpisodes
  const report = project.work.qa
  const scripts = project.work.scripts.filter((s) => s.ep <= total).sort((a, b) => a.ep - b.ep)
  const missing = total - scripts.length
  const delivered = project.status === 'delivered'
  const stale = qaStale(project)
  const resolved = new Set(report?.resolved ?? [])
  const fixed = new Set(report?.fixed ?? [])
  const open = report ? report.issues.filter((i) => !resolved.has(i.id)) : []
  const blocks = open.filter((i) => i.level === 'block').length

  // 默认先看有严重问题的一集
  const fallback: Selection | null = (open.find((i) => i.level === 'block' && i.ep !== null)?.ep ?? open.find((i) => i.ep !== null)?.ep ?? scripts[0]?.ep ?? null) as Selection | null
  const current: Selection | null = sel === 'global' || (sel !== null && scripts.some((s) => s.ep === sel)) ? sel : fallback
  const script = typeof current === 'number' ? scripts.find((s) => s.ep === current) : undefined

  useEffect(() => {
    if (!scrollTo) return
    const el = document.getElementById(scrollTo.target === 'line' ? `qa-line-${scrollTo.id}` : `qa-issue-${scrollTo.id}`)
    el?.scrollIntoView({ behavior: 'smooth', block: scrollTo.target === 'line' ? 'center' : 'nearest' })
    setScrollTo(null)
  }, [scrollTo])

  const start = async () => {
    const cur = latestProject(project.id)
    if (!cur) return
    const result = await run('qa', (signal) => runQa(cur, signal))
    if (!result) return
    const ids = new Set(result.issues.map((i) => i.id))
    // 同一个问题重新质检后 id 不变，已处理的标记保留；AI 修稿过却还在的问题重新列出
    const prev = latestProject(project.id)?.work.qa
    const kept = (prev?.resolved ?? []).filter((id) => ids.has(id) && !prev?.fixed?.includes(id))
    const n = result.issues.filter((i) => i.level === 'block' && !kept.includes(i.id)).length
    patchWork(project.id, { qa: { ...result, resolved: kept } }, `质检完成：${result.score} 分，${n} 个严重问题`)
    if (cur.status !== 'delivered') updateProject(project.id, { status: 'reviewing' })
    setSel(null)
    setActiveId(null)
    toast(n ? `质检完成：${result.score} 分，还有 ${n} 个严重问题` : `质检完成：${result.score} 分`)
  }

  const toggleResolved = (id: string) => {
    const qa = latestProject(project.id)?.work.qa
    if (!qa) return
    const undo = qa.resolved.includes(id)
    patchWork(project.id, { qa: { ...qa, resolved: undo ? qa.resolved.filter((x) => x !== id) : [...qa.resolved, id], fixed: (qa.fixed ?? []).filter((x) => x !== id) } })
  }

  /** 选中一个问题：切到所在集，并滚动到对应位置（全部问题里点的：有行定位到行，否则到右侧本集问题） */
  const pick = (i: QaIssue, from: 'list' | 'script' | 'all') => {
    setActiveId(i.id)
    setSel(i.ep ?? 'global')
    if (from !== 'script' && i.lineId) setScrollTo({ id: i.lineId, target: 'line' })
    else if (from !== 'list') {
      // 被级别筛选挡住时放开，让右侧能看到
      if (level !== 'all' && level !== i.level) setLevel('all')
      setScrollTo({ id: i.id, target: 'issue' })
    }
  }

  const exportPackage = () => {
    downloadText(`${project.title || '剧本'}-交付剧本包.txt`, packageText(project, scripts, report))
    toast('剧本包已导出')
  }

  if (!report) {
    return (
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-6 px-6 py-5">
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-semibold text-ink-900">{QA_CHECKS.length} 项自动检查</h3>
            <p className="mt-1 text-[13px] text-ink-500">
              将检查已定稿的 {scripts.length} 集正文（共 {total} 集{missing > 0 ? `，${missing} 集未定稿不在范围内` : ''}），总分按权重加权
            </p>
            <ul className="mt-4 divide-y divide-line rounded-lg border border-line">
              {QA_CHECKS.map((c, i) => (
                <li key={c.key} className="flex items-start gap-3 px-4 py-3">
                  <span className="mt-0.5 text-xs text-ink-400 tabular-nums">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-ink-900">{c.label}</div>
                    <div className="mt-0.5 text-xs text-ink-500">{c.desc}</div>
                  </div>
                  <span className="text-xs text-ink-500 tabular-nums">权重 {Math.round(c.weight * 100)}%</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="w-full rounded-xl border border-line bg-canvas/60 p-4 sm:w-64">
            {running === 'qa' ? (
              <Running />
            ) : (
              <>
                <div className="flex items-center gap-1.5 text-[13px] font-medium">
                  <ClipboardCheck size={14} className="text-brand-500" />
                  质检报告
                </div>
                <p className="mt-1 text-xs leading-5 text-ink-500">问题会定位到集和行：总分下面列出全部问题，中间看标色的定稿，右侧看这一集的问题与修改建议。</p>
                <AiButton size="md" className="mt-3 w-full" disabled={blocked || !scripts.length} onClick={start}>
                  开始质检
                </AiButton>
              </>
            )}
          </div>
        </div>
      </Card>
    )
  }

  // 全部问题：按分项角度与级别筛，严重的在前
  const all = report.issues
    .filter((i) => (!check || i.check === check) && (allLevel === 'all' || i.level === allLevel) && (showResolved || !resolved.has(i.id)))
    .sort((a, b) => byLevel(a, b) || (a.ep ?? 0) - (b.ep ?? 0))
  // 右栏本集问题：先按所选集筛，再统计各级数量，最后按级别筛
  const scoped = report.issues.filter((i) => (current === 'global' ? i.ep === null : i.ep === current) && (showResolved || !resolved.has(i.id)))
  const visible = scoped.filter((i) => level === 'all' || i.level === level).sort(byLevel)
  const resolvedCount = report.issues.filter((i) => resolved.has(i.id)).length
  const showResolvedBox = resolvedCount > 0 && (
    <label className="flex items-center gap-1.5 text-xs text-ink-500">
      <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} className="accent-brand-600" />
      显示已处理（{resolvedCount}）
    </label>
  )

  return (
    <>
      <Card className={clsx('px-5 py-3.5', delivered && 'border-emerald-200')}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-500">
            {delivered && (
              <Badge tone="green">
                <ShieldCheck size={12} />
                已交付
              </Badge>
            )}
            <span>
              质检于 {formatDateTime(report.at)}
              {report.model && ` · ${modelLabel(report.model)} 质检`} · 覆盖 {Object.keys(report.versions).length} 集定稿{missing > 0 ? ` · ${missing} 集未定稿` : ''}
            </span>
            {stale && (
              <span className="flex items-center gap-1 text-amber-700">
                <AlertTriangle size={13} />
                正文在质检后有改动，建议重新质检
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <AiButton variant={stale ? 'primary' : 'secondary'} loading={running === 'qa'} disabled={blocked || !!running} onClick={start}>
              重新质检
            </AiButton>
            <Button variant="secondary" size="sm" onClick={exportPackage}>
              <Download size={14} />
              导出剧本包
            </Button>
            {delivered ? (
              <Button variant="ghost" size="sm" onClick={() => updateProject(project.id, { status: 'reviewing' }, '撤回交付')}>
                <Undo2 size={14} />
                撤回交付
              </Button>
            ) : (
              <Button size="sm" disabled={blocks > 0 || stale || !!running} onClick={() => setConfirmDeliver(true)}>
                <ShieldCheck size={14} />
                确认交付
              </Button>
            )}
          </div>
        </div>
        {!delivered && (blocks > 0 || stale) && (
          <p className="mt-2 text-xs text-ink-500">
            {blocks > 0 ? `还有 ${blocks} 个严重问题：改完正文后重新质检，或确认无误后逐条标记已处理。` : ''}
            {stale ? '正文有改动，需要重新质检后才能交付。' : ''}
          </p>
        )}
      </Card>

      <Summary report={report} open={open} check={check} onCheck={setCheck} level={allLevel} onLevel={setAllLevel}>
        <div id="qa-all" className="border-t border-line">
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5">
            <h3 className="text-[13px] font-semibold text-ink-900">
              全部问题
              <span className="ml-1.5 font-normal text-ink-500">
                {check ? CHECK_LABEL[check] : '全部角度'}
                {allLevel !== 'all' && ` · ${LEVEL[allLevel].label}`} · {all.length} 条
              </span>
            </h3>
            <div className="flex flex-wrap items-center gap-3">
              {(check || allLevel !== 'all') && (
                <button
                  onClick={() => {
                    setCheck(null)
                    setAllLevel('all')
                  }}
                  className="flex items-center gap-1 rounded-md bg-brand-50 px-2 py-1 text-xs text-brand-700 hover:bg-brand-100"
                >
                  清除筛选
                  <X size={12} />
                </button>
              )}
              {showResolvedBox}
            </div>
          </div>
          {all.length ? (
            <ul className="scrollbar-thin max-h-[360px] divide-y divide-line overflow-y-auto border-t border-line">
              {all.map((i) => (
                <IssueRow key={i.id} project={project} issue={i} active={i.id === activeId} done={resolved.has(i.id)} fixed={fixed.has(i.id)} onPick={() => pick(i, 'all')} onToggle={() => toggleResolved(i.id)} />
              ))}
            </ul>
          ) : (
            <p className="flex items-center justify-center gap-1.5 border-t border-line px-4 py-6 text-[13px] text-ink-400">
              <CircleCheck size={14} className="text-emerald-500" />
              {check || allLevel !== 'all' ? '这个角度没有待处理的问题' : '没有待处理的问题'}
            </p>
          )}
        </div>
      </Summary>

      <div className="grid items-start gap-4 md:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_300px]">
        <Card className="scrollbar-thin md:row-span-2 xl:sticky xl:top-stick xl:row-span-1 xl:max-h-stick xl:overflow-y-auto">
          <Directory
            scripts={scripts}
            report={report}
            open={open}
            current={current}
            missing={missing}
            onSelect={(s) => {
              setSel(s)
              setActiveId(null)
            }}
          />
        </Card>

        <div className="min-w-0">
          {current === 'global' ? (
            <GlobalView project={project} issues={open.filter((i) => i.ep === null)} activeId={activeId} onPick={(i) => pick(i, 'script')} />
          ) : script ? (
            <ScriptView
              project={project}
              script={script}
              issues={open.filter((i) => i.ep === script.ep)}
              checked={report.versions[script.ep] !== undefined}
              activeId={activeId}
              onPick={(i) => pick(i, 'script')}
            />
          ) : (
            <Card className="px-6 py-12 text-center text-[13px] text-ink-400">还没有定稿的正文</Card>
          )}
        </div>

        <Card className="scrollbar-thin md:col-start-2 xl:sticky xl:top-stick xl:col-start-3 xl:max-h-stick xl:overflow-y-auto">
          <div className="space-y-2.5 border-b border-line px-4 py-3">
            <h3 className="text-[15px] font-semibold text-ink-900">{current === 'global' ? '全剧问题' : typeof current === 'number' ? `第 ${current} 集问题` : '本集问题'}</h3>
            <div className="flex flex-wrap gap-1">
              {(['all', ...LEVELS] as const).map((l) => {
                const n = l === 'all' ? scoped.length : scoped.filter((i) => i.level === l).length
                return (
                  <button
                    key={l}
                    aria-pressed={level === l}
                    onClick={() => setLevel(l)}
                    className={clsx(
                      'flex h-7 items-center gap-1 rounded-md border px-2 text-xs transition-colors',
                      level === l ? 'border-brand-300 bg-brand-50 font-medium text-brand-700' : 'border-line text-ink-500 hover:text-ink-900',
                    )}
                  >
                    {l !== 'all' && <LevelIcon level={l} size={12} />}
                    {l === 'all' ? '全部' : LEVEL[l].label}
                    <span className="tabular-nums">{n}</span>
                  </button>
                )
              })}
            </div>
            {showResolvedBox}
          </div>
          {visible.length ? (
            <ul className="space-y-2 p-3">
              {visible.map((i) => (
                <IssueItem key={i.id} project={project} issue={i} active={i.id === activeId} done={resolved.has(i.id)} fixed={fixed.has(i.id)} onPick={() => pick(i, 'list')} onToggle={() => toggleResolved(i.id)} />
              ))}
            </ul>
          ) : (
            <p className="flex items-center justify-center gap-1.5 px-4 py-10 text-[13px] text-ink-400">
              <CircleCheck size={14} className="text-emerald-500" />
              {scoped.length ? '这个级别没有问题' : current === 'global' ? '全剧层面没有待处理的问题' : '本集没有待处理的问题'}
            </p>
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={confirmDeliver}
        onClose={() => setConfirmDeliver(false)}
        onConfirm={() => {
          updateProject(project.id, { status: 'delivered' }, `确认交付：${scripts.length} 集定稿，质检 ${report.score} 分`)
          toast('已确认交付，可导出剧本包')
        }}
        title="确认交付？"
        desc={`交付已定稿的 ${scripts.length} 集${missing > 0 ? `（另有 ${missing} 集未定稿）` : ''}，项目状态改为「已交付」；之后仍可撤回。`}
        confirmText="确认交付"
      />
    </>
  )
}
