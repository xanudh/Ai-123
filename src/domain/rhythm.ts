import { EPISODE_SECONDS, SCRIPT_CPM, SPEECH_WPM } from './constants'
import type { Project, RhythmFrame } from './types'
import { phaseRanges } from './work'

/** 需求文档以 70 集为基准给出的节点位置 */
const BASE_EPISODES = 70
const BASE_PAYWALLS = [10, 25, 40, 55]
const BASE_TWISTS = [15, 35, 55]
const BASE_CLIMAX_FROM = 63

const scale = (ep: number, total: number) =>
  Math.min(total, Math.max(1, Math.round((ep * total) / BASE_EPISODES)))

const uniqSorted = (list: number[]) => [...new Set(list)].sort((a, b) => a - b)

/** 按总集数等比缩放需求文档中的默认节奏框架 */
export function defaultRhythm(total: number): RhythmFrame {
  return {
    paywalls: uniqSorted(BASE_PAYWALLS.map((e) => scale(e, total))),
    twists: uniqSorted(BASE_TWISTS.map((e) => scale(e, total))),
    climaxFrom: scale(BASE_CLIMAX_FROM, total),
  }
}

/**
 * 按冲突主线的五段分段生成节奏框架：
 * 每段的最后一集是付费卡点（结局段除外），把观众卡在段落转折处；
 * 第一次小反转、中点大反转、第二幕升级三段各在 60% 处安排一次大反转；结局高潮从最后一段开始。
 */
export function rhythmFromPhases(ranges: [number, number][], total: number): RhythmFrame {
  const paywalls = ranges.slice(0, -1).map(([, to]) => to)
  const twists = ranges.slice(1, -1).map(([from, to]) => from + Math.round((to - from) * 0.6))
  const climaxFrom = ranges.at(-1)?.[0] ?? total
  const inRange = (list: number[]) => uniqSorted(list.filter((e) => e >= 1 && e <= total))
  return { paywalls: inRange(paywalls), twists: inRange(twists).filter((e) => !paywalls.includes(e)), climaxFrom: Math.min(Math.max(climaxFrom, 1), total) }
}

/** 总集数变化时，把超出范围的节点收回到范围内 */
function clampRhythm(rhythm: RhythmFrame, total: number): RhythmFrame {
  const inRange = (list: number[]) => uniqSorted(list.filter((e) => e >= 1 && e <= total))
  return {
    paywalls: inRange(rhythm.paywalls),
    twists: inRange(rhythm.twists),
    climaxFrom: Math.min(Math.max(rhythm.climaxFrom, 1), total),
  }
}

export const sameRhythm = (a: RhythmFrame, b: RhythmFrame) => JSON.stringify(a) === JSON.stringify(b)

/** 总集数从 from 改为 to 后的节奏框架：仍是推荐值就按新集数重新推荐，手动改过则只把越界节点收回 */
export function rhythmForTotal(rhythm: RhythmFrame, from: number, to: number): RhythmFrame {
  if (from === to) return rhythm
  return sameRhythm(rhythm, defaultRhythm(from)) ? defaultRhythm(to) : clampRhythm(rhythm, to)
}

export interface RhythmIssue {
  level: 'error' | 'warn'
  text: string
}

export function validateRhythm(rhythm: RhythmFrame, total: number): RhythmIssue[] {
  const issues: RhythmIssue[] = []
  const [first] = rhythm.paywalls

  if (first === undefined) {
    issues.push({ level: 'error', text: '至少需要设置一个付费卡点集' })
  } else if (first < 5) {
    issues.push({ level: 'warn', text: `首付费在第 ${first} 集偏早，观众还没入戏，建议 8–12 集` })
  } else if (first > 15) {
    issues.push({ level: 'warn', text: `首付费在第 ${first} 集偏晚，免费集过长会稀释转化，建议 8–12 集` })
  }

  for (let i = 1; i < rhythm.paywalls.length; i++) {
    const gap = rhythm.paywalls[i] - rhythm.paywalls[i - 1]
    if (gap < 5) {
      issues.push({
        level: 'warn',
        text: `第 ${rhythm.paywalls[i - 1]} 与第 ${rhythm.paywalls[i]} 集卡点间隔仅 ${gap} 集，过密容易劝退`,
      })
    }
  }

  if (rhythm.twists.length === 0) {
    issues.push({ level: 'warn', text: '尚未设置大反转集，中段容易平' })
  }

  if (rhythm.climaxFrom < Math.round(total * 0.7)) {
    issues.push({ level: 'warn', text: `结局高潮从第 ${rhythm.climaxFrom} 集开始偏早，建议放在最后 10–15% 的集数` })
  }

  return issues
}

