import { Sparkles } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Modal } from '../components/overlay'
import { Badge, Button, Segmented } from '../components/ui'
import { SHOW_V1, useUiVersion } from '../store/uiVersion'
import type { UiVersion } from '../store/uiVersion'
import { useBottomSlot } from './bottomSlot'
import { CHANGES, LATER, METHOD } from './notes'

function ChangeNotes({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      width={780}
      title="版本二 · 交互优化说明"
      desc="围绕核心业务链优化流程：不删功能、不改数据结构，两个版本读写同一份项目数据。"
      footer={<Button onClick={onClose}>知道了</Button>}
    >
      <div className="scrollbar-thin -mx-6 max-h-[64vh] space-y-6 overflow-y-auto px-6">
        <section>
          <h3 className="mb-2 text-[13px] font-semibold text-ink-900">方法：交互设计师怎么做流程优化</h3>
          <ol className="grid gap-2 sm:grid-cols-2">
            {METHOD.map((m, i) => (
              <li key={m.title} className="rounded-lg border border-line bg-canvas/60 p-3">
                <div className="flex items-center gap-2 text-[13px] font-medium">
                  <span className="flex size-5 items-center justify-center rounded-full bg-brand-600 text-[11px] text-white tabular-nums">{i + 1}</span>
                  {m.title}
                </div>
                <p className="mt-1.5 text-xs leading-5 text-ink-500">{m.desc}</p>
              </li>
            ))}
          </ol>
        </section>

        <section>
          <h3 className="mb-2 text-[13px] font-semibold text-ink-900">改动清单（{CHANGES.length} 项）</h3>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {CHANGES.map((c) => (
              <li key={c.area} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium text-ink-900">{c.area}</span>
                  <Badge tone="amber">断点 · {c.kind}</Badge>
                  <Badge tone="violet">{c.principle}</Badge>
                </div>
                <dl className="mt-2 grid gap-1.5 text-xs leading-5 sm:grid-cols-[56px_minmax(0,1fr)]">
                  <dt className="text-ink-400">版本一</dt>
                  <dd className="text-ink-500">{c.before}</dd>
                  <dt className="text-brand-600">版本二</dt>
                  <dd className="text-ink-700">{c.after}</dd>
                </dl>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className="mb-2 text-[13px] font-semibold text-ink-900">后续可评估</h3>
          <ul className="space-y-1.5">
            {LATER.map((l) => (
              <li key={l} className="flex gap-2.5 text-xs leading-5 text-ink-500">
                <span className="mt-2 size-1 shrink-0 rounded-full bg-ink-400" />
                {l}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Modal>
  )
}

/** 页面最底部那一条：环节页的环节条放在这里（本环节的状态、操作和去下一步，见 StagePage 的 StageBar），没东西时整条不显示（11/4 标注 #73：去掉「版本二 · 交互优化 / 改动说明」）；版本一入口打开时这里是版本切换 */
export function VersionBar() {
  const { version, setVersion } = useUiVersion()
  const [notes, setNotes] = useState(false)
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
  }, [version])

  if (!SHOW_V1) {
    // 比原来那条高一倍（11/4 标注 #75），内容靠左排（#74）
    return <div ref={slotBar} data-bottom-slot aria-label="环节操作" className="flex min-h-24 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-t border-line bg-white px-6 py-3 empty:hidden xl:px-8" />
  }

  return (
    <div ref={barRef} className="flex h-12 shrink-0 items-center gap-3 border-t border-line bg-white px-6 xl:px-8" aria-label="界面版本">
      <span className="text-xs text-ink-500">界面版本</span>
      <Segmented<UiVersion>
        value={version}
        onChange={setVersion}
        options={[
          { value: 1, label: '版本一 · 当前方案' },
          { value: 2, label: '版本二 · 交互优化' },
        ]}
      />
      {version === 2 && (
        <Button variant="ghost" size="sm" onClick={() => setNotes(true)} className="text-brand-700">
          <Sparkles size={14} />
          改动说明
        </Button>
      )}
      <span className="hidden text-xs text-ink-400 md:inline">两个版本共用同一份项目数据，可随时切换对比</span>
      {version === 2 && <div ref={setSlot} data-bottom-slot className="flex min-w-0 flex-1 empty:hidden" />}
      <ChangeNotes open={notes} onClose={() => setNotes(false)} />
    </div>
  )
}
