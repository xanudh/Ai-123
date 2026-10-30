/**
 * 剧本状态库：从人物设定、伏笔计划与正文章节（定稿）汇总出的“户口本”。
 * 不单独存储——每次都由最新定稿重新计算；草稿不计入，定稿后自动更新。
 */
import { PLAN_EVENT_META } from './constants'
import { placeOf } from './scriptFormat'
import type { CharacterRole, EpisodeScript, Foreshadow, Project, Relation } from './types'
import { SILENCE_DEFAULT, blueprintOf, carryOf, foreshadowAlert, foreshadowName, latestDraft, lateStep, scriptOf, silenceOf, traceForeshadow } from './work'
import type { ForeshadowTrace, LateStep } from './work'

export interface CharacterEntry {
  name: string
  nameEn: string
  /** null 表示剧本里出现、但没在人物设定中登记 */
  role: CharacterRole | null
  firstEp: number | null
  lastEp: number | null
  episodes: number
  state: string
  stateEp: number | null
}

export interface RelationEntry extends Relation {
  /** 最近一次同场（都有台词）的集 */
  lastTogether: number | null
}

export interface SceneEntry {
  place: string
  episodes: number[]
}

export interface ForeshadowEntry extends ForeshadowTrace {
  item: Foreshadow
  /** 距最近一次推进过了几集 */
  silence: number
  /** 到期没埋、到期没收或沉寂太久的提醒 */
  overdue: string | null
  /** 超期没确认的一步：可以确认定稿、改期或删掉这条计划 */
  late: LateStep | null
}

export interface EpisodeLog {
  ep: number
  title: string
  changes: string[]
}

export interface StateLibrary {
  /** 已定稿的最大集数 */
  latestEp: number
  characters: CharacterEntry[]
  relations: RelationEntry[]
  scenes: SceneEntry[]
  foreshadows: ForeshadowEntry[]
  log: EpisodeLog[]
}

const speakersOf = (s: EpisodeScript) => [...new Set(s.lines.flatMap((l) => (l.kind === 'dialogue' && l.speaker ? [l.speaker] : [])))]

const short = (text: string) => (text.length > 16 ? `${text.slice(0, 16)}…` : text)

export const silenceThreshold = (p: Project) => p.work.architecture?.silenceThreshold ?? SILENCE_DEFAULT

/** 用 ep 之前（不含）的正文章节汇总状态库；不传 ep 时汇总全部 */
export function buildState(p: Project, beforeEp = Infinity): StateLibrary {
  const scripts = p.work.scripts
    .filter((s) => s.ep <= p.spec.totalEpisodes && s.ep < beforeEp)
    .sort((a, b) => a.ep - b.ep)
  const latestEp = scripts.at(-1)?.ep ?? 0
  const threshold = silenceThreshold(p)

  const chars = new Map<string, CharacterEntry>()
  const entry = (name: string) => {
    let c = chars.get(name)
    if (!c) {
      c = { name, nameEn: '', role: null, firstEp: null, lastEp: null, episodes: 0, state: '', stateEp: null }
      chars.set(name, c)
    }
    return c
  }
  for (const c of p.work.characters) Object.assign(entry(c.name), { nameEn: c.nameEn, role: c.role })

  const scenes = new Map<string, number[]>()
  const together = new Map<string, number>()
  // 只看 beforeEp 之前确认过的事件
  const foreshadows: ForeshadowEntry[] = p.work.foreshadows.map((f) => {
    const item = { ...f, events: f.events.filter((e) => e.ep < beforeEp) }
    const trace = traceForeshadow(item)
    return { item: f, ...trace, silence: silenceOf(trace, latestEp), overdue: foreshadowAlert(item, trace, latestEp, threshold), late: lateStep(item, trace, latestEp) }
  })
  const log: EpisodeLog[] = []

  for (const s of scripts) {
    const speakers = speakersOf(s)
    const fresh: string[] = []
    for (const name of speakers) {
      const c = entry(name)
      if (c.firstEp === null) {
        c.firstEp = s.ep
        fresh.push(name)
      }
      c.lastEp = s.ep
      c.episodes++
    }
    for (const [name, state] of Object.entries(s.states)) Object.assign(entry(name), { state, stateEp: s.ep })
    for (const r of p.work.relations) if (speakers.includes(r.a) && speakers.includes(r.b)) together.set(`${r.a}|${r.b}`, s.ep)
    for (const l of s.lines) {
      if (l.kind !== 'scene') continue
      const place = placeOf(l.zh)
      const eps = scenes.get(place) ?? []
      if (!eps.includes(s.ep)) eps.push(s.ep)
      scenes.set(place, eps)
    }

    const changes: string[] = []
    if (fresh.length) changes.push(`新出场：${fresh.join('、')}`)
    for (const [name, state] of Object.entries(s.states)) changes.push(`${name} → ${state}`)
    for (const f of p.work.foreshadows) {
      for (const e of f.events) if (e.ep === s.ep) changes.push(`${PLAN_EVENT_META[e.kind].label}「${foreshadowName(f)}」`)
    }
    log.push({ ep: s.ep, title: s.title, changes })
  }

  return {
    latestEp,
    // 已登记的在前，按首次出场排序
    characters: [...chars.values()].sort((a, b) => Number(a.role === null) - Number(b.role === null) || (a.firstEp ?? 1e9) - (b.firstEp ?? 1e9)),
    relations: p.work.relations.map((r) => ({ ...r, lastTogether: together.get(`${r.a}|${r.b}`) ?? null })),
    scenes: [...scenes.entries()].map(([place, episodes]) => ({ place, episodes })).sort((a, b) => b.episodes.length - a.episodes.length),
    foreshadows,
    log: log.reverse(),
  }
}

