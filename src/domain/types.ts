/** 创作方式：决定项目后续走哪条流水线 */
export type ProjectMode = 'original' | 'adaptation' | 'video'

export type Audience = 'female' | 'male' | 'all'

export type ScriptLanguage = 'en_zh' | 'en' | 'zh'
/** AI 模型分两类：video 只管视频转剧本的逐集解析，text 管其余所有文本环节 */
export type ModelGroup = 'video' | 'text'
/** 可选的大模型（按厂商，具体版本接入真实接口时再定） */
export type ModelId = 'deepseek' | 'qwen' | 'doubao' | 'kimi' | 'gpt' | 'gemini'

export type ProjectStatus = 'draft' | 'writing' | 'reviewing' | 'delivered'

/** 流水线阶段，对应需求文档中的板块 */
export type StageKey =
  | 'overview'
  | 'video'
  | 'breakdown'
  | 'architecture'
  | 'characters'
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
  /** 付费集：编剧照对标剧填付费卡点在第几集，多个用「，」隔开，第一个即首付费；填了拆解就按它定一卡和付费卡点集，视频按它标付费（11/5 起，旧数据没有） */
  paywalls?: string
}

/** 剧本规格 */
export interface ScriptSpec {
  totalEpisodes: number
  /** 单集时长（秒）；逐集剧本的字数按时长换算 */
  episodeSeconds: number
  language: ScriptLanguage
  /** 完全按对标剧的集数与单集时长：勾选后两项跟着对标剧走，拆解 / 转写后自动填上（旧数据没有） */
  followBenchmark?: boolean
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
  /** 世界观：总分写法，先写整个世界是什么样的，再分阵营设定、主要地点（私设的专有名词要写细） */
  world: string
  /** 核心亮点，也就是期待值：核心爽点、主线任务（前十集）、情感双线、子类型特征 */
  highlights: string
  /** 金手指：不分类型（11/4 第二轮），首次出现、核心能力（每项讲清是什么、来历、能做到什么）、表现方式、与主线强相关 */
  goldenFinger: string
  /** 故事简介：一段话把整个故事从头讲到尾：主角处境 → 谁为了什么用什么手段逼主角 → 转机 → 高潮 → 结局 */
  summary: string
  paywalls: string
}

/**
 * 主角另拆的几项（11/4 标注：主角要拆细），名字和人物设定的小传对得上。
 * 11/4 第五轮标注（#69）页面上只留简介（intro）、身份、金手指、动机（表面追求 / 终极渴望 / 潜意识恐惧）；背景、缺陷、弧光、代表台词照样拆，不显示
 */
export type HeroDetailKey = 'intro' | 'profile' | 'background' | 'ability' | 'goal' | 'desire' | 'fear' | 'flaw' | 'arc' | 'quotes'

/** 拆解板块二：对标剧人物；主角拆简介、身份、金手指、动机，其余人物拆在这部剧里的作用和定位（11/4 第五轮标注）；性格、事件照样拆，不显示 */
export interface BenchmarkCharacter extends Partial<Record<HeroDetailKey, string>> {
  name: string
  /** 定位：主角 / 感情线核心 / 反派 / 配角 · 盟友 */
  role: string
  /** 配角在这部剧里的作用（旧数据没有） */
  purpose?: string
  personality: string
  /** 角色事件；主角按冲突主线分段写 */
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
  /** 仿写：这一段对应对标剧冲突主线的第几段（0 起）；-1 为我们新加的段、不对位；不写时按默认规则对（段数相同一一对，不同按内容配）（旧数据没有） */
  bench?: number
}

/** 逐句细拆的一句（或连着的一段）：原文、这时的情绪；turn 表示这一句带来情绪转折，也就是核心台词 */
export interface LineBeat {
  /** 原文：「说话人：台词」或「△ 动作」 */
  text: string
  /** 这一句时观众的情绪，如：期待、屈辱 */
  emotion: string
  turn: boolean
}

/** 细拆的一场：只拆第 1 集和一卡（第一个付费卡点）之间的几集；首集和付费卡点集改拆五个维度（11/6） */
export interface SceneBeat {
  /** 场次与地点：1-1 议事厅 */
  scene: string
  /** 关键动作 / 画面：这一场通过什么表现了什么 */
  action: string
  /** 逐句 / 逐段（11/4 标注）：情绪在哪里转、哪句台词带来转折；这一场的情绪转折和核心台词都从这里读 */
  lines: LineBeat[]
}

