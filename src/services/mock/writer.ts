/**
 * 仿写与写作环节的本地模拟：按题材套件 + 模板生成架构、人物、伏笔、情节大纲、分集蓝图与逐集剧本。
 * 输出结构与真实模型一致，内容只用于演示流程。
 */
import { BASIS_OF, MANUAL_CODES, TACITURN, TACITURN_MAX, forbiddenTerms, isStuck, itemKey, keptOf } from '../../domain/review'
import { estimateChars, nodeKind } from '../../domain/rhythm'
import { buildState, placeOf } from '../../domain/state'
import type {
  Architecture,
  Character,
  CharacterRole,
  DraftReview,
  EpisodeBlueprint,
  EpisodeScript,
  Foreshadow,
  ForeshadowType,
  HookType,
  Innovation,
  LineNote,
  OutlineEpisode,
  PlanEventKind,
  Plot,
  PlotBeat,
  Project,
  QaIssue,
  Relation,
  ReviewCode,
  ReviewItem,
  ScriptLine,
  ScriptLineKind,
  WriteBasisItem,
} from '../../domain/types'
import {
  blueprintOf,
  carryOf,
  foreshadowKey,
  foreshadowName,
  hookOf,
  latestDraft,
  newCharacter,
  prevHookOf,
  phaseNames,
  phaseOf,
  projectPhases,
  templatePhase,
  rangeLabel,
  scriptOf,
  wordCount,
} from '../../domain/work'
import { newId } from '../../lib/id'
import {
  AI_FILLERS,
  CLIMAX_EVENT,
  CN_NAMES,
  EN_NAMES,
  EVENT_TAILS,
  EXPAND_ACTION,
  EXPAND_SPEECH,
  HOOK_LINES,
  HOOK_ROTATION,
  PAYOFF_LINE,
  PAYWALL_EVENTS,
  PHASE_EVENTS,
  PHASE_SCENES,
  PLANT_LINE,
  SCENES,
  SYNONYMS,
  TWIST_EVENTS,
  kitFor,
  otherKits,
} from './kits'
import type { Gender, Kit, Slot, Speech } from './kits'
import { clip, hash, pick, rng, shuffle } from './rng'

/* ---------------------------------- 上下文 ---------------------------------- */

type Ctx = Record<string, string>

/** 替换模板占位符；设定本身也带占位符，最多展开三层 */
export function fill(tpl: string, ctx: Ctx) {
  let out = tpl
  for (let i = 0; i < 3 && out.includes('{'); i++) out = out.replace(/\{(\w+)\}/g, (m, key: string) => ctx[key] ?? m)
  return out
}

const SLOTS: Slot[] = ['hero', 'lover', 'villain', 'ally', 'mentor']

/** 还没有人物时用的定位称呼 */
function roleLabels(p: Project): Record<Slot, string> {
  const male = p.audience === 'male'
  return { hero: male ? '男主' : '女主', lover: male ? '女主' : '男主', villain: '反派', ally: '盟友', mentor: '知情人' }
}

interface Person {
  zh: string
  en: string
}

/** 项目里每个叙事位置对应的人物；缺人时用定位称呼兜底 */
function castOf(p: Project): Record<Slot, Person> {
  const labels = roleLabels(p)
  const chars = p.work.characters
  const of = (role: CharacterRole) => chars.filter((c) => c.role === role)
  const [ally, mentor] = of('配角')
  const found: Record<Slot, Character | undefined> = { hero: of('主角')[0], lover: of('暧昧对象')[0], villain: of('反派')[0], ally, mentor: mentor ?? ally }
  return Object.fromEntries(
    SLOTS.map((s) => {
      const c = found[s]
      return [s, c ? { zh: c.name, en: c.nameEn || c.name } : { zh: labels[s], en: labels[s] }]
    }),
  ) as Record<Slot, Person>
}

function ctxOf(p: Project, kit: Kit, lang: 'zh' | 'en' = 'zh'): Ctx {
  const cast = castOf(p)
  const names = Object.fromEntries(SLOTS.map((s) => [s, cast[s][lang]]))
  return { ...names, prop: lang === 'zh' ? kit.prop : kit.propEn, secret: kit.secret, identity: kit.identity, grudge: kit.grudge, place: kit.places[0].zh }
}

const kitOf = (p: Project) => kitFor(p.genres)

/* ---------------------------------- 故事架构 ---------------------------------- */

/** 五段式主线的模板：{opening} {ending} 取题材套件的开局与结局 */
const BEATS = [
  '{opening}；{hero}失去一切，身边只剩{prop}',
  '{hero}借{prop}第一次反击，{villain}当众吃瘪；{lover}开始注意到{hero}的变化',
  '真相揭开：{secret}；{hero}与{lover}的关系彻底反转',
  '{villain}狗急跳墙，{grudge}的旧账浮出水面；{hero}与{lover}被迫并肩',
  '{ending}',
]

/** 信息差写法：观众先知道真相，主角不知道 */
const IRONY_BEATS = [
  '{opening}；观众从第一场就知道{secret}，{hero}自己却被蒙在鼓里',
  '{hero}借{prop}第一次反击；{lover}暗中出手相助，却不肯说破',
  '{hero}撞见{lover}与{villain}密谈，误会到达顶点，真相只差一步',
  '{villain}利用误会步步紧逼，{grudge}的旧账浮出水面',
  '{ending}；{hero}终于知道{lover}这些年默默做的一切',
]

/** 开局反杀写法：第一集就反击，后面层层揭开更大的局 */
const STRIKE_BEATS = [
  '{opening}；当晚{hero}就借{prop}反将一军，{villain}措手不及',
  '{hero}步步为营，接连拆穿{villain}的局；{lover}从怀疑变成好奇',
  '真相揭开：{secret}；{hero}发现自己的反击只是别人棋局的一部分',
  '幕后的人终于现身——{grudge}；{hero}与{lover}联手破局',
  '{ending}',
]

const BEAT_SETS = [BEATS, IRONY_BEATS, STRIKE_BEATS]

const coreCtx = (p: Project, kit: Kit): Ctx => ({ ...ctxOf(p, kit), opening: kit.opening, ending: kit.ending })

/** 第 ep 集所在段对应的五段式模板段（段数可增删） */
function templateOf(p: Project, ep: number) {
  const ranges = projectPhases(p)
  return templatePhase(phaseOf(ep, ranges), ranges.length)
}

/** 按当前的段落名与分段展开冲突主线 */
function mainLineOf(p: Project, beats: string[], ctx: Ctx): PlotBeat[] {
  const ranges = projectPhases(p)
  return phaseNames(p).map((beat, i) => ({ beat, range: rangeLabel(ranges[i]), content: fill(beats[templatePhase(i, ranges.length)], ctx) }))
}

/** 创新点：对标剧（或同类爆款）怎么做 → 我们怎么做 */
function innovationsOf(p: Project, kit: Kit, ctx: Ctx, plan = ''): Innovation[] {
  const bench = p.work.breakdown
  const ranges = projectPhases(p)
  const out: Innovation[] = []
  if (bench) {
    const hero = bench.characters.find((c) => c.role === '主角')
    const prop = bench.episodes.find((e) => e.plant)?.plant.split('：')[0]
    if (hero) out.push({ id: newId(), theirs: `主角 ${hero.name}：${hero.personality}`, ours: `${ctx.hero}：${fill(kit.roles.hero.profile, ctx)}` })
    out.push({ id: newId(), theirs: `核心设定：${clip(bench.synopsis.coreSetup, 36)}`, ours: `核心秘密：${fill(kit.secret, ctx)}` })
    if (prop) out.push({ id: newId(), theirs: `关键道具：${prop}`, ours: `关键道具：${kit.prop}` })
    out.push({ id: newId(), theirs: bench.synopsis.world, ours: `世界观：${kit.world}` })
  } else {
    out.push(
      { id: newId(), theirs: '同类爆款：主角前 10 集被动挨打，靠虐撑留存', ours: `开局即反击：${kit.formula.split('，')[0]}` },
      { id: newId(), theirs: '同类爆款：身份揭晓压到结局', ours: `中点（${rangeLabel(ranges[2])}）就揭开「${fill(kit.secret, ctx)}」，后半程打信息差` },
      { id: newId(), theirs: '同类爆款：反派动机单薄', ours: `反派有完整动机：${fill(kit.grudge, ctx)}` },
    )
  }
  if (plan) out.push({ id: newId(), theirs: bench ? '原剧走向' : '常规走向', ours: clip(plan.replace(/\n/g, ' '), 48) })
  return out
}

/** AI 提出的一个改写方向：改写方案、核心设定、冲突主线、创新点一次给全，选中后整体录入 */
export interface Direction {
  id: string
  title: string
  /** 一句话说明改了什么 */
  pitch: string
  /** 改写方案 */
  plan: string
  /** 核心设定 */
  logline: string
  formula: string
  mainLine: PlotBeat[]
  innovations: Innovation[]
}

export function proposeDirections(p: Project, seed: number): Direction[] {
  const kit = kitOf(p)
  const r = rng(hash(p.id) + seed)
  const own = coreCtx(p, kit)
  const other = pick(r, otherKits(kit))
  const [first, second] = shuffle(r, kit.loglines)
  const bench = p.work.breakdown
  const worldOf = (k: Kit) => k.world.split('：')[0]

  const make = (title: string, logline: string, keep: string, change: string, k: Kit, beats: string[], extra?: Omit<Innovation, 'id'>): Direction => {
    const ctx = coreCtx(p, k)
    return {
      id: newId(),
      title,
      pitch: change,
      plan: `方向：${title}\n保留：${keep}\n改动：${change}\n爽点：${k.formula}`,
      logline,
      formula: k.formula,
      mainLine: mainLineOf(p, beats, ctx),
      innovations: [...(extra ? [{ id: newId(), ...extra }] : []), ...innovationsOf(p, k, ctx)].slice(0, 4),
    }
  }

  if (bench) {
    const structure = `对标剧的五段式主线与第 ${bench.rhythm.paywalls.join('、')} 集付费节奏`
    return [
      make('同题材升级', first, `保留${structure}`, `人物全部重塑；关键道具换成「${kit.prop}」；核心秘密改为「${fill(kit.secret, own)}」`, kit, BEATS),
      make(
        '题材迁移',
        pick(r, other.loglines),
        `保留${structure}，以及“被看轻 → 反击 → 身份揭晓”的情绪曲线`,
        `故事搬到「${worldOf(other)}」，爽点改为${other.formula.split('，')[0]}`,
        other,
        BEATS,
        { theirs: `原剧题材：${clip(bench.synopsis.genre, 24)}`, ours: `题材迁移到「${worldOf(other)}」` },
      ),
      make(
        '信息差反转',
        `${second.split('——')[0]}——但这一次，观众从第 1 集就知道${own.lover}的苦衷。`,
        '保留关键节点与付费卡点位置',
        '悬念从“主角不知道”改为“观众知道、主角不知道”，用虐点和误会撑中段',
        kit,
        IRONY_BEATS,
        { theirs: '悬念靠“主角不知道”', ours: '观众先知道真相，用误会和虐点撑中段' },
      ),
    ]
  }

  return [
    make('强化当前核心设定', p.logline || first, '保留你的核心设定与题材', `补上反常规点：${fill(kit.secret, own)}；爽点公式定为${kit.formula.split('，')[0]}`, kit, BEATS),
    make('同题材另一种开法', second, `保留「${kit.label}」题材与目标受众`, `开局改为第一集就反杀：${fill(kit.opening, own)}`, kit, STRIKE_BEATS, {
      theirs: '常规开局：主角先挨打，攒够委屈再反击',
      ours: '第一集当晚就反将一军，后面层层揭开更大的局',
    }),
    make('跨题材混搭', pick(r, other.loglines), '保留五段式冲突主线', `把「${worldOf(other)}」的世界观混进来，制造新鲜感`, other, BEATS, {
      theirs: `单一「${kit.label}」题材`,
      ours: `混搭「${worldOf(other)}」世界观`,
    }),
  ]
}

export interface IdeaReview {
  score: number
  verdict: string
  pros: string[]
  risks: string[]
  plan: string
}

export function evaluateIdea(p: Project, idea: string): IdeaReview {
  const text = idea.trim()
  const kit = kitOf(p)
  const ctx = ctxOf(p, kit)
  const bench = p.work.breakdown
  const pros: string[] = []
  const risks: string[] = []
  let score = 2

  if (text.length >= 20) {
    score++
    pros.push('想法具体，能直接落到人物和事件')
  } else {
    risks.push('想法偏短，建议补充：主角是谁、核心困境、反常规点')
  }
  if (/反转|身份|秘密|真相|重生|复仇|拒绝|背叛|契约|隐藏|血脉|继承/.test(text)) {
    score++
    pros.push('自带强冲突或身份差，适合短剧节奏')
  } else {
    risks.push('缺少明确的反转或身份差，前 10 集容易平')
  }
  if (bench) {
    const kept = bench.characters.map((c) => c.name).filter((n) => text.includes(n))
    if (kept.length) {
      risks.push(`仍出现对标剧人物名（${kept.join('、')}），仿写需全部替换，避免侵权风险`)
    } else {
      score++
      pros.push('人物层面已与对标剧拉开差异')
    }
    pros.push(`可沿用对标剧验证过的主线结构与第 ${bench.rhythm.paywalls.join('、')} 集付费节奏`)
  }
  if (p.genres.some((g) => text.includes(g))) pros.push('与立项题材一致')
  score = Math.min(5, Math.max(1, score))

  const keep = bench ? '对标剧的五段式冲突主线与付费卡点节奏' : '五段式冲突主线：开局困境 → 小反转 → 中点大反转 → 第二幕升级 → 高潮结局'
  return {
    score,
    verdict: score >= 4 ? '可行，建议按此推进' : score === 3 ? '基本可行，建议补强后推进' : '风险较高，建议先看看 AI 给出的方向',
    pros,
    risks,
    plan: `改写方案：${text.replace(/[。.]$/, '')}。\n保留：${keep}。\n改动：人物全部重塑；关键道具换成「${kit.prop}」；核心秘密为「${fill(kit.secret, ctx)}」。\n爽点：${kit.formula}。`,
  }
}

