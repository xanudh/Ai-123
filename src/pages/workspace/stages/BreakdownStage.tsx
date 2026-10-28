import clsx from 'clsx'
import { ArrowRight, Check, CircleCheck, Eye, FileUp, Link2, Plus, Trash2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { ConfirmDialog, Modal } from '../../../components/overlay'
import { RhythmChart } from '../../../components/project/RhythmChart'
import { AiButton, AutoTextarea, InlineInput, RelationKindList, ReviewBadge, Stat, Table, latestProject, stagePath, useAiTask } from '../../../components/stage/StageKit'
import { Badge, Button, Card, CardHeader, Field, Input, Segmented, Textarea } from '../../../components/ui'
import { MAX_SOURCE_BYTES } from '../../../domain/constants'
import { BREAKDOWN_BLOCKS, BREAKDOWN_FIELDS } from '../../../domain/pipeline'
import type { BenchmarkCharacter, Breakdown, BreakdownBlock, EpisodeBreakdown, Project, Relation, Synopsis } from '../../../domain/types'
import { emptyArchitecture, scaleRhythm } from '../../../domain/work'
import { formatDateTime } from '../../../lib/format'
import { ANALYZE_STEPS, SAMPLE_SCRIPT, SAMPLE_SCRIPT_NAME, analyzeBenchmark, parseSource } from '../../../services/ai'
import { useProjects } from '../../../store/projects'
import { toast } from '../../../store/toast'

const BLOCKS: BreakdownBlock[] = ['synopsis', 'characters', 'mainline', 'episodes']

const SYNOPSIS_FIELDS: [keyof Synopsis, string][] = [
  ['audience', '目标受众'],
  ['genre', '题材类型'],
  ['coreSetup', '核心设定'],
  ['style', '风格元素'],
  ['world', '世界观'],
  ['highlights', '核心亮点'],
  ['summary', '核心梗概'],
  ['paywalls', '付费卡点'],
]

/* ---------------------------------- 导入 ---------------------------------- */

function ImportCard({ project }: { project: Project }) {
  const patchWork = useProjects((s) => s.patchWork)
  const [text, setText] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const detected = useMemo(() => (text.trim() ? parseSource('', text).episodes.length : 0), [text])

  const onFile = async (file: File | undefined) => {
    if (!file) return
    if (file.size > MAX_SOURCE_BYTES) return setError('文件超过 2 MB，请拆分后分批导入')
    setText(await file.text())
    setName(file.name)
    setError(null)
  }

  const submit = () => {
    if (!text.trim()) return setError('请先粘贴或上传对标剧剧本')
    const source = parseSource(name || '粘贴的剧本.txt', text)
    if (!source.episodes.length) return setError('没有识别到分集标记：请确认每集以「第1集」「第一集」或「EP1」单独成行')
    patchWork(project.id, { source, breakdown: null }, `导入对标剧剧本：识别到 ${source.episodes.length} 集`)
    toast(`已导入，识别到 ${source.episodes.length} 集`)
  }

  return (
    <Card>
      <CardHeader
        title="导入对标剧剧本"
        desc="粘贴全文或上传 .txt / .md；每集以「第1集」或「EP1」单独成行，系统按分集切分后再拆解"
        action={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setText(SAMPLE_SCRIPT)
              setName(SAMPLE_SCRIPT_NAME)
              setError(null)
            }}
          >
            载入示例剧本
          </Button>
        }
      />
      <div className="space-y-3 p-5">
        {project.mode === 'video' && (
          <p className="rounded-lg bg-brand-50/60 px-3 py-2 text-[13px] text-ink-700">
            「视频转剧本」合并完成后会把剧本送到这里；手上已有剧本也可以直接粘贴。
            <Link to={stagePath(project, 'video')} className="ml-1 font-medium text-brand-600 hover:text-brand-700">
              去视频转剧本 →
            </Link>
          </p>
        )}
        <Textarea
          aria-label="对标剧剧本"
          rows={14}
          value={text}
          invalid={!!error}
          onChange={(e) => {
            setText(e.target.value)
            setError(null)
          }}
          placeholder={'第1集\n场景：议事厅 夜 内\n△ 满月高悬，全族屏息。\n凯恩：我拒绝艾拉成为我的伴侣。\n\n第2集\n……'}
          className="font-mono text-[12.5px]"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-xs text-ink-500">
            <input ref={fileRef} type="file" accept=".txt,.md,text/plain,text/markdown" hidden onChange={(e) => onFile(e.target.files?.[0])} />
            <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
              <FileUp size={14} />
              上传文件
            </Button>
            {name && <span className="max-w-60 truncate">{name}</span>}
            {text && (
              <span className="tabular-nums">
                {text.length.toLocaleString()} 字 · {detected ? `识别到 ${detected} 集` : '未识别到分集'}
              </span>
            )}
          </div>
          <Button onClick={submit}>导入并切分</Button>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </Card>
  )
}

