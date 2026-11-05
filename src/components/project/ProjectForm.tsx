import clsx from 'clsx'
import { ArrowRight, Eye, FileText, FileUp, Languages, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { AUDIENCES, LANGUAGES, MARKETS, MAX_SOURCE_BYTES, PLATFORMS } from '../../domain/constants'
import type { Benchmark, ProjectDraft, SourceScript } from '../../domain/types'
import type { FormErrors } from '../../domain/validate'
import { SAMPLE_SCRIPT, SAMPLE_SCRIPT_NAME, parseSource, translateTitle } from '../../services/ai'
import { toast } from '../../store/toast'
import { Modal } from '../overlay'
import { Badge, Button, Chip, Field, Input, Textarea } from '../ui'

export interface SectionProps {
  draft: ProjectDraft
  patch: (p: Partial<ProjectDraft>) => void
  errors: FormErrors
  /** 立项页上的序号；设置页不显示 */
  index?: number
}

const toggle = <T,>(list: T[], item: T, max = Infinity) =>
  list.includes(item) ? list.filter((x) => x !== item) : list.length >= max ? list : [...list, item]

const EMPTY_BENCHMARK: Benchmark = { title: '', platform: 'ReelShort', url: '', episodes: null, notes: '' }

const PLATFORM_SELECT_CLASS = 'h-10 w-full rounded-lg border border-line bg-white px-3 text-sm focus:border-brand-500 focus:outline-none'

function Section({ title, desc, index, children }: { title: string; desc?: string; index?: number; children: ReactNode }) {
  return (
    <section className="space-y-5">
      <div className="flex items-start gap-3">
        {index !== undefined && (
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-[13px] font-semibold text-white tabular-nums">
            {index}
          </span>
        )}
        <div>
          <h3 className="text-[15px] font-semibold">{title}</h3>
          {desc && <p className="mt-0.5 text-[13px] text-ink-500">{desc}</p>}
        </div>
      </div>
      {children}
    </section>
  )
}

/* ---------------------------------- 基本信息 ---------------------------------- */

function BenchmarkFields({ draft, patch, errors }: SectionProps) {
  const b = draft.benchmark ?? EMPTY_BENCHMARK
  const set = (p: Partial<Benchmark>) => patch({ benchmark: { ...b, ...p } })
  return (
    <div className="rounded-xl border border-line bg-canvas/60 p-4">
      <div className="mb-4 flex items-center gap-2">
        <span className="text-[13px] font-medium">对标剧信息</span>
        <Badge tone="gray">{draft.mode === 'video' ? '立项后在「视频转剧本」逐集转写' : '立项后在「对标剧拆解」上传剧本'}</Badge>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="对标剧剧名" required error={errors.benchmarkTitle}>
          <Input value={b.title} invalid={!!errors.benchmarkTitle} onChange={(e) => set({ title: e.target.value })} placeholder="例：The Alpha’s Regret" />
        </Field>
        <Field label="发布平台">
          <select value={b.platform} onChange={(e) => set({ platform: e.target.value })} className={PLATFORM_SELECT_CLASS}>
            {[...PLATFORMS, '其他'].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </Field>
        <Field label="剧集链接" hint={draft.mode === 'video' ? '选填，「视频转剧本」会自动带入，用来下载全集视频' : '选填'}>
          <Input value={b.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://" />
        </Field>
        <Field label="对标剧集数" hint={draft.mode === 'video' ? '获取全集视频后自动识别' : '上传仿写剧本后自动识别'}>
          <div aria-label="对标剧集数" className="flex h-9 items-center rounded-lg border border-line bg-white/60 px-3 text-sm tabular-nums">
            {b.episodes ? `${b.episodes} 集` : <span className="text-ink-400">自动识别</span>}
          </div>
        </Field>
      </div>
      <div className="mt-4">
        <Field label="备注">
          <Input value={b.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="例：近 30 天热剧榜前 10，拒婚—归来结构" />
        </Field>
      </div>
    </div>
  )
}

/** 文件名兜底成对标剧剧名：去掉扩展名、示例前缀与括号说明 */
const titleFromFile = (name: string) =>
  name
    .replace(/\.[^.]+$/, '')
    .replace(/^示例\s*·\s*/, '')
    .replace(/[（(][^）)]*[）)]$/, '')
    .trim()

/** 对标剧仿写：要仿写的剧本在立项时直接上传，进入「对标剧拆解」即可开始拆解 */
export function ScriptUploadField({
  draft,
  patch,
  errors,
  source,
  onSource,
  warning,
}: Pick<SectionProps, 'draft' | 'patch' | 'errors'> & {
  source: SourceScript | null
  onSource: (source: SourceScript | null) => void
  /** 替换剧本会清空已有拆解时的提示 */
  warning?: string
}) {
  const b = draft.benchmark ?? EMPTY_BENCHMARK
  const set = (p: Partial<Benchmark>) => patch({ benchmark: { ...b, ...p } })
  const fileRef = useRef<HTMLInputElement>(null)
  const [pasting, setPasting] = useState(false)
  const [text, setText] = useState('')
  const [dragging, setDragging] = useState(false)
  const [viewing, setViewing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const accept = (name: string, raw: string, titleFallback: string) => {
    const next = parseSource(name, raw)
    if (!next.episodes.length) return setError('没有识别到分集标记：请确认每集以「第1集」「第一集」或「EP1」单独成行')
    onSource(next)
    // 集数以识别结果为准；剧名没填时用文件名兜底
    set({ title: b.title.trim() || titleFallback, episodes: next.episodes.length })
    setError(null)
    setPasting(false)
    setText('')
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    if (!/\.(txt|md)$/i.test(file.name)) return setError('仅支持 .txt / .md 文件')
    if (file.size > MAX_SOURCE_BYTES) return setError('文件超过 2 MB，请拆分后分批导入')
    accept(file.name, await file.text(), titleFromFile(file.name))
  }

  const linkClass = 'text-xs font-medium text-brand-600 hover:text-brand-700'

  return (
    <div className="rounded-xl border border-line bg-canvas/60 p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium">仿写剧本</span>
          <Badge tone="gray">上传后在「对标剧拆解」一键拆解</Badge>
        </div>
        {!source && !pasting && (
          <div className="flex items-center gap-3">
            <button type="button" className={linkClass} onClick={() => setPasting(true)}>
              粘贴文本
            </button>
            <button type="button" className={linkClass} onClick={() => accept(SAMPLE_SCRIPT_NAME, SAMPLE_SCRIPT, titleFromFile(SAMPLE_SCRIPT_NAME))}>
              载入示例剧本
            </button>
          </div>
        )}
      </div>

      {source ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-white px-3.5 py-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <FileText size={17} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium" title={source.name}>
              {source.name}
            </div>
            <div className="mt-0.5 text-xs text-ink-500 tabular-nums">
              识别到 {source.episodes.length} 集 · {source.text.length.toLocaleString()} 字
            </div>
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => setViewing(true)}>
              <Eye size={14} />
              预览
            </Button>
            <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
              替换
            </Button>
            <Button variant="ghost" size="sm" className="text-red-600" onClick={() => onSource(null)}>
              移除
            </Button>
          </div>
        </div>
      ) : pasting ? (
        <div className="space-y-2">
          <Textarea
            aria-label="粘贴仿写剧本"
            rows={8}
            value={text}
            invalid={!!error}
            onChange={(e) => {
              setText(e.target.value)
              setError(null)
            }}
            placeholder={'第一集\n1-1：夜，内，议事厅\n人物：凯恩，艾拉\n△ 满月高悬，全族屏息。\n凯恩：我拒绝艾拉成为我的伴侣。\n艾拉os：你会后悔的。\n\n第二集\n……'}
            className="font-mono text-[12.5px]"
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setPasting(false)
                setError(null)
              }}
            >
              取消
            </Button>
            <Button size="sm" disabled={!text.trim()} onClick={() => accept('粘贴的剧本.txt', text, '')}>
              识别分集
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            onFile(e.dataTransfer.files[0])
          }}
          className={clsx(
            'flex w-full flex-col items-center rounded-lg border border-dashed bg-white px-4 py-6 text-center transition-colors',
            dragging ? 'border-brand-500 bg-brand-50/60' : error ? 'border-red-300' : 'border-ink-300 hover:border-brand-400',
          )}
        >
          <FileUp size={22} className="text-brand-600" />
          <span className="mt-2 text-[13px] font-medium">点击或拖拽上传要仿写的剧本</span>
          <span className="mt-1 text-xs text-ink-500">支持 .txt / .md，不超过 2 MB；每集以「第一集」「第1集」或「EP1」单独成行</span>
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept=".txt,.md,text/plain,text/markdown"
        hidden
        onChange={(e) => {
          onFile(e.target.files?.[0])
          // 允许再次选择同一个文件
          e.target.value = ''
        }}
      />
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {warning && <p className="mt-2 text-xs text-amber-700">{warning}</p>}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="对标剧剧名" required error={errors.benchmarkTitle} hint={source ? undefined : '上传剧本后按文件名自动填写'}>
          <Input value={b.title} invalid={!!errors.benchmarkTitle} onChange={(e) => set({ title: e.target.value })} placeholder="例：The Alpha’s Regret" />
        </Field>
        <Field label="发布平台">
          <select aria-label="发布平台" value={b.platform} onChange={(e) => set({ platform: e.target.value })} className={PLATFORM_SELECT_CLASS}>
            {[...PLATFORMS, '其他'].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </Field>
      </div>

      {source && (
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
      )}
    </div>
  )
}

/** 英文剧名旁的一键翻译：按中文剧名与题材给出英文片名 */
function TranslateTitleButton({ draft, patch }: Pick<SectionProps, 'draft' | 'patch'>) {
  const [loading, setLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  useEffect(() => () => abortRef.current?.abort(), [])

  const run = async () => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    try {
      patch({ titleEn: await translateTitle(draft.title, draft.genres, ctrl.signal) })
    } catch (err) {
      if ((err as Error).name !== 'AbortError') toast('翻译失败，请重试', 'error')
    } finally {
      if (abortRef.current === ctrl) setLoading(false)
    }
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={!draft.title.trim() || loading}
      title={draft.title.trim() ? '按中文剧名与题材翻译' : '先填写剧本名称'}
      className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 disabled:cursor-not-allowed disabled:text-ink-300"
    >
      {loading ? <Loader2 size={13} className="animate-spin" /> : <Languages size={13} />}
      {loading ? '翻译中…' : '一键翻译'}
    </button>
  )
}

/**
 * 剧本名称、英文剧名、创作方式与对标剧；创作方式选择器只在立项页传入（创建后不可改）。
 * 对标剧仿写用 scriptUpload（仿写剧本上传）替代对标剧登记。
 */
export function BasicSection({
  draft,
  patch,
  errors,
  index,
  modePicker,
  scriptUpload,
  autoFocusName,
}: SectionProps & { modePicker?: ReactNode; scriptUpload?: ReactNode; autoFocusName?: boolean }) {
  return (
    <Section index={index} title="基本信息" desc="剧本名称即中文剧名，创建后可在项目设置中修改">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="剧本名称" required error={errors.title} aside={<span className="text-xs text-ink-400 tabular-nums">{draft.title.length}/30</span>}>
          <Input
            value={draft.title}
            invalid={!!errors.title}
            maxLength={30}
            onChange={(e) => patch({ title: e.target.value })}
            placeholder="中文工作名，例：重生之豪门弃妇的反击"
            aria-label="剧本名称输入框"
            autoFocus={autoFocusName}
          />
        </Field>
        <Field label="英文剧名" hint="海外发行用，可稍后再定" error={errors.titleEn} aside={<TranslateTitleButton draft={draft} patch={patch} />}>
          <Input value={draft.titleEn} maxLength={60} onChange={(e) => patch({ titleEn: e.target.value })} placeholder="例：The Billionaire’s Second-Chance Bride" aria-label="英文剧名" />
        </Field>
      </div>

      {modePicker}

      {draft.mode === 'adaptation' && scriptUpload
        ? scriptUpload
        : draft.mode !== 'original' && <BenchmarkFields draft={draft} patch={patch} errors={errors} />}
    </Section>
  )
}

/* ---------------------------------- 故事设定 ---------------------------------- */

/** 设置页只看：题材类型、风格元素、核心设定与体量立项后都在故事架构里改，免得两处改得不一致 */
export function StorySummary({ draft, editTo }: { draft: ProjectDraft; editTo: string }) {
  const { spec } = draft
  const follow = draft.mode !== 'original' && spec.followBenchmark ? ' · 按对标剧' : ''
  const rows: [string, string | undefined][] = [
    ['题材类型', draft.genres.join('、')],
    ['风格元素', draft.tones.join('、')],
    ['目标受众', AUDIENCES.find((a) => a.value === draft.audience)?.label],
    ['总集数', spec.totalEpisodes ? `${spec.totalEpisodes} 集${follow}` : ''],
    ['单集时长', spec.episodeSeconds ? `${spec.episodeSeconds} 秒${follow}` : ''],
    ['剧本语言', LANGUAGES.find((l) => l.value === spec.language)?.label],
    ['核心设定', draft.logline],
  ]
  return (
    <Section title="故事设定" desc="立项后只在「故事架构」里改，这里只看">
      <dl data-story-summary className="grid gap-x-6 gap-y-3 sm:grid-cols-4">
        {rows.map(([k, v]) => (
          <div key={k} className={k === '核心设定' ? 'sm:col-span-4' : undefined}>
            <dt className="text-xs text-ink-500">{k}</dt>
            <dd className="mt-0.5 text-[13px] leading-6 text-ink-900">{v || <span className="text-ink-300">未填</span>}</dd>
          </div>
        ))}
      </dl>
      <Link to={editTo} className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-600 hover:text-brand-700">
        去故事架构修改
        <ArrowRight size={14} />
      </Link>
    </Section>
  )
}

/* ---------------------------------- 市场与发行 ---------------------------------- */

export function SpecSection({ draft, patch, errors, index }: SectionProps) {
  return (
    <Section index={index} title="市场与发行" desc="目标市场与平台决定付费节奏和内容规范，后续格式合规检查以此为准">
      <Field label="目标市场" required error={errors.markets}>
        <div className="flex flex-wrap gap-1.5">
          {MARKETS.map((m) => (
            <Chip key={m} selected={draft.markets.includes(m)} onClick={() => patch({ markets: toggle(draft.markets, m) })}>
              {m}
            </Chip>
          ))}
        </div>
      </Field>

      <Field label="发行平台" hint="用于对齐各平台的付费节奏与内容规范">
        <div className="flex flex-wrap gap-1.5">
          {PLATFORMS.map((p) => (
            <Chip key={p} selected={draft.platforms.includes(p)} onClick={() => patch({ platforms: toggle(draft.platforms, p) })}>
              {p}
            </Chip>
          ))}
        </div>
      </Field>
    </Section>
  )
}
