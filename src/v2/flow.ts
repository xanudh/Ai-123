/**
 * 版本二：把散在各环节的状态汇总成「环节进度 / 单集流程 / 待办 / 下一步」。
 * 只读计算，不新增数据——版本一与版本二用的是同一份项目数据。
 */
import { MODE_STAGES, STAGES } from '../domain/pipeline'
import { overallSnapshot } from '../domain/snapshot'
import type { EpisodeDraft, Project, StageKey } from '../domain/types'
import { blueprintOf, draftLabel, draftsOf, eventCandidates, finalCount, foreshadowName, outlineCount, pendingPaywalls, qaStale, scriptOf, stageGate, stageState } from '../domain/work'
import { MAX_REVISE_ROUNDS, draftPath, finalPath, linesSig, nextUnwritten, reviewCounts, reviseRounds, scriptStagePath } from '../pages/workspace/script/ops'

export const stageTo = (p: Project, key: StageKey) => (key === 'overview' ? `/projects/${p.id}` : `/projects/${p.id}/stage/${key}`)

/* ---------------------------------- 环节进度 ---------------------------------- */

/** 导航里环节名右侧的进度摘要；还没开始时为 null */
export function stageDetail(p: Project, key: StageKey): string | null {
  const w = p.work
  const total = p.spec.totalEpisodes
  switch (key) {
    case 'video': {
      const job = w.video
      if (!job) return null
      if (job.merged) return job.merged.importedAt ? '已送入拆解' : '待送入拆解'
      return `转写 ${job.episodes.filter((e) => e.status === 'done').length}/${job.episodes.length}`
    }
    case 'breakdown': {
      const bd = w.breakdown
      if (bd) return bd.referencedAt ? '已引用' : `审核 ${Object.values(bd.review).filter((r) => r === 'approved').length}/4`
      return w.source ? '待拆解' : null
    }
    case 'architecture':
      return w.architecture ? (w.architecture.status === 'approved' ? '已确认' : '草稿') : null
    case 'characters':
      return w.characters.length ? `${w.characters.length} 人` : null
    case 'outline': {
      const n = outlineCount(p)
      return n ? `${n}/${total}` : w.plot ? '有总览' : null
    }
    case 'foreshadow':
      return w.foreshadows.length ? `${w.foreshadows.length} 条` : null
    case 'script':
      return finalCount(p) || w.drafts.length ? `定稿 ${finalCount(p)}/${total}` : null
    case 'qa':
      return p.status === 'delivered' ? '已交付' : w.qa ? `${w.qa.score} 分` : null
    default:
      return null
  }
}

/** 项目整体进度：完成了几个环节（不含概览）、定稿几集 */
export function projectProgress(p: Project) {
  const stages = MODE_STAGES[p.mode].filter((k) => k !== 'overview')
  return {
    stages: stages.length,
    done: stages.filter((k) => stageState(p, k) === 'done').length,
    finals: finalCount(p),
    total: p.spec.totalEpisodes,
  }
}

/* ---------------------------------- 单集流程 ---------------------------------- */

export const EPISODE_STEPS = ['集纲', '蓝图', '草稿', '审稿', '定稿'] as const

export type StepState = 'done' | 'skipped' | 'current' | 'todo'

/**
 * 单集流水线：集纲 → 蓝图 → 草稿 → 审稿 → 定稿。走到的最远一步之后是当前步；
 * 之前没做的（如蓝图后来被清空）标为跳过，不冒充已完成。
 * 草稿写出来、还没审过时仍停在「草稿」这一步（还在改稿），审过才算草稿完成。
 */
export function episodeSteps(p: Project, ep: number): StepState[] {
  const w = p.work
  const final = !!scriptOf(w, ep)
  const latest = draftsOf(w, ep)[0]
  const reviewed = !!latest && latest.reviews.at(-1)?.sig === linesSig(latest)
  const outline = w.outline.some((o) => o.ep === ep)
  const blueprint = !!blueprintOf(w, ep)
  // 走到了哪一步 / 哪些步骤已经做完：草稿写了没审，算走到草稿、但没做完
  const reached = [outline, blueprint, !!latest || final, reviewed, final]
  const done = [outline, blueprint, (!!latest && reviewed) || final, reviewed, final]
  const far = reached.lastIndexOf(true)
  const open = far >= 0 && !done[far] ? far : far + 1
  return done.map((d, i) => (d ? 'done' : i === open ? 'current' : i < far ? 'skipped' : 'todo'))
}

export interface StepLink {
  to: string
  tip: string
}