export interface ArchitectureDraft {
  logline: string
  formula: string
  mainLine: PlotBeat[]
  innovations: Innovation[]
}

export function draftArchitecture(p: Project, seed: number): ArchitectureDraft {
  const kit = kitOf(p)
  const r = rng(hash(p.id) + seed)
  const ctx = coreCtx(p, kit)
  const plan = (p.work.architecture?.plan || p.work.architecture?.idea || '').trim()
  return {
    logline: p.logline || pick(r, kit.loglines),
    formula: kit.formula,
    mainLine: mainLineOf(p, BEATS, ctx),
    innovations: innovationsOf(p, kit, ctx, plan),
  }
}

/** 只重写冲突主线：保留段落名与分段，每次换一种写法 */
export function draftMainLine(p: Project, seed: number): PlotBeat[] {
  const kit = kitOf(p)
  return mainLineOf(p, BEAT_SETS[seed % BEAT_SETS.length], coreCtx(p, kit))
}

/** 架构卡确认前的必填检查 */
export function architectureIssues(a: Architecture) {
  const issues: string[] = []
  const empty = a.mainLine.filter((b) => !b.content.trim()).map((b) => b.beat)
  if (empty.length) issues.push(`冲突主线缺少：${empty.join('、')}`)
  if (a.innovations.filter((i) => i.ours.trim()).length < 3) issues.push('创新点至少 3 条')
  return issues
}

/** 故事架构里可以单独让 AI 生成的段落 */
export type ArchitectureSection = 'world' | 'goldenFinger' | 'heroSetup' | 'writingRules'

const VIEWPOINT_RULES: Record<string, string> = {
  '第三人称 · 跟随主角': '镜头始终跟着主角，观众只知道主角知道的事',
  '第三人称 · 全知': '允许切到反派视角，制造“观众知道、主角不知道”的信息差',
  '第一人称 · 主角': '主角内心独白（VO）贯穿全剧，每集开场一句独白',
  多视角轮换: '主角 / 感情线 / 反派三视角轮换，每集以主角视角收尾',
}

export const viewpointRule = (viewpoint: string) => VIEWPOINT_RULES[viewpoint] ?? ''

/** 单集场次：按时长换算的字数，每场约 330 字，2–5 场 */
const sceneCountOf = (p: Project) => Math.min(5, Math.max(2, Math.round(estimateChars(p.spec.episodeSeconds) / 330)))

export function draftSection(p: Project, section: ArchitectureSection): string {
  const kit = kitOf(p)
  const ctx = ctxOf(p, kit)
  const a = p.work.architecture
  const hero = kit.roles.hero
  const { paywalls, twists, climaxFrom } = p.rhythm
  switch (section) {
    case 'world':
      return [
        `${kit.world}。`,
        `核心秘密：${fill(kit.secret, ctx)}`,
        `前情恩怨：${fill(kit.grudge, ctx)}`,
        `主要场景：${kit.places.map((pl) => pl.zh).join('、')}`,
      ].join('\n')
    case 'goldenFinger':
      return [
        `金手指：${kit.prop}——${ctx.hero}唯一的依仗，也是「${kit.identity}」身份的钥匙`,
        `核心卖点：${clip(p.logline || kit.loglines[0], 60)}`,
        `爽点节奏：首付费第 ${paywalls[0] ?? '—'} 集前完成第一次打脸；第 ${twists.join('、') || '—'} 集大反转；第 ${climaxFrom} 集起全面反击`,
      ].join('\n')
    case 'heroSetup':
      return `${ctx.hero}：${fill(hero.profile, ctx)}。想要${fill(hero.desire, ctx)}，最大的缺陷是${fill(hero.flaw, ctx)}。弧光：${hero.arc}。`
    case 'writingRules': {
      const chars = estimateChars(p.spec.episodeSeconds)
      const scenes = sceneCountOf(p)
      return [
        `1. 每集 ${p.spec.episodeSeconds} 秒（约 ${chars} 字）、${scenes} 场戏以内；开场 5 秒内必须出现冲突或悬念`,
        '2. 每集结尾留钩子，同一种钩子不连续出现；付费卡点卡在情绪最高处',
        '3. 台词口语化，单句不超过 25 字；少用“仿佛、不禁、嘴角勾起”等 AI 味词',
        `4. 叙事视角：${a?.viewpoint ?? '第三人称 · 跟随主角'}——${viewpointRule(a?.viewpoint ?? '第三人称 · 跟随主角')}`,
        '5. 伏笔按计划埋设与回收；人物言行不得偏离人物小传',
      ].join('\n')
    }
  }
}

/* ---------------------------------- 人物 ---------------------------------- */

const ROLE_OF: Record<Slot, CharacterRole> = { hero: '主角', lover: '暧昧对象', villain: '反派', ally: '配角', mentor: '配角' }

/** 对标剧拆解中与叙事位置对应的人物 */
const BENCH_ROLE: Record<Slot, (role: string) => boolean> = {
  hero: (r) => r === '主角',
  lover: (r) => r.startsWith('感情线'),
  villain: (r) => r === '反派',
  ally: (r) => r.includes('盟友'),
  mentor: (r) => r.includes('知情人'),
}

interface RoleExtra {
  age: number
  appearance: string
  personality: string
  background: string
  ability: string
  goal: string
  fear: string
  notes: string
}

/** 题材无关的人物小传补充项 */
const ROLE_EXTRAS: Record<Slot, RoleExtra> = {
  hero: {
    age: 22,
    appearance: '清瘦，眉眼干净，习惯把情绪压在平静的表情下；随身带着{prop}',
    personality: '外柔内刚，隐忍、记仇，被逼到绝境时比谁都狠',
    background: '从小被当作无用之人，看尽冷眼；{grudge}',
    ability: '{prop}带来的特殊能力；「{identity}」的身份是最大的底牌',
    goal: '先活下去，再把失去的一样样拿回来',
    fear: '再一次被最信任的人抛弃',
    notes: '前 10 集以隐忍为主，每次反击都要有铺垫；台词少而狠',
  },
  lover: {
    age: 26,
    appearance: '高大冷峻，衣着一丝不苟，只有在{hero}面前才会失态',
    personality: '克制、骄傲、嘴硬心软',
    background: '家族继承人，从小被要求把责任放在感情之前',
    ability: '权势与资源，能在关键时刻扭转局面',
    goal: '守住自己的位置与家族',
    fear: '承认自己当年错了',
    notes: '追妻线从第一次小反转开始升温，付费卡点多落在他的选择上',
  },
  villain: {
    age: 24,
    appearance: '精致得体，笑意从不到达眼底',
    personality: '虚伪、善妒、算计深',
    background: '{grudge}——自己正是当年的知情者',
    ability: '人脉与手段，擅长借刀杀人',
    goal: '取代{hero}，得到{lover}身边的一切',
    fear: '被揭穿后一无所有',
    notes: '每次出手都要让观众恨得牙痒，但不能降智',
  },
  ally: {
    age: 21,
    appearance: '圆脸，笑起来有酒窝，紧张时会结巴',
    personality: '善良、胆小、讲义气',
    background: '曾受过{hero}的恩惠，一直记在心里',
    ability: '消息灵通，能接触到核心人物身边的人',
    goal: '护住{hero}',
    fear: '因为自己的胆怯害了朋友',
    notes: '中段承担一次关键作证',
  },
  mentor: {
    age: 58,
    appearance: '须发花白，拄着手杖，眼神却很锐利',
    personality: '谨慎、沉稳、心怀愧疚',
    background: '当年旧案的亲历者，为自保沉默多年',
    ability: '掌握「{identity}」的全部秘密',
    goal: '等{hero}站稳脚跟，把真相交到{hero}手里',
    fear: '真相大白前死去',
    notes: '只在关键节点出现，每次出现都带出一条旧线索',
  },
}

export function draftCharacters(p: Project, seed: number): { characters: Character[]; relations: Relation[] } {
  const kit = kitOf(p)
  const r = rng(hash(p.id) + seed)
  const heroG: Gender = p.audience === 'male' ? 'm' : 'f'
  const genders: Record<Slot, Gender> = { hero: heroG, lover: heroG === 'f' ? 'm' : 'f', villain: heroG, ally: heroG, mentor: 'm' }
  const pool = p.spec.language === 'zh' ? CN_NAMES : EN_NAMES
  const bench = p.work.breakdown?.characters ?? []
  // 仿写必须换名：避开对标剧里出现过的名字
  const used = new Set(bench.map((c) => c.name))
  const decks = { f: shuffle(r, pool.f), m: shuffle(r, pool.m) }

  // names[s] = [英文名或拼音, 中文名]
  const names = {} as Record<Slot, [string, string]>
  for (const s of SLOTS) {
    const deck = decks[genders[s]]
    const chosen = deck.find(([en, zh]) => !used.has(zh) && !used.has(en)) ?? deck[0]
    used.add(chosen[1])
    names[s] = chosen
  }
  const ctx: Ctx = { ...ctxOf(p, kit), ...Object.fromEntries(SLOTS.map((s) => [s, names[s][1]])) }

  const characters: Character[] = SLOTS.map((s) => {
    const role = kit.roles[s]
    const extra = ROLE_EXTRAS[s]
    return newCharacter({
      name: names[s][1],
      nameEn: names[s][0],
      role: ROLE_OF[s],
      gender: genders[s] === 'f' ? '女' : '男',
      age: String(extra.age + Math.floor(r() * 4)),
      profile: fill(role.profile, ctx),
      appearance: fill(extra.appearance, ctx),
      personality: fill(extra.personality, ctx),
      background: fill(extra.background, ctx),
      ability: fill(extra.ability, ctx),
      goal: fill(extra.goal, ctx),
      desire: fill(role.desire, ctx),
      fear: fill(extra.fear, ctx),
      flaw: fill(role.flaw, ctx),
      arc: fill(role.arc, ctx),
      notes: fill(extra.notes, ctx),
      benchmark: bench.find((c) => BENCH_ROLE[s](c.role))?.name ?? '',
    })
  })

  const n = (s: Slot) => ctx[s]
  const [, foe, rival, friend, elder] = kit.ties
  const relations: Relation[] = [
    { a: n('hero'), b: n('lover'), kind: loverTie(p, kit), label: `感情主线：${kit.roles.lover.arc}` },
    { a: n('hero'), b: n('villain'), kind: foe, label: `宿敌：${clip(fill(kit.grudge, ctx), 24)}` },
    { a: n('villain'), b: n('lover'), kind: rival, label: '觊觎与利用' },
    { a: n('hero'), b: n('ally'), kind: friend, label: `盟友：${kit.roles.ally.arc.split(' → ').pop()}` },
    { a: n('mentor'), b: n('hero'), kind: elder, label: `知情人：掌握「${kit.identity}」的秘密` },
  ]
  return { characters, relations }
}

/** 主角与感情线的关系类型：立项题材里写明了婚恋形式就按题材，否则按题材套件 */
function loverTie(p: Project, kit: Kit) {
  if (p.genres.includes('契约婚姻')) return '契约夫妻'
  if (p.genres.some((g) => ['闪婚', '替嫁', '先婚后爱'].includes(g))) return '夫妻'
  if (p.genres.includes('追妻火葬场')) return '前任'
  if (p.category === '校园') return '同学'
  return kit.ties[0]
}

/* ---------------------------------- 伏笔 ---------------------------------- */

/** AI 建议的一条伏笔：附上为什么埋在这里、在哪收，供编剧勾选 */
export interface ForeshadowIdea {
  foreshadow: Foreshadow
  why: string
}