/** 首集和付费卡点集拆的五个维度（11/6），按这个顺序：情绪、节奏、信息差、期待感、爽点 */
export type EpisodeDimKey = 'emotion' | 'rhythm' | 'gap' | 'expect' | 'thrill'

/** 五个维度各一段话，都要落到具体的一句台词、一个动作或一个表情（台词用“”，动作、表情用【】引原文） */
export type EpisodeDims = Record<EpisodeDimKey, string>

/**
 * 拆解「冲突主线 · 内容简介」里的一集：页面上只有集纲、首集和付费卡点集的五个维度、一卡前几集的逐场细拆。
 * 其余是 AI 拆解时一并产出的系统字段，页面不显示、不编辑：节奏曲线对比、集纲对位、审稿查照抄和结构偏离时用。
 */
export interface EpisodeBreakdown {
  ep: number
  /** 本集集纲：一段话，哪部分剧情、通过什么、表现了什么 */
  flow: string
  /** 细拆：第 1 集和一卡之间的几集逐场、逐句拆到情绪转折和核心台词；首集、付费卡点集和其余集为空 */
  scenes: SceneBeat[]
  /**
   * 五个维度（11/6）：只有第 1 集和付费卡点集（一卡和之后的每个付费卡点）有。
   * 原来首集的前 3 秒 / 前 30 秒并进节奏（开局切入方式），付费卡点集的卡点并进节奏（卡在哪）和期待感（留下的钩子）
   */
  dims?: EpisodeDims
  /** 系统字段：开场钩子（类型：内容） */
  openHook: string
  /** 系统字段：本集一句话事件（审稿查照抄用） */
  event: string
  /** 系统字段：冲突强度 1–5 */
  conflict: number
  /** 系统字段：伏笔埋设 */
  plant: string
  /** 系统字段：伏笔回收 */
  payoff: string
  /** 系统字段：结尾钩子（类型：内容） */
  endHook: string
  /** 系统字段：是否付费卡点 */
  paywall: boolean
  /** 系统字段：情绪强度 1–5 */
  emotion: number
}

/** 审核板块：故事梗概、冲突主线 · 内容简介（11/4 合并成一块）、人物设定 */
export type BreakdownBlock = 'synopsis' | 'mainline' | 'characters'

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

/** 故事架构里单独生成的一项 */
export type ArchItem =
  | 'logline'
  | 'plan'
  | 'innovations'
  | 'goldenFinger'
  | 'heroSetup'
  | 'world'
  | 'background'
  | 'highlights'
  | 'factions'
  | 'formula'
  | 'mainLine'
  | 'rhythm'
  | 'writingRules'
  | 'references'

/** AI 生成结果里一句话的来源：原文（编剧写明的）/ 推断（从依据里推出来的）/ 补充（依据里没有，用题材常识补的） */
export type MarkSource = 'given' | 'inferred' | 'filled'

export interface ArchMark {
  /** 生成结果里的一行（或一句） */
  text: string
  src: MarkSource
  /** 从哪一项来：核心设定 / 金手指 / 核心卖点 / 题材常识 …… */
  from: string
}

/** 生成依据指纹：依据名 → 当时内容的指纹 */
export type BasisPrint = Record<string, string>

export interface Architecture {
  /** 原创的整体框架（开局、转折、结局）：11/4 第五轮从页面上删掉，生成不再读（开局、结局改按故事背景）；字段留着，旧数据不动。仿写不用（11/3 去掉改写方案；11/5 改写想法也删掉，编剧的想法直接写进核心设定） */
  plan: string
  /** 爽点公式：每 X 集一次什么爽感（11/4 页面上删掉，生成不再读；字段留着，旧数据不动） */
  formula: string
  /** 冲突主线各段（默认五段，可增删）；段落名可改 */
  mainLine: PlotBeat[]
  /** 冲突主线每段的结束集（按记录时的总集数）；null 表示按默认比例切分 */
  phaseEnds: number[] | null
  innovations: Innovation[]
  status: ReviewStatus
  /** 故事结构（11/4 页面上删掉，生成不再读；字段留着，旧数据不动） */
  structure: StoryStructure
  /** 叙事视角（同上） */
  viewpoint: string
  /** 世界观设定 */
  world: string
  /** 主要势力：主角阵营 / 敌对阵营各有谁（旧数据没有） */
  factions: string
  /** 故事背景：开场前发生了什么、主角被逼到什么处境（旧数据没有） */
  background: string
  /** 核心亮点（11/4 标注 #71，排在故事背景后面）：期待值（观众为什么追下去）和情绪（主打什么情绪、怎么起伏）（旧数据没有，升级时补空） */
  highlights: string
  /** 金手指 / 核心卖点 */
  goldenFinger: string
  /** 主角人设（一句话版，人物设定里再展开） */
  heroSetup: string
  /** 全局写作要求：每集写作都会带上 */
  writingRules: string
  /** 参考作品（11/4 页面上删掉，生成不再读；字段留着，旧数据不动） */
  references: string
  /** AI 生成时每行的来源：原文 / 推断 / 补充；编剧改过的行不再标（旧数据没有） */
  marks?: Partial<Record<ArchItem, ArchMark[]>>
  /** 主角人设拆到人物设定的时间：拆过后主角以人物设定为准，这里只读（旧数据没有） */
  heroSplitAt?: string
}