/* ---------------------------------- 原文与拆解 ---------------------------------- */

function SourceCard({ project, onAnalyze, step, running }: { project: Project; onAnalyze: () => void; step: number | null; running: boolean }) {
  const patchWork = useProjects((s) => s.patchWork)
  const source = project.work.source!
  const breakdown = project.work.breakdown
  const [viewing, setViewing] = useState(false)
  const [confirm, setConfirm] = useState<'reimport' | 'reanalyze' | null>(null)
  const registered = project.benchmark?.episodes

  return (
    <Card>
      <CardHeader
        title="对标剧剧本"
        desc={project.benchmark?.title ? `《${project.benchmark.title}》${project.benchmark.platform ? ` · ${project.benchmark.platform}` : ''}` : undefined}
        action={
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setViewing(true)}>
              <Eye size={14} />
              查看原文
            </Button>
            <Button variant="ghost" size="sm" disabled={running} onClick={() => setConfirm('reimport')}>
              重新导入
            </Button>
            {breakdown ? (
              <AiButton variant="secondary" loading={running} onClick={() => setConfirm('reanalyze')}>
                重新拆解
              </AiButton>
            ) : (
              <AiButton loading={running} onClick={onAnalyze}>
                开始拆解
              </AiButton>
            )}
          </div>
        }
      />
      <div className="grid gap-3 p-5 sm:grid-cols-4">
        <Stat label="文件" value={<span className="block truncate text-[13px]" title={source.name}>{source.name}</span>} />
        <Stat label="识别集数" value={`${source.episodes.length} 集`} />
        <Stat label="字数" value={source.text.length.toLocaleString()} />
        <Stat label="导入时间" value={<span className="text-[13px]">{formatDateTime(source.importedAt)}</span>} />
      </div>
      {registered && registered !== source.episodes.length && (
        <p className="-mt-2 px-5 pb-4 text-xs text-ink-500">
          立项登记为 {registered} 集，剧本中识别到 {source.episodes.length} 集；拆解按识别到的集数进行
        </p>
      )}
      {step !== null && (
        <ol className="space-y-1.5 border-t border-line px-5 py-4" aria-label="拆解进度">
          {ANALYZE_STEPS.map((s, i) => (
            <li key={s} className={clsx('flex items-center gap-2 text-[13px]', i < step ? 'text-ink-500' : i === step ? 'font-medium text-ink-900' : 'text-ink-300')}>
              {i < step ? (
                <CircleCheck size={14} className="text-emerald-500" />
              ) : (
                <span className={clsx('size-3.5 rounded-full border-2', i === step ? 'animate-pulse border-brand-500' : 'border-line')} />
              )}
              {s}
            </li>
          ))}
        </ol>
      )}

      <Modal open={viewing} onClose={() => setViewing(false)} title={source.name} desc={`共 ${source.episodes.length} 集`} width={720}>
        <div className="scrollbar-thin max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          {source.episodes.map((e) => (
            <section key={e.ep}>
              <h4 className="mb-1 text-[13px] font-semibold">第 {e.ep} 集</h4>
              <pre className="rounded-lg bg-canvas px-3 py-2 font-mono text-xs leading-6 whitespace-pre-wrap text-ink-700">{e.text}</pre>
            </section>
          ))}
        </div>
      </Modal>
      <ConfirmDialog
        open={confirm === 'reimport'}
        onClose={() => setConfirm(null)}
        onConfirm={() => patchWork(project.id, { source: null, breakdown: null }, '清除对标剧剧本，重新导入')}
        danger
        title="重新导入剧本？"
        desc="当前剧本和拆解结果（含审核状态与修改）都会被清除。"
        confirmText="清除并重新导入"
      />
      <ConfirmDialog
        open={confirm === 'reanalyze'}
        onClose={() => setConfirm(null)}
        onConfirm={onAnalyze}
        title="重新拆解？"
        desc="四个板块会重新生成并回到待审核，已做的修改会被覆盖。"
        confirmText="重新拆解"
      />
    </Card>
  )
}