/** 大纲确定后建议伏笔：埋设与回收落在具体的集纲上，优先踩大反转、付费卡点与高潮 */
export function draftForeshadows(p: Project): ForeshadowIdea[] {
  const kit = kitOf(p)
  const ctx = ctxOf(p, kit)
  const total = p.spec.totalEpisodes
  const { twists, paywalls, climaxFrom } = p.rhythm
  const ranges = projectPhases(p)
  const names = phaseNames(p)
  const at = (ratio: number) => Math.min(total, Math.max(1, Math.round(total * ratio)))

  const items: { type: ForeshadowType; title: string; content: string; plantEp: number; payoffEp: number }[] = [
    { type: '关键道具', title: `${kit.prop}的异光`, content: `${kit.prop}在危急时刻发出异样的光，暗示它与「${kit.identity}」有关`, plantEp: 1, payoffEp: twists[0] ?? at(0.25) },
    { type: '叙事线索', title: `感情线：${ctx.hero} × ${ctx.lover}`, content: `${ctx.hero}与${ctx.lover}之间的心结一点点解开，每个阶段至少推进一次关系变化`, plantEp: 1, payoffEp: at(0.95) },
    { type: '人物秘密', title: `${ctx.lover}的苦衷`, content: `${ctx.lover}当年的选择另有苦衷，误会撑起前半程的虐点`, plantEp: Math.min(2, total), payoffEp: twists[1] ?? at(0.5) },
    { type: '隐藏身份', title: `${ctx.hero}的真实身份`, content: `${ctx.hero}的真实身份是${kit.identity}，高潮时当众公开`, plantEp: at(0.12), payoffEp: climaxFrom },
    { type: '前情恩怨', title: '当年旧案', content: fill(kit.grudge, ctx), plantEp: at(0.2), payoffEp: twists[2] ?? at(0.8) },
    { type: '人物秘密', title: `${ctx.villain}的幕后往来`, content: `${ctx.villain}暗中与幕后势力往来，第二幕升级时浮出水面`, plantEp: at(0.35), payoffEp: at(0.78) },
    { type: '人物秘密', title: `${ctx.ally}的隐瞒`, content: `${ctx.ally}一直瞒着${ctx.hero}一件事：当年事发那晚，${ctx.ally}也在场`, plantEp: at(0.25), payoffEp: paywalls.find((e) => e > at(0.5)) ?? at(0.6) },
    { type: '叙事线索', title: `${ctx.mentor}的三次出场`, content: `${ctx.mentor}每次出场都带出一条旧线索，最后一次交出全部真相`, plantEp: at(0.1), payoffEp: Math.max(1, climaxFrom - 1) },
  ]

  const where = (ep: number) => {
    const title = p.work.outline.find((o) => o.ep === ep)?.title
    return `第 ${ep} 集${title ? `「${title}」` : ''}（${names[phaseOf(ep, ranges)]}）`
  }
  const node = (ep: number) =>
    twists.includes(ep) ? '，正好落在大反转' : paywalls.includes(ep) ? '，卡在付费点' : ep >= climaxFrom ? '，高潮集揭晓' : ''

  return items.map((f) => {
    // 回收必须晚于埋设
    const payoffEp = f.payoffEp > f.plantEp ? f.payoffEp : Math.min(total, f.plantEp + Math.max(3, Math.round(total * 0.1)))
    const line = f.type === '叙事线索' ? ['开始', '收束'] : ['埋设', '回收']
    return {
      foreshadow: { id: newId(), ...f, payoffEp, events: [] },
      why: `${line[0]}：${where(f.plantEp)}；${line[1]}：${where(payoffEp)}${node(payoffEp)}`,
    }
  })
}

/* ---------------------------------- 情节大纲 ---------------------------------- */

/** 全剧总览 + 五段式各段粗纲 */
export function draftPlot(p: Project): Plot {
  const kit = kitOf(p)
  const ctx = coreCtx(p, kit)
  const a = p.work.architecture
  const ranges = projectPhases(p)
  const { paywalls, twists, climaxFrom } = p.rhythm
  const structure = a?.structure ?? '单线叙事'
  const viewpoint = a?.viewpoint ?? '第三人称 · 跟随主角'
  const heroArc = kit.roles.hero.arc.split(' → ')

  const lines = [
    `【一句话】${p.logline || kit.loglines[0]}`,
    `【叙事线架构】${structure}`,
    `· 主线：${ctx.hero}从${heroArc[0]}到${heroArc.at(-1)}`,
    `· 感情线：${ctx.hero} × ${ctx.lover}——${kit.roles.lover.arc}`,
    `· 反派线：${ctx.villain}——${kit.roles.villain.arc}`,
  ]
  if (structure !== '单线叙事') lines.push(`· 旧案线：${fill(kit.grudge, ctx)}，由${ctx.mentor}逐步揭开`)
  lines.push(
    `【视角规则】${viewpoint}：${viewpointRule(viewpoint)}`,
    `【爽点】${a?.formula || kit.formula}`,
    `【付费节奏】首付费第 ${paywalls[0] ?? '—'} 集；付费卡点第 ${paywalls.join('、') || '—'} 集；大反转第 ${twists.join('、') || '—'} 集；第 ${climaxFrom} 集起进入高潮`,
    `【结局】${fill(kit.ending, ctx)}`,
  )

  const phases = phaseNames(p).map((beat, i) => {
    const [from, to] = ranges[i]
    const inRange = (ep: number) => ep >= from && ep <= to
    const content = a?.mainLine[i]?.content.trim() || fill(BEATS[templatePhase(i, ranges.length)], ctx)
    const nodes = [
      ...twists.filter(inRange).map((ep) => `第 ${ep} 集大反转`),
      ...paywalls.filter(inRange).map((ep) => `第 ${ep} 集付费卡点`),
      ...(inRange(climaxFrom) ? [`第 ${climaxFrom} 集进入高潮`] : []),
    ]
    const plans = p.work.foreshadows.flatMap((f) => [
      ...(inRange(f.plantEp) ? [`埋「${foreshadowName(f)}」`] : []),
      ...(inRange(f.payoffEp) ? [`收「${foreshadowName(f)}」`] : []),
    ])
    return [`${beat}（${rangeLabel([from, to])}）：${content.replace(/[。；]$/, '')}。`, nodes.length ? `节点：${nodes.join('，')}。` : '', plans.length ? `伏笔：${plans.join('、')}。` : '']
      .filter(Boolean)
      .join('\n')
  })
  return { overview: lines.join('\n'), phases }
}

/** 各段的集标题素材 */
const PHASE_TITLES = [
  ['坠落', '一无所有', '雨夜', '当众羞辱', '最后的筹码', '暗算', '陌生来电', '无路可退', '底牌', '旧伤', '独行', '余烬'],
  ['第一次反击', '重逢', '将计就计', '试探', '异样', '交锋', '入局', '针锋相对', '破绽', '盟友', '暗流', '赌约'],
  ['苦衷', '证据', '站队', '旧案一角', '联手', '反扑', '新线索', '裂痕', '真相边缘', '摊牌', '暗室', '对峙'],
  ['人质', '决裂', '身陷险境', '幕后黑手', '集结', '孤立无援', '翻脸', '背水一战', '倒戈', '最后的布局', '围城', '断崖'],
  ['众叛亲离', '挡刀', '对决', '心结', '证人', '尘埃落定', '加冕', '归来', '新生', '终章', '清算', '黎明'],
]
const TWIST_TITLES = ['真相', '旧案重启', '身份揭晓']
const PAYWALL_TITLES = ['毁证', '二选一', '抢先一步', '命悬一线']

function titleOf(p: Project, ep: number, seed: number) {
  const { rhythm } = p
  const total = p.spec.totalEpisodes
  if (ep === total) return '终章'
  if (ep === rhythm.climaxFrom) return '公开身份'
  if (rhythm.twists.includes(ep)) return TWIST_TITLES[rhythm.twists.indexOf(ep) % TWIST_TITLES.length]
  if (rhythm.paywalls.includes(ep)) return PAYWALL_TITLES[rhythm.paywalls.indexOf(ep) % PAYWALL_TITLES.length]
  const ranges = projectPhases(p)
  const phase = phaseOf(ep, ranges)
  const deck = shuffle(rng(hash(p.id) + phase * 7 + seed), PHASE_TITLES[templatePhase(phase, ranges.length)])
  const i = ep - ranges[phase][0]
  const round = Math.floor(i / deck.length)
  return deck[i % deck.length] + (round ? ` ${['Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ'][Math.min(round, 4) - 1]}` : '')
}

export function draftOutline(p: Project, from: number, to: number, seed: number): OutlineEpisode[] {
  const kit = kitOf(p)
  const total = p.spec.totalEpisodes
  const { rhythm } = p
  const ctx = ctxOf(p, kit)
  const r = rng(hash(`${p.id}-${from}`) + seed)
  const ranges = projectPhases(p)
  // 同一段内按固定顺序取事件，跨批次也不重样；重新生成时整体错位
  const decks = PHASE_EVENTS.map((list, i) => shuffle(rng(hash(p.id) + i), list))
  let prevHook = p.work.outline.find((o) => o.ep === from - 1)?.hook

  const out: OutlineEpisode[] = []
  for (let ep = from; ep <= to; ep++) {
    const phase = phaseOf(ep, ranges)
    const kind = nodeKind(ep, rhythm)
    const place = pick(r, kit.places).zh
    const c = { ...ctx, place }

    let event: string
    if (ep === 1) event = kit.opening
    else if (ep === total) event = kit.ending
    else if (ep === rhythm.climaxFrom) event = CLIMAX_EVENT
    else if (rhythm.twists.includes(ep)) event = TWIST_EVENTS[rhythm.twists.indexOf(ep) % TWIST_EVENTS.length]
    else if (kind === 'paywall') event = PAYWALL_EVENTS[rhythm.paywalls.indexOf(ep) % PAYWALL_EVENTS.length]
    else {
      const deck = decks[templatePhase(phase, ranges.length)]
      const i = ep - ranges[phase][0]
      event = deck[(i + seed) % deck.length] + (i >= deck.length || r() < 0.4 ? pick(r, EVENT_TAILS) : '')
    }
    event = fill(event, c)
    for (const f of p.work.foreshadows) {
      if (f.plantEp === ep) event += `；埋下「${foreshadowName(f)}」`
      if (f.payoffEp === ep) event += `；回收「${foreshadowName(f)}」`
    }

    let hook: HookType
    if (kind === 'paywall') hook = '付费卡点'
    else if (rhythm.twists.includes(ep)) hook = '反转'
    else {
      let i = (ep + seed) % HOOK_ROTATION.length
      while (HOOK_ROTATION[i] === prevHook) i = (i + 1) % HOOK_ROTATION.length
      hook = HOOK_ROTATION[i]
    }
    out.push({ ep, title: titleOf(p, ep, seed), event, hook, hookLine: fill(pick(r, HOOK_LINES[hook]), c), approved: false })
    prevHook = hook
  }
  return out
}

/* ---------------------------------- 分集蓝图 ---------------------------------- */

/** 本集在节奏框架里的定位 */
export function positionOf(p: Project, ep: number): string {
  const { rhythm } = p
  const total = p.spec.totalEpisodes
  if (ep === 1) return '开篇'
  if (ep === total) return '结局'
  if (ep >= rhythm.climaxFrom) return '高潮'
  if (rhythm.twists.includes(ep)) return '转折'
  if (rhythm.paywalls.includes(ep)) return '付费卡点'
  return ['铺垫', '发展', '发展', '升级', '高潮'][templateOf(p, ep)]
}

const PHASE_GOALS = [
  ['在{place}站稳脚跟，不再任人摆布', '保住{prop}，不让它落到{villain}手里', '找到一个能信任的人', '查清自己被陷害的原因'],
  ['借{prop}打出第一次反击', '让{villain}当众吃一次亏', '在{lover}面前守住自己的秘密', '拉拢第一批支持者'],
  ['拿到旧案的第一份证据', '弄清{lover}当年的苦衷', '逼{villain}露出马脚', '从{mentor}口中问出真相'],
  ['救出被扣下的{ally}', '在孤立中稳住盟友', '抢在{villain}之前拿到关键证据', '与{lover}解开误会'],
  ['当众揭穿{villain}', '以{identity}身份夺回一切', '护住身边的人', '与过去和解'],
]

/** 按情节大纲生成分集蓝图；已有的作者微操指导与集要点保留 */
export function draftBlueprints(p: Project, from: number, to: number, seed: number): EpisodeBlueprint[] {
  const kit = kitOf(p)
  const ctx = ctxOf(p, kit)
  const cast = castOf(p)
  const ranges = projectPhases(p)
  const out: EpisodeBlueprint[] = []
  for (let ep = from; ep <= to; ep++) {
    const o = p.work.outline.find((x) => x.ep === ep)
    if (!o) continue
    const r = rng(hash(`${p.id}-bp${ep}`) + seed)
    const c = { ...ctx, place: pick(r, kit.places).zh }
    const names = [cast.hero.zh, ...SLOTS.slice(1).map((s) => cast[s].zh).filter((n) => o.event.includes(n) || o.hookLine.includes(n))]
    const prev = blueprintOf(p.work, ep)
    // 承接不只是上集结尾：前几集埋下、计划本集回收的伏笔也在开场接住
    const due = p.work.foreshadows.filter((f) => f.payoffEp === ep && f.plantEp < ep - 1).map((f) => `第 ${f.plantEp} 集埋下的「${foreshadowName(f)}」在本集响起`)
    out.push({
      ep,
      title: o.title,
      position: positionOf(p, ep),
      cast: [...new Set(names)].join('、'),
      goal: fill(pick(r, PHASE_GOALS[templatePhase(phaseOf(ep, ranges), ranges.length)]), c),
      conflict: o.event,
      // 承接上一集的结尾：同批生成的上集蓝图优先，其次上集正文 / 集纲；再接上到期的伏笔
      carry: [out.find((b) => b.ep === ep - 1)?.hook || prevHookOf(p.work, ep), ...due.slice(0, 1)].filter(Boolean).join('；'),
      hook: o.hookLine,
      guidance: prev?.guidance ?? '',
      points: prev?.points ?? '',
    })
  }
  return out
}

