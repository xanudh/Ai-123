import { newId } from '../lib/id'
import { PLAN_EVENT_META, VIEWPOINTS } from './constants'
import { MAIN_LINE, STAGES } from './pipeline'
import type { Architecture, Character, EpisodeDraft, EpisodeScript, Foreshadow, PlanEvent, PlanEventKind, Project, ProjectWork, RhythmFrame, ScriptLine, StageKey } from './types'

export const emptyWork = (): ProjectWork => ({
  video: null,
  source: null,
  breakdown: null,
  architecture: null,
  characters: [],
  relations: [],
  foreshadows: [],
  plot: null,
  outline: [],
  blueprints: [],
  drafts: [],
  scripts: [],
  qa: null,
})

/** 五段式冲突主线默认的结束位置（占比） */
const PHASE_CUTS = [0.1, 0.3, 0.55, 0.85, 1]

/** 冲突主线最少 / 最多几段 */
export const PHASE_LIMIT = { min: 2, max: 8 } as const

/**
 * 按冲突主线把全剧切成 count 段（默认五段），返回每段的 [起, 止] 集。
 * ends 是故事架构里调整过的每段结束集；之后总集数变了，按比例缩放到新的总集数。
 * 不是五段时默认均分。
 */
export function phaseRanges(total: number, ends?: number[] | null, count: number = PHASE_CUTS.length): [number, number][] {
  const n = Math.max(total, 1)
  const last = ends?.length === count ? ends[ends.length - 1] : 0
  const base = count === PHASE_CUTS.length ? PHASE_CUTS : Array.from({ length: count }, (_, i) => (i + 1) / count)
  const cuts = ends && last > 0 ? ends.map((e) => e / last) : base
  let from = 1
  return cuts.map((cut, i) => {
    const left = cuts.length - 1 - i
    const start = Math.min(from, n)
    const end = Math.min(Math.max(Math.round(cut * n), start), Math.max(n - left, start))
    from = end + 1
    return [start, end]
  })
}

/** 冲突主线有几段：故事架构里增删过就按实际段数 */
export const phaseCount = (p: Project) => p.work.architecture?.mainLine.length || MAIN_LINE.length

/** 项目当前的分段：故事架构里调整过就按调整后的 */
export const projectPhases = (p: Project) => phaseRanges(p.spec.totalEpisodes, p.work.architecture?.phaseEnds, phaseCount(p))

/** 默认段名：前五段沿用五段式，多出来的按序号 */
export const defaultPhaseName = (i: number) => MAIN_LINE[i] ?? `第 ${i + 1} 段`

/** 冲突主线各段的名称：故事架构里可以改名，没填时用默认段名 */
export const phaseNames = (p: Project) => Array.from({ length: phaseCount(p) }, (_, i) => p.work.architecture?.mainLine[i]?.beat.trim() || defaultPhaseName(i))

/** 段数不是五段时，第 i 段对应五段式模板的哪一段（首段对开局、末段对高潮） */
export const templatePhase = (i: number, count: number) => (count === MAIN_LINE.length ? i : Math.round((i * (MAIN_LINE.length - 1)) / Math.max(1, count - 1)))

/** 第 ep 集处在五段式主线的第几段（0 起） */
export function phaseOf(ep: number, ranges: [number, number][]) {
  const i = ranges.findIndex(([, to]) => ep <= to)
  return i < 0 ? ranges.length - 1 : i
}

export const rangeLabel = ([from, to]: [number, number]) => (from === to ? `第 ${from} 集` : `第 ${from}–${to} 集`)

/** 伏笔 / 叙事线索连续多少集没推进就提醒；0 表示不提醒（默认） */
export const SILENCE_DEFAULT = 0

export function emptyArchitecture(total: number): Architecture {
  const ranges = phaseRanges(total)
  return {
    idea: '',
    plan: '',
    formula: '',
    mainLine: MAIN_LINE.map((beat, i) => ({ beat, range: rangeLabel(ranges[i]), content: '' })),
    phaseEnds: null,
    innovations: [],
    status: 'pending',
    structure: '单线叙事',
    viewpoint: VIEWPOINTS[0],
    silenceThreshold: SILENCE_DEFAULT,
    world: '',
    goldenFinger: '',
    heroSetup: '',
    writingRules: '',
    references: '',
  }
}

export const newCharacter = (patch: Partial<Character> = {}): Character => ({
  id: newId(),
  name: '',
  nameEn: '',
  role: '配角',
  gender: '',
  age: '',
  profile: '',
  appearance: '',
  personality: '',
  background: '',
  ability: '',
  goal: '',
  desire: '',
  fear: '',
  flaw: '',
  arc: '',
  notes: '',
  benchmark: '',
  ...patch,
})