function BlockCard({
  index,
  block,
  bd,
  onToggle,
  desc,
  children,
}: {
  index: number
  block: BreakdownBlock
  bd: Breakdown
  onToggle: () => void
  desc?: string
  children: ReactNode
}) {
  const approved = bd.review[block] === 'approved'
  return (
    <Card className={clsx('overflow-hidden', approved && 'border-emerald-200')}>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <span className="text-ink-400 tabular-nums">{index + 1}</span>
            {BREAKDOWN_BLOCKS[index].label}
            <ReviewBadge approved={approved} />
          </span>
        }
        desc={approved ? '已确认，如需修改请先取消确认' : desc}
        action={
          approved ? (
            <Button variant="ghost" size="sm" onClick={onToggle}>
              取消确认
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={onToggle}>
              <Check size={14} />
              确认无误
            </Button>
          )
        }
      />
      {children}
    </Card>
  )
}

function SynopsisBlock({ bd, locked, patch }: { bd: Breakdown; locked: boolean; patch: (p: Partial<Breakdown>) => void }) {
  return (
    <div className="grid gap-4 p-5 md:grid-cols-2">
      {SYNOPSIS_FIELDS.map(([key, label]) => (
        <div key={key} className={clsx(key === 'summary' && 'md:col-span-2')}>
          <Field label={label}>
            <AutoTextarea aria-label={label} value={bd.synopsis[key]} disabled={locked} onChange={(e) => patch({ synopsis: { ...bd.synopsis, [key]: e.target.value } })} />
          </Field>
        </div>
      ))}
    </div>
  )
}

