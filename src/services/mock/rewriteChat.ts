/**
 * 改写方案 · 多轮对话 Demo 的本地模拟：AI 先读对标剧拆解给几个方向，选定后按引导一项一项磨。
 * 每轮只改编剧提到的那几项，锁定的不动；核心设定改了提醒已锁定的项复核。接入大模型后替换这里。
 */
import type { Project } from '../../domain/types'
import { labReference } from './archLab'
import { otherKits } from './kits'
import type { Kit } from './kits'
import { clip, pick, rng } from './rng'
import { coreCtx, fill, kitOf, proposeDirections } from './writer'
import type { Direction } from './writer'

/** 改写方案的七项：由小到大，先定一句话，再到人物、冲突、爽点、结局，最后是和对标剧的取舍 */
export type PlanField = 'logline' | 'hero' | 'conflict' | 'formula' | 'ending' | 'keep' | 'change'

export const PLAN_ORDER: PlanField[] = ['logline', 'hero', 'conflict', 'formula', 'ending', 'keep', 'change']

/** keys：编剧的话里提到这些词，就改这一项 */
export const PLAN_META: Record<PlanField, { title: string; keys: RegExp }> = {
  logline: { title: '核心设定', keys: /核心设定|一句话|故事核/ },
  hero: { title: '主角', keys: /主角|女主|男主|人设/ },
  conflict: { title: '反派与核心冲突', keys: /反派|对手|敌人|冲突|对立/ },
  formula: { title: '爽点公式', keys: /爽|打脸|节奏|虐|甜/ },
  ending: { title: '结局走向', keys: /结局|结尾|收尾/ },
  keep: { title: '保留什么', keys: /保留|沿用|照搬/ },
  change: { title: '改动什么', keys: /拉开|差异|区别|改动|换掉/ },
}

export const fieldTitle = (f: PlanField) => PLAN_META[f].title

export interface RewritePlan {
  /** 方向名 */
  title: string
  fields: Record<PlanField, string>
}

export interface ChatChange {
  field: PlanField
  before: string
  after: string
}

/** 快捷回复点下去做什么 */
export type ChatAction =
  | { kind: 'say'; text: string }
  /** 锁定这一项，接着聊下一项 */
  | { kind: 'lock'; field: PlanField }
  /** 这一项先不管，接着聊下一项 */
  | { kind: 'skip'; field: PlanField }
  /** 不改了，接着聊这一项 */
  | { kind: 'ask'; field: PlanField }
  /** 解锁后按刚才那句话再改 */
  | { kind: 'unlock'; field: PlanField; text: string }
  /** 回到上一版 */
  | { kind: 'undo' }
  /** 方向换一批 */
  | { kind: 'refresh' }
  /** 自己写：光标放进输入框 */
  | { kind: 'focus' }

export interface ChatOption {
  label: string
  action: ChatAction
}

export interface ChatReply {
  text: string
  /** 起步时给的几个方向 */
  directions?: Direction[]
  /** 这一轮改出来的新方案；没改就没有 */
  plan?: RewritePlan
  changes?: ChatChange[]
  /** 提醒：锁定的没动、核心设定变了要复核、出现对标剧人名 */
  notes?: string[]
  /** 接下来聊哪一项 */
  topic: PlanField | null
  options: ChatOption[]
}

/** 每一轮带给模型的内容：对标剧拆解的总纲层结果 + 当前方案 + 锁定项 + 最近几轮对话；逐集明细太细不带 */
export function chatContext(p: Project) {
  const ref = labReference(p)
  return ref
    ? { source: `对标剧拆解（${ref.used.join('、')}）`, skipped: ref.skipped }
    : { source: '立项信息（题材类型、风格元素、受众、核心设定）', skipped: [] as string[] }
}

const trimEnd = (t: string) => t.trim().replace(/[。；;，,\s]+$/, '')

/** 方向里的题材套件：题材迁移的方向用的是别的套件 */
function kitForDirection(p: Project, d: Direction): Kit {
  const own = kitOf(p)
  return [own, ...otherKits(own)].find((k) => d.plan.includes(k.world.split('：')[0])) ?? own
}

