import type { ProjectMode, QaCheckKey, StageKey } from './types'

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
      '上传剧本后按四大板块拆解：故事梗概、人物设定、冲突主线与节奏框架、粗纲与分集提纲（每集 12 字段）；再归纳题材元素、钩子分布与付费点规律，形成可迁移的结构骨架。',
    deliverables: ['故事梗概', '人物设定', '节奏曲线', '逐集明细表', '可迁移骨架'],
    phase: null,
    notes: [
      '四个板块逐一审核，确认无误后「一键引用」进入改写',
      '经市场验证的主线结构（开局困境 → 第一次小反转 → 中点大反转…）仿写时尽量保持',
    ],
  },
  architecture: {
    key: 'architecture',
    label: '故事架构',
    source: '第三步 · 设计故事架构',
    summary: '定义剧本的基本信息与写作参数：核心大纲（改写方案 · 创新点 · 冲突主线 → 节奏框架）、世界观、金手指、主角人设、全局写作要求、参考作品。',
    deliverables: ['基本信息', '核心大纲', '冲突主线 · 节奏框架', '世界观 / 金手指', '全局写作要求'],
    phase: null,
    notes: [
      '仿写：有改写想法时 AI 评估可行性；没有想法时 AI 基于拆解结果提出新方向，与编剧商量出改写方案',
      '原创：核心设定直接从这一步开始，由 AI 引导梳理出整体框架',
      '先定冲突主线（段落、集数、剧情），再按主线生成节奏框架',
    ],
  },
  characters: {
    key: 'characters',
    label: '人物设定',
    source: '第三步 · 定人物配置',
    summary: '每个角色的性别、年龄、外貌、性格、背景、能力，动机（表面追求 / 终极渴望 / 潜意识恐惧）、缺陷与弧光，以及人物关系（爱人、同学、宿敌 …）与关系图。',
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
    summary: '先总览整部剧的剧情，再按冲突主线总结每个阶段的粗纲，下面是每集的集纲（每 10 集一批）；钩子轮换自动检查，付费卡点集单独审核。大纲确定后再埋伏笔。',
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
    summary: '先看分集蓝图（定位、出场人物、小目标、冲突、钩子、作者微操指导），再点击生成；草稿进草稿箱，审稿 / 修稿后定稿归入正文章节。',
    deliverables: ['分集蓝图', '草稿箱', '正文章节（英文 + 中文对照）'],
    phase: null,
    notes: [
      'AI 一次只写一集（也可一批 5 集），编剧定稿后再写下一集；写第 N 集时引用前面的人物、伏笔与状态',
      '中文写作，定稿后一键把台词翻译成英文',
      '选中任意一句可标注、润色、扩写、续写或改成对话，去掉“AI 味”',
    ],
  },
  qa: {
    key: 'qa',
    label: '质检交付',
    source: '第五板块 · 质检交付',
    summary: '一致性终检、角色一致性、故事流程、节奏曲线对比、付费点专项、创新点落地与格式合规七项自动检查：左侧看总分与分项、按集浏览，中间定稿里标出问题字段，右侧逐条看问题详情与修改建议。',
    deliverables: ['质检报告', '可交付剧本包'],
    phase: null,
    notes: ['重点看：是否与状态库一致、节奏是否偏离对标剧、付费点 / 大痛点 / 大爽点 / 钩子是否够力、格式是否合规'],
  },
}

/** 各创作方式在工作台中依次经过的环节 */
export const MODE_STAGES: Record<ProjectMode, StageKey[]> = {
  original: ['overview', 'architecture', 'characters', 'outline', 'foreshadow', 'script', 'qa'],
  adaptation: ['overview', 'breakdown', 'architecture', 'characters', 'outline', 'foreshadow', 'script', 'qa'],
  video: ['overview', 'video', 'breakdown', 'architecture', 'characters', 'outline', 'foreshadow', 'script', 'qa'],
}

/** 需求文档总流程（首页展示用） */
export const MASTER_FLOW = [
  { label: '选题雷达', hint: '榜单 / 趋势 / 素材' },
  { label: '视频转剧本', hint: '逐集转写 · 合并' },
  { label: '对标剧拆解', hint: '四大板块' },
  { label: '故事架构', hint: '改写方案 · 创新点' },
  { label: '情节大纲', hint: '钩子 · 伏笔' },
  { label: '逐集剧本', hint: '状态库驱动' },
  { label: '质检交付', hint: '七项自动检查' },
  { label: '数据回流', hint: '反哺选题' },
]