/** 单集对白词数估算：时长 × 英文语速 */
export function estimateWords(seconds: number) {
  return Math.round((seconds / 60) * SPEECH_WPM)
}

/** 单集中文剧本字数估算：时长 × 剧本篇幅，取整到 50 字 */
export function estimateChars(seconds: number) {
  return Math.round(((seconds / 60) * SCRIPT_CPM) / 50) * 50
}

/** 单集时长输入框下的提示：换算出的剧本字数与英文对白量 */
export const secondsHint = (seconds: number) =>
  seconds >= EPISODE_SECONDS.min && seconds <= EPISODE_SECONDS.max
    ? `约 ${estimateChars(seconds)} 字剧本、${estimateWords(seconds)} 词英文对白；逐集剧本按此控制篇幅`
    : `${EPISODE_SECONDS.min}–${EPISODE_SECONDS.max} 秒；逐集剧本按时长控制篇幅`

export type NodeKind = 'paywall' | 'twist' | 'climax' | 'plain'

export function nodeKind(ep: number, rhythm: RhythmFrame): NodeKind {
  if (rhythm.paywalls.includes(ep)) return 'paywall'
  if (rhythm.twists.includes(ep)) return 'twist'
  if (ep >= rhythm.climaxFrom) return 'climax'
  return 'plain'
}

/**
 * 目标情绪强度曲线（1–5 分，示意）：开场即高、中段波动爬坡、
 * 付费卡点和大反转踩在波峰、结局拉满——对应需求文档中的节奏模板。
 */
export function targetCurve(rhythm: RhythmFrame, total: number): number[] {
  const peaks = [
    ...rhythm.paywalls.map((ep) => ({ ep, height: 0.95 })),
    ...rhythm.twists.map((ep) => ({ ep, height: 1.15 })),
  ]
  const values: number[] = []
  for (let ep = 1; ep <= total; ep++) {
    const t = (ep - 1) / Math.max(total - 1, 1)
    const opening = 1.6 * Math.exp(-(ep - 1) / 1.8)
    const base = 2.9 + 1.0 * t
    const wave = 0.18 * Math.sin(ep * 1.3)
    const bump = peaks.reduce((acc, p) => acc + p.height * Math.exp(-((ep - p.ep) ** 2) / 3.2), 0)
    const climax = ep >= rhythm.climaxFrom ? 0.9 * ((ep - rhythm.climaxFrom + 1) / (total - rhythm.climaxFrom + 1)) : 0
    values.push(Math.max(1, Math.min(5, base + opening + wave + bump + climax)))
  }
  return values
}

/** 总集数改了以后的节奏框架：原本就是按主线分段生成的，按新分段重新生成；否则只把越界的节点收回 */
export function rhythmOnResize(p: Project, total: number): RhythmFrame {
  const before = p.spec.totalEpisodes
  if (before === total) return p.rhythm
  const ends = p.work.architecture?.phaseEnds
  const n = p.work.architecture?.mainLine.length
  const fromPhases = sameRhythm(p.rhythm, rhythmFromPhases(phaseRanges(before, ends, n), before))
  return fromPhases ? rhythmFromPhases(phaseRanges(total, ends, n), total) : rhythmForTotal(p.rhythm, before, total)
}