function CharactersBlock({ bd, locked, patch }: { bd: Breakdown; locked: boolean; patch: (p: Partial<Breakdown>) => void }) {
  const setChar = (i: number, next: Partial<BenchmarkCharacter>) => {
    const old = bd.characters[i].name
    const rename = (n: string) => (next.name !== undefined && n === old ? next.name : n)
    patch({
      characters: bd.characters.map((c, j) => (j === i ? { ...c, ...next } : c)),
      relations: bd.relations.map((r) => ({ ...r, a: rename(r.a), b: rename(r.b) })),
    })
  }
  const setRel = (i: number, next: Partial<Relation>) => patch({ relations: bd.relations.map((r, j) => (j === i ? { ...r, ...next } : r)) })

  return (
    <>
      <Table columns={['角色', '定位', '角色性格', '角色事件', '']} minWidth={720}>
        {bd.characters.map((c, i) => (
          <tr key={i} className="align-top">
            <td className="w-32 px-2 py-1.5">
              <InlineInput aria-label="角色名" value={c.name} disabled={locked} onChange={(e) => setChar(i, { name: e.target.value })} />
            </td>
            <td className="w-36 px-2 py-1.5">
              <InlineInput aria-label="定位" value={c.role} disabled={locked} onChange={(e) => setChar(i, { role: e.target.value })} />
            </td>
            <td className="w-40 px-2 py-1.5">
              <AutoTextarea inline aria-label="角色性格" value={c.personality} disabled={locked} onChange={(e) => setChar(i, { personality: e.target.value })} />
            </td>
            <td className="px-2 py-1.5">
              <AutoTextarea inline aria-label="角色事件" value={c.events} disabled={locked} onChange={(e) => setChar(i, { events: e.target.value })} />
            </td>
            <td className="w-10 px-2 py-2">
              {!locked && (
                <button className="rounded p-1 text-ink-300 hover:bg-red-50 hover:text-red-600" aria-label="删除角色" onClick={() => patch({ characters: bd.characters.filter((_, j) => j !== i) })}>
                  <Trash2 size={14} />
                </button>
              )}
            </td>
          </tr>
        ))}
      </Table>
      {!locked && (
        <div className="border-t border-line px-5 py-2.5">
          <Button variant="ghost" size="sm" onClick={() => patch({ characters: [...bd.characters, { name: '', role: '配角', personality: '', events: '' }] })}>
            <Plus size={14} />
            添加角色
          </Button>
        </div>
      )}
      <div className="border-t border-line px-5 pt-4 pb-2 text-[13px] font-medium">全剧人物关系网</div>
      <RelationKindList />
      <ul className="space-y-1 px-3 pb-4">
        {bd.relations.map((r, i) => (
          <li key={i} className="flex items-center gap-1">
            <InlineInput aria-label="人物 A" value={r.a} disabled={locked} onChange={(e) => setRel(i, { a: e.target.value })} className="w-28" />
            <span className="text-ink-300">—</span>
            <InlineInput aria-label="人物 B" value={r.b} disabled={locked} onChange={(e) => setRel(i, { b: e.target.value })} className="w-28" />
            <InlineInput aria-label="关系类型" list="relation-kinds" value={r.kind} disabled={locked} onChange={(e) => setRel(i, { kind: e.target.value })} placeholder="关系" className="w-24" />
            <InlineInput aria-label="关系备注" value={r.label} disabled={locked} onChange={(e) => setRel(i, { label: e.target.value })} placeholder="备注" className="flex-1" />
            {!locked && (
              <button className="rounded p-1 text-ink-300 hover:bg-red-50 hover:text-red-600" aria-label="删除关系" onClick={() => patch({ relations: bd.relations.filter((_, j) => j !== i) })}>
                <Trash2 size={14} />
              </button>
            )}
          </li>
        ))}
        {!bd.relations.length && <li className="px-2 text-xs text-ink-400">暂无关系</li>}
      </ul>
      {!locked && (
        <div className="-mt-2 px-5 pb-3">
          <Button variant="ghost" size="sm" onClick={() => patch({ relations: [...bd.relations, { a: '', b: '', kind: '', label: '' }] })}>
            <Plus size={14} />
            添加关系
          </Button>
        </div>
      )}
    </>
  )
}

function MainlineBlock({ bd, locked, patch }: { bd: Breakdown; locked: boolean; patch: (p: Partial<Breakdown>) => void }) {
  const { rhythm } = bd
  return (
    <>
      <Table columns={['冲突主线', '集数', '对标剧怎么推进']} minWidth={640}>
        {bd.mainLine.map((b, i) => (
          <tr key={b.beat} className="align-top">
            <td className="w-32 px-4 py-3 font-medium">{b.beat}</td>
            <td className="w-28 px-4 py-3 text-ink-500 tabular-nums">{b.range}</td>
            <td className="px-2 py-1.5">
              <AutoTextarea
                inline
                aria-label={b.beat}
                value={b.content}
                disabled={locked}
                onChange={(e) => patch({ mainLine: bd.mainLine.map((x, j) => (j === i ? { ...x, content: e.target.value } : x)) })}
              />
            </td>
          </tr>
        ))}
      </Table>
      <div className="border-t border-line p-5">
        <div className="mb-3 flex flex-wrap gap-1.5 text-xs">
          <Badge tone="orange">首付费 第 {rhythm.paywalls[0] ?? '—'} 集</Badge>
          <Badge tone="orange">付费卡点 {rhythm.paywalls.join('、') || '—'}</Badge>
          <Badge tone="green">大反转 {rhythm.twists.join('、') || '—'}</Badge>
          <Badge tone="gray">结局高潮 第 {rhythm.climaxFrom} 集起</Badge>
        </div>
        <RhythmChart rhythm={rhythm} total={bd.totalEpisodes} height={180} showTableToggle={false} />
        <p className="mt-2 text-xs text-ink-400">节奏节点按冲突与揭秘强度从剧本中推断；一键引用时可按本项目集数等比映射</p>
      </div>
    </>
  )
}

