/** 剧本正文编辑器：草稿与正文章节共用。像稿纸一样排版，点选一段在上方浮出工具条；框选部分文字时只改选中的部分 */
import clsx from 'clsx'
import { BotMessageSquare, ListPlus, Loader2, PenLine, Sparkles, StickyNote, Trash2, X } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode, TextareaHTMLAttributes } from 'react'
import { latestProject, useAiTask } from '../../../components/stage/StageKit'
import type { LineNote, Project, ScriptLine } from '../../../domain/types'
import { newId } from '../../../lib/id'
import { extendText, nextSeed, reviseText } from '../../../services/ai'
import type { ExtendMode, ReviseMode } from '../../../services/ai'

export type Updater<T> = (update: (list: T[]) => T[]) => void

const short = (text: string, n = 14) => (text.length > n ? `${text.slice(0, n)}…` : text)

/** “添加到助手”记成一条标注：AI 修稿按标注改写，这段会被重点处理 */
const ASSIST_NOTE = '交给修稿助手：重点改这段'

const REVISE: { mode: ReviseMode; label: string }[] = [
  { mode: 'rewrite', label: '改写' },
  { mode: 'polish', label: '润色' },
  { mode: 'expand', label: '扩写' },
]

const EXTEND: { mode: ExtendMode; label: string }[] = [
  { mode: 'continue', label: '续写' },
  { mode: 'dialogue', label: '对话' },
]

function ToolButton({ loading, children, ...rest }: { loading?: boolean; children: ReactNode; onClick: () => void; disabled?: boolean; title?: string }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || loading}
      className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[13px] whitespace-nowrap text-ink-700 transition-colors enabled:hover:bg-brand-50 enabled:hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {loading && <Loader2 size={12} className="animate-spin" />}
      {children}
    </button>
  )
}

const Divider = () => <span className="mx-1 h-4 w-px shrink-0 bg-line" />

/** 正文段落：无边框的自适应文本框，读起来像稿纸 */
function Prose({ className, value, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      className={clsx('block w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-[15px] leading-8 focus:outline-none', className)}
      {...rest}
    />
  )
}

