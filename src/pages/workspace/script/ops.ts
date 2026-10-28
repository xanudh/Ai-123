/** 草稿箱与正文章节的数据操作：都返回要写回的 work 片段，由页面调用 patchWork */
import type { DraftReview, EpisodeBlueprint, EpisodeDraft, EpisodeScript, Project, ProjectWork } from '../../../domain/types'
import { blueprintOf, draftsOf, scriptOf } from '../../../domain/work'
import { newId } from '../../../lib/id'
import { extractPoints, positionOf } from '../../../services/ai'
import type { DraftContent } from '../../../services/ai'

const now = () => new Date().toISOString()

export const scriptStagePath = (p: Project) => `/projects/${p.id}/stage/script`

export const draftPath = (p: Project, draftId: string, review?: string) =>
  `/projects/${p.id}/stage/script/draft/${draftId}${review ? `?review=${review}` : ''}`

export const finalPath = (p: Project, ep: number) => `/projects/${p.id}/stage/script/final/${ep}`

/** 审查报告里的严重 / 建议条数 */
export const reviewCounts = (r: DraftReview) => ({
  block: r.items.filter((i) => i.level === 'block').length,
  warn: r.items.filter((i) => i.level === 'warn').length,
})

/** 草稿箱里新增一个版本；同集其他还在“草稿”状态的旧版本标为已修稿 */
export function addDraft(work: ProjectWork, ep: number, content: DraftContent, from?: string): { draft: EpisodeDraft; drafts: EpisodeDraft[] } {
  const ts = now()
  const version = Math.max(0, ...draftsOf(work, ep).map((d) => d.version)) + 1
  const draft: EpisodeDraft = {
    id: newId(),
    ep,
    version,
    title: content.title,
    lines: content.lines,
    status: 'draft',
    translated: false,
    states: content.states,
    reviews: [],
    notes: [],
    ...(from ? { from } : {}),
    createdAt: ts,
    updatedAt: ts,
  }
  const drafts = work.drafts.map((d): EpisodeDraft => (d.ep === ep && d.status === 'draft' ? { ...d, status: 'revised', updatedAt: ts } : d))
  return { draft, drafts: [...drafts, draft] }
}

/** 同一集最多自动修稿几轮：之后交给编剧人工修改或直接定稿，避免审稿 ↔ 修稿无限循环 */
export const MAX_REVISE_ROUNDS = 3

/** 这一集已经 AI 修稿了几轮 */
export const reviseRounds = (work: ProjectWork, ep: number) => draftsOf(work, ep).filter((d) => d.from).length

/** 正文指纹：审稿后正文没改过就不必重复审稿 */
export const linesSig = (d: Pick<EpisodeDraft, 'lines'>) => {
  const text = d.lines.map((l) => `${l.kind}|${l.speaker ?? ''}|${l.zh}`).join('\n')
  let h = 0
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0
  return `${text.length}-${h}`
}

/** AI 审稿检查的范围：悬停审稿旁的说明图标时显示 */
export const REVIEW_SCOPE = [
  '篇幅：按单集时长换算的字数是否过短或过长',
  '格式：场景标题、集末钩子是否齐全',
  '承接：开场是否接住上一集结尾的钩子',
  '伏笔：本集计划埋设 / 回收的伏笔是否写进正文',
  '人物：主角是否有戏、蓝图里的出场人物是否出场、有没有未登记人物',
  '文风：AI 味词汇、过长的台词',
  '标注：还没处理的标注',
]

/** 改某个草稿 */
export const patchDraft = (work: ProjectWork, id: string, patch: Partial<EpisodeDraft>): Pick<ProjectWork, 'drafts'> => ({
  drafts: work.drafts.map((d) => (d.id === id ? { ...d, ...patch, updatedAt: now() } : d)),
})

/** 改某集正文 */
export const patchScript = (work: ProjectWork, ep: number, patch: Partial<EpisodeScript>): Pick<ProjectWork, 'scripts'> => ({
  scripts: work.scripts.map((s) => (s.ep === ep ? { ...s, ...patch, updatedAt: now() } : s)),
})

/**
 * 定稿：草稿归入正文章节（替换本集原有正文），同集原来定稿的版本改为已修稿；
 * 提炼本集要点回填到分集蓝图，没有蓝图时按集纲补一份。
 */
export function finalizeDraft(p: Project, draftId: string): Pick<ProjectWork, 'drafts' | 'scripts' | 'blueprints'> | null {
  const w = p.work
  const d = w.drafts.find((x) => x.id === draftId)
  if (!d) return null
  const ts = now()
  const script: EpisodeScript = { ep: d.ep, title: d.title, lines: d.lines, status: 'final', translated: d.translated, states: d.states, draftId: d.id, updatedAt: ts }
  const drafts = w.drafts.map((x): EpisodeDraft => {
    if (x.id === d.id) return { ...x, status: 'final', updatedAt: ts }
    return x.ep === d.ep && x.status === 'final' ? { ...x, status: 'revised', updatedAt: ts } : x
  })
  const points = extractPoints(p, d)
  const prev = blueprintOf(w, d.ep)
  const o = w.outline.find((x) => x.ep === d.ep)
  const blueprint: EpisodeBlueprint = prev
    ? { ...prev, points }
    : { ep: d.ep, title: d.title || o?.title || '', position: positionOf(p, d.ep), cast: '', goal: '', conflict: o?.event ?? '', hook: o?.hookLine ?? '', guidance: '', points }
  return {
    drafts,
    scripts: [...w.scripts.filter((s) => s.ep !== d.ep), script].sort((a, b) => a.ep - b.ep),
    blueprints: [...w.blueprints.filter((b) => b.ep !== d.ep), blueprint].sort((a, b) => a.ep - b.ep),
  }
}

/** 删除草稿；删掉的是最新草稿时，上一个已修稿的版本恢复为可编辑的草稿 */
export function removeDraft(work: ProjectWork, id: string): Pick<ProjectWork, 'drafts'> {
  const d = work.drafts.find((x) => x.id === id)
  let drafts = work.drafts.filter((x) => x.id !== id)
  if (d?.status === 'draft') {
    const prev = drafts.filter((x) => x.ep === d.ep).sort((a, b) => b.version - a.version)[0]
    if (prev?.status === 'revised') drafts = drafts.map((x): EpisodeDraft => (x.id === prev.id ? { ...x, status: 'draft' } : x))
  }
  return { drafts }
}

/** 删除正文章节；来源草稿退回草稿箱（是最新版本则恢复为草稿，否则为已修稿） */
export function removeScript(work: ProjectWork, ep: number): Pick<ProjectWork, 'drafts' | 'scripts'> {
  const s = scriptOf(work, ep)
  const newest = draftsOf(work, ep)[0]
  return {
    scripts: work.scripts.filter((x) => x.ep !== ep),
    drafts: work.drafts.map((x): EpisodeDraft => (s && x.id === s.draftId ? { ...x, status: x.id === newest?.id ? 'draft' : 'revised' } : x)),
  }
}

/** 批量创作 / 写作按钮的起点：第一个既没有草稿也没有正文的集 */
export function nextUnwritten(p: Project) {
  const total = p.spec.totalEpisodes
  let ep = 1
  while (ep <= total && (scriptOf(p.work, ep) || draftsOf(p.work, ep).length)) ep++
  return ep
}
