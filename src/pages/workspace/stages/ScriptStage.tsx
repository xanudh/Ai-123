import clsx from 'clsx'
import { ArrowRight, Layers, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { ConfirmDialog } from '../../../components/overlay'
import { AiButton, AutoTextarea, CheckList, latestProject, useAiTask } from '../../../components/stage/StageKit'
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Select } from '../../../components/ui'
import { DRAFT_STATUS_META, EPISODE_POSITIONS, SCRIPT_BATCH } from '../../../domain/constants'
import { preWriteCheck } from '../../../domain/state'
import type { EpisodeBlueprint, Project } from '../../../domain/types'
import { blueprintOf, draftLabel, draftsOf, scriptOf } from '../../../domain/work'
import { formatDateTime } from '../../../lib/format'
import { draftBlueprints, nextSeed, positionOf, writeEpisode } from '../../../services/ai'
import { useProjects } from '../../../store/projects'
import { useStateFocus } from '../../../store/statePanel'
import { toast } from '../../../store/toast'
import { addDraft, draftPath, finalPath, nextUnwritten } from '../script/ops'

interface Pending {
  title: string
  desc: string
  confirmText: string
  danger?: boolean
  action: () => void
}

const POSITION_TONE: Record<string, 'violet' | 'orange' | 'green' | 'amber' | 'gray'> = {
  开篇: 'violet',
  付费卡点: 'orange',
  转折: 'green',
  高潮: 'amber',
  结局: 'amber',
}

/** 手动新增的蓝图：有集纲时按集纲预填 */
function blankBlueprint(p: Project, ep: number): EpisodeBlueprint {
  const o = p.work.outline.find((x) => x.ep === ep)
  return { ep, title: o?.title ?? '', position: positionOf(p, ep), cast: '', goal: '', conflict: o?.event ?? '', hook: o?.hookLine ?? '', guidance: '', points: '' }
}

