import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type UiVersion = 1 | 2

interface UiVersionState {
  /** 版本一为原方案；版本二在同一份数据上优化交互流程，页面底部随时切换对比 */
  version: UiVersion
  setVersion: (version: UiVersion) => void
}

export const useUiVersion = create<UiVersionState>()(
  persist(
    (set) => ({
      version: 1,
      setVersion: (version) => set({ version }),
    }),
    { name: 'zhiying.uiVersion' },
  ),
)

export const useV2 = () => useUiVersion((s) => s.version === 2)
