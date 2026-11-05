import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ChatChange, ChatOption, Direction, PlanField, RewritePlan } from '../services/ai'

/** 对话里的一条：AI、编剧，或一行旁注（直接改字、锁定、回到旧版本） */
export interface ChatMsg {
  id: string
  role: 'ai' | 'user' | 'note'
  text: string
  at: string
  directions?: Direction[]
  changes?: ChatChange[]
  notes?: string[]
  options?: ChatOption[]
  /** 这一条产生的方案版本号（从 1 起） */
  version?: number
}

/** 改写方案 · 多轮对话 Demo 的进度，按项目存；不读写正式流程里的故事架构 */
export interface ChatState {
  messages: ChatMsg[]
  /** 每改一次存一版，可以回到任意一版 */
  versions: RewritePlan[]
  /** 当前方案在 versions 里的下标；-1 表示还没有方案 */
  current: number
  locks: PlanField[]
  /** 正在聊的那一项 */
  topic: PlanField | null
}

export const emptyChat = (): ChatState => ({ messages: [], versions: [], current: -1, locks: [], topic: null })

interface RewriteChatStore {
  chats: Record<string, ChatState>
  patch: (projectId: string, patch: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) => void
  reset: (projectId: string) => void
}

export const useRewriteChat = create<RewriteChatStore>()(
  persist(
    (set) => ({
      chats: {},
      patch: (id, patch) =>
        set((s) => {
          const cur = s.chats[id] ?? emptyChat()
          return { chats: { ...s.chats, [id]: { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) } } }
        }),
      reset: (id) =>
        set((s) => {
          const next = { ...s.chats }
          delete next[id]
          return { chats: next }
        }),
    }),
    { name: 'zhiying.rewriteChat' },
  ),
)
