/**
 * 剧本正文编辑器：草稿与正文章节共用。排成 Word 式的稿纸：顶部格式栏（加粗 / 斜体 / 对齐）；段落样式用 Markdown 写法切换，
 * 支持 Markdown 写法（# 场景标题、> 集末钩子、**加粗** …），回车另起一段、行首退格并回上一段。
 * 按样稿格式显示：场景标题前自动编场次号「1-1：」、下面自动列「人物：」，台词可标内心独白（os）/ 画外音（ov），【特写】等镜头提示高亮。
 * 点选一段在上方浮出 AI 工具条；框选部分文字时只改选中的部分。选中的段落经 onPick 交给页面，由页面侧栏加标注。
 */
import clsx from 'clsx'
import { AlignCenter, AlignLeft, AlignRight, Bold, CircleHelp, Italic, ListPlus, Loader2, Sparkles, StickyNote, Trash2, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ClipboardEvent, KeyboardEvent, MouseEvent, ReactNode, TextareaHTMLAttributes } from 'react'
import { latestProject, useAiTask } from '../../../components/stage/StageKit'
import { VOICE_LABEL, formatScene, parseSpeaker, sceneCast, sceneNumbers } from '../../../domain/scriptFormat'
import type { LineNote, Project, ScriptLine, ScriptVoice } from '../../../domain/types'
import { newId } from '../../../lib/id'
import { extendText, nextSeed, reviseText } from '../../../services/ai'
import type { ExtendMode, ReviseMode } from '../../../services/ai'
import { MD_TIPS, blockShortcut, hasInline, parseBlock, parseInline, toggleWrap } from './markdown'

export type Updater<T> = (update: (list: T[]) => T[]) => void

const short = (text: string, n = 14) => (text.length > n ? `${text.slice(0, n)}…` : text)

/** 当前选中的段落，以及段内框选的文字（没框选时为空） */
export type LinePick = { lineId: string; quote: string }

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

/** 场景标题下的「人物：」——按这一场的台词与动作自动列出，不能直接改 */
function SceneCast({ cast }: { cast: string[] }) {
  if (!cast.length) return null
  return (
    <p className="text-[13px] leading-6 text-ink-500 select-none" title="按这一场说话的人与动作里写到的已登记人物自动列出">
      人物：{cast.join('，')}
    </p>
  )
}

const ALIGNS = [
  { value: undefined, label: '左对齐', icon: AlignLeft },
  { value: 'center', label: '居中', icon: AlignCenter },
  { value: 'right', label: '右对齐', icon: AlignRight },
] as const

/** 格式栏按钮：按下时不抢走正文的焦点与选区 */
function FormatButton({ label, pressed, disabled, onClick, children }: { label: string; pressed?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={clsx(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        pressed ? 'bg-brand-50 text-brand-700' : 'text-ink-700 enabled:hover:bg-canvas',
      )}
    >
      {children}
    </button>
  )
}

/** 台词声音依次切换：对白 → 内心独白（os）→ 画外音（ov）→ 对白 */
const NEXT_VOICE: Record<string, ScriptVoice | undefined> = { none: 'os', os: 'ov', ov: undefined }

/** 动作行开头的「△ 」 */
const bodyOf = (l: ScriptLine) => (l.kind === 'action' ? l.zh.replace(/^△\s*/, '') : l.zh)

