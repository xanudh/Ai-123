/**
 * 故事架构按依据链生成的本地模拟：先拆核心设定（原文写明 / 能推断 / 完全没有），再按页面顺序一项项推
 *（世界观 → 金手指 → 故事背景 → 核心亮点 → 主角人设 →（仿写另有创新点）→ 冲突主线（含节奏框架）→ 全局写作要求；主要势力 11/4 删掉，创新点原创不要），
 * 每一项只读编剧写的内容和排在它前面的项；题材常识（题材套件）只补依据里没有的，补的行标「补充」。
 * 接入大模型后由模型按 domain/basis.ts 的三段式表生成，这里只演示取数逻辑和标记方式。
 */
import { archBasis } from '../../domain/basis'
import { estimateChars, rhythmFromPhases } from '../../domain/rhythm'
import { alignRhythm, benchSegment } from '../../domain/align'
import { parseHeroCard } from '../../domain/cards'
import type { Architecture, ArchItem, ArchMark, Innovation, MarkSource, PlotBeat, Project, RhythmFrame } from '../../domain/types'
import { emptyArchitecture, phaseNames, projectPhases, rangeLabel, templatePhase } from '../../domain/work'
import { newId } from '../../lib/id'
import { CN_NAMES, EN_NAMES } from './kits'
import type { Gender, Kit } from './kits'
import { clip, hash, rng, shuffle } from './rng'
import { endingOf, fingerHead, fingerLines, fingerName, grudgeOf, identityOf, noModern, openingOf, secretOf, storyText, worldLead, worldLines } from './setting'
import { ctxOf, fill, kitOf } from './writer'

/* ---------------------------------- 拆核心设定 ---------------------------------- */

export interface LoglineParts {
  /** 主角那一句（原文） */
  hero: string
  /** 主角的称呼：真千金 / 普通女孩 */
  heroCore: string
  /** 核心困境（原文） */
  plight: string
  /** 反常规点（原文） */
  twist: string
  /** 制造困境的人（原文里的称呼） */
  foes: string[]
  /** 时代、地点、身份（原文里的词） */
  setting: string[]
  /** 目标（原文） */
  goal: string
  female: boolean | null
}

const PERSON =
  /(女孩|女人|女主|男人|男主|少年|少女|千金|新娘|新郎|废柴|弃妇|赘婿|女婿|医生|总裁|伴侣|继承人|传人|公主|皇子|王妃|将军|保姆|女佣|实习生|律师|刑警|杀手|孤女|寡妇|妻子|丈夫|母亲|父亲|她|他|阿尔法|天才|大佬|神医|战神|龙王|女儿|儿子|私生女|替身|主播|明星|助理)$/
const TWIST = /其实是|竟是|竟然|才是|原来|居然|却发现|却是|真实身份|真正身份|就是|唯一|隐藏|不知道|殊不知/
const FOES = ['前夫', '未婚夫', '丈夫', '闺蜜', '继母', '婆婆', '小三', '假千金', '全家', '家人', '族人', '阿尔法', '总裁', '渣男', '养父母', '亲生父母', '妹妹', '姐姐', '长老', '家族', '对手', '仇人', '上司', '同事', '反派']
const SETTING = ['古代', '王朝', '皇宫', '后宫', '江湖', '修仙', '仙门', '末世', '未来', '星际', '狼族', '族群', '豪门', '都市', '校园', '医门', '黑手党', '吸血鬼', '集团', '娱乐圈', '监狱', '医院', '军营', '北美', '小镇']
const GOAL = /(复仇|报仇|夺回|拿回|证明|守护|查清|揭开|逆袭|翻身|活下去|保住|救回|赢回|让[^，。；]{1,8}后悔|审判)[^，。；]*/
const FEMALE = /女|她|妻|千金|新娘|公主|王妃|母亲|姐|妹|寡妇|闺蜜/
const MALE = /男|他|赘婿|女婿|战神|龙王|少爷|皇子|将军|丈夫/