export type CharacterRole = '主角' | '暧昧对象' | '反派' | '配角'

export interface Character {
  id: string
  name: string
  nameEn: string
  /** 按哪类定位检查与写作；自定义定位也要归到这四类之一 */
  role: CharacterRole
  /** 自定义定位，如「女主闺蜜」「男主母亲」；填了就代替 role 显示 */
  roleLabel?: string
  gender: string
  age: string
  /** 身份：外在标签 */
  profile: string
  /** 外形：身高身材、长相、发型、眼神、标志性细节 */
  appearance: string
  /** 服装：可按阶段写，如「战甲（1–51 集）：…」 */
  costume: string
  /** 外形参考：参考演员、参考图或对美术的要求 */
  lookRef: string
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

export type HookType = '悬念' | '反转' | '情绪高点' | '新秘密' | '付费卡点'

/** 情节大纲：全剧总览 + 冲突主线各阶段总览 */
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

/** 人物在某一场的服化道：拆资产用（哪一场进来、穿什么、什么妆造） */
export interface CastLook {
  name: string
  /** 场景地点，对应场景标题里的地点 */
  scene: string
  /** 服化道重点：服装、妆发、道具 */
  look: string
}

/** 逐集蓝图：写作前的预览设定 */
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
  /** 承接：本集开头接住什么；不写时默认接上集结尾的钩子（旧数据没有） */
  carry?: string
  /** 末尾悬念钩子 */
  hook: string
  /** 人物本集状态：每个人在哪一场进来、服化道重点（旧数据没有） */
  looks?: CastLook[]
  /** 作者微操指导 */
  guidance: string
  /** 集要点：定稿后自动提炼 */
  points: string
}

export type ScriptLineKind = 'scene' | 'action' | 'dialogue' | 'hook'

/** 台词的声音：os 内心独白（写作「余霍os：」）、ov 画外音（写作「母亲（ov）：」，人不在场） */
export type ScriptVoice = 'os' | 'ov'

export interface ScriptLine {
  id: string
  kind: ScriptLineKind
  speaker?: string
  speakerEn?: string
  /** 只用于台词；不写为正常对白 */
  voice?: ScriptVoice
  /** 场景标题只存「日，外，地点」，场次号与人物行在展示 / 导出时自动生成 */
  zh: string
  /** 英文台词；中文改动后清空，等待重新翻译 */
  en?: string
  /** 段落对齐；不写为左对齐。正文里的 **加粗** / *斜体* 直接以 Markdown 记在 zh 里 */
  align?: 'center' | 'right'
}

/** 草稿状态：草稿 / 已修稿（被新版本取代）/ 已定稿 */
export type DraftStatus = 'draft' | 'revised' | 'final'

/** 审稿意见的类别：AI 修稿按它逐条处理；旧报告没有，修稿时按自检处理 */
export type ReviewCode =
  | 'short'
  | 'long'
  | 'scene'
  | 'hook'
  | 'carry'
  | 'hero'
  | 'unknown'
  | 'absent'
  | 'state'
  | 'filler'
  | 'longLine'
  | 'notes'
  | 'rule'
  | 'voice'
  | 'event'
  | 'drift'
  | 'benchName'
  | 'benchLine'
  | 'benchEvent'
  | 'benchShape'

/** 审稿意见对照的依据：核心设定 / 人物设定 / 状态库 / 集纲 / 蓝图 / 格式与篇幅 / 文风 / 对标剧拆解（只有仿写）；写作也按这几项写 */
export type ReviewBasis = 'core' | 'character' | 'state' | 'outline' | 'blueprint' | 'format' | 'style' | 'bench'