export const newForeshadow = (patch: Partial<Foreshadow> = {}): Foreshadow => ({
  id: newId(),
  type: '人物秘密',
  title: '',
  content: '',
  plantEp: 1,
  payoffEp: 2,
  events: [],
  ...patch,
})

export type RelationGroup = 'love' | 'family' | 'hostile' | 'ally'

/** 关系类型归类：关系图按类别配色 */
export function relationGroup(kind: string): RelationGroup {
  if (/敌|仇|对手|假/.test(kind)) return 'hostile'
  if (/爱|恋|夫|妻|前任|伴侣|未婚|青梅|暗恋|追求|婚/.test(kind)) return 'love'
  if (/父|母|兄|姐|妹|弟|长辈|亲/.test(kind)) return 'family'
  return 'ally'
}

/** 从关系备注推断关系类型（旧数据迁移、对标剧拆解用）；推断不出时留空 */
export function inferRelationKind(label: string): string {
  const rules: [RegExp, string][] = [
    [/宿敌|陷害/, '宿敌'],
    [/伴侣|感情|恋|追回/, '恋人'],
    [/利用|纠缠|觊觎/, '情敌'],
    [/知情人|引路人|长辈/, '长辈'],
    [/盟友|阵营/, '盟友'],
  ]
  return rules.find(([re]) => re.test(label))?.[1] ?? ''
}

/** 把对标剧的节奏框架按集数等比映射到本项目 */
export function scaleRhythm(rhythm: RhythmFrame, from: number, to: number): RhythmFrame {
  const s = (ep: number) => Math.min(to, Math.max(1, Math.round((ep * to) / Math.max(from, 1))))
  const list = (eps: number[]) => [...new Set(eps.map(s))].sort((a, b) => a - b)
  return { paywalls: list(rhythm.paywalls), twists: list(rhythm.twists), climaxFrom: s(rhythm.climaxFrom) }
}

const short = (text: string, n = 16) => (text.length > n ? `${text.slice(0, n)}…` : text)

/* ---------------------------------- 剧本 ---------------------------------- */

/** 正文章节（定稿） */
export const scriptOf = (work: ProjectWork, ep: number) => work.scripts.find((s) => s.ep === ep)

/** 某集草稿箱里的全部版本，新版本在前 */
export const draftsOf = (work: ProjectWork, ep: number) => work.drafts.filter((d) => d.ep === ep).sort((a, b) => b.version - a.version)

export const latestDraft = (work: ProjectWork, ep: number): EpisodeDraft | undefined => draftsOf(work, ep)[0]

export const blueprintOf = (work: ProjectWork, ep: number) => work.blueprints.find((b) => b.ep === ep)

export const draftLabel = (d: EpisodeDraft) => `草稿_v${d.version}`

interface HasLines {
  lines: ScriptLine[]
}

/** 剧本字数：中文行去掉空白后的字符数 */
/** 去掉正文里的 Markdown 行内标记（**加粗** / *斜体*），用于计数、导出与只读展示 */
export const plainText = (zh: string) => zh.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1')

export const wordCount = (script: HasLines) => script.lines.reduce((n, l) => n + plainText(l.zh).replace(/\s/g, '').length, 0)

export const scriptText = (script: HasLines) => script.lines.map((l) => plainText(l.zh)).join('\n')

/** 定稿集的名字：第 3 集 · 定稿 v2（版本号取自来源草稿） */
export const finalLabel = (p: Project, s: EpisodeScript) => {
  const d = p.work.drafts.find((x) => x.id === s.draftId)
  return `第 ${s.ep} 集 · 定稿${d ? ` v${d.version}` : ''}`
}

/** 定稿事件的证据必须逐字摘自这一集定稿（不计加粗 / 斜体标记与首尾空白） */
export const evidenceIn = (script: HasLines, quote: string) => {
  const q = quote.trim()
  return !!q && scriptText(script).includes(q)
}

/** 本集结尾钩子台词 */
export const hookOf = (script: HasLines) => [...script.lines].reverse().find((l) => l.kind === 'hook')?.zh

/** 上集结尾的钩子：优先取上集正文（定稿或最新草稿）里的钩子台词，其次集纲 */
export const prevHookOf = (work: ProjectWork, ep: number) => {
  const prev = scriptOf(work, ep - 1) ?? latestDraft(work, ep - 1)
  return (prev && hookOf(prev)) || work.outline.find((o) => o.ep === ep - 1)?.hookLine || ''
}

/** 承接：本集开头要接住什么（上集遗留或前几集的伏笔）。蓝图里写了用蓝图的；没写时默认接上集结尾的钩子（auto） */
export const carryOf = (work: ProjectWork, ep: number) => {
  const own = blueprintOf(work, ep)?.carry?.trim()
  if (own) return { text: own, auto: false }
  const hook = prevHookOf(work, ep)
  return hook ? { text: hook, auto: true } : undefined
}