/* ---------------------------------- 逐集剧本 ---------------------------------- */

/** AI 写出的一集正文；页面再包装成草稿箱里的一个版本 */
export interface DraftContent {
  title: string
  lines: ScriptLine[]
  states: Record<string, string>
  /** 写这一集对照的依据：和审稿同一份清单 */
  basis?: WriteBasisItem[]
}

/* ---------- 写作与审稿共用的依据：写的时候按它写，审的时候按它查 ---------- */

/** 人物状态里出现这些词，说明这个人已经不能正常出场了 */
const GONE = /死|身亡|去世|遇害|入狱|被捕|收监|失踪|昏迷|出国|离开了/

/** 写到第 ep 集时已经不能出场说话的人（按之前的定稿） */
const goneBefore = (p: Project, ep: number) => buildState(p, ep).characters.filter((c) => c.state && c.stateEp && GONE.test(c.state))

/** 性格写着寡言、话少的人物 */
const taciturnOf = (p: Project) => p.work.characters.filter((c) => c.name.trim() && TACITURN.test(c.personality))

/** 全局写作要求里不许出现的词；AI 味词归文风那一项查，不重复算 */
const ruleTermsOf = (p: Project) => forbiddenTerms(p.work.architecture?.writingRules ?? '').filter((t) => !AI_FILLERS.includes(t.term))

/** 全局写作要求里讲某件事的那一条：审稿意见引用它作依据 */
const ruleLine = (p: Project, re: RegExp) =>
  (p.work.architecture?.writingRules ?? '')
    .split('\n')
    .map((l) => l.trim().replace(/^\d+[.、]\s*/, ''))
    .find((l) => re.test(l))

/** 集纲事件：写作写进正文的那一句，审稿按它的开头查 */
function eventOf(p: Project, ep: number) {
  const text = (p.work.outline.find((o) => o.ep === ep)?.event ?? '').split(/[；。]/)[0].trim().replace(/[，,]$/, '')
  const key = text.split(/[，,]/)[0].replace(/\s/g, '').slice(0, 10)
  return key.length >= 4 ? { text, key } : null
}

const dropTerms = (zh: string, terms: string[]) => terms.reduce((t, w) => t.split(w).join(''), zh)

/** 寡言人物的台词压短：取第一句，还长就只留第一个分句 */
function shortVoice(zh: string) {
  const first = zh.match(/^.+?[。！？!?…]+/)?.[0] ?? zh
  if (first.length <= TACITURN_MAX) return first
  const clause = first.match(/^.+?[，,；;]/)?.[0]
  return clause && clause.length > 4 ? clause.replace(/[，,；;]$/, '。') : first
}

/** 本集要推进的伏笔：计划本集埋设、本集回收，以及到了该呼应的一条活跃计划 */
function plansOf(p: Project, ep: number) {
  // 没设沉寂阈值时每 3 集呼应一次
  const every = p.work.architecture?.silenceThreshold || 3
  const all = p.work.foreshadows
  const echo = all
    .filter((f) => f.plantEp < ep && ep < f.payoffEp && (ep - f.plantEp) % every === 0)
    .sort((a, b) => a.plantEp - b.plantEp)[0]
  return {
    plant: all.filter((f) => f.plantEp === ep),
    echo: echo ? [echo] : [],
    payoff: all.filter((f) => f.payoffEp === ep),
  } satisfies Record<PlanEventKind, Foreshadow[]>
}

/** 写进正文的伏笔描写：取意图的第一句，保证能被检索词命中 */
function clauseOf(f: Foreshadow) {
  const first = f.content.split(/[，。；]/)[0].trim()
  return first.length >= 8 ? first : f.content.trim().replace(/[。；]$/, '') || f.title
}

/** 作者微操指导去掉“我想在这集…”之类的口头前缀，写成一句动作 */
const guidanceAction = (g: string) =>
  g
    .trim()
    .replace(/^(我想|希望|需要|要)?(在)?(这|本)?(章|集)?(里|中)?(加入|安排|写|让)?/, '')
    .replace(/在(这|本)(章|集)/g, '')
    .replace(/[。.！!]$/, '') || g.trim()

export function writeEpisode(p: Project, ep: number, seed: number): DraftContent {
  const kit = kitOf(p)
  const cast = castOf(p)
  const zh = ctxOf(p, kit)
  const en = ctxOf(p, kit, 'en')
  const r = rng(hash(`${p.id}-ep${ep}`) + seed)
  const outline = p.work.outline.find((o) => o.ep === ep)
  const blueprint = blueprintOf(p.work, ep)
  // 承接：蓝图里写了用蓝图的（可能是上集遗留，也可能是前几集埋下、本集要响的伏笔），没写时接上集正文（定稿或最新草稿）里的钩子台词
  const carry = carryOf(p.work, ep)
  const conflict = blueprint?.conflict.trim() || outline?.event
  const hook = blueprint?.hook.trim() || outline?.hookLine
  const guidance = blueprint?.guidance.trim()
  const sceneCount = sceneCountOf(p)
  const budget = estimateChars(p.spec.episodeSeconds) / sceneCount

  // 场景类型按段落轮换；第一场必须有主角在场
  const order = PHASE_SCENES[templateOf(p, ep)]
  const types = Array.from({ length: sceneCount }, (_, i) => order[(i + ep) % order.length])
  if (types[0] === 'scheme') types.push(types.shift()!)
  const places = shuffle(r, kit.places)

  const lines: ScriptLine[] = []
  const states: Record<string, string> = {}
  let size = 0
  const push = (l: Omit<ScriptLine, 'id'>) => {
    lines.push({ id: newId(), ...l })
    size += l.zh.length
  }
  const plans = plansOf(p, ep)

  // 按审稿的那几项依据写：核心设定里不许出现的词、已经不能出场的人、寡言人物的台词、AI 味与长台词
  const terms = ruleTermsOf(p).map((t) => t.term)
  const gone = goneBefore(p, ep)
  const quiet = new Set(taciturnOf(p).map((c) => c.name))
  const event = eventOf(p, ep)
  const n = { fillers: 0, terms: 0, gone: 0, quiet: 0, split: 0 }
  const clean = (text: string) => {
    const a = stripFillers(text)
    const b = dropTerms(a, terms)
    if (a !== text) n.fillers++
    if (b !== a) n.terms++
    return b
  }
  const act = (text: string) => push({ kind: 'action', zh: clean(text) })
  const say = (s: Speech) => {
    const who = cast[s.who]
    const raw = fill(s.zh, zh)
    let text = clean(raw)
    if (gone.some((c) => c.name === who.zh)) {
      n.gone++
      return push({ kind: 'action', zh: `△（闪回）${who.zh}：${text}` })
    }
    if (quiet.has(who.zh) && text.length > TACITURN_MAX) {
      text = shortVoice(text)
      n.quiet++
    }
    const parts = text.length > 30 ? splitLong(text) : null
    if (parts) n.split++
    // 改过的台词英文对不上了，等翻译时重新译
    for (const t of parts ?? [text]) push({ kind: 'dialogue', speaker: who.zh, speakerEn: who.en, zh: t, ...(t === raw && { en: fill(s.en, en) }) })
  }

  types.forEach((type, i) => {
    const place = places[i % places.length]
    const night = r() < 0.55
    const inside = r() < 0.65
    push({ kind: 'scene', zh: `${place.zh} ${night ? '夜' : '日'} ${inside ? '内' : '外'}`, en: `${inside ? 'INT.' : 'EXT.'} ${place.en} – ${night ? 'NIGHT' : 'DAY'}` })
    const start = size

    if (i === 0) {
      if (carry) push({ kind: 'action', zh: `△（${carry.auto ? '接上集' : '承接'}）${carry.text}` })
      if (conflict) push({ kind: 'action', zh: `△ ${conflict.split('；')[0].replace(/[。]$/, '')}。` })
      // 蓝图改过冲突、没写集纲事件时，集纲事件也要写进开场
      if (event && !(conflict ?? '').replace(/\s/g, '').includes(event.key)) push({ kind: 'action', zh: `△ ${event.text}。` })
    }
    // 作者微操指导与伏笔放在第二场（只有一场时放第一场），保证写进正文
    if (i === Math.min(1, types.length - 1)) {
      if (guidance) push({ kind: 'action', zh: `△ ${guidanceAction(guidance)}。` })
      for (const kind of ['plant', 'echo', 'payoff'] as const) {
        for (const f of plans[kind]) planLines(f, kind).forEach((l) => (l.kind === 'dialogue' ? say(l.speech) : push({ kind: 'action', zh: l.zh })))
      }
    }

    const pool = SCENES[type]
    const actions = shuffle(r, pool.actions)
    const exchanges = shuffle(r, pool.exchanges)
    let a = 0
    let e = 0
    while (size - start < budget && (a < actions.length || e < exchanges.length)) {
      if (a < actions.length && (a <= e || e >= exchanges.length)) act(fill(actions[a++], { ...zh, place: place.zh }))
      if (size - start < budget && e < exchanges.length) exchanges[e++].forEach(say)
    }

    for (const [slot, state] of Object.entries(pool.states) as [Slot, string][]) {
      states[cast[slot].zh] = `${place.zh}：${fill(state, zh)}`
    }
  })

  if (hook) push({ kind: 'hook', zh: hook })

  // 记下这一集按什么写的：和审稿同一份清单，草稿页「本集蓝图」里能看到
  const before = buildState(p, ep)
  const planned = (['plant', 'echo', 'payoff'] as const).flatMap((k) => plans[k].map((f) => `${{ plant: '埋设', echo: '呼应', payoff: '回收' }[k]}「${foreshadowName(f)}」`))
  const basis: (WriteBasisItem | false | '' | 0 | null | undefined)[] = [
    p.work.architecture?.writingRules.trim() && { basis: 'core', text: `按全局写作要求写${terms.length ? `，避开「${terms.join('、')}」${n.terms ? `（删去 ${n.terms} 处）` : ''}` : ''}` },
    p.work.characters.length && {
      basis: 'character',
      text: [`只用人物设定里登记的人物，主角${cast.hero.zh}有戏`, quiet.size && `${[...quiet].join('、')}寡言，台词压在 ${TACITURN_MAX} 字内${n.quiet ? `（压短 ${n.quiet} 句）` : ''}`].filter(Boolean).join('；'),
    },
    before.latestEp && {
      basis: 'state',
      text: `对照${before.latestEp > 1 ? `第 1–${before.latestEp} 集` : '第 1 集'}定稿的人物状态与道具${gone.length ? `；${gone.map((c) => `${c.name}已「${c.state}」`).join('、')}，不再出场说话` : ''}`,
    },
    event && { basis: 'outline', text: `集纲：${event.text}` },
    (carry || blueprint) && { basis: 'blueprint', text: [carry && `开场承接「${clip(carry.text, 24)}」`, blueprint?.cast.trim() && `出场 ${blueprint.cast.trim()}`, hook && '结尾按蓝图钩子收'].filter(Boolean).join('；') },
    planned.length && { basis: 'foreshadow', text: planned.join('、') },
    { basis: 'format', text: `约 ${estimateChars(p.spec.episodeSeconds)} 字、${sceneCount} 场，每场有场景标题${hook ? '，集末留钩子' : ''}` },
    { basis: 'style', text: `不用 AI 味词，台词不超过 30 字${n.fillers || n.split ? `（去掉 AI 味 ${n.fillers} 处、拆短 ${n.split} 句）` : ''}` },
  ]
  return { title: blueprint?.title.trim() || outline?.title || '', lines, states, basis: basis.filter((x): x is WriteBasisItem => !!x) }
}

type PlanLine = { kind: 'action'; zh: string } | { kind: 'dialogue'; speech: Speech }

/** 伏笔推进写成的正文：叙事线索只写一句动作，其余伏笔配一句台词 */
function planLines(f: Foreshadow, kind: PlanEventKind): PlanLine[] {
  const c = clauseOf(f)
  if (f.type === '叙事线索') return [{ kind: 'action', zh: `△ ${c}${kind === 'payoff' ? '，终于有了结果' : ''}。` }]
  if (kind === 'plant') return [{ kind: 'action', zh: `△ 特写：${c}。` }, { kind: 'dialogue', speech: PLANT_LINE }]
  if (kind === 'echo') return [{ kind: 'action', zh: `△ 闪回：${c}。` }]
  return [{ kind: 'action', zh: `△ 真相揭晓——${c}。` }, { kind: 'dialogue', speech: PAYOFF_LINE }]
}

/* ---------------------------------- 审稿 / 修稿 / 要点 ---------------------------------- */

interface DraftLike {
  ep: number
  lines: ScriptLine[]
  notes?: LineNote[]
}

const speakers = (lines: ScriptLine[]) => [...new Set(lines.flatMap((l) => (l.kind === 'dialogue' && l.speaker ? [l.speaker] : [])))]

const flatText = (lines: ScriptLine[]) => lines.map((l) => l.zh).join('').replace(/\s/g, '')

/** 正文里该出现、却没找到的伏笔推进 */
function missingPlans(p: Project, d: DraftLike) {
  const flat = flatText(d.lines)
  const plans = plansOf(p, d.ep)
  return (['plant', 'payoff'] as const).flatMap((kind) => plans[kind].filter((f) => foreshadowKey(f) && !flat.includes(foreshadowKey(f))).map((f) => ({ f, kind })))
}

