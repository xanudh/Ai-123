import { useCallback, useEffect, useRef } from 'react'
import { useBottomSlot } from './bottomSlot'

/** 页面最底部那一条：环节页的环节条放在这里（本环节的状态、操作和去下一步，见 StagePage 的 StageBar），没东西时整条不显示（11/4 标注 #73：去掉「版本二 · 交互优化 / 改动说明」） */
export function BottomBar() {
  const setSlot = useBottomSlot((s) => s.setEl)
  const barRef = useRef<HTMLDivElement | null>(null)
  const slotBar = useCallback(
    (el: HTMLDivElement | null) => {
      barRef.current = el
      setSlot(el)
    },
    [setSlot],
  )

  // 量出这一条的高度写进 --bottom-bar：状态库侧栏、吸顶块据此让位；整条隐藏时为 0
  useEffect(() => {
    const bar = barRef.current
    if (!bar) return
    const root = document.documentElement
    const sync = () => root.style.setProperty('--bottom-bar', `${bar.offsetHeight}px`)
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(bar)
    return () => {
      ro.disconnect()
      root.style.removeProperty('--bottom-bar')
    }
  }, [])

  // 比原来那条高一倍（11/4 标注 #75），内容靠左排（#74）
  return <div ref={slotBar} data-bottom-slot aria-label="环节操作" className="flex min-h-24 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-t border-line bg-white px-6 py-3 empty:hidden xl:px-8" />
}