function planOf(p: Project, kit: Kit, title: string, logline: string, keep: string, change: string, formula: string, middle?: string): RewritePlan {
  const ctx = coreCtx(p, kit)
  const { hero, villain } = kit.roles
  return {
    title,
    fields: {
      logline: logline.trim(),
      hero: `${ctx.hero}：${fill(hero.profile, ctx)}。想要${fill(hero.desire, ctx)}，最大的缺陷是${fill(hero.flaw, ctx)}。`,
      conflict: `${ctx.villain}：${fill(villain.profile, ctx)}。${middle ? `${trimEnd(middle)}。` : ''}`,
      formula,
      ending: `${fill(kit.ending, ctx)}。`,
      keep,
      change,
    },
  }
}

/** 选定一个方向：整理成七项的改写方案 */
export function planFromDirection(p: Project, d: Direction): RewritePlan {
  const line = (k: string) => d.plan.split('\n').find((l) => l.startsWith(`${k}：`))?.slice(k.length + 1) ?? ''
  return planOf(p, kitForDirection(p, d), d.title, d.logline, line('保留'), line('改动'), d.formula, d.mainLine[1]?.content)
}

/** 从编剧自己的想法起步 */
function planFromIdea(p: Project, idea: string): RewritePlan {
  const kit = kitOf(p)
  const ctx = coreCtx(p, kit)
  const bench = p.work.breakdown
  const text = trimEnd(idea)
  const logline = text.length >= 24 ? `${text}。` : `${text}——${fill(kit.secret, ctx)}。`
  const keep = bench ? `对标剧的五段式主线与第 ${bench.rhythm.paywalls.join('、')} 集付费节奏` : `立项的「${kit.label}」题材与目标受众`
  return planOf(p, kit, '按你的想法', logline, keep, `按你的想法：${clip(text, 40)}`, kit.formula)
}

/** 引导：每一项问什么、给哪几个现成的回答 */
function question(p: Project, plan: RewritePlan, field: PlanField): { text: string; options: ChatOption[] } {
  const bench = !!p.work.breakdown
  const asks: Record<PlanField, string> = {
    logline: '先把核心设定这一句话磨准：主角是谁、困境是什么、反常规点在哪。',
    hero: '接着是主角：想要什么、缺陷是什么、开局有多惨？',
    conflict: '反派与核心冲突：谁在压着主角、凭什么，冲突怎么一步步升级？',
    formula: '爽点的节奏：每几集来一次什么爽感？前期和后期要不要不一样？',
    ending: '结局往哪收：大团圆、大反转，还是留续集的口子？',
    keep: bench ? '对标剧里哪些要原样保留——主线结构、付费卡点、情绪曲线？' : '立项里哪些要原样保留？',
    change: bench ? '和对标剧拉开差异：人物、道具、题材、反转方式，哪些要换？' : '和同类爆款拉开差异的地方在哪？',
  }
  const ideas: Record<PlanField, string[]> = {
    logline: ['核心设定再狠一点', '反常规点换一个', '一句话说得再短一点'],
    hero: ['主角开局再惨一点', '主角别太惨，开局就要有反击的苗头', '给主角加一个藏着的身份'],
    conflict: ['反派再狠一点，每一步都快半步', '反派要有说得通的动机', '再加一个藏在暗处的反派'],
    formula: ['爽点再密一点，每 2 集一次', '前 10 集多打脸，后面多虐', '加一条感情线的甜点'],
    ending: ['结局要大团圆', '结局留一个续集的口子', '结局来一个大反转'],
    keep: bench ? ['付费卡点位置照搬对标剧', '情绪曲线照搬，人物全换', '只保留开局的结构'] : ['沿用五段式主线', '只保留开局的结构'],
    change: ['关键道具换掉', '换一个题材背景', '悬念改成观众先知道'],
  }
  return {
    text: `${asks[field]}\n现在是：「${clip(plan.fields[field], 70)}」`,
    options: [
      ...ideas[field].map((t): ChatOption => ({ label: t, action: { kind: 'say', text: t } })),
      { label: `这一项没问题，锁定`, action: { kind: 'lock', field } },
      { label: '先跳过', action: { kind: 'skip', field } },
    ],
  }
}

