import { create } from 'zustand'
import { modelLabel, modelOf } from '../domain/models'
import { preWriteCheck } from '../domain/state'
import type { ModelId } from '../domain/types'
import { addDraft } from '../pages/workspace/script/ops'
import { writeEpisode } from '../services/ai'
import { useProjects } from './projects'
import { toast } from './toast'

/** 正在进行的批量写作：整批用开写时定下的模型；页头换文本模型时据此提醒，也能从页头停掉 */
export interface BatchRun {
  projectId: string
  model: ModelId
  /** 正在写的集、第几集 / 共几集 */
  ep: number
  i: number
  n: number
  stop: () => void
}

export const useBatchRun = create<{ run: BatchRun | null }>(() => ({ run: null }))

export const setBatchRun = (run: BatchRun | null) => useBatchRun.setState({ run })

/** 本项目正在进行的批量写作 */
export const batchOf = (projectId: string) => {
  const run = useBatchRun.getState().run
  return run?.projectId === projectId ? run : null
}

const projectOf = (id: string) => useProjects.getState().projects.find((p) => p.id === id)

/**
 * 批量写作在页面之外跑：离开分集蓝图页（打开草稿、去别的环节）也会接着写，页头显示进度、随时可停。
 * 按顺序逐集写，遇到写作前检查拦下的集就停；停止后已写出的草稿保留。
 */
export async function startBatch(projectId: string, from: number, to: number) {
  const start = projectOf(projectId)
  if (!start || useBatchRun.getState().run) return
  // 整批用开写时的文本模型：中途在页头换模型，本批剩下的集仍用它写完，同一批文风一致
  const model = modelOf(start, 'text')
  const ctrl = new AbortController()
  const stop = () => ctrl.abort()
  let done = 0
  let stopped = ''
  try {
    for (let ep = from; ep <= to; ep++) {
      const cur = projectOf(projectId)
      if (!cur) break
      const block = preWriteCheck(cur, ep).find((c) => c.level === 'block')
      if (block) {
        stopped = `第 ${ep} 集：${block.text}`
        break
      }
      setBatchRun({ projectId, model, ep, i: ep - from + 1, n: to - from + 1, stop })
      const content = await writeEpisode(cur, ep, 0, ctrl.signal, model)
      const latest = projectOf(projectId)
      if (!latest) break
      useProjects.getState().patchWork(projectId, { drafts: addDraft(latest.work, ep, content).drafts }, `批量写作：第 ${ep} 集草稿`)
      done++
    }
  } catch (e) {
    if ((e as Error).name !== 'AbortError') toast('批量写作失败，请重试', 'error')
    else if (done) toast(`已停止批量写作，写出的 ${done} 集草稿已保存`)
    setBatchRun(null)
    return
  }
  setBatchRun(null)
  if (done && projectOf(projectId)?.status === 'draft') useProjects.getState().updateProject(projectId, { status: 'writing' })
  if (done) toast(`已用 ${modelLabel(model)} 写出 ${done} 集草稿，逐集审稿后定稿${stopped ? `（${stopped}）` : ''}`)
  else if (stopped) toast(stopped, 'error')
}