/** 单集流程每一步对应的页面；还没做的步骤没有入口（写了一半的草稿有） */
export function episodeStepLinks(p: Project, ep: number): (StepLink | null)[] {
  const w = p.work
  const latest = draftsOf(w, ep)[0]
  const review = latest?.reviews.at(-1)
  const final = scriptOf(w, ep)
  return [
    w.outline.some((o) => o.ep === ep) ? { to: `${stageTo(p, 'outline')}?ep=${ep}`, tip: `去情节大纲看第 ${ep} 集集纲` } : null,
    blueprintOf(w, ep) ? { to: `${scriptStagePath(p)}?ep=${ep}`, tip: `去分集蓝图看第 ${ep} 集` } : null,
    latest ? { to: draftPath(p, latest.id), tip: `打开最新草稿 ${draftLabel(latest)}${draftsOf(w, ep).length > 1 ? `（共 ${draftsOf(w, ep).length} 稿，其余在草稿箱）` : ''}` } : null,
    latest && review ? { to: draftPath(p, latest.id, review.id), tip: `查看${draftLabel(latest)}的审稿意见` } : null,
    final ? { to: finalPath(p, ep), tip: `打开第 ${ep} 集正文` } : null,
  ]
}

export type DraftAction = 'review' | 'revise' | 'final'

export const DRAFT_ACTION_LABEL: Record<DraftAction, string> = { review: 'AI 审稿', revise: 'AI 修稿', final: '定稿' }

/**
 * 草稿页的主操作随状态切换：正文没审过 → 审稿；审出严重问题且还能修稿 → 修稿；其余 → 定稿。
 * 只读版本（已修稿 / 已定稿）没有建议。
 */
export function draftAdvice(p: Project, d: EpisodeDraft): { action: DraftAction; short: string; text: string } | null {
  if (d.status !== 'draft') return null
  const last = d.reviews.at(-1)
  const reviewed = !!last && last.sig === linesSig(d)
  const capped = reviseRounds(p.work, d.ep) >= MAX_REVISE_ROUNDS
  if (!reviewed) {
    return capped
      ? { action: 'final', short: '待定稿', text: `已 AI 修稿 ${MAX_REVISE_ROUNDS} 轮：人工改完直接定稿，也可以再审一遍` }
      : {
          action: 'review',
          short: '待审稿',
          text: d.revision?.reviewNo ? `这一版按审稿 #${d.revision.reviewNo} 改过：再审一遍，确认意见都改到了` : '先让 AI 对照蓝图、状态库与格式审一遍，再决定修稿还是定稿',
        }
  }
  const { block } = reviewCounts(last)
  if (block && !capped) return { action: 'revise', short: `审出 ${block} 个严重问题，待修稿`, text: `审稿有 ${block} 个严重问题：AI 修稿按这份意见逐条改出新版本，原版本保留` }
  return { action: 'final', short: '审稿完成，待定稿', text: block ? `还有 ${block} 个严重问题，但已修稿 ${MAX_REVISE_ROUNDS} 轮：人工改完后定稿` : '审稿已通过：定稿后归入正文章节，状态库与本集要点随之更新' }
}

/** 草稿箱里还停在「草稿」状态的最新版本，按集数排序 */
function openDrafts(p: Project) {
  const eps = [...new Set(p.work.drafts.map((d) => d.ep))].filter((ep) => ep <= p.spec.totalEpisodes).sort((a, b) => a - b)
  return eps.map((ep) => draftsOf(p.work, ep)[0]).filter((d) => d?.status === 'draft')
}

/* ---------------------------------- 待办 ---------------------------------- */

export interface Todo {
  key: string
  level: 'block' | 'warn' | 'info'
  text: string
  to: string
  cta: string
}

/** 散落在各环节、需要编剧确认或处理的事项 */
export function projectTodos(p: Project): Todo[] {
  const w = p.work
  const stages = MODE_STAGES[p.mode]
  const out: Todo[] = []
  const push = (key: string, level: Todo['level'], text: string, stage: StageKey, cta: string, to = stageTo(p, stage)) => out.push({ key, level, text, to, cta })

  if (stages.includes('video') && w.video) {
    const failed = w.video.episodes.filter((e) => e.status === 'failed').length
    if (failed) push('video-failed', 'block', `视频转写有 ${failed} 集失败，需要重试`, 'video', '去重试')
    else if (!w.video.merged && w.video.episodes.length && w.video.episodes.every((e) => e.status === 'done')) push('video-merge', 'info', '全集已转写完成，待合并成完整剧本', 'video', '去合并')
    else if (w.video.merged && !w.video.merged.importedAt) push('video-import', 'info', '合并好的剧本待送入对标剧拆解', 'video', '去送入')
  }

  if (stages.includes('breakdown')) {
    const bd = w.breakdown
    if (w.source && !bd) push('breakdown-run', 'info', '对标剧剧本已导入，待 AI 拆解', 'breakdown', '去拆解')
    else if (bd && !bd.referencedAt) {
      const left = Object.values(bd.review).filter((r) => r !== 'approved').length
      if (left) push('breakdown-review', 'warn', `对标剧拆解还有 ${left} 个板块待审核`, 'breakdown', '去审核')
      else push('breakdown-ref', 'info', '拆解的四个板块已确认，待一键引用到故事架构', 'breakdown', '去引用')
    }
  }

  if (w.architecture && w.architecture.status !== 'approved' && !stageGate(p, 'architecture')) {
    push('arch', 'warn', '故事架构还是草稿：确认后才能生成人物、大纲与伏笔', 'architecture', '去确认')
  }

  const paywalls = pendingPaywalls(p)
  if (paywalls.length) push('paywall', 'warn', `${paywalls.length} 个付费卡点集纲待单独审核（第 ${paywalls.map((o) => o.ep).join('、')} 集）`, 'outline', '去审核')

  for (const d of openDrafts(p)) {
    const advice = draftAdvice(p, d)
    if (advice) push(`draft-${d.id}`, advice.action === 'revise' ? 'warn' : 'info', `第 ${d.ep} 集 ${draftLabel(d)}：${advice.short}`, 'script', '打开草稿', draftPath(p, d.id))
  }

  for (const a of overallSnapshot(p).alerts) push(`fs-${a.item.id}`, 'warn', `「${foreshadowName(a.item)}」${a.overdue}`, 'foreshadow', '去处理')

  const candidates = w.foreshadows.reduce((n, f) => n + eventCandidates(f, w.scripts).length, 0)
  if (candidates) push('fs-events', 'info', `定稿正文里有 ${candidates} 处伏笔推进待确认，确认后才计入状态库`, 'foreshadow', '去确认')

  if (w.qa && p.status !== 'delivered') {
    if (qaStale(p)) push('qa-stale', 'warn', '正文在质检后有改动，需要重新质检', 'qa', '去质检')
    const blocks = w.qa.issues.filter((i) => i.level === 'block' && !w.qa?.resolved.includes(i.id)).length
    if (blocks) push('qa-block', 'block', `质检还有 ${blocks} 个严重问题，处理后才能交付`, 'qa', '去处理')
  }
  return out
}

