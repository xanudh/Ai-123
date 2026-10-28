import { useEffect } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { StateFocus } from '../domain/snapshot'

interface StatePanelState {
  /** 侧栏展开 / 收起；记住上次的选择 */
  open: boolean
  /** 当前页面登记的层级；null 表示本页不提供状态库侧栏 */
  focus: StateFocus | null
  setOpen: (open: boolean) => void
  setFocus: (focus: StateFocus | null) => void
}

export const useStatePanel = create<StatePanelState>()(
  persist(
    (set) => ({
      open: false,
      focus: null,
      setOpen: (open) => set({ open }),
      setFocus: (focus) => set({ focus }),
    }),
    { name: 'zhiying.statePanel', partialize: (s) => ({ open: s.open }) },
  ),
)

/** 页面登记状态库侧栏的层级；离开页面时撤销，侧栏随之隐藏 */
export function useStateFocus(focus: StateFocus | null) {
  const key = focus ? JSON.stringify(focus) : ''
  useEffect(() => {
    useStatePanel.getState().setFocus(key ? (JSON.parse(key) as StateFocus) : null)
    return () => useStatePanel.getState().setFocus(null)
  }, [key])
}
