/**
 * AI 服务层。
 *
 * Demo 阶段使用本地模拟（services/mock），接口形状与真实大模型调用保持一致：
 * 全部是可取消的异步函数，输入项目快照，输出结构化结果。接入后端后只需替换实现，页面代码不用改。
 */
import type {
  Audience,
  Breakdown,
  Foreshadow,
  EpisodeBlueprint,
  EpisodeScript,
  MergedScript,
  ModelId,
  OutlineEpisode,
  Plot,
  PlotBeat,
  Project,
  ProofItem,
  QaIssue,
  QaReport,
  ScriptLine,
  ScriptLineKind,
  Shot,
  SourceScript,
  TranscribeStatus,
  VideoEpisode,
  VideoJob,
} from '../domain/types'
import { PLAN_EVENT_META } from '../domain/constants'
import { modelOf } from '../domain/models'
import { eventCandidates, foreshadowName, plainText } from '../domain/work'
import type { EventCandidate } from '../domain/work'
import { analyzeSource } from './mock/breakdown'
import * as proof from './mock/proofread'
import * as qa from './mock/qa'
import * as video from './mock/video'
import * as writer from './mock/writer'
import type { ArchitectureDraft, ArchitectureSection, Direction, DraftContent, ExtendMode, ForeshadowIdea, IdeaReview, QaFix, ReviewBase, ReviseMode } from './mock/writer'

export { parseSource } from './mock/breakdown'
export { SAMPLE_SCRIPT, SAMPLE_SCRIPT_NAME } from './mock/sampleScript'
export { DEMO_SHOW, episodesFromFiles, isOffTemplate, linkError, platformOf } from './mock/video'
export { applyProofread } from './mock/proofread'
export { architectureIssues, positionOf, viewpointRule } from './mock/writer'
export { innovationLanding } from './mock/qa'
export type { InnovationLanding } from './mock/qa'
export type { ArchitectureDraft, ArchitectureSection, Direction, DraftContent, ExtendMode, ForeshadowIdea, IdeaReview, QaFix, ReviewBase, ReviseMode }

export interface LoglineRequest {
  idea: string
  genres: string[]
  audience: Audience
  tones: string[]
}

export interface LoglineCandidate {
  id: string
  /** 一句话高概念：主角是谁 + 核心困境 + 反常规设定 */
  logline: string
  /** 爽点公式：每 X 集一次什么爽感 */
  formula: string
  /** 反常规点 */
  twist: string
}

export const AI_MODE: 'mock' | 'live' = 'mock'

/*
 * 模型路由：项目页头选两类模型——视频解析只用于逐集转写，其余文本环节（拆解、策划、写作、审稿、质检、翻译）都用文本模型，写作可临时换一个。
 * 逐集转写、写作、审稿、修稿与质检把用到的模型记在分镜、草稿与报告上。
 * 模拟模式下模型只做记录，生成内容不随模型变化；接真实接口时在这里按模型分发。
 */

interface GenreSeed {
  hero: string
  dilemma: string
  twist: string
  formula: string
}