/** 点击渲染后的段落时，换算成原文里的光标位置 */
function rawOffsetAt(e: MouseEvent, fallback: number) {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  let node: Node | undefined
  let offset = 0
  const pos = doc.caretPositionFromPoint?.(e.clientX, e.clientY)
  if (pos) {
    node = pos.offsetNode
    offset = pos.offset
  } else {
    const r = doc.caretRangeFromPoint?.(e.clientX, e.clientY)
    if (r) {
      node = r.startContainer
      offset = r.startOffset
    }
  }
  const seg = (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>('[data-at]')
  return seg ? Number(seg.dataset.at) + offset : fallback
}

/** 不在编辑的段落：按 Markdown 渲染加粗 / 斜体 */
function Rendered({ raw }: { raw: string }) {
  return (
    <>
      {parseInline(raw).map((s, i) => (
        <span key={i} data-at={s.at} className={clsx(s.bold && 'font-bold text-ink-900', s.italic && 'italic', s.cue && 'font-medium text-brand-700')}>
          {s.text}
        </span>
      ))}
    </>
  )
}

/** 正文段落：无边框的自适应文本框，读起来像稿纸 */
function Prose({ className, value, inputRef, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string; inputRef?: (el: HTMLTextAreaElement | null) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return (
    <textarea
      ref={(el) => {
        ref.current = el
        inputRef?.(el)
      }}
      rows={1}
      value={value}
      className={clsx('block w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-[15px] leading-8 focus:outline-none', className)}
      {...rest}
    />
  )
}

export function ScriptEditor({
  project,
  ep,
  lines,
  readOnly,
  showEn,
  onLines,
  notes,
  onNotes,
  onPick,
  focusLineId,
  tips,
}: {
  project: Project
  /** 第几集：场次号按「集-场」编 */
  ep: number
  lines: ScriptLine[]
  /** 只读：正文不能改，但仍可选中、标注 */
  readOnly: boolean
  showEn: boolean
  /** 传入更新函数，由页面套在最新数据上，避免 AI 返回时覆盖期间的编辑 */
  onLines: Updater<ScriptLine>
  notes?: LineNote[]
  /** 不传时不显示标注（正文章节） */
  onNotes?: Updater<LineNote>
  /** 选中段落变化时通知页面（侧栏据此给这段加标注） */
  onPick?: (pick: LinePick | null) => void
  /** 需要特别提示的行（版本二：从质检问题跳过来时），高亮并滚到眼前 */
  focusLineId?: string | null
  /** 本页特有的操作提示，放进格式栏的「编辑说明」 */
  tips?: ReactNode[]
}) {
  const { running, run } = useAiTask()
  const [active, setActive] = useState<string | null>(null)
  const [quote, setQuote] = useState('')
  const names = project.work.characters.map((c) => c.name.trim()).filter(Boolean)
  const sceneNo = sceneNumbers(ep, lines)
  // 每段的输入框；换段 / 拆段后要把光标放到哪里
  const inputs = useRef(new Map<string, HTMLTextAreaElement>())
  const caret = useRef<{ id: string; start: number; end?: number } | null>(null)

  useLayoutEffect(() => {
    const c = caret.current
    const el = c && inputs.current.get(c.id)
    if (!c || !el) return
    caret.current = null
    el.focus()
    el.setSelectionRange(c.start, c.end ?? c.start)
  })

  useEffect(() => onPick?.(active ? { lineId: active, quote } : null), [active, quote, onPick])

  useEffect(() => {
    if (!focusLineId) return
    requestAnimationFrame(() => document.querySelector(`[data-line-id="${focusLineId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }, [focusLineId])

  const activate = (id: string) => {
    if (id === active) return
    setActive(id)
    setQuote('')
  }

  const edit = (id: string, patch: Partial<ScriptLine>) => onLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)))

  /** 改完数据后把光标放进某段：等这次改动渲染出来再聚焦（段落样式变了输入框会重建） */
  const later = (id: string, start: number, end?: number) => {
    caret.current = { id, start, end }
    activate(id)
  }

  /** 换段：输入框已在就直接聚焦，否则等它渲染出来 */
  const focusAt = (id: string, start: number, end?: number) => {
    caret.current = { id, start, end }
    const el = inputs.current.get(id)
    if (el) {
      caret.current = null
      el.focus()
      el.setSelectionRange(start, end ?? start)
    } else activate(id)
  }

  /** 输入时识别 Markdown 行首快捷符；只在这次输入刚好凑出快捷符时转换，已有内容不被误改 */
  const change = (l: ScriptLine, zh: string) => {
    const who = l.kind === 'action' ? names : []
    const hit = zh.length > l.zh.length && !blockShortcut(l.zh, who) ? blockShortcut(zh, who) : null
    if (!hit) return edit(l.id, { zh, en: undefined })
    edit(l.id, { speaker: undefined, voice: undefined, ...hit, en: undefined })
    later(l.id, hit.zh?.length ?? 0)
  }

  /** 回车：在光标处拆成两段；在段尾回车时另起一段动作 */
  const split = (l: ScriptLine, el: HTMLTextAreaElement) => {
    const before = l.zh.slice(0, el.selectionStart)
    const after = l.zh.slice(el.selectionEnd)
    let next: ScriptLine
    if (!after.trim()) next = { id: newId(), kind: 'action', zh: '△ ' }
    else if (l.kind === 'action') next = { id: newId(), kind: 'action', zh: `△ ${after.replace(/^△?\s*/, '')}` }
    else next = { id: newId(), kind: l.kind, zh: after, ...(l.speaker !== undefined ? { speaker: l.speaker, speakerEn: l.speakerEn, voice: l.voice } : {}), ...(l.align ? { align: l.align } : {}) }
    onLines((ls) => ls.flatMap((x) => (x.id === l.id ? [{ ...x, zh: before, en: undefined }, next] : [x])))
    later(next.id, next.kind === 'action' ? 2 : 0)
  }

  /** 行首退格：并回上一段 */
  const merge = (l: ScriptLine, i: number) => {
    const prev = lines[i - 1]
    if (!prev) return
    const join = prev.zh.length
    const body = bodyOf(l)
    onLines((ls) => ls.filter((x) => x.id !== l.id).map((x) => (x.id === prev.id && body ? { ...x, zh: x.zh + body, en: undefined } : x)))
    later(prev.id, join)
  }

  const keyDown = (l: ScriptLine, i: number, e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    const el = e.currentTarget
    const collapsed = el.selectionStart === el.selectionEnd
    if ((e.metaKey || e.ctrlKey) && !readOnly && (e.key === 'b' || e.key === 'i')) {
      e.preventDefault()
      return wrap(l, e.key === 'b' ? '**' : '*')
    }
    if (e.key === 'ArrowUp' && collapsed && el.selectionStart === 0 && i > 0) {
      e.preventDefault()
      return focusAt(lines[i - 1].id, lines[i - 1].zh.length)
    }
    if (e.key === 'ArrowDown' && collapsed && el.selectionEnd === el.value.length && i < lines.length - 1) {
      e.preventDefault()
      return focusAt(lines[i + 1].id, 0)
    }
    if (readOnly || e.altKey || e.metaKey || e.ctrlKey) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      split(l, el)
    } else if (e.key === 'Backspace' && collapsed && el.selectionStart === 0 && i > 0) {
      e.preventDefault()
      merge(l, i)
    }
  }

  /** 粘贴多行：第一行接在光标处，其余每行一段，按 Markdown 认出段落样式 */
  const paste = (l: ScriptLine, e: ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData('text/plain')
    if (readOnly || !/\r?\n/.test(text.trim())) return
    e.preventDefault()
    const el = e.currentTarget
    const [first, ...rest] = text.trim().split(/\r?\n/).filter((x) => x.trim())
    const before = l.zh.slice(0, el.selectionStart)
    const after = l.zh.slice(el.selectionEnd)
    const extra = rest.map((x) => parseBlock(x.trim(), names)).filter((x) => x !== null)
    const last = extra.at(-1)
    if (!last) return
    const end = last.zh.length
    last.zh += after
    onLines((ls) => ls.flatMap((x) => (x.id === l.id ? [{ ...x, zh: before + first, en: undefined }, ...extra] : [x])))
    later(last.id, end)
  }

  /** 加粗 / 斜体：作用在当前段落的选区上 */
  const wrap = (l: ScriptLine, mark: '**' | '*') => {
    const el = inputs.current.get(l.id)
    const start = el?.selectionStart ?? l.zh.length
    const end = el?.selectionEnd ?? l.zh.length
    const out = toggleWrap(l.zh, start, end, mark)
    edit(l.id, { zh: out.text, en: undefined })
    later(l.id, out.start, out.end)
  }

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

  if (!lines.length) {
    return <div className="rounded-xl border border-dashed border-line px-6 py-12 text-center text-[13px] text-ink-400">正文为空</div>
  }

  const field = (l: ScriptLine, i: number, className?: string) => {
    const align = l.align && (l.align === 'center' ? 'text-center' : 'text-right')
    // 带加粗 / 斜体的段落不在编辑时按渲染效果显示，点进去再显示 Markdown 原文
    if (active !== l.id && hasInline(l.zh)) {
      return (
        <div
          role="textbox"
          tabIndex={0}
          aria-label={`第 ${i + 1} 段`}
          aria-readonly={readOnly || undefined}
          onMouseDown={(e) => {
            caret.current = { id: l.id, start: rawOffsetAt(e, l.zh.length) }
          }}
          onFocus={() => {
            caret.current ??= { id: l.id, start: l.zh.length }
            activate(l.id)
          }}
          className={clsx('block w-full cursor-text text-[15px] leading-8 break-words whitespace-pre-wrap focus:outline-none', align, className)}
        >
          <Rendered raw={l.zh} />
        </div>
      )
    }
    return (
      <Prose
        aria-label={`第 ${i + 1} 段`}
        value={l.zh}
        readOnly={readOnly}
        inputRef={(el) => {
          if (el) inputs.current.set(l.id, el)
          else inputs.current.delete(l.id)
        }}
        onChange={(e) => change(l, e.target.value)}
        // 场景标题离开时整理成「日，外，地点」
        onBlur={() => {
          const zh = l.kind === 'scene' && !readOnly ? formatScene(l.zh) : l.zh
          if (zh !== l.zh) edit(l.id, { zh })
        }}
        onKeyDown={(e) => keyDown(l, i, e)}
        onPaste={(e) => paste(l, e)}
        onSelect={(e) => {
          const t = e.currentTarget
          setQuote(t.value.slice(t.selectionStart, t.selectionEnd).trim())
        }}
        className={clsx(align, className)}
      />
    )
  }

  const current = lines.find((l) => l.id === active)
  const ribbon = !readOnly && (
    <div role="toolbar" aria-label="格式" className="sticky top-stick-0 z-30 flex flex-wrap items-center gap-0.5 rounded-t-xl border-b border-line bg-white/95 px-3 py-1.5 backdrop-blur">
      <FormatButton label="加粗（⌘B）" disabled={!current} onClick={() => current && wrap(current, '**')}>
        <Bold size={14} strokeWidth={2.5} />
      </FormatButton>
      <FormatButton label="斜体（⌘I）" disabled={!current} onClick={() => current && wrap(current, '*')}>
        <Italic size={14} />
      </FormatButton>
      <Divider />
      {ALIGNS.map((a) => (
        <FormatButton
          key={a.label}
          label={a.label}
          pressed={!!current && current.align === a.value}
          disabled={!current}
          onClick={() => {
            if (!current) return
            edit(current.id, { align: a.value })
            const el = inputs.current.get(current.id)
            later(current.id, el?.selectionStart ?? 0, el?.selectionEnd)
          }}
        >
          <a.icon size={14} />
        </FormatButton>
      ))}
      <span className="flex-1" />
      {/* 编辑说明：原来压在正文上方的操作提示收进这里，悬停或聚焦时展开；用 pt 留缝，指针移进浮层时不会断开 */}
      <span className="group relative">
        <button type="button" className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-500 hover:bg-canvas hover:text-ink-900 focus:outline-none">
          <CircleHelp size={13} />
          编辑说明
        </button>
        <div className="invisible absolute top-full right-0 z-40 w-80 pt-1.5 opacity-0 transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
          <div role="tooltip" className="rounded-lg border border-line bg-white p-3 text-left shadow-pop">
            <ul className="mb-2.5 space-y-1 border-b border-line pb-2.5 text-xs leading-5 text-ink-700">
              {['点选一段浮出 AI 工具条：改写 / 润色 / 扩写 / 续写 / 改成对话；框选部分文字时只改选中的部分', ...(tips ?? []), '修改自动保存'].map((tip, i) => (
                <li key={i} className="flex gap-1.5">
                  <span className="mt-2 size-1 shrink-0 rounded-full bg-ink-300" />
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
            <div className="mb-1.5 text-[13px] font-medium text-ink-900">支持 Markdown 写法</div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs leading-5">
              {MD_TIPS.map((t) => (
                <div key={t.code} className="contents">
                  <dt className="font-mono text-brand-700">{t.code}</dt>
                  <dd className="text-ink-700">{t.label}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 border-t border-line pt-2 text-xs leading-5 text-ink-500">回车另起一段，Shift + 回车段内换行；在段首按退格并回上一段；粘贴多行文字会自动分段。</p>
          </div>
        </div>
      </span>
    </div>
  )

  return (
    <div className="rounded-xl border border-line bg-canvas" data-editor>
      {ribbon}
      {/* 稿纸：铺满编辑区，底色与页面背景一致 */}
      <div className="min-h-[60vh] py-8 pr-6 pl-14 sm:pr-10 sm:pl-16">
        {lines.map((l, i) => {
          const isActive = active === l.id
          const lineNotes = notes?.filter((n) => n.lineId === l.id) ?? []
          return (
            <div
              key={l.id}
              data-line-id={focusLineId ? l.id : undefined}
              onFocus={() => activate(l.id)}
              onClick={() => activate(l.id)}
              className={clsx(
                'relative -mx-3 rounded-lg px-3 transition-colors',
                l.kind === 'scene' && i > 0 && 'mt-5',
                isActive ? 'bg-brand-50/70' : 'hover:bg-white/70',
                focusLineId === l.id && 'ring-2 ring-amber-400 ring-offset-2',
              )}
            >
              {/* 左侧小行号；有标注时带个点 */}
              <span className={clsx('absolute top-[9px] -left-9 w-6 text-right text-[10px] tabular-nums select-none', isActive ? 'text-brand-500' : 'text-ink-300')}>
                {lineNotes.length > 0 && <span className="mr-1 inline-block size-1.5 rounded-full bg-amber-400 align-middle" title={`${lineNotes.length} 条标注`} />}
                {i + 1}
              </span>

              {/* 浮动 AI 工具条：贴在选中段落上方，第一段放在下方 */}
              {isActive && !readOnly && (
                <div
                  role="toolbar"
                  aria-label="段落工具"
                  onClick={(e) => e.stopPropagation()}
                  className={clsx(
                    'absolute left-0 z-20 flex max-w-[calc(100%+1.5rem)] animate-fade-in items-center overflow-x-auto rounded-xl border border-line bg-white p-1 shadow-pop',
                    i === 0 ? 'top-full mt-1.5' : 'bottom-full mb-1.5',
                  )}
                >
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
                  <ToolButton title="收起工具条" onClick={() => setActive(null)}>
                    <X size={13} />
                  </ToolButton>
                </div>
              )}

              <div className="py-0.5">
                {l.kind === 'scene' ? (
                  <>
                    <div className="flex items-start">
                      <span className="shrink-0 text-[15px] leading-8 font-semibold text-ink-400 tabular-nums select-none" title="场次号：集-场，按顺序自动编">
                        {sceneNo.get(l.id)}：
                      </span>
                      <div className="min-w-0 flex-1">{field(l, i, 'font-semibold text-ink-900')}</div>
                    </div>
                    <SceneCast cast={sceneCast(lines, i, names)} />
                  </>
                ) : l.kind === 'dialogue' ? (
                  <div className="flex items-start">
                    <input
                      aria-label={`第 ${i + 1} 段说话人`}
                      value={l.speaker ?? ''}
                      readOnly={readOnly}
                      onChange={(e) => edit(l.id, { speaker: e.target.value })}
                      // 说话人里直接写了 os / （ov）：拆成名字与声音
                      onBlur={() => {
                        const who = parseSpeaker(l.speaker ?? '')
                        if (who.voice) edit(l.id, { speaker: who.speaker, voice: who.voice })
                      }}
                      style={{ width: `${Math.max(2, (l.speaker ?? '').length)}em` }}
                      className="h-8 shrink-0 border-0 bg-transparent p-0 text-[15px] leading-8 font-semibold text-ink-900 focus:outline-none"
                    />
                    {(l.voice || (isActive && !readOnly)) && (
                      <button
                        type="button"
                        aria-label={`第 ${i + 1} 段台词声音`}
                        title={`${l.voice ? VOICE_LABEL[l.voice] : '对白'}；点击切换：对白 → 内心独白（os）→ 画外音（ov）`}
                        disabled={readOnly}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => {
                          e.stopPropagation()
                          edit(l.id, { voice: NEXT_VOICE[l.voice ?? 'none'] })
                        }}
                        className={clsx(
                          'h-8 shrink-0 rounded px-0.5 leading-8 disabled:cursor-default',
                          l.voice ? 'text-[15px] font-semibold text-brand-700' : 'text-[11px] text-ink-300 hover:text-brand-600',
                        )}
                      >
                        {l.voice === 'os' ? 'os' : l.voice === 'ov' ? '（ov）' : 'os/ov'}
                      </button>
                    )}
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
                      <StickyNote size={13} className="mt-[3px] shrink-0 text-amber-500" />
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
    </div>
  )
}
