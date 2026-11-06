/**
 * 对标剧拆解的本地模拟：按分集标记切分剧本，再用关键词规则粗拆四大板块。
 * 只用于演示流程与数据结构，接入大模型后由模型完成真正的阅读理解。
 */
import { GOLDEN_FINGER_KINDS } from '../../domain/constants'
import type { GoldenFingerKind } from '../../domain/constants'
import { MAIN_LINE } from '../../domain/pipeline'
import { defaultRhythm, estimateChars } from '../../domain/rhythm'
import { cnToNumber, isSceneHeading, parseDialogue, placeOf } from '../../domain/scriptFormat'
import type { BenchmarkCharacter, Breakdown, EpisodeBreakdown, EpisodeDims, LineBeat, PlotBeat, Relation, RhythmFrame, SceneBeat, SourceScript, Synopsis } from '../../domain/types'
import { inferRelationKind, phaseRanges, rangeLabel } from '../../domain/work'
import { clip } from './rng'
import { SAMPLE_CAST, SAMPLE_DIMS, SAMPLE_EPISODES, SAMPLE_FLOWS, SAMPLE_HERO, SAMPLE_MAINLINE, SAMPLE_PURPOSE, SAMPLE_SCENES, SAMPLE_SYNOPSIS } from './sampleAnalysis'

/* ---------------------------------- 分集 ---------------------------------- */

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

/** 一行剧本：场景标题认样稿格式「1-1：日，外，地点」，也认旧写法「场景：地点 夜 内」「1.2 地点」「INT. 地点」；台词认「余霍os：」「母亲（ov）：」 */
function parseLine(line: string): Line {
  const scene = isSceneHeading(line) ? line : (/^(?:场景|场)\s*[：:]\s*(.+)$/.exec(line)?.[1] ?? /^(?:\d+[-.]\d+|(?:INT|EXT)\.)\s*(.+)$/i.exec(line)?.[1])
  if (scene) return { kind: 'scene', place: placeOf(scene) }
  const dialogue = parseDialogue(line)
  if (dialogue?.text) return { kind: 'dialogue', speaker: dialogue.speaker, text: dialogue.text }
  return { kind: 'action', text: line.replace(/^[△▲※]\s*/, '') }
}

/** 「人物：」行只是这一场的出场名单，不算正文 */
const isCastLine = (line: string) => /^人物\s*[：:]/.test(line)

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
  ['黑帮', ['教父', '黑手党', '家族生意']],
  ['真假千金', ['真千金', '假千金', '抱错']],
  ['穿越', ['穿越', '古代', '时空']],
  ['神医', ['医术', '神医', '针灸']],
]

