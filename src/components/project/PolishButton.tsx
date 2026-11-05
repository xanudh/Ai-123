import clsx from 'clsx'
import { Check } from 'lucide-react'
import { useState } from 'react'
import { Modal } from '../overlay'
import { AiButton, useAiTask } from '../stage/StageKit'
import { Button } from '../ui'
import { polishText } from '../../services/ai'
import { toast } from '../../store/toast'

/** 设定输入框旁的小号 AI 按钮（人物小传每一项） */
const COMPACT = 'h-7 px-2 text-xs'

/** 前后对比：改动的行标底色，点「采用」才写进去 */
function CompareModal({
  title,
  desc,
  before,
  after,
  afterTitle,
  onClose,
  onApply,
}: {
  title: string
  desc: string
  before: string
  after: string
  afterTitle: string
  onClose: () => void
  onApply: () => void
}) {
  const from = before.split('\n')
  const to = after.split('\n')
  return (
    <Modal
      open
      onClose={onClose}
      width={760}
      title={title}
      desc={desc}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            不用了
          </Button>
          <Button onClick={onApply}>
            <Check size={15} />
            采用
          </Button>
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-2" data-polish-preview>
        {[
          { title: '原文', lines: from, other: to, tone: 'bg-red-50/70 text-ink-500' },
          { title: afterTitle, lines: to, other: from, tone: 'bg-emerald-50 text-ink-900' },
        ].map((col) => (
          <section key={col.title} className="min-w-0">
            <div className="mb-1 text-xs font-medium text-ink-500">{col.title}</div>
            <div className="scrollbar-thin max-h-[50vh] overflow-y-auto rounded-lg border border-line px-3 py-2 text-[13px] leading-6">
              {col.lines.map((l, i) => (
                <p key={i} className={clsx('rounded px-1 whitespace-pre-wrap', l !== col.other[i] && col.tone)}>
                  {l || ' '}
                </p>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Modal>
  )
}

/**
 * AI 按钮的统一顺序：AI 生成 → AI 润色 → AI 审稿 → AI 修稿。
 * AI 润色只改措辞：先出前后对比，点「采用」才写进去，写进去后提示里可以撤销。
 */
export function PolishButton({
  value,
  label,
  disabled,
  compact,
  onApply,
}: {
  value: string
  label: string
  disabled?: boolean
  compact?: boolean
  onApply: (text: string) => void
}) {
  const { running, run } = useAiTask()
  const [preview, setPreview] = useState<string | null>(null)

  const start = async () => {
    const out = await run('polish', (signal) => polishText(value, signal))
    if (out === undefined) return
    if (out === value) return toast(`${label}没有需要润色的地方`, 'info')
    setPreview(out)
  }

  const apply = () => {
    if (preview === null) return
    const before = value
    onApply(preview)
    setPreview(null)
    toast(`已润色${label}`, 'success', { label: '撤销', run: () => onApply(before) })
  }

  return (
    <>
      <AiButton
        variant="ghost"
        loading={!!running}
        disabled={disabled || !value.trim()}
        onClick={start}
        title={`只润色${label}的措辞，先看前后对比再决定是否采用`}
        data-polish={label}
        className={compact ? COMPACT : undefined}
      >
        AI 润色
      </AiButton>
      {preview !== null && (
        <CompareModal
          title={`AI 润色 · ${label}`}
          desc="只改措辞，意思和结构不变；改动的行标了底色"
          before={value}
          after={preview}
          afterTitle="润色后"
          onClose={() => setPreview(null)}
          onApply={apply}
        />
      )}
    </>
  )
}

/**
 * AI 生成一项。basis 是生成依据，写在按钮提示和对比弹窗里。
 * 空着就直接写进去（提示里可以撤销）；已经有内容时先出前后对比，点「采用」才替换。
 */
export function GenerateButton({
  value,
  label,
  basis,
  disabled,
  compact,
  generate,
  onApply,
}: {
  value: string
  label: string
  basis: string
  disabled?: boolean
  compact?: boolean
  generate: (signal: AbortSignal) => Promise<string>
  onApply: (text: string) => void
}) {
  const { running, run } = useAiTask()
  const [preview, setPreview] = useState<string | null>(null)

  const start = async () => {
    const out = await run('generate', generate)
    if (out === undefined) return
    if (!value.trim()) {
      const before = value
      onApply(out)
      return toast(`已生成${label}`, 'success', { label: '撤销', run: () => onApply(before) })
    }
    if (out.trim() === value.trim()) return toast(`生成的${label}和现在一样`, 'info')
    setPreview(out)
  }

  const apply = () => {
    if (preview === null) return
    const before = value
    onApply(preview)
    setPreview(null)
    toast(`已替换${label}`, 'success', { label: '撤销', run: () => onApply(before) })
  }

  return (
    <>
      <AiButton variant="ghost" loading={!!running} disabled={disabled} onClick={start} title={`生成逻辑：${basis}`} data-generate={label} className={compact ? COMPACT : undefined}>
        AI 生成
      </AiButton>
      {preview !== null && (
        <CompareModal
          title={`AI 生成 · ${label}`}
          desc={`生成依据：${basis}。采用后替换现在的内容`}
          before={value}
          after={preview}
          afterTitle="生成结果"
          onClose={() => setPreview(null)}
          onApply={apply}
        />
      )}
    </>
  )
}
