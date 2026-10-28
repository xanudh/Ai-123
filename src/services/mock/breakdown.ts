/**
 * 对标剧拆解的本地模拟：按分集标记切分剧本，再用关键词规则粗拆四大板块。
 * 只用于演示流程与数据结构，接入大模型后由模型完成真正的阅读理解。
 */
import { MAIN_LINE } from '../../domain/pipeline'
import { defaultRhythm } from '../../domain/rhythm'
import type { BenchmarkCharacter, Breakdown, EpisodeBreakdown, PlotBeat, Relation, RhythmFrame, SourceScript, Synopsis } from '../../domain/types'
import { inferRelationKind, phaseRanges, rangeLabel } from '../../domain/work'
import { clip } from './rng'

/* ---------------------------------- 分集 ---------------------------------- */

const CN_DIGIT: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }

/** 中文数字（≤ 999）或阿拉伯数字转成数值 */
export function cnToNumber(text: string) {
  if (/^\d+$/.test(text)) return Number(text)
  let total = 0
  let num = 0
  for (const ch of text) {
    if (ch in CN_DIGIT) num = CN_DIGIT[ch]
    else if (ch === '百') {
      total += (num || 1) * 100
      num = 0
    } else if (ch === '十') {
      total += (num || 1) * 10
      num = 0
    }
  }
  return total + num
}

/** 分集标题：第1集 / 第十二集 / EP 3 / Episode 3: 标题；标题行一般很短，集号后只能接分隔符或行尾 */
const HEADING = /^[\s#【[]*(?:第\s*([0-9零〇一二两三四五六七八九十百]+)\s*集|(?:episode|ep)\s*[.:：\-#]?\s*(\d+))(?=$|[\s:：·.\-—|｜】\]（(])/i

export function parseSource(name: string, text: string): SourceScript {
  const map = new Map<number, string[]>()
  let current: number | null = null
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim()
    const m = line.length <= 40 ? HEADING.exec(line) : null
    if (m) {
      current = cnToNumber(m[1] ?? m[2])
      if (!map.has(current)) map.set(current, [])
      continue
    }
    if (current !== null && line) map.get(current)!.push(line)
  }
  const episodes = [...map.entries()]
    .filter(([ep]) => ep > 0)
    .sort(([a], [b]) => a - b)
    .map(([ep, lines]) => ({ ep, text: lines.join('\n') }))
  return { name, text, episodes, importedAt: new Date().toISOString() }
}

/* ---------------------------------- 行解析 ---------------------------------- */

type Line = { kind: 'scene'; place: string } | { kind: 'action'; text: string } | { kind: 'dialogue'; speaker: string; text: string }

const NOT_SPEAKER = new Set(['场景', '字幕', '时间', '地点', '人物', '备注', '画外音', '旁白', '镜头', '音效', 'OS', 'VO'])

function parseLine(line: string): Line {
  const scene = /^(?:场景|场)\s*[：:]\s*(.+)$/.exec(line) ?? /^(?:\d+[-.]\d+|(?:INT|EXT)\.)\s*(.+)$/i.exec(line)
  if (scene) return { kind: 'scene', place: scene[1].replace(/\s+(?:日|夜|晨|黄昏)?\s*(?:内|外)?\s*$/, '').trim() }
  const dialogue = /^([^\s：:（(△▲]{1,10})\s*(?:[（(][^）)]*[）)])?\s*[：:]\s*(.+)$/.exec(line)
  if (dialogue && !NOT_SPEAKER.has(dialogue[1])) return { kind: 'dialogue', speaker: dialogue[1], text: dialogue[2] }
  return { kind: 'action', text: line.replace(/^[△▲※]\s*/, '') }
}

/** 去掉台词开头的（表演提示） */
const stripCue = (text: string) => text.replace(/^[（(][^）)]*[）)]\s*/, '')

const plain = (l: Line) => (l.kind === 'scene' ? l.place : l.kind === 'dialogue' ? `${l.speaker}：${stripCue(l.text)}` : l.text)

/* ---------------------------------- 关键词表 ---------------------------------- */

const hits = (text: string, words: readonly string[]) => words.reduce((n, w) => n + (text.split(w).length - 1), 0)