/** 从 from 往后找下一项没锁定的（绕一圈） */
function nextOpen(locks: PlanField[], from: PlanField | null): PlanField | null {
  const at = from ? PLAN_ORDER.indexOf(from) : -1
  const order = [...PLAN_ORDER.slice(at + 1), ...PLAN_ORDER.slice(0, at + 1)]
  return order.find((f) => !locks.includes(f)) ?? null
}

/** 起步：读对标剧拆解，给三个方向 */
export function directionsReply(p: Project, seed: number): ChatReply {
  const ctx = chatContext(p)
  return {
    text: `我先读了${ctx.source}${ctx.skipped.length ? `；${ctx.skipped.join('、')}没带` : ''}。给你三个方向——大路对了就选，细节后面一项一项磨：`,
    directions: proposeDirections(p, seed),
    topic: null,
    options: [
      { label: '都不对，换一批', action: { kind: 'refresh' } },
      { label: '我自己说想法', action: { kind: 'focus' } },
    ],
  }
}

/** 选了一个方向：出方案 v1。之前锁定过的项沿用，只换没锁定的 */
export function pickReply(p: Project, d: Direction, prev: RewritePlan | null, locks: PlanField[]): ChatReply {
  const fresh = planFromDirection(p, d)
  const plan: RewritePlan = prev ? { title: d.title, fields: { ...fresh.fields, ...Object.fromEntries(locks.map((f) => [f, prev.fields[f]])) } } : fresh
  const topic = nextOpen(locks, null) ?? 'logline'
  const q = question(p, plan, topic)
  return {
    text: `定了「${d.title}」，方案在右边${locks.length ? `，锁定的 ${locks.length} 项沿用原来的` : ''}。我们由小到大一项一项磨，满意的就锁定，后面改什么都不会碰它。\n\n${q.text}`,
    plan,
    topic,
    options: q.options,
  }
}

/** 编剧直接说了想法：整理成方案 v1 */
export function ideaReply(p: Project, idea: string): ChatReply {
  const plan = planFromIdea(p, idea)
  const q = question(p, plan, 'logline')
  const notes = trimEnd(idea).length < 24 ? ['想法偏短，核心设定里用题材常见的反常规点补了半句，不合适就直接改'] : []
  return { text: `按你的想法整理成了方案，在右边。\n\n${q.text}`, plan, notes, topic: 'logline', options: q.options }
}

/** 锁定或跳过一项后：接着问下一项 */
export function nextReply(p: Project, plan: RewritePlan, locks: PlanField[], from: PlanField, how: 'lock' | 'skip'): ChatReply {
  const head = how === 'lock' ? `「${fieldTitle(from)}」锁定了，后面改别的不会碰它。` : `「${fieldTitle(from)}」先放着，回头再说。`
  const next = nextOpen(locks, from)
  if (!next)
    return {
      text: `${head}\n七项都锁定了，这版方案可以定下来。右边可以复制全部；Demo 确认后再接进正式的改写方案。`,
      topic: null,
      options: [{ label: '回到上一版', action: { kind: 'undo' } }],
    }
  const q = question(p, plan, next)
  return { text: `${head}\n\n${q.text}`, topic: next, options: q.options }
}

/** 不改了，接着聊某一项 */
export function askReply(p: Project, plan: RewritePlan, field: PlanField): ChatReply {
  const q = question(p, plan, field)
  return { text: q.text, topic: field, options: q.options }
}

/* ---------------------------------- 按一句话改一项 ---------------------------------- */

const HARSH = /再狠|更狠|狠一点|更虐|再惨|更惨|惨一点/
const SOFT = /别太惨|别太虐|轻一点|甜一点|温和|反击的苗头/
const SHORT = /短一点|精简|简短|说得再短/
const AGAIN = /换个思路|换一种|换一个写法|重新来|不要这个/

