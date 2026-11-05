import clsx from 'clsx'
import { ArrowLeft, ArrowRight, Check, ClipboardCopy, FlaskConical, Info, MessagesSquare, RotateCcw, TriangleAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ConfirmDialog } from '../../../components/overlay'
import { PolishButton } from '../../../components/project/PolishButton'
import { AiButton, AutoTextarea, InlineInput, Table, useAiTask } from '../../../components/stage/StageKit'
import { Badge, Button, Card, Field, Input, Segmented } from '../../../components/ui'
import { LAB_META, LAB_ORDER, draftLabSkeletons, formulaText, labExport, labReference, nextSeed, rewriteLabItem, valueText } from '../../../services/ai'
import type { LabKey, LabSkeleton, LabValue } from '../../../services/ai'
import { emptyLab, useArchLab } from '../../../store/archLab'
import type { LabItem, LabState } from '../../../store/archLab'
import { toast } from '../../../store/toast'
import { useCurrentProject } from '../ProjectLayout'

const h = 'mb-1 text-[11px] font-semibold tracking-wide text-ink-400'

/** 一项内容的只读展示：节奏框架是分段列表，其余是多行文字 */
function ValueView({ k, v, clamp }: { k: LabKey; v: LabValue; clamp?: boolean }) {
  if (k === 'rhythm')
    return (
      <div className="space-y-1">
        <ol className={clsx('space-y-1', clamp && 'line-clamp-4')}>
          {(v.beats ?? []).map((b, i) => (
            <li key={i}>
              <span className="font-medium text-ink-700">{b.beat}</span>
              <span className="ml-1.5 text-ink-400 tabular-nums">{b.range}</span>
              <span className="ml-1.5">{b.content}</span>
            </li>
          ))}
        </ol>
        {!!v.paywalls?.length && <div className="text-ink-500">付费卡点：第 {v.paywalls.join('、')} 集</div>}
        {v.text && <div className="text-ink-500">{v.text}</div>}
      </div>
    )
  return <p className={clsx('whitespace-pre-line', clamp && 'line-clamp-3')}>{v.text}</p>
}

/** 第二步：1 版或 3 版骨架并排对比，选一版开始逐项讨论 */
function Candidates({
  list,
  refreshing,
  onRefresh,
  onPick,
}: {
  list: LabSkeleton[]
  refreshing: boolean
  onRefresh: () => void
  onPick: (s: LabSkeleton) => void
}) {
  const [picked, setPicked] = useState<string | null>(list.length === 1 ? list[0].id : null)
  const chosen = list.find((s) => s.id === picked)
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h3 className="text-[15px] font-semibold text-ink-900">② 选一版</h3>
          <p className="mt-0.5 text-[13px] text-ink-500">每一版都是整部剧的骨架；大方向对了就选它，细节下一步逐项改</p>
        </div>
        <div className="flex gap-2">
          <AiButton variant="secondary" loading={refreshing} onClick={onRefresh}>
            都不行，换一批
          </AiButton>
          <Button size="sm" disabled={!chosen || refreshing} onClick={() => chosen && onPick(chosen)}>
            <Check size={14} />
            定这一版，开始逐项讨论
          </Button>
        </div>
      </div>
      <div role="radiogroup" aria-label="骨架版本" className={clsx('grid gap-3 p-5', list.length > 1 && 'lg:grid-cols-3', refreshing && 'opacity-50')}>
        {list.map((s) => {
          const on = s.id === picked
          return (
            <label
              key={s.id}
              data-lab-candidate
              className={clsx(
                'flex cursor-pointer flex-col gap-3 rounded-xl border p-4 text-xs leading-5 text-ink-500 transition-colors',
                on ? 'border-brand-500 bg-brand-50/40 ring-2 ring-brand-100' : 'border-line hover:border-brand-200',
              )}
            >
              <input type="radio" name="lab-candidate" className="sr-only" checked={on} onChange={() => setPicked(s.id)} />
              <div className="flex items-start gap-2">
                <span className={clsx('mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border', on ? 'border-brand-600 bg-brand-600' : 'border-ink-300 bg-white')}>
                  {on && <span className="size-1.5 rounded-full bg-white" />}
                </span>
                <div className="min-w-0">
                  <Badge tone="violet">{s.title}</Badge>
                  <p className="mt-1.5 text-[13px] leading-5 text-ink-700">{s.pitch}</p>
                </div>
              </div>
              {LAB_ORDER.map((k) => (
                <section key={k}>
                  <div className={h}>{LAB_META[k].title}</div>
                  {k === 'core' ? <p className="text-[13px] leading-6 font-medium text-ink-900">{s.values.core.text}</p> : <ValueView k={k} v={s.values[k]} clamp={list.length > 1} />}
                </section>
              ))}
            </label>
          )
        })}
      </div>
    </Card>
  )
}