/** 正文里第一处符合条件的行：审稿意见引用它 */
function lineAt(lines: ScriptLine[], test: (l: ScriptLine) => boolean): Pick<ReviewItem, 'lineId' | 'quote'> {
  const l = lines.find(test)
  return l ? { lineId: l.id, quote: clip(l.kind === 'dialogue' && l.speaker ? `${l.speaker}：${l.zh}` : l.zh, 48) } : {}
}

/**
 * 连贯性：对照本集之前已定稿的剧情——人物状态、关键道具的归属、已回收的伏笔，
 * 找出和前文矛盾的地方。只认定稿，草稿不算“已发生”。
 */
function continuityItems(p: Project, d: DraftLike): ReviewItem[] {
  const before = buildState(p, d.ep)
  if (!before.latestEp) return []
  const items: ReviewItem[] = []
  const flat = flatText(d.lines)
  const who = speakers(d.lines)
  const plans = plansOf(p, d.ep)
  const planned = new Set([...plans.plant, ...plans.echo, ...plans.payoff].map((f) => f.id))

  const states = before.characters.filter((c) => c.state && c.stateEp)
  for (const c of states) {
    if (who.includes(c.name) && GONE.test(c.state))
      items.push({
        level: 'block',
        code: 'state',
        key: `state:${c.name}`,
        text: `人物状态冲突：${c.name}在第 ${c.stateEp} 集已是「${c.state}」，本集却有台词`,
        ref: `第 ${c.stateEp} 集定稿：${c.name}「${c.state}」`,
        ...lineAt(d.lines, (l) => l.kind === 'dialogue' && l.speaker === c.name),
      })
  }
  const props = before.foreshadows.filter((f) => f.item.type === '关键道具' && f.plantedIn !== null)
  for (const f of before.foreshadows) {
    const key = foreshadowKey(f.item)
    if (!key || !flat.includes(key) || planned.has(f.item.id)) continue
    const quote = lineAt(d.lines, (l) => l.zh.replace(/\s/g, '').includes(key))
    if (f.paidIn !== null)
      items.push({
        level: 'warn',
        code: 'paid',
        key: `paid:${f.item.id}`,
        text: `「${foreshadowName(f.item)}」已在第 ${f.paidIn} 集回收，本集又出现：确认${f.item.type === '关键道具' ? '道具归属' : '真相'}与前文一致`,
        ref: `第 ${f.paidIn} 集定稿回收「${foreshadowName(f.item)}」`,
        ...quote,
      })
    else if (f.item.type === '关键道具') items.push({ level: 'info', basis: 'state', text: `道具「${foreshadowName(f.item)}」本集出现，归属沿用第 ${f.lastEp ?? f.plantedIn} 集`, ...quote })
  }
  const range = before.latestEp > 1 ? `第 1–${before.latestEp} 集` : '第 1 集'
  if (!items.some((i) => i.level === 'block' || i.level === 'warn')) {
    items.push({ level: 'info', basis: 'state', text: `连贯：已对照${range}定稿的 ${states.length} 个人物状态、${props.length} 件关键道具与已发生的剧情线，未发现矛盾` })
  }
  return items
}

/** 按依据逐项查出的问题：每条带依据、依据原文、正文原句与跨轮标识 */
function findIssues(p: Project, d: DraftLike): ReviewItem[] {
  const items: ReviewItem[] = []
  const target = estimateChars(p.spec.episodeSeconds)
  const words = wordCount(d)
  const cast = castOf(p)
  const text = d.lines.map((l) => l.zh).join('\n')
  const flat = flatText(d.lines)
  const blueprint = blueprintOf(p.work, d.ep)
  const outline = p.work.outline.find((o) => o.ep === d.ep)

  // 格式与篇幅
  const goal = `单集 ${p.spec.episodeSeconds} 秒约 ${target} 字`
  if (words < target * 0.7) items.push({ level: 'block', code: 'short', text: `字数 ${words}，低于${goal}的 70%`, ref: goal })
  else if (words > target * 1.3) items.push({ level: 'warn', code: 'long', text: `字数 ${words}，超出${goal} 30% 以上，注意单集时长`, ref: goal })
  if (!d.lines.some((l) => l.kind === 'scene')) items.push({ level: 'block', code: 'scene', text: '缺少场景标题，无法对接制作线', ref: '剧本格式：每场戏以场景标题开头（地点 日/夜 内/外）' })
  if (!d.lines.some((l) => l.kind === 'hook'))
    items.push({ level: 'block', code: 'hook', text: '结尾没有钩子，观众没有理由点下一集', ref: blueprint?.hook.trim() ? `蓝图末尾钩子：${blueprint.hook.trim()}` : outline?.hookLine ? `集纲钩子：${outline.hookLine}` : '每集结尾留钩子' })

  // 核心设定：全局写作要求里不许出现的词
  for (const { term, rule } of ruleTermsOf(p)) {
    if (text.includes(term)) items.push({ level: 'block', code: 'rule', key: `rule:${term}`, text: `正文出现了全局写作要求不许出现的「${term}」`, ref: `全局写作要求：${rule}`, ...lineAt(d.lines, (l) => l.zh.includes(term)) })
  }

  // 集纲：本集该发生的事
  const event = eventOf(p, d.ep)
  if (event && !flat.includes(event.key)) items.push({ level: 'warn', code: 'event', text: '集纲里的本集事件没写进正文', ref: `第 ${d.ep} 集集纲：${event.text}` })

  // 蓝图：承接（蓝图里写了查蓝图的，没写时查上集正文结尾的钩子）、出场人物
  const own = blueprint?.carry?.trim()
  const prevBody = scriptOf(p.work, d.ep - 1) ?? latestDraft(p.work, d.ep - 1)
  const prevHook = own || (prevBody && hookOf(prevBody))
  if (prevHook && !text.includes(prevHook.slice(0, 8)))
    items.push({ level: 'warn', code: 'carry', text: own ? '开场没有接住蓝图里的「承接」' : '开场没有承接上集结尾的钩子', ref: `${own ? '蓝图承接' : `第 ${d.ep - 1} 集结尾`}：${clip(prevHook, 40)}`, ...lineAt(d.lines, (l) => l.kind !== 'scene') })
  const planned = (blueprint?.cast ?? '').split(/[、,，\s]+/).filter(Boolean)
  const absent = planned.filter((n) => !text.includes(n))
  if (absent.length) items.push({ level: 'warn', code: 'absent', text: `蓝图里的出场人物 ${absent.join('、')} 没有出场`, ref: `蓝图出场关键人：${blueprint!.cast}` })

  // 伏笔计划
  for (const { f, kind } of missingPlans(p, d)) {
    items.push({ level: 'block', code: 'plan', key: `plan:${f.id}:${kind}`, text: `计划本集${kind === 'plant' ? '埋设' : '回收'}「${foreshadowName(f)}」，正文里没找到`, ref: `伏笔计划：第 ${f.plantEp} 集埋设 → 第 ${f.payoffEp} 集回收，${clauseOf(f)}` })
  }

  // 人物设定
  const who = speakers(d.lines)
  if (p.work.characters.length && !who.includes(cast.hero.zh)) items.push({ level: 'warn', code: 'hero', text: `主角${cast.hero.zh}本集没有台词`, ref: `人物设定：主角 ${cast.hero.zh}` })
  const known = new Set(p.work.characters.map((c) => c.name))
  const unknown = known.size ? who.filter((n) => !known.has(n)) : []
  if (unknown.length)
    items.push({ level: 'warn', code: 'unknown', text: `${unknown.join('、')} 未在人物设定中登记`, ref: `人物设定已登记：${clip([...known].join('、'), 40)}`, ...lineAt(d.lines, (l) => l.kind === 'dialogue' && unknown.includes(l.speaker ?? '')) })
  for (const c of taciturnOf(p)) {
    const long = d.lines.filter((l) => l.kind === 'dialogue' && l.speaker === c.name && l.zh.length > TACITURN_MAX)
    if (!long.length) continue
    const worst = long.reduce((a, b) => (b.zh.length > a.zh.length ? b : a))
    items.push({ level: 'warn', code: 'voice', key: `voice:${c.name}`, text: `${c.name}性格寡言，本集有 ${long.length} 句台词超过 ${TACITURN_MAX} 字`, ref: `人物小传：${c.name}「${c.personality}」`, ...lineAt(d.lines, (l) => l.id === worst.id) })
  }

  // 状态库：与前文定稿是否一致
  items.push(...continuityItems(p, d))

  // 文风
  const fillers = AI_FILLERS.filter((w) => text.includes(w))
  if (fillers.length)
    items.push({ level: 'warn', code: 'filler', text: `AI 味词汇 ${fillers.length} 种：${fillers.slice(0, 5).join('、')}`, ref: ruleLine(p, /AI 味|仿佛|不禁/) ? `全局写作要求：${ruleLine(p, /AI 味|仿佛|不禁/)}` : '文风：不用 AI 味词', ...lineAt(d.lines, (l) => fillers.some((w) => l.zh.includes(w))) })
  const long = d.lines.filter((l) => l.kind === 'dialogue' && l.zh.length > 30)
  if (long.length) items.push({ level: 'info', code: 'longLine', text: `${long.length} 句台词超过 30 字，竖屏短剧建议拆短`, ref: '文风：竖屏短剧台词 30 字以内', ...lineAt(d.lines, (l) => l.id === long[0].id) })
  if (d.notes?.length) items.push({ level: 'info', code: 'notes', text: `${d.notes.length} 条标注待处理，AI 修稿时会一并改写` })

  // 每条意见都要有依据：按类别补上；说不出依据的只算建议，不拦定稿
  return items.map((i) => {
    const basis = i.basis ?? (i.code && BASIS_OF[i.code])
    const level = !basis && i.level === 'block' ? 'warn' : i.level
    return { ...i, level, ...(basis && { basis }), ...(i.code && { key: i.key ?? i.code }) }
  })
}

/** 复审对照的上一轮：修稿依据的那份审稿、来源草稿的正文、更早几轮的审稿 */
export interface ReviewBase {
  review: DraftReview
  lines: ScriptLine[]
  history: DraftReview[]
}

const LEVEL_RANK = { block: 0, warn: 1, info: 2, ok: 3 }

/**
 * 修稿后的复审：上一轮的意见逐条看改没改掉——没改掉的第一次记「修稿后仍在」，再没改掉记「AI 改不动」；
 * 改掉后又出现的记「改好又出现」，这两种都不再交给 AI 修稿。新问题只认改过的段落和结构性的（缺钩子、缺伏笔这类）；
 * 全量重审时新问题全列，但仍按上一轮跟踪。
 */
function trackIssues(found: ReviewItem[], base: ReviewBase, kind: 'full' | 'recheck', d: DraftLike, kept: Set<string>): ReviewItem[] {
  const prev = base.review.items.filter((i) => i.level !== 'ok' && (i.key || i.code) && !kept.has(itemKey(i)))
  const now = new Map(found.map((i) => [itemKey(i), i]))
  const before = new Set(prev.map(itemKey))
  const everFixed = new Set([base.review, ...base.history].flatMap((r) => r.items.filter((i) => i.status === 'fixed').map(itemKey)))
  const old = new Set(base.lines.map((l) => l.zh))
  // 没指到某一行的算结构性问题
  const touched = (i: ReviewItem) => {
    const l = i.lineId && d.lines.find((x) => x.id === i.lineId)
    return !l || !old.has(l.zh)
  }
  const out: ReviewItem[] = []
  for (const p of prev) {
    const cur = now.get(itemKey(p))
    if (!cur) {
      out.push({ level: 'ok', text: p.text, ...(p.code && { code: p.code }), ...(p.basis && { basis: p.basis }), key: itemKey(p), status: 'fixed' })
      continue
    }
    const status = p.status === 'back' ? 'back' : p.status === 'still' || p.status === 'stuck' || (cur.code && MANUAL_CODES.includes(cur.code)) ? 'stuck' : 'still'
    out.push({ ...cur, status })
  }
  for (const cur of found) {
    const k = itemKey(cur)
    if (before.has(k)) continue
    if (cur.key && everFixed.has(k)) out.push({ ...cur, status: 'back' })
    else if (kind === 'full') out.push({ ...cur, ...(cur.key && { status: 'new' as const }) })
    else if (cur.key && touched(cur)) out.push({ ...cur, status: 'new' })
  }
  return out.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level])
}

/**
 * AI 审稿：按核心设定、人物设定、状态库、集纲、蓝图、伏笔计划、格式与篇幅、文风逐项查。
 * 编剧保留不改的意见不再提；传入 base 时是修稿后的复审（kind 默认 recheck，只查上一轮意见与改过的段落）。
 */
export function reviewDraft(p: Project, d: DraftLike, opts: { base?: ReviewBase; kind?: 'full' | 'recheck' } = {}): Pick<DraftReview, 'score' | 'items' | 'kind' | 'baseId'> {
  const kept = new Set(keptOf(p.work.keeps, d.ep).keys())
  const found = findIssues(p, d).filter((i) => !kept.has(itemKey(i)))
  const kind = opts.base ? (opts.kind ?? 'recheck') : 'full'
  const items = opts.base ? trackIssues(found, opts.base, kind, d, kept) : found

  const blocks = items.filter((i) => i.level === 'block').length
  const warns = items.filter((i) => i.level === 'warn').length
  if (!blocks && !warns) items.push({ level: 'ok', text: kind === 'recheck' ? '上一轮的意见都已改掉，改过的段落没有新问题，可以定稿' : '结构完整、伏笔到位，可以定稿' })
  return { score: Math.max(1, Math.min(5, Math.round((5 - blocks - warns * 0.5) * 10) / 10)), items, kind, ...(opts.base && { baseId: opts.base.review.id }) }
}