function harshOf(field: PlanField, c: Record<string, string>) {
  return {
    logline: '——而亲手把主角推下去的，正是最信任的那个人',
    hero: `开局再失去最后一样在乎的东西，被逼到退无可退`,
    conflict: `${c.villain}不止要主角输，还要主角当众身败名裂；每一步都比主角快半步`,
    formula: '加密：每 2 集一次当众打脸，每 8 集一次身份揭晓',
    ending: `${c.villain}最后输在自己最得意的那一招上，当众失去一切`,
    keep: '保留得更彻底：付费卡点集数与对标剧一一对应',
    change: '拉开得更彻底：人物、道具、反转方式全部换掉',
  }[field]
}

function softOf(field: PlanField, c: Record<string, string>) {
  return {
    logline: '，但主角不再是只会哭的受害者',
    hero: '开局虽然失去一切，第一集结尾就埋下反击的第一步',
    conflict: `${c.villain}的动机说得通：当年也是被逼到绝路的人`,
    formula: '虐点集中在前 5 集，之后以爽为主，每 3 集一次反击',
    ending: `大团圆：${c.lover}幡然醒悟，两人并肩收拾残局`,
    keep: '只保留结构，情绪和人物都重新写',
    change: '改动收一收：先换人物和道具，结构不动',
  }[field]
}

/** 「换个思路」：同一项换一种写法，按种子轮换 */
function againOf(p: Project, field: PlanField, before: string, seed: number) {
  const kit = kitOf(p)
  const c = coreCtx(p, kit)
  const other = pick(rng(seed), otherKits(kit))
  const pool: Record<PlanField, string[]> = {
    logline: [...kit.loglines, ...other.loglines.slice(0, 1)],
    hero: [
      `${c.hero}：表面是${fill(kit.roles.hero.profile, c)}，其实${fill(kit.secret, c)}。`,
      `${c.hero}：${fill(kit.roles.hero.flaw, c)}的人，却被逼着去${fill(kit.roles.hero.desire, c)}。`,
    ],
    conflict: [
      `明面上的对手是${c.villain}，真正在背后下棋的是${c.mentor}。`,
      `${c.villain}：${fill(kit.roles.villain.profile, c)}。想要${fill(kit.roles.villain.desire, c)}。`,
    ],
    formula: [kit.formula, ...otherKits(kit).map((k) => k.formula)],
    ending: [`${fill(kit.ending, c)}。`, `${c.hero}赢回一切，却选择转身离开。`, `${c.villain}伏法，${c.lover}用余生赎罪。`],
    keep: ['保留开局的结构与情绪曲线，其余全部重写', '保留五段式主线与付费卡点位置'],
    change: [`人物全部重塑；关键道具换成「${kit.prop}」`, `故事搬到「${other.world.split('：')[0]}」`, '悬念改为“观众先知道、主角不知道”'],
  }
  const list = pool[field].filter((t) => t.trim() !== before.trim())
  return list[seed % list.length] ?? before
}

