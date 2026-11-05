import type { useAiTask } from '../../../components/stage/StageKit'
import { latestProject } from '../../../components/stage/StageKit'
import { preWriteCheck } from '../../../domain/state'
import type { EpisodeDraft, ModelId } from '../../../domain/types'
import { modelLabel } from '../../../domain/models'
import { draftLabel, draftsOf } from '../../../domain/work'
import { nextSeed, writeEpisode } from '../../../services/ai'
import { useProjects } from '../../../store/projects'
import { toast } from '../../../store/toast'
import { addDraft, manualContent, withPrefill } from './ops'

type AiRun = ReturnType<typeof useAiTask>['run']

/**
 * 写作一集：过写作前检查 → AI 写正文 → 放进草稿箱，项目状态随之进入「创作中」。
 * 被检查拦下、取消或失败时返回 null。逐集蓝图页与正文页的接力条共用。
 * model：这次临时换用的模型，不传就用项目的文本模型。
 */
export async function writeDraft(projectId: string, ep: number, run: AiRun, model?: ModelId): Promise<EpisodeDraft | null> {
  const cur = latestProject(projectId)
  if (!cur) return null
  const block = preWriteCheck(cur, ep).find((c) => c.level === 'block')
  if (block) {
    toast(block.text, 'error')
    return null
  }
  const seed = draftsOf(cur.work, ep).length ? nextSeed() : 0
  const { patchWork, updateProject } = useProjects.getState()
  // 本集蓝图还是预填的：先存下来，按这份写
  const blueprints = withPrefill(cur, ep)
  if (blueprints) patchWork(projectId, { blueprints })
  const ready = latestProject(projectId) ?? cur
  const content = await run('write', (signal) => writeEpisode(ready, ep, seed, signal, model))
  if (!content) return null
  const latest = latestProject(projectId)
  if (!latest) return null
  const { draft, drafts } = addDraft(latest.work, ep, content)
  const via = model ? `（换用 ${modelLabel(model)}）` : ''
  patchWork(projectId, { drafts }, `写作第 ${ep} 集：${draftLabel(draft)}${via}`)
  if (latestProject(projectId)?.status === 'draft') updateProject(projectId, { status: 'writing' })
  toast(`第 ${ep} 集 ${draftLabel(draft)}${via} 已放入草稿箱`)
  return draft
}

/** 自己写（11/5 标注 #91；#93 起逐集蓝图的「去写第 N 集」就走这里）：过同样的写作前检查，不用 AI，新建一版按本集蓝图列好架子的草稿，打开就能写 */
export function writeManual(projectId: string, ep: number): EpisodeDraft | null {
  const cur = latestProject(projectId)
  if (!cur) return null
  const block = preWriteCheck(cur, ep).find((c) => c.level === 'block')
  if (block) {
    toast(block.text, 'error')
    return null
  }
  const { patchWork, updateProject } = useProjects.getState()
  const blueprints = withPrefill(cur, ep)
  if (blueprints) patchWork(projectId, { blueprints })
  const ready = latestProject(projectId) ?? cur
  const { draft, drafts } = addDraft(ready.work, ep, { ...manualContent(ready, ep), manual: true })
  patchWork(projectId, { drafts }, `自己写第 ${ep} 集：${draftLabel(draft)}`)
  if (latestProject(projectId)?.status === 'draft') updateProject(projectId, { status: 'writing' })
  toast(`已新建 ${draftLabel(draft)}：按本集蓝图列好了开头承接和末尾钩子，中间自己写`)
  return draft
}
