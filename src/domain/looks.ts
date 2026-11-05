/**
 * 人物本集状态：每个人在哪一场进来、这一场的服化道重点，给拆资产用。
 * 有正文时按正文的场次和「人物：」算谁在哪场出现；服化道取蓝图里登记的，没登记的沿用人物设定里的服装。
 * 不单独存储，蓝图里的 looks 是编剧 / AI 的计划。
 */
import { placeOf, sceneCast, sceneNumbers } from './scriptFormat'
import type { CastLook, Project, ScriptLine } from './types'
import { blueprintOf, latestDraft, plainText, scriptOf } from './work'

export interface SceneLook {
  /** 场次号「集-场」；按蓝图推断时没有 */
  no: string | null
  place: string
  look: string
}

export interface CastLooks {
  name: string
  scenes: SceneLook[]
  /** 本集妆造改了几次：和上一场（第一场和上集最后一场）不一样就算一次 */
  changes: number
}

/** 人物设定里的默认服装：按阶段写的取第一段 */
const defaultLook = (p: Project, name: string) =>
  plainText(p.work.characters.find((c) => c.name === name)?.costume ?? '')
    .split(/[；;\n]/)[0]
    .replace(/^[^：:]{1,8}[：:]/, '')
    .trim()

const lookFor = (p: Project, plan: CastLook[], name: string, place: string) =>
  plan.find((l) => l.name === name && l.scene && (place.includes(l.scene) || l.scene.includes(place)))?.look.trim() ||
  plan.find((l) => l.name === name && !l.scene.trim())?.look.trim() ||
  defaultLook(p, name)

/** 有正文的一集：按场次列出每个人出现在哪几场 */
function fromLines(p: Project, ep: number, lines: ScriptLine[], plan: CastLook[]): Map<string, SceneLook[]> {
  const names = p.work.characters.map((c) => c.name.trim()).filter(Boolean)
  const no = sceneNumbers(ep, lines)
  const out = new Map<string, SceneLook[]>()
  lines.forEach((l, i) => {
    if (l.kind !== 'scene') return
    const place = placeOf(plainText(l.zh))
    for (const name of sceneCast(lines, i, names)) {
      const list = out.get(name) ?? []
      list.push({ no: no.get(l.id) ?? null, place, look: lookFor(p, plan, name, place) })
      out.set(name, list)
    }
  })
  return out
}

/** 还没有正文：按蓝图登记的场景与服化道 */
function fromPlan(plan: CastLook[]): Map<string, SceneLook[]> {
  const out = new Map<string, SceneLook[]>()
  for (const l of plan) {
    if (!l.name.trim()) continue
    const list = out.get(l.name) ?? []
    list.push({ no: null, place: l.scene.trim(), look: l.look.trim() })
    out.set(l.name, list)
  }
  return out
}

const linesOf = (p: Project, ep: number, draftId?: string) => {
  const w = p.work
  const viewed = draftId ? w.drafts.find((d) => d.id === draftId && d.ep === ep) : undefined
  return (viewed ?? scriptOf(w, ep) ?? latestDraft(w, ep))?.lines ?? []
}

function scenesOf(p: Project, ep: number, draftId?: string) {
  const plan = blueprintOf(p.work, ep)?.looks ?? []
  const lines = linesOf(p, ep, draftId)
  return lines.some((l) => l.kind === 'scene') ? fromLines(p, ep, lines, plan) : fromPlan(plan)
}

/** 第 ep 集每个人物的场次与服化道；names 给定时按这个顺序，只列这些人 */
export function episodeLooks(p: Project, ep: number, names?: string[], draftId?: string): CastLooks[] {
  const here = scenesOf(p, ep, draftId)
  const prev = ep > 1 ? scenesOf(p, ep - 1) : new Map<string, SceneLook[]>()
  const order = names ?? [...here.keys()]
  return order.map((name) => {
    const scenes = here.get(name) ?? []
    let last = prev.get(name)?.at(-1)?.look ?? ''
    let changes = 0
    for (const s of scenes) {
      if (s.look && last && s.look !== last) changes++
      if (s.look) last = s.look
    }
    return { name, scenes, changes }
  })
}

/** 剧本开头的「本集人物状态」：一人一行，按场次写服化道 */
export function looksText(list: CastLooks[]) {
  const rows = list.filter((c) => c.scenes.length)
  if (!rows.length) return ''
  return ['本集人物状态：', ...rows.map((c) => `${c.name}：${c.scenes.map((s) => `${s.no ? `${s.no} ` : ''}${s.place || '—'}（${s.look || '服化道待定'}）`).join('；')}`)].join('\n')
}
