import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { LabFormula, LabKey, LabSkeleton, LabValue } from '../services/ai'

/** 逐项讨论里的一项：每次按意见重写都留一版，可以切回去 */
export interface LabItem {
  versions: LabValue[]
  current: number
  done: boolean
  comment: string
  /** 最近一次重写的说明 */
  notes?: string[]
  /** 前面已定的项改过之后，提醒这一项要不要跟着调 */
  stale?: string
}

/** 故事架构新版 Demo 的进度，按项目存；不读写正式流程里的故事架构 */
export interface LabState {
  seedMode: 'idea' | 'formula'
  idea: string
  formula: LabFormula
  count: 1 | 3
  candidates: LabSkeleton[] | null
  /** 选定的那一版的标题 */
  picked: string | null
  items: Partial<Record<LabKey, LabItem>> | null
  active: LabKey | null
}

export const emptyLab = (): LabState => ({
  seedMode: 'idea',
  idea: '',
  formula: { hero: '', trouble: '', goal: '', twist: '' },
  count: 3,
  candidates: null,
  picked: null,
  items: null,
  active: null,
})

interface ArchLabStore {
  labs: Record<string, LabState>
  patch: (projectId: string, patch: Partial<LabState> | ((s: LabState) => Partial<LabState>)) => void
  reset: (projectId: string) => void
}

export const useArchLab = create<ArchLabStore>()(
  persist(
    (set) => ({
      labs: {},
      patch: (id, patch) =>
        set((s) => {
          const cur = s.labs[id] ?? emptyLab()
          return { labs: { ...s.labs, [id]: { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) } } }
        }),
      reset: (id) =>
        set((s) => {
          const next = { ...s.labs }
          delete next[id]
          return { labs: next }
        }),
    }),
    { name: 'zhiying.archLab' },
  ),
)
