import clsx from 'clsx'
import { ArrowRight, ChevronDown, ChevronLeft, ChevronRight, CircleCheck, Eye, FileUp, Link2, Plus, Trash2, X } from 'lucide-react'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { HTMLAttributes, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router'
import { ConfirmDialog, Modal } from '../../../components/overlay'
import { RELATION_GROUPS, RelationGraph, RelationLegend } from '../../../components/project/RelationGraph'
import type { GraphPerson } from '../../../components/project/RelationGraph'
import { RhythmChart } from '../../../components/project/RhythmChart'
import { AiButton, AutoTextarea, InlineInput, RelationKindList, Stat, Table, latestProject, stagePath, useAiTask } from '../../../components/stage/StageKit'
import { Badge, Button, Card, CardHeader, Field, Input, Segmented, Select, Textarea } from '../../../components/ui'
import { MAX_SOURCE_BYTES } from '../../../domain/constants'
import { BREAKDOWN_BLOCKS } from '../../../domain/pipeline'
import type { BenchmarkCharacter, Breakdown, BreakdownBlock, CharacterRole, EpisodeBreakdown, HeroDetailKey, LineBeat, Project, Relation, SceneBeat, SourceScript, Synopsis } from '../../../domain/types'
import { alignRhythm, benchRanges } from '../../../domain/align'
import { emptyArchitecture, relationGroup, scaleRhythm } from '../../../domain/work'
import { formatDateTime } from '../../../lib/format'
import { ANALYZE_STEPS, SAMPLE_SCRIPT, SAMPLE_SCRIPT_NAME, analyzeBenchmark, parseSource } from '../../../services/ai'
import { useProjects } from '../../../store/projects'
import { toast } from '../../../store/toast'
import { useV2 } from '../../../store/uiVersion'
import { useStageSlot } from '../../../v2/bottomSlot'

/** 板块顺序：故事梗概 → 冲突主线 · 内容简介 → 人物设定 */
const BLOCKS: BreakdownBlock[] = BREAKDOWN_BLOCKS.map((b) => b.key)
const blockLabel = (block: BreakdownBlock) => BREAKDOWN_BLOCKS.find((b) => b.key === block)!.label

/** 一卡：第一个付费卡点。付费短剧最重要的是第 1 集和一卡，第 1 集到一卡那一集细拆；之后只有付费卡点集按一卡细拆（11/4 标注 #84），其余只写走向 */
const firstPaywall = (bd: Breakdown) => bd.rhythm.paywalls[0] ?? bd.totalEpisodes

/** 字段、名字、说明、是否占满一行；写法按 11/4 标注给的样例 */
const SYNOPSIS_FIELDS: [keyof Synopsis, string, string?, boolean?][] = [
  ['audience', '目标受众'],
  ['genre', '题材类型'],
  ['coreSetup', '核心设定', '一句话概括整个故事：谁、遭遇了什么、靠什么翻身、结局如何', true],
  ['style', '风格元素'],
  ['paywalls', '付费卡点'],
  ['world', '世界观', '总分写：先总说整个世界是什么样的（规则），再分写各阵营的设定（狼人、吸血鬼、规则怪谈、异能……），最后写细主要发生地点——教会、领地、北境这类专有名词都是私设，要讲清是什么地方', true],
  ['goldenFinger', '金手指', '最重要的是讲清金手指的能力是什么：核心能力每项写是什么、来历、能做到什么（剧里第几集怎么用的）、条件与限制（什么时候能用、有什么代价）；另写首次出现、表现方式（首集展示、渐进释放、权威认证）、与主线强相关', true],
  ['highlights', '核心亮点', '这里就是期待值：观众为什么追下去。写核心爽点（你以为……其实……）、主线任务（前十集）、情感双线、子类型特征', true],
  ['summary', '故事简介', '一段话把整个故事从头讲到尾：主角是谁、处境如何 → 谁为了什么、用什么手段步步紧逼 → 转机 → 反派变本加厉 → 高潮 → 结局，主角的身份怎么变', true],
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
        desc="粘贴全文或上传 .txt / .md；每集以「第一集」「第1集」或「EP1」单独成行，系统按分集切分后再拆解"
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
          placeholder={'第一集\n1-1：夜，内，议事厅\n人物：凯恩，艾拉\n△ 满月高悬，全族屏息。\n凯恩：我拒绝艾拉成为我的伴侣。\n艾拉os：你会后悔的。\n\n第二集\n……'}
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
        desc="当前剧本和拆解结果（含修改）都会被清除。"
        confirmText="清除并重新导入"
      />
      <ConfirmDialog
        open={confirm === 'reanalyze'}
        onClose={() => setConfirm(null)}
        onConfirm={onAnalyze}
        title="重新拆解？"
        desc="三个板块会重新生成，已做的修改会被覆盖。"
        confirmText="重新拆解"
      />
    </Card>
  )
}

/** 一个板块：11/4 标注 #76–#78 去掉「确认无误」，板块不再逐块审核，随时可改 */
function BlockCard({ block, desc, children }: { block: BreakdownBlock; desc?: string; children: ReactNode }) {
  return (
    <Card id={`bd-block-${block}`} className="scroll-mt-24 overflow-clip">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <span className="text-ink-400 tabular-nums">{BLOCKS.indexOf(block) + 1}</span>
            {blockLabel(block)}
          </span>
        }
        desc={desc}
      />
      {children}
    </Card>
  )
}

function SynopsisBlock({ bd, patch }: { bd: Breakdown; patch: (p: Partial<Breakdown>) => void }) {
  return (
    <div className="grid gap-4 p-5 md:grid-cols-2">
      {SYNOPSIS_FIELDS.map(([key, label, hint, wide]) => (
        <div key={key} data-synopsis={key} className={clsx(wide && 'md:col-span-2')}>
          <Field label={label} hint={hint}>
            <AutoTextarea aria-label={label} value={bd.synopsis[key] ?? ''} onChange={(e) => patch({ synopsis: { ...bd.synopsis, [key]: e.target.value } })} />
          </Field>
        </div>
      ))}
    </div>
  )
}

/* ---------------------------------- 人物设定 ---------------------------------- */

