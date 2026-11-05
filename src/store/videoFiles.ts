import { create } from 'zustand'

/**
 * 本次打开页面时选中的本地视频（object URL），只在内存里，不落库：项目 id → 集数 → 地址。
 * 人工校对时左侧播放；刷新后需要重新选择文件。
 */
interface VideoFilesState {
  files: Record<string, Record<number, string>>
  attach: (projectId: string, list: { ep: number; file: File }[]) => void
}

export const useVideoFiles = create<VideoFilesState>()((set) => ({
  files: {},
  attach: (id, list) =>
    set((s) => {
      const cur = { ...s.files[id] }
      for (const { ep, file } of list) {
        if (cur[ep]) URL.revokeObjectURL(cur[ep])
        cur[ep] = URL.createObjectURL(file)
      }
      return { files: { ...s.files, [id]: cur } }
    }),
}))