/** 节奏框架的编辑：分段剧情逐段改，付费卡点用逗号分隔 */
function RhythmEdit({ v, onChange }: { v: LabValue; onChange: (v: LabValue) => void }) {
  const [pay, setPay] = useState((v.paywalls ?? []).join('、'))
  const commitPay = () => {
    const list = [...new Set(pay.split(/[，,、\s]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b)
    setPay(list.join('、'))
    onChange({ ...v, paywalls: list })
  }
  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-lg border border-line">
        <Table columns={['段落', '集数', '这一段发生什么']} minWidth={640}>
          {(v.beats ?? []).map((b, i) => (
            <tr key={i} className="align-top">
              <td className="w-28 px-2 py-1.5">
                <InlineInput aria-label={`第 ${i + 1} 段段落名`} value={b.beat} onChange={(e) => onChange({ ...v, beats: v.beats!.map((x, j) => (j === i ? { ...x, beat: e.target.value } : x)) })} className="font-medium" />
              </td>
              <td className="w-28 px-4 py-3 whitespace-nowrap text-ink-500 tabular-nums">{b.range}</td>
              <td className="px-2 py-1.5">
                <AutoTextarea inline aria-label={`这一段发生什么：${b.beat}`} value={b.content} onChange={(e) => onChange({ ...v, beats: v.beats!.map((x, j) => (j === i ? { ...x, content: e.target.value } : x)) })} />
              </td>
            </tr>
          ))}
        </Table>
      </div>
      <Field label="付费卡点（集）" hint="多个用顿号或逗号隔开">
        <Input aria-label="付费卡点" value={pay} onChange={(e) => setPay(e.target.value)} onBlur={commitPay} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} className="w-60" />
      </Field>
      {v.text && <p className="text-xs text-ink-500">{v.text}</p>}
    </div>
  )
}

type ItemStatus = 'done' | 'active' | 'pending'