const SEEDS: Record<string, GenreSeed[]> = {
  重生: [
    { hero: '带着前世记忆回到婚礼前夜的新娘', dilemma: '必须在 30 天内揭穿害死她的人', twist: '丈夫也是重生的，两人互相算计', formula: '每 3 集一次“预知反杀”' },
    { hero: '重生回十八岁的落魄千金', dilemma: '要在家族破产前夺回公司', twist: '前世仇人这一世成了她唯一的盟友', formula: '每 4 集一次商战打脸' },
  ],
  复仇: [
    { hero: '被闺蜜顶替身份的女孩', dilemma: '以保姆身份潜回自己的家', twist: '仇人的儿子认出了她却选择沉默', formula: '每 3 集一次身份差打脸' },
  ],
  霸总: [
    { hero: '被迫签下一年契约的实习生', dilemma: '契约到期前不能爱上冷面总裁', twist: '总裁才是那个先违约的人', formula: '每 2 集一次心动反转' },
  ],
  狼人: [
    { hero: '被狼王当众拒绝的“废柴”伴侣', dilemma: '三年后必须回到族群赢下继承试炼', twist: '她是失落王族最后的血脉', formula: '每 3 集一次“看不起她的人被打脸”' },
  ],
  马甲: [
    { hero: '被嘲“乡下土包子”的真千金', dilemma: '回到豪门处处被假千金针对', twist: '她是神医、黑客、赛车手三重马甲', formula: '每 2 集掉一个马甲' },
  ],
  替嫁: [
    { hero: '替姐姐嫁给“残废”大佬的妹妹', dilemma: '新婚夜就被要求离婚', twist: '大佬根本没残，而她也不是普通人', formula: '每 3 集一次双向掉马' },
  ],
  闪婚: [
    { hero: '与陌生人闪婚的单亲妈妈', dilemma: '为了孩子的户口必须假戏真做', twist: '闪婚对象是孩子亲生父亲', formula: '每 3 集一次身份暗示' },
  ],
  隐藏身份: [
    { hero: '在豪门当了三年上门女婿的男人', dilemma: '岳家要他净身出户', twist: '他是隐退的全球首富继承人', formula: '每 2 集一次身份碾压' },
  ],
  萌宝: [
    { hero: '带着天才萌宝回国的设计师', dilemma: '必须躲开五年前那一夜的男人', twist: '萌宝主动帮妈妈“相亲”亲爹', formula: '每 3 集一次萌宝助攻' },
  ],
  黑帮: [
    { hero: '误闯黑手党婚礼的护士', dilemma: '被迫成为教父的“临时新娘”', twist: '她的父亲正是教父追查多年的仇人', formula: '每 3 集一次立场反转' },
  ],
  真假千金: [
    { hero: '被抱错二十年的真千金', dilemma: '回到豪门却被全家偏爱的假千金处处设局', twist: '她早就知道真相，回来只为查清当年是谁调的包', formula: '每 2 集一次真假身份对决' },
  ],
  穿越: [
    { hero: '误入古代王朝的现代农民', dilemma: '要靠一口鱼塘给两个时空运物资', twist: '古代人把他当成了神仙', formula: '每 3 集一次现代物资降维打击' },
  ],
  神豪: [
    { hero: '刚被女友甩掉的外卖员', dilemma: '突然继承千亿家产，却必须隐瞒一年', twist: '嫌贫爱富的前女友正是遗嘱的见证人', formula: '每 2 集一次花钱打脸' },
  ],
  赘婿: [
    { hero: '入赘三年被全家当佣人使唤的女婿', dilemma: '妻子家族濒临破产，岳母逼他离婚让位', twist: '让家族起死回生的神秘投资人就是他自己', formula: '每 2 集一次赘婿翻身打脸' },
  ],
  战神: [
    { hero: '隐退五年回乡的北境战神', dilemma: '回家发现妻女被恶霸欺凌，却不能暴露身份', twist: '欺负她们的恶霸背后，是当年出卖他的战友', formula: '每 3 集一次身份压制' },
  ],
  神医: [
    { hero: '被逐出师门的天才神医', dilemma: '在豪门当私人医生，却被诬陷治死病人', twist: '“病死”的老爷子是装的，就为考验他', formula: '每 2 集一次医术打脸' },
  ],
  追妻火葬场: [
    { hero: '离婚当天才知道真相的冷血总裁', dilemma: '前妻已经带着孩子开始新生活', twist: '当年逼走她的“证据”是他母亲伪造的', formula: '每 3 集一次追妻受挫' },
  ],
  吸血鬼: [
    { hero: '被吸血鬼亲王误标记的人类女孩', dilemma: '必须假扮他的血契新娘才能活过满月', twist: '她体内流着猎人家族的血', formula: '每 3 集一次身份危机' },
  ],
  契约婚姻: [
    { hero: '为救弟弟签下婚约的落魄千金', dilemma: '契约期内要在豪门婆家面前扮恩爱', twist: '契约丈夫早在十年前就认识她', formula: '每 2 集一次假戏真做' },
  ],
}

const FALLBACK: GenreSeed[] = [
  { hero: '被所有人看不起的普通人', dilemma: '必须在一场赌局中赢回尊严', twist: '赌局本身就是为他设计的局', formula: '每 3 集一次逆袭打脸' },
  { hero: '失去一切的继承人', dilemma: '隐姓埋名回到对手身边', twist: '对手早就知道他是谁', formula: '每 4 集一次身份反转' },
]

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    })
  })