const MAJOR = ['拒绝', '逐出', '下毒', '嫁祸', '陷害', '关进', '攻破', '刺', '绑', '要挟', '灭']
const MINOR = ['包围', '扑', '按在', '击倒', '毒', '倒地', '溃败', '踏平', '威胁', '末日', '哄笑', '打', '推']
const EMOTION = ['泪', '哭', '后悔', '对不起', '苍白', '颤', '跪', '握住', '屏息', '心碎', '冰冷', '挣扎', '欢呼', '哗然']
const REVEAL = ['原来', '竟然', '就是', '真相', '属于', '是因为', '揭开', '要挟']
const SECRET_KEYS = ['项链', '胎记', '画像', '王族', '血脉', '印记', '空瓶', '纹章', '丝带', '秘密', '身份', '遗嘱', '照片', '戒指', '玉佩', '录音', '鉴定']

const conflictHits = (text: string) => hits(text, MAJOR) * 2 + hits(text, MINOR)

type Table = [string, string[]][]

const GENRE_WORDS: Table = [
  ['狼人', ['狼', '阿尔法', '月神', '族群', '伴侣']],
  ['吸血鬼', ['吸血鬼', '血族', '獠牙']],
  ['隐藏身份', ['王族', '血脉', '后裔', '身份', '继承人']],
  ['复仇', ['报复', '复仇', '还你', '灭门', '血债']],
  ['追妻火葬场', ['后悔', '赎', '追起', '回到我身边', '对不起']],
  ['重生', ['重生', '前世', '上一世']],
  ['霸总', ['总裁', '集团', '董事长']],
  ['豪门', ['豪门', '千金', '少爷', '家族']],
  ['契约婚姻', ['契约', '协议', '婚约']],
  ['萌宝', ['宝宝', '妈咪', '爹地']],
  ['黑手党', ['教父', '黑手党', '家族生意']],
  ['神医', ['医术', '神医', '针灸']],
]

const TONE_WORDS: Table = [
  ['虐心', ['拒绝', '泪', '不信', '逐出', '冰冷', '哄笑']],
  ['爽感', ['击倒', '按在', '还你', '欢呼', '溃败', '碎裂']],
  ['悬疑', ['秘密', '真相', '灭门', '画像', '矛盾']],
  ['甜宠', ['吻', '宠', '抱', '心动']],
]

const TRAITS: Table = [
  ['隐忍反击', ['后悔', '证明', '变强', '还你', '归来', '守']],
  ['冷硬克制', ['拒绝', '逐出', '关进', '沉默', '背过身']],
  ['阴狠善妒', ['冷笑', '废物', '滚', '嫁祸', '计划', '末日', '狼后']],
  ['忠诚仗义', ['照顾', '告诉', '往北走', '干粮', '等你']],
  ['洞悉旧案', ['真相', '王族', '印记', '二十年前', '画像']],
  ['强势护短', ['归我管', '意见', '踏平', '证明给我看']],
  ['深情愧疚', ['对不起', '赎', '回到我身边', '又错了']],
]

const REL_CHANGES: Table = [
  ['公开决裂', ['拒绝', '逐出', '决裂']],
  ['结盟', ['收留', '归我管', '盟友', '使者']],
  ['信任崩塌', ['不信', '关进', '怀疑']],
  ['误会解开', ['真相', '对不起', '原来']],
  ['关系升温', ['挡在', '握住', '救']],
  ['敌对升级', ['嫁祸', '下毒', '陷害', '刺来']],
]