/* ---------------------------------- 下一步 ---------------------------------- */

export interface NextTask {
  title: string
  desc: string
  to: string
  cta: string
  /** 与「待处理」里重复的那一条，概览上只留「继续工作」 */
  todoKey?: string
}

const firstMissing = (eps: number[], total: number) => {
  let ep = 1
  while (ep <= total && eps.includes(ep)) ep++
  return ep
}

/** 某个环节里具体要做的那件事 */
function stageTask(p: Project, key: StageKey): string {
  const w = p.work
  const total = p.spec.totalEpisodes
  switch (key) {
    case 'video':
      return w.video ? '继续视频转写与合并' : '获取对标剧全集视频'
    case 'breakdown':
      return !w.source ? '导入对标剧剧本' : !w.breakdown ? '开始 AI 拆解对标剧' : '逐块审核拆解，一键引用'
    case 'architecture':
      return w.architecture ? '完善并确认故事架构' : '设计故事架构'
    case 'characters':
      return '生成人物设定与关系'
    case 'outline': {
      if (!w.plot && !outlineCount(p)) return '生成全剧总览与阶段粗纲'
      const ep = firstMissing(w.outline.map((o) => o.ep), total)
      return ep <= total ? `生成第 ${ep} 集起的集纲` : '审核付费卡点集纲'
    }
    case 'foreshadow':
      return '对照大纲埋伏笔与叙事线索'
    case 'script':
      return w.blueprints.length ? `写第 ${nextUnwritten(p)} 集` : '生成分集蓝图'
    case 'qa':
      return !w.qa ? '运行质检' : qaStale(p) ? '重新质检' : '处理问题并确认交付'
    default:
      return STAGES[key].label
  }
}

/**
 * 「继续工作」指向的那一步：先接住写作循环里停着的草稿，其次接着写下一集，
 * 最后才按环节顺序找第一个没完成的环节。
 */
export function nextTask(p: Project): NextTask | null {
  const w = p.work
  const total = p.spec.totalEpisodes

  const open = openDrafts(p)[0]
  const advice = open && draftAdvice(p, open)
  if (open && advice) {
    return { title: `继续第 ${open.ep} 集（${draftLabel(open)}）：${advice.short}`, desc: advice.text, to: draftPath(p, open.id), cta: DRAFT_ACTION_LABEL[advice.action], todoKey: `draft-${open.id}` }
  }

  const next = nextUnwritten(p)
  if (finalCount(p) > 0 && next <= total && !stageGate(p, 'script')) {
    if (w.outline.some((o) => o.ep === next)) {
      return {
        title: `写第 ${next} 集`,
        desc: blueprintOf(w, next) ? '蓝图已就绪：看一眼作者微操指导就可以开写' : '先生成本集蓝图，再开写',
        to: `${scriptStagePath(p)}?ep=${next}`,
        cta: '去写作',
      }
    }
    return { title: `补第 ${next} 集起的集纲`, desc: '已经写到集纲的尽头：先生成下一批集纲再继续写', to: stageTo(p, 'outline'), cta: '去情节大纲' }
  }

  const stages = MODE_STAGES[p.mode].filter((k) => k !== 'overview')
  const key = stages.find((k) => stageState(p, k) === 'active') ?? stages.find((k) => stageState(p, k) === 'todo')
  if (!key) return null
  return { title: stageTask(p, key), desc: STAGES[key].summary.split(/[，；：。]/)[0], to: stageTo(p, key), cta: `去${STAGES[key].label}` }
}
