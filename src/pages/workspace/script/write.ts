import type { useAiTask } from '../../../components/stage/StageKit'
import { latestProject } from '../../../components/stage/StageKit'
import { preWriteCheck } from '../../../domain/state'
import type { EpisodeDraft, ModelId } from '../../../domain/types'
import { modelLabel } from '../../../domain/models'
import { draftLabel, draftsOf } from '../../../domain/work'
import { nextSeed, writeEpisode } from '../../../services/ai'
import { useProjects } from '../../../store/projects'
import { toast } from '../../../store/toast'
import { addDraft } from './ops'

type AiRun = ReturnType<typeof useAiTask>['run']

/**
 * 写作一集：过写作前检查 → AI 写正文 → 放进草稿箱，项目状态随之进入「创作中」。
 * 被检查拦下、取消或失败时返回 null。分集蓝图页与正文页的接力条共用。
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
  const content = await run('write', (signal) => writeEpisode(cur, ep, seed, signal, model))
  if (!content) return null
  const latest = latestProject(projectId)
  if (!latest) return null
  const { draft, drafts } = addDraft(latest.work, ep, content)
  const { patchWork, updateProject } = useProjects.getState()
  const via = model ? `（换用 ${modelLabel(model)}）` : ''
  patchWork(projectId, { drafts }, `写作第 ${ep} 集：${draftLabel(draft)}${via}`)
  if (latestProject(projectId)?.status === 'draft') updateProject(projectId, { status: 'writing' })
  toast(`第 ${ep} 集 ${draftLabel(draft)}${via} 已放入草稿箱`)
  return draft
}
