import { create } from 'zustand'
import type { ModelId } from '../domain/types'

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