export function ScriptEditor({
  project,
  lines,
  readOnly,
  showEn,
  onLines,
  notes,
  onNotes,
}: {
  project: Project
  lines: ScriptLine[]
  /** 只读：正文不能改，但仍可选中、标注 */
  readOnly: boolean
  showEn: boolean
  /** 传入更新函数，由页面套在最新数据上，避免 AI 返回时覆盖期间的编辑 */
  onLines: Updater<ScriptLine>
  notes?: LineNote[]
  /** 不传时不显示标注（正文章节） */
  onNotes?: Updater<LineNote>
}) {
  const { running, run } = useAiTask()
  const [active, setActive] = useState<string | null>(null)
  const [quote, setQuote] = useState('')
  const [noteText, setNoteText] = useState('')

  const activate = (id: string) => {
    if (id === active) return
    setActive(id)
    setQuote('')
    setNoteText('')
  }

  const edit = (id: string, patch: Partial<ScriptLine>) => onLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)))

  const insertAfter = (id: string, extra: ScriptLine[]) =>
    onLines((ls) => {
      const i = ls.findIndex((l) => l.id === id)
      return i < 0 ? [...ls, ...extra] : [...ls.slice(0, i + 1), ...extra, ...ls.slice(i + 1)]
    })

  const revise = async (l: ScriptLine, mode: ReviseMode) => {
    const cur = latestProject(project.id)
    if (!cur) return
    // 框选了一部分：只改这一段，再拼回原句
    const part = quote && quote !== l.zh && l.zh.includes(quote) ? quote : ''
    const out = await run(mode, (signal) => reviseText(cur, part || l.zh, mode, l.kind, nextSeed(), signal))
    if (!out) return
    edit(l.id, part ? { zh: l.zh.replace(part, out.zh), en: undefined } : { zh: out.zh, en: out.en })
    setQuote('')
  }

  const extend = async (l: ScriptLine, mode: ExtendMode) => {
    const cur = latestProject(project.id)
    if (!cur) return
    const out = await run(mode, (signal) => extendText(cur, l, mode, nextSeed(), signal))
    if (!out?.length) return
    insertAfter(l.id, out)
    setActive(out[out.length - 1].id)
  }

  const note = (l: ScriptLine, text: string) => {
    if (!text || !onNotes) return
    onNotes((ns) => [...ns, { id: newId(), lineId: l.id, quote: quote || l.zh, text, at: new Date().toISOString() }])
    setNoteText('')
    setQuote('')
  }

  if (!lines.length) {
    return <div className="rounded-xl border border-dashed border-line px-6 py-12 text-center text-[13px] text-ink-400">正文为空</div>
  }

  const field = (l: ScriptLine, i: number, className?: string) => (
    <Prose
      aria-label={`第 ${i + 1} 段`}
      value={l.zh}
      readOnly={readOnly}
      onChange={(e) => edit(l.id, { zh: e.target.value, en: undefined })}
      onSelect={(e) => {
        const t = e.currentTarget
        setQuote(t.value.slice(t.selectionStart, t.selectionEnd).trim())
      }}
      className={className}
    />
  )

  return (
    <div className="rounded-xl border border-line bg-white py-8 pr-8 pl-14 sm:pr-12 sm:pl-16">
      {lines.map((l, i) => {
        const isActive = active === l.id
        const lineNotes = notes?.filter((n) => n.lineId === l.id) ?? []
        return (
          <div
            key={l.id}
            onFocus={() => activate(l.id)}
            onClick={() => activate(l.id)}
            className={clsx('relative -mx-3 rounded-lg px-3 transition-colors', l.kind === 'scene' && i > 0 && 'mt-5', isActive ? 'bg-brand-50/70' : 'hover:bg-canvas/70')}
          >
            {/* 左侧小行号；有标注时带个点 */}
            <span className={clsx('absolute top-[9px] -left-9 w-6 text-right text-[10px] tabular-nums select-none', isActive ? 'text-brand-500' : 'text-ink-300')}>
              {lineNotes.length > 0 && <span className="mr-1 inline-block size-1.5 rounded-full bg-amber-400 align-middle" title={`${lineNotes.length} 条标注`} />}
              {i + 1}
            </span>

            {/* 浮动工具条：贴在选中段落上方，第一段放在下方 */}
            {isActive && (onNotes || !readOnly) && (
              <div
                role="toolbar"
                aria-label="段落工具"
                onClick={(e) => e.stopPropagation()}
                className={clsx(
                  'absolute left-0 z-20 flex max-w-[calc(100%+1.5rem)] animate-fade-in items-center overflow-x-auto rounded-xl border border-line bg-white p-1 shadow-pop',
                  i === 0 ? 'top-full mt-1.5' : 'bottom-full mb-1.5',
                )}
              >
                {onNotes && (
                  <>
                    <PenLine size={13} className="ml-1.5 shrink-0 text-ink-400" />
                    <input
                      aria-label="标注内容"
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && note(l, noteText.trim())}
                      placeholder={quote ? `「${short(quote, 8)}」有什么问题？` : '这段有什么问题？'}
                      className="h-7 w-36 min-w-0 shrink-0 bg-transparent px-1.5 text-[13px] placeholder:text-ink-400 focus:outline-none"
                    />
                    <ToolButton disabled={!noteText.trim()} title="把问题记成标注，AI 修稿时按标注改写" onClick={() => note(l, noteText.trim())}>
                      <StickyNote size={13} />
                      标注
                    </ToolButton>
                    <ToolButton title="交给修稿助手：下次 AI 修稿时重点改这段" onClick={() => note(l, ASSIST_NOTE)}>
                      <BotMessageSquare size={13} />
                      添加到助手
                    </ToolButton>
                  </>
                )}
                {!readOnly && (
                  <>
                    {onNotes && <Divider />}
                    <span className="flex shrink-0 items-center gap-0.5 px-1 text-xs font-semibold text-brand-600">
                      <Sparkles size={12} />
                      AI
                    </span>
                    {REVISE.map((r) => (
                      <ToolButton
                        key={r.mode}
                        loading={running === r.mode}
                        disabled={!!running || l.kind === 'scene'}
                        title={quote ? `只${r.label}选中的部分` : `${r.label}这一段`}
                        onClick={() => revise(l, r.mode)}
                      >
                        {r.label}
                      </ToolButton>
                    ))}
                    {EXTEND.map((x) => (
                      <ToolButton key={x.mode} loading={running === x.mode} disabled={!!running} title={x.mode === 'continue' ? '接着这一段往下写' : '围绕这一段补一段对白'} onClick={() => extend(l, x.mode)}>
                        {x.label}
                      </ToolButton>
                    ))}
                    <Divider />
                    <ToolButton title="在下方插入一段动作" onClick={() => insertAfter(l.id, [{ id: newId(), kind: 'action', zh: '△ ' }])}>
                      <ListPlus size={13} />
                    </ToolButton>
                    <ToolButton title="删除这一段" onClick={() => onLines((ls) => ls.filter((x) => x.id !== l.id))}>
                      <Trash2 size={13} />
                    </ToolButton>
                  </>
                )}
                <ToolButton title="收起工具条" onClick={() => setActive(null)}>
                  <X size={13} />
                </ToolButton>
              </div>
            )}

            <div className="py-0.5">
              {l.kind === 'scene' ? (
                field(l, i, 'font-semibold text-ink-900')
              ) : l.kind === 'dialogue' ? (
                <div className="flex items-start">
                  <input
                    aria-label={`第 ${i + 1} 段说话人`}
                    value={l.speaker ?? ''}
                    readOnly={readOnly}
                    onChange={(e) => edit(l.id, { speaker: e.target.value })}
                    style={{ width: `${Math.max(2, (l.speaker ?? '').length)}em` }}
                    className="h-8 shrink-0 border-0 bg-transparent p-0 text-[15px] leading-8 font-semibold text-brand-700 focus:outline-none"
                  />
                  <span className="text-[15px] leading-8 text-ink-500">：</span>
                  <div className="min-w-0 flex-1">{field(l, i, 'text-ink-900')}</div>
                </div>
              ) : l.kind === 'hook' ? (
                <div className="my-1 border-l-2 border-amber-400 pl-3">
                  <div className="pt-1 text-[11px] font-medium text-amber-700">集末钩子</div>
                  {field(l, i, 'font-medium text-ink-900')}
                </div>
              ) : (
                field(l, i, 'text-ink-700')
              )}
              {showEn && l.en && <p className={clsx('pb-1 text-[13px] leading-6 text-ink-400', l.kind === 'scene' && 'font-medium')}>{l.en}</p>}
            </div>

            {lineNotes.length > 0 && (
              <ul className="space-y-1 pb-2">
                {lineNotes.map((n) => (
                  <li key={n.id} className="flex items-start gap-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-[12.5px] leading-5">
                    {n.text === ASSIST_NOTE ? <BotMessageSquare size={13} className="mt-[3px] shrink-0 text-brand-500" /> : <StickyNote size={13} className="mt-[3px] shrink-0 text-amber-500" />}
                    <span className="min-w-0 flex-1">
                      <span className="text-ink-400">「{short(n.quote, 20)}」</span>
                      <span className="text-ink-900">{n.text}</span>
                    </span>
                    {onNotes && (
                      <button
                        type="button"
                        aria-label="删除标注"
                        onClick={(e) => {
                          e.stopPropagation()
                          onNotes((ns) => ns.filter((x) => x.id !== n.id))
                        }}
                        className="rounded p-0.5 text-ink-400 hover:bg-amber-100 hover:text-ink-700"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}
