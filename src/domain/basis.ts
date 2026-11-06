/**
 * 生成依据（三段式）：每一步 AI 生成都带上核心设定、七项设定和基本信息，区别只在每一项落在哪一档。
 * 表的内容来自《问题讨论文档：故事架构与 AI 生成依据》第三部分；接真模型时提示词按同一张表组织，也是和开发的接口约定。
 *
 * - 必须遵守：给全文；照着写，不能改、不能违反；审稿查出来算严重，拦定稿
 * - 重点参考：给全文；结果里要看得出来；查出来算建议
 * - 不违背即可：给一两句摘要；不要求写进去，但不能写反；查出来算建议
 * - 题材常识不算一档，只补依据里没有的内容，补的部分要标出来
 */
import type { ArchItem, BasisPrint, Project } from './types'
import { emptyArchitecture } from './work'

export type Tier = 'must' | 'focus' | 'light'

export const TIERS: { key: Tier; label: string; desc: string }[] = [
  { key: 'must', label: '必须遵守', desc: '给全文；照着写，不能改、不能违反；查出来算严重' },
  { key: 'focus', label: '重点参考', desc: '给全文；结果里要看得出来；查出来算建议' },
  { key: 'light', label: '不违背即可', desc: '给一两句摘要；不要求写进去，但不能写反' },
]

/** 依据：故事架构各项、基本信息、对标剧拆解与下游产物 */
export type BasisKey =
  | ArchItem
  | 'basics'
  | 'spec'
  | 'structure'
  | 'viewpoint'
  | 'language'
  | 'markets'
  | 'breakdown'
  | 'characters'
  | 'overview'
  | 'phases'
  | 'outline'

export const BASIS_LABEL: Record<BasisKey, string> = {
  logline: '核心设定',
  plan: '整体框架',
  innovations: '创新点',
  goldenFinger: '金手指 / 核心卖点',
  heroSetup: '主角人设',
  world: '世界观设定',
  background: '故事背景',
  highlights: '核心亮点',
  factions: '主要势力',
  formula: '爽点公式',
  mainLine: '冲突主线',
  rhythm: '节奏框架',
  writingRules: '全局写作要求',
  references: '参考作品',
  basics: '基本信息（题材类型、风格元素、目标受众）',
  spec: '总集数、单集时长',
  structure: '故事结构',
  viewpoint: '叙事视角',
  language: '剧本语言',
  markets: '目标市场',
  breakdown: '对标剧拆解',
  characters: '人物设定',
  overview: '全剧总览',
  phases: '阶段总览',
  outline: '集纲',
}

export interface BasisRow {
  must: string[]
  focus: string[]
  light: string[]
  /** 依据里没有、用题材常识补的 */
  fill?: string
  /** 生成时读了哪几项：上游改了就提示「依据已改」 */
  deps: BasisKey[]
}

/* ---------------------------------- 故事架构 ---------------------------------- */

/**
 * 故事架构的顺序（11/3 编剧评审）：不分层，从上往下一项项写；每一项只读编剧写的内容和排在它前面的项。
 * 起点之后是设定（世界观 → 金手指 → 故事背景 → 核心亮点 → 主角人设），设定写完再定结构（仿写先列创新点，再定冲突主线）。
 * 节奏框架放在冲突主线表格下面（不单独排号）：付费卡点集、大反转集、结局高潮起始集常显（11/5），曲线默认收起——目标情绪打分还没有合适的依据，节奏以冲突主线的分段为准，生成冲突主线时顺带生成。
 * 全局写作要求放在冲突主线（含节奏框架）后面（钩子、付费卡点按节奏框架写），排最后。
 * 故事结构、叙事视角、爽点公式、沉寂提醒阈值、参考作品 11/4 从页面上删掉，生成不再读（字段留着，旧数据不动）。
 * 整体框架（原创）11/4 第五轮标注删掉：故事背景已经写成从开局讲到结局的故事简介，开局、结局改按故事背景；`Architecture.plan` 留着，旧数据不动。
 * 主要势力 11/4 第五轮标注（#63）删掉，生成不再读；创新点（#62）原创删掉，剧本仿写、视频仿写留着（设定写完后和对标剧比）。
 * `Architecture.factions` 和原创项目的 `innovations` 留着，旧数据不动。
 * 仿写没有改写方案；改写想法 11/5 标注（#87）也删掉：编剧的想法直接写进核心设定，核心设定排第一，下面就是「AI 框架方向」。
 * 核心亮点 11/4 标注（#71）加在故事背景后面：期待值（观众为什么追下去）和情绪（主打什么情绪、怎么起伏），原创、仿写都有，后面的项依次往后排。
 */