/** 去掉 AI 味词与重复标点 */
function stripFillers(text: string) {
  return AI_FILLERS.reduce((t, w) => t.split(w).join(''), text)
    .replace(/的的/g, '的')
    .replace(/…{3,}|\.{3,}/g, '……')
    .replace(/，{2,}/g, '，')
    .replace(/！{2,}/g, '！')
}

/** 修稿结果：新正文、改了什么、哪些意见留给编剧 */
export interface RevisedDraft {
  lines: ScriptLine[]
  changes: string[]
  manual: string[]
}

/** 主角补一句台词时用 */
const HERO_LINES = ['这件事，我自己来。', '我不会再让任何人替我做决定。', '你们欠我的，我会一点一点拿回来。', '从今天起，换我说了算。']

/** 加上意见类别之前的审稿报告：按措辞认出类别 */
const LEGACY_CODES: [RegExp, ReviewCode][] = [
  [/^字数 \d+，低于/, 'short'],
  [/^字数 \d+，超出/, 'long'],
  [/缺少场景标题/, 'scene'],
  [/结尾没有钩子/, 'hook'],
  [/开场没有(接住|承接)/, 'carry'],
  [/^计划本集(埋设|回收)/, 'plan'],
  [/^主角.*本集没有台词/, 'hero'],
  [/未在人物设定中登记/, 'unknown'],
  [/^蓝图里的出场人物/, 'absent'],
  [/^人物状态冲突/, 'state'],
  [/集回收，本集又出现/, 'paid'],
  [/^AI 味词汇/, 'filler'],
  [/台词超过 30 字/, 'longLine'],
  [/条标注待处理/, 'notes'],
]
const codeOf = (i: ReviewItem) => i.code ?? LEGACY_CODES.find(([re]) => re.test(i.text))?.[1]

/** 长台词在中段的标点处拆成两句 */
function splitLong(zh: string): [string, string] | null {
  const mid = zh.length / 2
  const cuts = [...zh.matchAll(/[，。！？；…]/g)].map((m) => m.index! + 1).filter((i) => i > 6 && i < zh.length - 4)
  if (!cuts.length) return null
  const at = cuts.reduce((a, b) => (Math.abs(b - mid) < Math.abs(a - mid) ? b : a))
  return [zh.slice(0, at).replace(/，$/, '。'), zh.slice(at)]
}

/**
 * AI 修稿：生成新版本，标注过的行一律按标注改写。
 * - 审过稿：逐条按审稿意见改——能直接改的改掉；人物登记、已回收伏笔的真相这类剧情判断不擅自改，列给编剧
 * - 复审里两轮没改掉、改好又出现的意见不再改，交给编剧；编剧保留不改的意见不动
 * - 没审稿（或旧报告没有意见类别）：自检去 AI 味、补伏笔与钩子、字数不足时扩写
 */
export function reviseDraft(p: Project, d: DraftLike, seed: number, review?: Pick<DraftReview, 'items'>): RevisedDraft {
  const kit = kitOf(p)
  const ctx = ctxOf(p, kit)
  const cast = castOf(p)
  const r = rng(hash(`${p.id}-rev${d.ep}`) + seed)
  const kept = keptOf(p.work.keeps, d.ep)
  const coded = (review?.items ?? []).flatMap((i) => {
    const code = i.level === 'ok' || kept.has(itemKey(i)) ? undefined : codeOf(i)
    return code ? [{ ...i, code }] : []
  })
  // AI 改不动的意见交给编剧，这一轮不再改
  const stuck = coded.filter((i) => isStuck(i.status))
  const live = coded.filter((i) => !isStuck(i.status))
  const skip = new Set(stuck.map(itemKey))
  const liveKeys = new Set(live.map(itemKey))
  const todo = new Set<ReviewCode>(coded.length ? live.map((i) => i.code) : ['filler', 'plan', 'hook', 'short'])
  const noted = new Set((d.notes ?? []).map((n) => n.lineId))
  const changes: string[] = []
  const manual: string[] = stuck.map((i) => `${i.text}（${i.status === 'back' ? '改好后又出现' : '两轮没改掉'}，AI 不再改，请人工处理或保留不改）`)
  const size = (ls: Omit<ScriptLine, 'id'>[]) => ls.reduce((n, l) => n + l.zh.replace(/\s/g, '').length, 0)

  let polished = 0
  let lines: Omit<ScriptLine, 'id'>[] = d.lines.map((l) => {
    if (l.kind === 'scene' || l.kind === 'hook') return l
    if (noted.has(l.id)) {
      const out = reviseText(p, l.zh, 'rewrite', l.kind, seed)
      return { ...l, zh: out.zh, en: out.en }
    }
    if (!todo.has('filler')) return l
    const zh = stripFillers(l.zh)
    if (zh === l.zh) return l
    polished++
    return { ...l, zh, en: undefined }
  })
  if (noted.size) changes.push(`按 ${noted.size} 条标注改写`)
  if (polished) changes.push(`去掉 AI 味 ${polished} 处`)

  // 核心设定里不许出现的词：删掉
  if (todo.has('rule')) {
    for (const { term } of ruleTermsOf(p).filter((t) => liveKeys.has(`rule:${t.term}`))) {
      const n = lines.filter((l) => l.zh.includes(term)).length
      lines = lines.map((l) => (l.zh.includes(term) ? { ...l, zh: dropTerms(l.zh, [term]), en: undefined } : l))
      if (n) changes.push(`按全局写作要求删去「${term}」${n} 处`)
    }
  }

  // 已经不能出场的人物：台词改成闪回
  if (todo.has('state')) {
    const gone = goneBefore(p, d.ep).filter((c) => !skip.has(`state:${c.name}`))
    for (const c of gone) {
      const n = lines.filter((l) => l.kind === 'dialogue' && l.speaker === c.name).length
      lines = lines.map((l): Omit<ScriptLine, 'id'> => (l.kind === 'dialogue' && l.speaker === c.name ? { kind: 'action', zh: `△（闪回）${c.name}：${l.zh}` } : l))
      if (n) changes.push(`${c.name}第 ${c.stateEp} 集已「${c.state}」，${n} 句台词改成闪回`)
    }
  }

  // 寡言的人物：长台词压短
  if (todo.has('voice')) {
    for (const c of taciturnOf(p).filter((x) => liveKeys.has(`voice:${x.name}`))) {
      let n = 0
      lines = lines.map((l) => {
        if (l.kind !== 'dialogue' || l.speaker !== c.name || l.zh.length <= TACITURN_MAX) return l
        n++
        return { ...l, zh: shortVoice(l.zh), en: undefined }
      })
      if (n) changes.push(`${c.name}性格寡言：压短 ${n} 句台词`)
    }
  }

  if (todo.has('longLine')) {
    let n = 0
    lines = lines.flatMap((l): Omit<ScriptLine, 'id'>[] => {
      const parts = l.kind === 'dialogue' && l.zh.length > 30 ? splitLong(l.zh) : null
      if (!parts) return [l]
      n++
      return parts.map((zh) => ({ ...l, zh, en: undefined }))
    })
    if (n) changes.push(`拆短 ${n} 句长台词`)
  }

  const carry = carryOf(p.work, d.ep)
  if (todo.has('carry') && carry) {
    const at = lines.findIndex((l) => l.kind === 'scene') + 1
    lines.splice(at, 0, { kind: 'action', zh: `△（${carry.auto ? '接上集' : '承接'}）${carry.text}` })
    changes.push(carry.auto ? '开场接上上集结尾的钩子' : '开场接住蓝图里的「承接」')
  }

  const event = eventOf(p, d.ep)
  if (todo.has('event') && event && !flatText(lines as ScriptLine[]).includes(event.key)) {
    // 放在开场：场景标题与承接之后
    let at = lines.findIndex((l) => l.kind === 'scene') + 1
    while (at > 0 && at < lines.length && /^△（(接上集|承接)）/.test(lines[at].zh)) at++
    lines.splice(at, 0, { kind: 'action', zh: `△ ${event.text}。` })
    changes.push(`补上集纲里的本集事件「${clip(event.text, 16)}」`)
  }

  if (todo.has('scene') && !lines.some((l) => l.kind === 'scene')) {
    const place = kit.places[d.ep % kit.places.length]
    lines.unshift({ kind: 'scene', zh: `${place.zh} 日 内`, en: `INT. ${place.en} – DAY` })
    changes.push(`补上场景标题「${place.zh} 日 内」`)
  }

  // 补写的内容放在结尾钩子之前
  const beforeHook = (extra: Omit<ScriptLine, 'id'>[]) => {
    const at = lines.findIndex((l) => l.kind === 'hook')
    lines.splice(at < 0 ? lines.length : at, 0, ...extra)
  }

  const missing = todo.has('plan') ? missingPlans(p, { ...d, lines: lines as ScriptLine[] }).filter(({ f, kind }) => !skip.has(`plan:${f.id}:${kind}`)) : []
  if (missing.length) {
    beforeHook(
      missing.flatMap(({ f, kind }) =>
        planLines(f, kind).map((l): Omit<ScriptLine, 'id'> =>
          l.kind === 'action' ? { kind: 'action', zh: l.zh } : { kind: 'dialogue', speaker: cast[l.speech.who].zh, speakerEn: cast[l.speech.who].en, zh: fill(l.speech.zh, ctx) },
        ),
      ),
    )
    changes.push(`补写伏笔 ${missing.map(({ f }) => `「${foreshadowName(f)}」`).join('')}`)
  }

  if (todo.has('hero') && !speakers(lines as ScriptLine[]).includes(cast.hero.zh)) {
    beforeHook([{ kind: 'dialogue', speaker: cast.hero.zh, speakerEn: cast.hero.en, zh: pick(r, HERO_LINES) }])
    changes.push(`给主角${cast.hero.zh}补一句台词`)
  }

  if (todo.has('absent')) {
    const text = lines.map((l) => l.zh).join('\n')
    const absent = (blueprintOf(p.work, d.ep)?.cast ?? '').split(/[、,，\s]+/).filter((n) => n && !text.includes(n))
    if (absent.length) {
      beforeHook(absent.map((n) => ({ kind: 'action', zh: `△ ${n}出现在门口，${cast.hero.zh}的目光一沉。` })))
      changes.push(`让蓝图里的 ${absent.join('、')} 出场`)
    }
  }

  if (todo.has('hook') && !lines.some((l) => l.kind === 'hook')) {
    const o = p.work.outline.find((x) => x.ep === d.ep)
    lines.push({ kind: 'hook', zh: blueprintOf(p.work, d.ep)?.hook.trim() || o?.hookLine || fill(pick(r, HOOK_LINES['悬念']), ctx) })
    changes.push('补上结尾钩子')
  }

  const target = estimateChars(p.spec.episodeSeconds)
  if (todo.has('short') && size(lines) < target * 0.8) {
    let total = size(lines)
    lines = lines.flatMap((l): Omit<ScriptLine, 'id'>[] => {
      if (total >= target * 0.8 || l.kind !== 'action') return [l]
      const zh = fill(pick(r, EXPAND_ACTION), ctx)
      total += zh.length
      return [l, { kind: 'action', zh: `△ ${zh}` }]
    })
    changes.push('扩写动作与镜头描写')
  }

  if (todo.has('long')) {
    // 从后往前删普通动作描写；承接、闪回与伏笔所在的行保留
    const keys = p.work.foreshadows.map(foreshadowKey).filter(Boolean)
    const keep = (l: Omit<ScriptLine, 'id'>) => l.kind !== 'action' || /^△（/.test(l.zh) || keys.some((k) => l.zh.replace(/\s/g, '').includes(k))
    let total = size(lines)
    let n = 0
    for (let i = lines.length - 1; i >= 0 && total > target * 1.15; i--) {
      if (keep(lines[i])) continue
      total -= lines[i].zh.replace(/\s/g, '').length
      lines.splice(i, 1)
      n++
    }
    if (n) changes.push(`精简 ${n} 处动作描写，压到约 ${total} 字`)
  }

  for (const i of live) {
    if (i.code === 'unknown') manual.push(`${i.text}：去人物设定登记，或改成已登记的名字`)
    if (i.code === 'paid') manual.push(i.text)
  }
  if (!changes.length) changes.push(coded.length ? '审稿意见里没有需要 AI 改写的问题' : '通读润色，未发现需要改动的问题')
  return { lines: lines.map((l) => ({ ...l, id: newId() })), changes, manual }
}

/* ---------------------------------- 质检修稿 ---------------------------------- */

/** 按一条质检问题改定稿：新正文、改了什么、留给编剧的、对照过哪些设定 */
export interface QaFix {
  lines: ScriptLine[]
  changes: string[]
  manual: string[]
  checked: string[]
  /** 补译过台词 */
  translated?: boolean
}

