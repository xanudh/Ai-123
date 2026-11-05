import type { BreakdownBlock, Project, ProjectMode, QaCheckKey, StageKey } from './types'

/**
 * 「伏笔与叙事线索」这一步：11/4 产品要求先拿掉。关掉时流程里没有这一步（旧地址回到概览），
 * 状态库、写作、审稿、质检也不再显示、不再读伏笔计划；代码和已有数据都留着，改回 true 就恢复。
 */
export const SHOW_FORESHADOW = false

/**
 * 创新点（对标剧怎么做 → 我们怎么做）只有仿写有：剧本仿写、视频仿写要，原创不要（11/4 第五轮标注）。
 * 质检的「创新点落地」也只查仿写：原创六项，仿写七项
 */
export const hasInnovations = (p: Pick<Project, 'mode'>) => p.mode !== 'original'

export interface StageMeta {
  key: StageKey
  label: string
  /** 对应需求文档中的板块 / 步骤 */
  source: string
  summary: string
  deliverables: string[]
  /** 计划上线阶段；null 表示当前已可用 */
  phase: string | null
  /** 需求评审会上补充的要点 */
  notes?: string[]
}

export const STAGES: Record<StageKey, StageMeta> = {
  overview: {
    key: 'overview',
    label: '项目概览',
    source: '立项',
    summary: '项目基础设定与规格，后续所有环节都以此为输入。',
    deliverables: ['项目设定'],
    phase: null,
  },
  video: {
    key: 'video',
    label: '视频转剧本',
    source: '第二板块 · 短剧转剧本',
    summary:
      '粘贴对标剧链接一键下载全集（含付费集）；逐集压缩后喂给能直接读视频的多模态模型，按固定格式转写成带时间码的分镜剧本，再自动合并成整部剧本。',
    deliverables: ['全集对白文本', '带时间码的分镜剧本', '合并后的完整剧本'],
    phase: null,
    notes: [
      '逐集转写效果最好，但人工逐集上传、复制、拼接，50 集要多花 3–4 小时——工具需要自动排队、逐集转写、批量合并',
      '合并时自动修正格式问题，转写完直接进入对标剧拆解',
    ],
  },
  breakdown: {
    key: 'breakdown',
    label: '对标剧拆解',
    source: '第三板块 · 对标剧拆解',
    summary:
      '上传剧本后按三大板块拆解：故事梗概、冲突主线 · 内容简介（节奏框架、每段梗概、每集一段走向，第 1 集到一卡和之后的付费卡点集细拆到场景和核心台词）、人物设定；再归纳题材元素、钩子分布与付费点规律，形成可迁移的结构骨架。',
    deliverables: ['故事梗概', '节奏曲线', '人物设定', '内容简介', '可迁移骨架'],
    phase: null,
    notes: [
      '三个板块看过、改好后「一键引用」进入改写',
      '经市场验证的主线结构（开局困境 → 第一次小反转 → 中点大反转…）仿写时尽量保持',
    ],
  },
  architecture: {
    key: 'architecture',
    label: '故事架构',
    source: '第三步 · 设计故事架构',
    summary: '从核心设定往下一项项推出整部剧：核心设定（仿写前面是改写想法）→ 世界观 → 金手指 → 故事背景 → 核心亮点 → 主角人设 →（仿写另有创新点）→ 冲突主线 · 节奏框架 → 全局写作要求；每一项只读排在它前面的项，只有核心设定必填。',
    deliverables: ['基本信息', '核心设定', '世界观与人物设定', '创新点（仿写）与冲突主线', '节奏框架', '全局写作要求'],
    phase: null,
    notes: [
      '仿写：先写改写想法；没有想法时 AI 基于拆解结果提出 3 个新方向，选中的方向写进改写想法、核心设定和世界观、金手指、故事背景',
      '原创：核心设定直接从这一步开始；也可以让 AI 给出 3 个方向，选中的方向写进核心设定和世界观、金手指、故事背景',
      '先定冲突主线（段落、集数、剧情），再按主线生成节奏框架',
    ],
  },
  characters: {
    key: 'characters',
    label: '人物设定',
    source: '第三步 · 定人物配置',
    summary: '每个角色的性别、年龄、外形、服装、性格、背景、能力，动机（表面追求 / 终极渴望 / 潜意识恐惧）、缺陷与弧光，以及人物关系（爱人、同学、宿敌 …）与关系图。',
    deliverables: ['人物配置表', '人物关系图'],
    phase: null,
  },
  foreshadow: {
    key: 'foreshadow',
    label: '伏笔与叙事线索',
    source: '第四步 · 伏笔登记表',
    summary: '大纲定下来之后再埋伏笔：对照集纲设置埋设与预计回收集，AI 建议的伏笔先勾选再录入；活跃计划自动注入后续写作，逾期或沉寂时提醒。只有人工确认的定稿内容才记为已发生事件。',
    deliverables: ['伏笔与线索计划', '剧情树'],
    phase: null,
  },
  outline: {
    key: 'outline',
    label: '情节大纲',
    source: '第四步 · 分集大纲',
    summary: '先总览整部剧的剧情，再按冲突主线总结每个阶段的粗纲，下面是每集的集纲（每 10 集一批）；钩子轮换自动检查，付费卡点集单独审核。',
    deliverables: ['全剧总览', '阶段粗纲', '分集集纲'],
    phase: null,
  },
  state: {
    key: 'state',
    label: '剧本状态库',
    source: '第五步 · 剧本状态库',
    summary: '人物设定、关系、场景、道具与全部伏笔的结构化“户口本”，每定稿一集自动更新，防止人设漂移。',
    deliverables: ['剧本状态库'],
    phase: null,
    notes: ['AI 写长剧最常见的问题是伏笔写着写着没了、人物状态乱跑——每次写作前先对照状态库检查'],
  },
  script: {
    key: 'script',
    label: '逐集剧本',
    source: '第五步 · 逐集剧本生成',
    summary: '先看分集蓝图（出场人物、冲突、承接、钩子），再点击生成；草稿进草稿箱，审稿 / 修稿后定稿归入正文章节。',
    deliverables: ['分集蓝图', '草稿箱', '正文章节（英文 + 中文对照）'],
    phase: null,
    notes: [
      `AI 一次只写一集（也可一批 5 集），编剧定稿后再写下一集；写第 N 集时引用前面的人物、${SHOW_FORESHADOW ? '伏笔与' : ''}状态`,
      '中文写作，定稿后一键把台词翻译成英文',
      '选中任意一句可标注、润色、扩写、续写或改成对话，去掉“AI 味”',
    ],
  },
  qa: {
    key: 'qa',
    label: '质检交付',
    source: '第五板块 · 质检交付',
    summary: `一致性终检、角色一致性、故事流程、节奏曲线对比、付费点专项与格式合规六项自动检查（仿写另查创新点落地）：上方看总分与分项、下面列出全部问题（可按分项与严重程度筛选），左侧按集浏览，中间定稿里标出问题字段，右侧看所选这一集的问题；正文问题可让 AI 按原有设定修稿。`,
    deliverables: ['质检报告', '可交付剧本包'],
    phase: null,
    notes: ['重点看：是否与状态库一致、节奏是否偏离对标剧、付费点 / 大痛点 / 大爽点 / 钩子是否够力、格式是否合规'],
  },
}