const trimEnd = (s: string) => s.replace(/[。.；;，,！!]+$/, '').trim()

/** 拆核心设定：原文写明的直接用；读不出的项留空，由后面推断或补充 */
export function splitLogline(text: string, audience?: Project['audience']): LoglineParts {
  const t = text.trim()
  const [front, ...after] = t.split(/——|--/)
  const clauses = front
    .split(/[，,；;。！!？?…]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const tail = after.join('，').trim()
  const twistClause = tail || clauses.find((c, i) => i > 0 && TWIST.test(c)) || ''
  const heroClause = clauses[0] ?? ''
  const cut = heroClause.lastIndexOf('的')
  const heroCore = cut > 0 && PERSON.test(heroClause) ? heroClause.slice(cut + 1) : PERSON.exec(heroClause)?.[0] ? heroClause : ''
  const plightParts = [...(cut > 0 && heroCore ? [heroClause.slice(0, cut)] : []), ...clauses.slice(1).filter((c) => c !== twistClause && !TWIST.test(c))]
  const female = FEMALE.test(heroClause) ? true : MALE.test(heroClause) ? false : audience === 'male' ? false : audience === 'female' ? true : null
  return {
    hero: heroClause,
    heroCore: heroCore || (female === false ? '男主' : '女主'),
    plight: trimEnd(plightParts.join('，')),
    twist: trimEnd(twistClause.replace(/^(而|但|却|可|然而)/, '').replace(/^(她|他)自己[，,]?/, '$1')),
    foes: FOES.filter((f) => t.includes(f)).filter((f, i, all) => !all.some((g, j) => j !== i && g.includes(f) && g !== f)),
    setting: SETTING.filter((s) => t.includes(s)),
    goal: GOAL.exec(t)?.[0] ?? '',
    female,
  }
}

/* ---------------------------------- 工具 ---------------------------------- */

export interface ItemDraft {
  text: string
  marks: ArchMark[]
}

const L = (text: string, src: MarkSource, from: string): ArchMark => ({ text, src, from })
const out = (lines: ArchMark[]): ItemDraft => ({ text: lines.map((l) => l.text).join('\n'), marks: lines })

const archOf = (p: Project): Architecture => p.work.architecture ?? emptyArchitecture(p.spec.totalEpisodes)

/** 句子里提到金手指时用的短说法：去掉「她才是 / 其实是」这类引子，「被调包的豪门真千金」→「被调包的豪门真千金」这张底牌 */
const cardOf = (text: string, n = 14) => {
  const quoted = /「([^「」]+)」/.exec(text)?.[1]
  const core = (quoted ?? text).replace(/^(她|他)?(自己)?[，,]?(才是|其实是|竟是|竟然是|就是|原来是|是)/, '').trim()
  return core ? `「${clip(core, n)}」这张底牌` : '底牌'
}

/** 某一项写成多行「标题：内容」时，取某个标题后面的内容 */
const field = (text: string, key: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith(`${key}：`))
    ?.slice(key.length + 1)
    .trim() ?? ''

const firstLine = (text: string) => text.split('\n').find((l) => l.trim())?.replace(/^[^：]{1,8}：/, '').trim() ?? ''

/** 题材常识补的内容（参考作品 11/4 删掉，不再按它限定范围） */
const common = (_p: Project) => '题材常识'

/** 起名：主角卡里先起好，人物设定拆卡时沿用；仿写避开对标剧人名 */
function namer(p: Project, seed = 0, taken: string[] = []) {
  const pool = p.spec.language === 'zh' ? CN_NAMES : EN_NAMES
  const r = rng(hash(p.id) + seed)
  const used = new Set([...(p.work.breakdown?.characters ?? []).map((c) => c.name), ...p.work.characters.map((c) => c.name), ...taken])
  const decks = { f: shuffle(r, pool.f), m: shuffle(r, pool.m) }
  return (g: Gender) => {
    const chosen = decks[g].find(([, zh]) => !used.has(zh)) ?? decks[g][0]
    used.add(chosen[1])
    return chosen[1]
  }
}

/** 主角的名字：人物设定里有主角就用，主角卡里写了就用，都没有现起一个 */
function heroNameOf(p: Project, parts: LoglineParts) {
  const card = parseHeroCard(archOf(p).heroSetup)
  const fromCard = card?.主角?.split(/[（(，,\s]/)[0]
  return p.work.characters.find((c) => c.role === '主角')?.name || fromCard || namer(p)(parts.female === false ? 'm' : 'f')
}

/* ---------------------------------- 各项 ---------------------------------- */

/** 金手指（11/4 写法）：首行写名字（不标类型），首次出现、核心能力（每项来历和能做到什么）、表现方式、与主线强相关 */
function goldenFingerOf(p: Project, parts: LoglineParts, kit: Kit): ItemDraft {
  const a = archOf(p)
  const ctx: Record<string, string> = { ...ctxOf(p, kit), hero: parts.heroCore }
  const lead = worldLead(a.world)
  const g = fingerLines(kit, (t) => fill(t, ctx), {
    twist: parts.twist,
    foe: parts.foes[0] ?? ctx.villain,
    hero: parts.heroCore,
  })
  const bench = p.mode !== 'original' ? p.work.breakdown?.synopsis.goldenFinger : ''
  const lines: ArchMark[] = [
    L(g.head, 'inferred', lead ? '核心设定、世界观设定' : '核心设定'),
    L(g.first, 'filled', common(p)),
    L('核心能力：', 'inferred', '核心设定'),
    ...g.abilities.map((x) => (x.kind === '身份型' && parts.twist ? L(x.line, 'given', '核心设定里的反常规点') : L(x.line, 'filled', common(p)))),
    L('表现方式：', 'inferred', '核心设定'),
    ...g.show.map((t) => L(t, 'filled', common(p))),
    L(g.tie, 'inferred', '核心设定'),
  ]
  if (bench?.trim()) lines.push(L(`参照对标剧：对标剧是${fingerHead(bench)}，力度保留，名字和能力换成我们的`, 'inferred', '对标剧拆解 · 金手指'))
  return out(lines)
}

/** 主角人设：写成人物卡，进人物设定时按卡拆 */
function heroSetupOf(p: Project, parts: LoglineParts, kit: Kit): ItemDraft {
  const a = archOf(p)
  const ctx = ctxOf(p, kit)
  const name = heroNameOf(p, parts)
  const gf = fingerName(a.goldenFinger)
  const ending = endingOf(a.background)
  const female = parts.female !== false
  const before = openingOf(a.background).replace(/。$/, '')
  const benchHero = p.mode !== 'original' ? p.work.breakdown?.characters.find((c) => c.role === '主角') : undefined
  return out([
    L(`主角：${name}（${parts.hero || parts.heroCore}）`, parts.hero ? 'given' : 'inferred', '核心设定'),
    L(`性别：${female ? '女' : '男'}`, parts.female === null ? 'inferred' : 'given', parts.female === null ? '目标受众' : '核心设定'),
    L(`年龄：${female ? 23 : 26} 岁`, 'filled', common(p)),
    L(`性格：${benchHero ? `${benchHero.personality}（对标剧主角的性格力度，人换成我们的）` : '外柔内刚，被逼到绝境时比谁都狠'}`, benchHero ? 'inferred' : 'filled', benchHero ? '对标剧人物设定' : common(p)),
    before
      ? L(`背景：${before}`, 'inferred', '故事背景')
      : L(`背景：${parts.plight || fill(kit.roles.hero.profile, ctx)}`, parts.plight ? 'given' : 'filled', parts.plight ? '核心设定' : common(p)),
    L(`能力：${gf || kit.prop}`, gf ? 'inferred' : 'filled', gf ? '金手指 / 核心卖点' : common(p)),
    L(`动机：表面想${parts.goal || '先活下去'}；心底渴望${fill(kit.roles.hero.desire, ctx)}；最怕再一次被最信任的人抛弃`, parts.goal ? 'inferred' : 'filled', parts.goal ? '核心设定' : common(p)),
    ending
      ? L(`弧光：被看轻的${parts.heroCore} → 握住底牌反击 → ${trimEnd(ending)}`, 'inferred', '故事背景（结局）')
      : L(`弧光：${kit.roles.hero.arc}`, 'filled', common(p)),
  ])
}

/** 世界观（11/4 写法）：总分写，世界总览 → 阵营设定 → 主要地点（私设的专有名词写细） */
function worldOf(p: Project, parts: LoglineParts, kit: Kit): ItemDraft {
  const ctx: Record<string, string> = { ...ctxOf(p, kit), hero: parts.heroCore }
  const identities = PERSON_WORDS.filter((w) => p.logline.includes(w))
  const bench = p.mode !== 'original' ? p.work.breakdown?.synopsis.world : ''
  const ancient = /古代|王朝|皇宫|后宫|江湖|修仙|仙门|宫廷|中世纪|时代剧|古装/.test(p.logline + p.genres.join())
  const lead = [fill(kit.setting.overview, ctx).replace(/[。；]$/, ''), identities.length > 1 && `${identities.join('、')}的身份差就是冲突的来源`, ancient && '不出现现代物品和现代用语'].filter(Boolean).join('；')
  const w = worldLines(kit, (t) => fill(t, ctx), lead)
  return out([
    L(w.lead, parts.setting.length ? 'inferred' : 'filled', parts.setting.length ? '核心设定、题材类型' : common(p)),
    L('阵营设定：', 'inferred', '题材类型'),
    ...w.camps.map((t) => L(t, 'filled', common(p))),
    L('主要地点：', 'inferred', '题材类型'),
    ...w.places.map((t) => L(t, 'filled', common(p))),
    ...(bench ? [L(`参照对标剧：阵营和地点的写细程度照对标剧（${clip(worldLead(bench), 20)}），名字、规则都换成我们的`, 'inferred', '对标剧拆解 · 世界观')] : []),
  ])
}

const PERSON_WORDS = ['真千金', '假千金', '千金', '总裁', '阿尔法', '继承人', '传人', '赘婿', '神医', '战神', '公主', '皇子', '王妃', '将军', '新娘', '私生女', '替身']

/** 故事背景（11/4 写法）：写成一段故事简介，从主角的处境讲到结局 */
function backgroundOf(p: Project, parts: LoglineParts, kit: Kit): ItemDraft {
  const a = archOf(p)
  const ctx: Record<string, string> = { ...ctxOf(p, kit), hero: parts.heroCore }
  const text = storyText(kit, (t) => fill(t, ctx), {
    hero: parts.heroCore,
    villain: parts.foes[0] ?? ctx.villain,
    she: parts.female === false ? '他' : '她',
    opening: parts.plight ? `${parts.heroCore}${parts.plight}` : undefined,
    secret: secretOf(a.world, a.goldenFinger) || parts.twist || fill(kit.secret, ctx),
    finger: fingerName(a.goldenFinger) || kit.prop,
    identity: identityOf(a.goldenFinger),
  })
  return out([L(text, parts.plight ? 'inferred' : 'filled', `${parts.plight ? '核心设定、' : ''}金手指 / 核心卖点、世界观设定`)])
}

/** 主打情绪：按题材类型、风格元素认；都认不出按短剧最常见的先虐后爽 */
const EMOTIONS: [RegExp, string][] = [
  [/虐|追妻|火葬场|替身|错爱/, '虐'],
  [/甜|宠|恋爱|婚|萌/, '甜'],
  [/复仇|逆袭|打脸|爽|战神|赘婿|重生|隐藏身份/, '爽'],
  [/悬疑|惊悚|规则|推理|反转|恐怖/, '紧张'],
  [/热血|燃|战斗|末世|修仙/, '燃'],
]

/** 对标剧一卡前的情绪走向：逐句细拆里每一场的开场情绪和转折句的情绪，相邻相同的并掉 */
const benchEmotions = (p: Project) => {
  const bd = p.work.breakdown
  const card = bd?.rhythm.paywalls[0] ?? 0
  return (bd?.episodes ?? [])
    .filter((e) => e.ep <= card)
    .flatMap((e) => (e.scenes ?? []).flatMap((s) => [s.lines.find((b) => b.emotion.trim()), ...s.lines.filter((b) => b.turn)]))
    .map((b) => b?.emotion.trim() ?? '')
    .filter((x, i, list) => x && x !== list[i - 1])
}

/** 核心亮点（11/4 标注 #71）：期待值（核心爽点、观众等着看什么、情感期待）和情绪（主打情绪、情绪怎么起伏） */
function highlightsOf(p: Project, parts: LoglineParts, kit: Kit): ItemDraft {
  const a = archOf(p)
  const ctx: Record<string, string> = { ...ctxOf(p, kit), hero: parts.heroCore }
  const finger = fingerName(a.goldenFinger)
  // 核心爽点先按核心设定里的反常规点，没写再拿世界观、金手指里的秘密
  const secret = parts.twist || secretOf(a.world, a.goldenFinger) || fill(kit.secret, ctx)
  const opening = openingOf(a.background).replace(/。$/, '')
  const ending = endingOf(a.background)
  const foe = parts.foes[0] ?? ctx.villain
  const she = parts.female === false ? '他' : '她'
  const tags = [...p.genres, ...p.tones].join('、')
  const emotions = [...new Set(EMOTIONS.filter(([re]) => re.test(tags + p.logline)).map(([, e]) => e))].slice(0, 3)
  const bench = p.mode !== 'original' ? p.work.breakdown?.synopsis.highlights?.trim() : ''
  const benchChain = p.mode !== 'original' ? benchEmotions(p) : []
  const lines: ArchMark[] = [
    L('期待值：', 'inferred', '核心设定'),
    L(
      `· 核心爽点：你以为${parts.heroCore}是${fill(kit.setting.surface, ctx)}，其实${clip(trimEnd(secret).replace(/^(她|他)/, ''), 30)}。`,
      parts.twist ? 'given' : 'filled',
      parts.twist ? '核心设定里的反常规点' : common(p),
    ),
    L(
      `· 观众等着看：${finger ? `「${clip(finger, 14)}」第一次亮出来，` : ''}${foe}当众吃瘪；真相揭开那一刻，看不起${she}的人怎么后悔。`,
      finger || a.background.trim() ? 'inferred' : 'filled',
      finger ? '金手指 / 核心卖点、故事背景' : a.background.trim() ? '故事背景' : common(p),
    ),
    L(`· 情感期待：${ctx.lover}知道真相后的反应——${clip(kit.roles.lover.arc, 24)}。`, 'filled', common(p)),
    L('情绪：', 'inferred', '风格元素'),
    emotions.length
      ? L(`· 主打情绪：${emotions.join(' + ')}`, 'inferred', '题材类型、风格元素')
      : L('· 主打情绪：先虐后爽', 'filled', common(p)),
    L(
      `· 情绪走向：先压到谷底（${clip(opening || parts.plight || '被逼到绝境', 20)}）→ 第一次反击，爽 → 真相揭开，情绪反转 → ${ending ? clip(trimEnd(ending), 20) : '结局全面翻盘'}。`,
      opening || ending ? 'inferred' : 'filled',
      opening || ending ? '故事背景' : common(p),
    ),
  ]
  if (bench) lines.push(L(`参照对标剧：对标剧的核心亮点是「${clip(bench.split('\n')[0].replace(/^核心爽点：/, ''), 24)}」，期待值的写法和力度照它，内容换成我们的`, 'inferred', '对标剧拆解 · 核心亮点'))
  if (benchChain.length > 1) lines.push(L(`参照对标剧：一卡前的情绪起伏是 ${benchChain.slice(0, 8).join(' → ')}，学起伏的节奏，不学事件`, 'inferred', '对标剧拆解 · 逐句细拆'))
  return out(lines)
}

/** 创新点（只有仿写有）：拿核心设定和写好的设定跟对标剧同一项比，写成「对标剧怎么做 → 我们怎么做」 */
function adaptInnovationsOf(p: Project, kit: Kit): { list: Innovation[]; marks: ArchMark[] } {
  const a = archOf(p)
  const bd = p.work.breakdown
  const hero = bd?.characters.find((c) => c.role === '主角')
  const prop = bd?.episodes.find((e) => e.plant)?.plant.split('：')[0]
  const core = bd && `核心设定：${clip(bd.synopsis.coreSetup, 30)}`
  // 设定都比完还不够 3 条时，「对标剧怎么做」从拆解里按顺序取（人物按 11/4 第五轮的拆法读主角简介）
  const theirs = [
    hero && `主角 ${hero.name}：${clip(hero.intro?.trim() || hero.profile?.trim() || hero.personality, 30)}`,
    prop && `关键道具：${prop}`,
    core,
    bd && `世界观：${clip(bd.synopsis.world, 30)}`,
    bd && `核心亮点：${clip(bd.synopsis.highlights, 30)}`,
  ].filter((x): x is string => !!x)
  const list: Innovation[] = []
  const marks: ArchMark[] = []
  if (p.logline.trim()) {
    const t = `核心设定：${clip(p.logline.trim(), 36)}`
    list.push({ id: newId(), theirs: core || '原剧走向', ours: t })
    marks.push(L(t, 'given', '核心设定'))
  }
  const SETTINGS: [string, string, string | null | undefined][] = [
    ['金手指', fingerHead(a.goldenFinger), bd && (bd.synopsis.goldenFinger?.trim() ? `金手指：${fingerHead(bd.synopsis.goldenFinger)}` : `核心亮点：${clip(bd.synopsis.highlights, 30)}`)],
    ['世界观', worldLead(a.world), bd && `世界观：${clip(worldLead(bd.synopsis.world), 30)}`],
    ['故事背景', firstLine(a.background), bd && `故事简介：${clip(bd.synopsis.summary.split('\n')[0], 30)}`],
    ['核心亮点', field(a.highlights ?? '', '· 核心爽点'), bd && `核心亮点：${clip(bd.synopsis.highlights, 30)}`],
  ]
  for (const [label, ours, theirs] of SETTINGS) {
    if (list.length >= 3) break
    if (!ours || list.some((x) => x.ours.includes(ours))) continue
    const t = label === '金手指' ? `金手指：${ours}` : `${label}：${clip(ours, 36)}`
    list.push({ id: newId(), theirs: theirs ?? '原剧设定', ours: t })
    marks.push(L(t, 'inferred', label === '金手指' ? '金手指 / 核心卖点' : label === '世界观' ? '世界观设定' : label))
  }
  while (list.length < 3) {
    const t = list.length % 2 ? `关键道具：${kit.prop}` : `世界观：${clip(kit.setting.overview, 30)}`
    list.push({ id: newId(), theirs: theirs[list.length] ?? '原剧设定', ours: t })
    marks.push(L(t, 'filled', '题材常识'))
  }
  return { list, marks }
}

/** 冲突主线：开局、结局照故事背景（故事简介的头尾）；中间按金手指升级、背景秘密在中段揭开、旧怨的幕后人出手来推 */
function mainLineOf(p: Project, parts: LoglineParts, kit: Kit, seed: number): { list: PlotBeat[]; marks: ArchMark[] } {
  const a = archOf(p)
  const ctx = ctxOf(p, kit)
  const heroName = field(a.heroSetup, '主角').split('（')[0] || parts.heroCore
  const gf = cardOf(fingerName(a.goldenFinger) || kit.prop)
  const foe = parts.foes[0] || ctx.villain
  const lover = ctx.lover
  const old = grudgeOf(a.background)
  const secret = secretOf(a.world, a.goldenFinger) || parts.twist || fill(kit.secret, ctx)
  const opening = openingOf(a.background)
  const ending = endingOf(a.background)
  const variant = seed % 2
  const beats: ArchMark[] = [
    opening ? L(`${trimEnd(opening)}；${foe}步步紧逼`, 'inferred', '故事背景（开局）') : L(`${parts.heroCore}${parts.plight || '被逼到绝境'}；${foe}步步紧逼`, parts.plight ? 'given' : 'filled', parts.plight ? '核心设定' : common(p)),
    L(variant ? `${heroName}暗中用${gf}布局，第一次反击就让${foe}当众吃瘪` : `${heroName}借${gf}第一次反击，${foe}当众吃瘪；${lover}开始注意到${heroName}`, 'inferred', '金手指 / 核心卖点'),
    L(`真相揭开：${clip(secret, 30)}；${heroName}与${lover}的关系彻底反转`, 'inferred', '故事背景 / 世界观设定（秘密放在中段揭开）'),
    old ? L(`幕后的人出手，${clip(old.replace(/^.*——/, ''), 20)}的旧账浮出水面；${heroName}与${lover}被迫并肩`, 'inferred', '故事背景（旧怨）') : L(`幕后的人出手，旧账浮出水面；${heroName}与${lover}被迫并肩`, 'filled', common(p)),
    ending ? L(trimEnd(ending), 'inferred', '故事背景（结局）') : L(fill(kit.ending, { ...ctx, hero: heroName }), 'filled', common(p)),
  ]
  const ranges = projectPhases(p)
  const names = phaseNames(p)
  const bd = p.mode !== 'original' ? p.work.breakdown : null
  const list = names.map((beat, i): PlotBeat => {
    const m = beats[templatePhase(i, ranges.length)]
    const j = bd ? benchSegment(p, i) : -1
    const keep = bd && j >= 0 ? `（段落结构对标剧「${bd.mainLine[j]?.beat ?? ''}」）` : ''
    return { ...(a.mainLine[i] ?? { beat }), beat, range: rangeLabel(ranges[i]), content: `${m.text}${keep}` }
  })
  const marks = list.map((b, i) => ({ ...beats[templatePhase(i, ranges.length)], text: b.content }))
  return { list, marks }
}

function writingRulesOf(p: Project): ItemDraft {
  const a = archOf(p)
  const chars = estimateChars(p.spec.episodeSeconds)
  const scenes = Math.min(5, Math.max(2, Math.round(chars / 330)))
  const voice = field(a.heroSetup, '性格')
  const hard = noModern(a.world)
  const bd = p.mode !== 'original' ? p.work.breakdown : null
  const top = (list: string[]) => [...new Set(list.map((x) => x.split('：')[0]).filter(Boolean))].slice(0, 3).join('、')
  const lines: ArchMark[] = [
    L(`每集 ${p.spec.episodeSeconds} 秒（约 ${chars} 字）、${scenes} 场戏以内；开场 5 秒内必须出现冲突或悬念`, 'given', '单集时长'),
  ]
  if (p.tones.length) lines.push(L(`风格：${p.tones.join('、')}`, 'inferred', '风格元素'))
  const mood = field(a.highlights ?? '', '· 主打情绪').split('（')[0]
  if (mood) lines.push(L(`情绪：每集至少给到一次「${mood}」，不连着几集只压不扬`, 'inferred', '核心亮点（情绪）'))
  lines.push(L(`每集结尾留钩子，同一种钩子不连续出现；第 ${p.rhythm.paywalls.slice(0, 4).join('、')} 集的付费卡点卡在情绪最高处`, 'inferred', '节奏框架'))
  if (voice) lines.push(L(`主角说话：${clip(voice, 20)}，台词少而狠`, 'inferred', '主角人设'))
  if (hard) lines.push(L('禁止：出现现代物品和现代用语', 'inferred', '世界观设定（硬规则）'))
  if (bd) {
    lines.push(L(`开场钩子常用${top(bd.episodes.map((e) => e.openHook)) || '悬念'}，结尾钩子常用${top(bd.episodes.map((e) => e.endHook)) || '悬念'}（学形式，不学内容）`, 'inferred', '对标剧拆解 · 每集钩子'))
    lines.push(L('不沿用对标剧人名，不照搬对标剧台词', 'given', '仿写必须遵守'))
  }
  lines.push(L('台词口语化，单句不超过 25 字；少用“仿佛、不禁、嘴角勾起”等 AI 味词', 'filled', '平台通用规范'))
  lines.push(L('人物言行不得偏离人物小传', 'filled', '平台通用规范'))
  return out(lines.map((l, i) => ({ ...l, text: `${i + 1}. ${l.text}` })))
}

/** 核心设定（仿写）：编剧写了草稿就从草稿出（没写用立项灵感），参照对标剧的核心设定写法；都没写时同题材里换零部件 */
function adaptLoglineOf(p: Project, kit: Kit): ItemDraft {
  const own = p.logline.trim() ? '编剧草稿' : p.idea.trim() ? '立项灵感' : ''
  const text = own ? `${trimEnd(firstLine(p.logline || p.idea))}。` : fill(kit.loglines[0], ctxOf(p, kit))
  return out([L(text, own ? 'given' : 'filled', own || common(p))])
}

/* ---------------------------------- 出口 ---------------------------------- */

export type ArchDraft = ItemDraft & { innovations?: Innovation[]; mainLine?: PlotBeat[]; rhythm?: RhythmFrame }

/**
 * 生成故事架构的一项：只读编剧写的和前面已有的项。
 * 文本项返回 text；创新点、冲突主线另外返回结构化的列表；节奏框架返回 rhythm。
 */
export function draftArchItem(p: Project, item: ArchItem, seed = 0): ArchDraft {
  const kit = kitOf(p)
  const parts = splitLogline(p.logline || p.idea, p.audience)
  const original = p.mode === 'original'
  // 整体框架、主要势力 11/4 第五轮删掉，不再生成（落到 default）；创新点只有仿写生成
  switch (item) {
    case 'logline':
      return original ? out([L(trimEnd(p.logline || p.idea) + '。', 'given', '编剧草稿')]) : adaptLoglineOf(p, kit)
    case 'goldenFinger':
      return goldenFingerOf(p, parts, kit)
    case 'heroSetup':
      return heroSetupOf(p, parts, kit)
    case 'world':
      return worldOf(p, parts, kit)
    case 'background':
      return backgroundOf(p, parts, kit)
    case 'highlights':
      return highlightsOf(p, parts, kit)
    case 'innovations': {
      if (original) return out([])
      const { list, marks } = adaptInnovationsOf(p, kit)
      return { text: list.map((x) => x.ours).join('\n'), marks, innovations: list }
    }
    case 'mainLine': {
      const { list, marks } = mainLineOf(p, parts, kit, seed)
      return { text: list.map((b) => b.content).join('\n'), marks, mainLine: list }
    }
    case 'rhythm': {
      const ranges = projectPhases(p)
      const rhythm = (!original && alignRhythm(p)) || rhythmFromPhases(ranges, p.spec.totalEpisodes)
      return { text: '', marks: [], rhythm: rhythm.paywalls.length ? rhythm : rhythmFromPhases(ranges, p.spec.totalEpisodes) }
    }
    case 'writingRules':
      return writingRulesOf(p)
    default:
      return out([])
  }
}

/** 按钮提示里的依据：三段式写全 */
export const itemBasis = (p: Project, item: ArchItem) => archBasis(p, item)
