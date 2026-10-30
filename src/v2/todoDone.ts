import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface TodoDoneState {
  /**
   * 版本二：概览「待处理」里标记已处理的事项，项目 id → 事项 key → 标记时的文字。
   * 只是收起提醒，不改项目数据；文字变了（数量、集数有变化）就当作新情况重新出现。
   */
  done: Record<string, Record<string, string>>
  mark: (projectId: string, key: string, text: string) => void
  restore: (projectId: string, key: string) => void
}

export const useTodoDone = create<TodoDoneState>()(
  persist(
    (set) => ({
      done: {},
      mark: (id, key, text) => set((s) => ({ done: { ...s.done, [id]: { ...s.done[id], [key]: text } } })),
      restore: (id, key) =>
        set((s) => {
          const next = { ...s.done[id] }
          delete next[key]
          return { done: { ...s.done, [id]: next } }
        }),
    }),
    { name: 'zhiying.todoDone' },
  ),
)
