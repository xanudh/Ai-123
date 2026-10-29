import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface NavFoldState {
  /** 版本二：左侧创作流程收起成一列图标，给正文腾地方 */
  collapsed: boolean
  toggle: () => void
}

export const useNavFold = create<NavFoldState>()(
  persist(
    (set) => ({
      collapsed: false,
      toggle: () => set((s) => ({ collapsed: !s.collapsed })),
    }),
    { name: 'zhiying.stageNav' },
  ),
)