/** 引导里给的现成回答：点了就按这一条具体改（自己打字的走下面的通用规则） */
function canned(p: Project, ask: string, before: string, seed: number): string | null {
  const kit = kitOf(p)
  const c = coreCtx(p, kit)
  const other = pick(rng(seed), otherKits(kit))
  const pays = p.work.breakdown?.rhythm.paywalls.join('、')
  const b = trimEnd(before)
  const twists = [fill(kit.secret, c), `${c.lover}其实一直在暗中护着${c.hero}`, `${c.villain}和${c.hero}流着同一个家族的血`].filter((t) => !before.includes(t))
  const table: Record<string, () => string> = {
    反常规点换一个: () => `${b.split('——')[0]}——${twists[seed % twists.length] ?? fill(kit.secret, c)}。`,
    给主角加一个藏着的身份: () => `${b}；藏着的身份：${fill(kit.secret, c)}。`,
    再加一个藏在暗处的反派: () => `${b}；暗处还有一个${c.mentor}，表面帮${c.hero}，其实在借刀杀人。`,
    '前 10 集多打脸，后面多虐': () => '前 10 集每集一次打脸，先把主角立住；中段转虐，误会和代价层层叠加；付费卡点卡在虐到最深处',
    加一条感情线的甜点: () => `${b}；每 5 集一次感情线的甜点，和打脸错开`,
    结局要大团圆: () => `${c.hero}和${c.lover}并肩收拾残局，${c.villain}伏法，所有误会解开，大团圆。`,
    结局留一个续集的口子: () => `${b}；最后一场${c.mentor}的身份露出一角，留下续集的口子。`,
    结局来一个大反转: () => `大结局反转：${c.villain}只是棋子，真正布局的是${c.mentor}；${c.hero}在最后一刻翻盘。`,
    付费卡点位置照搬对标剧: () => `${b}；付费卡点集数照搬对标剧${pays ? `（第 ${pays} 集）` : ''}`,
    '情绪曲线照搬，人物全换': () => '保留对标剧的情绪曲线：被看轻 → 反击 → 身份揭晓；人物全部换掉',
    只保留开局的结构: () => '只保留开局的结构：第一集当众受辱、结尾留下翻盘的引子；其余全部重写',
    沿用五段式主线: () => '沿用五段式冲突主线，各段剧情重写',
    关键道具换掉: () => `${b}；关键道具换成「${other.prop}」`,
    换一个题材背景: () => `故事搬到「${other.world.split('：')[0]}」，人物关系照旧`,
    悬念改成观众先知道: () => `${b}；悬念改为“观众先知道、主角不知道”，用误会和虐点撑中段`,
  }
  return table[ask.trim()]?.() ?? null
}

function rewriteField(p: Project, field: PlanField, before: string, ask: string, seed: number) {
  const c = coreCtx(p, kitOf(p))
  const preset = canned(p, ask, before, seed)
  if (preset) return preset
  if (AGAIN.test(ask)) return againOf(p, field, before, seed)
  if (SHORT.test(ask)) return `${before.split(/[。；—]/)[0].trim()}。`
  if (HARSH.test(ask)) return field === 'logline' ? `${trimEnd(before)}${harshOf(field, c)}。` : `${trimEnd(before)}；${harshOf(field, c)}。`
  if (SOFT.test(ask)) return field === 'logline' ? `${trimEnd(before)}${softOf(field, c)}。` : `${trimEnd(before)}；${softOf(field, c)}。`
  // 自己打的字（接真实模型后由模型改写成完整的一段）：「改成 / 写成……」整项换掉，「加一句 / 补上……」接在后面，其余当补充接进去
  const said = trimEnd(ask.replace(/「[^」]+」/g, '').replace(/^[，,：:\s]+/, ''))
  // 前面只能是空的或点名这一项（「核心设定改成……」），「关键道具换成……」这种只改一部分的照常接进去
  const lead = (m: RegExpMatchArray | null) => !!m && (!m[1] || PLAN_META[field].keys.test(m[1]))
  const replace = said.match(/^(.{0,8}?)(?:改成|换成|写成)[：:，,\s]*(.+)$/)
  if (lead(replace)) return `${trimEnd(replace![2])}。`
  const add = said.match(/^(.{0,8}?)(?:加一句|补一句|加上|补上|再加)[：:，,\s]*(.+)$/)
  const extra = lead(add) ? trimEnd(add![2]) : said
  return extra ? `${trimEnd(before)}；${extra}。` : before
}

/**
 * 这句话要改哪几项：按分句看，每句归给最先点名的那一项（「结局改成男女主分开」归结局，不归主角）；
 * 没点名的分句跟着前一句，整句都没点名就归正在聊的这一项。最多两项。
 */
