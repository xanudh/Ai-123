import clsx from 'clsx'
import { Check, Eye, FileText, FileUp, Languages, Loader2, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import {
  AUDIENCES,
  CATEGORIES,
  EPISODE_RANGE,
  EPISODE_SECONDS,
  GENRES,
  LANGUAGES,
  MARKETS,
  MAX_GENRES,
  MAX_SOURCE_BYTES,
  PLATFORMS,
  TONES,
} from '../../domain/constants'
import { secondsHint } from '../../domain/rhythm'
import type { Benchmark, ProjectDraft, SourceScript } from '../../domain/types'
import type { FormErrors } from '../../domain/validate'
import { SAMPLE_SCRIPT, SAMPLE_SCRIPT_NAME, generateLoglines, parseSource, translateTitle } from '../../services/ai'
import type { LoglineCandidate } from '../../services/ai'
import { toast } from '../../store/toast'
import { Modal } from '../overlay'
import { Badge, Button, Chip, Field, Input, MultiSelect, Segmented, Textarea } from '../ui'

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

/** 带单位的整数输入框；清空时传出 0，交给校验提示 */
function NumberInput({ unit, value, onValue, className, ...rest }: Omit<ComponentProps<typeof Input>, 'value' | 'onChange'> & { unit: string; value: number; onValue: (n: number) => void }) {
  return (
    <div className="relative">
      <Input
        type="number"
        inputMode="numeric"
        value={value || ''}
        onChange={(e) => onValue(Math.round(Number(e.target.value)))}
        className={clsx('pr-9 tabular-nums', className)}
        {...rest}
      />
      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-ink-400">{unit}</span>
    </div>
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
            placeholder={'第1集\n场景：议事厅 夜 内\n△ 满月高悬，全族屏息。\n凯恩：我拒绝艾拉成为我的伴侣。\n\n第2集\n……'}
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
          <span className="mt-1 text-xs text-ink-500">支持 .txt / .md，不超过 2 MB；每集以「第1集」或「EP1」单独成行</span>
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

function LoglineField({ draft, patch, withAssistant }: Pick<SectionProps, 'draft' | 'patch'> & { withAssistant: boolean }) {
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [candidates, setCandidates] = useState<LoglineCandidate[]>([])
  const abortRef = useRef<AbortController | null>(null)
  // 选中候选后再“换一批”，仍以用户自己写的内容为种子，避免在候选上层层叠加
  const seedRef = useRef('')

  useEffect(() => () => abortRef.current?.abort(), [])

  const canGenerate = draft.logline.trim().length > 0 || draft.genres.length > 0

  const run = async () => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    if (!candidates.some((c) => c.logline === draft.logline)) seedRef.current = draft.logline
    setLoading(true)
    setFailed(false)
    try {
      const list = await generateLoglines(
        { idea: seedRef.current, genres: draft.genres, audience: draft.audience, tones: draft.tones },
        ctrl.signal,
      )
      setCandidates(list)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setFailed(true)
    } finally {
      if (abortRef.current === ctrl) setLoading(false)
    }
  }

  return (
    <div>
      <Field
        label="核心设定"
        hint="一句话讲清：主角是谁 + 核心困境 + 反常规设定。这是闸门①，方向不对后面全废。"
        aside={
          withAssistant && (
            <Button
              size="sm"
              variant={candidates.length ? 'secondary' : 'primary'}
              disabled={!canGenerate || loading}
              onClick={run}
              title={canGenerate ? '基于核心设定草稿与题材给出 3 个候选' : '先写几个字或选择题材元素'}
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {loading ? '生成中…' : candidates.length ? '换一批' : '生成候选'}
            </Button>
          )
        }
      >
        <Textarea rows={2} maxLength={120} value={draft.logline} onChange={(e) => patch({ logline: e.target.value })} placeholder="例：带着前世记忆回来复仇的新娘，发现丈夫也是重生的。" />
      </Field>
      {failed && <p className="mt-2 text-xs text-red-600">生成失败，请稍后重试</p>}
      {candidates.length > 0 && (
        <ul className="mt-3 space-y-2">
          {candidates.map((c) => {
            const selected = draft.logline === c.logline
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => patch({ logline: c.logline })}
                  className={clsx(
                    'flex w-full items-start gap-3 rounded-lg border bg-white px-3.5 py-3 text-left transition-colors',
                    selected ? 'border-brand-500 ring-3 ring-brand-500/10' : 'border-line hover:border-brand-200',
                  )}
                >
                  <span
                    className={clsx(
                      'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
                      selected ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-300',
                    )}
                  >
                    {selected && <Check size={11} strokeWidth={3} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm leading-relaxed text-ink-900">{c.logline}</span>
                    <span className="mt-1 block text-xs text-ink-500">爽点公式：{c.formula}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export function StorySection({ draft, patch, errors, index, withAssistant = true }: SectionProps & { withAssistant?: boolean }) {
  const { spec } = draft
  // 视频转剧本时集数与时长按视频识别，可以留空
  const videoMode = draft.mode === 'video'
  return (
    <Section index={index} title="故事设定" desc="类型、题材、核心设定与体量决定后续 AI 的创作方向、剧本语言和逐集篇幅">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="类型" required>
          <select
            aria-label="类型"
            value={draft.category}
            onChange={(e) => patch({ category: e.target.value })}
            className="h-10 w-full rounded-lg border border-line bg-white px-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-3 focus:ring-brand-500/15"
          >
            {!(CATEGORIES as readonly string[]).includes(draft.category) && <option value={draft.category}>{draft.category || '选择类型'}</option>}
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="题材元素" required error={errors.genres} aside={<span className="text-xs text-ink-400">最多 {MAX_GENRES} 个 · 已选 {draft.genres.length}</span>}>
          <MultiSelect value={draft.genres} options={GENRES} max={MAX_GENRES} invalid={!!errors.genres} onChange={(genres) => patch({ genres })} placeholder="选择题材元素" />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="风格基调" aside={<span className="text-xs text-ink-400">最多 3 个</span>}>
          <MultiSelect value={draft.tones} options={TONES} max={3} onChange={(tones) => patch({ tones })} placeholder="选择风格基调" />
        </Field>
        <Field label="目标受众">
          <Segmented value={draft.audience} onChange={(audience) => patch({ audience })} options={AUDIENCES.map((a) => ({ value: a.value, label: a.label }))} />
        </Field>
      </div>

      <LoglineField draft={draft} patch={patch} withAssistant={withAssistant} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="总集数"
          required={!videoMode}
          error={errors.totalEpisodes}
          hint={videoMode ? '选填，留空按识别到的对标剧集数；到故事架构再确定' : '出海短剧常见 60–80 集；体量越大，越需要伏笔登记表与状态库防跑偏'}
        >
          <NumberInput
            unit="集"
            aria-label="总集数"
            min={EPISODE_RANGE.min}
            max={EPISODE_RANGE.max}
            value={spec.totalEpisodes}
            invalid={!!errors.totalEpisodes}
            onValue={(totalEpisodes) => patch({ spec: { ...spec, totalEpisodes } })}
          />
        </Field>
        <Field
          label="单集时长"
          required={!videoMode}
          error={errors.episodeSeconds}
          hint={videoMode && !spec.episodeSeconds ? `选填，留空按 ${EPISODE_SECONDS.default} 秒；到故事架构再确定` : secondsHint(spec.episodeSeconds)}
        >
          <NumberInput
            unit="秒"
            aria-label="单集时长"
            min={EPISODE_SECONDS.min}
            max={EPISODE_SECONDS.max}
            step={10}
            value={spec.episodeSeconds}
            invalid={!!errors.episodeSeconds}
            onValue={(episodeSeconds) => patch({ spec: { ...spec, episodeSeconds } })}
          />
        </Field>
      </div>

      <Field label="剧本语言">
        <div className="grid gap-2 sm:grid-cols-3">
          {LANGUAGES.map((l) => {
            const selected = spec.language === l.value
            return (
              <button
                key={l.value}
                type="button"
                aria-pressed={selected}
                onClick={() => patch({ spec: { ...spec, language: l.value } })}
                className={clsx(
                  'rounded-lg border px-3.5 py-3 text-left transition-colors',
                  selected ? 'border-brand-500 bg-brand-50/60 ring-3 ring-brand-500/10' : 'border-line bg-white hover:border-ink-300',
                )}
              >
                <div className="text-[13px] font-medium">{l.label}</div>
                <div className="mt-0.5 text-xs leading-4 text-ink-500">{l.hint}</div>
              </button>
            )
          })}
        </div>
      </Field>
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
