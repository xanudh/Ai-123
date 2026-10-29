/** 创作方式：决定项目后续走哪条流水线 */
export type ProjectMode = 'original' | 'adaptation' | 'video'

export type Audience = 'female' | 'male' | 'all'

export type ScriptLanguage = 'en_zh' | 'en' | 'zh'

export type AspectRatio = '9:16' | '16:9' | '1:1'

export type ProjectStatus = 'draft' | 'writing' | 'reviewing' | 'delivered'

/** 流水线阶段，对应需求文档中的板块 */
export type StageKey =
  | 'overview'
  | 'video'
  | 'breakdown'
  | 'architecture'
  | 'characters'
  | 'foreshadow'
  | 'outline'
  | 'state'
  | 'script'
  | 'qa'

/** 对标剧信息（仿写 / 视频转剧本模式在建项时登记） */
export interface Benchmark {
  title: string
  platform: string
  url: string
  episodes: number | null
  notes: string
}

/** 剧本规格 */
export interface ScriptSpec {
  totalEpisodes: number
  /** 单集时长（秒）；逐集剧本的字数按时长换算 */
  episodeSeconds: number
  aspectRatio: AspectRatio
  language: ScriptLanguage
}

/** 节奏框架：付费卡点（第一个即首付费集）、大反转、结局高潮区间 */
export interface RhythmFrame {
  paywalls: number[]
  twists: number[]
  climaxFrom: number
}

export interface ActivityEntry {
  at: string
  text: string
}

/* ------------------------------ 第二阶段：仿写与解析 ------------------------------ */

/** 审核状态：AI 产出后先待审核，编剧确认后才进入下一环节的上下文 */
export type ReviewStatus = 'pending' | 'approved'

/** 对标剧剧本原文，按分集标记切好 */
export interface SourceScript {
  name: string
  text: string
  episodes: { ep: number; text: string }[]
  importedAt: string
}

/** 拆解板块一：故事梗概 */
export interface Synopsis {
  audience: string
  genre: string
  coreSetup: string
  style: string
  world: string
  highlights: string
  summary: string
  paywalls: string
}

/** 拆解板块二：对标剧人物 */
export interface BenchmarkCharacter {
  name: string
  role: string
  personality: string
  events: string
}

export interface Relation {
  a: string
  b: string
  /** 关系类型：爱人 / 同学 / 宿敌 …，按剧本描述填写；关系图连线上显示 */
  kind: string
  /** 关系备注：这段关系怎么变化 */
  label: string
}

/** 冲突主线中的一段 */
export interface PlotBeat {
  beat: string
  range: string
  content: string
}

/** 逐集明细表的 12 个字段 */
export interface EpisodeBreakdown {
  ep: number
  openHook: string
  event: string
  conflict: number
  newCharacters: string
  relationChange: string
  plant: string
  payoff: string
  endHook: string
  paywall: boolean
  paywallMoment: string
  emotion: number
}

export type BreakdownBlock = 'synopsis' | 'characters' | 'mainline' | 'episodes'

export interface Breakdown {
  synopsis: Synopsis
  characters: BenchmarkCharacter[]
  relations: Relation[]
  mainLine: PlotBeat[]
  /** 从对标剧推断的节奏框架，totalEpisodes 为拆解到的集数 */
  rhythm: RhythmFrame
  totalEpisodes: number
  episodes: EpisodeBreakdown[]
  review: Record<BreakdownBlock, ReviewStatus>
  /** 一键引用到故事架构的时间；null 表示还没引用 */
  referencedAt: string | null
  generatedAt: string
}

/** 创新点：对标剧怎么做 → 我们怎么做 */
export interface Innovation {
  id: string
  theirs: string
  ours: string
}

export type StoryStructure = '单线叙事' | '双线叙事' | '多线叙事'

export interface Architecture {
  /** 编剧自己的改写想法 / 故事方向（可空，空时由 AI 提方向） */
  idea: string
  /** 定稿的改写方案 */
  plan: string
  /** 爽点公式：每 X 集一次什么爽感 */
  formula: string
  /** 冲突主线各段（默认五段，可增删）；段落名可改 */
  mainLine: PlotBeat[]
  /** 冲突主线每段的结束集（按记录时的总集数）；null 表示按默认比例切分 */
  phaseEnds: number[] | null
  innovations: Innovation[]
  status: ReviewStatus
  structure: StoryStructure
  /** 叙事视角 */
  viewpoint: string
  /** 伏笔 / 叙事线索连续多少集没有推进就提醒 */
  silenceThreshold: number
  /** 世界观 / 初始设定 */
  world: string
  /** 金手指 / 核心卖点 */
  goldenFinger: string
  /** 主角人设（一句话版，人物设定里再展开） */
  heroSetup: string
  /** 全局写作要求：每集写作都会带上 */
  writingRules: string
  /** 参考作品 */
  references: string
}

export type CharacterRole = '主角' | '暧昧对象' | '反派' | '配角'