const cell = (text: string) => (
  <span className="block max-w-[220px] truncate" title={text}>
    {text || <span className="text-ink-300">—</span>}
  </span>
)

function EpisodesBlock({ bd, onOpen }: { bd: Breakdown; onOpen: (ep: EpisodeBreakdown) => void }) {
  return (
    <Table columns={BREAKDOWN_FIELDS.map((f) => f.label)} minWidth={1500}>
      {bd.episodes.map((e) => (
        <tr key={e.ep} onClick={() => onOpen(e)} className={clsx('cursor-pointer hover:bg-canvas/70', e.paywall && 'bg-orange-50/40')}>
          <td className="px-4 py-2.5 whitespace-nowrap tabular-nums">第 {e.ep} 集</td>
          <td className="px-4 py-2.5">{cell(e.openHook)}</td>
          <td className="px-4 py-2.5">{cell(e.event)}</td>
          <td className="px-4 py-2.5 tabular-nums">{e.conflict}</td>
          <td className="px-4 py-2.5">{cell(e.newCharacters)}</td>
          <td className="px-4 py-2.5">{cell(e.relationChange)}</td>
          <td className="px-4 py-2.5">{cell(e.plant)}</td>
          <td className="px-4 py-2.5">{cell(e.payoff)}</td>
          <td className="px-4 py-2.5">{cell(e.endHook)}</td>
          <td className="px-4 py-2.5">{e.paywall ? <Badge tone="orange">是</Badge> : <span className="text-ink-400">否</span>}</td>
          <td className="px-4 py-2.5">{cell(e.paywallMoment)}</td>
          <td className="px-4 py-2.5 tabular-nums">{e.emotion}</td>
        </tr>
      ))}
    </Table>
  )
}

const SCORES = [1, 2, 3, 4, 5].map((v) => ({ value: v, label: String(v) }))

function EpisodeModal({ episode, locked, onClose, onSave }: { episode: EpisodeBreakdown | null; locked: boolean; onClose: () => void; onSave: (e: EpisodeBreakdown) => void }) {
  const [draft, setDraft] = useState(episode)
  const [prev, setPrev] = useState(episode)
  if (episode !== prev) {
    setPrev(episode)
    setDraft(episode)
  }
  if (!draft) return null
  const set = (patch: Partial<EpisodeBreakdown>) => setDraft({ ...draft, ...patch })
  const text = (key: 'openHook' | 'event' | 'newCharacters' | 'relationChange' | 'plant' | 'payoff' | 'endHook' | 'paywallMoment', label: string) => (
    <Field label={label}>
      <Input aria-label={label} value={draft[key]} disabled={locked} onChange={(e) => set({ [key]: e.target.value } as Partial<EpisodeBreakdown>)} />
    </Field>
  )
  return (
    <Modal
      open={!!episode}
      onClose={onClose}
      title={`第 ${draft.ep} 集 · 逐集明细`}
      desc={locked ? '本板块已确认，取消确认后可修改' : undefined}
      width={640}
      footer={
        locked ? (
          <Button variant="secondary" onClick={onClose}>
            关闭
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              取消
            </Button>
            <Button
              onClick={() => {
                onSave(draft)
                onClose()
              }}
            >
              保存
            </Button>
          </>
        )
      }
    >
      <div className="scrollbar-thin grid max-h-[60vh] gap-4 overflow-y-auto pr-1 sm:grid-cols-2">
        {text('openHook', '开场钩子（前 5 秒）')}
        {text('event', '本集事件')}
        <Field label="冲突强度">{locked ? <span className="text-sm">{draft.conflict} 分</span> : <Segmented value={draft.conflict} options={SCORES} onChange={(v) => set({ conflict: v })} />}</Field>
        <Field label="情绪强度">{locked ? <span className="text-sm">{draft.emotion} 分</span> : <Segmented value={draft.emotion} options={SCORES} onChange={(v) => set({ emotion: v })} />}</Field>
        {text('newCharacters', '新出场人物')}
        {text('relationChange', '人物关系变化')}
        {text('plant', '伏笔埋设')}
        {text('payoff', '伏笔回收')}
        {text('endHook', '结尾钩子（后 10 秒）')}
        <Field label="是否付费点">
          <label className="flex h-10 items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.paywall} disabled={locked} onChange={(e) => set({ paywall: e.target.checked })} className="size-4 accent-brand-600" />
            本集付费解锁
          </label>
        </Field>
        <div className="sm:col-span-2">{text('paywallMoment', '付费卡点位置')}</div>
      </div>
    </Modal>
  )
}