export const ARCH_ORDER: { original: ArchItem[]; adaptation: ArchItem[] } = {
  original: ['logline', 'world', 'goldenFinger', 'background', 'highlights', 'heroSetup', 'mainLine', 'writingRules'],
  adaptation: ['logline', 'world', 'goldenFinger', 'background', 'highlights', 'heroSetup', 'innovations', 'mainLine', 'writingRules'],
}

export const archOrder = (p: Pick<Project, 'mode'>) => (p.mode === 'original' ? ARCH_ORDER.original : ARCH_ORDER.adaptation)

/** 各项里只有核心设定必填（11/4 标注），其余都可以空着 */
export const ARCH_REQUIRED: ArchItem[] = ['logline']

const BENCH_MUST = '不沿用对标剧人名，不照搬对标剧台词'

/** 原创 · 故事架构（第三部分 3.2） */
const ARCH_ORIGINAL: Partial<Record<ArchItem, BasisRow>> = {
  logline: {
    must: ['编剧写的草稿；没写就用立项灵感'],
    focus: ['题材类型、目标受众、风格元素'],
    light: ['总集数'],
    fill: '草稿太短时补核心困境、反常规点',
    deps: ['basics', 'spec'],
  },
  world: {
    must: ['核心设定里的时代、地点、身份'],
    focus: ['题材类型'],
    light: ['风格元素'],
    fill: '阵营设定、主要地点的私设说明',
    deps: ['logline', 'basics'],
  },
  goldenFinger: {
    must: ['核心设定里的反常规点'],
    focus: ['世界观设定（金手指要在世界观的规则里成立）', '题材类型'],
    light: ['风格元素、目标受众'],
    fill: '每项能力的来历、能做到什么、表现方式（首集展示、渐进释放、权威认证）',
    deps: ['logline', 'world', 'basics'],
  },
  background: {
    must: ['核心设定里的困境'],
    focus: ['金手指 / 核心卖点（揭开的身份）', '世界观设定（阵营）'],
    light: [],
    fill: '反派为了什么、用什么手段逼主角，转机和结局（写成一段故事简介）',
    deps: ['logline', 'world', 'goldenFinger'],
  },
  highlights: {
    must: ['核心设定里的反常规点（核心爽点：你以为……其实……）'],
    focus: ['故事背景（观众等着看的那几场：真相揭开、身份翻转、反派报应）', '金手指 / 核心卖点（爽点靠什么兑现）', '题材类型、风格元素（主打什么情绪）'],
    light: ['目标受众'],
    fill: '情绪怎么起伏（先压后扬、几次大爽点）',
    deps: ['logline', 'background', 'goldenFinger', 'basics'],
  },
  heroSetup: {
    must: ['核心设定里主角的身份和困境'],
    focus: ['故事背景（主角从这里推出来：经历了什么、要做什么、最后变成什么）', '金手指 / 核心卖点', '世界观设定（身份要成立）', '目标受众'],
    light: ['风格元素'],
    fill: '性格、缺陷、弧光细节',
    deps: ['logline', 'background', 'goldenFinger', 'world', 'basics'],
  },
  mainLine: {
    must: ['核心设定', '总集数（各段集数加起来等于总集数）'],
    focus: ['故事背景（开局、结局照它；秘密放在中段揭开）', '主角人设（目标、弧光）', '金手指 / 核心卖点（升级节点）'],
    light: ['世界观设定', '核心亮点（观众等着看的那几场要落在主线里）'],
    fill: '每一段的具体事件',
    deps: ['logline', 'spec', 'background', 'heroSetup', 'goldenFinger', 'world', 'highlights'],
  },
  rhythm: {
    must: ['冲突主线（各段集数）', '总集数'],
    focus: [],
    light: ['核心设定'],
    fill: '付费卡点放在第几集（按平台常见节奏）',
    deps: ['mainLine', 'spec'],
  },
  writingRules: {
    must: ['单集时长（篇幅）'],
    focus: ['风格元素', '核心亮点（情绪：每集要给到的情绪）', '节奏框架（钩子、付费卡点）', '世界观设定（硬规则写成禁止项）', '主角人设（主角怎么说话）', '目标市场'],
    light: ['核心设定、剧本语言'],
    fill: '平台通用规范',
    deps: ['spec', 'basics', 'highlights', 'rhythm', 'world', 'heroSetup', 'markets', 'logline', 'language'],
  },
}

