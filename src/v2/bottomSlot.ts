import { useEffect } from 'react'
import { create } from 'zustand'

interface BottomSlotState {
  /** 页面最底部那一条（VersionBar）：环节页把环节条放进来，没东西时整条不显示 */
  el: HTMLElement | null
  setEl: (el: HTMLElement | null) => void
  /** 环节条里留给环节自己的两块（StagePage 的 StageBar 提供）：左边放本环节的状态，右边放本环节的按钮（11/4 标注 #83：按钮一律靠右），如拆解的一键引用、故事架构的确认 */
  infoEl: HTMLElement | null
  setInfoEl: (el: HTMLElement | null) => void
  actionsEl: HTMLElement | null
  setActionsEl: (el: HTMLElement | null) => void
  /** 正往环节条里放东西的组件数：有自己内容的环节，「去下一步」等本环节完成后才出现 */
  users: number
  claim: () => () => void
}

export const useBottomSlot = create<BottomSlotState>((set) => ({
  el: null,
  setEl: (el) => set({ el }),
  infoEl: null,
  setInfoEl: (infoEl) => set({ infoEl }),
  actionsEl: null,
  setActionsEl: (actionsEl) => set({ actionsEl }),
  users: 0,
  claim: () => {
    set((s) => ({ users: s.users + 1 }))
    return () => set((s) => ({ users: s.users - 1 }))
  },
}))

/** 环节组件把自己的状态和操作放进底部环节条：返回左边（状态）、右边（按钮）两个要 portal 进去的元素（还没挂上时为 null）；enabled 为 false 时不占位 */
export function useStageSlot(enabled = true): { info: HTMLElement; actions: HTMLElement } | null {
  const info = useBottomSlot((s) => s.infoEl)
  const actions = useBottomSlot((s) => s.actionsEl)
  const claim = useBottomSlot((s) => s.claim)
  useEffect(() => (enabled ? claim() : undefined), [enabled, claim])
  return enabled && info && actions ? { info, actions } : null
}