/** 第三步里的一项：当前在讨论的展开，已定的收起显示内容，没轮到的只露一行 */
function LabRow({
  k,
  index,
  item,
  status,
  busy,
  running,
  isLast,
  onOpen,
  onEdit,
  onVersion,
  onComment,
  onRewrite,
  onDone,
  onClearStale,
}: {
  k: LabKey
  index: number
  item: LabItem
  status: ItemStatus
  busy: boolean
  running: boolean
  isLast: boolean
  onOpen: () => void
  onEdit: (v: LabValue) => void
  onVersion: (i: number) => void
  onComment: (text: string) => void
  onRewrite: () => void
  onDone: () => void
  onClearStale: () => void
}) {
  const v = item.versions[item.current]
  const meta = LAB_META[k]
  return (
    <section data-lab-item={k} data-status={status} className={clsx('border-b border-line last:border-b-0', status === 'active' && 'bg-brand-50/30')}>
      <div className="flex items-start gap-3 px-5 py-3.5">
        <span
          className={clsx(
            'mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums',
            status === 'done' ? 'bg-emerald-500 text-white' : status === 'active' ? 'bg-brand-600 text-white' : 'bg-ink-900/[0.06] text-ink-500',
          )}
        >
          {status === 'done' ? <Check size={13} /> : index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={clsx('text-[14px] font-semibold', status === 'pending' ? 'text-ink-500' : 'text-ink-900')}>{meta.title}</span>
            {status === 'done' && <Badge tone="green">已定</Badge>}
            {status === 'active' && <Badge tone="violet">讨论中</Badge>}
            {item.versions.length > 1 && <span className="text-xs text-ink-400 tabular-nums">共 {item.versions.length} 版</span>}
            {item.stale && (
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800">
                <TriangleAlert size={11} />
                {item.stale}
                <button className="ml-1 underline-offset-2 hover:underline" onClick={onClearStale}>
                  看过了，不用改
                </button>
              </span>
            )}
          </div>
          {status !== 'active' && (
            <div className={clsx('mt-1 text-[13px] leading-6', status === 'pending' ? 'line-clamp-1 text-ink-400' : 'text-ink-700')}>
              <ValueView k={k} v={v} clamp={status === 'pending'} />
            </div>
          )}
          {status === 'active' && <p className="mt-0.5 text-xs text-ink-500">{meta.hint}</p>}
        </div>
        {status !== 'active' && (
          <Button variant={status === 'done' ? 'ghost' : 'secondary'} size="sm" disabled={busy} onClick={onOpen}>
            {status === 'done' ? '重新讨论' : '讨论这一项'}
          </Button>
        )}
      </div>

      {status === 'active' && (
        <div className="animate-fade-in space-y-4 px-5 pb-5 pl-14">
          {k === 'rhythm' ? (
            <RhythmEdit key={`${item.current}-${item.versions.length}`} v={v} onChange={onEdit} />
          ) : (
            <AutoTextarea aria-label={meta.title} minRows={k === 'core' ? 2 : 3} value={v.text} onChange={(e) => onEdit({ ...v, text: e.target.value })} />
          )}

          {item.versions.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-ink-500">版本</span>
              {item.versions.map((_, i) => (
                <button
                  key={i}
                  aria-pressed={i === item.current}
                  onClick={() => onVersion(i)}
                  className={clsx('rounded-md border px-2 py-0.5 tabular-nums', i === item.current ? 'border-brand-500 bg-white font-medium text-brand-700' : 'border-line text-ink-500 hover:border-brand-200')}
                >
                  v{i + 1}
                </button>
              ))}
              <span className="text-ink-400">不满意可以切回之前的版本</span>
            </div>
          )}

          {!!item.notes?.length && (
            <ul data-lab-notes className="space-y-1 rounded-lg bg-canvas px-4 py-2.5 text-xs leading-5 text-ink-600">
              {item.notes.map((n) => (
                <li key={n} className={clsx(/冲突|提到已定|对标剧人物名/.test(n) && 'text-amber-800')}>
                  · {n}
                </li>
              ))}
            </ul>
          )}

          <Field label="修改意见" hint="写清哪里不对、想往哪改；AI 只重写这一项，已定的项不动">
            <AutoTextarea aria-label={`${meta.title}修改意见`} minRows={2} value={item.comment} onChange={(e) => onComment(e.target.value)} placeholder="如：主角别太惨，开局就要有反击的苗头；反派的动机再狠一点" />
          </Field>

          <div className="flex flex-wrap items-center gap-2">
            <AiButton variant="secondary" loading={running} disabled={busy && !running} onClick={onRewrite}>
              {item.comment.trim() ? 'AI 按意见重写' : 'AI 换一种写法'}
            </AiButton>
            {k !== 'rhythm' && <PolishButton value={v.text} label={meta.title} disabled={busy} onApply={(text) => onEdit({ ...v, text })} />}
            <Button size="sm" className="ml-auto" disabled={busy || !valueText(k, v).trim()} onClick={onDone}>
              <Check size={14} />
              {isLast ? '这一项定了' : '这一项定了，下一项'}
              {!isLast && <ArrowRight size={14} />}
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}

const itemFrom = (v: LabValue): LabItem => ({ versions: [v], current: 0, done: false, comment: '' })

/**
 * 故事架构新版 Demo：由一个想法（或固定格式）出发，先出整部剧的骨架，选定一版后逐项讲清楚。
 * 单独一页，进度存在本机，不读写正式流程里的故事架构；确定后再替换原页面。
 */
export default function ArchitectureLab() {
  const project = useCurrentProject()
  const lab = useArchLab((s) => s.labs[project.id]) ?? emptyLab()
  const patchLab = useArchLab((s) => s.patch)
  const resetLab = useArchLab((s) => s.reset)
  const { running, run } = useAiTask()
  const [confirm, setConfirm] = useState<null | 'regen' | 'reset'>(null)
  const set = (patch: Partial<LabState> | ((s: LabState) => Partial<LabState>)) => patchLab(project.id, patch)

  const reference = labReference(project)
  const seedText = lab.seedMode === 'idea' ? lab.idea : formulaText(lab.formula)
  const items = lab.items
  const allDone = !!items && LAB_ORDER.every((k) => items[k]?.done)
  const doneCount = items ? LAB_ORDER.filter((k) => items[k]?.done).length : 0
  const exportText = useMemo(() => (items ? labExport(Object.fromEntries(LAB_ORDER.map((k) => [k, items[k]!.versions[items[k]!.current]]))) : ''), [items])

  const generate = async () => {
    setConfirm(null)
    const list = await run('skeleton', (signal) => draftLabSkeletons(project, seedText, lab.count, nextSeed(), signal))
    if (list) set({ candidates: list })
  }

  const pick = (s: LabSkeleton) => {
    set({ picked: s.title, candidates: null, items: Object.fromEntries(LAB_ORDER.map((k) => [k, itemFrom(s.values[k])])) as Record<LabKey, LabItem>, active: 'core' })
    toast(`已选「${s.title}」：从核心设定开始，一项一项讲清楚`)
  }

  const setItem = (k: LabKey, patch: Partial<LabItem>) => set((s) => ({ items: s.items && { ...s.items, [k]: { ...s.items[k]!, ...patch } } }))

  const edit = (k: LabKey, v: LabValue) => {
    const item = items![k]!
    setItem(k, { versions: item.versions.map((x, i) => (i === item.current ? v : x)) })
  }

  const rewrite = async (k: LabKey) => {
    const item = items![k]!
    const locked = Object.fromEntries(LAB_ORDER.filter((x) => items![x]?.done).map((x) => [x, valueText(x, items![x]!.versions[items![x]!.current])]))
    const result = await run(k, (signal) => rewriteLabItem(project, k, item.versions[item.current], item.comment, locked, nextSeed(), signal))
    if (!result) return
    set((s) => {
      const cur = s.items![k]!
      const versions = [...cur.versions, result.value]
      return { items: { ...s.items, [k]: { ...cur, versions, current: versions.length - 1, notes: result.notes, comment: '' } } }
    })
  }

  /** 定下这一项：如果它之前定过又改了，后面已定的项提醒复核；然后打开下一项没定的 */
  const done = (k: LabKey) => {
    set((s) => {
      const all = { ...s.items! }
      const cur = all[k]!
      all[k] = { ...cur, done: true, stale: undefined }
      const at = LAB_ORDER.indexOf(k)
      if (cur.versions.length > 1 || cur.notes) {
        for (const later of LAB_ORDER.slice(at + 1)) if (all[later]?.done) all[later] = { ...all[later]!, stale: `「${LAB_META[k].title}」改过，看看要不要跟着调` }
      }
      const next = LAB_ORDER.slice(at + 1).find((x) => !all[x]?.done) ?? LAB_ORDER.find((x) => !all[x]?.done) ?? null
      return { items: all, active: next }
    })
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exportText)
      toast('已复制全部设定')
    } catch {
      toast('复制失败，请手动选中文字复制', 'error')
    }
  }

  const step = items ? (allDone ? 4 : 3) : lab.candidates ? 2 : 1
  const steps = ['起点', '选一版', '逐项讲清楚', '完成']

  return (
    <div className="space-y-4" data-arch-lab>
      <div className="flex flex-wrap items-center gap-4 text-[13px]">
        <Link to={`/projects/${project.id}/stage/architecture`} className="inline-flex items-center gap-1 text-ink-500 hover:text-ink-900">
          <ArrowLeft size={14} />
          回到故事架构
        </Link>
        <Link to={`/projects/${project.id}/lab/rewrite`} className="inline-flex items-center gap-1 text-brand-700 hover:underline">
          <MessagesSquare size={13} />
          另一个 Demo：改写方案 · 多轮对话
        </Link>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            故事架构 · 新版
            <Badge tone="orange">
              <FlaskConical size={11} />
              Demo
            </Badge>
          </h2>
          <p className="mt-1 flex items-start gap-1.5 text-[13px] leading-6 text-ink-500">
            <Info size={14} className="mt-[5px] shrink-0 text-ink-400" />
            从一个想法出发，先出整部剧的骨架，选定一版后一项一项讲清楚。这一页是单独的试验页，不读写正式流程里的故事架构，确定后再替换原页面。
          </p>
        </div>
        {(lab.candidates || items) && (
          <Button variant="ghost" size="sm" disabled={!!running} onClick={() => setConfirm('reset')}>
            <RotateCcw size={14} />
            重新开始
          </Button>
        )}
      </div>

      <ol className="flex flex-wrap items-center gap-2 text-[13px]" aria-label="进度">
        {steps.map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            <span className={clsx('rounded-full px-2.5 py-0.5', i + 1 === step ? 'bg-brand-600 text-white' : i + 1 < step ? 'bg-emerald-100 text-emerald-800' : 'bg-ink-900/[0.06] text-ink-500')}>
              {i + 1}. {s}
              {i === 2 && items && <span className="ml-1 tabular-nums">{doneCount}/{LAB_ORDER.length}</span>}
            </span>
            {i < steps.length - 1 && <ArrowRight size={12} className="text-ink-300" />}
          </li>
        ))}
      </ol>

      <Card>
        <div className="border-b border-line px-5 py-4">
          <h3 className="text-[15px] font-semibold text-ink-900">① 起点</h3>
          <p className="mt-0.5 text-[13px] text-ink-500">一个想法，或按固定格式填空；AI 由它铺开整部剧</p>
        </div>
        <div className="space-y-4 p-5">
          <Segmented
            value={lab.seedMode}
            options={[
              { value: 'idea', label: '一个想法' },
              { value: 'formula', label: '固定格式' },
            ]}
            onChange={(seedMode) => set({ seedMode })}
          />
          {lab.seedMode === 'idea' ? (
            <AutoTextarea aria-label="一个想法" minRows={2} value={lab.idea} onChange={(e) => set({ idea: e.target.value })} placeholder={project.idea || '如：保留拒婚—归来结构，把狼人换成黑手党家族，女主是对立家族遗落的继承人'} />
          ) : (
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                {(
                  [
                    ['hero', '主角是谁', '被当众退婚的落魄千金'],
                    ['trouble', '遭遇什么', '家族破产、未婚夫和闺蜜联手'],
                    ['goal', '必须做什么', '在 30 天内夺回公司'],
                    ['twist', '反常规点', '退婚的未婚夫其实在暗中保护她'],
                  ] as const
                ).map(([key, label, ph]) => (
                  <Field key={key} label={label}>
                    <Input aria-label={label} value={lab.formula[key]} onChange={(e) => set((s) => ({ formula: { ...s.formula, [key]: e.target.value } }))} placeholder={`如：${ph}`} />
                  </Field>
                ))}
              </div>
              {seedText && (
                <p className="rounded-lg bg-canvas px-4 py-2.5 text-[13px] leading-6 text-ink-700">
                  <span className="text-ink-400">拼出来是：</span>
                  {seedText}
                </p>
              )}
            </div>
          )}

          <p data-lab-reference className="flex items-start gap-1.5 text-xs leading-5 text-ink-500">
            <Info size={13} className="mt-[3px] shrink-0 text-ink-400" />
            {reference
              ? `生成时会带上对标剧拆解：${reference.used.join('、')}；不带：${reference.skipped.join('、')}`
              : '原创项目：参考立项的题材类型、风格元素与受众'}
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <Segmented
              value={lab.count}
              options={[
                { value: 1, label: '出 1 版' },
                { value: 3, label: '出 3 版对比' },
              ]}
              onChange={(count) => set({ count })}
            />
            <AiButton loading={running === 'skeleton'} disabled={!!running} onClick={() => (items ? setConfirm('regen') : generate())}>
              {seedText.trim() ? 'AI 生成整部剧骨架' : '没有想法？AI 直接给骨架'}
            </AiButton>
            {lab.picked && !lab.candidates && <span className="text-xs text-ink-500">已选：「{lab.picked}」</span>}
          </div>
        </div>
      </Card>

      {lab.candidates && <Candidates key={lab.candidates[0]?.id} list={lab.candidates} refreshing={running === 'skeleton'} onRefresh={generate} onPick={pick} />}

      {items && (
        <Card>
          <div className="border-b border-line px-5 py-4">
            <h3 className="text-[15px] font-semibold text-ink-900">③ 逐项讲清楚</h3>
            <p className="mt-0.5 text-[13px] text-ink-500">由小到大，讲好一项再说下一项：不对就写意见让 AI 只改这一项，细节也可以直接改字；已定的项不会被后面的改动碰到</p>
          </div>
          {LAB_ORDER.map((k, i) => {
            const item = items[k]!
            const status: ItemStatus = lab.active === k ? 'active' : item.done ? 'done' : 'pending'
            return (
              <LabRow
                key={k}
                k={k}
                index={i}
                item={item}
                status={status}
                busy={!!running}
                running={running === k}
                isLast={LAB_ORDER.filter((x) => x !== k).every((x) => items[x]?.done)}
                onOpen={() => {
                  set({ active: k })
                  if (item.done) setItem(k, { done: false })
                }}
                onEdit={(v) => edit(k, v)}
                onVersion={(n) => setItem(k, { current: n })}
                onComment={(comment) => setItem(k, { comment })}
                onRewrite={() => rewrite(k)}
                onDone={() => done(k)}
                onClearStale={() => setItem(k, { stale: undefined })}
              />
            )
          })}
        </Card>
      )}

      {allDone && (
        <Card className="border-emerald-200" id="lab-done">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <h3 className="text-[15px] font-semibold text-ink-900">④ 整部剧的基调定好了</h3>
              <p className="mt-0.5 text-[13px] text-ink-500">下面是导出时的样子，核心设定直接输出那一段话。Demo 确认后，再把这一页替换进正式流程</p>
            </div>
            <Button variant="secondary" size="sm" onClick={copy}>
              <ClipboardCopy size={14} />
              复制全部
            </Button>
          </div>
          <pre className="max-h-[480px] overflow-auto px-5 py-4 font-sans text-[13px] leading-6 whitespace-pre-wrap text-ink-700">{exportText}</pre>
        </Card>
      )}

      <ConfirmDialog
        open={confirm === 'regen'}
        onClose={() => setConfirm(null)}
        onConfirm={generate}
        title="重新生成骨架？"
        desc="新的几版出来后要重新选；选定之前，当前的逐项讨论还在。"
        confirmText="重新生成"
      />
      <ConfirmDialog
        open={confirm === 'reset'}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          resetLab(project.id)
          setConfirm(null)
        }}
        title="重新开始？"
        desc="起点、各版骨架和逐项讨论都会清空。正式流程里的故事架构不受影响。"
        confirmText="重新开始"
        danger
      />
    </div>
  )
}