/** 意见在修稿后的走向：new 新发现 / still 修稿后仍在 / stuck 两轮没改掉 / back 改好又出现 / fixed 已改掉；stuck 与 back 不再交给 AI 修稿 */
export type ReviewItemStatus = 'new' | 'still' | 'stuck' | 'back' | 'fixed'

export interface ReviewItem {
  level: 'block' | 'warn' | 'info' | 'ok'
  text: string
  code?: ReviewCode
  /** 依据哪一项设定；没有依据的意见只算建议 */
  basis?: ReviewBasis
  /** 依据原文：设定里的那句话 */
  ref?: string
  /** 正文里出问题的那一行 */
  lineId?: string
  quote?: string
  /** 同一个问题在各轮审稿里的标识：跟踪改没改掉、有没有反复 */
  key?: string
  /** 修稿后的复审里才有 */
  status?: ReviewItemStatus
}

/** AI 审稿报告 */
export interface DraftReview {
  id: string
  at: string
  score: number
  items: ReviewItem[]
  /** 审稿时正文的指纹：正文没改动就不重复审稿 */
  sig?: string
  /** 审稿用的模型 */
  model?: ModelId
  /** recheck：修稿后的复审，只查上一轮意见改没改掉、改过的段落有没有新问题；full（或不写）：全量审稿 */
  kind?: 'full' | 'recheck'
  /** 对照的上一轮审稿（来源草稿上、修稿依据的那一份） */
  baseId?: string
}

/** 编剧决定保留不改的审稿意见：之后的审稿不再提，严重问题要写理由 */
export interface ReviewKeep {
  ep: number
  key: string
  text: string
  level: ReviewItem['level']
  reason?: string
  at: string
}

/** 写作时用到的依据：和审稿同一份清单 */
export interface WriteBasisItem {
  basis: ReviewBasis
  text: string
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
  /** 写出（或修出）这一版的模型 */
  model?: ModelId
  /** 编剧自己写的这一版，没用 AI（11/5 标注 #91；旧草稿没有） */
  manual?: boolean
  /** AI 写这一版时对照的依据（旧草稿没有） */
  basis?: WriteBasisItem[]
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
  /** 换场时的场景标题：日，外，地点 */
  scene?: string
  /** 画面与动作 */
  action: string
  speaker?: string
  /** 内心独白（os）/ 画外音（ov）；不填为对白 */
  voice?: ScriptVoice
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
  /** 解析这一集的视频模型 */
  model?: ModelId
  /** 校对时改过转写稿的时间：晚于合并时间就要重新合并 */
  editedAt?: string
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
  /** 用 AI 修稿处理掉的问题（同时记在 resolved 里）；重新质检时还在的会重新列出 */
  fixed?: string[]
  /** 质检用的模型 */
  model?: ModelId
}

/** 项目在各创作环节的产出 */
export interface ProjectWork {
  video: VideoJob | null
  source: SourceScript | null
  breakdown: Breakdown | null
  architecture: Architecture | null
  characters: Character[]
  relations: Relation[]
  plot: Plot | null
  outline: OutlineEpisode[]
  blueprints: EpisodeBlueprint[]
  drafts: EpisodeDraft[]
  scripts: EpisodeScript[]
  qa: QaReport | null
  /** 编剧保留不改的审稿意见（旧数据没有） */
  keeps?: ReviewKeep[]
  /** 生成依据指纹：每份 AI 产物（故事架构各项、人物设定、全剧总览、阶段总览）生成时用到的依据；上游改了就提示「依据已改」，不自动重写（旧数据没有） */
  prints?: Record<string, BasisPrint>
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
  /** 类型：都市 / 玄幻 …（11/4 页面上删掉，生成不再读；字段留着，旧数据不动，新项目没有） */
  category?: string
  /** 题材类型（11/4 起选项取自 StoryPlay，跟着目标市场走；之前叫题材元素） */
  genres: string[]
  /** 目标受众：故事架构里必选；11/4 标注 #85 起新项目先空着（''），旧项目原值不动 */
  audience: Audience | ''
  /** 风格元素：风格 + 元素（11/4 起；之前叫风格基调） */
  tones: string[]
  markets: string[]
  platforms: string[]
  spec: ScriptSpec
  rhythm: RhythmFrame
  benchmark: Benchmark | null
  /** 视频解析 / 文本两类模型，编剧在项目页头选；没选过的用默认 */
  models?: Partial<Record<ModelGroup, ModelId>>
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
export type ProjectDraft = Omit<Project, 'id' | 'status' | 'models' | 'createdAt' | 'updatedAt' | 'activity' | 'sample' | 'work'>