/** 按关键词命中数排序，取前 n 个命中过的标签 */
function top(table: Table, text: string, n: number) {
  return table
    .map(([label, words]) => ({ label, score: hits(text, words) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((x) => x.label)
}

/* ---------------------------------- 人物 ---------------------------------- */

interface EpisodeLines {
  ep: number
  lines: Line[]
  text: string
  speakers: string[]
}

interface Cast {
  name: string
  count: number
  eps: number[]
  lines: string[]
}

function castOf(episodes: EpisodeLines[]): Cast[] {
  const map = new Map<string, Cast>()
  for (const e of episodes) {
    for (const l of e.lines) {
      if (l.kind !== 'dialogue') continue
      const c = map.get(l.speaker) ?? { name: l.speaker, count: 0, eps: [], lines: [] }
      c.count++
      if (!c.eps.includes(e.ep)) c.eps.push(e.ep)
      c.lines.push(stripCue(l.text))
      map.set(l.speaker, c)
    }
  }
  // 关键人物：至少两句台词或在两集出场，最多 8 人
  return [...map.values()]
    .sort((a, b) => b.count - a.count)
    .filter((c) => c.count >= 2 || c.eps.length >= 2)
    .slice(0, 8)
}

function rolesOf(cast: Cast[], episodes: EpisodeLines[]) {
  const roles = new Map<string, string>()
  if (!cast.length) return roles
  const [hero, ...rest] = cast
  roles.set(hero.name, '主角')
  // 本人台词 + 提到本人的动作描述
  const context = (name: string) =>
    episodes.flatMap((e) => e.lines.filter((l) => (l.kind === 'dialogue' && l.speaker === name) || (l.kind === 'action' && l.text.includes(name))).map(plain)).join('\n')
  const scored = rest.map((c) => ({ c, ctx: context(c.name) }))

  const villain = scored.map((s) => ({ ...s, v: hits(s.ctx, ['废物', '滚', '冷笑', '嫁祸', '毒', '计划', '末日', '陷害', '哟']) })).sort((a, b) => b.v - a.v)[0]
  if (villain && villain.v > 0) roles.set(villain.c.name, '反派')

  const love = scored
    .filter((s) => !roles.has(s.c.name))
    .map((s) => ({ ...s, l: hits(s.ctx, ['伴侣', '拒绝', '后悔', '对不起', '回到我身边', '赎', '追']) }))
    .sort((a, b) => b.l - a.l)[0]
  if (love) roles.set(love.c.name, '感情线核心')

  for (const s of scored) if (!roles.has(s.c.name)) roles.set(s.c.name, /长老|师父|老人|教授/.test(s.ctx) ? '配角 · 知情人' : '配角 · 盟友')
  return roles
}

function characterRows(cast: Cast[], roles: Map<string, string>): BenchmarkCharacter[] {
  return cast.map((c) => {
    const longest = [...c.lines].sort((a, b) => b.length - a.length)[0] ?? ''
    return {
      name: c.name,
      role: roles.get(c.name) ?? '配角',
      personality: top(TRAITS, c.lines.join('\n'), 2).join('、') || '待补充',
      events: `第 ${c.eps[0]} 集登场，出场 ${c.eps.length} 集；代表台词：“${clip(longest, 24)}”`,
    }
  })
}

function relationRows(cast: Cast[], roles: Map<string, string>): Relation[] {
  const label = (a: string, b: string) => {
    const pair = [roles.get(a) ?? '', roles.get(b) ?? '']
    const has = (r: string) => pair.some((p) => p.startsWith(r))
    if (has('主角') && has('感情线')) return '命定伴侣：拒绝 → 悔恨 → 追回'
    if (has('主角') && has('反派')) return '宿敌：陷害与反击'
    if (has('感情线') && has('反派')) return '利用与纠缠'
    if (has('主角') && pair.some((p) => p.includes('知情人'))) return '揭开身世的引路人'
    if (has('主角')) return '盟友'
    return '同一阵营'
  }
  const rows: Relation[] = []
  for (let i = 0; i < cast.length; i++) {
    for (let j = i + 1; j < cast.length; j++) {
      const shared = cast[i].eps.some((e) => cast[j].eps.includes(e))
      const key = i === 0 || roles.get(cast[i].name) === '感情线核心' || roles.get(cast[j].name) === '反派'
      if (!shared || !key) continue
      const text = label(cast[i].name, cast[j].name)
      rows.push({ a: cast[i].name, b: cast[j].name, kind: inferRelationKind(text), label: text })
    }
  }
  return rows.slice(0, 8)
}

/* ---------------------------------- 逐集 ---------------------------------- */

function hookLabel(line: string, paywall: boolean) {
  if (paywall) return '付费卡点'
  if (/——|竟然|原来/.test(line)) return '反转'
  if (/[？?]$|……$/.test(line)) return '悬念'
  if (hits(line, EMOTION) > 0) return '情绪高点'
  if (hits(line, SECRET_KEYS) > 0) return '新秘密'
  return '悬念'
}

function openLabel(line: Line) {
  const text = plain(line)
  if (/字幕|年后|年前/.test(text)) return '时间跳跃'
  if (line.kind === 'dialogue' && /[？?！!]/.test(text)) return '悬念金句'
  if (conflictHits(text) > 0) return '冲突前置'
  return '视觉冲击'
}

/** 本集最有分量的一行：冲突 × 2 + 揭秘 + 情绪，同分取靠前的 */
const weight = (l: Line) => conflictHits(plain(l)) + hits(plain(l), REVEAL) + hits(plain(l), EMOTION)

/** 在推荐位置 ±1 集内挑得分最高的一集 */
function snap(targets: number[], score: (ep: number) => number, total: number) {
  const picked = targets.map((t) => {
    const cands = [t, t - 1, t + 1].filter((e) => e >= 1 && e <= total)
    return cands.reduce((best, e) => (score(e) > score(best) ? e : best), cands[0] ?? t)
  })
  return [...new Set(picked)].sort((a, b) => a - b)
}

export function analyzeSource(source: SourceScript): Breakdown {
  const episodes: EpisodeLines[] = source.episodes.map((e) => {
    const lines = e.text.split('\n').map(parseLine)
    return { ep: e.ep, lines, text: e.text, speakers: [...new Set(lines.flatMap((l) => (l.kind === 'dialogue' ? [l.speaker] : [])))] }
  })
  const total = Math.max(...episodes.map((e) => e.ep), 1)
  const allText = source.episodes.map((e) => e.text).join('\n')
  const cast = castOf(episodes)
  const roles = rolesOf(cast, episodes)
  const hero = cast[0]?.name ?? '主角'
  const villain = cast.find((c) => roles.get(c.name) === '反派')?.name
  const lover = cast.find((c) => roles.get(c.name) === '感情线核心')?.name
  const textOf = new Map(episodes.map((e) => [e.ep, e.text]))
  const epScore = (ep: number, f: (t: string) => number) => {
    const t = textOf.get(ep)
    return t === undefined ? -1 : f(t)
  }

  // 节奏：以需求文档的默认框架为起点，在附近挑冲突 / 揭秘最强的集
  const base = defaultRhythm(total)
  const rhythm: RhythmFrame = {
    paywalls: snap(base.paywalls, (ep) => epScore(ep, (t) => conflictHits(t) + hits(t, EMOTION)), total),
    twists: snap(base.twists, (ep) => epScore(ep, (t) => hits(t, REVEAL) + hits(t, SECRET_KEYS)), total),
    climaxFrom: base.climaxFrom,
  }

  const seenSpeakers = new Set<string>()
  const planted = new Map<string, number>()
  const secrets: { key: string; from: number; to: number }[] = []

  const rows: EpisodeBreakdown[] = episodes.map((e) => {
    const body = e.lines.filter((l) => l.kind !== 'scene')
    const first = body[0] ?? e.lines[0]
    const last = body[body.length - 1] ?? first
    const paywall = rhythm.paywalls.includes(e.ep)
    const twist = rhythm.twists.includes(e.ep)
    const event = body.reduce((best, l) => (weight(l) > weight(best) ? l : best), first)

    const fresh = e.speakers.filter((s) => !seenSpeakers.has(s))
    fresh.forEach((s) => seenSpeakers.add(s))

    const pair = e.speakers.filter((s) => cast.some((c) => c.name === s)).slice(0, 2)
    const [change] = top(REL_CHANGES, e.text, 1)

    // 伏笔：关键词第一次出现记为埋设，之后带揭秘语气的出现记为回收
    let plant = ''
    let payoff = ''
    for (const l of body) {
      const text = plain(l)
      for (const key of SECRET_KEYS.filter((k) => text.includes(k))) {
        const from = planted.get(key)
        if (from === undefined) {
          planted.set(key, e.ep)
          if (!plant) plant = `${key}：${clip(text, 22)}`
        } else if (from < e.ep && hits(text, REVEAL) > 0 && !secrets.some((s) => s.key === key)) {
          secrets.push({ key, from, to: e.ep })
          if (!payoff) payoff = `第 ${from} 集的${key} → ${clip(text, 20)}`
        }
      }
    }

    const conflict = Math.min(5, 1 + Math.round(conflictHits(e.text) * 0.8))
    const lastText = plain(last)
    return {
      ep: e.ep,
      openHook: `${openLabel(first)}：${clip(plain(first), 20)}`,
      event: clip(plain(event), 32),
      conflict,
      newCharacters: fresh.join('、'),
      relationChange: change && pair.length === 2 ? `${pair[0]} — ${pair[1]}：${change}` : '',
      plant,
      payoff,
      endHook: `${hookLabel(lastText, paywall)}：${clip(lastText, 22)}`,
      paywall,
      paywallMoment: paywall ? `卡在「${clip(lastText, 18)}」` : '',
      emotion: Math.min(5, Math.max(1, Math.round(1.5 + hits(e.text, EMOTION) * 0.6 + conflict * 0.3 + (twist ? 0.8 : 0)))),
    }
  })

  // 冲突主线：每段取冲突 + 情绪最强的两集
  const ranges = phaseRanges(total)
  const mainLine: PlotBeat[] = MAIN_LINE.map((beat, i) => {
    const [from, to] = ranges[i]
    const picked = rows
      .filter((r) => r.ep >= from && r.ep <= to)
      .sort((a, b) => b.conflict + b.emotion - a.conflict - a.emotion)
      .slice(0, 2)
      .sort((a, b) => a.ep - b.ep)
    return { beat, range: rangeLabel(ranges[i]), content: picked.map((r) => `第 ${r.ep} 集 ${r.event.replace(/[。…]+$/, '')}`).join('；') }
  })

  const places = [...new Set(episodes.flatMap((e) => e.lines.flatMap((l) => (l.kind === 'scene' ? [l.place] : []))))]
  const female = hits(allText, ['伴侣', '狼后', '婚', '爱', '闺蜜', '千金', '总裁'])
  const male = hits(allText, ['战神', '兄弟', '龙王', '女婿', '首富', '老婆'])
  const tones = top(TONE_WORDS, allText, 3)
  const [secret] = secrets

  const synopsis: Synopsis = {
    audience: female >= male ? '女频：情感线主导，18–45 岁女性' : '男频：逆袭打脸主导',
    genre: top(GENRE_WORDS, allText, 4).join(' / ') || '待补充',
    coreSetup: [
      rows[0] && `开局 ${rows[0].event.replace(/[。…]+$/, '')}`,
      secret && `核心秘密围绕「${secret.key}」（第 ${secret.from} 集埋，第 ${secret.to} 集揭开）`,
    ]
      .filter(Boolean)
      .join('；'),
    style: tones.length ? `${tones.join(' + ')}，短场景快切，每集结尾必留钩子` : '待补充',
    world: places.length ? `主要场景：${places.slice(0, 5).join('、')}` : '待补充',
    highlights: rows
      .filter((r) => r.payoff)
      .slice(0, 3)
      .map((r) => `第 ${r.ep} 集 ${r.payoff.split('→ ')[1] ?? r.payoff}`)
      .join('；') || '待补充',
    // 每段一行：段名（集数）：剧情
    summary: mainLine.map((m) => `${m.beat}（${m.range}）：${m.content || '—'}`).join('\n'),
    paywalls: `共 ${rhythm.paywalls.length} 个付费点：第 ${rhythm.paywalls.join('、')} 集；多卡在${[villain && `${villain}的阴谋即将得逞`, lover && `${hero}与${lover}关系转折`, '身份即将揭晓']
      .filter(Boolean)
      .slice(0, 2)
      .join('或')}的瞬间`,
  }

  return {
    synopsis,
    characters: characterRows(cast, roles),
    relations: relationRows(cast, roles),
    mainLine,
    rhythm,
    totalEpisodes: total,
    episodes: rows,
    review: { synopsis: 'pending', characters: 'pending', mainline: 'pending', episodes: 'pending' },
    referencedAt: null,
    generatedAt: new Date().toISOString(),
  }
}