export interface Character {
  id: string
  name: string
  nameEn: string
  role: CharacterRole
  gender: string
  age: string
  /** 身份：外在标签 */
  profile: string
  appearance: string
  personality: string
  background: string
  /** 能力 / 金手指 */
  ability: string
  /** 动机 · 表面追求 */
  goal: string
  /** 动机 · 终极渴望 */
  desire: string
  /** 动机 · 潜意识恐惧 */
  fear: string
  flaw: string
  arc: string
  notes: string
  /** 仿写时对应的对标剧角色 */
  benchmark: string
}

export type ForeshadowType = '人物秘密' | '隐藏身份' | '关键道具' | '前情恩怨' | '叙事线索'

/** 伏笔在正文中的一次推进：埋设、呼应或回收 */
export type PlanEventKind = 'plant' | 'echo' | 'payoff'

export interface PlanEvent {
  id: string
  ep: number
  kind: PlanEventKind
  /** 证据：逐字摘自这一集定稿的短原文 */
  text: string
  /** 确认理由（旧数据没有） */
  reason?: string
  at: string
}

/** 伏笔 / 叙事线索计划：只有编剧确认过的定稿事件才算数 */
export interface Foreshadow {
  id: string
  type: ForeshadowType
  title: string
  /** 作者意图：埋什么、怎么收 */
  content: string
  /** 埋设集；叙事线索为开始集 */
  plantEp: number
  /** 回收集；叙事线索为结束集 */
  payoffEp: number
  events: PlanEvent[]
}

export type HookType = '悬念' | '反转' | '情绪高点' | '新秘密' | '付费卡点'

/** 情节大纲：全剧总览 + 冲突主线各段粗纲 */
export interface Plot {
  overview: string
  phases: string[]
}

export interface OutlineEpisode {
  ep: number
  title: string
  event: string
  hook: HookType
  hookLine: string
  /** 付费卡点集需要单独审核 */
  approved: boolean
}

/** 分集蓝图：写作前的预览设定 */
export interface EpisodeBlueprint {
  ep: number
  title: string
  /** 定位：开场钩子 / 付费卡点 / 大反转 … */
  position: string
  /** 出场关键人 */
  cast: string
  /** 主角小目标 */
  goal: string
  /** 实质冲突与转折 */
  conflict: string
  /** 承接：本集开头接住什么——上集结尾的钩子，或前几集埋下、本集要响的伏笔；不写时默认接上集结尾的钩子（旧数据没有） */
  carry?: string
  /** 末尾悬念钩子 */
  hook: string
  /** 作者微操指导 */
  guidance: string
  /** 集要点：定稿后自动提炼 */
  points: string
}

export type ScriptLineKind = 'scene' | 'action' | 'dialogue' | 'hook'

export interface ScriptLine {
  id: string
  kind: ScriptLineKind
  speaker?: string
  speakerEn?: string
  zh: string
  /** 英文台词；中文改动后清空，等待重新翻译 */
  en?: string
  /** 段落对齐；不写为左对齐。正文里的 **加粗** / *斜体* 直接以 Markdown 记在 zh 里 */
  align?: 'center' | 'right'
}

/** 草稿状态：草稿 / 已修稿（被新版本取代）/ 已定稿 */
export type DraftStatus = 'draft' | 'revised' | 'final'

/** 审稿意见的类别：AI 修稿按它逐条处理；旧报告没有，修稿时按自检处理 */
export type ReviewCode = 'short' | 'long' | 'scene' | 'hook' | 'carry' | 'plan' | 'hero' | 'unknown' | 'absent' | 'state' | 'paid' | 'filler' | 'longLine' | 'notes'

export interface ReviewItem {
  level: 'block' | 'warn' | 'info' | 'ok'
  text: string
  code?: ReviewCode
}

/** AI 审稿报告 */
export interface DraftReview {
  id: string
  at: string
  score: number
  items: ReviewItem[]
  /** 审稿时正文的指纹：正文没改动就不重复审稿 */
  sig?: string
}

/** AI 修稿记录 */
export interface DraftRevision {
  /** 依据的审稿报告（来源草稿上的）；没审稿时按标注与自检修改 */
  reviewId?: string
  reviewNo?: number
  changes: string[]
  /** AI 不擅自改、留给编剧处理的审稿意见 */
  manual: string[]
}

/** 编辑器里对某一行的标注 */
export interface LineNote {
  id: string
  lineId: string
  /** 标注时选中的原文 */
  quote: string
  text: string
  at: string
}

/** 草稿箱里的一个版本 */
export interface EpisodeDraft {
  id: string
  ep: number
  version: number
  title: string
  lines: ScriptLine[]
  status: DraftStatus
  translated: boolean
  states: Record<string, string>
  reviews: DraftReview[]
  notes: LineNote[]
  /** AI 修稿生成的版本记下来源草稿；用来限制修稿轮数 */
  from?: string
  /** AI 修稿的依据与结果：按哪份审稿改的、改了什么、哪些要人工处理 */
  revision?: DraftRevision
  createdAt: string
  updatedAt: string
}