/** 根据一句话灵感 + 题材生成 3 个高概念候选（对应需求文档第三步“定高概念”） */
export async function generateLoglines(req: LoglineRequest, signal?: AbortSignal): Promise<LoglineCandidate[]> {
  await sleep(900 + Math.random() * 600, signal)

  const pool = req.genres.flatMap((g) => SEEDS[g] ?? [])
  const seeds = [...pool, ...FALLBACK]
  const shuffled = seeds.sort(() => Math.random() - 0.5).slice(0, 3)
  const idea = req.idea.trim().replace(/[。.!！]+$/, '')

  return shuffled.map((seed, i) => {
    const lead = i === 0 && idea ? idea : seed.hero
    return {
      id: `${Date.now()}-${i}`,
      logline: `${lead}，${seed.dilemma}——却发现${seed.twist}。`,
      formula: seed.formula,
      twist: seed.twist,
    }
  })
}

/** 题材 → 海外短剧常见的英文片名套路 */
const GENRE_TITLES: Record<string, string[]> = {
  重生: ['Reborn to Reclaim It All', 'The Second-Chance Bride'],
  复仇: ['Her Sweet Revenge', 'The Payback Bride'],
  霸总: ['The CEO’s Contract Wife', 'Falling for the Cold CEO'],
  狼人: ['Rejected by the Alpha', 'The Alpha’s Lost Luna'],
  马甲: ['Her Hidden Identities', 'Don’t Mess with the Real Heiress'],
  替嫁: ['The Substitute Bride', 'Married in Her Sister’s Place'],
  闪婚: ['Married to a Stranger', 'The Flash Marriage Deal'],
  契约婚姻: ['The Contract Marriage', 'Signed, Sealed, Married'],
  隐藏身份: ['The Hidden Heir', 'The Secret Billionaire'],
  豪门: ['The Billionaire’s Second-Chance Bride', 'The Heiress Returns'],
  萌宝: ['Mommy, Daddy Wants You Back', 'The Genius Baby’s Matchmaking'],
  逆袭: ['From Nobody to Legend', 'Rise of the Underdog'],
  战神: ['Return of the War God', 'The Dragon King Returns'],
  先婚后爱: ['Married First, Love Later', 'Love After the Vows'],
  追妻火葬场: ['Too Late to Love Me', 'Begging for Her Forgiveness'],
  黑帮: ['The Mafia Boss’s Bride', 'Bound to the Don'],
  神豪: ['The Secret Billionaire Next Door', 'Broke Today, Billionaire Tomorrow'],
  赘婿: ['The Son-in-Law Strikes Back', 'Don’t Underestimate the Son-in-Law'],
  龙族: ['The Dragon King’s Bride', 'Return of the Dragon Heir'],
  大女主: ['The Queen Bows to No One', 'She Rules Alone'],
  真假千金: ['The Real Heiress Returns', 'Swapped at Birth'],
  年上年下: ['Too Young to Be My Husband', 'Love Knows No Age'],
  破镜重圆: ['Back to My Ex-Husband', 'Second Chance at Forever'],
  离婚后爱: ['Love After Divorce', 'Remarry Me, Mr. CEO'],
  冤家变恋人: ['From Rivals to Lovers', 'My Nemesis, My Husband'],
  三角恋: ['Between Two Billionaires', 'Torn Between Brothers'],
  禁忌之恋: ['Forbidden Desire', 'My Stepbrother’s Secret'],
  强制爱: ['Caged by the CEO', 'You Belong to Me'],
  一夜情: ['One Night with the Billionaire', 'The Morning After'],
  灵魂互换: ['Swapped Souls', 'In My Husband’s Body'],
  穿越: ['Time Traveler’s Empire', 'Lost in the Dynasty'],
  强者回归: ['The King Returns', 'Return of the Legend'],
  团宠: ['Everyone’s Little Princess', 'Spoiled by Seven Brothers'],
  超能力: ['Awakened', 'The Hidden Power Within'],
  系统: ['The Billionaire System', 'Level Up, Husband'],
  读心: ['I Can Hear Your Heart', 'Reading the Billionaire’s Mind'],
  失忆: ['The Wife He Forgot', 'Remember Me, Darling'],
  商战: ['The Boardroom Queen', 'War of Empires'],
  吸血鬼: ['The Vampire King’s Bride', 'Bitten by Destiny'],
  灰姑娘: ['Cinderella’s Revenge', 'The Billionaire’s Cinderella'],
  神医: ['The Miracle Doctor', 'The Divine Healer Returns'],
  宫斗: ['The Empress’s Revenge', 'Rise of the Concubine'],
}