/** 仿写 · 故事架构：设定每一项 = 对标剧的同一项 + 核心设定（编剧的想法写在核心设定里）；创新点在设定写完之后，对比我们改了什么 */
const ARCH_ADAPTATION: Partial<Record<ArchItem, BasisRow>> = {
  logline: {
    must: ['编剧写的草稿；没写就用立项灵感'],
    focus: ['对标剧拆解的总纲层：故事梗概、冲突主线的节奏和每段梗概、人物设定（不带每集集纲）'],
    light: ['基本信息'],
    fill: '都没写时，同题材里换零部件（人物、道具、背景）',
    deps: ['breakdown', 'basics'],
  },
  world: {
    must: ['核心设定'],
    focus: ['故事梗概 · 世界观'],
    light: ['风格元素'],
    deps: ['logline', 'breakdown', 'basics'],
  },
  goldenFinger: {
    must: ['核心设定'],
    focus: ['世界观设定（金手指要在世界观的规则里成立）', '故事梗概 · 金手指（能力和力度）、核心亮点'],
    light: ['题材类型、目标受众'],
    deps: ['logline', 'world', 'breakdown', 'basics'],
  },
  background: {
    must: ['核心设定'],
    focus: ['故事梗概 · 故事简介（写法和力度）', '对标剧人物设定 · 主角简介', '世界观设定', '金手指 / 核心卖点（揭开的身份）'],
    light: [],
    deps: ['logline', 'breakdown', 'world', 'goldenFinger'],
  },
  highlights: {
    must: ['核心设定'],
    focus: ['故事梗概 · 核心亮点（期待值：核心爽点、主线任务、情感双线；学写法和力度）', '对标剧首集、一卡的情绪走向（五个维度）和中间几集逐句细拆出的情绪转折', '故事背景', '金手指 / 核心卖点'],
    light: ['风格元素、目标受众'],
    deps: ['logline', 'breakdown', 'background', 'goldenFinger', 'basics'],
  },
  heroSetup: {
    must: ['核心设定'],
    focus: ['故事背景（主角从这里推出来）', '对标剧人物设定里主角的简介、身份、动机', '金手指 / 核心卖点'],
    light: ['目标受众、风格元素'],
    deps: ['logline', 'background', 'breakdown', 'goldenFinger', 'basics'],
  },
  innovations: {
    must: [],
    focus: ['写好的设定（核心设定、世界观、金手指 / 核心卖点、故事背景、核心亮点、主角人设）和对标剧拆解的同一项对比（「对标剧怎么做」一栏从拆解取）'],
    light: ['基本信息'],
    deps: ['world', 'goldenFinger', 'background', 'highlights', 'heroSetup', 'breakdown', 'logline', 'basics'],
  },
  mainLine: {
    must: ['核心设定', '总集数'],
    focus: ['对标剧冲突主线的各段（段落结构尽量保持，各段集数可以压缩或拉长）', '创新点', '主角人设、故事背景'],
    light: ['世界观设定', '核心亮点（观众等着看的那几场要落在主线里）'],
    deps: ['logline', 'spec', 'breakdown', 'innovations', 'heroSetup', 'background', 'world', 'highlights'],
  },
  rhythm: {
    must: ['冲突主线（各段集数）', '总集数'],
    focus: ['对标剧的节奏框架，按分段对位换算'],
    light: ['核心设定'],
    deps: ['mainLine', 'spec', 'breakdown'],
  },
  writingRules: {
    must: ['单集时长'],
    focus: ['故事梗概 · 风格元素', '核心亮点（情绪：每集要给到的情绪）', '对标剧每集开场钩子、结尾钩子的常见写法', '节奏框架（钩子、付费卡点）', '世界观设定（硬规则写成禁止项）', '主角人设（主角怎么说话）'],
    light: ['剧本语言'],
    deps: ['spec', 'breakdown', 'highlights', 'rhythm', 'world', 'heroSetup', 'language'],
  },
}

