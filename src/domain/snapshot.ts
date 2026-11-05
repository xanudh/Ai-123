/**
 * 状态库侧栏的快照：按选中的层级（本集 / 本阶段 / 全剧）算“截至这里”的状态。
 * 与状态库一样不单独存储；全剧状态只认定稿，本集快照没有定稿时按草稿或集纲推断并注明。
 */
import { nodeKind } from './rhythm'
import { placeOf } from './scriptFormat'
import { buildState } from './state'
import type { SceneEntry } from './state'
import type { CharacterRole, EpisodeDraft, Project, Relation, ScriptLine } from './types'
import { blueprintOf, draftLabel, draftsOf, hookOf, latestDraft, phaseNames, phaseOf, projectPhases, scriptOf } from './work'

/** 页面告诉侧栏当前选中的层级 */
export type StateFocus = { kind: 'ep'; ep: number; draftId?: string } | { kind: 'phase'; index: number } | { kind: 'all' }

/** 本集内容的依据：定稿 / 草稿 / 集纲与蓝图 / 什么都没有 */
export type Basis = 'final' | 'draft' | 'outline' | 'none'

export interface CastEntry {
  name: string
  role: CharacterRole | null
  /** 截至此处的状态 */
  state: string
  stateEp: number | null
  /** 状态在本集 / 本段发生了变化 */
  changed: boolean
  /** 本集首次出场 */
  first: boolean
  /** 本阶段出场集数（本集快照里不用） */
  episodes: number
}

export interface SceneUse {
  place: string
  /** 之前哪些定稿集用过 */
  before: number[]
}

export interface EpisodeSnapshot {
  ep: number
  phase: number
  phaseName: string
  range: [number, number]
  /** 节奏定位：开场钩子 / 首付费 / 付费卡点 / 大反转 / 结局高潮 */
  node: string | null
  title: string
  event: string
  hookIn: string
  hookOut: string
  basis: Basis
  basisLabel: string
  draft: EpisodeDraft | null
  cast: CastEntry[]
  relations: Relation[]
  scenes: SceneUse[]
}

export interface PhaseSnapshot {
  index: number
  name: string
  range: [number, number]
  rough: string
  size: number
  outlined: number
  finals: number
  nodes: { ep: number; label: string }[]
  cast: CastEntry[]
  scenes: SceneEntry[]
}

const eps = ([a, b]: [number, number]) => Array.from({ length: b - a + 1 }, (_, i) => a + i)

export function nodeLabel(p: Project, ep: number): string | null {
  const kind = nodeKind(ep, p.rhythm)
  if (kind === 'paywall') return ep === p.rhythm.paywalls[0] ? '首付费' : '付费卡点'
  if (kind === 'twist') return '大反转'
  if (kind === 'climax') return '结局高潮'
  return ep === 1 ? '开场钩子' : null
}

const speakers = (lines: ScriptLine[]) => lines.flatMap((l) => (l.kind === 'dialogue' && l.speaker ? [l.speaker] : []))

/** 文本里提到的已登记人物 */
const mentioned = (p: Project, text: string) => p.work.characters.map((c) => c.name).filter((n) => n.trim() && text.includes(n))

/* ---------------------------------- 本集 ---------------------------------- */

export function episodeSnapshot(p: Project, ep: number, draftId?: string): EpisodeSnapshot {
  const w = p.work
  const ranges = projectPhases(p)
  const phase = phaseOf(ep, ranges)
  const outline = w.outline.find((o) => o.ep === ep)
  const blueprint = blueprintOf(w, ep)
  const final = scriptOf(w, ep)
  // 打开的是某个草稿就按这份草稿；否则有定稿按定稿，再否则按最新草稿
  const viewed = draftId ? w.drafts.find((d) => d.id === draftId && d.ep === ep) : undefined
  const draft = viewed && viewed.status !== 'final' ? viewed : final ? undefined : latestDraft(w, ep)
  const basis: Basis = draft ? 'draft' : final ? 'final' : outline || blueprint ? 'outline' : 'none'
  const lines = draft?.lines ?? final?.lines ?? []
  const states = draft?.states ?? final?.states ?? {}

  // 截至本集：定稿算到本集为止；本集没定稿时，前面的定稿 + 本集的草稿状态
  const lib = buildState(p, basis === 'final' ? ep + 1 : ep)
  const known = new Map(lib.characters.map((c) => [c.name, c]))
  const outlineText = [outline?.title, outline?.event, outline?.hookLine, blueprint?.cast, blueprint?.goal, blueprint?.conflict, blueprint?.hook].filter(Boolean).join('\n')
  const names =
    basis === 'final' || basis === 'draft'
      ? [...speakers(lines), ...Object.keys(states), ...mentioned(p, lines.map((l) => l.zh).join('\n'))]
      : [...(blueprint?.cast.split(/[,，、;；\s]+/) ?? []), ...mentioned(p, outlineText)]
  const cast: CastEntry[] = [...new Set(names.map((n) => n.trim()).filter(Boolean))].map((name) => {
    const c = known.get(name)
    const role = c?.role ?? w.characters.find((x) => x.name === name)?.role ?? null
    const own = states[name]
    return {
      name,
      role,
      state: own ?? c?.state ?? '',
      stateEp: own ? ep : (c?.stateEp ?? null),
      changed: own !== undefined,
      first: basis === 'final' ? c?.firstEp === ep : !c?.firstEp,
      episodes: 0,
    }
  })
  cast.sort((a, b) => Number(a.role === null) - Number(b.role === null))
  const castNames = new Set(cast.map((c) => c.name))

  const before = w.scripts.filter((s) => s.ep < ep)
  const places = [...new Set(lines.filter((l) => l.kind === 'scene').map((l) => placeOf(l.zh)))]
  const scenes = places.map((place) => ({
    place,
    before: before.filter((s) => s.lines.some((l) => l.kind === 'scene' && placeOf(l.zh) === place)).map((s) => s.ep).sort((a, b) => a - b),
  }))

  const prev = scriptOf(w, ep - 1) ?? latestDraft(w, ep - 1)
  const hookIn = (prev && hookOf(prev)) || w.outline.find((o) => o.ep === ep - 1)?.hookLine || ''
  const hookOut = (lines.length ? hookOf({ lines }) : '') || outline?.hookLine || blueprint?.hook || ''
  const versions = draftsOf(w, ep)

  return {
    ep,
    phase,
    phaseName: phaseNames(p)[phase] ?? '',
    range: ranges[phase],
    node: nodeLabel(p, ep),
    title: final?.title || draft?.title || outline?.title || blueprint?.title || '',
    event: outline?.event || blueprint?.conflict || '',
    hookIn,
    hookOut,
    basis,
    basisLabel:
      basis === 'final' ? '已定稿'
      : basis === 'draft' ? `${draftLabel(draft!)} · 未定稿，不计入全剧状态`
      : basis === 'outline' ? (versions.length ? '按集纲推断' : '还没有正文，按集纲与蓝图推断')
      : '还没有集纲',
    draft: draft ?? null,
    cast,
    relations: w.relations.filter((r) => castNames.has(r.a) && castNames.has(r.b)),
    scenes,
  }
}