/**
 * 每一步能不能跳过：快速出稿的人跳过能跳的，想深度打磨的每一步都有地方展开。
 * must 必做；quick 必做，但可以一键完成、不逐项细看；skip 可以整步跳过。
 */
export type StageNeedLevel = 'must' | 'quick' | 'skip'

export const STAGE_NEED: Partial<Record<StageKey, { level: StageNeedLevel; text: string }>> = {
  video: { level: 'must', text: '视频转写是拆解的原料，必做；人工校对可以跳过，不校对也能合并' },
  breakdown: { level: 'quick', text: '拆解结果是改写的依据，必做；拆完不用逐块审核，看过、改好就可以「一键引用」' },
  architecture: { level: 'must', text: '必做；只有核心设定必填，其余各项可以空着，也可以让 AI 一项一项生成空着的项（每生成一项停下来看），确认前看一眼标「补充」的内容' },
  characters: { level: 'quick', text: '后面的大纲与写作都按人物来，必做；可以 AI 一键生成，非必填项不用填' },
  outline: { level: 'quick', text: '写作按集纲来，必做；可以「AI 一键生成全部」，不逐集细看' },
  foreshadow: { level: 'skip', text: '可以整步跳过：不登记伏笔也能写，只是少了伏笔提醒与回收检查' },
  script: { level: 'must', text: '分集写作与定稿必做；蓝图细调、AI 审稿都可以跳过，没审稿也能直接定稿' },
  qa: { level: 'quick', text: '交付前跑一次质检，必做；只有严重问题要处理，其余可以先交付' },
}

export const NEED_LABEL: Record<StageNeedLevel, string> = { must: '必做', quick: '必做 · 可一键', skip: '可跳过' }