/** 故事架构某一项的依据 */
export function archBasis(p: Pick<Project, 'mode'>, item: ArchItem): BasisRow | null {
  if (p.mode === 'original') return ARCH_ORIGINAL[item] ?? null
  const row = ARCH_ADAPTATION[item]
  // 仿写每一步的必须遵守里都默认加一条
  return row ? { ...row, must: [...row.must, BENCH_MUST] } : null
}

/* ---------------------------------- 下游各环节 ---------------------------------- */

export type DownStep = 'characters' | 'overview' | 'phase' | 'episode' | 'blueprint' | 'write' | 'review' | 'polish' | 'qa'

/** 原创 · 下游各环节（第三部分 3.4）；仿写在此基础上增加 3.5 的条目 */
const DOWN: Record<DownStep, BasisRow> = {
  characters: {
    must: ['主角人设', '金手指 / 核心卖点（主角的能力）'],
    focus: ['故事背景（人物前史）', '世界观设定（身份、职业要成立）', '目标受众'],
    light: ['核心设定', '节奏框架', '全局写作要求'],
    deps: ['heroSetup', 'goldenFinger', 'background', 'world', 'basics', 'logline'],
  },
  overview: {
    must: ['核心设定', '冲突主线', '节奏框架'],
    focus: ['故事背景（写成了故事简介，总览开头的【故事简介】直接用；结局照它）', '核心亮点（总览的【核心亮点】照它写：期待值、情绪）', '人物设定（主角弧光）', '金手指 / 核心卖点（爽点怎么兑现）'],
    light: ['世界观设定'],
    deps: ['logline', 'mainLine', 'rhythm', 'characters', 'goldenFinger', 'background', 'highlights', 'world'],
  },
  phase: {
    must: ['冲突主线的这一段', '节奏框架里落在这一段的付费卡点、大反转、高潮', '全剧总览'],
    focus: ['故事背景（秘密在哪一段揭开）', '金手指 / 核心卖点（升级节点）', '人物设定'],
    light: ['核心设定', '世界观设定'],
    deps: ['mainLine', 'rhythm', 'overview', 'background', 'goldenFinger', 'characters', 'logline', 'world'],
  },
  episode: {
    must: ['本集所在的阶段总览', '节奏框架（本集是不是付费卡点、大反转）'],
    focus: ['金手指 / 核心卖点（怎么用）', '人物设定', '上一集集纲（承接）'],
    light: ['核心设定', '世界观设定', '故事背景'],
    deps: ['phases', 'rhythm', 'goldenFinger', 'characters', 'logline', 'world', 'background'],
  },
  blueprint: {
    must: ['本集集纲', '节奏框架（本集定位）'],
    focus: ['人物设定', '剧本状态库', '上一集定稿（承接）'],
    light: ['核心设定', '金手指 / 核心卖点', '世界观设定'],
    deps: ['outline', 'rhythm', 'characters', 'logline', 'goldenFinger', 'world'],
  },
  write: {
    must: ['全局写作要求', '人物设定', '本集集纲', '逐集蓝图', '剧本状态库（已定稿的事实）'],
    focus: ['核心设定（不偏离）', '金手指 / 核心卖点（用法和边界前后一致）'],
    light: ['世界观设定', '故事背景', '主角人设（已经通过人物设定带进来）', '后 3–5 集的逐集蓝图（只作边界，不提前写）'],
    deps: ['writingRules', 'characters', 'outline', 'logline', 'goldenFinger', 'world', 'background'],
  },
  review: {
    must: ['和逐集写作同一份：全局写作要求、人物设定、本集集纲、逐集蓝图、剧本状态库'],
    focus: ['核心设定（不偏离）', '金手指 / 核心卖点'],
    light: ['世界观设定', '故事背景'],
    deps: ['writingRules', 'characters', 'outline', 'logline', 'goldenFinger'],
  },
  polish: {
    must: ['原文的事实和意思不变', '正文润色还要守全局写作要求'],
    focus: ['风格元素'],
    light: ['其余全部'],
    deps: ['basics', 'writingRules'],
  },
  qa: {
    must: ['剧本状态库（一致性终检）', '人物设定（角色一致性）', '全局写作要求和通用剧本格式（格式合规）'],
    focus: ['节奏框架（节奏曲线对比、付费点专项）', '集纲（故事流程）'],
    light: ['核心设定', '世界观设定'],
    deps: ['characters', 'writingRules', 'rhythm', 'outline', 'logline', 'world'],
  },
}