const FALLBACK_TITLES = ['Fate Rewritten', 'The Comeback Queen', 'Hearts at War']

/** 英文剧名：优先取剧名里出现的题材词，其次按已选题材；同一剧名结果固定 */
export async function translateTitle(title: string, genres: string[], signal?: AbortSignal): Promise<string> {
  await sleep(500 + Math.random() * 400, signal)
  const text = title.trim()
  const inTitle = Object.keys(GENRE_TITLES).filter((g) => text.includes(g))
  const pool = [...new Set([...inTitle, ...genres].flatMap((g) => GENRE_TITLES[g] ?? []))]
  const list = pool.length ? pool : FALLBACK_TITLES
  const code = [...text].reduce((n, ch) => n + ch.charCodeAt(0), 0)
  return list[code % list.length]
}

export const SAMPLE_IDEAS = [
  '被丈夫和闺蜜联手害死的女主重生回到婚礼前夜',
  '被狼王当众拒绝的女孩，三年后带着隐藏血脉归来',
  '替姐姐嫁给传闻中残废的财阀继承人',
  '上门女婿被岳家逼离婚，当天恢复了首富身份',
]

/* ------------------------------ 第二阶段：仿写与解析 ------------------------------ */

/** 模拟模型思考耗时 */
const think = (signal: AbortSignal | undefined, base = 800) => sleep(base + Math.random() * 500, signal)

/** “重新生成 / 换一批”用的新种子 */
export const nextSeed = () => Math.floor(Math.random() * 1e9)

export const ANALYZE_STEPS = ['按分集切分剧本', '梳理故事梗概', '识别人物与关系网', '提取冲突主线与节奏', '逐集拆解 12 个字段'] as const

/** 对标剧拆解：逐步回报进度，返回四大板块（全部待审核） */
export async function analyzeBenchmark(source: SourceScript, onStep: (index: number) => void, signal?: AbortSignal): Promise<Breakdown> {
  for (let i = 0; i < ANALYZE_STEPS.length; i++) {
    onStep(i)
    await sleep(500 + Math.random() * 300, signal)
  }
  return analyzeSource(source)
}

/** 没有改写想法时：基于拆解结果（或立项设定）提出 3 个方向 */
export async function proposeDirections(project: Project, seed: number, signal?: AbortSignal): Promise<Direction[]> {
  await think(signal)
  return writer.proposeDirections(project, seed)
}

/** 有改写想法时：评估可行性并整理成改写方案 */
export async function evaluateIdea(project: Project, idea: string, signal?: AbortSignal): Promise<IdeaReview> {
  await think(signal)
  return writer.evaluateIdea(project, idea)
}

export async function draftArchitecture(project: Project, seed: number, signal?: AbortSignal): Promise<ArchitectureDraft> {
  await think(signal, 1100)
  return writer.draftArchitecture(project, seed)
}

/** 只重写冲突主线：保留段落名与分段 */
export async function draftMainLine(project: Project, seed: number, signal?: AbortSignal): Promise<PlotBeat[]> {
  await think(signal, 800)
  return writer.draftMainLine(project, seed)
}

/** 故事架构里单独一段：世界观 / 金手指 / 主角人设 / 全局写作要求 */
export async function draftSection(project: Project, section: ArchitectureSection, signal?: AbortSignal): Promise<string> {
  await think(signal, 700)
  return writer.draftSection(project, section)
}

export async function draftCharacters(project: Project, seed: number, signal?: AbortSignal) {
  await think(signal, 1100)
  return writer.draftCharacters(project, seed)
}

export async function draftForeshadows(project: Project, signal?: AbortSignal): Promise<ForeshadowIdea[]> {
  await think(signal)
  return writer.draftForeshadows(project)
}

export interface EventFinding extends EventCandidate {
  foreshadowId: string
  reason: string
}

/**
 * AI 识别定稿事件：在定稿正文里找计划的推进，给出逐字原文与理由。只是建议，编剧确认后才记为已发生。
 * 传 ep 时只看这一集定稿。
 */
