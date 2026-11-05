import { newId } from '../lib/id'
import { EPISODE_RANGE, EPISODE_SECONDS, VIEWPOINTS } from './constants'
import { MAIN_LINE, STAGES } from './pipeline'
import type { Architecture, Character, EpisodeDraft, Project, ProjectWork, Relation, RhythmFrame, ScriptLine, StageKey } from './types'

export const emptyWork = (): ProjectWork => ({
  video: null,
  source: null,
  breakdown: null,
  architecture: null,
  characters: [],
  relations: [],
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

export function emptyArchitecture(total: number): Architecture {
  const ranges = phaseRanges(total)
  return {
    plan: '',
    formula: '',
    mainLine: MAIN_LINE.map((beat, i) => ({ beat, range: rangeLabel(ranges[i]), content: '' })),
    phaseEnds: null,
    innovations: [],
    status: 'pending',
    structure: '单线叙事',
    viewpoint: VIEWPOINTS[0],
    world: '',
    factions: '',
    background: '',
    highlights: '',
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
  costume: '',
  lookRef: '',
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

/** 人物小传里可以补的项；名字另算，对应对标剧角色由编剧自己选，不补 */
const FILLABLE = ['nameEn', 'gender', 'age', 'profile', 'appearance', 'costume', 'lookRef', 'personality', 'background', 'ability', 'goal', 'desire', 'fear', 'flaw', 'arc', 'notes'] as const

interface Cast {
  characters: Character[]
  relations: Relation[]
}

/**
 * 重新生成人物只补不换：已有人物先按名字、再按定位对上一个生成的人物，只补空着的项；
 * 没对上的生成人物加在后面；关系只加两人之间还没有的。生成结果里的名字换成对上的已有人物名。
 */
export function mergeCast(cur: Cast, gen: Cast): Cast & { added: number; filled: number; linked: number } {
  const taken = new Set<string>()
  const pairs = gen.characters.map((g) => {
    const free = cur.characters.filter((x) => !taken.has(x.id))
    const e = free.find((x) => x.name.trim() === g.name) ?? free.find((x) => x.role === g.role)
    if (e) taken.add(e.id)
    return { g, e }
  })
  const rename = new Map(pairs.flatMap(({ g, e }) => (e?.name.trim() ? [[g.name, e.name.trim()] as const] : [])))
  const swap = (text: string) => [...rename].reduce((t, [from, to]) => t.split(from).join(to), text)

  let filled = 0
  const characters = cur.characters.map((e) => {
    const g = pairs.find((x) => x.e?.id === e.id)?.g
    if (!g) return e
    const next = { ...e, name: e.name.trim() ? e.name : g.name }
    for (const k of FILLABLE) {
      if (e[k].trim() || !g[k].trim()) continue
      next[k] = swap(g[k])
      filled++
    }
    return next
  })
  const added = pairs.filter((x) => !x.e).map(({ g }) => ({ ...g, ...Object.fromEntries(FILLABLE.map((k) => [k, swap(g[k])])) }))

  const pair = (r: Relation) => [r.a, r.b].sort().join('|')
  const have = new Set(cur.relations.map(pair))
  const relations = [...cur.relations]
  for (const r of gen.relations) {
    const next = { ...r, a: rename.get(r.a) ?? r.a, b: rename.get(r.b) ?? r.b, label: swap(r.label) }
    if (have.has(pair(next))) continue
    have.add(pair(next))
    relations.push(next)
  }
  return { characters: [...characters, ...added], relations, added: added.length, filled, linked: relations.length - cur.relations.length }
}

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

/** 本集结尾钩子台词 */
export const hookOf = (script: HasLines) => [...script.lines].reverse().find((l) => l.kind === 'hook')?.zh

/** 上集结尾的钩子：优先取上集正文（定稿或最新草稿）里的钩子台词，其次集纲 */
export const prevHookOf = (work: ProjectWork, ep: number) => {
  const prev = scriptOf(work, ep - 1) ?? latestDraft(work, ep - 1)
  return (prev && hookOf(prev)) || work.outline.find((o) => o.ep === ep - 1)?.hookLine || ''
}

/** 承接：本集开头要接住什么。蓝图里写了用蓝图的；没写时默认接上集结尾的钩子（auto） */
export const carryOf = (work: ProjectWork, ep: number) => {
  const own = blueprintOf(work, ep)?.carry?.trim()
  if (own) return { text: own, auto: false }
  const hook = prevHookOf(work, ep)
  return hook ? { text: hook, auto: true } : undefined
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
      return p.mode !== 'original' && !w.breakdown?.referencedAt ? { reason: '先完成对标剧拆解：拆完后一键引用', to: 'breakdown' } : null
    case 'characters':
      return archGate
    case 'outline':
      return archGate ?? (w.characters.length ? null : { reason: '先生成人物设定', to: 'characters' })
    case 'script':
      return outlineCount(p) ? null : { reason: '先生成情节大纲（至少一批集纲）', to: 'outline' }
    case 'qa':
      return finalCount(p) ? null : { reason: '先在逐集剧本中定稿至少一集，质检只检查正文章节', to: 'script' }
    default:
      return null
  }
}

const clampTo = (n: number, r: { min: number; max: number }) => Math.min(r.max, Math.max(r.min, Math.round(n)))

/** 对标剧的集数与单集时长（勾了「完全按对标剧」时用）：集数取拆解 > 视频转写 > 立项登记；时长取转写出来的各集平均时长，按 10 秒取整 */
export function benchmarkSpec(p: Project): { episodes: number | null; seconds: number | null } {
  const eps = p.work.breakdown?.totalEpisodes || p.work.video?.episodes.length || p.benchmark?.episodes || 0
  const timed = p.work.video?.episodes.filter((e) => e.duration > 0) ?? []
  const avg = timed.length ? timed.reduce((n, e) => n + e.duration, 0) / timed.length : 0
  return { episodes: eps ? clampTo(eps, EPISODE_RANGE) : null, seconds: avg ? clampTo(Math.round(avg / 10) * 10, EPISODE_SECONDS) : null }
}

/** 全剧总览开头的【故事简介】那一段（11/4 起总纲先讲故事）；旧总纲没有这一段就是空 */
export const overviewStory = (overview: string | undefined) => /【故事简介】([^\n【]*)/.exec(overview ?? '')?.[1].trim() ?? ''