/* ---------------------------------- 伏笔 ---------------------------------- */

/** 伏笔在正文中的检索词：意图去掉空白后的前 6 个字 */
export const foreshadowKey = (f: Foreshadow) => f.content.replace(/\s/g, '').slice(0, 6)

export const foreshadowName = (f: Foreshadow) => f.title.trim() || short(f.content)

export type ForeshadowStatus = '已计划' | '已埋设' | '已回收'

export interface ForeshadowTrace {
  status: ForeshadowStatus
  /** 确认过的第一次埋设 / 开始集 */
  plantedIn: number | null
  /** 确认过的回收 / 结束集 */
  paidIn: number | null
  /** 最近一次确认事件所在的集 */
  lastEp: number | null
}

/** 伏笔进度只看编剧确认过的定稿事件 */
export function traceForeshadow(f: Foreshadow): ForeshadowTrace {
  const eps = (kind: PlanEventKind) => f.events.filter((e) => e.kind === kind).map((e) => e.ep)
  const plants = eps('plant')
  const payoffs = eps('payoff')
  const plantedIn = plants.length ? Math.min(...plants) : null
  const paidIn = payoffs.length ? Math.min(...payoffs) : null
  const lastEp = f.events.length ? Math.max(...f.events.map((e) => e.ep)) : null
  return { status: paidIn !== null ? '已回收' : lastEp !== null ? '已埋设' : '已计划', plantedIn, paidIn, lastEp }
}

/** 已埋设的伏笔距最近一次推进过了几集（按已定稿的最新集算） */
export const silenceOf = (trace: ForeshadowTrace, latestEp: number) =>
  trace.status === '已埋设' && trace.lastEp !== null ? Math.max(0, latestEp - trace.lastEp) : 0

/** 计划的埋设 / 回收集已经写过去了还没确认：哪一步、计划在第几集、超出几集 */
export interface LateStep {
  kind: 'plant' | 'payoff'
  ep: number
  by: number
}

/** 写到第 latestEp 集时超期（不含正好到期那一集）的一步；用来让编剧决定这条计划还要不要 */
export function lateStep(f: Foreshadow, trace: ForeshadowTrace, latestEp: number): LateStep | null {
  if (trace.status === '已回收') return null
  const step: LateStep = trace.status === '已计划' ? { kind: 'plant', ep: f.plantEp, by: latestEp - f.plantEp } : { kind: 'payoff', ep: f.payoffEp, by: latestEp - f.payoffEp }
  return step.by > 0 ? step : null
}

/** 写到第 latestEp 集（已定稿）时的提醒：到期没埋、到期没收、沉寂太久 */
export function foreshadowAlert(f: Foreshadow, trace: ForeshadowTrace, latestEp: number, threshold: number): string | null {
  if (trace.status === '已回收' || latestEp === 0) return null
  // 到期当集还没发生记“还没…”，之后每多写一集记“已超出 N 集”
  const late = (ep: number, what: string) => (latestEp === ep ? `计划第 ${ep} 集${what}，还没${what}` : `计划第 ${ep} 集${what}，已超出 ${latestEp - ep} 集`)
  if (trace.status === '已计划') return f.plantEp <= latestEp ? late(f.plantEp, '埋设') : null
  if (f.payoffEp <= latestEp) return late(f.payoffEp, '回收')
  const silence = silenceOf(trace, latestEp)
  return threshold > 0 && silence >= threshold ? `已沉寂 ${silence} 集，建议安排一次呼应` : null
}

const EVENT_ORDER = Object.keys(PLAN_EVENT_META) as PlanEventKind[]

/** 事件按集数排，同一集按 埋设 → 呼应 → 回收 */
export const sortEvents = (events: PlanEvent[]) => [...events].sort((a, b) => a.ep - b.ep || EVENT_ORDER.indexOf(a.kind) - EVENT_ORDER.indexOf(b.kind))

export interface EventCandidate {
  ep: number
  kind: PlanEventKind
  text: string
}

/** 在定稿正文里找可能的推进：命中检索词的行；按先后给出建议的事件类型，已确认过的集跳过 */
export function eventCandidates(f: Foreshadow, scripts: EpisodeScript[]): EventCandidate[] {
  const keys = [foreshadowKey(f), f.title.replace(/\s/g, '').slice(0, 4)].filter((k) => k.length >= 2)
  if (!keys.length) return []
  let planted = f.events.length > 0
  const out: EventCandidate[] = []
  for (const s of [...scripts].sort((a, b) => a.ep - b.ep)) {
    if (f.events.some((e) => e.ep === s.ep)) {
      planted = true
      continue
    }
    const line = s.lines.find((l) => keys.some((k) => l.zh.replace(/\s/g, '').includes(k)))
    if (!line) continue
    out.push({ ep: s.ep, kind: !planted ? 'plant' : s.ep >= f.payoffEp ? 'payoff' : 'echo', text: line.zh })
    planted = true
  }
  return out
}