const graphRole = (role: string): CharacterRole => (role.includes('主角') ? '主角' : /反派/.test(role) ? '反派' : /感情|暧昧|恋|伴侣/.test(role) ? '暧昧对象' : '配角')
const ROLE_DOT: Record<CharacterRole, string> = { 主角: 'bg-brand-500', 暧昧对象: 'bg-rose-400', 反派: 'bg-red-600', 配角: 'bg-ink-300' }
const isHero = (c: BenchmarkCharacter) => c.role.includes('主角')

type PersonKey = 'purpose' | HeroDetailKey
type PersonRow = [PersonKey, string, string]

/** 主角（11/4 第五轮标注 #69）：简介、身份、金手指、动机；名字和人物设定的小传一样，动机单独一组。性格、背景、缺陷、弧光、事件、代表台词照样拆，不显示 */
const HERO_HEAD: PersonRow[] = [
  ['intro', '简介', '一段话：这个人是谁、在剧里经历了什么、最后成了什么'],
  ['profile', '身份', '开局是什么身份、被当成什么人；真实身份；结局成了什么'],
  ['ability', '金手指', '主角靠什么翻身；每项能力的细节写在故事梗概的「金手指」'],
]
const HERO_MOTIVES: PersonRow[] = [
  ['goal', '表面追求', '眼下想做成的事，可以分前期、后期'],
  ['desire', '终极渴望', '内心真正想要的'],
  ['fear', '潜意识恐惧', '最怕的事'],
]
/** 配角：在这部剧里的作用；定位在上面 */
const OTHER_ROWS: PersonRow[] = [['purpose', '作用', '在这部剧里起什么作用：制造困境、感情线、帮主角翻身、揭开真相……']]

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <dt className="w-24 shrink-0 pt-2 text-[13px] text-ink-500">{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  )
}

