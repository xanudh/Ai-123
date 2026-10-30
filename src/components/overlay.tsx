import clsx from 'clsx'
import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useBlocker } from 'react-router'
import { useDismiss } from '../lib/useDismiss'
import { useToast } from '../store/toast'
import { Button } from './ui'

export function Modal({
  open,
  onClose,
  title,
  desc,
  children,
  footer,
  width = 440,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  desc?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  width?: number
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  // onClose 常是内联函数；只在打开时聚焦一次，避免弹窗内输入框被抢走焦点
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current()
    document.addEventListener('keydown', onKey)
    panelRef.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 animate-fade-in bg-ink-900/40 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        style={{ maxWidth: width }}
        className="relative w-full animate-slide-up rounded-2xl bg-white shadow-pop focus:outline-none"
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-5">
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            {desc && <p className="mt-1 text-sm text-ink-500">{desc}</p>}
          </div>
          <button onClick={onClose} className="-mr-2 rounded-md p-1.5 text-ink-400 hover:bg-canvas hover:text-ink-700" aria-label="关闭">
            <X size={16} />
          </button>
        </div>
        {children && <div className="px-6 pt-4">{children}</div>}
        <div className="flex justify-end gap-2 px-6 pt-5 pb-5">{footer}</div>
      </div>
    </div>,
    document.body,
  )
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  desc,
  confirmText = '确认',
  danger,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  desc?: ReactNode
  confirmText?: string
  danger?: boolean
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      desc={desc}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {confirmText}
          </Button>
        </>
      }
    />
  )
}

/** 有未保存修改时拦截站内跳转并弹窗确认，刷新 / 关闭页面时交给浏览器提示；bypass 为 true 时放行（如删除后跳转） */
export function UnsavedChangesPrompt({ dirty, desc, bypass }: { dirty: boolean; desc: string; bypass?: RefObject<boolean> }) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !bypass?.current && currentLocation.pathname !== nextLocation.pathname)

  useEffect(() => {
    if (!dirty) return
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [dirty])

  return (
    <Modal
      open={blocker.state === 'blocked'}
      onClose={() => blocker.reset?.()}
      title="离开此页？"
      desc={desc}
      footer={
        <>
          <Button variant="secondary" onClick={() => blocker.reset?.()}>
            继续编辑
          </Button>
          <Button variant="danger" onClick={() => blocker.proceed?.()}>
            不保存，离开
          </Button>
        </>
      }
    />
  )
}

/** 下拉菜单：点击外部或按 Esc 关闭 */
export function Menu({
  trigger,
  items,
  align = 'right',
  header,
  note,
}: {
  trigger: (props: { onClick: (e: React.MouseEvent) => void; 'aria-expanded': boolean }) => ReactNode
  items: { label: string; icon?: ReactNode; danger?: boolean; onSelect: () => void }[]
  align?: 'left' | 'right'
  /** 菜单顶部的小标题 */
  header?: string
  /** 标题下的提示：选之前先看到 */
  note?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useDismiss(ref, open, setOpen)

  return (
    <div ref={ref} className="relative">
      {trigger({
        onClick: (e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen((v) => !v)
        },
        'aria-expanded': open,
      })}
      {open && (
        <div
          role="menu"
          className={clsx(
            'absolute top-full z-30 mt-1 min-w-36 animate-fade-in rounded-lg border border-line bg-white p-1 shadow-pop',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {header && <div className="px-2.5 pt-1 pb-1.5 text-xs whitespace-nowrap text-ink-400">{header}</div>}
          {note && <div className="mb-1 w-60 px-1">{note}</div>}
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setOpen(false)
                item.onSelect()
              }}
              className={clsx(
                'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px]',
                item.danger ? 'text-red-600 hover:bg-red-50' : 'text-ink-700 hover:bg-canvas',
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function Toaster() {
  const toasts = useToast((s) => s.toasts)
  return createPortal(
    <div className="pointer-events-none fixed top-4 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={clsx(
            'pointer-events-auto animate-slide-up rounded-lg px-4 py-2 text-sm font-medium shadow-pop',
            t.tone === 'error' ? 'bg-red-600 text-white' : t.tone === 'info' ? 'bg-ink-900 text-white' : 'bg-emerald-600 text-white',
          )}
        >
          {t.text}
        </div>
      ))}
    </div>,
    document.body,
  )
}