/** 「姓 + 称谓」的叫法：陆总、林小姐 */
const TITLE_RE = /^(\S)(总|董|哥|姐|爷|少|先生|小姐|太太|夫人|叔|姨|医生|老师|警官)$/
/** 外景地点 */
const OUTDOOR_RE = /街|路|门口|天台|广场|院子|花园|停车场|码头|桥|山|海边|江边|郊外|外景/
/** 付费钩子卡在答案揭晓之前：只加悬停，不新增剧情 */
const CLIFF_TAILS = ['……可这，真的就是全部吗？', '——而这，只是开始。', '……下一秒，所有人都愣住了——']

/** 没登记的称呼对应到已登记人物：名字互相包含，或「姓 + 称谓」只对得上一个人 */
function registeredAs(p: Project, name: string) {
  const chars = p.work.characters.filter((c) => c.name.trim())
  const hit = chars.filter((c) => c.name.includes(name) || name.includes(c.name))
  if (hit.length === 1) return hit[0]
  const surname = name.match(TITLE_RE)?.[1]
  const same = surname ? chars.filter((c) => c.name.startsWith(surname)) : []
  return same.length === 1 ? same[0] : undefined
}

/** 场景标题补齐「地点 日/夜 内/外」 */
function normalizeScene(zh: string) {
  const parts = zh.trim().replace(/[（(]([日夜晨内外、/\s]|黄昏)+[)）]/g, ' ').split(/\s+/).filter(Boolean)
  const tags = parts.filter((t) => /^(日|夜|晨|黄昏|内|外|白天|晚上)$/.test(t))
  const place = parts.filter((t) => !tags.includes(t)).join(' ') || placeOf(zh)
  const time = tags.find((t) => /^(日|夜|晨|黄昏)$/.test(t)) ?? (tags.includes('晚上') || /夜|晚/.test(place) ? '夜' : '日')
  const io = tags.find((t) => t === '内' || t === '外') ?? (OUTDOOR_RE.test(place) ? '外' : '内')
  return `${place} ${time} ${io}`
}

/** 缺名的台词：同一场两人对戏时，轮到另一个人说 */
function speakerFor(lines: ScriptLine[], at: number) {
  let from = at
  while (from > 0 && lines[from].kind !== 'scene') from--
  let to = at
  while (to < lines.length - 1 && lines[to + 1].kind !== 'scene') to++
  const names = speakers(lines.slice(from, to + 1).map((l) => ({ ...l, speaker: l.speaker?.trim() })))
  const prev = lines.slice(from, at).reverse().find((l) => l.kind === 'dialogue' && l.speaker?.trim())?.speaker?.trim()
  const others = names.filter((n) => n !== prev)
  return names.length === 2 && others.length === 1 ? others[0] : undefined
}

/**
 * 守住原有设定：新写或改过的行逐条对照人物设定、状态库、伏笔计划与对标剧人名，
 * 不合设定的改动撤回，留给编剧。
 */
function guardFix(p: Project, ep: number, before: ScriptLine[], after: ScriptLine[]) {
  const known = new Map(p.work.characters.filter((c) => c.name.trim()).map((c) => [c.name, c]))
  const state = buildState(p, ep)
  const gone = new Map(state.characters.filter((c) => c.state && GONE.test(c.state)).map((c) => [c.name, c]))
  const bench = (p.work.breakdown?.characters ?? []).map((c) => c.name).filter((n) => n.length >= 2 && !known.has(n))
  const later = p.work.foreshadows.filter((f) => f.plantEp > ep && foreshadowKey(f))
  const old = new Map(before.map((l) => [l.id, l]))
  const dropped: string[] = []

  // 只查这次新写进来的：新开口的人、新出现的人名与伏笔
  const problem = (l: ScriptLine, o?: ScriptLine) => {
    const who = l.kind === 'dialogue' && (!o || o.speaker !== l.speaker) ? l.speaker?.trim() : undefined
    if (who && known.size && !known.has(who)) return `「${who}」不在人物设定里`
    const g = who ? gone.get(who) : undefined
    if (g) return `${g.name}在第 ${g.stateEp} 集已是「${g.state}」，不能开口`
    const fresh = (frag: string) => !o?.zh.replace(/\s/g, '').includes(frag)
    const b = bench.find((n) => l.zh.includes(n) && fresh(n))
    if (b) return `会带入对标剧人名「${b}」`
    const f = later.find((x) => l.zh.replace(/\s/g, '').includes(foreshadowKey(x)) && fresh(foreshadowKey(x)))
    if (f) return `会提前写出第 ${f.plantEp} 集才埋设的伏笔`
  }

  const lines = after.flatMap((l): ScriptLine[] => {
    const o = old.get(l.id)
    if (o && o.zh === l.zh && o.speaker === l.speaker) return [l]
    const why = problem(l, o)
    if (!why) return [l]
    dropped.push(`「${clip(l.zh, 16)}」${why}，这处没有改`)
    return o ? [o] : []
  })

  const checked = [
    known.size ? `人物设定：新写的台词只给已登记的 ${known.size} 个人物` : '人物设定：还没登记人物，没有新增角色',
    state.latestEp ? `状态库：对照${rangeLabel([1, state.latestEp])}定稿的人物状态${gone.size ? `，${[...gone.keys()].join('、')} 不开口` : ''}` : '状态库：本集之前还没有定稿',
    `伏笔计划：只写本集计划内的推进${later.length ? `，后面才埋设的 ${later.length} 条不提前写出` : ''}`,
    ...(bench.length ? [`对标剧：不带入 ${bench.length} 个对标剧人名`] : []),
  ]
  return { lines, dropped, checked }
}

/**
 * 质检里的「AI 修稿」：按一条问题改定稿，只动问题涉及的行，其余行（连同 id、标注、英文）原样保留。
 * 补写的内容只取自已有设定——本集蓝图、集纲、伏笔计划、状态库与已登记人物；
 * 设定里找不到依据的（钩子没写、称呼对不上人、换场景这类剧情判断）不擅自编，列给编剧。
 */
export function fixQaIssue(p: Project, s: EpisodeScript, issue: QaIssue, seed: number): QaFix {
  const { ep } = s
  const kit = kitOf(p)
  const ctx = ctxOf(p, kit)
  const cast = castOf(p)
  const r = rng(hash(`${p.id}-qa${issue.id}`) + seed)
  const bp = blueprintOf(p.work, ep)
  const o = p.work.outline.find((x) => x.ep === ep)
  const at = issue.lineId ? s.lines.findIndex((l) => l.id === issue.lineId) : -1
  const line = at >= 0 ? s.lines[at] : undefined
  const changes: string[] = []
  const manual: string[] = []
  let translated = false
  let lines: ScriptLine[] = [...s.lines]
  const add = (l: Omit<ScriptLine, 'id'>): ScriptLine => ({ ...l, id: newId() })
  const edit = (id: string, patch: Partial<ScriptLine>) => (lines = lines.map((l) => (l.id === id ? { ...l, en: undefined, ...patch } : l)))
  const beforeHook = (extra: ScriptLine[]) => {
    const i = lines.findIndex((l) => l.kind === 'hook')
    lines.splice(i < 0 ? lines.length : i, 0, ...extra)
  }
  const size = () => lines.reduce((n, l) => n + l.zh.replace(/\s/g, '').length, 0)
  const target = estimateChars(p.spec.episodeSeconds)
  const stateOf = (name: string) => buildState(p, ep).characters.find((c) => c.name === name)
  const say = (who: Person, zh: string) => add({ kind: 'dialogue', speaker: who.zh, speakerEn: who.en, zh })

  switch (issue.title) {
    case '开场缺少场景标题': {
      const prev = [...(scriptOf(p.work, ep - 1)?.lines ?? [])].reverse().find((l) => l.kind === 'scene')
      const own = lines.find((l) => l.kind === 'scene')
      const heading = prev ? normalizeScene(prev.zh) : own ? normalizeScene(own.zh) : `${kit.places[ep % kit.places.length].zh} 日 内`
      lines.unshift(add({ kind: 'scene', zh: heading }))
      changes.push(`开头补上场景标题「${heading}」（${prev ? '接着上集结尾的场景' : own ? '沿用本集的场景' : '取题材常用场景'}）`)
      break
    }
    case '场景标题格式不规范':
      if (line) {
        const zh = normalizeScene(line.zh)
        edit(line.id, { zh })
        changes.push(`场景标题「${line.zh.trim()}」改成「${zh}」`)
      }
      break
    case '结尾没有钩子':
    case '付费卡点没有钩子': {
      const hook = bp?.hook.trim() || o?.hookLine.trim()
      if (hook) {
        lines.push(add({ kind: 'hook', zh: hook }))
        changes.push(`结尾补上钩子，取自${bp?.hook.trim() ? '本集蓝图' : '集纲'}：「${clip(hook, 24)}」`)
      } else manual.push('本集蓝图和集纲都没写末尾钩子：先在蓝图里定下钩子，AI 不擅自编悬念')
      break
    }
    case '付费钩子不够力':
      if (line) {
        const own = bp?.hook.trim()
        const zh = own && own !== line.zh.trim() && /[？?！!…—]/.test(own) ? own : `${line.zh.trim().replace(/[。.！!]+$/, '')}${pick(r, CLIFF_TAILS)}`
        edit(line.id, { zh })
        changes.push(own && zh === own ? '钩子换成本集蓝图里的末尾钩子' : '钩子收在答案揭晓之前，不新增剧情')
      }
      break
    case '台词缺少角色名':
      if (line) {
        const who = speakerFor(lines, at)
        const c = who ? p.work.characters.find((x) => x.name === who) : undefined
        if (who && c) {
          edit(line.id, { speaker: who, speakerEn: c.nameEn || who, en: line.en })
          changes.push(`「${clip(line.zh, 12)}」补上说话人${who}（同场两人对戏，轮到${who}）`)
        } else manual.push(`「${clip(line.zh, 12)}」从上下文判断不出是谁说的，请补上说话人`)
      }
      break
    case 'AI 味词汇':
      if (line) {
        const zh = stripFillers(line.zh).trim()
        if (zh) edit(line.id, { zh })
        else lines = lines.filter((l) => l.id !== line.id)
        changes.push(zh ? `删掉「${issue.quote}」等模型腔` : `删掉只有模型腔的一行「${clip(line.zh, 12)}」`)
      }
      break
    case '台词过长':
      if (line) {
        const parts = splitLong(line.zh)
        if (parts) {
          lines.splice(lines.indexOf(line), 1, { ...line, zh: parts[0], en: undefined }, add({ ...line, zh: parts[1], en: undefined }))
          changes.push(`${line.speaker ?? ''}这句拆成两句：「${clip(parts[0], 12)}」/「${clip(parts[1], 12)}」`)
        } else manual.push('这句中间没有能断开的标点，请手动精简')
      }
      break
    case '台词未翻译': {
      const out = translateLines(p, lines)
      const n = out.lines.filter((l, i) => l.en && !lines[i].en).length
      lines = out.lines
      translated = n > 0
      if (n) changes.push(`补译 ${n} 句台词`)
      if (out.missing) manual.push(`${out.missing} 句改写过的台词本地无法翻译，接入模型后再译`)
      break
    }
    case '篇幅不足': {
      let total = size()
      let n = 0
      lines = lines.flatMap((l) => {
        if (total >= target * 0.85 || l.kind !== 'action' || /^△（/.test(l.zh)) return [l]
        const zh = `△ ${fill(pick(r, EXPAND_ACTION), ctx)}`
        total += zh.length
        n++
        return [l, add({ kind: 'action', zh })]
      })
      changes.push(n ? `扩写 ${n} 处动作与镜头描写，不加新情节` : '没有可扩写的动作描写')
      break
    }
    case '篇幅超出单集时长': {
      const keys = p.work.foreshadows.map(foreshadowKey).filter(Boolean)
      const keep = (l: ScriptLine) => l.kind !== 'action' || /^△（/.test(l.zh) || keys.some((k) => l.zh.replace(/\s/g, '').includes(k))
      let n = 0
      for (let i = lines.length - 1; i >= 0 && size() > target * 1.15; i--) {
        if (keep(lines[i])) continue
        lines.splice(i, 1)
        n++
      }
      if (n) changes.push(`删掉 ${n} 处普通动作描写，伏笔、承接与闪回保留，压到约 ${size()} 字`)
      if (size() > target * 1.15) manual.push('只删动作描写压不到时长内：考虑把一场戏挪到下一集')
      break
    }
    case '人物未登记 / 称谓不统一': {
      const name = issue.quote ?? line?.speaker ?? ''
      const c = registeredAs(p, name)
      if (c) {
        const n = lines.filter((l) => l.speaker === name).length
        lines = lines.map((l) => (l.speaker === name ? { ...l, speaker: c.name, speakerEn: c.nameEn || c.name } : l))
        changes.push(`「${name}」统一成人物设定里的${c.name}（${n} 句台词）`)
      } else manual.push(`「${name}」对不上已登记的人物：去人物设定登记，或改成已登记的称谓（AI 不擅自新增人物）`)
      break
    }
    case '仍出现对标剧人名': {
      const name = issue.quote ?? ''
      const c = p.work.characters.find((x) => x.benchmark.trim() === name)
      if (c) {
        lines = lines.map((l) => {
          const zh = l.zh.split(name).join(c.name)
          const speaker = l.speaker === name ? c.name : l.speaker
          return zh === l.zh && speaker === l.speaker ? l : { ...l, zh, speaker, speakerEn: speaker === c.name ? c.nameEn || c.name : l.speakerEn, en: zh === l.zh ? l.en : undefined }
        })
        changes.push(`对标剧的「${name}」换成本剧对应的${c.name}`)
      } else manual.push(`人物设定里没有哪个角色对应对标剧的「${name}」：先在人物设定里填好对应关系`)
      break
    }
    case '主角本集没有台词': {
      const hero = p.work.characters.find((c) => c.role === '主角')
      const st = hero && stateOf(hero.name)
      if (!hero) manual.push('还没有登记主角')
      else if (st?.state && GONE.test(st.state)) manual.push(`${hero.name}在第 ${st.stateEp} 集已是「${st.state}」，本集是否开口需要编剧判断`)
      else {
        beforeHook([say(cast.hero, pick(r, HERO_LINES))])
        changes.push(`结尾钩子前给主角${hero.name}补一句台词`)
      }
      break
    }
    case '久未出场': {
      const name = issue.quote ?? ''
      const st = stateOf(name)
      if (line && st?.state && !GONE.test(st.state)) {
        lines.splice(lines.indexOf(line), 0, add({ kind: 'action', zh: `△ 久未露面的${name}再次出现——${clip(st.state, 24)}。` }))
        changes.push(`${name}出场前加一句交代，取自状态库第 ${st.stateEp} 集的「${clip(st.state, 16)}」`)
      } else if (st?.state) manual.push(`${name}在第 ${st.stateEp} 集已是「${st.state}」，怎么回来需要编剧交代`)
      else manual.push(`状态库里没有${name}的去向记录：请补一句交代，AI 不擅自编`)
      break
    }
    case '状态突变没有交代': {
      const text = lines.map((l) => l.zh).join('')
      const silent = Object.entries(s.states).filter(([name, v]) => v.trim() && !lines.some((l) => l.speaker === name) && !text.includes(name))
      if (silent.length) {
        beforeHook(silent.map(([name, v]) => add({ kind: 'action', zh: `△ ${name}的近况传来：${v.trim().replace(/[。]$/, '')}。` })))
        changes.push(`补一句交代 ${silent.map(([n]) => n).join('、')} 的状态变化（按本集记下的人物状态）`)
      }
      break
    }
    case '伏笔未埋设':
    case '伏笔未回收': {
      const kind = issue.title === '伏笔未埋设' ? 'plant' : 'payoff'
      const flat = flatText(lines)
      const list = p.work.foreshadows.filter((f) => (kind === 'plant' ? f.plantEp : f.payoffEp) === ep && foreshadowKey(f) && !flat.includes(foreshadowKey(f)))
      beforeHook(
        list.flatMap((f) =>
          planLines(f, kind).map((l) => (l.kind === 'action' ? add({ kind: 'action', zh: l.zh }) : say(cast[l.speech.who], fill(l.speech.zh, ctx)))),
        ),
      )
      if (list.length) changes.push(`按伏笔计划${kind === 'plant' ? '埋设' : '回收'}${list.map((f) => `「${foreshadowName(f)}」`).join('')}`)
      break
    }
    case '没承接上一集的钩子': {
      const prev = scriptOf(p.work, ep - 1)
      const hook = prev && hookOf(prev)
      if (hook) {
        lines.splice(lines.findIndex((l) => l.kind === 'scene') + 1, 0, add({ kind: 'action', zh: `△（接上集）${hook}` }))
        changes.push(`开场接住第 ${ep - 1} 集的结尾钩子`)
      }
      break
    }
    case '情绪低于目标曲线':
    case '卡点没落在情绪波峰': {
      const beat = bp?.conflict.trim() || o?.event.trim()
      if (beat) {
        beforeHook([add({ kind: 'action', zh: `△ 正面对峙：${clip(beat, 40)}` }), say(cast.hero, '今天当众把话说清楚——谁也别想再糊弄过去！')])
        changes.push(`结尾前加一场正面对峙，冲突取自${bp?.conflict.trim() ? '本集蓝图的「冲突与转折」' : '集纲'}`)
      } else manual.push('本集蓝图和集纲都没写冲突：先补蓝图，再决定加哪场戏')
      break
    }
    case '大反转不够明显': {
      const payoff = p.work.foreshadows.find((f) => f.payoffEp === ep && foreshadowKey(f))
      const turn = bp?.conflict.split(/转折[:：]?|，却|，但|没想到/).slice(1).join('，').trim()
      if (payoff) {
        beforeHook([add({ kind: 'action', zh: `△ 真相揭晓——${clauseOf(payoff)}。` })])
        changes.push(`把伏笔「${foreshadowName(payoff)}」的真相当面揭开（伏笔计划本集回收）`)
      } else if (turn) {
        beforeHook([add({ kind: 'action', zh: `△ 原来，${turn.replace(/[。]$/, '')}。` })])
        changes.push('按本集蓝图的转折写一场明确的揭秘')
      } else manual.push('伏笔计划和本集蓝图里都没有本集的反转：先定下反转内容')
      break
    }
    case '场景单调':
      manual.push('换场景会牵动走位与人物调度，AI 不擅自改：可在本集蓝图里换场景后重写')
      break
    default:
      manual.push('这类问题需要编剧判断，AI 没有改动正文')
  }

  const guarded = guardFix(p, ep, s.lines, lines)
  // 改动全被设定挡回时，不再报「改了什么」
  const same = guarded.lines.length === s.lines.length && guarded.lines.every((l, i) => l === s.lines[i])
  return { lines: guarded.lines, changes: same && !translated ? [] : changes, manual: [...manual, ...guarded.dropped], checked: guarded.checked, ...(translated ? { translated } : {}) }
}

