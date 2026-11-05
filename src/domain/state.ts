/**
 * 剧本状态库：从人物设定与正文章节（定稿）汇总出的“户口本”。
 * 不单独存储——每次都由最新定稿重新计算；草稿不计入，定稿后自动更新。
 */
import { placeOf } from './scriptFormat'
import type { CharacterRole, EpisodeScript, Project, Relation } from './types'
import { blueprintOf, carryOf, latestDraft, scriptOf } from './work'

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
  log: EpisodeLog[]
}

const speakersOf = (s: EpisodeScript) => [...new Set(s.lines.flatMap((l) => (l.kind === 'dialogue' && l.speaker ? [l.speaker] : [])))]

/** 用 ep 之前（不含）的正文章节汇总状态库；不传 ep 时汇总全部 */
export function buildState(p: Project, beforeEp = Infinity): StateLibrary {
  const scripts = p.work.scripts
    .filter((s) => s.ep <= p.spec.totalEpisodes && s.ep < beforeEp)
    .sort((a, b) => a.ep - b.ep)
  const latestEp = scripts.at(-1)?.ep ?? 0

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
    log.push({ ep: s.ep, title: s.title, changes })
  }

  return {
    latestEp,
    // 已登记的在前，按首次出场排序
    characters: [...chars.values()].sort((a, b) => Number(a.role === null) - Number(b.role === null) || (a.firstEp ?? 1e9) - (b.firstEp ?? 1e9)),
    relations: p.work.relations.map((r) => ({ ...r, lastTogether: together.get(`${r.a}|${r.b}`) ?? null })),
    scenes: [...scenes.entries()].map(([place, episodes]) => ({ place, episodes })).sort((a, b) => b.episodes.length - a.episodes.length),
    log: log.reverse(),
  }
}

/* ---------------------------------- 写作前检查 ---------------------------------- */

export interface PreCheck {
  /** block：不能生成；warn：可以生成但要注意；info：本集要用到的状态 */
  level: 'block' | 'warn' | 'info'
  text: string
}

/** 写第 ep 集前对照状态库检查：集纲与蓝图、上一集定稿、钩子承接、人物最新状态 */
export function preWriteCheck(p: Project, ep: number): PreCheck[] {
  const w = p.work
  const checks: PreCheck[] = []
  const outline = w.outline.find((o) => o.ep === ep)
  const blueprint = blueprintOf(w, ep)
  if (!outline && !blueprint) checks.push({ level: 'block', text: `第 ${ep} 集还没有集纲，先到情节大纲生成` })
  // 蓝图是写稿的直接依据：没存过的按集纲和人物设定预填（11/5 标注 #89），写作时一并存下
  else if (!blueprint) checks.push({ level: 'info', text: '本集蓝图是按集纲和人物设定预填的，写作时一并保存' })
  if (ep > 1 && !scriptOf(w, ep - 1)) {
    checks.push(
      latestDraft(w, ep - 1)
        ? { level: 'warn', text: `第 ${ep - 1} 集还没定稿：本集会参考它的最新草稿，定稿后状态库才会更新` }
        : { level: 'block', text: `第 ${ep - 1} 集还没写，需按顺序逐集创作` },
    )
  }
  if (scriptOf(w, ep)) checks.push({ level: 'info', text: '本集已有正文章节，新草稿定稿后会替换正文' })
  if (outline && p.rhythm.paywalls.includes(ep) && !outline.approved) checks.push({ level: 'warn', text: '本集是付费卡点，集纲还没单独审核' })

  const lib = buildState(p, ep)
  const carry = carryOf(w, ep)
  if (carry) checks.push({ level: 'info', text: carry.auto ? `开场承接上集钩子：“${carry.text}”` : `开场承接：${carry.text}` })
  for (const c of lib.characters.filter((c) => c.role && c.state).slice(0, 4)) {
    checks.push({ level: 'info', text: `${c.name}（第 ${c.stateEp} 集后）：${c.state}` })
  }
  return checks
}