/** 一个人物的拆解：交互和人物设定的小传一样，主角多拆几项；这个人的关系在这里改 */
function PersonEditor({
  c,
  bd,
  onChange,
  onRemove,
  setRelations,
}: {
  c: BenchmarkCharacter
  bd: Breakdown
  onChange: (next: Partial<BenchmarkCharacter>) => void
  onRemove: () => void
  setRelations: (next: Relation[]) => void
}) {
  const hero = isHero(c)
  const others = bd.characters.filter((x) => x !== c && x.name.trim()).map((x) => x.name)
  const mine = bd.relations.map((r, i) => ({ r, i, other: r.a === c.name ? r.b : r.a })).filter(({ r }) => c.name && (r.a === c.name || r.b === c.name))
  const setRel = (i: number, next: Partial<Relation>) => setRelations(bd.relations.map((r, j) => (j === i ? { ...r, ...next } : r)))
  const row = ([key, label, placeholder]: PersonRow) => (
    <Row key={key} label={label}>
      <AutoTextarea inline aria-label={label} value={c[key] ?? ''} onChange={(e) => onChange({ [key]: e.target.value })} placeholder={placeholder} />
    </Row>
  )
  return (
    <div data-bd-person-detail={c.name} className="min-w-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
        <span className={clsx('size-2.5 shrink-0 rounded-full', ROLE_DOT[graphRole(c.role)])} />
        <h4 className="mr-auto text-[15px] font-semibold text-ink-900">
          {c.role || '未定位'}：{c.name || '未命名'}
        </h4>
        <Button variant="ghost" size="sm" className="text-red-600" onClick={onRemove}>
          <Trash2 size={14} />
          删除
        </Button>
      </div>
      <div className="space-y-5 p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs text-ink-500">名字</span>
            <Input aria-label="角色名" value={c.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="名字" className="h-9 font-medium" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-ink-500">定位</span>
            <Input aria-label="定位" list="bd-roles" value={c.role} onChange={(e) => onChange({ role: e.target.value })} placeholder="主角 / 感情线核心 / 反派 / 配角 · 盟友" className="h-9" />
          </label>
        </div>
        <datalist id="bd-roles">
          {['主角', '感情线核心', '反派', '配角 · 盟友', '配角 · 知情人'].map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>

        {hero ? (
          <>
            <dl className="space-y-1">{HERO_HEAD.map(row)}</dl>
            <div className="rounded-lg bg-canvas/70 px-3 py-2">
              <div className="mb-1 text-[13px] font-medium text-ink-700">动机</div>
              <dl className="space-y-1">{HERO_MOTIVES.map(row)}</dl>
            </div>
          </>
        ) : (
          <>
            <dl className="space-y-1">{OTHER_ROWS.map(row)}</dl>
            <p className="text-xs text-ink-400">主角拆简介、身份、金手指、动机；其他人物拆在这部剧里的作用和定位。定位写成「主角」就按主角拆</p>
          </>
        )}

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[13px] font-medium text-ink-700">关系</span>
            <Button variant="ghost" size="sm" disabled={!c.name.trim() || !others.length} onClick={() => setRelations([...bd.relations, { a: c.name, b: others[0], kind: '', label: '' }])}>
              <Plus size={14} />
              添加关系
            </Button>
          </div>
          <ul className="space-y-1">
            {mine.map(({ r, i, other }) => (
              <li key={i} className="flex items-center gap-2">
                <span className="shrink-0 text-[13px] text-ink-500">与</span>
                <Select aria-label="关系人物" value={other} onChange={(e) => setRel(i, r.a === c.name ? { b: e.target.value } : { a: e.target.value })} className="h-8 w-32 text-[13px]">
                  {!others.includes(other) && <option value={other}>{other || '选择人物'}</option>}
                  {others.map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </Select>
                <InlineInput aria-label="关系类型" list="relation-kinds" value={r.kind} onChange={(e) => setRel(i, { kind: e.target.value })} placeholder="关系，如：伴侣" className="w-28" />
                <InlineInput aria-label="关系备注" value={r.label} onChange={(e) => setRel(i, { label: e.target.value })} placeholder="这段关系怎么变，如：拒绝 → 悔恨 → 追回" className="flex-1" />
                <button className="rounded p-1.5 text-ink-300 hover:bg-red-50 hover:text-red-600" aria-label="删除关系" onClick={() => setRelations(bd.relations.filter((_, j) => j !== i))}>
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
            {!mine.length && <li className="py-1 text-xs text-ink-400">{c.name.trim() ? '暂无关系' : '先填名字再添加关系'}</li>}
          </ul>
          <RelationKindList />
        </div>
      </div>
    </div>
  )
}

/** 人物设定（11/4 标注）：交互参照人物设定页——左边人物列表，右边这个人的拆解；下面是全剧关系网 */
function CharactersBlock({ bd, patch }: { bd: Breakdown; patch: (p: Partial<Breakdown>) => void }) {
  const [picked, setPicked] = useState(0)
  const [removing, setRemoving] = useState<number | null>(null)
  const [view, setView] = useState<'graph' | 'table'>('graph')
  const at = Math.min(picked, bd.characters.length - 1)
  const c = bd.characters[at]
  const setChar = (i: number, next: Partial<BenchmarkCharacter>) => {
    const old = bd.characters[i].name
    const rename = (n: string) => (next.name !== undefined && n === old ? next.name : n)
    patch({
      characters: bd.characters.map((x, j) => (j === i ? { ...x, ...next } : x)),
      relations: bd.relations.map((r) => ({ ...r, a: rename(r.a), b: rename(r.b) })),
    })
  }
  const remove = (i: number) => {
    const name = bd.characters[i].name
    patch({ characters: bd.characters.filter((_, j) => j !== i), relations: bd.relations.filter((r) => !name || (r.a !== name && r.b !== name)) })
  }
  // 关系图按定位上色：拆解里的定位是文字（主角 / 感情线核心 / 反派 / 配角 · 盟友），对到人物设定的四类
  const people: GraphPerson[] = bd.characters.filter((x) => x.name.trim()).map((x) => ({ id: x.name, name: x.name, role: graphRole(x.role) }))

  return (
    <>
      <div className="grid lg:grid-cols-[220px_minmax(0,1fr)]">
        <div className="border-b border-line p-2 lg:border-r lg:border-b-0">
          <ul data-bd-cast className="space-y-0.5">
            {bd.characters.map((x, j) => (
              <li key={j}>
                <button
                  type="button"
                  data-bd-person={x.name}
                  onClick={() => setPicked(j)}
                  className={clsx('flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left', j === at ? 'bg-brand-50' : 'hover:bg-canvas')}
                >
                  <span className={clsx('mt-1.5 size-2 shrink-0 rounded-full', ROLE_DOT[graphRole(x.role)])} />
                  <span className="min-w-0">
                    <span className={clsx('block truncate text-[13px] font-medium', j === at ? 'text-brand-700' : 'text-ink-900')}>{x.name || '未命名'}</span>
                    <span className="block truncate text-xs text-ink-500">{x.role || '未定位'}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <Button
            variant="ghost"
            size="sm"
            className="mt-1"
            onClick={() => {
              patch({ characters: [...bd.characters, { name: '', role: '配角', personality: '', events: '' }] })
              setPicked(bd.characters.length)
            }}
          >
            <Plus size={14} />
            添加角色
          </Button>
        </div>
        {c ? (
          <PersonEditor key={at} c={c} bd={bd} onChange={(next) => setChar(at, next)} onRemove={() => setRemoving(at)} setRelations={(relations) => patch({ relations })} />
        ) : (
          <p className="px-5 py-8 text-center text-[13px] text-ink-400">还没有人物</p>
        )}
      </div>

      <div data-bd-relations className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 pt-4 pb-2">
        <span className="text-[13px] font-medium">
          全剧人物关系网
          <span className="ml-2 text-xs font-normal text-ink-400">在上面人物的「关系」里改；点人物可切到他的拆解</span>
        </span>
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: 'graph', label: '关系图' },
            { value: 'table', label: '关系表' },
          ]}
        />
      </div>
      {view === 'graph' ? (
        <div data-bd-graph className="space-y-3 px-5 pt-1 pb-4">
          <RelationLegend />
          {bd.relations.length ? (
            <RelationGraph
              characters={people}
              relations={bd.relations}
              selectedId={c?.name}
              onSelect={(name) => {
                const j = bd.characters.findIndex((x) => x.name === name)
                if (j >= 0) setPicked(j)
              }}
            />
          ) : (
            <p className="py-8 text-center text-[13px] text-ink-400">暂无关系：在人物的「关系」里添加</p>
          )}
        </div>
      ) : bd.relations.length ? (
        <div data-bd-table>
          <Table columns={['人物', '关系', '人物', '备注']} minWidth={560}>
            {bd.relations.map((r, i) => (
              <tr key={i}>
                <td className="px-4 py-2.5 whitespace-nowrap">{r.a || '—'}</td>
                <td className="px-4 py-2.5 whitespace-nowrap">
                  <span className="flex items-center gap-1.5">
                    <span className="h-0.5 w-3 rounded-full" style={{ background: RELATION_GROUPS[relationGroup(r.kind)].color }} />
                    {r.kind || <span className="text-ink-300">未填</span>}
                  </span>
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap">{r.b || '—'}</td>
                <td className="px-4 py-2.5 text-ink-700">{r.label || <span className="text-ink-300">—</span>}</td>
              </tr>
            ))}
          </Table>
        </div>
      ) : (
        <p className="px-5 pb-6 text-[13px] text-ink-400">暂无关系</p>
      )}

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing === null) return
          remove(removing)
          setPicked(Math.max(0, removing - 1))
        }}
        danger
        title="删除人物？"
        desc={`「${removing !== null ? bd.characters[removing]?.name || '未命名' : ''}」及其相关的人物关系会被删除。`}
        confirmText="删除"
      />
    </>
  )
}

/* ---------------------------------- 冲突主线 · 内容简介 ---------------------------------- */

/** 节奏曲线收起 / 展开，记在本机 */
const RHYTHM_FOLD_KEY = 'zhiying.bdRhythm'

/** 冲突主线的节奏：一行摘要常显，曲线可以收起 */
function RhythmRow({ bd }: { bd: Breakdown }) {
  const { rhythm } = bd
  const [open, setOpen] = useState(() => localStorage.getItem(RHYTHM_FOLD_KEY) === 'open')
  const toggle = () => {
    localStorage.setItem(RHYTHM_FOLD_KEY, open ? 'closed' : 'open')
    setOpen(!open)
  }
  return (
    <div data-bd-rhythm className="px-5 py-3.5">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="mr-1 text-[13px] font-medium text-ink-900">节奏</span>
        <Badge tone="orange">一卡 第 {rhythm.paywalls[0] ?? '—'} 集</Badge>
        <Badge tone="orange">付费卡点 {rhythm.paywalls.join('、') || '—'}</Badge>
        <Badge tone="green">大反转 {rhythm.twists.join('、') || '—'}</Badge>
        <Badge tone="gray">结局高潮 第 {rhythm.climaxFrom} 集起</Badge>
        <Button variant="ghost" size="sm" className="ml-auto" data-bd-rhythm-toggle aria-expanded={open} onClick={toggle}>
          <ChevronDown size={14} className={clsx('transition-transform', open && 'rotate-180')} />
          {open ? '收起曲线' : '展开曲线'}
        </Button>
      </div>
      {open && (
        <div data-bd-curve className="mt-3">
          <RhythmChart rhythm={rhythm} total={bd.totalEpisodes} height={180} showTableToggle={false} />
          <p className="mt-2 text-xs text-ink-400">节奏节点按冲突与揭秘强度从剧本中推断；一键引用时可按本项目集数等比映射</p>
        </div>
      )}
    </div>
  )
}

/** 一集的原文：上一集 / 下一集可以接着翻 */
function SourceModal({ source, ep, onChange, onClose }: { source: SourceScript | null; ep: number | null; onChange: (ep: number) => void; onClose: () => void }) {
  const list = source?.episodes ?? []
  const at = list.findIndex((e) => e.ep === ep)
  const cur = list[at]
  return (
    <Modal
      open={ep !== null}
      onClose={onClose}
      title={`第 ${ep ?? ''} 集原文`}
      desc={source?.name}
      width={720}
      footer={
        <>
          <Button variant="secondary" disabled={at <= 0} onClick={() => onChange(list[at - 1].ep)}>
            <ChevronLeft size={14} />
            上一集
          </Button>
          <Button variant="secondary" disabled={at < 0 || at >= list.length - 1} onClick={() => onChange(list[at + 1].ep)}>
            下一集
            <ChevronRight size={14} />
          </Button>
        </>
      }
    >
      <div data-source-text className="scrollbar-thin max-h-[60vh] overflow-y-auto pr-1">
        {cur ? (
          <pre className="rounded-lg bg-canvas px-3 py-2 font-mono text-xs leading-6 whitespace-pre-wrap text-ink-700">{cur.text}</pre>
        ) : (
          <p className="py-6 text-center text-[13px] text-ink-400">剧本里没有这一集</p>
        )}
      </div>
    </Modal>
  )
}

const BLANK_SCENE: SceneBeat = { scene: '', action: '', lines: [] }
const BLANK_LINE: LineBeat = { text: '', emotion: '', turn: false }

/** 一场的情绪转折：开场的情绪 + 每个转折点的情绪，相邻相同的并掉 */
function emotionChain(lines: LineBeat[]) {
  const start = lines.find((b) => b.emotion.trim())
  return [start, ...lines.filter((b) => b.turn && b !== start)].map((b) => b?.emotion.trim() ?? '').filter((e, i, list) => e && e !== list[i - 1])
}

/** 一集里的一栏：左边栏名、右边内容，各栏左边对齐（输入框自带 px-2，别的内容也留 px-2） */
function EpRow({ label, tone, className, children, ...rest }: { label: string; tone?: string; children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={clsx('grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2', className)} {...rest}>
      <dt className={clsx('pt-1.5 text-xs leading-6 font-medium', tone ?? 'text-ink-500')}>{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  )
}

/** 情绪链：一个个情绪用箭头连起来 */
function Chain({ list }: { list: string[] }) {
  return list.map((e, k) => (
    <Fragment key={k}>
      {k > 0 && <ArrowRight size={11} className="text-ink-300" />}
      <span className="rounded bg-white px-1.5 py-0.5 text-ink-700 ring-1 ring-line ring-inset">{e}</span>
    </Fragment>
  ))
}

/**
 * 细拆（11/4 标注）：一场一块，场次、关键动作，下面逐句 / 逐段——这时的情绪、哪一句带来转折；
 * 转折那一句就是核心台词，这一场的情绪转折从这些转折点串出来。
 * 排版（11/4 标注 #70）：每一场默认收成一行（场次 · 关键动作 · 几句），点开看逐句；转折句已经提到上面的「核心台词」，不用展开也能看到
 */
function SceneList({ ep, scenes, onChange }: { ep: number; scenes: SceneBeat[]; onChange: (next: SceneBeat[]) => void }) {
  const [open, setOpen] = useState<Set<number>>(() => new Set())
  // 还没逐句拆的场直接展开，免得要先点开才能加句
  const isOpen = (i: number) => open.has(i) || !scenes[i].lines.length
  const toggle = (i: number) =>
    setOpen((cur) => {
      const next = new Set(cur)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  const all = scenes.length > 0 && scenes.every((_, i) => isOpen(i))
  const lines = scenes.reduce((n, s) => n + s.lines.length, 0)
  const turns = scenes.reduce((n, s) => n + s.lines.filter((b) => b.turn).length, 0)
  const set = (i: number, next: Partial<SceneBeat>) => onChange(scenes.map((s, j) => (j === i ? { ...s, ...next } : s)))
  const add = () => {
    setOpen((cur) => new Set(cur).add(scenes.length))
    onChange([...scenes, { ...BLANK_SCENE, scene: `${ep}-${scenes.length + 1} ` }])
  }
  const remove = (i: number) => {
    setOpen((cur) => new Set([...cur].filter((k) => k !== i).map((k) => (k > i ? k - 1 : k))))
    onChange(scenes.filter((_, j) => j !== i))
  }
  return (
    <div data-scenes={ep} className="space-y-1.5">
      <div className="flex items-center gap-2 px-2 pt-1.5 text-xs leading-6 text-ink-500 tabular-nums">
        <span data-scene-stats>{scenes.length ? `${scenes.length} 场 · ${lines} 句 · ${turns} 处转折` : '还没细拆：一卡前每集和付费卡点集要拆到场景，逐句标出情绪和转折'}</span>
        {scenes.length > 1 && (
          <button type="button" className="ml-auto rounded px-1.5 text-ink-500 hover:bg-canvas hover:text-ink-900" onClick={() => setOpen(all ? new Set() : new Set(scenes.map((_, i) => i)))}>
            {all ? '全部收起' : '全部展开'}
          </button>
        )}
      </div>
      {scenes.map((s, i) => {
        const shown = isOpen(i)
        const chain = emotionChain(s.lines)
        const setLine = (j: number, next: Partial<LineBeat>) => set(i, { lines: s.lines.map((b, k) => (k === j ? { ...b, ...next } : b)) })
        return (
          <div key={i} data-scene={i} className="group/scene rounded-lg border border-line">
            <div className="flex items-start gap-1 py-0.5 pr-1.5 pl-0.5">
              <button
                type="button"
                data-scene-toggle
                aria-expanded={shown}
                aria-label={shown ? '收起这一场' : '展开这一场的逐句'}
                onClick={() => toggle(i)}
                className="mt-1 rounded p-1 text-ink-400 hover:bg-canvas hover:text-ink-900"
              >
                <ChevronRight size={14} className={clsx('transition-transform', shown && 'rotate-90')} />
              </button>
              <InlineInput aria-label="场次" value={s.scene} onChange={(e) => set(i, { scene: e.target.value })} placeholder={`${ep}-${i + 1} 地点`} className="w-36 shrink-0 font-medium" />
              <AutoTextarea inline aria-label="关键动作" value={s.action} onChange={(e) => set(i, { action: e.target.value })} placeholder="关键动作：这一场通过什么画面、动作表现了什么" className="flex-1 text-[13px] text-ink-700" />
              <button type="button" tabIndex={-1} onClick={() => toggle(i)} className="mt-1.5 shrink-0 text-xs leading-6 text-ink-400 tabular-nums hover:text-ink-900">
                {s.lines.length} 句
              </button>
              <button className="mt-1 rounded p-1 text-ink-300 opacity-0 group-hover/scene:opacity-100 hover:bg-red-50 hover:text-red-600 focus:opacity-100" aria-label="删除这一场" onClick={() => remove(i)}>
                <X size={14} />
              </button>
            </div>
            {shown && (
              <div className="border-t border-line px-2 pt-2 pb-1.5">
                {chain.length > 0 && (
                  <div data-chain className="flex flex-wrap items-center gap-1 px-1.5 pb-1.5 text-xs">
                    <span className="mr-1 text-ink-400">情绪</span>
                    <Chain list={chain} />
                  </div>
                )}
                <ol className="space-y-0.5">
                  {s.lines.map((b, j) => (
                    <li key={j} data-line-turn={b.turn || undefined} className={clsx('group/line flex items-start gap-2 rounded-md py-0.5 pr-1', b.turn ? 'bg-orange-50/70' : 'hover:bg-canvas/60')}>
                      <span aria-hidden className={clsx('my-1 w-0.5 self-stretch rounded-full', b.turn ? 'bg-orange-400' : 'bg-transparent')} />
                      <InlineInput aria-label="情绪" value={b.emotion} onChange={(e) => setLine(j, { emotion: e.target.value })} placeholder="情绪" className={clsx('w-16 shrink-0 text-xs', b.turn ? 'font-medium text-orange-800' : 'text-ink-500')} />
                      <AutoTextarea inline aria-label="台词" value={b.text} onChange={(e) => setLine(j, { text: e.target.value })} placeholder="一句或一段：说话人：台词，或 △ 动作" className={clsx('flex-1 text-[13px] leading-6', b.turn ? 'font-medium text-ink-900' : 'text-ink-700')} />
                      <button
                        type="button"
                        aria-pressed={b.turn}
                       
                        title={b.turn ? '这一句带来情绪转折（核心台词）；再点取消' : '标成转折：这一句带来情绪转折，就是核心台词'}
                        onClick={() => setLine(j, { turn: !b.turn })}
                        className={clsx(
                          'mt-1 shrink-0 rounded px-1.5 py-0.5 text-[11px]',
                          b.turn ? 'bg-orange-100 font-medium text-orange-800' : 'text-ink-400 opacity-0 ring-1 ring-line ring-inset group-hover/line:opacity-100 hover:text-ink-900 focus:opacity-100',
                        )}
                      >
                        转折
                      </button>
                      <button className="mt-1 rounded p-1 text-ink-300 opacity-0 group-hover/line:opacity-100 hover:bg-red-50 hover:text-red-600 focus:opacity-100" aria-label="删除这一句" onClick={() => set(i, { lines: s.lines.filter((_, k) => k !== j) })}>
                        <X size={13} />
                      </button>
                    </li>
                  ))}
                  {!s.lines.length && <li className="px-2 py-1 text-xs text-ink-400">还没逐句拆：把这一场的台词一句一句（或一段一段）列出来，写上情绪，标出带来转折的那一句</li>}
                </ol>
                <Button variant="ghost" size="sm" onClick={() => set(i, { lines: [...s.lines, { ...BLANK_LINE }] })}>
                  <Plus size={14} />
                  加一句
                </Button>
              </div>
            )}
          </div>
        )
      })}
      <Button variant="ghost" size="sm" onClick={add}>
        <Plus size={14} />
        添加一场
      </Button>
    </div>
  )
}

/** 首集拆开场（11/4 第五轮标注 #68）：前 3 秒、前 30 秒（主要动作和画面）、钩子 */
const OPENING_ROWS: ['open3s' | 'open30s' | 'endHook', string, string][] = [
  ['open3s', '前 3 秒', '第一个画面 / 第一句台词，用什么抓人'],
  ['open30s', '前 30 秒', '主要动作和画面，一行一个'],
  ['endHook', '钩子', '本集结尾留什么，让人点下一集'],
]

/**
 * 一集：走向（集纲），第 1 集到一卡另有本集核心台词和逐场逐句的细拆；首集另拆开场，一卡另拆卡点。
 * 一卡之后的付费卡点集按一卡来（11/4 标注 #84）：同样拆卡点、核心台词和逐场逐句。
 * 视频仿写的第 1 集只拆开场（前 3 秒、前 30 秒、钩子），不逐场逐句。
 * 排版（11/4 标注 #70）：左边一列栏名（走向 / 开场 / 卡点 / 核心台词 / 逐场细拆），右边内容，从上往下由粗到细；
 * 只有这一集最要紧的那块上底色（首集开场、付费卡点的卡点），核心台词连着整集的情绪走向一起看，逐句默认收起
 */
function EpisodeItem({ e, card, video, flash, onChange, onView }: { e: EpisodeBreakdown; card: number; video: boolean; flash: boolean; onChange: (next: Partial<EpisodeBreakdown>) => void; onView: () => void }) {
  const openingOnly = video && e.ep === 1
  const scenes = openingOnly ? [] : (e.scenes ?? [])
  const paywall = e.ep === card || e.paywall
  const fine = !openingOnly && (e.ep <= card || paywall || scenes.length > 0)
  const core = scenes.flatMap((s) => s.lines.filter((b) => b.turn).map((b) => ({ scene: s.scene.split(' ')[0], b })))
  // 整集的情绪走向：各场的情绪链接起来，相邻相同的并掉
  const chain = scenes.flatMap((s) => emotionChain(s.lines)).filter((x, i, list) => x !== list[i - 1])
  return (
    <li
      id={`bd-ep-${e.ep}`}
      data-ep={e.ep}
      className={clsx('scroll-mt-24 rounded-lg border bg-white px-4 pt-2.5 pb-3 ring-2 transition-shadow duration-500', paywall ? 'border-orange-200' : 'border-line', flash ? 'ring-brand-300' : 'ring-transparent')}
    >
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="font-semibold text-ink-900 tabular-nums">第 {e.ep} 集</span>
        {e.ep === 1 && <Badge tone="violet">首集</Badge>}
        {e.ep === card ? <Badge tone="orange">一卡</Badge> : e.paywall && <Badge tone="orange">付费卡点</Badge>}
        <button type="button" data-view-source={e.ep} onClick={onView} className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-ink-500 hover:bg-canvas hover:text-ink-900">
          <Eye size={13} />
          查看原文
        </button>
      </div>
      <dl className="mt-1 space-y-2">
        <EpRow label="走向">
          <AutoTextarea inline aria-label={`第 ${e.ep} 集走向`} value={e.flow ?? ''} onChange={(ev) => onChange({ flow: ev.target.value })} placeholder="一段话：哪部分剧情、通过什么、表现了什么" className="text-[13px] leading-6" />
        </EpRow>
        {e.ep === 1 && (
          <div data-bd-opening className="-mx-2 space-y-0.5 rounded-lg bg-violet-50/70 px-2 py-1">
            {OPENING_ROWS.map(([key, label, placeholder]) => (
              <EpRow key={key} label={label} tone="text-violet-800">
                <AutoTextarea inline aria-label={`首集${label}`} value={e[key] ?? ''} onChange={(ev) => onChange({ [key]: ev.target.value })} placeholder={placeholder} className="text-[13px] leading-6" />
              </EpRow>
            ))}
          </div>
        )}
        {paywall && (
          <EpRow data-bd-card-point={e.ep} label="卡点" tone="text-orange-800" className="-mx-2 rounded-lg bg-orange-50/80 px-2 py-1">
            <AutoTextarea
              inline
              aria-label={e.ep === card ? '一卡卡点' : `第 ${e.ep} 集卡点`}
              value={e.cardPoint ?? ''}
              onChange={(ev) => onChange({ cardPoint: ev.target.value })}
              placeholder="卡在哪一刻、卡前情绪怎么推上去、留下什么问题让人付费"
              className="text-[13px] leading-6"
            />
          </EpRow>
        )}
        {core.length > 0 && (
          <EpRow data-core-lines={e.ep} label="核心台词">
            <div className="px-2 py-1.5">
              <div data-ep-chain className="flex flex-wrap items-center gap-1 text-xs leading-5">
                <span className="mr-1 text-ink-400">情绪走向</span>
                <Chain list={chain} />
                <span className="ml-1 text-ink-400 tabular-nums">· 带来转折的 {core.length} 句</span>
              </div>
              <ul className="mt-1.5 space-y-0.5 text-[13px] leading-6">
                {core.map(({ scene, b }, k) => (
                  <li key={k} className="grid grid-cols-[2.5rem_3.5rem_minmax(0,1fr)] gap-x-2">
                    <span className="text-xs leading-6 text-ink-400 tabular-nums">{scene}</span>
                    <span className="truncate text-xs leading-6 font-medium text-orange-700">{b.emotion || '—'}</span>
                    <span className="whitespace-pre-line text-ink-900">{b.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </EpRow>
        )}
        {fine && (
          <EpRow label="逐场细拆">
            <SceneList ep={e.ep} scenes={scenes} onChange={(next) => onChange({ scenes: next })} />
          </EpRow>
        )}
      </dl>
    </li>
  )
}

const PHASE_NO = ['一', '二', '三', '四', '五', '六', '七', '八']

/**
 * 冲突主线 · 内容简介：交互类比情节大纲（11/4 标注）——上面一行节奏（曲线可收起），左边按冲突主线分段的目录，
 * 右边是选中这一段的梗概（类比粗纲，可改）和段下每集的走向（类比集纲）；可切完整视图看全部段。
 * 第 1 集到一卡逐场、逐句细拆，每集都能查看原文
 */
function StoryBlock({ bd, source, video, patch }: { bd: Breakdown; source: SourceScript | null; video: boolean; patch: (p: Partial<Breakdown>) => void }) {
  const card = firstPaywall(bd)
  const ranges = benchRanges(bd)
  const [viewing, setViewing] = useState<number | null>(null)
  const [phase, setPhase] = useState(0)
  const [full, setFull] = useState(false)
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set([0]))
  const [flash, setFlash] = useState<number | null>(null)
  const setEp = (ep: number, next: Partial<EpisodeBreakdown>) => patch({ episodes: bd.episodes.map((e) => (e.ep === ep ? { ...e, ...next } : e)) })
  const setBeat = (i: number, content: string) => patch({ mainLine: bd.mainLine.map((x, j) => (j === i ? { ...x, content } : x)) })
  const epsOf = (i: number) => {
    const [from, to] = ranges[i] ?? [0, -1]
    return bd.episodes.filter((e) => e.ep >= from && e.ep <= to)
  }
  const toggle = (i: number) =>
    setExpanded((cur) => {
      const next = new Set(cur)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  /** 选一段（或段里的某一集）：右边换成这一段，滚到段头或那一集 */
  const pick = (i: number, ep?: number) => {
    setPhase(i)
    setExpanded((cur) => new Set(cur).add(i))
    requestAnimationFrame(() => document.getElementById(ep ? `bd-ep-${ep}` : `bd-phase-${i}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
    if (ep) {
      setFlash(ep)
      setTimeout(() => setFlash((cur) => (cur === ep ? null : cur)), 1200)
    }
  }
  const shown = full ? bd.mainLine.map((_, i) => i) : [Math.min(phase, bd.mainLine.length - 1)]
  // 旧数据：拆解时间早于内容简介，走向是空的
  const legacy = bd.episodes.every((e) => !e.flow?.trim())
  return (
    <div>
      {legacy && <p className="bg-amber-50 px-5 py-2.5 text-[13px] text-amber-800">这份拆解是旧版逐集明细，没有每集走向；点上方「重新拆解」按内容简介重新生成</p>}
      <RhythmRow bd={bd} />
      <div className="grid border-t border-line lg:grid-cols-[220px_minmax(0,1fr)]">
        {/* 目录：按冲突主线分段，段下列每集 */}
        <div className="border-b border-line lg:border-r lg:border-b-0">
          <nav data-bd-tree aria-label="冲突主线分段" className="scrollbar-thin p-2 lg:sticky lg:top-stick lg:max-h-stick lg:overflow-y-auto">
            <div className="flex items-center justify-between px-2 pt-0.5 pb-1.5">
              <span className="text-xs text-ink-500 tabular-nums">
                {bd.mainLine.length} 段 · {bd.episodes.length} 集
              </span>
              <button type="button" data-bd-full aria-pressed={full} onClick={() => setFull((v) => !v)} className={clsx('rounded px-1.5 py-0.5 text-xs', full ? 'bg-brand-50 font-medium text-brand-700' : 'text-ink-500 hover:bg-canvas hover:text-ink-900')}>
                完整视图
              </button>
            </div>
            {bd.mainLine.map((b, i) => {
              const open = expanded.has(i)
              const eps = epsOf(i)
              return (
                <div key={b.beat} className="mt-0.5">
                  <div className={clsx('flex items-center rounded-md', !full && shown[0] === i ? 'bg-brand-50' : 'hover:bg-canvas')}>
                    <button className="p-1.5 text-ink-400" aria-label={open ? '收起' : '展开'} aria-expanded={open} onClick={() => toggle(i)}>
                      <ChevronRight size={14} className={clsx('transition-transform', open && 'rotate-90')} />
                    </button>
                    <button data-bd-phase-link={i} className="flex min-w-0 flex-1 items-center justify-between py-1.5 pr-2 text-left" onClick={() => pick(i)}>
                      <span className="min-w-0 truncate text-[13px] font-semibold text-ink-900">
                        {b.beat}
                        <span className="ml-1 text-[11px] font-normal text-ink-400 tabular-nums">{b.range}</span>
                      </span>
                      <span className="text-xs text-ink-400 tabular-nums">{eps.length}</span>
                    </button>
                  </div>
                  {open && (
                    <ul className="mb-1 ml-5 border-l border-line pl-1.5">
                      {eps.map((e) => (
                        <li key={e.ep}>
                          <button data-bd-ep-link={e.ep} className="flex w-full items-baseline gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-canvas" onClick={() => pick(i, e.ep)}>
                            <span className="w-5 shrink-0 text-right text-[11px] text-ink-300 tabular-nums">{e.ep}</span>
                            <span className="min-w-0">
                              <span className="flex items-center gap-1 text-[13px] text-ink-900">
                                第{e.ep}集
                                {e.ep === card && <span className="rounded bg-orange-100 px-1 text-[10px] text-orange-800">一卡</span>}
                                {e.ep > card && e.paywall && <span className="rounded bg-orange-50 px-1 text-[10px] text-orange-700">付费卡点</span>}
                                {e.ep <= card && e.ep !== card && <span className="rounded bg-canvas px-1 text-[10px] text-ink-500">细拆</span>}
                              </span>
                              {e.flow && <span className="block truncate text-xs text-ink-400">{e.flow}</span>}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </nav>
        </div>

        {/* 选中的段：梗概（粗纲）+ 每集走向（集纲） */}
        <div className="min-w-0 divide-y divide-line">
          {shown.map((i) => {
            const b = bd.mainLine[i]
            const [from, to] = ranges[i] ?? [0, -1]
            return (
              <section key={b.beat} id={`bd-phase-${i}`} data-phase={i} className="scroll-mt-24">
                <header className="bg-canvas/50 px-5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-[15px] font-semibold text-ink-900">
                      第{PHASE_NO[i] ?? i + 1}段 · {b.beat}
                    </h4>
                    <span className="text-[13px] text-ink-500 tabular-nums">{b.range}</span>
                    {from <= card && card <= to && <Badge tone="orange">一卡 第 {card} 集</Badge>}
                  </div>
                  <div className="mt-2">
                    <div className="mb-1 text-xs font-medium text-ink-500">本段梗概（粗纲）</div>
                    <AutoTextarea
                      inline
                      aria-label={b.beat}
                      value={b.content}
                     
                      onChange={(e) => setBeat(i, e.target.value)}
                      minRows={2}
                      placeholder="这一段的梗概：讲这一段的故事（类比粗纲），不逐集列"
                      className="bg-white text-[13px] leading-6 text-ink-700"
                    />
                  </div>
                </header>
                <ol className="space-y-3 p-4">
                  {epsOf(i).map((e) => (
                    <EpisodeItem key={e.ep} e={e} card={card} video={video} flash={flash === e.ep} onChange={(next) => setEp(e.ep, next)} onView={() => setViewing(e.ep)} />
                  ))}
                </ol>
              </section>
            )
          })}
          {!full && (
            <div className="flex justify-between px-5 py-2.5">
              <Button variant="ghost" size="sm" disabled={shown[0] === 0} onClick={() => pick(shown[0] - 1)}>
                <ChevronLeft size={14} />
                上一段
              </Button>
              <Button variant="ghost" size="sm" disabled={shown[0] === bd.mainLine.length - 1} onClick={() => pick(shown[0] + 1)}>
                下一段
                <ChevronRight size={14} />
              </Button>
            </div>
          )}
        </div>
      </div>
      <SourceModal source={source} ep={viewing} onChange={setViewing} onClose={() => setViewing(null)} />
    </div>
  )
}

/* ---------------------------------- 审核与引用 ---------------------------------- */

/** 版本二：滚到某个板块（板块留出 scroll-mt） */
const jumpTo = (block: BreakdownBlock) => requestAnimationFrame(() => document.getElementById(`bd-block-${block}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))

/** 板块跳转和一键引用：版本二放进页面底部的环节条（11/4 标注 #74；板块跳转靠左、一键引用靠右 #83），版本一仍在页面里；不再逐块审核（#76–#79），拆完就能引用 */
function ReferenceBar({ project, bd }: { project: Project; bd: Breakdown }) {
  const { patchWork, updateProject } = useProjects()
  const v2 = useV2()
  const slot = useStageSlot(v2)
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [useRhythm, setUseRhythm] = useState(true)
  const total = project.spec.totalEpisodes
  // 先分段、段内按比例：和集纲对位同一套规则（domain/align.ts）
  const scaled = alignRhythm(project) ?? scaleRhythm(bd.rhythm, bd.totalEpisodes, total)

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

  const docked = v2 && !!slot
  const info = (
    <div data-bd-bar className="flex flex-wrap items-center gap-2 text-[13px]">
      <span className="text-ink-500">板块</span>
      {BLOCKS.map((b) =>
        v2 ? (
          <button key={b} type="button" onClick={() => jumpTo(b)} title={`跳到「${blockLabel(b)}」`} className="rounded bg-canvas px-2 py-1 text-xs text-ink-700 transition-colors hover:ring-1 hover:ring-brand-300">
            {blockLabel(b)}
          </button>
        ) : (
          <span key={b} className="rounded bg-canvas px-1.5 py-0.5 text-[11px] text-ink-500">
            {blockLabel(b)}
          </span>
        ),
      )}
      {bd.referencedAt && <span className="text-xs text-ink-500">已于 {formatDateTime(bd.referencedAt)} 引用到故事架构</span>}
    </div>
  )
  const action = (
    <Button size={docked ? 'md' : 'sm'} variant={bd.referencedAt ? 'secondary' : 'primary'} onClick={() => setOpen(true)}>
      <Link2 size={14} />
      {bd.referencedAt ? '重新引用' : '一键引用'}
    </Button>
  )
  const modal = (
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
          {bd.totalEpisodes === total ? '采用对标剧的节奏框架' : `按冲突主线分段换算对标剧（${bd.totalEpisodes} 集）的节奏框架到本项目 ${total} 集：先对段，段内按比例`}
          <span className="mt-1 block text-xs text-ink-500">
            首付费第 {scaled.paywalls[0] ?? '—'} 集 · 付费卡点 {scaled.paywalls.join('、') || '—'} · 大反转 {scaled.twists.join('、') || '—'} · 高潮第 {scaled.climaxFrom} 集起
          </span>
        </span>
      </label>
    </Modal>
  )
  if (!v2)
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white px-5 py-3.5 shadow-card">
        {info}
        {action}
        {modal}
      </div>
    )
  return (
    slot && (
      <>
        {createPortal(info, slot.info)}
        {createPortal(action, slot.actions)}
        {modal}
      </>
    )
  )
}

export default function BreakdownStage({ project }: { project: Project }) {
  const patchWork = useProjects((s) => s.patchWork)
  const { running, run } = useAiTask()
  const [step, setStep] = useState<number | null>(null)
  const bd = project.work.breakdown
  const source = project.work.source
  // 视频转剧本送来的剧本还没拆：进来就直接拆，不用再点「开始拆解」（11/4 标注 #72）
  const fromVideo = project.mode === 'video' && !!source && source.importedAt === project.work.video?.merged?.importedAt

  const analyze = async () => {
    const cur = latestProject(project.id)?.work.source
    if (!cur) return
    const result = await run('analyze', (signal) => analyzeBenchmark(cur, project.mode, setStep, signal))
    setStep(null)
    if (!result) return
    patchWork(project.id, { breakdown: result }, `完成对标剧拆解：${result.totalEpisodes} 集，${result.characters.length} 个关键人物`)
    toast('拆解完成：看过、改好后点底部的「一键引用」')
  }

  useEffect(() => {
    if (!fromVideo || bd) return
    // 放到下一轮再开始：开发环境下 effect 会先挂一次再卸掉，卸掉时取消定时器，不会拆两遍
    const timer = setTimeout(analyze)
    return () => clearTimeout(timer)
  }, [fromVideo, !bd])

  if (!source) return <ImportCard project={project} />

  /** 写回拆解结果：以 store 中最新的版本为底 */
  const patch = (next: Partial<Breakdown>, note?: string) => {
    const cur = latestProject(project.id)?.work.breakdown
    if (cur) patchWork(project.id, { breakdown: { ...cur, ...next } }, note)
  }

  return (
    <>
      <SourceCard project={project} onAnalyze={analyze} step={step} running={running === 'analyze'} />
      {bd && step === null && (
        <>
          <ReferenceBar project={project} bd={bd} />
          <BlockCard block="synopsis" desc="目标受众、题材、核心设定、世界观、金手指、核心亮点（期待值）、故事简介与付费卡点">
            <SynopsisBlock bd={bd} patch={patch} />
          </BlockCard>
          <BlockCard
            block="mainline"
            desc={`左边选冲突主线的一段，右边是这一段的梗概（粗纲）和每集走向（集纲）；付费短剧最重要的是第 1 集和一卡（第 ${firstPaywall(bd)} 集）：第 1 集拆前 3 秒、前 30 秒和钩子，一卡拆卡点；${project.mode === 'video' ? '第 2 集' : '第 1 集'}到一卡逐场、逐句拆，之后的付费卡点集也按一卡拆卡点、逐场逐句——情绪在哪一句转、哪句台词带来转折，转折那句就是核心台词`}
          >
            <StoryBlock bd={bd} source={source} video={project.mode === 'video'} patch={patch} />
          </BlockCard>
          <BlockCard block="characters" desc="交互和人物设定一样：左边选人物，右边看拆解。主角拆简介、身份、金手指、动机，配角拆在这部剧里的作用和定位；关系怎么变只记在关系网里">
            <CharactersBlock bd={bd} patch={patch} />
          </BlockCard>
        </>
      )}
    </>
  )
}