/** 定稿后提炼本集要点，回填到分集蓝图 */
export function extractPoints(p: Project, d: DraftLike & { states: Record<string, string> }): string {
  const actions = d.lines.filter((l) => l.kind === 'action' && !/^△（(接上集|承接)）/.test(l.zh))
  const clean = (t?: string) => (t ?? '').replace(/^△\s*/, '').replace(/[。]$/, '')
  const turn = actions.find((l) => /真相揭晓|特写|闪回/.test(l.zh)) ?? actions[Math.floor(actions.length / 2)]
  const flat = flatText(d.lines)

  const earlier = p.work.scripts.filter((s) => s.ep < d.ep)
  const seenPlaces = new Set(earlier.flatMap((s) => s.lines.filter((l) => l.kind === 'scene').map((l) => l.zh.split(' ')[0])))
  const seenPeople = new Set(earlier.flatMap((s) => speakers(s.lines)))
  const newPlaces = [...new Set(d.lines.filter((l) => l.kind === 'scene').map((l) => l.zh.split(' ')[0]))].filter((x) => !seenPlaces.has(x))
  const newPeople = speakers(d.lines).filter((n) => !seenPeople.has(n))
  const plans = p.work.foreshadows.filter((f) => foreshadowKey(f) && flat.includes(foreshadowKey(f)))

  const states = Object.entries(d.states)
  const out = [
    `# 第${d.ep}集 要点`,
    '',
    '## 剧情节点',
    `- [触发] ${clean(actions[0]?.zh)}`,
    `- [转折] ${clean(turn?.zh)}`,
    `- [结果] ${hookOf(d) ?? clean(actions.at(-1)?.zh)}`,
    '',
    '## 角色动态',
    ...(states.length ? ['| 角色 | 本集变化/状态 |', '|------|-------------|', ...states.map(([n, s]) => `| ${n} | ${s} |`)] : ['- 无明显变化']),
  ]
  if (plans.length) out.push('', '## 伏笔推进', ...plans.map((f) => `- ${f.plantEp === d.ep ? '埋设' : f.payoffEp === d.ep ? '回收' : '呼应'}「${foreshadowName(f)}」`))
  if (newPlaces.length || newPeople.length) {
    out.push('', '## 新增设定')
    if (newPeople.length) out.push(`- 首次出场：${newPeople.join('、')}`)
    if (newPlaces.length) out.push(`- 新场景：${newPlaces.join('、')}`)
  }
  return out.join('\n')
}

/* ---------------------------------- 改写 / 翻译 ---------------------------------- */

export type ReviseMode = 'rewrite' | 'expand' | 'polish'

/** 所有模板台词按当前人物展开后的中英对照，用于改写换句与翻译 */
function speechBook(p: Project) {
  const kit = kitOf(p)
  const cast = castOf(p)
  const zh = ctxOf(p, kit)
  const en = ctxOf(p, kit, 'en')
  const groups = Object.values(SCENES).flatMap((pool) =>
    SLOTS.map((who) =>
      pool.exchanges
        .flat()
        .filter((s) => s.who === who)
        .map((s) => ({ who: cast[who].zh, zh: fill(s.zh, zh), en: fill(s.en, en) })),
    ),
  )
  const extra = [PLANT_LINE, PAYOFF_LINE, ...EXPAND_SPEECH.map((s) => ({ ...s, who: 'hero' as Slot }))].map((s) => ({ who: '', zh: fill(s.zh, zh), en: fill(s.en, en) }))
  const dict = new Map<string, string>()
  for (const s of [...groups.flat(), ...extra]) dict.set(s.zh, s.en)
  return { groups: groups.filter((g) => g.length > 1), dict }
}

export function reviseText(p: Project, text: string, mode: ReviseMode, kind: ScriptLineKind, seed: number): { zh: string; en?: string } {
  const r = rng(hash(text) + seed)
  const zh = ctxOf(p, kitOf(p))
  const trimmed = text.trim()

  if (mode === 'polish') {
    let out = stripFillers(trimmed)
    if (out === trimmed && kind === 'dialogue') out = out.replace(/。$/, '')
    return { zh: out || trimmed }
  }

  if (mode === 'expand') {
    if (kind === 'dialogue') {
      const extra = pick(r, EXPAND_SPEECH)
      return { zh: `${trimmed.replace(/[。]$/, '')}。${extra.zh}` }
    }
    return { zh: `${trimmed.replace(/[。]$/, '')}。${fill(pick(r, EXPAND_ACTION), zh)}` }
  }

  // 改写：模板台词换成同一人物的另一句；否则做近义替换
  const book = speechBook(p)
  const group = book.groups.find((g) => g.some((s) => s.zh === trimmed))
  if (group) {
    const alt = pick(
      r,
      group.filter((s) => s.zh !== trimmed),
    )
    return { zh: alt.zh, en: alt.en }
  }
  const swapped = SYNONYMS.reduce((t, [a, b]) => (t.includes(a) && !t.includes(b) ? t.replace(a, b) : t), trimmed)
  if (swapped !== trimmed) return { zh: swapped }
  return { zh: kind === 'dialogue' ? `${pick(r, ['听着，', '说实话，', '我再说一遍：'])}${trimmed}` : `镜头一转，${trimmed.replace(/^△\s*/, '')}` }
}

/** 续写：接着选中的一句往下写；对话：围绕选中内容补一段两人对白。返回插在选中行之后的新行 */
export type ExtendMode = 'continue' | 'dialogue'

export function extendText(p: Project, line: ScriptLine, mode: ExtendMode, seed: number): ScriptLine[] {
  const kit = kitOf(p)
  const cast = castOf(p)
  const zh = ctxOf(p, kit)
  const en = ctxOf(p, kit, 'en')
  const r = rng(hash(line.zh) + seed)
  const say = (s: Speech): ScriptLine => ({ id: newId(), kind: 'dialogue', speaker: cast[s.who].zh, speakerEn: cast[s.who].en, zh: fill(s.zh, zh), en: fill(s.en, en) })
  const exchanges = Object.values(SCENES).flatMap((pool) => pool.exchanges)
  // 优先找有选中行说话人参与的对白
  const own = exchanges.filter((x) => x.some((s) => cast[s.who].zh === line.speaker))
  const exchange = pick(r, own.length && mode === 'continue' ? own : exchanges)

  if (mode === 'dialogue') return exchange.slice(0, 3).map(say)
  const action: ScriptLine = { id: newId(), kind: 'action', zh: `△ ${fill(pick(r, EXPAND_ACTION), zh)}` }
  return line.kind === 'dialogue' ? [say(exchange.find((s) => cast[s.who].zh !== line.speaker) ?? exchange[0]), action] : [action, say(exchange[0])]
}

/** 一键翻译：有对照的台词补上英文；改写过、找不到对照的保持空，提示接入模型后翻译 */
export function translateLines(p: Project, lines: ScriptLine[]): { lines: ScriptLine[]; missing: number } {
  const { dict } = speechBook(p)
  let missing = 0
  const out = lines.map((l) => {
    if (l.kind !== 'dialogue' || l.en) return l
    const en = dict.get(l.zh) ?? joinParts(l.zh, dict)
    if (!en) missing++
    return en ? { ...l, en } : l
  })
  return { lines: out, missing }
}

/** 扩写过的台词由两句模板拼成时，分别查对照再拼起来 */
function joinParts(text: string, dict: Map<string, string>) {
  const parts = text.split(/(?<=[。！？])/).map((s) => s.trim()).filter(Boolean)
  if (parts.length < 2) return undefined
  const en = parts.map((s) => dict.get(s) ?? dict.get(s.replace(/。$/, '')))
  return en.every(Boolean) ? en.join(' ') : undefined
}