export async function identifyEvents(project: Project, list: Foreshadow[], ep?: number, signal?: AbortSignal): Promise<EventFinding[]> {
  await think(signal, 900)
  const finals = project.work.scripts.filter((s) => s.ep <= project.spec.totalEpisodes && (ep === undefined || s.ep === ep))
  return list.flatMap((f) =>
    eventCandidates(f, finals).map((c) => {
      const name = foreshadowName(f)
      const reason =
        c.kind === 'plant' ? `第 ${c.ep} 集首次写到与「${name}」相关的细节，对应计划的${PLAN_EVENT_META.plant.label}`
        : c.kind === 'payoff' ? `已到计划的第 ${f.payoffEp} 集，这句正文把「${name}」交代清楚，可视为${PLAN_EVENT_META.payoff.label}`
        : `第 ${c.ep} 集再次提到「${name}」，让这条${f.type}保持在观众视线里`
      return { ...c, text: plainText(c.text), foreshadowId: f.id, reason }
    }),
  )
}

/** 情节大纲：全剧总览 + 五段式各段粗纲 */
export async function draftPlot(project: Project, signal?: AbortSignal): Promise<Plot> {
  await think(signal, 900)
  return writer.draftPlot(project)
}

/** 分集集纲一批（默认 10 集）；seed 为 0 时与相邻批次衔接，重新生成时换种子 */
export async function draftOutline(project: Project, from: number, to: number, seed: number, signal?: AbortSignal): Promise<OutlineEpisode[]> {
  await think(signal, 700 + (to - from) * 80)
  return writer.draftOutline(project, from, to, seed)
}

/** 分集蓝图：按集纲展开成写作前的预览设定 */
export async function draftBlueprints(project: Project, from: number, to: number, seed: number, signal?: AbortSignal): Promise<EpisodeBlueprint[]> {
  await think(signal, 600 + (to - from) * 40)
  return writer.draftBlueprints(project, from, to, seed)
}

/** 逐集剧本：输入 = 本集蓝图（含作者微操指导）+ 最新状态库（人物、伏笔与前集正文） */
export async function writeEpisode(project: Project, ep: number, seed: number, signal?: AbortSignal, model = modelOf(project, 'text')): Promise<DraftContent & { model: ModelId }> {
  await think(signal, 1400)
  return { ...writer.writeEpisode(project, ep, seed), model }
}

/** AI 审稿：返回一份审查报告；opts.base 是修稿依据的那份审稿，有它时做复审；model 不传用项目的文本模型 */
export async function reviewDraft(project: Project, draft: Parameters<typeof writer.reviewDraft>[1], opts?: Parameters<typeof writer.reviewDraft>[2], signal?: AbortSignal, model = modelOf(project, 'text')) {
  await think(signal, 900)
  return { ...writer.reviewDraft(project, draft, opts), model }
}

/** AI 修稿：按审稿意见逐条改（没审稿时按自检），标注过的行按标注改写；生成新版本 */
export async function reviseDraft(project: Project, draft: Parameters<typeof writer.reviseDraft>[1], seed: number, review?: Parameters<typeof writer.reviseDraft>[3], signal?: AbortSignal) {
  await think(signal, 1300)
  return { ...writer.reviseDraft(project, draft, seed, review), model: modelOf(project, 'text') }
}

/** 定稿后提炼集要点 */
export const extractPoints = writer.extractPoints

/** 选中一句改写 / 扩写 / 润色 */
export async function reviseText(project: Project, text: string, mode: ReviseMode, kind: ScriptLineKind, seed: number, signal?: AbortSignal) {
  await think(signal, 500)
  return writer.reviseText(project, text, mode, kind, seed)
}

/** 选中一句续写 / 补对话：返回插在其后的新行 */
export async function extendText(project: Project, line: ScriptLine, mode: ExtendMode, seed: number, signal?: AbortSignal): Promise<ScriptLine[]> {
  await think(signal, 600)
  return writer.extendText(project, line, mode, seed)
}

/** 一键翻译台词；missing 为本地无法翻译、需接入模型的句数 */
export async function translateEpisode(project: Project, lines: ScriptLine[], signal?: AbortSignal) {
  await think(signal, 900)
  return writer.translateLines(project, lines)
}

/* ---------------------------------- 质检交付 ---------------------------------- */

export const QA_STEPS = ['一致性终检', '节奏曲线对比', '付费点专项', '创新点落地', '格式合规'] as const

