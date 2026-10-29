import type { Audience, CharacterRole, DraftStatus, ForeshadowType, HookType, PlanEventKind, ProjectMode, ProjectStatus, ScriptLanguage, StoryStructure } from './types'

/** 类型：故事发生的大背景，单选 */
export const CATEGORIES = ['都市', '言情', '玄幻', '仙侠', '科幻', '悬疑', '古装', '年代', '奇幻', '末世', '武侠', '历史', '校园', '家庭'] as const

/** 题材元素：需求文档路径 B 列出的类型 + 出海短剧常见元素 */
export const GENRES = [
  '重生', '复仇', '霸总', '狼人', '马甲', '替嫁', '闪婚', '契约婚姻',
  '隐藏身份', '豪门', '萌宝', '逆袭', '战神', '先婚后爱', '追妻火葬场',
  '黑手党', '吸血鬼', '灰姑娘', '神医', '宫斗',
] as const

export const MAX_GENRES = 4

/** 风格基调 / 情绪类型 */
export const TONES = ['爽感', '虐心', '甜宠', '悬疑', '搞笑', '热血', '暗黑', '治愈'] as const

export const AUDIENCES: { value: Audience; label: string; hint: string }[] = [
  { value: 'female', label: '女频', hint: '情感线主导' },
  { value: 'male', label: '男频', hint: '逆袭打脸主导' },
  { value: 'all', label: '全年龄', hint: '家庭 / 悬疑' },
]

export const MARKETS = ['北美', '东南亚', '拉美', '欧洲', '中东', '日韩'] as const

export const PLATFORMS = ['ReelShort', 'DramaBox', 'ShortMax', 'GoodShort', 'TikTok', 'FlexTV'] as const

export const LANGUAGES: { value: ScriptLanguage; label: string; hint: string }[] = [
  { value: 'en_zh', label: '英文剧本 + 中文对照', hint: '推荐：中文创作与审核，定稿后一键把台词译成英文' },
  { value: 'en', label: '仅英文', hint: '直接对接海外制作线' },
  { value: 'zh', label: '仅中文', hint: '后期再翻译润色' },
]

/** 单集时长（秒） */
export const EPISODE_SECONDS = { min: 30, max: 300, default: 90 } as const

export const EPISODE_RANGE = { min: 20, max: 120, default: 70 } as const

/** 英文对白语速（词 / 分钟），用于估算单集台词量 */
export const SPEECH_WPM = 150

/** 中文剧本篇幅（字 / 分钟，含场景、动作与对白），逐集剧本按单集时长换算字数 */
export const SCRIPT_CPM = 650

/** 对标剧剧本文件上限，超过请拆分后分批导入 */
export const MAX_SOURCE_BYTES = 2 * 1024 * 1024

export const MODE_META: Record<
  ProjectMode,
  {
    label: string
    short: string
    /** 入口提示：用户手上已有的素材 */
    entry: string
    desc: string
    phase: string | null
    /** 业务主流程（会上确认：绝大多数项目从对标剧出发） */
    primary?: boolean
  }
> = {
  original: {
    label: '原创剧本',
    short: '原创',
    entry: '手上有一个想法',
    desc: '从核心设定直接进入故事架构：AI 梳理框架 → 人物 → 情节大纲 → 逐集剧本',
    phase: null,
  },
  adaptation: {
    label: '对标剧仿写',
    short: '仿写',
    entry: '手上有对标剧剧本',
    desc: '上传对标剧剧本，拆解故事梗概 / 人物 / 主线节奏 / 分集提纲四大板块，一键引用后改写成本土化新剧',
    phase: null,
    primary: true,
  },
  video: {
    label: '视频转剧本',
    short: '视频',
    entry: '只有对标剧视频',
    desc: '粘贴对标剧链接，全集视频逐集自动转写、合并成完整剧本，再进入拆解',
    phase: null,
  },
}

export const STATUS_META: Record<ProjectStatus, { label: string; tone: 'gray' | 'violet' | 'amber' | 'green' }> = {
  draft: { label: '立项中', tone: 'gray' },
  writing: { label: '创作中', tone: 'violet' },
  reviewing: { label: '质检中', tone: 'amber' },
  delivered: { label: '已交付', tone: 'green' },
}

export const CHARACTER_ROLES: CharacterRole[] = ['主角', '暧昧对象', '反派', '配角']

/** 常见人物关系类型（关系图连线上显示）；也可以按剧本描述自己填写 */
export const RELATION_KINDS = [
  '爱人', '恋人', '夫妻', '契约夫妻', '前任', '命定伴侣', '未婚夫妻', '青梅竹马', '暗恋', '追求者', '情敌',
  '父女', '父子', '母女', '母子', '兄妹', '姐妹', '兄弟', '长辈',
  '同学', '同门', '室友', '闺蜜', '朋友', '盟友', '合作伙伴', '上下级', '主仆', '师徒',
  '宿敌', '仇人', '对手',
] as const

export const FORESHADOW_TYPES: ForeshadowType[] = ['人物秘密', '隐藏身份', '关键道具', '前情恩怨', '叙事线索']

export const PLAN_EVENT_META: Record<PlanEventKind, { label: string; tone: 'amber' | 'violet' | 'green' }> = {
  plant: { label: '埋设', tone: 'amber' },
  echo: { label: '呼应', tone: 'violet' },
  payoff: { label: '回收', tone: 'green' },
}

export const STORY_STRUCTURES: { value: StoryStructure; hint: string }[] = [
  { value: '单线叙事', hint: '一条主线贯穿到底，节奏最快' },
  { value: '双线叙事', hint: '主线 + 感情线 / 复仇线交替推进' },
  { value: '多线叙事', hint: '多条人物线交织，适合群像' },
]

export const VIEWPOINTS = ['第三人称 · 跟随主角', '第三人称 · 全知', '第一人称 · 主角', '多视角轮换'] as const

/** 结尾钩子类型（需求文档 · 分集大纲：钩子轮换） */
export const HOOK_TYPES: HookType[] = ['悬念', '反转', '情绪高点', '新秘密', '付费卡点']

/** 情节大纲每批生成的集数 */
export const OUTLINE_BATCH = 10

/** 逐集剧本批量写作默认选的集数（范围可以手动选到最后一集） */
export const SCRIPT_BATCH = 5

/** 分集蓝图里的本集定位 */
export const EPISODE_POSITIONS = ['开篇', '铺垫', '发展', '转折', '付费卡点', '升级', '高潮', '结局'] as const

export const DRAFT_STATUS_META: Record<DraftStatus, { label: string; tone: 'gray' | 'amber' | 'green' }> = {
  draft: { label: '草稿', tone: 'gray' },
  revised: { label: '已修稿', tone: 'amber' },
  final: { label: '已定稿', tone: 'green' },
}

/** 封面渐变色板 */
export const PALETTES = [
  ['#7C5CFF', '#4F46E5'],
  ['#F43F5E', '#BE185D'],
  ['#F59E0B', '#EA580C'],
  ['#10B981', '#0F766E'],
  ['#0EA5E9', '#2563EB'],
  ['#A855F7', '#DB2777'],
] as const
