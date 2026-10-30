import { useEffect } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { StateFocus } from '../domain/snapshot'

/** 页面并入状态库侧栏的标签页；key 为 'state' 的一项就是状态库本身 */
export interface PanelTab {
  key: string
  label: string
  count?: number
}

/** 状态库本身那一页的 key */
export const STATE_TAB = 'state'

/** 页面检查（大纲检查、写作前检查）那一页的 key */
export const CHECK_TAB = 'checks'

interface StatePanelState {
  /** 侧栏展开 / 收起；记住上次的选择 */
  open: boolean
  /** 当前页面登记的层级；null 表示本页不提供状态库侧栏 */
  focus: StateFocus | null
  /** 页面登记的标签页（按显示顺序）；null 表示只有状态库 */
  tabs: PanelTab[] | null
  /** 选中的标签页；记住上次的选择 */
  tab: string
  /** 页面标签页的挂载点：侧栏渲染，页面用 portal 填进内容 */
  slot: HTMLElement | null
  setOpen: (open: boolean) => void
  setFocus: (focus: StateFocus | null) => void
  setTabs: (tabs: PanelTab[] | null) => void
  setTab: (tab: string) => void
  setSlot: (slot: HTMLElement | null) => void
}

export const useStatePanel = create<StatePanelState>()(
  persist(
    (set) => ({
      open: false,
      focus: null,
      tabs: null,
      tab: STATE_TAB,
      slot: null,
      setOpen: (open) => set({ open }),
      setFocus: (focus) => set({ focus }),
      setTabs: (tabs) => set({ tabs }),
      setTab: (tab) => set({ tab }),
      setSlot: (slot) => set({ slot }),
    }),
    { name: 'zhiying.statePanel', partialize: (s) => ({ open: s.open, tab: s.tab }) },
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

/** 页面把自己的内容并入状态库侧栏，与「状态库」并列成标签页；离开页面时撤销 */
export function usePanelTabs(tabs: PanelTab[] | null) {
  const key = tabs ? JSON.stringify(tabs) : ''
  useEffect(() => {
    useStatePanel.getState().setTabs(key ? (JSON.parse(key) as PanelTab[]) : null)
    return () => useStatePanel.getState().setTabs(null)
  }, [key])
}

/** 当前实际显示的标签页：记住的那页不在本页的标签里时退回第一页 */
export const activeTab = (tabs: PanelTab[] | null, tab: string) => (!tabs ? STATE_TAB : tabs.some((t) => t.key === tab) ? tab : tabs[0].key)

/** 展开状态库侧栏并切到某个标签页 */
export function openPanelTab(tab: string) {
  const panel = useStatePanel.getState()
  panel.setTab(tab)
  panel.setOpen(true)
}