function targetsOf(text: string, topic: PlanField | null): [PlanField, string][] {
  const out = new Map<PlanField, string>()
  let last: PlanField | null = null
  for (const clause of text.split(/[；;。\n]/).map((c) => c.trim()).filter(Boolean)) {
    const hit: PlanField | undefined = PLAN_ORDER.map((k) => ({ k, at: clause.search(PLAN_META[k].keys) }))
      .filter((h) => h.at >= 0)
      .sort((a, b) => a.at - b.at)[0]?.k
    const field: PlanField = hit ?? last ?? topic ?? 'logline'
    out.set(field, out.has(field) ? `${out.get(field)}；${clause}` : clause)
    last = field
  }
  if (!out.size) out.set(topic ?? 'logline', text)
  return [...out].slice(0, 2)
}

/** 一轮对话：只改提到的那几项（没点名就改正在聊的这一项），锁定的不动 */
export function reply(p: Project, plan: RewritePlan, locks: PlanField[], topic: PlanField | null, ask: string, seed: number): ChatReply {
  const text = ask.trim()
  const asks = targetsOf(text, topic)
  const targets = asks.map(([f]) => f)
  const blocked = targets.filter((f) => locks.includes(f))
  const changes: ChatChange[] = asks
    .filter(([f]) => !locks.includes(f))
    .map(([f, said], i) => ({ field: f, before: plan.fields[f], after: rewriteField(p, f, plan.fields[f], said, seed + i) }))
    .filter((c) => c.after !== c.before)
  const next: RewritePlan | undefined = changes.length ? { ...plan, fields: { ...plan.fields, ...Object.fromEntries(changes.map((c) => [c.field, c.after])) } } : undefined

  const notes = blocked.map((f) => `「${fieldTitle(f)}」已锁定，这一轮没动它`)
  if (changes.some((c) => c.field === 'logline')) {
    const others = locks.filter((f) => f !== 'logline')
    if (others.length) notes.push(`核心设定变了，已锁定的${others.map((f) => `「${fieldTitle(f)}」`).join('')}可能要跟着调`)
  }
  const benchNames = p.work.breakdown?.characters.map((ch) => ch.name).filter((n) => changes.some((c) => c.after.includes(n))) ?? []
  if (benchNames.length) notes.push(`出现了对标剧人物名（${benchNames.join('、')}），仿写要换掉`)

  const focus = changes[0]?.field ?? blocked[0] ?? topic ?? 'logline'
  if (changes.length) {
    const detour = topic && !targets.includes(topic) ? `（先改你提到的这项，回头接着聊「${fieldTitle(topic)}」）` : ''
    return {
      text: `按你说的改了${changes.map((c) => `「${fieldTitle(c.field)}」`).join('')}${detour}，其他项没动。这样行吗？`,
      plan: next,
      changes,
      notes,
      topic: focus,
      options: [
        { label: `行，锁定「${fieldTitle(focus)}」`, action: { kind: 'lock', field: focus } },
        { label: '再狠一点', action: { kind: 'say', text: `「${fieldTitle(focus)}」再狠一点` } },
        { label: '换个思路', action: { kind: 'say', text: `「${fieldTitle(focus)}」换个思路` } },
        { label: '回到上一版', action: { kind: 'undo' } },
      ],
    }
  }
  if (blocked.length)
    return {
      text: `${blocked.map((f) => `「${fieldTitle(f)}」`).join('')}锁定了，我没动。要改的话先解锁。`,
      notes: [],
      topic: topic ?? focus,
      options: [
        ...blocked.map((f): ChatOption => ({ label: `解锁「${fieldTitle(f)}」，按刚才说的改`, action: { kind: 'unlock', field: f, text } })),
        ...(topic && !locks.includes(topic) ? [{ label: `不改了，接着聊「${fieldTitle(topic)}」`, action: { kind: 'ask' as const, field: topic } }] : []),
      ],
    }
  const q = question(p, plan, focus)
  return { text: `这句话我没找到要改的地方，能说具体一点吗？比如改哪一项、往哪个方向改。\n\n${q.text}`, topic: focus, options: q.options }
}

/** 复制出去的文字 */
export function planText(plan: RewritePlan) {
  return [`【方向】${plan.title}`, ...PLAN_ORDER.map((f) => `【${fieldTitle(f)}】${plan.fields[f]}`)].join('\n')
}