/** 正文章节：定稿后的剧本，状态库只从这里取数 */
export interface EpisodeScript {
  ep: number
  title: string
  lines: ScriptLine[]
  status: 'final'
  /** 是否已执行过一键翻译（显示英文行） */
  translated: boolean
  /** 写完本集后回写状态库的人物状态：角色名 → 当前状态 */
  states: Record<string, string>
  /** 来源草稿 */
  draftId: string
  /** 定稿上的标注：直接改正文时的待办提醒 */
  notes?: LineNote[]
  updatedAt: string
}

/* ------------------------------ 第三阶段：视频转剧本 ------------------------------ */

/** 单集转写进度：排队 → 下载 → 压缩 → 多模态转写 → 完成 / 失败 */
export type TranscribeStatus = 'queued' | 'downloading' | 'compressing' | 'transcribing' | 'done' | 'failed'

/** 分镜剧本里的一个镜头 */
export interface Shot {
  /** 起止时间（秒） */
  start: number
  end: number
  /** 景别：特写 / 近景 / 中景 / 全景 / 远景 */
  size: string
  /** 换场时的场景标题 */
  scene?: string
  /** 画面与动作 */
  action: string
  speaker?: string
  /** 表演提示，如“冷笑” */
  cue?: string
  line?: string
  /** 音效 / 音乐 */
  sound?: string
}

export interface VideoEpisode {
  ep: number
  /** 时长（秒） */
  duration: number
  /** 付费集 */
  paid: boolean
  /** 本地上传时的文件名 */
  file?: string
  /** 进度百分比只在内存里（services/videoQueue），不落库 */
  status: TranscribeStatus
  /** 已尝试次数（失败后重试会累加） */
  attempts: number
  shots: Shot[]
  error?: string
  doneAt?: string
}

/** 合并后的完整剧本 */
export interface MergedScript {
  text: string
  /** 合并时自动修正的格式问题 */
  fixes: { label: string; count: number }[]
  mergedAt: string
  /** 送入对标剧拆解的时间 */
  importedAt: string | null
}

/** 视频转剧本任务：一部对标剧的全集视频 */
export interface VideoJob {
  origin: 'link' | 'upload'
  url: string
  platform: string
  episodes: VideoEpisode[]
  createdAt: string
  merged: MergedScript | null
}

/* ---------------------------------- 质检交付 ---------------------------------- */

export type QaCheckKey = 'consistency' | 'character' | 'flow' | 'rhythm' | 'paywall' | 'innovation' | 'format'

export interface QaIssue {
  id: string
  check: QaCheckKey
  level: 'block' | 'warn' | 'info'
  /** 所在集；null 表示全剧层面的问题 */
  ep: number | null
  /** 定位到的行；null 表示整集问题 */
  lineId: string | null
  /** 行内需要标色的片段 */
  quote?: string
  title: string
  detail: string
  suggestion: string
}

export interface QaCheckResult {
  key: QaCheckKey
  score: number
  summary: string
}

/** 质检报告：按当时的正文章节生成，正文改动后提示重新质检 */
export interface QaReport {
  at: string
  /** 质检时各集正文的更新时间，用来判断报告是否过期 */
  versions: Record<number, string>
  score: number
  checks: QaCheckResult[]
  issues: QaIssue[]
  /** 编剧标记为已处理 / 忽略的问题 */
  resolved: string[]
}

/** 项目在各创作环节的产出 */
export interface ProjectWork {
  video: VideoJob | null
  source: SourceScript | null
  breakdown: Breakdown | null
  architecture: Architecture | null
  characters: Character[]
  relations: Relation[]
  foreshadows: Foreshadow[]
  plot: Plot | null
  outline: OutlineEpisode[]
  blueprints: EpisodeBlueprint[]
  drafts: EpisodeDraft[]
  scripts: EpisodeScript[]
  qa: QaReport | null
}

export interface Project {
  id: string
  mode: ProjectMode
  title: string
  titleEn: string
  /** 一句话灵感（用户原始输入） */
  idea: string
  /** 核心设定（高概念 / Logline）：主角是谁 + 核心困境 + 反常规设定 */
  logline: string
  /** 类型：都市 / 玄幻 / 仙侠 / 科幻 … */
  category: string
  genres: string[]
  audience: Audience
  tones: string[]
  markets: string[]
  platforms: string[]
  spec: ScriptSpec
  rhythm: RhythmFrame
  benchmark: Benchmark | null
  status: ProjectStatus
  /** 封面配色序号 */
  palette: number
  sample?: boolean
  createdAt: string
  updatedAt: string
  activity: ActivityEntry[]
  work: ProjectWork
}

/** 立项页收集的表单数据（不含系统字段与环节产出） */
export type ProjectDraft = Omit<Project, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'activity' | 'sample' | 'work'>