/* ---------------------------------- 审核与引用 ---------------------------------- */

function ReviewBar({ project, bd }: { project: Project; bd: Breakdown }) {
  const { patchWork, updateProject } = useProjects()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [useRhythm, setUseRhythm] = useState(true)
  const done = BLOCKS.filter((b) => bd.review[b] === 'approved').length
  const total = project.spec.totalEpisodes
  const scaled = scaleRhythm(bd.rhythm, bd.totalEpisodes, total)

  const reference = () => {
    const cur = latestProject(project.id)
    if (!cur?.work.breakdown) return
    const rhythm = useRhythm && scaled.paywalls.length ? scaled : cur.rhythm
    patchWork(
      cur.id,
      { breakdown: { ...cur.work.breakdown, referencedAt: new Date().toISOString() }, architecture: cur.work.architecture ?? emptyArchitecture(total) },
      '一键引用对标剧拆解，进入故事架构',
    )
    updateProject(cur.id, { rhythm, ...(cur.status === 'draft' ? { status: 'writing' as const } : {}) }, useRhythm ? `采用对标剧节奏框架：首付费第 ${rhythm.paywalls[0]} 集` : undefined)
    toast('已引用到故事架构')
    navigate(stagePath(cur, 'architecture'))
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white px-5 py-3.5 shadow-card">
      <div className="flex flex-wrap items-center gap-3 text-[13px]">
        <span className="font-medium">
          审核进度 <span className="tabular-nums">{done}/4</span>
        </span>
        <div className="flex gap-1">
          {BLOCKS.map((b, i) => (
            <span key={b} className={clsx('rounded px-1.5 py-0.5 text-[11px]', bd.review[b] === 'approved' ? 'bg-emerald-100 text-emerald-800' : 'bg-canvas text-ink-500')}>
              {BREAKDOWN_BLOCKS[i].label}
            </span>
          ))}
        </div>
        {bd.referencedAt && <span className="text-xs text-ink-500">已于 {formatDateTime(bd.referencedAt)} 引用到故事架构</span>}
      </div>
      <div className="flex items-center gap-2">
        {bd.referencedAt && (
          <Link to={stagePath(project, 'architecture')} className="flex items-center gap-1 px-2 text-[13px] font-medium text-brand-600 hover:text-brand-700">
            去故事架构
            <ArrowRight size={14} />
          </Link>
        )}
        <Button size="sm" variant={bd.referencedAt ? 'secondary' : 'primary'} disabled={done < 4} title={done < 4 ? '四个板块全部确认后才能引用' : undefined} onClick={() => setOpen(true)}>
          <Link2 size={14} />
          {bd.referencedAt ? '重新引用' : '一键引用'}
        </Button>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="引用到故事架构"
        desc="拆解结果将作为改写的参照：冲突主线、人物关系与逐集节奏会在后续环节对照显示。"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              onClick={() => {
                setOpen(false)
                reference()
              }}
            >
              引用并进入故事架构
            </Button>
          </>
        }
      >
        <label className="flex items-start gap-2.5 rounded-lg border border-line p-3.5 text-[13px]">
          <input type="checkbox" checked={useRhythm} onChange={(e) => setUseRhythm(e.target.checked)} className="mt-0.5 size-4 accent-brand-600" />
          <span>
            {bd.totalEpisodes === total ? '采用对标剧的节奏框架' : `按本项目 ${total} 集等比映射对标剧（${bd.totalEpisodes} 集）的节奏框架`}
            <span className="mt-1 block text-xs text-ink-500">
              首付费第 {scaled.paywalls[0] ?? '—'} 集 · 付费卡点 {scaled.paywalls.join('、') || '—'} · 大反转 {scaled.twists.join('、') || '—'} · 高潮第 {scaled.climaxFrom} 集起
            </span>
          </span>
        </label>
      </Modal>
    </div>
  )
}

