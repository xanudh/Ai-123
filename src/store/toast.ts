import { create } from 'zustand'

export interface Toast {
  id: number
  text: string
  tone: 'success' | 'error' | 'info'
}

interface ToastState {
  toasts: Toast[]
  push: (text: string, tone?: Toast['tone']) => void
  dismiss: (id: number) => void
}

let seq = 0

export const useToast = create<ToastState>((set, get) => ({
  toasts: [],
  push: (text, tone = 'success') => {
    const id = ++seq
    set({ toasts: [...get().toasts, { id, text, tone }] })
    setTimeout(() => get().dismiss(id), 3200)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}))

export const toast = (text: string, tone?: Toast['tone']) => useToast.getState().push(text, tone)
