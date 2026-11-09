/**
 * 仿写的对位：我们第 N 集 ≈ 对标剧第几集。按内容的阶段对位，不按集数对位：
 * ① 先对阶段：冲突主线的段按内容对；② 段内先对关键节点：付费卡点对付费卡点、大反转对大反转；③ 其余普通集按比例落在两个节点之间。
 * 勾了「完全按对标剧」且集数一样，就是第 N 集对第 N 集。我们新加的段（bench = -1）不对位。
 * 故事架构生成节奏框架时的换算、节奏曲线上的对标剧虚线、集纲的「对位」都用这一套。
 */
import type { Breakdown, Project, RhythmFrame } from './types'
import { defaultPhaseName, phaseCount, phaseOf, phaseRanges, projectPhases } from './work'

type Range = [number, number]

function parseRange(text: string): Range | null {
  const m = /(\d+)\s*[–\-~至到]\s*(\d+)/.exec(text)
  if (m) return [Number(m[1]), Number(m[2])]
  const one = /(\d+)/.exec(text)
  return one ? [Number(one[1]), Number(one[1])] : null
}

/** 对标剧冲突主线各段的集数：拆解里写的「第 a–b 集」优先，读不出来按默认比例切 */
export function benchRanges(bd: Breakdown): Range[] {
  const parsed = bd.mainLine.map((b) => parseRange(b.range))
  const ok = parsed.every((r, i) => r && r[0] <= r[1] && (i === 0 ? r[0] === 1 : r[0] === parsed[i - 1]![1] + 1))
  return ok ? (parsed as Range[]) : phaseRanges(bd.totalEpisodes, null, bd.mainLine.length)
}

/** 按默认规则，我们第 i 段对对标剧第几段：段数相同一一对；不同先按段名配，配不上按位置比例（接模型后按剧情内容配） */
export function defaultBenchSegment(ours: number, theirs: number, i: number, name?: string, benchNames: string[] = []) {
  if (!theirs) return -1
  if (ours === theirs) return i
  const byName = name ? benchNames.indexOf(name) : -1
  if (byName >= 0) return byName
  return Math.round((i * (theirs - 1)) / Math.max(1, ours - 1))
}

/** 我们第 i 段对应对标剧第几段；编剧改过就按改过的；-1 表示新加的段、不对位 */
export function benchSegment(p: Project, i: number): number {
  const bd = p.work.breakdown
  if (!bd || p.mode === 'original') return -1
  const beat = p.work.architecture?.mainLine[i]
  if (beat?.bench !== undefined) return beat.bench < bd.mainLine.length ? beat.bench : -1
  return defaultBenchSegment(phaseCount(p), bd.mainLine.length, i, beat?.beat.trim() || defaultPhaseName(i), bd.mainLine.map((b) => b.beat))
}

/** 段内的关键节点配对：我们的节点按比例找对标剧离得最近的同类节点，多出来的不管 */
function anchorsOf(ours: Range, theirs: Range, mine: number[], bench: number[]) {
  const pos = (ep: number, [f, t]: Range) => (t === f ? 0 : (ep - f) / (t - f))
  const free = [...bench]
  const pairs: [number, number][] = []
  for (const ep of mine) {
    if (!free.length) break
    const best = free.reduce((a, b) => (Math.abs(pos(b, theirs) - pos(ep, ours)) < Math.abs(pos(a, theirs) - pos(ep, ours)) ? b : a))
    free.splice(free.indexOf(best), 1)
    pairs.push([ep, best])
  }
  return pairs
}

const inside = (ep: number, [f, t]: Range) => ep >= f && ep <= t

/** 我们第 ep 集对位到对标剧的哪一两集；原创、没拆解、新加的段返回空 */
export function alignEp(p: Project, ep: number): number[] {
  const bd = p.work.breakdown
  if (!bd?.episodes.length || p.mode === 'original') return []
  if (p.spec.followBenchmark && p.spec.totalEpisodes === bd.totalEpisodes) return [ep]
  const ours = projectPhases(p)
  const i = phaseOf(ep, ours)
  const j = benchSegment(p, i)
  const theirs = j >= 0 ? benchRanges(bd)[j] : undefined
  if (!theirs) return []
  const seg = ours[i]
  const pairs = (['paywalls', 'twists'] as const).flatMap((k) =>
    anchorsOf(
      seg,
      theirs,
      p.rhythm[k].filter((e) => inside(e, seg)),
      bd.rhythm[k].filter((e) => inside(e, theirs)),
    ),
  )
  const hit = pairs.find(([mine]) => mine === ep)
  if (hit) return [hit[1]]
  // 段首、段尾也当作节点，普通集落在前后两个节点之间按比例
  const anchors = [[seg[0], theirs[0]] as [number, number], ...pairs, [seg[1], theirs[1]] as [number, number]].sort((a, b) => a[0] - b[0])
  const before = [...anchors].reverse().find(([m]) => m <= ep) ?? anchors[0]
  const after = anchors.find(([m]) => m >= ep && m !== before[0]) ?? anchors[anchors.length - 1]
  const x = after[0] === before[0] ? before[1] : before[1] + ((ep - before[0]) * (after[1] - before[1])) / (after[0] - before[0])
  const clamp = (n: number) => Math.min(theirs[1], Math.max(theirs[0], n))
  const lo = clamp(Math.floor(x + 1e-6))
  const hi = clamp(Math.ceil(x - 1e-6))
  return lo === hi ? [lo] : [lo, hi]
}

/** 对标剧第 k 集落在我们第几集（可以是小数）；落在没对上的段里返回 null */
export function placeBenchEp(p: Project, k: number, total = p.spec.totalEpisodes): number | null {
  const bd = p.work.breakdown
  if (!bd) return null
  const theirs = benchRanges(bd)
  const j = phaseOf(k, theirs)
  const ours = phaseRanges(total, p.work.architecture?.phaseEnds, phaseCount(p))
  const i = ours.findIndex((_, n) => benchSegment(p, n) === j)
  if (i < 0) return null
  const [f, t] = ours[i]
  const [bf, bt] = theirs[j]
  // 对标剧这一段只有一集：节点多半是段尾的付费卡点，落到我们这段的末尾
  return bt === bf ? t : f + ((k - bf) * (t - f)) / (bt - bf)
}

/**
 * 对标剧的节奏框架按分段换算到我们的集数：每个节点先找它在对标剧哪一段，再落到我们对应那段里的同一比例位置。
 * 我们删掉的对标剧段，里面的节点不要；新加的段没有节点，生成节奏框架时再补。
 */
export function alignRhythm(p: Project, total = p.spec.totalEpisodes): RhythmFrame | null {
  const bd = p.work.breakdown
  if (!bd) return null
  const at = (k: number) => {
    const x = placeBenchEp(p, k, total)
    return x === null ? null : Math.min(total, Math.max(1, Math.round(x)))
  }
  const list = (eps: number[]) => [...new Set(eps.map(at).filter((x): x is number => x !== null))].sort((a, b) => a - b)
  return { paywalls: list(bd.rhythm.paywalls), twists: list(bd.rhythm.twists), climaxFrom: at(bd.rhythm.climaxFrom) ?? Math.round(total * 0.85) }
}

/** 对位说明：对标剧第 21–22 集 */
export const alignLabel = (eps: number[]) => (eps.length ? `对标剧第 ${eps.length > 1 ? `${eps[0]}–${eps[eps.length - 1]}` : eps[0]} 集` : '')