export default function BreakdownStage({ project }: { project: Project }) {
  const patchWork = useProjects((s) => s.patchWork)
  const { running, run } = useAiTask()
  const [step, setStep] = useState<number | null>(null)
  const [editing, setEditing] = useState<EpisodeBreakdown | null>(null)
  const bd = project.work.breakdown

  if (!project.work.source) return <ImportCard project={project} />

  const analyze = async () => {
    const source = latestProject(project.id)?.work.source
    if (!source) return
    const result = await run('analyze', (signal) => analyzeBenchmark(source, setStep, signal))
    setStep(null)
    if (!result) return
    patchWork(project.id, { breakdown: result }, `完成对标剧拆解：${result.totalEpisodes} 集，${result.characters.length} 个关键人物`)
    toast('拆解完成，请逐个板块审核')
  }

  /** 写回拆解结果：以 store 中最新的版本为底 */
  const patch = (next: Partial<Breakdown>, note?: string) => {
    const cur = latestProject(project.id)?.work.breakdown
    if (cur) patchWork(project.id, { breakdown: { ...cur, ...next } }, note)
  }
  const toggle = (block: BreakdownBlock, index: number) => {
    if (!bd) return
    const approved = bd.review[block] === 'approved'
    patch({ review: { ...bd.review, [block]: approved ? 'pending' : 'approved' } }, approved ? undefined : `拆解审核通过：${BREAKDOWN_BLOCKS[index].label}`)
  }
  const locked = (block: BreakdownBlock) => bd?.review[block] === 'approved'

  return (
    <>
      <SourceCard project={project} onAnalyze={analyze} step={step} running={running === 'analyze'} />
      {bd && step === null && (
        <>
          <ReviewBar project={project} bd={bd} />
          <BlockCard index={0} block="synopsis" bd={bd} onToggle={() => toggle('synopsis', 0)} desc="目标受众、题材、核心设定与付费卡点规律">
            <SynopsisBlock bd={bd} locked={locked('synopsis')} patch={patch} />
          </BlockCard>
          <BlockCard index={1} block="characters" bd={bd} onToggle={() => toggle('characters', 1)} desc="关键人物的定位、性格与事件，以及全剧关系网">
            <CharactersBlock bd={bd} locked={locked('characters')} patch={patch} />
          </BlockCard>
          <BlockCard index={2} block="mainline" bd={bd} onToggle={() => toggle('mainline', 2)} desc="五段式冲突主线与节奏框架——经市场验证的结构，仿写时尽量保持">
            <MainlineBlock bd={bd} locked={locked('mainline')} patch={patch} />
          </BlockCard>
          <BlockCard index={3} block="episodes" bd={bd} onToggle={() => toggle('episodes', 3)} desc="每集 12 个字段，点击任意一行查看或修改">
            <EpisodesBlock bd={bd} onOpen={setEditing} />
          </BlockCard>
          <EpisodeModal
            episode={editing}
            locked={locked('episodes')}
            onClose={() => setEditing(null)}
            onSave={(e) => patch({ episodes: bd.episodes.map((x) => (x.ep === e.ep ? e : x)) })}
          />
        </>
      )}
      {bd && step === null && bd.referencedAt === null && BLOCKS.every((b) => bd.review[b] === 'approved') && (
        <p className="flex items-center justify-center gap-1.5 text-[13px] text-emerald-700">
          <CircleCheck size={14} />
          四个板块已全部确认，可以点击上方「一键引用」进入改写
        </p>
      )}
    </>
  )
}