/** 仿写 · 下游各环节在原创基础上增加的（第三部分 3.5） */
const DOWN_ADAPTATION: Partial<Record<DownStep, Partial<Pick<BasisRow, 'must' | 'focus' | 'light' | 'deps'>>>> = {
  characters: { must: ['不沿用对标剧人名'], focus: ['对标剧人物设定：主角的简介、身份、金手指、动机，配角的作用和定位，全剧人物关系网；每个人物记下对应的对标剧角色'] },
  overview: { focus: ['故事梗概 · 故事简介、核心亮点（期待值）', '对标剧冲突主线的节奏和每段梗概', '创新点'], deps: ['innovations'] },
  phase: { focus: ['对标剧冲突主线的对应段（这一段的梗概）', '对标剧这一段每集的集纲，压成一段摘要', '该落在这一段的创新点'], deps: ['innovations'] },
  episode: {
    must: ['本集事件不照搬对位集'],
    focus: ['对位那一两集的拆解：冲突强度、情绪强度、是否付费点、付费卡点位置、开场钩子、结尾钩子、伏笔埋设、伏笔回收（学力度和形式，不学事件）'],
  },
  blueprint: { must: ['不出现对标剧人名', '不照搬对标剧台词'], light: ['不读对标剧：结构已经在集纲那一层继承下来'] },
  write: { must: ['不出现对标剧人名', '不照搬对标剧台词'], light: ['不读对标剧：结构已经在集纲那一层继承下来'] },
  review: { must: ['另查对标剧人名残留、照搬对标剧台词'], focus: ['另查本集事件照抄对位集、结构偏离对标剧'] },
  qa: { focus: ['节奏曲线对比改为对比对标剧', '创新点（创新点落地：查「我们怎么做」有没有真的改）'], deps: ['innovations'] },
}