const TONE_WORDS: Table = [
  ['虐恋', ['拒绝', '泪', '不信', '逐出', '冰冷', '哄笑']],
  ['打脸', ['击倒', '按在', '还你', '欢呼', '溃败', '碎裂']],
  ['反转', ['秘密', '真相', '灭门', '画像', '矛盾']],
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

/* ---------------------------------- 故事梗概用的词表 ---------------------------------- */

/** 别人骂主角的话：取被看轻的样子（「连狼形都化不出的废物」）和那个词（「废物」） */
const INSULT = /(?:一个|你这个|这个|区区)?([^，。！？、：]{0,10}?(废物|废柴|穷鬼|野种|乡巴佬|扫把星|赔钱货|窝囊废|吃软饭的))/
/** 揭开的身份：「白狼王族的后裔」「顾家的继承人」 */
const HEIR = /([^\s，。！？、：“”]{2,6}(?:王族|家族|世家|集团|族|门)的(?:后裔|继承人|传人|血脉|千金|少爷))/
/** 权威认证：当众加冕、授勋、认亲 */
const PROOF = /跪拜|加冕|王冠|授予|册封|勋章|认亲|当众宣布/
/** 一路被羞辱的几步 */
const HUMILIATE = ['拒绝', '逐出', '废物', '哄笑', '滚', '不配', '嫁祸', '关进', '爬谁的床', '赶出']

/** 金手指分类的认法：力量型、身份型等看金手指那几行，武力型看主角自己的动作 */
const KIND_WORDS: Record<GoldenFingerKind, string[]> = {
  力量型: ['爆出', '震飞', '银光', '白光', '光芒', '觉醒', '力量', '应声而断', '显现', '异能', '超能力', '治好'],
  武力型: ['一拳', '击倒', '扣住', '按在', '格斗', '踢', '剑'],
  幸运型: ['幸运', '运气', '恰好', '中奖', '偶遇'],
  身份型: ['王族', '身份', '继承人', '后裔', '血统', '公主', '千金', '少爷', '血脉'],
  财富型: ['集团', '亿', '首富', '财产', '黑卡', '股份'],
  智谋型: ['看穿', '识破', '医术', '针灸', '鉴定', '推理'],
  系统型: ['系统', '任务奖励', '面板', '签到'],
  先知型: ['重生', '前世', '上一世', '预知', '梦见'],
}

/** 主角眼下想做成的事：「我只要变强」「我一定要查清」 */
const WANT = /我(?:只)?要|我会|我一定|证明|变强|报仇|查清|夺回/

/** 主角的缺陷：按主角最突出的性格 */
const FLAW_OF: Record<string, string> = {
  隐忍反击: '太能忍、什么都自己扛，不给别人解释的机会，误会往往拖到最后才解开',
  冷硬克制: '冷硬，心里话说不出口，身边的人只能猜',
  忠诚仗义: '太讲义气，容易被身边的人拖累',
  洞悉旧案: '知道得多却不说，把自己置于险地',
  强势护短: '强势，听不进别人的话',
  深情愧疚: '心软，一次次给伤害自己的人机会',
  阴狠善妒: '心狠，赢了也没人真心站在身边',
}

/** 金手指的条件与限制：要靠什么才能用、用了付出什么 */
const LIMIT_WORDS = ['代价', '只能', '才能', '必须', '失控', '反噬', '虚弱', '昏迷', '割破']

/** 世界规则：剧本里出现过就写进世界总览 */
const WORLD_RULES: [RegExp, string][] = [
  [/阿尔法/, '族群以阿尔法为尊'],
  [/狼形/, '成年后要化出狼形'],
  [/月神[\s\S]*伴侣|伴侣[\s\S]*月神/, '命定伴侣由月神选定'],
  [/结界/, '族群靠结界划出领地'],
  [/联盟/, '各族靠联盟大会结盟、划分领地'],
  [/血族|吸血鬼/, '血族藏在人类社会里'],
  [/猎人/, '猎人与异族世代为敌'],
  [/契约/, '契约一旦签下就必须遵守'],
  [/集团|董事/, '财富和股权决定话语权'],
  [/家族/, '家族利益高于个人'],
]
/** 阵营：「银月族」「血月猎人」「北境狼群」「顾氏集团」 */
const CAMP = /([\u4e00-\u9fa5]{1,3}(?:王族|家族|族(?![群人长])|狼群|猎人|集团|世家|帮|教会|血族))/g
const GENERIC_CAMPS = ['族群', '全族', '狼族', '王族', '家族', '狼群', '猎人', '血族', '集团', '世家']

/** 叙述里截短：不加省略号，尽量断在逗号、顿号处 */
function brief(text: string, n: number) {
  const t = text.replace(/[。！？!?…]+$/, '')
  if (t.length <= n) return t
  const cut = t.slice(0, n)
  const at = Math.max(cut.lastIndexOf('，'), cut.lastIndexOf('；'), cut.lastIndexOf('、'))
  return at >= n / 2 ? cut.slice(0, at) : cut
}

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

/** 配角在这部剧里的作用：按定位写（11/4 第五轮标注：配角拆作用和定位） */
const PURPOSE: [RegExp, (hero: string) => string][] = [
  [/反派/, (h) => `制造${h}困境的人，一次次把冲突往上推，${h}的每一次反击都打在这个人身上`],
  [/感情/, (h) => `和${h}的感情线是全剧的情绪主线：关系的每一次转折都是虐点或爽点`],
  [/知情/, (h) => `握着旧事的真相，在关键处替${h}揭开身世或旧案`],
  [/盟友/, (h) => `在${h}最难的时候站到${h}这边，帮${h}翻身`],
]

function characterRows(cast: Cast[], roles: Map<string, string>): BenchmarkCharacter[] {
  const hero = cast[0]?.name ?? '主角'
  return cast.map((c) => {
    const longest = [...c.lines].sort((a, b) => b.length - a.length)[0] ?? ''
    const role = roles.get(c.name) ?? '配角'
    const job = PURPOSE.find(([re]) => re.test(role))?.[1](hero) ?? `衬托${hero}、推动剧情`
    return {
      name: c.name,
      role,
      ...(c.name !== hero && { purpose: `${job}；第 ${c.eps[0]} 集登场，出场 ${c.eps.length} 集，代表台词：“${clip(longest, 24)}”` }),
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
const heaviest = (list: Line[]) => list.reduce<Line | undefined>((best, l) => (!best || weight(l) > weight(best) ? l : best), undefined)

/** 在推荐位置 ±1 集内挑得分最高的一集；from 为最早能落的集 */
function snap(targets: number[], score: (ep: number) => number, total: number, from = 1) {
  const picked = targets.map((t) => {
    const cands = [t, t - 1, t + 1].filter((e) => e >= from && e <= total)
    return cands.reduce((best, e) => (score(e) > score(best) ? e : best), cands[0] ?? t)
  })
  return [...new Set(picked)].sort((a, b) => a - b)
}

/** 情绪：按关键词认这几行落在哪种情绪上 */
const MOODS: Table = [
  ['屈辱', ['拒绝', '逐出', '废物', '哄笑', '滚', '不配', '不要的东西']],
  ['危机', ['包围', '扑', '毒', '要挟', '刺', '绑', '威胁', '末日', '嫁祸', '陷害']],
  ['爽', ['击倒', '按在', '还你', '欢呼', '震飞', '溃败', '踏平', '哗然']],
  ['震惊', ['原来', '竟然', '真相', '属于', '到底是谁', '粉碎', '活了下来']],
  ['心碎', ['泪', '哭', '苍白', '颤', '心碎', '冰冷', '不信']],
  ['悔恨', ['后悔', '对不起', '赎', '回到我身边', '噩梦', '又错了']],
  ['期待', ['屏息', '等待', '我去', '证明给我看', '变强']],
]
const moodOf = (lines: Line[]) => top(MOODS, lines.map(plain).join('\n'), 1)[0] ?? ''

/** 情绪转折：前半场 → 后半场；没变就只写一种 */
function turnOf(lines: Line[]) {
  const half = Math.ceil(lines.length / 2)
  const a = moodOf(lines.slice(0, half))
  const b = moodOf(lines.slice(half))
  return a && b && a !== b ? `${a} → ${b}` : a || b
}

/** 一集写的是哪条线：感情 / 身份 / 对抗 / 成长 */
const THREADS: Table = [
  ['感情线', ['伴侣', '拒绝', '后悔', '对不起', '回到我身边', '吻', '爱']],
  ['身份线', ['项链', '血脉', '王族', '印记', '身份', '画像', '真相', '遗嘱', '鉴定']],
  ['对抗线', ['嫁祸', '毒', '陷害', '冷笑', '废物', '还你', '按在', '要挟']],
  ['成长线', ['变强', '证明', '训练', '击倒', '使者', '三年后']],
]

/** 去掉镜头标记（【特写】）和句末句号，叙述时用 */
const bare = (l: Line) => plain(l).replace(/^【[^】]*】\s*/, '').replace(/^字幕[：:]\s*/, '').replace(/。$/, '')

/** 叙述一行：动作直接用，台词写成「谁说……」 */
const told = (l: Line, n = 26) => (l.kind === 'dialogue' ? `${l.speaker}说「${clip(stripCue(l.text).replace(/。$/, ''), n - 4)}」` : clip(bare(l), n))

/** 拼句子：各段用句号连，已经以标点收尾的不再补 */
const sentences = (parts: (string | false | null | undefined | 0)[]) =>
  parts
    .filter((x): x is string => !!x)
    .map((x) => (/[。！？]$/.test(x) ? x : `${x}。`))
    .join('')

interface Scene {
  place: string
  lines: Line[]
}

/** 按场次切开一集：场次标题之前的行算第一场 */
function scenesOf(lines: Line[]): Scene[] {
  const out: Scene[] = []
  for (const l of lines) {
    if (l.kind === 'scene') out.push({ place: l.place, lines: [] })
    else if (out.length) out[out.length - 1].lines.push(l)
    else out.push({ place: '', lines: [l] })
  }
  return out.filter((s) => s.lines.length)
}

/**
 * 细拆一场：关键动作 + 逐句。每句记下情绪（这一句认不出就沿用上一句），情绪变了的那一句就是带来转折的核心台词；
 * 不转折、情绪相同的相邻几句并成一段（最多 4 句），转折那一句单独一行
 */
function beatOf(ep: number, s: Scene, i: number): SceneBeat {
  const action = heaviest(s.lines.filter((l) => l.kind === 'action')) ?? s.lines[0]
  const lines: LineBeat[] = []
  let mood = ''
  let run = 0
  for (const l of s.lines) {
    const text = l.kind === 'dialogue' ? `${l.speaker}：${l.text}` : `△ ${plain(l)}`
    // 开场几句认不出情绪的算铺垫，之后第一次出现情绪也算转折
    const m = moodOf([l]) || mood || '铺垫'
    const turn = !!mood && m !== mood
    mood = m
    const last = lines[lines.length - 1]
    if (last && !turn && !last.turn && last.emotion === m && run < 4) {
      last.text += `\n${text}`
      run++
    } else {
      lines.push({ text, emotion: m, turn })
      run = 1
    }
  }
  return { scene: `${ep}-${i + 1}${s.place ? ` ${s.place}` : ''}`, action: clip(bare(action), 40), lines }
}

/* ---------------------------------- 五个维度 ---------------------------------- */

/** 台词开头（）里的表演提示：表情、动作 */
const cueOf = (text: string) => /^[（(]([^）)]*)[）)]/.exec(text)?.[1] ?? ''

/** 截一句原文：短的整句保留（问号、叹号都留着）；长的先断在句号，再断在逗号，都不行就截断加省略号 */
function snip(text: string, n: number) {
  const t = text.replace(/。$/, '')
  if (t.length <= n) return t
  const head = t.slice(0, n)
  const stop = Math.max(head.lastIndexOf('。'), head.lastIndexOf('！'), head.lastIndexOf('？'))
  if (stop >= n / 3) return t.slice(0, stop + 1).replace(/。$/, '')
  const at = Math.max(head.lastIndexOf('，'), head.lastIndexOf('；'), head.lastIndexOf('、'))
  return at >= n / 2 ? head.slice(0, at) : `${head}…`
}

/**
 * 引原文（11/6：五个维度要落到具体的一句话、动作、表情）：台词写成 谁【表情】“台词”，动作、镜头写成【动作】。
 * 和 StoryPlay 拆解的引法一致：台词用“”，动作、舞台说明用【】
 */
function quote(l: Line, n = 40) {
  if (l.kind !== 'dialogue') return `【${snip(bare(l), n)}】`
  const cue = cueOf(l.text)
  return `${l.speaker}${cue ? `【${cue}】` : ''}“${snip(stripCue(l.text), n)}”`
}

/** 只引台词本身：“……” */
const said = (l: Line, n = 30) => `“${snip(l.kind === 'dialogue' ? stripCue(l.text) : bare(l), n)}”`

/** 节奏里每一段的简称：动作只写动作，台词写 谁“……” */
const short = (l: Line, n = 16) => (l.kind === 'dialogue' ? `${l.speaker}${said(l, n)}` : snip(bare(l), n))

/** 情绪轻重（-5 到 +5，刻度同 StoryPlay）：按这一段认出的情绪给基准分，只在内部比高低、判情绪结果和兑现程度，不写进拆解 */
const MOOD_SCORE: Record<string, number> = { 屈辱: -4, 心碎: -4, 危机: -3, 悔恨: -2, 震惊: -1, 期待: 1, 爽: 4 }
/** 情绪写给人看的说法（11/6：情绪不用数字，写成 期待 → 憋屈 → 憋屈到顶 这样） */
const MOOD_FEEL: Record<string, string> = { 屈辱: '憋屈', 心碎: '心寒', 危机: '紧张', 悔恨: '遗憾', 震惊: '震惊', 期待: '期待', 爽: '解气' }

/** 一段的情绪用词：压得最狠的加「到顶」，当众认证的大释放写「大爽」，认不出情绪的写「悬着」 */
const feelOf = (b: { mood: string; score: number }) => (b.score >= 5 ? '大爽' : b.score <= -5 ? `${MOOD_FEEL[b.mood] ?? '憋屈'}到顶` : (MOOD_FEEL[b.mood] ?? '悬着'))

/** 主角出手：主角或金手指的那一下（震飞、击倒、还你一次……） */
const STRIKE = [...KIND_WORDS.力量型, ...KIND_WORDS.武力型, '还你', '应声而断', '碎裂', '溃败', '踏平']
/** 出手之后旁人的反应 */
const REACT = ['哗然', '欢呼', '跪拜', '震惊', '愣', '屏息', '惊', '苍白', '溃败', '到底是谁', '竟', '摔得粉碎', '后悔']
/** 主角赢回了什么：按出手和确认那几句认 */
const GAINS: [RegExp, string][] = [
  [/跪拜|加冕|王冠|认亲|册封/, '身份和地位'],
  [/欢呼|哗然|救世主/, '当众的尊严和声望'],
  [/按在|还你|击倒|扣住|打脸/, '当面讨回尊严'],
  [/应声而断|挣断|逃出/, '自由'],
  [/震飞|溃败|击退|活了下来/, '脱险，活了下来'],
]
/** 反派背着主角做局 */
const SCHEME = ['计划', '嫁祸', '下毒', '陷害', '塞进', '要挟', '打电话']
/** 有人躲在暗处听见了 */
const EAVESDROP = /门外|偷听|屏住呼吸|躲在|退进黑暗|里间传来/
/** 真相揭开的那一句 */
const TRUTH = /原来|竟然|真相/
/** 局面急转直下：好不容易赢一点，马上出事 */
const REVERSAL = ['原来', '竟然', '真相', '刺', '毒', '没入', '倒地', '关进', '绑']

/** 拆五个维度要用到的全剧信息：主角、反派、金手指（底牌）、揭开的身份、伏笔 */
interface DimContext {
  hero: string
  villain?: string
  /** 主角要让谁追悔：拒绝过主角的感情线，没有就是反派 */
  target?: string
  gfKey?: string
  gfKeys: string[]
  truth?: string
  surface?: string
  /** 关键词第一次出现在第几集 */
  planted: Map<string, number>
  secrets: { key: string; from: number; to: number }[]
}

/** 一集里情绪的一段：多场的一场一段，只有一场的按情绪变化切 */
interface Beat {
  place: string
  lines: Line[]
  mood: string
  score: number
}

/** 一集按情绪切段：每一场里按情绪变化切开，同一场里分值相同的相邻段并掉；最多 5 段（留住最后一段） */
function beatsOf(scenes: Scene[], strikes: (l: Line) => boolean): Beat[] {
  // 主角（或金手指）出手的那一句算爽，话没说完（——）的那句不算情绪，别的按关键词认
  const mood = (lines: Line[]) => (lines.some(strikes) ? '爽' : moodOf(lines.filter((l) => !/——$/.test(plain(l)))))
  const beats = scenes.flatMap((s) => {
    const runs: Line[][] = []
    let cur = ''
    for (const l of s.lines) {
      const m = mood([l])
      if (runs.length && (!m || m === cur)) runs[runs.length - 1].push(l)
      else runs.push([l])
      cur = m || cur
    }
    // 一场开头认不出情绪的几行（交代、过场）并进后面那段
    if (runs.length > 1 && !mood(runs[0])) runs.splice(0, 2, [...runs[0], ...runs[1]])
    return runs
      .map((lines): Beat => {
        const m = mood(lines)
        const base = MOOD_SCORE[m] ?? 0
        const text = lines.map(plain).join('\n')
        // 冲突很重的再压一档；有当众认证的放到顶
        const score = base < 0 && conflictHits(text) >= 3 ? Math.max(-5, base - 1) : base > 0 && PROOF.test(text) ? 5 : base
        return { place: s.place, lines, mood: m, score }
      })
      .reduce<Beat[]>((out, b) => {
        const prev = out[out.length - 1]
        if (prev && prev.score === b.score) prev.lines.push(...b.lines)
        else out.push(b)
        return out
      }, [])
  })
  return beats.length > 5 ? [...beats.slice(0, 4), beats[beats.length - 1]] : beats
}

/** 情绪结果（StoryPlay 的五类）：实际释放 / 部分释放 / 悬念反弹 / 无效积压 / 情绪积压；开场的期待不算释放，只看压到最低之后有没有回来 */
function resultOf(beats: Beat[], hero: string) {
  const scores = beats.map((b) => b.score)
  const end = scores[scores.length - 1]
  if (Math.max(...scores) >= 4) return end < 0 ? '实际释放，集末转成悬念' : '实际释放'
  const low = scores.indexOf(Math.min(...scores))
  const back = beats.slice(low + 1).filter((b) => b.score > 0)
  if (!back.length) return '情绪积压'
  return back.some((b) => b.lines.some((l) => l.kind === 'dialogue' && l.speaker === hero)) ? '部分释放' : '悬念反弹'
}

/**
 * 首集和付费卡点集的五个维度（11/6）：情绪、节奏、信息差、期待感、爽点，每项一段话、都引原文（具体到一句台词 / 一个动作 / 一个表情）。
 * 首集另写开局切入方式（原来的前 3 秒、前 30 秒）、全剧最大的底牌、全剧总期待；付费卡点集的卡点写进节奏（卡在哪）和期待感（留下的钩子）
 */
function dimsOf(ep: number, lines: Line[], paywall: boolean, c: DimContext): EpisodeDims {
  const body = lines.filter((l) => l.kind !== 'scene')
  if (!body.length) return { emotion: '', rhythm: '', gap: '', expect: '', thrill: '' }
  const mentions = (l: Line, name: string) => (l.kind === 'dialogue' && l.speaker === name) || plain(l).includes(name)
  const isHero = (l: Line) => l.kind === 'dialogue' && l.speaker === c.hero
  const strikes = (l: Line) => (mentions(l, c.hero) || c.gfKeys.some((k) => plain(l).includes(k))) && hits(plain(l), STRIKE) > 0
  const scenes = scenesOf(lines)
  const beats = beatsOf(scenes, strikes)
  const first = body[0]
  const last = body[body.length - 1]
  const lastBeat = beats[beats.length - 1]
  const key = (b: Beat) => heaviest(b.lines) ?? b.lines[0]
  const ask = [...body].reverse().find((l) => l.kind === 'dialogue' && /[？?]/.test(l.text) && /谁|什么|为什么|到底|怎么|哪里/.test(l.text))
  const sceneOf = (l: Line) => scenes.find((s) => s.lines.includes(l))?.lines ?? body

  // 爽点先拆：铺垫 → 出手 → 确认（出手那一场里旁人的反应）→ 赢回 → 级别；期待感的兑现程度跟着它走
  const strikeAt = body.findIndex(strikes)
  const strike = body[strikeAt]
  const pad = heaviest(body.slice(0, strikeAt < 0 ? body.length : strikeAt).filter((l) => !isHero(l) && hits(plain(l), [...HUMILIATE, ...MAJOR, ...MINOR]) > 0))
  let level = '无'
  let thrill: string
  if (!strike) thrill = sentences(['本集无完整爽点，是给后面蓄力', `铺垫是${quote(pad ?? heaviest(body) ?? last)}`, `${c.hero}还没真正出手，没有赢回任何东西`, '级别：无'])
  else {
    const scene = sceneOf(strike)
    const after = scene.slice(scene.indexOf(strike) + 1)
    const confirm = after.find((l) => !isHero(l) && hits(plain(l), REACT) > 0) ?? after.find((l) => l.kind === 'dialogue' && !isHero(l))
    const text = [strike, confirm].map((l) => (l ? plain(l) : '')).join('\n')
    const atEnd = lastBeat.lines.includes(strike)
    level = PROOF.test(after.map(plain).join('\n')) ? 'T1 大爽' : !confirm ? (atEnd ? '卡点释放' : 'T3 微爽') : /欢呼|哗然|跪拜|救世主/.test(text) ? 'T2 中爽' : 'T3 微爽'
    thrill = sentences([
      `铺垫：${pad ? quote(pad) : '前几集一路被压着'}`,
      `出手：${quote(strike)}`,
      `确认：${confirm ? quote(confirm) : atEnd ? '结果没演出来，下一集才确认' : '没有旁人当场反应'}`,
      `赢回：${GAINS.find(([re]) => re.test(text))?.[1] ?? '一点主动'}`,
      `级别：${level}`,
    ])
  }

  // 情绪：不用数字（11/6），写成「期待 → 憋屈 → 憋屈到顶」这样的走向；每一段是哪一句压下去 / 放出来，集末停在哪，整体属于哪一类
  const low = Math.min(...beats.map((b) => b.score))
  let bottomed = false
  const words: string[] = []
  const steps = beats.map((b, i) => {
    const prev = beats[i - 1]
    const feel = feelOf(b)
    // 认不出情绪的一段：话没说完、留了问题就是悬住，否则情绪延续（不进走向）
    const hang = b.lines.some((l) => /——$|[？?]$/.test(plain(l)))
    const [word, how] =
      !b.mood && prev
        ? hang
          ? ['悬着', '情绪悬住']
          : ['', '情绪延续']
        : !prev
          ? [feel, feel]
          : b.mood === '震惊'
            ? hang
              ? ['悬着', '情绪悬住']
              : [feel, '真相砸下来，震惊']
            : b.score < prev.score
              ? [feel, b.score === low && b.score <= -4 ? `${bottomed ? '又压回谷底' : '压到最低'}，${feel}` : `情绪往下压，${feel}`]
              : b.score > prev.score
                ? b.score < 0
                  ? ['回了口气', '稍稍回了口气']
                  : [feel, prev.score < 0 ? `一下翻上来，${feel}` : `再往上走，${feel}`]
                : [feel, feel === feelOf(prev) ? `还是${feel}` : `转成${feel}`]
    if (b.score === low) bottomed = true
    // 相邻两段说法一样的，后一段写「更……」
    if (word) words.push(word === words[words.length - 1] ? `更${word}` : word)
    return `${quote(key(b), 30)}，${how}`
  })
  const feel = /[？?—]$/.test(plain(last)) ? '悬而未决' : (MOOD_FEEL[lastBeat.mood] ?? '悬而未决')
  const emotion = sentences([`走向：${words.join(' → ')}`, steps.join('；'), `集末停在${feel}`, `整体属于${resultOf(beats, c.hero)}`])

  // 节奏：几场、每段快慢、写透和压缩的、集末定格；首集写开局切入方式
  const pace = (b: Beat) => (b.lines.length >= 5 || (b.lines.length >= 4 && b.lines.filter((l) => l.kind === 'dialogue').length * 4 >= b.lines.length * 3) ? '慢' : '快')
  const shown = (b: Beat) => heaviest(b.lines.filter((l) => l.kind === 'action')) ?? key(b)
  const name = (b: Beat) => b.place || `「${short(shown(b), 10)}」这段`
  // 写透、一笔带过按场说；只有一场的不说
  const sceneBeats = scenes.length > 1 ? scenes.map((s) => ({ place: s.place, lines: s.lines, mood: '', score: 0 })) : []
  const long = [...sceneBeats].sort((a, b) => b.lines.length - a.lines.length)[0]
  const brisk = sceneBeats.find((b) => b !== long && b.lines.length <= 2 && conflictHits(b.lines.map(plain).join('\n')) > 0)
  // 最后一段只有集末那一句的，就是「卡」
  const paced = beats.length > 1 && lastBeat.lines.length === 1 && lastBeat.lines[0] === last ? beats.slice(0, -1) : beats
  let opening = ''
  if (ep === 1) {
    const budget = estimateChars(30)
    const within: Line[] = []
    let used = 0
    for (const l of body) {
      if (within.length && used >= budget) break
      within.push(l)
      used += plain(l).length
    }
    const base = body.find((l) => c.gfKeys.some((k) => plain(l).includes(k)) || /字幕|年前|回忆|闪回/.test(plain(l)))
    opening = sentences([
      `开局${openLabel(first)}：前 3 秒直接是${quote(first, 30)}${within.length > 1 ? `，前 30 秒接着${within.slice(1, 4).map((l) => quote(l, 20)).join('、')}` : ''}`,
      base ? `底牌第一次露面是${quote(base, 24)}${base.kind === 'action' ? '，只给画面不解释' : ''}` : '背景没有单独交代，边演边带',
    ])
  }
  const rhythm = sentences([
    opening,
    `本集 ${scenes.length || 1} 场：${paced.map((b) => `${pace(b)}（${scenes.length > 1 && b.place ? `${b.place}，` : ''}${short(shown(b))}）`).join('→')}→卡（${short(last, 18)}）`,
    [long && long.lines.length >= 3 && `${name(long)}写透（${long.lines.length} 句）`, brisk && `${name(brisk)}一笔带过`].filter(Boolean).join('，'),
    `${paywall ? '付费卡点' : '集末'}定格在${quote(last, 30)}`,
  ])

  // 信息差：揭破的、新埋下的、话没说完的、反派背着主角做的、谁都答不上来的问题；本集没有新的就写延续哪一条
  const items: string[] = []
  const cited = new Set<Line>()
  const add = (l: Line, text: string) => {
    if (cited.has(l)) return
    cited.add(l)
    items.push(text)
  }
  const others = c.villain ?? '对手'
  const eaves = body.find((l) => l.kind === 'action' && EAVESDROP.test(l.text))
  const revealed = c.secrets.find((s) => s.to === ep)
  if (revealed) {
    const l = body.find((x) => plain(x).includes(revealed.key) && hits(plain(x), REVEAL) > 0) ?? body.find((x) => plain(x).includes(revealed.key))!
    const spy = eaves && c.villain && mentions(eaves, c.villain)
    add(l, `揭破第 ${revealed.from} 集埋下的「${revealed.key}」：${quote(l)}；${spy ? `可${quote(eaves, 20)}，${c.villain}也知道了，${c.hero}不知道，属于“替主角急”` : `${c.hero}和观众知道了，${others}还不知道，属于“等主角出手”`}`)
  } else {
    const truth = body.find((l) => l.kind === 'dialogue' && TRUTH.test(l.text))
    if (truth && truth.kind === 'dialogue')
      add(
        truth,
        truth.speaker === c.hero
          ? `揭开真相：${quote(truth)}；${c.hero}${eaves && mentions(eaves, c.hero) ? '在暗处听见了' : '知道了'}，${others}不知道，属于“等主角出手”`
          : `揭开真相：${quote(truth)}；${truth.speaker}和观众知道了，${c.hero}还不知道，属于“替主角急”`,
      )
  }
  const planted = [...c.planted.entries()].find(([k, from]) => from === ep && k !== revealed?.key)
  if (planted) {
    const l = body.find((x) => plain(x).includes(planted[0]))!
    if (l === ask) add(l, `新埋下「${planted[0]}」：${quote(l)}，${ask.kind === 'dialogue' ? ask.speaker : '说话的人'}知道的比${c.hero}多，${c.hero}和观众都不知道答案，属于“一起猜”`)
    else if (c.gfKeys.includes(planted[0])) add(l, `新埋下「${planted[0]}」：${quote(l)}，观众看在眼里，${others}和众人都不知道这是${c.hero}的底牌，属于“等主角出手”`)
    else add(l, `新埋下「${planted[0]}」：${quote(l)}，现在谁都说不清它意味着什么，属于“一起猜”`)
  }
  const unsaid = body.find((l) => l.kind === 'dialogue' && /——$/.test(l.text))
  if (unsaid && unsaid.kind === 'dialogue') add(unsaid, `${quote(unsaid)}话没说完，只有${unsaid.speaker}知道后半句，${unsaid.speaker === c.hero ? '观众' : `${c.hero}和观众`}都不知道，属于“一起猜”`)
  const scheme = c.villain ? body.find((l) => mentions(l, c.villain!) && !mentions(l, c.hero) && hits(plain(l), SCHEME) > 0) : undefined
  if (scheme && !sceneOf(scheme).some((l) => mentions(l, c.hero))) add(scheme, `${c.villain}背着${c.hero}${quote(scheme)}，观众知道，${c.hero}不知道，属于“替主角急”`)
  if (ask && ask.kind === 'dialogue') add(ask, `${quote(ask)}，${ask.speaker}和观众都还不知道答案，属于“一起猜”`)
  const kept = items.slice(0, 2)
  let gap = kept.length === 2 ? `两条。一是${kept[0]}；二是${kept[1]}。` : sentences(kept)
  if (!gap) {
    const cont = [...c.planted.entries()].filter(([k, from]) => from < ep && body.some((l) => plain(l).includes(k))).sort((a, b) => a[1] - b[1])[0]
    const l = cont && body.find((x) => plain(x).includes(cont[0]))
    gap = sentences([cont && l ? `本集没有新的信息差，延续第 ${cont[1]} 集埋下的「${cont[0]}」这一条：${quote(l)}` : `本集没有新的信息差，延续${c.hero}的底牌还没揭开这一条（${quote(heaviest(body) ?? last, 24)}，${others}仍不知道）`])
  }
  if (ep === 1) {
    const reveal = c.secrets.find((s) => c.gfKeys.includes(s.key)) ?? c.secrets[0]
    const big = c.truth ? `${c.hero}其实是${c.truth}` : c.gfKey ? `${c.hero}握着「${c.gfKey}」` : ''
    gap = `全剧最大的底牌：${big ? `${big}${reveal ? `（第 ${reveal.to} 集揭开）` : ''}，${others}和众人都不知道` : '信息不足，剧本里还没认出来'}。${gap}`
  }

  // 期待感：画了什么饼、怎么加码、兑现到什么程度、集末钩子；首集写全剧总期待
  const vow = body.find((l) => isHero(l) && l.kind === 'dialogue' && (WANT.test(l.text) || /后悔|还你|等着/.test(l.text)))
  const insult = body.find((l) => l.kind === 'dialogue' && !isHero(l) && hits(plain(l), HUMILIATE) > 0)
  const danger = heaviest(body.filter((l) => moodOf([l]) === '危机'))
  const pie = vow
    ? `饼是${quote(vow)}这句话，观众等着看它兑现`
    : insult && insult.kind === 'dialogue'
      ? `饼是让${insult.speaker}为那句${said(insult)}付出代价`
      : danger
        ? `饼是${c.hero}能不能闯过${quote(danger)}这一关`
        : `饼是${c.hero}${c.truth ? '的身份什么时候揭开' : '什么时候翻身'}`
  // 加码：出手之前一步步压上来的那一句；出手就在开头的，看全集
  const before = strike && !beats[0].lines.includes(strike) ? body.slice(0, strikeAt) : body
  const pressure = heaviest(before.filter((l) => ![vow, insult, danger, last, strike].includes(l) && conflictHits(plain(l)) > 0))
  const scores = beats.map((b) => b.score)
  const reversed = beats.length > 1 && lastBeat.score < 0 && Math.max(...scores.slice(0, -1)) >= 2 && hits(lastBeat.lines.map(plain).join('\n'), REVERSAL) > 0
  const met = reversed ? '失控反转' : /T1|T2/.test(level) ? '完全满足' : level === '卡点释放' ? '差一点' : level === '无' ? '未兑现' : '半满足'
  const hook = `${paywall ? '付费卡点卡在' : '集末钩子是'}${quote(last, 30)}${ask && ask !== last ? `，留下的问题是${quote(ask, 24)}` : ''}`
  const total = `全剧总期待：看${c.surface ? `被当成“${c.surface}”的` : ''}${c.hero}${c.truth ? `揭开身世、成为${c.truth}` : c.gfKey ? `亮出「${c.gfKey}」翻身` : '翻身'}${c.target ? `，让${c.target}追悔莫及` : ''}`
  const expect = sentences([ep === 1 && total, `本集的${pie}`, pressure && `加码是${quote(pressure, 30)}`, `兑现程度：${met}`, hook])

  return { emotion, rhythm, gap, expect, thrill }
}

/**
 * 拆一部对标剧。第 1 集和付费卡点集（一卡和之后的每个付费卡点）写集纲 + 五个维度，第 1 集和一卡之间的几集逐场、逐句细拆（11/6），
 * 剧本仿写、视频转剧本一样拆。paywalls 是立项登记的付费集：登记了就按它定一卡和付费卡点集，不再从剧本里认（11/5）
 */
export function analyzeSource(source: SourceScript, paywalls: number[] = []): Breakdown {
  const episodes: EpisodeLines[] = source.episodes.map((e) => {
    const lines = e.text
      .split('\n')
      .filter((l) => !isCastLine(l))
      .map(parseLine)
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
  const female = hits(allText, ['伴侣', '狼后', '婚', '爱', '闺蜜', '千金', '总裁'])
  const male = hits(allText, ['战神', '兄弟', '龙王', '女婿', '首富', '老婆'])
  const she = female >= male ? '她' : '他'

  // 节奏：以需求文档的默认框架为起点，在附近挑冲突 / 揭秘最强的集；付费卡点立项登记过就照登记的
  const base = defaultRhythm(total)
  const registered = paywalls.filter((ep) => ep <= total)
  const rhythm: RhythmFrame = {
    // 第 1 集是免费抓眼球的，付费卡点最早落在第 2 集
    paywalls: registered.length ? registered : snap(base.paywalls, (ep) => epScore(ep, (t) => conflictHits(t) + hits(t, EMOTION)), total, Math.min(2, total)),
    twists: snap(base.twists, (ep) => epScore(ep, (t) => hits(t, REVEAL) + hits(t, SECRET_KEYS)), total),
    climaxFrom: base.climaxFrom,
  }
  // 一卡：第一个付费卡点。第 1 集和付费卡点集拆五个维度，两者之间的几集细拆到场景和核心台词，其余只写集纲（11/6）
  const firstPaywall = rhythm.paywalls[0] ?? total

  const planted = new Map<string, number>()
  const secrets: { key: string; from: number; to: number }[] = []
  // 每集最有分量的一行：只在拆解时用来讲冲突主线、故事简介，不存
  const keyLine = new Map<number, Line>()

  const rows: EpisodeBreakdown[] = episodes.map((e) => {
    const body = e.lines.filter((l) => l.kind !== 'scene')
    const first = body[0] ?? e.lines[0]
    const last = body[body.length - 1] ?? first
    const paywall = rhythm.paywalls.includes(e.ep)
    const twist = rhythm.twists.includes(e.ep)
    const event = heaviest(body) ?? first

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

    // 集纲：哪部分剧情（哪条线）、通过什么（本集最重的动作 / 台词）、表现了什么（情绪怎么转、关系怎么变），结尾留下什么
    const scenes = scenesOf(e.lines)
    const thread = top(THREADS, e.text, 1)[0] ?? '主线'
    const what = scenes
      .slice(0, 3)
      .map((s) => {
        const key = heaviest(s.lines.filter((l) => l.kind === 'action')) ?? s.lines[0]
        return `${s.place ? `${s.place}，` : ''}${told(key)}`
      })
      .join('；')
    // 关系变化只记在人物关系网里，集纲里不写（11/3 编剧评审）
    const voice = heaviest(body.filter((l) => l.kind === 'dialogue'))
    const turn = turnOf(body)
    const shows = turn && (turn.includes('→') ? `把情绪从${turn.replace(' → ', '推到')}` : `${turn}拉满`)
    const lastText = plain(last)
    const how = voice && voice.kind === 'dialogue' ? `通过${voice.speaker}一句「${clip(stripCue(voice.text).replace(/。$/, ''), 26)}」` : ''
    const flow = sentences([`${thread}：${what}`, [how, shows].filter(Boolean).join('，'), `结尾${hookLabel(lastText, paywall)}：${clip(bare(last), 24)}`])

    keyLine.set(e.ep, event)
    const conflict = Math.min(5, 1 + Math.round(conflictHits(e.text) * 0.8))
    return {
      ep: e.ep,
      flow,
      scenes: e.ep > 1 && e.ep < firstPaywall ? scenes.map((s, i) => beatOf(e.ep, s, i)) : [],
      openHook: `${openLabel(first)}：${clip(plain(first), 20)}`,
      event: clip(plain(event), 32),
      conflict,
      plant,
      payoff,
      endHook: `${hookLabel(lastText, paywall)}：${clip(lastText, 22)}`,
      paywall,
      emotion: Math.min(5, Math.max(1, Math.round(1.5 + hits(e.text, EMOTION) * 0.6 + conflict * 0.3 + (twist ? 0.8 : 0)))),
    }
  })

  /** 一段里最有分量的几集，按集号排 */
  const peaks = (list: EpisodeBreakdown[], n: number) =>
    [...list]
      .sort((x, y) => y.conflict + y.emotion - x.conflict - x.emotion || x.ep - y.ep)
      .slice(0, n)
      .sort((x, y) => x.ep - y.ep)

  const ranges = phaseRanges(total)
  const phaseRows = ranges.map(([from, to]) => rows.filter((r) => r.ep >= from && r.ep <= to))
  // 示例剧本用手写的参考拆解（sampleAnalysis.ts），演示各项该写成什么样；别的剧本按下面的规则粗拆，格式相同
  const sample = total === SAMPLE_EPISODES && ranges.length === SAMPLE_MAINLINE.length && SAMPLE_CAST.every((n) => cast.some((c) => c.name === n))

  /** 不带集号地讲一行：动作直接用，台词写成「谁说“……”」 */
  const narrate = (l: Line, n = 24) => (l.kind === 'dialogue' ? `${l.speaker}说“${brief(stripCue(l.text), n - 4)}”` : brief(bare(l), n))
  /** 这几集按顺序讲下来 */
  const story = (list: EpisodeBreakdown[], n: number, size = 24) => peaks(list, n).map((r) => narrate(keyLine.get(r.ep)!, size)).join('，')

  // 冲突主线：按默认比例分段，每段写这一段的梗概（类比阶段总览：讲故事，不逐集列）
  const mainLine: PlotBeat[] = MAIN_LINE.map((beat, i) => ({
    beat,
    range: rangeLabel(ranges[i]),
    content: sample ? SAMPLE_MAINLINE[i] : phaseRows[i].length ? sentences([story(phaseRows[i], 3)]) : '',
  }))

  const all = episodes.flatMap((e) => e.lines.filter((l) => l.kind !== 'scene').map((l) => ({ ep: e.ep, l })))
  const tones = top(TONE_WORDS, allText, 3)
  const genres = top(GENRE_WORDS, allText, 4)
  const relations = relationRows(cast, roles)
  const [secret] = secrets
  const ally = cast.find((c) => roles.get(c.name)?.includes('盟友'))?.name
  const early = rows.filter((r) => r.ep <= firstPaywall).map((r) => textOf.get(r.ep) ?? '').join('\n')
  const rejected = !!lover && /拒绝/.test(early)
  const expelled = /逐出([^\s，。！？]{2,6})/.exec(early)?.[1]

  // 主角被看轻的样子：别人骂主角的那句（「一个连狼形都化不出的废物」→「连狼形都化不出的废物」）
  const insult = all.map(({ l }) => (l.kind === 'dialogue' && l.speaker !== hero ? INSULT.exec(stripCue(l.text)) : null)).find(Boolean)
  const surface = insult?.[1]
  const surfaceWord = insult?.[2]
  // 揭开的身份：后面集里「X王族的后裔 / 继承人」最具体，其次是揭秘那句「属于 / 就是」后面的话
  const reveal = secret && all.find(({ ep, l }) => ep === secret.to && plain(l).includes(secret.key) && hits(plain(l), REVEAL) > 0)
  const heir = all.map(({ l }) => HEIR.exec(plain(l))?.[1]).find(Boolean)
  const owner = reveal && /(?:属于|就是|竟是|原来是|才是)([^，。！？]{2,12})/.exec(plain(reveal.l))?.[1]
  const truth = heir ?? (owner ? `${owner}的后人` : undefined)

  // 金手指：主角第一次露出的那件东西（伏笔关键词）；和它一起出现在揭秘那一集的关键词（项链 → 王族、胎记）算同一套
  const gfKey = secret?.key ?? [...planted.entries()].sort((a, b) => a[1] - b[1])[0]?.[0]
  const gfKeys = gfKey ? [gfKey, ...(secret ? SECRET_KEYS.filter((k) => k !== gfKey && (textOf.get(secret.to) ?? '').includes(k)) : [])] : []
  const gfLines = all.filter(({ l }) => gfKeys.some((k) => plain(l).includes(k)))
  const heroFights = all.filter(({ l }) => l.kind === 'action' && l.text.includes(hero) && hits(l.text, KIND_WORDS.武力型) > 0)
  const gfText = gfLines.map(({ l }) => plain(l)).join('\n')
  const kinds = GOLDEN_FINGER_KINDS.map((k) => k.label).filter((k) => (k === '武力型' ? heroFights.length > 0 : hits(gfText, KIND_WORDS[k]) > 0))
  const ABILITY: Partial<Record<GoldenFingerKind, string>> = { 力量型: `「${gfKey}」之力`, 身份型: truth ?? `「${gfKey}」背后的身份`, 武力型: '自身战力', 智谋型: '洞察与手艺', 先知型: '先知先觉' }
  // 每项能力是什么：一句话说清，类型只用来挑能力，不写出来（11/4 标注：金手指不分类型，讲清能力是什么）
  const WHAT: Record<GoldenFingerKind, string> = {
    力量型: `「${gfKey}」里藏着的力量，关键时刻护住${hero}`,
    武力型: `${hero}自己的身手，不靠外力也能打`,
    幸运型: `关键时刻总能撞上好运`,
    身份型: `${hero}${truth ? `其实是${truth}` : '另有一重身份'}${surface ? `，身份揭开前被当成${surface}` : ''}`,
    财富型: `${hero}手里握着旁人不知道的财富`,
    智谋型: `${hero}能看穿别人看不出的门道`,
    系统型: `${hero}绑定了系统，完成任务拿奖励`,
    先知型: `${hero}知道接下来会发生什么`,
  }
  const origin = gfLines.map(({ l }) => /(?:母亲|父亲|师父|外婆|奶奶|祖母|爷爷|师门)留下的[^，。！？]{0,6}/.exec(plain(l))?.[0]).find(Boolean)
  const gfFirst = gfLines[0]
  const proof = all.find(({ l }) => PROOF.test(plain(l))) ?? reveal
  const steps = [...gfLines, ...heroFights].sort((a, b) => a.ep - b.ep).filter((x, i, list) => list.findIndex((y) => y.ep === x.ep) === i).slice(0, 6)
  const abilities = kinds.length ? kinds.slice(0, 3) : (['力量型'] as GoldenFingerKind[])
  /** 引原文时去掉句末标点，后面要接（第 N 集） */
  const cite = ({ ep, l }: (typeof all)[number]) => `${narrate(l, 26).replace(/[。！？；，、]+$/, '')}（第 ${ep} 集）`
  const limits = new Set<(typeof all)[number]>()
  const goldenFinger = gfFirst
    ? [
        `金手指：「${gfKey}」${heir ? `与${heir}这重身份` : ''}`,
        `首次出现：第 ${gfFirst.ep} 集（${brief(bare(gfFirst.l), 26)}）。`,
        '核心能力：',
        ...abilities.flatMap((k, i) => {
          const pool = k === '武力型' ? heroFights : gfLines
          // 身份型能做到的是揭开和认证那两下，其余看这一类的关键词
          const uses = (k === '身份型' ? [reveal, proof].filter((x, j, list): x is (typeof all)[number] => !!x && list.indexOf(x) === j) : pool.filter(({ l }) => hits(plain(l), KIND_WORDS[k]) > 0)).slice(0, 3)
          const first = uses[0] ?? gfFirst
          // 条件与限制：每项用不同的一句，不和首次出现、能做到重复
          const limit = pool.find((x) => x !== gfFirst && !uses.includes(x) && !limits.has(x) && hits(plain(x.l), LIMIT_WORDS) > 0)
          if (limit) limits.add(limit)
          const from = k === '身份型' && secret ? `第 ${secret.from} 集埋下「${secret.key}」，第 ${secret.to} 集揭开` : i === 0 && origin ? origin : `第 ${first.ep} 集第一次用上`
          return [
            `· ${ABILITY[k] ?? `「${gfKey}」`}：${WHAT[k]}。`,
            `  来历：${from}。`,
            `  能做到：${(uses.length ? uses : [first]).map(cite).join('；')}。`,
            `  条件与限制：${limit ? cite(limit) : '剧本里没写明，待补充：什么时候能用、用了有什么代价'}。`,
          ]
        }),
        '表现方式：',
        `· 首集展示：${gfFirst.ep === 1 ? brief(bare(gfFirst.l), 26) : `第 1 集还没露面，第 ${gfFirst.ep} 集才出现：${brief(bare(gfFirst.l), 20)}`}。`,
        steps.length > 1 && `· 渐进释放：${steps.map(({ ep, l }) => `第 ${ep} 集${brief(bare(l), 16)}`).join(' → ')}。`,
        proof && `· 权威认证：第 ${proof.ep} 集${brief(bare(proof.l), 26)}。`,
        `与主线强相关：「${gfKey}」服务于打脸和${lover ? '情感反转' : '身份反转'}。前期被隐藏，${hero}被当成${surface ?? '谁都能踩一脚的人'}受尽羞辱；后期逐步释放，成为打脸${villain ?? '对手'}${lover ? `、让${lover}追悔` : ''}的武器。`,
      ]
        .filter(Boolean)
        .join('\n')
    : '待补充：没认出明显的金手指，请对照剧本手填：金手指是什么、怎么来的、能做到什么、什么时候能用、有什么代价'

  // 核心亮点（也就是期待值）：核心爽点、主线任务（前十集）、情感双线、子类型特征
  const firstTen = Math.min(10, total)
  const relOf = (name?: string) => (name ? relations.find((r) => [r.a, r.b].includes(hero) && [r.a, r.b].includes(name)) : undefined)
  const lines2 = [
    lover && `· ${hero}与${lover}（${relOf(lover)?.kind || '感情线'}）：${relOf(lover)?.label || '关系从对立走向转变'}；观众等待${lover}知道真相后的反应。`,
    ally && `· ${hero}与${ally}（${relOf(ally)?.kind || '盟友'}）：${relOf(ally)?.label && relOf(ally)?.label !== relOf(ally)?.kind ? relOf(ally)!.label : '一路站在主角这边'}。`,
  ].filter(Boolean)
  const ladder = all.filter(({ ep, l }) => ep <= (ranges[2]?.[1] ?? total) && hits(plain(l), HUMILIATE) > 0).slice(0, 5)
  const traits = [
    surface && `· ${surfaceWord}伪装：${hero}被当成${surface}，被所有人看不起，形成扮猪吃虎的反差。`,
    gfFirst && `· 「${gfKey}」金手指：第 ${gfFirst.ep} 集首次出现${secret ? `，第 ${secret.to} 集揭开来历` : ''}，一步步释放。`,
    ladder.length > 1 && `· 打脸阶梯式羞辱：${ladder.map(({ l }) => narrate(l, 12)).join(' → ')}，羞辱层层升级。`,
    secret && `· 身份反转：第 ${secret.from} 集埋下「${secret.key}」，第 ${secret.to} 集揭开${truth ? `——${hero}是${truth}` : ''}。`,
  ].filter(Boolean)
  const highlights = [
    `核心爽点：你以为${hero}是${surface ?? '谁都能踩一脚的小人物'}，其实${she}${truth ? `是${truth}` : gfKey ? `握着「${gfKey}」这张底牌` : '另有底牌'}。`,
    `主线任务（${firstTen === 10 ? '前十集' : `第 1–${firstTen} 集`}）：${rows
      .filter((r) => r.ep <= firstTen)
      .map((r) => narrate(keyLine.get(r.ep)!, 16))
      .join(' → ')}。`,
    ...(lines2.length ? [lines2.length > 1 ? '情感双线：' : '情感线：', ...lines2] : []),
    ...(traits.length ? [`子类型特征（${[...genres, ...tones].slice(0, 4).join(' + ') || '待补充'}）：`, ...traits] : []),
  ].join('\n')

  // 世界观：总分写法，先总说整个世界，再分阵营设定、主要地点（私设的专有名词写细）
  const rules = WORLD_RULES.filter(([re]) => re.test(allText)).map(([, t]) => t)
  const camps = [...allText.matchAll(CAMP)]
    .map((m) => m[1])
    .filter((name) => !GENERIC_CAMPS.includes(name) && !/[上的了在和与把被全]/.test(name))
    .reduce((m, name) => m.set(name, (m.get(name) ?? 0) + 1), new Map<string, number>())
  // 「出银月族」这种是正则多吃了一个字：已有更常见的「银月族」就不要
  const campList = [...camps.entries()]
    .filter(([name, n]) => ![...camps.entries()].some(([other, m]) => other !== name && name.endsWith(other) && m >= n))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name]) => name)
  const campLines = campList.map((name) => {
    const mention = all.find(({ l }) => plain(l).includes(name))!
    const members = cast.filter((c) => all.some(({ l }) => l.kind === 'dialogue' && l.speaker === c.name && l.text.includes(name))).map((c) => c.name)
    return `· ${name}：${members.length ? `${members.slice(0, 3).join('、')}所在的一方；` : ''}第 ${mention.ep} 集起出现，${brief(bare(mention.l), 26)}。`
  })
  const placeScenes = new Map<string, { eps: number[]; lines: Line[] }>()
  for (const e of episodes)
    for (const s of scenesOf(e.lines)) {
      if (!s.place) continue
      const cur = placeScenes.get(s.place) ?? { eps: [], lines: [] }
      if (!cur.eps.includes(e.ep)) cur.eps.push(e.ep)
      cur.lines.push(...s.lines)
      placeScenes.set(s.place, cur)
    }
  const placeLines = [...placeScenes.entries()]
    .sort((a, b) => b[1].eps.length - a[1].eps.length || a[1].eps[0] - b[1].eps[0])
    .slice(0, 5)
    .map(([place, { eps, lines }]) => {
      const camp = campList.find((c) => place.includes(c))
      return `· ${place}：${camp ? `${camp}的地盘，` : ''}第 ${eps.slice(0, 3).join('、')} 集的戏在这里——${narrate(heaviest(lines) ?? lines[0], 24)}。`
    })
  const world = [
    `世界总览：${genres.length ? `${genres.slice(0, 2).join('、')}题材的世界` : '故事发生的世界'}${rules.length ? `：${rules.join('，')}` : ''}${secret ? `；「${secret.key}」牵出的旧事是全剧的根` : ''}。`,
    ...(campLines.length ? ['阵营设定：', ...campLines] : []),
    ...(placeLines.length ? ['主要地点：', ...placeLines] : []),
  ].join('\n')

  // 故事简介：一段话把整个故事从头讲到尾（主角处境 → 谁逼主角 → 转机 → 高潮 → 结局），不分段、不带集号
  const LINK = ['', '随后，', '接着，', '紧接着，', '此后，']
  const summary = [
    ...phaseRows.map((list, i) => (list.length ? sentences([`${i === phaseRows.length - 1 && i > 0 ? '最终，' : LINK[Math.min(i, LINK.length - 1)]}${story(list, i === 0 ? 2 : 3, 28)}`]) : '')),
    truth || surface ? `${hero}${surface ? `从“${surface}”` : ''}成为${truth ?? '人人敬畏的人'}。` : '',
  ].join('')

  // 核心设定：一句话概括整个故事
  const plight = [rejected && `被${lover}当众拒绝`, expelled && `逐出${expelled}`].filter(Boolean).join('、')
  const target = rejected ? lover : villain
  const coreSetup = `${plight ? `${plight}的` : ''}${surfaceWord ? `“${surfaceWord}”` : ''}${hero}，${gfKey ? `靠「${gfKey}」一路反击` : '一步步夺回主动'}${truth ? `，揭开身世——${she}是${truth}` : ''}${target ? `，让${target}追悔莫及` : ''}。`

  // 主角拆细（11/4 标注）：身份、背景、金手指、动机、缺陷、弧光、按冲突主线分段的事件、代表台词；第五轮（#69）页面上只留简介、身份、金手指、动机
  const heroLines = all.filter(({ l }) => (l.kind === 'dialogue' && l.speaker === hero) || (l.kind === 'action' && l.text.includes(hero)))
  const heroSays = heroLines.filter(({ l }) => l.kind === 'dialogue')
  const want = heroSays.find(({ l }) => WANT.test(stripCue(l.text)))
  const opening = heroLines[0]
  const characters = characterRows(cast, roles).map((c): BenchmarkCharacter => {
    if (c.name !== hero) return sample && SAMPLE_PURPOSE[c.name] ? { ...c, purpose: SAMPLE_PURPOSE[c.name] } : c
    if (sample) return { ...c, ...SAMPLE_HERO }
    const trait = c.personality.split('、')[0]
    return {
      ...c,
      intro: `${[plight && `${plight}的`, surfaceWord && `“${surfaceWord}”`].filter(Boolean).join('')}${hero}，${gfKey ? `靠「${gfKey}」一路反击` : '一步步夺回主动'}${truth ? `，最终揭开身世：${she}是${truth}` : ''}${lover ? `；和${lover}的感情线从${rejected ? '被拒绝' : '误会'}走到${rejected ? '对方追悔' : '和解'}` : ''}。`,
      profile: `开局：${surface ? `被当成${surface}` : plight || '处境低微，谁都能踩一脚'}${truth ? `；真实身份：${truth}` : ''}`,
      background: sentences([plight, opening && `第 ${opening.ep} 集登场：${narrate(opening.l, 30)}`, secret && `第 ${secret.from} 集埋下的「${secret.key}」牵出${she}的身世${truth ? `：${truth}` : ''}`]),
      ability: gfKey ? `「${gfKey}」${heir ? `与${heir}这重身份` : ''}：第 ${gfFirst?.ep ?? 1} 集首次出现；能力是什么、能做到什么见故事梗概的「金手指」` : '待补充',
      goal: want ? `第 ${want.ep} 集${hero}说“${brief(stripCue(want.l.text), 28)}”：${rejected ? '先活下去、变强，向看不起自己的人证明' : '先站稳脚跟，再一步步反击'}` : '待补充：对照剧本写主角眼下想做成的事',
      desire: `${truth ? `夺回本该属于${she}的身份（${truth}）` : '夺回尊严'}${lover ? `，被${lover}坚定地选择` : ''}`,
      fear: rejected ? '再一次被最信任的人当众抛弃' : '再一次被踩进泥里、没人站在自己这边',
      flaw: FLAW_OF[trait] ?? '待补充：对照剧本写主角性格上的短板，要能推动冲突',
      arc: `${surface ? `被当成${surface}` : '被看轻'} → ${gfKey ? `握住「${gfKey}」一步步反击` : '一步步反击'} → ${truth ? `成为${truth}` : '赢回尊严'}`,
      events: mainLine
        .map((b, i) => {
          const [from, to] = ranges[i]
          const mine = heroLines.filter(({ ep }) => ep >= from && ep <= to)
          const keys = [...mine].sort((x, y) => weight(y.l) - weight(x.l) || x.ep - y.ep).slice(0, 2).sort((x, y) => x.ep - y.ep)
          return `${b.beat}（${b.range}）：${keys.length ? keys.map((k) => narrate(k.l, 26)).join('，') : `${hero}没有正面戏份`}`
        })
        .join('\n'),
      quotes: heroSays
        .filter((x, i, list) => list.findIndex((y) => stripCue(y.l.text) === stripCue(x.l.text)) === i)
        .sort((x, y) => weight(y.l) - weight(x.l) || stripCue(y.l.text).length - stripCue(x.l.text).length)
        .slice(0, 5)
        .sort((x, y) => x.ep - y.ep)
        .map(({ ep, l }) => `第 ${ep} 集：${stripCue(l.text)}`)
        .join('\n'),
    }
  })

  const linesOf = new Map(episodes.map((e) => [e.ep, e.lines]))
  const dimContext: DimContext = { hero, villain, target, gfKey, gfKeys, truth, surface, planted, secrets }

  const synopsis: Synopsis = {
    audience: female >= male ? '女频：情感线主导，18–45 岁女性' : '男频：逆袭打脸主导',
    genre: genres.join(' / ') || '待补充',
    coreSetup,
    style: tones.length ? `${tones.join(' + ')}，短场景快切，每集结尾必留钩子` : '待补充',
    world,
    goldenFinger,
    highlights,
    summary,
    paywalls: `共 ${rhythm.paywalls.length} 个付费点：第 ${rhythm.paywalls.join('、')} 集；多卡在${[villain && `${villain}的阴谋即将得逞`, lover && `${hero}与${lover}关系转折`, '身份即将揭晓']
      .filter(Boolean)
      .slice(0, 2)
      .join('或')}的瞬间`,
    ...(sample ? SAMPLE_SYNOPSIS : {}),
  }

  return {
    synopsis,
    characters,
    relations,
    mainLine,
    rhythm,
    totalEpisodes: total,
    // 第 1 集和付费卡点集拆五个维度；示例剧本这几集的集纲、五个维度和一卡前的逐句细拆用手写的
    episodes: rows.map((r) => {
      const e = sample && SAMPLE_FLOWS[r.ep] ? { ...r, flow: SAMPLE_FLOWS[r.ep] } : r
      if (e.ep === 1 || e.paywall) return { ...e, dims: (sample && SAMPLE_DIMS[e.ep]) || dimsOf(e.ep, linesOf.get(e.ep) ?? [], e.paywall, dimContext) }
      return sample && e.scenes.length && SAMPLE_SCENES[e.ep] ? { ...e, scenes: SAMPLE_SCENES[e.ep] } : e
    }),
    review: { synopsis: 'pending', mainline: 'pending', characters: 'pending' },
    referencedAt: null,
    generatedAt: new Date().toISOString(),
  }
}