/** 五段式冲突主线（需求文档 · 第三步搭冲突主线） */
export const MAIN_LINE = ['开局困境', '第一次小反转', '中点大反转', '第二幕升级', '高潮结局'] as const

/** 对标剧拆解的四大板块（需求文档 · 第三板块） */
export const BREAKDOWN_BLOCKS = [
  { label: '故事梗概', items: ['目标受众', '题材类型', '核心设定', '风格元素', '世界观', '核心亮点', '核心梗概', '付费卡点'] },
  { label: '人物设定', items: ['角色性格', '角色事件', '全剧人物关系网'] },
  { label: '冲突主线 · 节奏', items: [...MAIN_LINE] },
  { label: '粗纲 · 分集提纲', items: ['开场 / 结尾钩子', '本集故事概括', '冲突强度', '伏笔预埋 / 回收'] },
] as const

/** 逐集明细表的 12 个字段（需求文档 · 第二步拆对标剧） */
export const BREAKDOWN_FIELDS = [
  { label: '集数', desc: '', example: '第 1 集 … 第 70 集' },
  { label: '开场钩子（前 5 秒）', desc: '用什么方式抓人', example: '冲突前置 / 悬念金句 / 视觉冲击 / 情绪倒叙' },
  { label: '本集事件', desc: '一句话概括', example: '女主发现丈夫私藏前妻照片' },
  { label: '冲突强度', desc: '本集推进幅度', example: '1–5 分' },
  { label: '新出场人物', desc: '', example: '婆婆 / 私生子 / 律师' },
  { label: '人物关系变化', desc: '谁和谁的关系变了', example: '夫妻从恩爱 → 互相提防' },
  { label: '伏笔埋设', desc: '本集埋了什么没解释的', example: '男主手腕上的旧疤' },
  { label: '伏笔回收', desc: '回收了前面哪个', example: '第 3 集的疤 → 本集揭示是前任所伤' },
  { label: '结尾钩子（后 10 秒）', desc: '留什么让人点下一集', example: '悬念 / 反转 / 情绪高点 / 新秘密 / 付费卡点' },
  { label: '是否付费点', desc: '本集是否付费解锁', example: '是 / 否' },
  { label: '付费卡点位置', desc: '卡在什么情绪上', example: '即将签字离婚时被丈夫拦住' },
  { label: '情绪强度', desc: '本集整体情绪温度', example: '1–5 分' },
] as const

/** 质检七项（需求文档 · 第五板块，评审时补了角色一致性与故事流程）；weight 为总分里的权重，合计 1 */
export const QA_CHECKS: { key: QaCheckKey; label: string; desc: string; to: StageKey; weight: number }[] = [
  { key: 'consistency', label: '一致性终检', desc: '时间线、伏笔埋设与回收、对标剧人名残留，对照剧本状态库', to: 'foreshadow', weight: 0.15 },
  { key: 'character', label: '角色一致性', desc: '人物称谓是否统一、主要人物在各阶段是否在场，人物状态的变化是否有交代、有没有停滞或突变', to: 'characters', weight: 0.15 },
  { key: 'flow', label: '故事流程', desc: '剧情有没有断档、集与集的钩子是否承接、场景是否单调拖沓、各阶段的情绪是否层层推高', to: 'outline', weight: 0.15 },
  { key: 'rhythm', label: '节奏曲线对比', desc: '成稿的情绪曲线与对标剧 / 节奏框架对比，标出塌陷段', to: 'outline', weight: 0.15 },
  { key: 'paywall', label: '付费点专项', desc: '每个付费卡点是否落在情绪波峰，大痛点 / 大爽点 / 钩子是否够力', to: 'outline', weight: 0.15 },
  { key: 'innovation', label: '创新点落地', desc: '故事架构卡里的创新点是否真的写进了剧本', to: 'architecture', weight: 0.1 },
  { key: 'format', label: '格式合规', desc: '场景标题、台词说话人与集末钩子能否直接对接制作线', to: 'script', weight: 0.15 },
]
