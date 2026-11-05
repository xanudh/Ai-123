import clsx from 'clsx'
import { ArrowLeft, ClipboardCopy, FlaskConical, Info, Loader2, Lock, LockOpen, RotateCcw, Send, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ConfirmDialog } from '../../../components/overlay'
import { AutoTextarea, useAiTask } from '../../../components/stage/StageKit'
import { Badge, Button, Card } from '../../../components/ui'
import { newId } from '../../../lib/id'
import { PLAN_ORDER, chatAsk, chatContext, chatDirections, chatIdea, chatNext, chatPick, chatReply, fieldTitle, nextSeed, planText } from '../../../services/ai'
import type { ChatAction, ChatChange, ChatReply, Direction, PlanField, RewritePlan } from '../../../services/ai'
import { emptyChat, useRewriteChat } from '../../../store/rewriteChat'
import type { ChatMsg, ChatState } from '../../../store/rewriteChat'
import { toast } from '../../../store/toast'
import { useCurrentProject } from '../ProjectLayout'

/** 每轮带上的最近对话轮数；更早的压成摘要 */
const RECENT_TURNS = 6

const now = () => new Date().toISOString()
const msg = (role: ChatMsg['role'], text: string, extra: Partial<ChatMsg> = {}): ChatMsg => ({ id: newId(), role, text, at: now(), ...extra })

/** 这一轮改了哪几项：改前划掉、改后照常 */
function ChangeList({ changes }: { changes: ChatChange[] }) {
  return (
    <ul data-chat-changes className="mt-2 space-y-1.5 rounded-lg border border-line bg-white px-3 py-2 text-[12.5px] leading-5">
      {changes.map((c, i) => (
        <li key={i}>
          <span className="mr-1.5 font-medium text-ink-900">{fieldTitle(c.field)}</span>
          <span className="text-ink-400 line-through">{c.before}</span>
          <div className="text-ink-800">{c.after}</div>
        </li>
      ))}
    </ul>
  )
}

/** 起步时的几个方向：大路对了就选 */
function DirectionCards({ list, active, onPick }: { list: Direction[]; active: boolean; onPick: (d: Direction) => void }) {
  return (
    <div className="mt-2 grid gap-2 md:grid-cols-3">
      {list.map((d) => (
        <div key={d.id} data-chat-direction className="flex flex-col gap-2 rounded-lg border border-line bg-white p-3 text-xs leading-5 text-ink-600">
          <Badge tone="violet" className="self-start">
            {d.title}
          </Badge>
          <p className="text-[12.5px] text-ink-700">{d.pitch}</p>
          <p className="line-clamp-4 font-medium text-ink-900">{d.logline}</p>
          <Button variant="secondary" size="sm" className="mt-auto self-start" disabled={!active} onClick={() => onPick(d)}>
            就选这个方向
          </Button>
        </div>
      ))}
    </div>
  )
}