/* ---------------------------------- 写作前检查 ---------------------------------- */

export interface PreCheck {
  /** block：不能生成；warn：可以生成但要注意；info：本集要用到的状态 */
  level: 'block' | 'warn' | 'info'
  text: string
}

/** 写第 ep 集前对照状态库检查：集纲与蓝图、上一集定稿、伏笔到期与逾期、钩子承接、人物最新状态 */
export function preWriteCheck(p: Project, ep: number): PreCheck[] {
  const w = p.work
  const checks: PreCheck[] = []
  const outline = w.outline.find((o) => o.ep === ep)
  const blueprint = blueprintOf(w, ep)
  if (!outline && !blueprint) checks.push({ level: 'block', text: `第 ${ep} 集还没有集纲，先到情节大纲生成` })
  // 先有蓝图再写作：蓝图是写稿的直接依据
  else if (!blueprint) checks.push({ level: 'block', text: `第 ${ep} 集还没有蓝图，先生成分集蓝图` })
  if (ep > 1 && !scriptOf(w, ep - 1)) {
    checks.push(
      latestDraft(w, ep - 1)
        ? { level: 'warn', text: `第 ${ep - 1} 集还没定稿：本集会参考它的最新草稿，定稿后状态库才会更新` }
        : { level: 'block', text: `第 ${ep - 1} 集还没写，需按顺序逐集创作` },
    )
  }
  if (scriptOf(w, ep)) checks.push({ level: 'info', text: '本集已有正文章节，新草稿定稿后会替换正文' })
  if (outline && p.rhythm.paywalls.includes(ep) && !outline.approved) checks.push({ level: 'warn', text: '本集是付费卡点，集纲还没单独审核' })
  if (blueprint?.guidance.trim()) checks.push({ level: 'info', text: `作者微操指导（最高优先级）：${short(blueprint.guidance.trim())}` })

  const lib = buildState(p, ep)
  for (const f of lib.foreshadows) {
    const name = `「${foreshadowName(f.item)}」`
    if (f.item.plantEp === ep) checks.push({ level: 'info', text: `本集需埋设${name}` })
    if (f.item.payoffEp === ep) {
      checks.push(
        f.plantedIn !== null
          ? { level: 'info', text: `本集需回收${name}（第 ${f.plantedIn} 集已埋设）` }
          : { level: 'warn', text: `本集计划回收${name}，但前文还没确认埋设` },
      )
    }
    if (f.overdue) checks.push({ level: 'warn', text: `${name}${f.overdue}` })
  }

  const carry = carryOf(w, ep)
  if (carry) checks.push({ level: 'info', text: carry.auto ? `开场承接上集钩子：“${carry.text}”` : `开场承接：${carry.text}` })
  for (const c of lib.characters.filter((c) => c.role && c.state).slice(0, 4)) {
    checks.push({ level: 'info', text: `${c.name}（第 ${c.stateEp} 集后）：${c.state}` })
  }
  return checks
}