/** 计划本身的问题：集数越界或顺序颠倒 */
export function foreshadowIssue(f: Foreshadow, total: number) {
  if (!f.title.trim() && !f.content.trim()) return '标题与意图未填写'
  if (f.plantEp < 1 || f.plantEp > total) return `埋设 / 开始集超出 1–${total} 集`
  if (f.payoffEp < 1 || f.payoffEp > total) return `回收 / 结束集超出 1–${total} 集`
  if (f.payoffEp <= f.plantEp) return '回收 / 结束集必须晚于埋设 / 开始集'
  return null
}

/* ---------------------------------- 质检 ---------------------------------- */

/** 质检后正文有改动（新定稿、改稿或删除）时，报告需要重新生成 */
export function qaStale(p: Project) {
  const qa = p.work.qa
  if (!qa) return false
  const scripts = p.work.scripts.filter((s) => s.ep <= p.spec.totalEpisodes)
  return scripts.length !== Object.keys(qa.versions).length || scripts.some((s) => qa.versions[s.ep] !== s.updatedAt)
}

/* ---------------------------------- 环节进度 ---------------------------------- */

export type StageState = 'done' | 'active' | 'todo' | 'locked'

export const outlineCount = (p: Project) => p.work.outline.filter((o) => o.ep <= p.spec.totalEpisodes).length

export const finalCount = (p: Project) => p.work.scripts.filter((s) => s.ep <= p.spec.totalEpisodes).length

/** 已生成但还没单独审核的付费卡点集 */
export const pendingPaywalls = (p: Project) =>
  p.work.outline.filter((o) => o.ep <= p.spec.totalEpisodes && p.rhythm.paywalls.includes(o.ep) && !o.approved)

export function stageState(p: Project, key: StageKey): StageState {
  if (STAGES[key].phase) return 'locked'
  const w = p.work
  const total = p.spec.totalEpisodes
  switch (key) {
    case 'overview':
      return 'done'
    case 'video':
      return w.video?.merged?.importedAt && w.source ? 'done' : w.video ? 'active' : 'todo'
    case 'breakdown':
      return w.breakdown?.referencedAt ? 'done' : w.source || w.breakdown ? 'active' : 'todo'
    case 'architecture':
      return w.architecture?.status === 'approved' ? 'done' : w.architecture ? 'active' : 'todo'
    case 'characters':
      return w.characters.length ? 'done' : 'todo'
    case 'foreshadow':
      return w.foreshadows.length ? 'done' : 'todo'
    case 'outline': {
      const n = outlineCount(p)
      return n >= total && pendingPaywalls(p).length === 0 ? 'done' : n || w.plot ? 'active' : 'todo'
    }
    case 'state':
    case 'script': {
      const n = finalCount(p)
      return n >= total ? 'done' : n || (key === 'script' && (w.drafts.length || w.blueprints.length)) ? 'active' : 'todo'
    }
    case 'qa':
      return p.status === 'delivered' ? 'done' : w.qa ? 'active' : 'todo'
    default:
      return 'todo'
  }
}

export interface StageGate {
  reason: string
  to: StageKey
}

/** 进入某环节前需要先完成的上游环节；null 表示可以开始 */
export function stageGate(p: Project, key: StageKey): StageGate | null {
  const w = p.work
  const archGate: StageGate | null = w.architecture?.status === 'approved' ? null : { reason: '先在故事架构中确认架构', to: 'architecture' }
  switch (key) {
    case 'architecture':
      return p.mode !== 'original' && !w.breakdown?.referencedAt ? { reason: '先完成对标剧拆解：四个板块审核通过后一键引用', to: 'breakdown' } : null
    case 'characters':
      return archGate
    case 'outline':
      return archGate ?? (w.characters.length ? null : { reason: '先生成人物设定', to: 'characters' })
    case 'foreshadow':
      return (
        archGate ??
        (w.characters.length ? null : { reason: '先生成人物设定', to: 'characters' }) ??
        (outlineCount(p) ? null : { reason: '先确定情节大纲（至少一批集纲）：大纲定下来才能埋伏笔', to: 'outline' })
      )
    case 'script':
      return outlineCount(p) ? null : { reason: '先生成情节大纲（至少一批集纲）', to: 'outline' }
    case 'qa':
      return finalCount(p) ? null : { reason: '先在逐集剧本中定稿至少一集，质检只检查正文章节', to: 'script' }
    default:
      return null
  }
}