/* ---------------------------------- 本阶段 ---------------------------------- */

export function phaseSnapshot(p: Project, index: number): PhaseSnapshot {
  const w = p.work
  const ranges = projectPhases(p)
  const range = ranges[Math.min(index, ranges.length - 1)]
  const [a, b] = range
  const list = eps(range)
  const finals = w.scripts.filter((s) => s.ep >= a && s.ep <= b).sort((x, y) => x.ep - y.ep)
  const outlines = w.outline.filter((o) => o.ep >= a && o.ep <= b)

  // 人物：定稿里有台词的按出场集数；还没定稿的集按集纲里提到的人物补上
  const lib = buildState(p, b + 1)
  const known = new Map(lib.characters.map((c) => [c.name, c]))
  const count = new Map<string, number>()
  for (const s of finals) for (const n of new Set(speakers(s.lines))) count.set(n, (count.get(n) ?? 0) + 1)
  const written = new Set(finals.map((s) => s.ep))
  for (const o of outlines) if (!written.has(o.ep)) for (const n of mentioned(p, `${o.title}\n${o.event}\n${o.hookLine}`)) if (!count.has(n)) count.set(n, 0)
  const cast: CastEntry[] = [...count.entries()]
    .map(([name, episodes]) => {
      const c = known.get(name)
      const inRange = c?.stateEp != null && c.stateEp >= a
      return {
        name,
        role: c?.role ?? w.characters.find((x) => x.name === name)?.role ?? null,
        state: c?.state ?? '',
        stateEp: c?.stateEp ?? null,
        changed: inRange,
        first: c?.firstEp != null && c.firstEp >= a,
        episodes,
      }
    })
    .sort((x, y) => Number(x.role === null) - Number(y.role === null) || y.episodes - x.episodes)

  const sceneMap = new Map<string, number[]>()
  for (const s of finals) {
    for (const l of s.lines) {
      if (l.kind !== 'scene') continue
      const place = placeOf(l.zh)
      const at = sceneMap.get(place) ?? []
      if (!at.includes(s.ep)) at.push(s.ep)
      sceneMap.set(place, at)
    }
  }

  return {
    index,
    name: phaseNames(p)[index] ?? '',
    range,
    rough: w.plot?.phases[index] ?? '',
    size: list.length,
    outlined: outlines.length,
    finals: finals.length,
    nodes: list.flatMap((ep) => {
      const label = nodeLabel(p, ep)
      return label && label !== '结局高潮' ? [{ ep, label }] : []
    }),
    cast,
    scenes: [...sceneMap.entries()].map(([place, episodes]) => ({ place, episodes })).sort((x, y) => y.episodes.length - x.episodes.length),
  }
}

/* ---------------------------------- 全剧 ---------------------------------- */

export function overallSnapshot(p: Project) {
  const total = p.spec.totalEpisodes
  const lib = buildState(p)
  const ranges = projectPhases(p)
  const outlined = p.work.outline.filter((o) => o.ep <= total).length
  const finals = p.work.scripts.filter((s) => s.ep <= total).length
  const drafting = new Set(p.work.drafts.filter((d) => d.status === 'draft' && !scriptOf(p.work, d.ep)).map((d) => d.ep)).size
  return {
    total,
    outlined,
    finals,
    drafting,
    latestEp: lib.latestEp,
    phase: lib.latestEp ? phaseOf(lib.latestEp, ranges) : 0,
    phaseName: phaseNames(p)[lib.latestEp ? phaseOf(lib.latestEp, ranges) : 0] ?? '',
    lib,
  }
}
