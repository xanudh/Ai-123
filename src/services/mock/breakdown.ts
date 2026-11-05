/**
 * 对标剧拆解的本地模拟：按分集标记切分剧本，再用关键词规则粗拆四大板块。
 * 只用于演示流程与数据结构，接入大模型后由模型完成真正的阅读理解。
 */
import { GOLDEN_FINGER_KINDS } from '../../domain/constants'
import type { GoldenFingerKind } from '../../domain/constants'
import { MAIN_LINE } from '../../domain/pipeline'
import { defaultRhythm, estimateChars } from '../../domain/rhythm'
import { cnToNumber, isSceneHeading, parseDialogue, placeOf } from '../../domain/scriptFormat'
import type { BenchmarkCharacter, Breakdown, EpisodeBreakdown, LineBeat, PlotBeat, ProjectMode, Relation, RhythmFrame, SceneBeat, SourceScript, Synopsis } from '../../domain/types'
import { inferRelationKind, phaseRanges, rangeLabel } from '../../domain/work'
import { clip } from './rng'
import { SAMPLE_CARD, SAMPLE_CAST, SAMPLE_EPISODES, SAMPLE_HERO, SAMPLE_MAINLINE, SAMPLE_OPENING, SAMPLE_PURPOSE, SAMPLE_SCENES, SAMPLE_SYNOPSIS } from './sampleAnalysis'

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
  ['心碎', ['泪', '哭', '苍白', '颤', '心碎', '冰冷']],
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

/** 首集开场（11/4 第五轮标注 #68）：前 3 秒是第一个画面 / 第一句；前 30 秒按字数估，列出主要动作和画面 */
function openingOf(body: Line[]) {
  const first = body[0]
  if (!first) return { open3s: '', open30s: '' }
  const budget = estimateChars(30)
  const within: Line[] = []
  let used = 0
  for (const l of body) {
    if (within.length && used >= budget) break
    within.push(l)
    used += plain(l).length
  }
  const shots = within.filter((l) => l.kind === 'action')
  return {
    open3s: `${openLabel(first)}：${told(first, 40)}`,
    open30s: (shots.length >= 2 ? shots : within)
      .slice(0, 5)
      .map((l) => `· ${told(l, 40)}`)
      .join('\n'),
  }
}

/** 付费卡点集（一卡和之后的每个付费卡点）的卡点：卡在哪一刻（本集最后一行）、卡前情绪怎么推上去、留下的问题 */
function cardPointOf(body: Line[], scenes: Scene[]) {
  const last = body[body.length - 1]
  if (!last) return ''
  const tail = scenes[scenes.length - 1]?.lines ?? body
  const turn = turnOf(tail)
  const question = [...tail].reverse().find((l) => /[？?]/.test(plain(l)))
  return [
    `卡在：${told(last, 40)}`,
    turn && `卡前情绪：${turn.includes('→') ? turn : `${turn}拉满`}`,
    `留下的问题：${question ? told(question, 36) : `${hookLabel(plain(last), false)}——${clip(bare(last), 24)}，下一集才揭晓`}`,
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * 拆一部对标剧。视频仿写的第 1 集只拆前 3 秒、前 30 秒和钩子，不逐场逐句（11/4 第五轮）；剧本仿写第 1 集照样逐句拆
 */
export function analyzeSource(source: SourceScript, mode: ProjectMode = 'adaptation'): Breakdown {
  const fineFrom = mode === 'video' ? 2 : 1
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

  // 节奏：以需求文档的默认框架为起点，在附近挑冲突 / 揭秘最强的集
  const base = defaultRhythm(total)
  const rhythm: RhythmFrame = {
    // 第 1 集是免费抓眼球的，付费卡点最早落在第 2 集
    paywalls: snap(base.paywalls, (ep) => epScore(ep, (t) => conflictHits(t) + hits(t, EMOTION)), total, Math.min(2, total)),
    twists: snap(base.twists, (ep) => epScore(ep, (t) => hits(t, REVEAL) + hits(t, SECRET_KEYS)), total),
    climaxFrom: base.climaxFrom,
  }
  // 一卡：第一个付费卡点。第 1 集到一卡那一集细拆到场景和核心台词；之后的付费卡点集按一卡来（11/4 标注 #84），其余只写走向
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

    // 走向：哪部分剧情（哪条线）、通过什么（本集最重的动作 / 台词）、表现了什么（情绪怎么转、关系怎么变），结尾留下什么
    const scenes = scenesOf(e.lines)
    const thread = top(THREADS, e.text, 1)[0] ?? '主线'
    const what = scenes
      .slice(0, 3)
      .map((s) => {
        const key = heaviest(s.lines.filter((l) => l.kind === 'action')) ?? s.lines[0]
        return `${s.place ? `${s.place}，` : ''}${told(key)}`
      })
      .join('；')
    // 关系变化只记在人物关系网里，走向里不写（11/3 编剧评审）
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
      scenes: e.ep >= fineFrom && (e.ep <= firstPaywall || paywall) ? scenes.map((s, i) => beatOf(e.ep, s, i)) : [],
      // 首集拆前 3 秒、前 30 秒和钩子（钩子就是 endHook），付费卡点集（一卡和之后的）拆卡点
      ...(e.ep === 1 && openingOf(body)),
      ...(paywall && { cardPoint: cardPointOf(body, scenes) }),
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

  // 冲突主线：按默认比例分段，每段写这一段的梗概（类比粗纲：讲故事，不逐集列）
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
    // 示例剧本第 1 集到一卡用手写的逐句细拆，首集开场、一卡卡点也是手写的
    episodes: sample
      ? rows.map((r) => ({ ...r, ...(SAMPLE_SCENES[r.ep] && r.ep >= fineFrom && { scenes: SAMPLE_SCENES[r.ep] }), ...(r.ep === 1 && SAMPLE_OPENING), ...(r.ep === firstPaywall && { cardPoint: SAMPLE_CARD }) }))
      : rows,
    review: { synopsis: 'pending', mainline: 'pending', characters: 'pending' },
    referencedAt: null,
    generatedAt: new Date().toISOString(),
  }
}