function Bubble({ m, active, busy, onAct, onPick }: { m: ChatMsg; active: boolean; busy: boolean; onAct: (a: ChatAction) => void; onPick: (d: Direction) => void }) {
  if (m.role === 'note')
    return (
      <div data-chat-note className="text-center text-[11.5px] text-ink-400">
        <span className="rounded-full bg-ink-900/[0.04] px-2.5 py-0.5">{m.text}</span>
        {m.changes && (
          <div className="mx-auto mt-1 max-w-[560px] text-left">
            <ChangeList changes={m.changes} />
          </div>
        )}
      </div>
    )
  if (m.role === 'user')
    return (
      <div data-chat-msg="user" className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-brand-600 px-3.5 py-2 text-[13px] leading-6 whitespace-pre-line text-white">{m.text}</div>
      </div>
    )
  return (
    <div data-chat-msg="ai" className="flex gap-2.5">
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-600">
        <Sparkles size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="rounded-2xl rounded-tl-md bg-canvas px-3.5 py-2.5 text-[13px] leading-6 text-ink-800">
          <p className="whitespace-pre-line">{m.text}</p>
          {m.directions && <DirectionCards list={m.directions} active={active && !busy} onPick={onPick} />}
          {m.changes && <ChangeList changes={m.changes} />}
          {m.notes && (
            <ul data-chat-notes className="mt-2 space-y-0.5 text-xs leading-5 text-amber-800">
              {m.notes.map((n) => (
                <li key={n}>· {n}</li>
              ))}
            </ul>
          )}
          {m.version && <div className="mt-1.5 text-[11px] text-ink-400 tabular-nums">方案存为 v{m.version}</div>}
        </div>
        {active && !!m.options?.length && (
          <div data-chat-options className="mt-2 flex flex-wrap gap-1.5">
            {m.options.map((o) => (
              <button
                key={o.label}
                disabled={busy}
                onClick={() => onAct(o.action)}
                className={clsx(
                  'rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-50',
                  o.action.kind === 'lock' ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:border-emerald-400' : 'border-line bg-white text-ink-700 hover:border-brand-300 hover:text-brand-700',
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** 右侧方案里的一项：没锁定的可以直接改字，离开输入框存一版；锁定的只读 */
function FieldBox({ field, value, locked, current, onLock, onSave }: { field: PlanField; value: string; locked: boolean; current: boolean; onLock: () => void; onSave: (v: string) => void }) {
  const [text, setText] = useState(value)
  return (
    <section data-plan-field={field} data-locked={locked || undefined} className={clsx('rounded-lg border px-3 py-2', locked ? 'border-emerald-200 bg-emerald-50/40' : current ? 'border-brand-300 bg-brand-50/30' : 'border-line')}>
      <div className="flex items-center gap-1.5">
        <span className="text-[12.5px] font-semibold text-ink-900">{fieldTitle(field)}</span>
        {current && !locked && <Badge tone="violet">正在聊</Badge>}
        <button
          aria-label={locked ? `解锁${fieldTitle(field)}` : `锁定${fieldTitle(field)}`}
          aria-pressed={locked}
          onClick={onLock}
          title={locked ? '已锁定：AI 不会改这一项。点一下解锁' : '锁定后 AI 不会再改这一项'}
          className={clsx('ml-auto flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px]', locked ? 'text-emerald-700 hover:bg-emerald-100' : 'text-ink-400 hover:bg-canvas hover:text-ink-700')}
        >
          {locked ? <Lock size={12} /> : <LockOpen size={12} />}
          {locked ? '已锁定' : '锁定'}
        </button>
      </div>
      <AutoTextarea
        inline
        aria-label={fieldTitle(field)}
        readOnly={locked}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text.trim() !== value.trim() && onSave(text.trim())}
        className="mt-0.5 text-[12.5px] leading-5 text-ink-700"
      />
    </section>
  )
}

function PlanPanel({ chat, onLock, onSave, onRestore }: { chat: ChatState; onLock: (f: PlanField) => void; onSave: (f: PlanField, v: string) => void; onRestore: (i: number) => void }) {
  const plan = chat.versions[chat.current]
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(planText(plan))
      toast('已复制改写方案')
    } catch {
      toast('复制失败，请手动选中文字复制', 'error')
    }
  }
  return (
    <Card className="lg:sticky lg:top-stick">
      <div className="border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <h3 className="text-[14px] font-semibold text-ink-900">当前方案</h3>
          {plan && <span className="text-xs text-ink-500 tabular-nums">v{chat.current + 1}</span>}
          {plan && (
            <Button variant="ghost" size="sm" className="ml-auto" onClick={copy}>
              <ClipboardCopy size={13} />
              复制
            </Button>
          )}
        </div>
        {plan && (
          <>
            <div className="mt-1.5 flex items-center gap-2 text-xs text-ink-500">
              <span>方向：{plan.title}</span>
              <span className="ml-auto tabular-nums">已锁定 {chat.locks.length}/{PLAN_ORDER.length}</span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink-900/[0.06]">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${(chat.locks.length / PLAN_ORDER.length) * 100}%` }} />
            </div>
          </>
        )}
      </div>
      {plan ? (
        <div className="scrollbar-thin space-y-2 overflow-y-auto p-3 lg:max-h-stick">
          {PLAN_ORDER.map((f) => (
            <FieldBox key={`${chat.current}-${f}`} field={f} value={plan.fields[f]} locked={chat.locks.includes(f)} current={chat.topic === f} onLock={() => onLock(f)} onSave={(v) => onSave(f, v)} />
          ))}
          {chat.versions.length > 1 && (
            <div data-plan-versions className="flex flex-wrap items-center gap-1 pt-1 text-xs">
              <span className="mr-1 text-ink-500">回到</span>
              {chat.versions.map((_, i) => (
                <button
                  key={i}
                  aria-pressed={i === chat.current}
                  disabled={i === chat.current}
                  onClick={() => onRestore(i)}
                  className={clsx('rounded-md border px-1.5 py-0.5 tabular-nums', i === chat.current ? 'border-brand-500 font-medium text-brand-700' : 'border-line text-ink-500 hover:border-brand-200')}
                >
                  v{i + 1}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className="px-4 py-6 text-[13px] leading-6 text-ink-400">选定一个方向，或直接说出你的想法，方案就会出现在这里。之后每改一次存一版，可以随时回到任意一版。</p>
      )}
    </Card>
  )
}

/**
 * 改写方案 · 多轮对话 Demo：编剧和 AI 来回磨十几轮。先给方向，选定后按引导一项一项聊；
 * 每轮只改提到的那几项，锁定的不动，每改一次存一版。单独一页，进度存在本机，不读写正式流程。
 */
export default function RewriteChat() {
  const project = useCurrentProject()
  const chat = useRewriteChat((s) => s.chats[project.id]) ?? emptyChat()
  const patch = useRewriteChat((s) => s.patch)
  const reset = useRewriteChat((s) => s.reset)
  const { running, run } = useAiTask()
  const [input, setInput] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const get = () => useRewriteChat.getState().chats[project.id] ?? emptyChat()
  const set = (p: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) => patch(project.id, p)
  const plan: RewritePlan | undefined = chat.versions[chat.current]
  const lastAi = chat.messages.filter((m) => m.role === 'ai').at(-1)?.id
  const turns = chat.messages.filter((m) => m.role === 'user').length
  const ctx = chatContext(project)

  // 新消息出来滚到底
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [chat.messages.length, running])

  const applyReply = (r: ChatReply) =>
    set((s) => {
      const versions = r.plan ? [...s.versions, r.plan] : s.versions
      const extra: Partial<ChatMsg> = {
        ...(r.directions && { directions: r.directions }),
        ...(r.changes?.length && { changes: r.changes }),
        ...(r.notes?.length && { notes: r.notes }),
        ...(r.options.length && { options: r.options }),
        ...(r.plan && { version: versions.length }),
      }
      return { messages: [...s.messages, msg('ai', r.text, extra)], versions, current: r.plan ? versions.length - 1 : s.current, topic: r.topic }
    })

  /** 编剧说一句（打字或点快捷回复），等 AI 回 */
  const turn = async (shown: string, task: (signal: AbortSignal) => Promise<ChatReply>) => {
    set((s) => ({ messages: [...s.messages, msg('user', shown)] }))
    const r = await run('reply', task)
    if (r) applyReply(r)
  }

  const send = (raw: string) => {
    const text = raw.trim()
    if (!text || running) return
    setInput('')
    const c = get()
    const cur = c.versions[c.current]
    if (!cur) return turn(text, (signal) => chatIdea(project, text, signal))
    return turn(text, (signal) => chatReply(project, cur, c.locks, c.topic, text, nextSeed(), signal))
  }

  const restore = (i: number) => {
    const c = get()
    if (i < 0 || !c.versions[i]) return toast('已经是第一版了', 'info')
    set((s) => {
      const versions = [...s.versions, s.versions[i]]
      return { versions, current: versions.length - 1, messages: [...s.messages, msg('note', `回到 v${i + 1} 的内容，存为 v${versions.length}`)] }
    })
  }

  const act = (a: ChatAction) => {
    const c = get()
    const cur = c.versions[c.current]
    if (a.kind === 'say') return send(a.text)
    if (a.kind === 'focus') return inputRef.current?.focus()
    if (a.kind === 'refresh') return turn('都不对，换一批', (signal) => chatDirections(project, nextSeed(), signal))
    if (!cur) return
    switch (a.kind) {
      case 'lock': {
        const locks = [...new Set([...c.locks, a.field])]
        set({ locks })
        return turn(`锁定「${fieldTitle(a.field)}」`, (signal) => chatNext(project, cur, locks, a.field, 'lock', signal))
      }
      case 'skip':
        return turn(`「${fieldTitle(a.field)}」先跳过`, (signal) => chatNext(project, cur, c.locks, a.field, 'skip', signal))
      case 'ask':
        return turn(`不改了，接着聊「${fieldTitle(a.field)}」`, (signal) => chatAsk(project, cur, a.field, signal))
      case 'unlock': {
        const locks = c.locks.filter((f) => f !== a.field)
        set({ locks })
        return turn(`解锁「${fieldTitle(a.field)}」，按刚才说的改`, (signal) => chatReply(project, cur, locks, c.topic, a.text, nextSeed(), signal))
      }
      case 'undo':
        return restore(c.current - 1)
    }
  }

  const pickDirection = (d: Direction) => {
    const c = get()
    return turn(`就选「${d.title}」`, (signal) => chatPick(project, d, c.versions[c.current] ?? null, c.locks, signal))
  }

  /** 右侧直接改字：存一版，在对话里留一行旁注，下一轮 AI 就按改过的来 */
  const saveField = (f: PlanField, value: string) =>
    set((s) => {
      const base = s.versions[s.current]
      if (!base) return {}
      const versions = [...s.versions, { ...base, fields: { ...base.fields, [f]: value } }]
      return {
        versions,
        current: versions.length - 1,
        messages: [...s.messages, msg('note', `你直接改了「${fieldTitle(f)}」，存为 v${versions.length}`, { changes: [{ field: f, before: base.fields[f], after: value }] })],
      }
    })

  const toggleLock = (f: PlanField) =>
    set((s) => {
      const on = !s.locks.includes(f)
      return { locks: on ? [...s.locks, f] : s.locks.filter((x) => x !== f), messages: [...s.messages, msg('note', on ? `锁定了「${fieldTitle(f)}」` : `解锁了「${fieldTitle(f)}」`)] }
    })

  return (
    <div className="space-y-4" data-rewrite-chat>
      <div className="flex flex-wrap items-center gap-4 text-[13px]">
        <Link to={`/projects/${project.id}/stage/architecture`} className="inline-flex items-center gap-1 text-ink-500 hover:text-ink-900">
          <ArrowLeft size={14} />
          回到故事架构
        </Link>
        <Link to={`/projects/${project.id}/lab/architecture`} className="inline-flex items-center gap-1 text-brand-700 hover:underline">
          <FlaskConical size={13} />
          另一个 Demo：故事架构 · 新版
        </Link>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            改写方案 · 多轮对话
            <Badge tone="orange">
              <FlaskConical size={11} />
              Demo
            </Badge>
          </h2>
          <p className="mt-1 flex items-start gap-1.5 text-[13px] leading-6 text-ink-500">
            <Info size={14} className="mt-[5px] shrink-0 text-ink-400" />
            和 AI 来回磨改写方案：先给方向，选定后按引导一项一项聊；满意的锁定，AI 不会再动；每改一次存一版，随时回得去。这一页单独试验，不读写正式流程。
          </p>
        </div>
        {chat.messages.length > 0 && (
          <Button variant="ghost" size="sm" disabled={!!running} onClick={() => setConfirmReset(true)}>
            <RotateCcw size={14} />
            重新开始
          </Button>
        )}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="flex min-w-0 flex-col">
          <div data-chat-context className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-2.5 text-xs text-ink-500">
            <span className="font-medium text-ink-700 tabular-nums">第 {turns} 轮</span>
            <span title={ctx.skipped.length ? `不带：${ctx.skipped.join('、')}` : undefined}>
              每轮带给 AI：{ctx.source} · 当前方案{plan ? ` v${chat.current + 1}` : ''} · 锁定的 {chat.locks.length} 项 · 最近 {RECENT_TURNS} 轮对话（更早的压成摘要）
            </span>
          </div>

          <div ref={listRef} data-chat-list className="scrollbar-thin h-[min(62vh,640px)] min-h-[360px] space-y-4 overflow-y-auto px-4 py-4">
            {chat.messages.length === 0 && (
              <div className="flex gap-2.5">
                <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-600">
                  <Sparkles size={14} />
                </span>
                <div className="rounded-2xl rounded-tl-md bg-canvas px-3.5 py-2.5 text-[13px] leading-6 text-ink-800">
                  <p>
                    我是改写助手。先读{ctx.source}，给你几个方向；选定一个后，我们按「核心设定 → 主角 → 反派与冲突 → 爽点 → 结局 → 保留 / 改动」一项一项磨。
                  </p>
                  <p className="mt-1 text-ink-500">满意的项点「锁定」，后面怎么改都不会碰它；也可以直接在右边改字。已经有想法的话，直接在下面写。</p>
                  <Button size="sm" className="mt-2.5" disabled={!!running} onClick={() => turn('先给我几个方向', (signal) => chatDirections(project, nextSeed(), signal))}>
                    <Sparkles size={14} />
                    先给我几个方向
                  </Button>
                </div>
              </div>
            )}
            {chat.messages.map((m) => (
              <Bubble key={m.id} m={m} active={m.id === lastAi} busy={!!running} onAct={act} onPick={pickDirection} />
            ))}
            {running && (
              <div data-chat-typing className="flex items-center gap-2 pl-9 text-xs text-ink-400">
                <Loader2 size={13} className="animate-spin" />
                AI 正在想…
              </div>
            )}
          </div>

          <div className="border-t border-line p-3">
            <div className="flex items-end gap-2">
              <AutoTextarea
                ref={inputRef}
                aria-label="对 AI 说"
                minRows={2}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    send(input)
                  }
                }}
                placeholder={
                  plan
                    ? '说说哪里不对、想怎么改；点名某一项（如“主角”“结局”）就只改那一项，没点名就改正在聊的这项。Enter 发送，Shift + Enter 换行'
                    : '已经有想法了？直接写下来，AI 整理成方案；没有就点上面的「先给我几个方向」'
                }
              />
              <Button aria-label="发送" disabled={!input.trim() || !!running} onClick={() => send(input)}>
                <Send size={15} />
              </Button>
            </div>
          </div>
        </Card>

        <PlanPanel chat={chat} onLock={toggleLock} onSave={saveField} onRestore={restore} />
      </div>

      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={() => {
          reset(project.id)
          setConfirmReset(false)
        }}
        title="重新开始？"
        desc="对话和各版方案都会清空。正式流程里的故事架构不受影响。"
        confirmText="重新开始"
        danger
      />
    </div>
  )
}
