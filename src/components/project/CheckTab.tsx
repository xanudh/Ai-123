import clsx from 'clsx'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CHECK_ICON } from '../stage/StageKit'
import type { CheckItem } from '../stage/StageKit'
import { CHECK_TAB, STATE_TAB, activeTab, openPanelTab, usePanelTabs, useStatePanel } from '../../store/statePanel'

/** 要留意的条数：拦下的 + 提醒 */
const attention = (items: CheckItem[]) => items.filter((c) => c.level === 'block' || c.level === 'warn').length

/** 页面的检查并入状态库侧栏：与「状态库」并列成「检查」标签页 */
export function useCheckTab(items: CheckItem[]) {
  usePanelTabs([
    { key: STATE_TAB, label: '状态库' },
    { key: CHECK_TAB, label: '检查', count: attention(items) },
  ])
}

/** 「检查」标签页的内容：页面用 portal 填进侧栏 */
export function CheckTab({ title, desc, children }: { title: string; desc: string; children: ReactNode }) {
  const slot = useStatePanel((s) => s.slot)
  const shown = useStatePanel((s) => activeTab(s.tabs, s.tab))
  if (!slot || shown !== CHECK_TAB) return null
  return createPortal(
    <div className="space-y-3 px-4">
      <div>
        <div className="text-[13px] font-medium text-ink-900">{title}</div>
        <p className="mt-0.5 text-xs leading-5 text-ink-400">{desc}</p>
      </div>
      {children}
    </div>,
    slot,
  )
}

/** 页面上的入口：一眼看到有几条要留意，点开侧栏的「检查」 */
export function CheckLink({ items, className }: { items: CheckItem[]; className?: string }) {
  const block = items.filter((c) => c.level === 'block').length
  const n = attention(items)
  return (
    <button
      type="button"
      data-open-checks
      title="在剧本状态库的「检查」里查看"
      onClick={() => openPanelTab(CHECK_TAB)}
      className={clsx(
        'inline-flex items-center gap-1 rounded-md text-xs [&>svg]:mt-0',
        block ? 'text-red-700 hover:text-red-800' : n ? 'text-amber-800 hover:text-amber-900' : 'text-ink-500 hover:text-brand-600',
        className,
      )}
    >
      {CHECK_ICON[block ? 'block' : n ? 'warn' : 'ok']}
      {n ? `检查 ${n} 条需留意` : '检查通过'}
    </button>
  )
}