export default function ScriptStage({ project, blocked }: { project: Project; blocked: boolean }) {
  const patchWork = useProjects((s) => s.patchWork)
  const updateProject = useProjects((s) => s.updateProject)
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { running, run } = useAiTask()
  const total = project.spec.totalEpisodes
  const w = project.work
  const blueprints = w.blueprints.filter((b) => b.ep <= total).sort((a, b) => a.ep - b.ep)
  const outlined = w.outline.filter((o) => o.ep <= total).length
  const next = nextUnwritten(project)

  // ?ep=N 从草稿页 / 目录树跳过来时选中对应的集
  const epParam = Number(params.get('ep')) || 0
  const [selected, setSelected] = useState(() => epParam || (blueprints.some((b) => b.ep === next) ? next : (blueprints[0]?.ep ?? 1)))
  const [seenParam, setSeenParam] = useState(epParam)
  if (epParam !== seenParam) {
    setSeenParam(epParam)
    if (epParam) setSelected(epParam)
  }
  const [pending, setPending] = useState<Pending | null>(null)
  const [batchAt, setBatchAt] = useState<number | null>(null)

  const current = blueprints.find((b) => b.ep === selected) ?? blueprints[0]
  const writeEp = current?.ep ?? Math.min(next, total)
  const checks = preWriteCheck(project, writeEp)
  useStateFocus({ kind: 'ep', ep: writeEp })
  const writeBlock = checks.find((c) => c.level === 'block')
  const versions = draftsOf(w, writeEp)
  const final = scriptOf(w, writeEp)
  const batchTo = Math.min(total, next + SCRIPT_BATCH - 1)
  let firstMissing = 1
  while (firstMissing <= total && blueprints.some((b) => b.ep === firstMissing)) firstMissing++

  const setBlueprints = (list: EpisodeBlueprint[], note?: string) => patchWork(project.id, { blueprints: [...list].sort((a, b) => a.ep - b.ep) }, note)

  const update = (ep: number, patch: Partial<EpisodeBlueprint>) => {
    const cur = latestProject(project.id)
    if (cur) patchWork(project.id, { blueprints: cur.work.blueprints.map((b) => (b.ep === ep ? { ...b, ...patch } : b)) })
  }

  /** AI 结果合并回最新数据：作者微操指导与要点以等待期间的最新内容为准 */
  const merge = (result: EpisodeBlueprint[], note: string) => {
    const cur = latestProject(project.id)
    if (!cur) return
    const eps = new Set(result.map((b) => b.ep))
    const kept = result.map((b) => {
      const prev = blueprintOf(cur.work, b.ep)
      return prev ? { ...b, guidance: prev.guidance, points: prev.points } : b
    })
    setBlueprints([...cur.work.blueprints.filter((b) => !eps.has(b.ep)), ...kept], note)
  }

  const generateAll = async () => {
    const cur = latestProject(project.id)
    if (!cur) return
    const seed = cur.work.blueprints.length ? nextSeed() : 0
    const result = await run('blueprints', (signal) => draftBlueprints(cur, 1, total, seed, signal))
    if (!result) return
    if (!result.length) {
      toast('还没有集纲：先到情节大纲生成', 'error')
      return
    }
    merge(result, `AI 生成分集蓝图：${result.length} 集`)
    toast(`已按情节大纲生成 ${result.length} 集蓝图，作者微操指导与要点已保留`)
    if (!current) setSelected(result.some((b) => b.ep === next) ? next : result[0].ep)
  }

  const regenerate = async (ep: number) => {
    const cur = latestProject(project.id)
    if (!cur) return
    const result = await run('one', (signal) => draftBlueprints(cur, ep, ep, nextSeed(), signal))
    if (!result) return
    if (!result.length) {
      toast(`第 ${ep} 集还没有集纲，无法生成蓝图`, 'error')
      return
    }
    merge(result, `重新生成第 ${ep} 集蓝图`)
    toast(`第 ${ep} 集蓝图已重新生成`)
  }

  const add = () => {
    const cur = latestProject(project.id)
    if (!cur || firstMissing > total) return
    setBlueprints([...cur.work.blueprints, blankBlueprint(cur, firstMissing)], `新增第 ${firstMissing} 集蓝图`)
    setSelected(firstMissing)
  }

  const markWriting = () => {
    if (latestProject(project.id)?.status === 'draft') updateProject(project.id, { status: 'writing' })
  }

  const write = async (ep: number) => {
    const cur = latestProject(project.id)
    if (!cur) return
    const block = preWriteCheck(cur, ep).find((c) => c.level === 'block')
    if (block) {
      toast(block.text, 'error')
      return
    }
    const seed = draftsOf(cur.work, ep).length ? nextSeed() : 0
    const content = await run('write', (signal) => writeEpisode(cur, ep, seed, signal))
    if (!content) return
    const latest = latestProject(project.id)
    if (!latest) return
    const { draft, drafts } = addDraft(latest.work, ep, content)
    patchWork(project.id, { drafts }, `写作第 ${ep} 集：${draftLabel(draft)}`)
    markWriting()
    toast(`第 ${ep} 集 ${draftLabel(draft)} 已放入草稿箱`)
    navigate(draftPath(project, draft.id))
  }

  /** 从第一个没写过的集起，按顺序最多写 SCRIPT_BATCH 集；遇到不能写的集就停 */
  const batch = async () => {
    const from = nextUnwritten(latestProject(project.id) ?? project)
    const to = Math.min(total, from + SCRIPT_BATCH - 1)
    const result = await run('batch', async (signal) => {
      let done = 0
      for (let ep = from; ep <= to; ep++) {
        const cur = latestProject(project.id)
        if (!cur) break
        const block = preWriteCheck(cur, ep).find((c) => c.level === 'block')
        if (block) return { done, stop: `第 ${ep} 集：${block.text}` }
        setBatchAt(ep)
        const content = await writeEpisode(cur, ep, 0, signal)
        const latest = latestProject(project.id)
        if (!latest) break
        patchWork(project.id, { drafts: addDraft(latest.work, ep, content).drafts }, `批量创作：第 ${ep} 集草稿`)
        done++
      }
      return { done, stop: '' }
    })
    setBatchAt(null)
    if (!result) return
    if (result.done) {
      markWriting()
      toast(`已写出 ${result.done} 集草稿，逐集审稿后定稿${result.stop ? `（${result.stop}）` : ''}`)
    } else if (result.stop) {
      toast(result.stop, 'error')
    }
  }

  const askGenerate = () =>
    blueprints.length
      ? setPending({
          title: '重新生成全部蓝图？',
          desc: '定位、出场人物、小目标、冲突与钩子会按最新的情节大纲重写；作者微操指导与本集要点保留。',
          confirmText: '重新生成',
          action: generateAll,
        })
      : generateAll()

  const askRemove = (ep: number) =>
    setPending({
      title: `删除第 ${ep} 集蓝图？`,
      desc: '本集的定位、出场人物、小目标、冲突、钩子、作者微操指导与要点都会删除；草稿与正文不受影响。',
      confirmText: '删除',
      danger: true,
      action: () => {
        const cur = latestProject(project.id)
        if (cur) setBlueprints(cur.work.blueprints.filter((b) => b.ep !== ep), `删除第 ${ep} 集蓝图`)
      },
    })

  const askClear = () =>
    setPending({
      title: '清空全部蓝图？',
      desc: `${blueprints.length} 集蓝图（含作者微操指导与定稿要点）都会删除；草稿箱与正文章节不受影响。`,
      confirmText: '清空',
      danger: true,
      action: () => setBlueprints([], '清空全部分集蓝图'),
    })

  const checkCard = (
    <Card>
      <CardHeader title={`写作前检查 · 第 ${writeEp} 集`} desc="对照剧本状态库：集纲与蓝图、上一集定稿、伏笔到期、钩子承接、人物最新状态" />
      <div className="space-y-3 px-5 py-4">
        <CheckList items={checks} empty="一切就绪，可以开始写作" />
        {(versions.length > 0 || final) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-3 text-[13px]">
            <span className="text-ink-500">本集进度</span>
            {versions.slice(0, 3).map((d) => (
              <Link key={d.id} to={draftPath(project, d.id)} className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-ink-900 hover:bg-canvas">
                {draftLabel(d)}
                <Badge tone={DRAFT_STATUS_META[d.status].tone}>{DRAFT_STATUS_META[d.status].label}</Badge>
              </Link>
            ))}
            {final && (
              <Link to={finalPath(project, writeEp)} className="flex items-center gap-1 font-medium text-brand-600 hover:text-brand-700">
                正文第 {writeEp} 集
                <ArrowRight size={13} />
              </Link>
            )}
          </div>
        )}
        <p className="text-xs text-ink-400">
          {versions.length ? `再次写作会生成 草稿_v${versions[0].version + 1}，原有版本保留在草稿箱` : '写好的草稿放入草稿箱；审稿 / 修稿后定稿，归入正文章节'}
        </p>
      </div>
    </Card>
  )

  const positions = current ? [...new Set<string>([...EPISODE_POSITIONS, current.position].filter(Boolean))] : []
  const currentFinal = current && scriptOf(w, current.ep)

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div className="flex items-center gap-2">
            <Layers size={16} className="text-ink-500" />
            <span className="text-[15px] font-semibold text-ink-900">分集蓝图</span>
            <span className="text-[13px] text-ink-400 tabular-nums">（{blueprints.length} 集）</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* 没有蓝图时不出写作按钮：先生成蓝图 */}
            {blueprints.length > 0 && (
              <>
                <AiButton loading={running === 'write'} disabled={blocked || !!writeBlock || !!running} title={writeBlock?.text ?? `按第 ${writeEp} 集蓝图写作`} onClick={() => write(writeEp)}>
                  写作第 {writeEp} 集
                </AiButton>
                <AiButton
                  variant="secondary"
                  loading={running === 'batch'}
                  disabled={blocked || next > total || !!running}
                  title={`从第一个没写过的集起，按顺序最多写 ${SCRIPT_BATCH} 集`}
                  onClick={batch}
                >
                  {running === 'batch' && batchAt ? `正在写第 ${batchAt} 集…` : next > total ? '已全部开写' : `批量创作（第 ${next}–${batchTo} 集）`}
                </AiButton>
              </>
            )}
            <AiButton variant="secondary" loading={running === 'blueprints'} disabled={blocked || !!running} onClick={askGenerate}>
              AI 生成蓝图
            </AiButton>
            <Button
              variant="secondary"
              size="sm"
              className="px-2"
              aria-label="重新生成本集蓝图"
              title="重新生成本集蓝图（保留作者微操指导与要点）"
              disabled={!current || blocked || !!running}
              onClick={() => current && regenerate(current.ep)}
            >
              <RefreshCw size={14} className={clsx(running === 'one' && 'animate-spin')} />
            </Button>
            <Button variant="secondary" size="sm" className="px-2" aria-label="新增一集蓝图" title={firstMissing > total ? '全部集都已有蓝图' : `新增第 ${firstMissing} 集蓝图`} disabled={firstMissing > total} onClick={add}>
              <Plus size={14} />
            </Button>
            <button
              type="button"
              disabled={!blueprints.length || !!running}
              onClick={askClear}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Trash2 size={14} />
              清空全部蓝图
            </button>
          </div>
        </div>
      </Card>

      {!current ? (
        <>
          <Card>
            <EmptyState
              icon={<Layers size={22} />}
              title="还没有分集蓝图"
              desc="蓝图是写作前的预览设定：本集定位、出场人物、主角小目标、冲突与转折、末尾钩子，以及作者微操指导。先按情节大纲生成，确认后再点击写作。"
              action={
                <AiButton size="md" loading={running === 'blueprints'} disabled={blocked || !outlined || !!running} onClick={generateAll}>
                  AI 生成蓝图（{outlined} 集）
                </AiButton>
              }
            />
          </Card>
          {!blocked && checkCard}
        </>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[232px_minmax(0,1fr)]">
          {/* 蓝图列表 */}
          <Card className="scrollbar-thin p-1.5 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
            <ul className="space-y-0.5">
              {blueprints.map((b) => {
                const done = !!scriptOf(w, b.ep)
                const n = draftsOf(w, b.ep).length
                const on = b.ep === current.ep
                return (
                  <li key={b.ep}>
                    <button
                      type="button"
                      onClick={() => setSelected(b.ep)}
                      aria-current={on || undefined}
                      className={clsx('flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors', on ? 'bg-brand-50' : 'hover:bg-canvas')}
                    >
                      <span
                        title={done ? '已定稿' : undefined}
                        className={clsx(
                          'mt-px flex size-6 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold tabular-nums',
                          done ? 'bg-emerald-100 text-emerald-700' : on ? 'bg-brand-600 text-white' : 'bg-canvas text-ink-500',
                        )}
                      >
                        {b.ep}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={clsx('block truncate text-[13px]', on ? 'font-semibold text-brand-700' : 'font-medium text-ink-900')}>{b.title || `第 ${b.ep} 集`}</span>
                        <span className="mt-1 flex flex-wrap gap-1">
                          <Badge tone={POSITION_TONE[b.position] ?? 'gray'}>{b.position || '未定位'}</Badge>
                          {b.guidance.trim() && <Badge tone="violet">有指导</Badge>}
                          {b.points.trim() && <Badge tone="green">有要点</Badge>}
                          {n > 0 && <Badge tone="gray">{n} 稿</Badge>}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </Card>

          {/* 蓝图表单 */}
          <div className="min-w-0 space-y-4">
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
                <h3 className="min-w-0 truncate text-[15px] font-semibold text-ink-900">
                  第 {current.ep} 集：{current.title || <span className="text-ink-400">未命名</span>}
                </h3>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-ink-400">修改自动保存</span>
                  <Button variant="ghost" size="sm" onClick={() => askRemove(current.ep)}>
                    <Trash2 size={14} />
                    删除此集
                  </Button>
                </div>
              </div>
              <div className="space-y-4 p-5">
                <div className="grid gap-4 sm:grid-cols-[120px_minmax(0,1fr)]">
                  <Field label="集号">
                    <Input value={`第 ${current.ep} 集`} readOnly disabled />
                  </Field>
                  <Field label="本集标题">
                    <Input value={current.title} onChange={(e) => update(current.ep, { title: e.target.value })} placeholder="本集标题" />
                  </Field>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="本集定位" hint="按节奏框架预填，可改">
                    <Select value={current.position} onChange={(e) => update(current.ep, { position: e.target.value })}>
                      {positions.map((p) => (
                        <option key={p}>{p}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="出场关键人（逗号分隔）" hint="AI 审稿会检查这些人物是否出场">
                    <Input value={current.cast} onChange={(e) => update(current.ep, { cast: e.target.value })} placeholder="主角、反派、关键配角" />
                  </Field>
                </div>
                <Field label="主角小目标（本集最想解决的事）">
                  <Input value={current.goal} onChange={(e) => update(current.ep, { goal: e.target.value })} placeholder="这一集主角最想做成的一件事" />
                </Field>
                <Field label="实质冲突与转折">
                  <AutoTextarea minRows={3} value={current.conflict} onChange={(e) => update(current.ep, { conflict: e.target.value })} placeholder="谁阻碍主角、怎么升级、在哪里反转" />
                </Field>
                <Field label="末尾悬念钩子">
                  <AutoTextarea minRows={2} value={current.hook} onChange={(e) => update(current.ep, { hook: e.target.value })} placeholder="最后 10 秒留什么让观众点下一集" />
                </Field>

                <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-4">
                  <div className="mb-2 flex flex-wrap items-baseline gap-1">
                    <span className="text-[13px] font-semibold text-brand-700">作者微操指导</span>
                    <span className="text-xs text-ink-500">（写稿时会作为最高优先级注入 AI — 可覆盖蓝图）</span>
                  </div>
                  <AutoTextarea
                    aria-label="作者微操指导"
                    minRows={3}
                    value={current.guidance}
                    onChange={(e) => update(current.ep, { guidance: e.target.value })}
                    placeholder={'我想在这集加入一个意外的背叛…\n让反派在这集露出破绽…\n（不填则完全按蓝图走）'}
                  />
                </div>

                <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
                  <div className="mb-2 flex flex-wrap items-baseline gap-1">
                    <span className="text-[13px] font-semibold text-emerald-700">本集要点</span>
                    <span className="text-xs text-ink-500">（定稿后自动生成{currentFinal ? ` — ${formatDateTime(currentFinal.updatedAt)}` : ''}）</span>
                  </div>
                  <AutoTextarea
                    aria-label="本集要点"
                    minRows={4}
                    value={current.points}
                    onChange={(e) => update(current.ep, { points: e.target.value })}
                    placeholder="定稿后 AI 会自动填充本集要点（事件进展 / 角色变化 / 伏笔埋点），也可以提前手动输入给 AI 作参考"
                    className="font-mono text-[12.5px] leading-6"
                  />
                </div>
              </div>
            </Card>

            {checkCard}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!pending}
        onClose={() => setPending(null)}
        onConfirm={() => pending?.action()}
        title={pending?.title ?? ''}
        desc={pending?.desc}
        confirmText={pending?.confirmText}
        danger={pending?.danger}
      />
    </>
  )
}
