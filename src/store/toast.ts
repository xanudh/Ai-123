import { create } from 'zustand'

export interface Toast {
  id: number
  text: string
  tone: 'success' | 'error' | 'info'
  /** 提示里的操作，如「撤销」；带操作的提示停留更久 */
  action?: { label: string; run: () => void }
}

interface ToastState {
  toasts: Toast[]
  push: (text: string, tone?: Toast['tone'], action?: Toast['action']) => void
  dismiss: (id: number) => void
}

let seq = 0

export const useToast = create<ToastState>((set, get) => ({
  toasts: [],
  push: (text, tone = 'success', action) => {
    const id = ++seq
    set({ toasts: [...get().toasts, { id, text, tone, action }] })
    setTimeout(() => get().dismiss(id), action ? 6000 : 3200)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}))

export const toast = (text: string, tone?: Toast['tone'], action?: Toast['action']) => useToast.getState().push(text, tone, action)