/** 各创作方式在工作台中依次经过的环节 */
const ALL_STAGES: Record<ProjectMode, StageKey[]> = {
  original: ['overview', 'architecture', 'characters', 'outline', 'foreshadow', 'script', 'qa'],
  adaptation: ['overview', 'breakdown', 'architecture', 'characters', 'outline', 'foreshadow', 'script', 'qa'],
  video: ['overview', 'video', 'breakdown', 'architecture', 'characters', 'outline', 'foreshadow', 'script', 'qa'],
}
export const MODE_STAGES = Object.fromEntries(Object.entries(ALL_STAGES).map(([mode, list]) => [mode, list.filter((k) => SHOW_FORESHADOW || k !== 'foreshadow')])) as Record<ProjectMode, StageKey[]>

/** 需求文档总流程（首页展示用） */
export const MASTER_FLOW = [
  { label: '选题雷达', hint: '榜单 / 趋势 / 素材' },
  { label: '视频转剧本', hint: '逐集转写 · 合并' },
  { label: '对标剧拆解', hint: '四大板块' },
  { label: '故事架构', hint: '核心设定 · 冲突主线' },
  { label: '情节大纲', hint: SHOW_FORESHADOW ? '钩子 · 伏笔' : '钩子 · 付费卡点' },
  { label: '逐集剧本', hint: '状态库驱动' },
  { label: '质检交付', hint: '六 / 七项自动检查' },
  { label: '数据回流', hint: '反哺选题' },
]

/** 五段式冲突主线（需求文档 · 第三步搭冲突主线） */
export const MAIN_LINE = ['开局困境', '第一次小反转', '中点大反转', '第二幕升级', '高潮结局'] as const

/** 对标剧拆解的四大板块（需求文档 · 第三板块）；按页面上的顺序排，冲突主线在人物设定前（11/3 标注） */
export const BREAKDOWN_BLOCKS = [
  { key: 'synopsis', label: '故事梗概', items: ['目标受众', '题材类型', '核心设定', '风格元素', '世界观', '金手指', '核心亮点（期待值）', '故事简介', '付费卡点'] },
  { key: 'mainline', label: '冲突主线 · 内容简介', items: ['节奏', '每段梗概', '每集走向', '第 1 集到一卡、付费卡点集细拆：场景、关键动作、情绪转折、核心台词'] },
  { key: 'characters', label: '人物设定', items: ['主角：简介、身份、金手指、动机', '配角：作用、定位', '全剧人物关系网'] },
] as const satisfies readonly { key: BreakdownBlock; label: string; items: readonly string[] }[]

/** 质检七项（需求文档 · 第五板块，评审时补了角色一致性与故事流程）；weight 为总分里的权重，合计 1。创新点落地只查仿写，原创用 qaChecks 去掉 */
export type QaCheckMeta = { key: QaCheckKey; label: string; desc: string; to: StageKey; weight: number }
export const QA_CHECKS: QaCheckMeta[] = [
  SHOW_FORESHADOW
    ? { key: 'consistency', label: '一致性终检', desc: '时间线、伏笔埋设与回收、对标剧人名残留，对照剧本状态库', to: 'foreshadow', weight: 0.15 }
    : { key: 'consistency', label: '一致性终检', desc: '时间线、人物状态、对标剧人名残留，对照剧本状态库', to: 'script', weight: 0.15 },
  { key: 'character', label: '角色一致性', desc: '人物称谓是否统一、主要人物在各阶段是否在场，人物状态的变化是否有交代、有没有停滞或突变', to: 'characters', weight: 0.15 },
  { key: 'flow', label: '故事流程', desc: '剧情有没有断档、集与集的钩子是否承接、场景是否单调拖沓、各阶段的情绪是否层层推高', to: 'outline', weight: 0.15 },
  { key: 'rhythm', label: '节奏曲线对比', desc: '成稿的情绪曲线与对标剧 / 节奏框架对比，标出塌陷段', to: 'outline', weight: 0.15 },
  { key: 'paywall', label: '付费点专项', desc: '每个付费卡点是否落在情绪波峰，大痛点 / 大爽点 / 钩子是否够力', to: 'outline', weight: 0.15 },
  { key: 'innovation', label: '创新点落地', desc: '仿写：故事架构里的创新点（我们怎么做）是否真的写进了剧本', to: 'architecture', weight: 0.1 },
  { key: 'format', label: '格式合规', desc: '场景标题、台词说话人与集末钩子能否直接对接制作线', to: 'script', weight: 0.15 },
]

/** 这个项目要跑的质检：原创没有创新点，不查创新点落地，它的 10% 分给一致性终检和付费点专项（各 20%） */
export function qaChecks(p: Pick<Project, 'mode'>): QaCheckMeta[] {
  if (hasInnovations(p)) return QA_CHECKS
  return QA_CHECKS.filter((c) => c.key !== 'innovation').map((c) => (c.key === 'consistency' || c.key === 'paywall' ? { ...c, weight: 0.2 } : c))
}