export function downBasis(p: Pick<Project, 'mode'>, step: DownStep): BasisRow {
  const row = DOWN[step]
  if (p.mode === 'original') return row
  const add = DOWN_ADAPTATION[step] ?? {}
  return {
    ...row,
    must: [...row.must, ...(add.must ?? [])],
    focus: [...row.focus, ...(add.focus ?? [])],
    light: [...row.light, ...(add.light ?? [])],
    deps: [...row.deps, ...(add.deps ?? []), 'breakdown'],
  }
}

/** 按钮提示里的一行：必须遵守：…；重点参考：…；不违背即可：… */
export function basisLine(row: BasisRow) {
  return [
    ...TIERS.filter((t) => row[t.key].length).map((t) => `${t.label}：${row[t.key].join('、')}`),
    ...(row.fill ? [`依据里没有的用题材常识补：${row.fill}`] : []),
  ].join('；')
}

/* ---------------------------------- 依据指纹 ---------------------------------- */

/** 简单指纹：内容一样指纹就一样 */
function digest(text: string) {
  let x = 2166136261
  for (let i = 0; i < text.length; i++) x = Math.imul(x ^ text.charCodeAt(i), 16777619)
  return (x >>> 0).toString(36)
}

/** 某项依据现在的内容 */
export function basisValue(p: Project, key: BasisKey): string {
  // 还没存过故事架构时按默认值算，免得第一次保存后误报「依据已改」；故事结构、叙事视角页面上已删，旧指纹里还有，照样能算
  const a = p.work.architecture ?? emptyArchitecture(p.spec.totalEpisodes)
  switch (key) {
    case 'logline':
      return p.logline.trim()
    case 'innovations':
      return (a?.innovations ?? []).map((x) => `${x.theirs}→${x.ours}`).join('\n')
    case 'mainLine':
      return (a?.mainLine ?? []).map((b) => `${b.beat}|${b.range}|${b.content}|${b.bench ?? ''}`).join('\n')
    case 'rhythm':
      return JSON.stringify(p.rhythm)
    case 'basics':
      // 类型 11/4 删掉了，仍算进指纹（旧项目的值不再变），免得旧项目升级后全标「依据已改」
      return [p.category, p.genres.join(','), p.tones.join(','), p.audience].join('|')
    case 'spec':
      return `${p.spec.totalEpisodes}|${p.spec.episodeSeconds}`
    case 'structure':
      return a?.structure ?? ''
    case 'viewpoint':
      return a?.viewpoint ?? ''
    case 'language':
      return p.spec.language
    case 'markets':
      return p.markets.join(',')
    case 'breakdown':
      return p.work.breakdown?.generatedAt ?? ''
    case 'characters':
      return p.work.characters.map((c) => [c.name, c.role, c.profile, c.personality, c.ability, c.arc].join('|')).join('\n')
    case 'overview':
      return p.work.plot?.overview ?? ''
    case 'phases':
      return (p.work.plot?.phases ?? []).join('\n')
    case 'outline':
      return p.work.outline.map((o) => `${o.ep}|${o.event}|${o.hook}`).join('\n')
    default:
      return ((a?.[key] as string | undefined) ?? '').trim()
  }
}

/** 生成时记下当时的依据指纹 */
export const printOf = (p: Project, deps: BasisKey[]): BasisPrint => Object.fromEntries(deps.map((d) => [d, digest(basisValue(p, d))]))

/** 生成之后改过的依据；没记过指纹（编剧自己写的、旧数据）不提醒 */
export function changedBasis(p: Project, key: string): BasisKey[] {
  const print = p.work.prints?.[key]
  if (!print) return []
  return (Object.keys(print) as BasisKey[]).filter((d) => print[d] !== digest(basisValue(p, d)))
}

/** 指纹在 work.prints 里的键：故事架构各项、人物设定、全剧总览、各阶段总览 */
export const PRINT_KEY = {
  arch: (item: ArchItem) => `arch.${item}`,
  characters: 'characters',
  overview: 'plot.overview',
  phase: (i: number) => `plot.phase.${i}`,
} as const