/** 质检里的 AI 修稿：按一条问题改定稿，补写只取已有设定，不合设定的改动留给编剧；返回预览，确认后才写进正文 */
export async function fixQaIssue(project: Project, script: EpisodeScript, issue: QaIssue, seed: number, signal?: AbortSignal): Promise<QaFix & { model: ModelId }> {
  await think(signal, 1000)
  return { ...writer.fixQaIssue(project, script, issue, seed), model: modelOf(project, 'text') }
}

/** 质检：对全部正文章节跑七项检查；resolved 由页面合并保留 */
export async function runQa(project: Project, signal?: AbortSignal): Promise<Omit<QaReport, 'resolved'>> {
  await think(signal, 1400)
  return { at: new Date().toISOString(), ...qa.runQa(project), model: modelOf(project, 'text') }
}

/* ------------------------------ 第三阶段：视频转剧本 ------------------------------ */

export const RESOLVE_STEPS = ['读取剧集页', '获取分集列表（含付费集）', '校验下载权限'] as const

/** 解析对标剧链接，返回全集列表 */
export async function resolveVideoLink(url: string, onStep: (index: number) => void, signal?: AbortSignal) {
  for (let i = 0; i < RESOLVE_STEPS.length; i++) {
    onStep(i)
    await sleep(450 + Math.random() * 300, signal)
  }
  return video.resolveLink(url)
}

export class TranscribeError extends Error {
  name = 'TranscribeError'
}

/** 单集各步骤的模拟耗时（毫秒） */
const PHASE_MS: [Exclude<TranscribeStatus, 'queued' | 'done' | 'failed'>, number][] = [
  ['downloading', 900],
  ['compressing', 600],
  ['transcribing', 1800],
]

/**
 * 单集转写：下载 → 压缩 → 交给能直接读视频的多模态模型（model：项目的视频解析模型），按固定格式逐镜头转写。
 * onProgress 回报当前步骤与百分比；失败抛出 TranscribeError。演示版转写内容不随模型变化。
 */
export async function transcribeEpisode(
  job: VideoJob,
  ep: VideoEpisode,
  onProgress: (status: TranscribeStatus, percent: number) => void,
  signal?: AbortSignal,
  // 接入真实接口时按模型分发；模拟数据用不到
  _model?: ModelId,
): Promise<Shot[]> {
  const fail = video.failureOf(job, ep)
  const ticks = 10
  for (const [status, ms] of PHASE_MS) {
    const total = ms * (0.8 + Math.random() * 0.4)
    for (let i = 0; i <= ticks; i++) {
      onProgress(status, Math.round((i / ticks) * 100))
      if (fail?.status === status && i === 6) throw new TranscribeError(fail.error)
      if (i < ticks) await sleep(total / ticks, signal)
    }
  }
  return video.transcribe(ep.ep, video.offTemplateOf(job, ep))
}

export const MERGE_STEPS = ['按集数排序拼接', '接回被镜头切开的台词', '统一标点与场景格式', '去掉时间码，输出标准剧本'] as const

export const PROOF_STEPS = ['逐集核对是否按模板输出', '统一人物名字的写法', '查同音错别字'] as const

/**
 * AI 校对合并好的剧本（项目的文本模型）：查出没按模板输出的集、人名写法不一、同音错别字，
 * 只列出改法，编剧勾选确认后才用 applyProofread 写进剧本。
 */
export async function proofreadScript(project: Project, text: string, onStep: (index: number) => void, signal?: AbortSignal): Promise<{ items: ProofItem[]; model: ModelId }> {
  for (let i = 0; i < PROOF_STEPS.length; i++) {
    onStep(i)
    await sleep(400 + Math.random() * 300, signal)
  }
  return { items: proof.proofread(text), model: modelOf(project, 'text') }
}

/** 合并全集转写稿，并自动修正格式 */
export async function mergeTranscripts(episodes: VideoEpisode[], onStep: (index: number) => void, signal?: AbortSignal): Promise<MergedScript> {
  for (let i = 0; i < MERGE_STEPS.length; i++) {
    onStep(i)
    await sleep(350 + Math.random() * 250, signal)
  }
  return { ...video.mergeEpisodes(episodes), mergedAt: new Date().toISOString(), importedAt: null }
}
