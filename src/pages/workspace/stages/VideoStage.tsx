import clsx from 'clsx'
import { ArrowRight, CircleCheck, Download, Eye, Film, Loader2, Pause, Play, RotateCcw } from 'lucide-react'
import { Fragment, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ConfirmDialog, Menu, Modal } from '../../../components/overlay'
import { AiButton, Stat, Table, latestProject, stagePath, useAiTask } from '../../../components/stage/StageKit'
import { Badge, Button, Card, CardHeader, Input, Segmented } from '../../../components/ui'
import type { Project, Shot, TranscribeStatus, VideoEpisode, VideoJob } from '../../../domain/types'
import { downloadText } from '../../../lib/download'
import { formatDateTime } from '../../../lib/format'
import { DEMO_SHOW, MERGE_STEPS, RESOLVE_STEPS, episodesFromFiles, linkError, mergeTranscripts, parseSource, platformOf, resolveVideoLink } from '../../../services/ai'
import { useProjects } from '../../../store/projects'
import { toast } from '../../../store/toast'
import { CONCURRENCY, isTranscribing, progressKey, recoverStale, retryFailed, startQueue, stopQueue, useVideoQueue } from '../../../store/videoQueue'

const pad = (n: number) => String(n).padStart(2, '0')

/** 时长：1:32 */
const clock = (sec: number) => `${Math.floor(sec / 60)}:${pad(Math.floor(sec % 60))}`

/** 时间码：00:12.4 */
function timecode(sec: number) {
  const ds = Math.round(sec * 10)
  return `${pad(Math.floor(ds / 600))}:${pad(Math.floor(ds / 10) % 60)}.${ds % 10}`
}

const dialogueWords = (shots: Shot[]) => shots.reduce((n, s) => n + (s.line?.replace(/\s/g, '').length ?? 0), 0)

const STATUS_META: Record<TranscribeStatus, { label: string; tone: 'gray' | 'violet' | 'green' | 'red' }> = {
  queued: { label: '排队中', tone: 'gray' },
  downloading: { label: '下载中', tone: 'violet' },
  compressing: { label: '压缩中', tone: 'violet' },
  transcribing: { label: '转写中', tone: 'violet' },
  done: { label: '已完成', tone: 'green' },
  failed: { label: '失败', tone: 'red' },
}

const PHASES: TranscribeStatus[] = ['downloading', 'compressing', 'transcribing']

/** 本地上传的视频不需要下载，第一步是读取文件 */
const statusLabel = (job: VideoJob, status: TranscribeStatus) => (status === 'downloading' && job.origin === 'upload' ? '读取中' : STATUS_META[status].label)

function StepList({ steps, step, label }: { steps: readonly string[]; step: number; label: string }) {
  return (
    <ol className="space-y-1.5" aria-label={label}>
      {steps.map((s, i) => (
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
  )
}

/* ---------------------------------- 导出 ---------------------------------- */

const csvCell = (v: string | number | undefined) => `"${String(v ?? '').replace(/"/g, '""')}"`

/** 带时间码的分镜剧本（CSV，Excel 可直接打开） */
function storyboardCsv(job: VideoJob) {
  const rows = [['集数', '镜头', '开始', '结束', '景别', '场景', '画面', '角色', '台词', '音效']]
  for (const e of job.episodes) {
    e.shots.forEach((s, i) => rows.push([`${e.ep}`, `${i + 1}`, timecode(s.start), timecode(s.end), s.size, s.scene ?? '', s.action, s.speaker ?? '', s.line ?? '', s.sound ?? '']))
  }
  // 开头加 BOM，让 Excel 按 UTF-8 打开中文
  return String.fromCharCode(0xfeff) + rows.map((r) => r.map(csvCell).join(',')).join('\n')
}

/** 全集对白文本 */
const dialogueText = (job: VideoJob) =>
  job.episodes
    .map((e) => [`第${e.ep}集`, ...e.shots.filter((s) => s.speaker).map((s) => `[${timecode(s.start)}] ${s.speaker}：${s.line}`)].join('\n'))
    .join('\n\n')

/* ---------------------------------- 获取全集 ---------------------------------- */

function SourcePicker({ project }: { project: Project }) {
  const patchWork = useProjects((s) => s.patchWork)
  const { running, run } = useAiTask()
  const [origin, setOrigin] = useState<VideoJob['origin']>('upload')
  const [url, setUrl] = useState(project.benchmark?.url ?? '')
  const [step, setStep] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const platform = platformOf(url)
  const source = project.work.source

  const create = (job: Omit<VideoJob, 'createdAt' | 'merged'>, note: string) => {
    patchWork(project.id, { video: { ...job, createdAt: new Date().toISOString(), merged: null } }, note)
    startQueue(project.id)
    toast(`已获取 ${job.episodes.length} 集，开始逐集转写`)
  }

  const resolve = async () => {
    const err = linkError(url)
    if (err) return setError(err)
    const result = await run('resolve', (signal) => resolveVideoLink(url.trim(), setStep, signal))
    setStep(null)
    if (!result) return
    const paid = result.episodes.filter((e) => e.paid).length
    create(
      { origin: 'link', url: url.trim(), platform: result.platform || project.benchmark?.platform || '', episodes: result.episodes },
      `解析对标剧链接：共 ${result.episodes.length} 集（付费 ${paid} 集），开始逐集转写`,
    )
  }

  /** 演示：模拟上传示例剧的全集视频 */
  const uploadDemo = () => {
    const names = Array.from({ length: DEMO_SHOW.episodes }, (_, i) => `${DEMO_SHOW.title} EP${String(i + 1).padStart(2, '0')}.mp4`)
    create({ origin: 'upload', url: '', platform: '', episodes: episodesFromFiles(names) }, `上传对标剧视频 ${names.length} 集（演示），开始逐集转写`)
  }

  const onFiles = (list: FileList | null) => {
    const files = [...(list ?? [])].filter((f) => f.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|mkv)$/i.test(f.name))
    if (!files.length) return setError('请选择视频文件（.mp4 / .mov / .webm），可一次多选')
    const episodes = episodesFromFiles(files.map((f) => f.name))
    create({ origin: 'upload', url: '', platform: '', episodes }, `上传对标剧视频 ${episodes.length} 集，开始逐集转写`)
  }

  return (
    <Card>
      <CardHeader
        title="获取对标剧全集"
        desc="上传已下载的全集视频，或粘贴剧集页链接一键下载全集（含付费集）；拿到视频后自动排队，逐集转写"
        action={
          <Segmented
            value={origin}
            options={[
              { value: 'upload', label: '上传视频' },
              { value: 'link', label: '粘贴链接' },
            ]}
            onChange={(v) => {
              setOrigin(v)
              setError(null)
            }}
          />
        }
      />
      <div className="space-y-3 p-5">
        {origin === 'link' ? (
          <>
            <div className="flex items-center gap-2">
              <Input
                aria-label="剧集链接"
                value={url}
                invalid={!!error}
                disabled={running === 'resolve'}
                onChange={(e) => {
                  setUrl(e.target.value)
                  setError(null)
                }}
                onKeyDown={(e) => e.key === 'Enter' && !running && resolve()}
                placeholder="https://www.reelshort.com/full-episodes/…"
              />
              <AiButton size="md" loading={running === 'resolve'} onClick={resolve}>
                一键下载全集
              </AiButton>
            </div>
            {platform && !error && <p className="text-xs text-ink-500">识别为 {platform} 剧集页</p>}
            {step !== null && (
              <div className="rounded-lg bg-canvas px-4 py-3">
                <StepList steps={RESOLVE_STEPS} step={step} label="解析进度" />
              </div>
            )}
          </>
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
              onFiles(e.dataTransfer.files)
            }}
            className={clsx(
              'flex w-full flex-col items-center rounded-lg border border-dashed bg-white px-4 py-8 text-center transition-colors',
              dragging ? 'border-brand-500 bg-brand-50/60' : error ? 'border-red-300' : 'border-ink-300 hover:border-brand-400',
            )}
          >
            <Film size={22} className="text-brand-600" />
            <span className="mt-2 text-[13px] font-medium">点击或拖拽上传全集视频，可一次多选</span>
            <span className="mt-1 text-xs text-ink-500">支持 .mp4 / .mov / .webm；按文件名识别集数，如「第3集」「EP03」「03.mp4」</span>
          </button>
        )}
        {origin === 'upload' && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-canvas px-4 py-2.5 text-xs text-ink-500">
            <Film size={14} className="text-ink-400" />
            没有现成视频？
            <button type="button" onClick={uploadDemo} className="font-medium text-brand-600 hover:text-brand-700">
              上传示例视频《{DEMO_SHOW.title}》{DEMO_SHOW.episodes} 集
            </button>
            演示完整的上传 → 转写 → 合并流程
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="video/*,.mp4,.mov,.m4v,.webm,.mkv"
          multiple
          hidden
          onChange={(e) => {
            onFiles(e.target.files)
            e.target.value = ''
          }}
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        {source && (
          <p className="text-xs text-ink-500">
            「对标剧拆解」里已有剧本《{source.name}》，如果它就是这部剧，可以跳过转写
            <Link to={stagePath(project, 'breakdown')} className="ml-1 text-brand-600 hover:text-brand-700">
              直接去拆解 →
            </Link>
          </p>
        )}
        <p className="text-xs text-ink-400">
          演示环境不访问外部链接、不读取视频内容：分集与转写内容取自示例剧《{DEMO_SHOW.title}》{DEMO_SHOW.episodes} 集精简版。
        </p>
      </div>
    </Card>
  )
}

/* ---------------------------------- 逐集转写 ---------------------------------- */

function StatusCell({ job, episode, percent }: { job: VideoJob; episode: VideoEpisode; percent: number | undefined }) {
  if (isTranscribing(episode.status)) {
    // 三个步骤合成一条总进度
    const overall = Math.round((PHASES.indexOf(episode.status) * 100 + (percent ?? 0)) / PHASES.length)
    return (
      <div className="flex items-center gap-2">
        <Badge tone="violet">
          <Loader2 size={10} className="animate-spin" />
          {statusLabel(job, episode.status)}
        </Badge>
        <span className="h-1 w-20 overflow-hidden rounded-full bg-canvas">
          <span className="block h-full rounded-full bg-brand-500 transition-[width]" style={{ width: `${overall}%` }} />
        </span>
        <span className="text-xs text-ink-400 tabular-nums">{overall}%</span>
      </div>
    )
  }
  if (episode.status === 'failed') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="red">失败</Badge>
        <span className="text-xs text-red-600">{episode.error}</span>
      </div>
    )
  }
  const meta = STATUS_META[episode.status]
  return (
    <Badge tone={meta.tone}>
      {meta.label}
      {episode.status === 'done' && episode.attempts > 1 && ` · 重试 ${episode.attempts - 1} 次`}
    </Badge>
  )
}

function QueueCard({ project, job, onView }: { project: Project; job: VideoJob; onView: (ep: number) => void }) {
  const patchWork = useProjects((s) => s.patchWork)
  const running = useVideoQueue((s) => !!s.running[project.id])
  const progress = useVideoQueue((s) => s.progress)
  const [confirmReset, setConfirmReset] = useState(false)
  const eps = job.episodes
  const done = eps.filter((e) => e.status === 'done')
  const failed = eps.filter((e) => e.status === 'failed').length
  const active = eps.filter((e) => isTranscribing(e.status)).length
  const queued = eps.filter((e) => e.status === 'queued').length
  const totalSec = eps.reduce((n, e) => n + e.duration, 0)
  const allDone = done.length === eps.length

  const stuck = failed > 0 && !running && !queued
  const state = allDone
    ? '全部转写完成'
    : running
      ? `正在转写 ${active} 集，排队 ${queued} 集`
      : stuck
        ? `${failed} 集失败，重试成功后才能合并`
        : `已暂停，还有 ${queued + active} 集没有转写`

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="逐集转写"
        desc={`${job.origin === 'link' ? job.platform || '剧集链接' : '本地上传'} · ${eps.length} 集 · 总时长 ${clock(totalSec)} · 同时转写 ${CONCURRENCY} 集`}
        action={
          <div className="flex gap-2">
            {running ? (
              <Button variant="secondary" size="sm" onClick={() => stopQueue(project.id)}>
                <Pause size={14} />
                暂停
              </Button>
            ) : (
              queued > 0 && (
                <Button size="sm" onClick={() => startQueue(project.id)}>
                  <Play size={14} />
                  继续转写
                </Button>
              )
            )}
            {failed > 0 && (
              <Button variant="secondary" size="sm" onClick={() => retryFailed(project.id)}>
                <RotateCcw size={14} />
                重试失败的 {failed} 集
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setConfirmReset(true)}>
              更换来源
            </Button>
          </div>
        }
      />
      <div className="space-y-4 p-5">
        <div>
          <div className="mb-1.5 flex justify-between text-xs text-ink-500">
            <span className={clsx(stuck && 'text-red-600')}>{state}</span>
            <span className="tabular-nums">
              {done.length} / {eps.length} 集
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-canvas">
            <div className={clsx('h-full rounded-full transition-[width] duration-500', allDone ? 'bg-emerald-500' : 'bg-brand-500')} style={{ width: `${(done.length / eps.length) * 100}%` }} />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="已完成" value={`${done.length} / ${eps.length} 集`} tone={allDone ? 'green' : undefined} />
          <Stat label="失败" value={`${failed} 集`} tone={failed ? 'red' : undefined} />
          <Stat label="镜头" value={done.reduce((n, e) => n + e.shots.length, 0)} />
          <Stat label="对白字数" value={done.reduce((n, e) => n + dialogueWords(e.shots), 0).toLocaleString()} />
        </div>
      </div>
      <div className="border-t border-line">
        <Table columns={['集数', '时长', '状态', '镜头', '对白字数', '']} minWidth={680}>
          {eps.map((e) => (
            <tr key={e.ep}>
              <td className="px-4 py-2.5 whitespace-nowrap">
                <span className="tabular-nums">第 {e.ep} 集</span>
                {e.paid && (
                  <Badge tone="amber" className="ml-1.5">
                    付费
                  </Badge>
                )}
                {e.file && <span className="ml-2 inline-block max-w-40 truncate align-bottom text-xs text-ink-400">{e.file}</span>}
              </td>
              <td className="px-4 py-2.5 text-ink-500 tabular-nums">{clock(e.duration)}</td>
              <td className="px-4 py-2.5">
                <StatusCell job={job} episode={e} percent={progress[progressKey(project.id, e.ep)]} />
              </td>
              <td className="px-4 py-2.5 tabular-nums">{e.status === 'done' ? e.shots.length : '—'}</td>
              <td className="px-4 py-2.5 tabular-nums">{e.status === 'done' ? dialogueWords(e.shots) : '—'}</td>
              <td className="px-4 py-1.5 text-right">
                {e.status === 'done' && (
                  <Button variant="ghost" size="sm" onClick={() => onView(e.ep)}>
                    <Eye size={14} />
                    分镜
                  </Button>
                )}
                {e.status === 'failed' && (
                  <Button variant="ghost" size="sm" onClick={() => retryFailed(project.id, e.ep)}>
                    <RotateCcw size={14} />
                    重试
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </div>
      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={() => {
          stopQueue(project.id)
          patchWork(project.id, { video: null }, '清除视频转写结果，更换来源')
        }}
        danger
        title="更换视频来源？"
        desc="当前的逐集转写结果和合并后的剧本都会清除；已经送入「对标剧拆解」的剧本不受影响。"
        confirmText="清除并更换"
      />
    </Card>
  )
}

/* ---------------------------------- 分镜查看 ---------------------------------- */

function ShotTable({ shots }: { shots: Shot[] }) {
  return (
    <Table columns={['时间码', '景别', '画面', '台词', '音效']} minWidth={760}>
      {shots.map((s, i) => (
        <Fragment key={i}>
          {s.scene && (
            <tr>
              <td colSpan={5} className="bg-canvas px-4 py-1.5 text-xs font-medium text-ink-700">
                场景：{s.scene}
              </td>
            </tr>
          )}
          <tr className="align-top">
            <td className="px-4 py-2 font-mono text-xs whitespace-nowrap text-ink-500">
              {timecode(s.start)}–{timecode(s.end)}
            </td>
            <td className="px-4 py-2 whitespace-nowrap">{s.size}</td>
            <td className="px-4 py-2 text-ink-700">{s.action}</td>
            <td className="px-4 py-2">
              {s.speaker ? (
                <>
                  <span className="font-medium">{s.speaker}：</span>
                  {s.line}
                </>
              ) : (
                <span className="text-ink-300">—</span>
              )}
            </td>
            <td className="px-4 py-2 text-xs whitespace-nowrap text-ink-500">{s.sound}</td>
          </tr>
        </Fragment>
      ))}
    </Table>
  )
}

function ShotModal({ job, ep, onClose, onNavigate }: { job: VideoJob; ep: number | null; onClose: () => void; onNavigate: (ep: number) => void }) {
  const [view, setView] = useState<'shots' | 'lines'>('shots')
  const done = job.episodes.filter((e) => e.status === 'done')
  const index = done.findIndex((e) => e.ep === ep)
  const episode = done[index]
  if (!episode) return null
  const prev = done[index - 1]
  const next = done[index + 1]

  return (
    <Modal
      open
      onClose={onClose}
      width={920}
      title={`第 ${episode.ep} 集 · ${view === 'shots' ? '分镜剧本' : '对白文本'}`}
      desc={`时长 ${clock(episode.duration)} · ${episode.shots.length} 个镜头 · 对白 ${dialogueWords(episode.shots)} 字`}
      footer={
        <>
          <Button variant="secondary" disabled={!prev} onClick={() => prev && onNavigate(prev.ep)}>
            上一集
          </Button>
          <Button variant="secondary" disabled={!next} onClick={() => next && onNavigate(next.ep)}>
            下一集
          </Button>
        </>
      }
    >
      <div className="mb-3">
        <Segmented
          value={view}
          options={[
            { value: 'shots', label: '分镜剧本' },
            { value: 'lines', label: '对白文本' },
          ]}
          onChange={setView}
        />
      </div>
      <div className="scrollbar-thin max-h-[58vh] overflow-y-auto rounded-lg border border-line">
        {view === 'shots' ? (
          <ShotTable shots={episode.shots} />
        ) : (
          <ol className="space-y-1.5 px-4 py-3 text-[13px] leading-6">
            {episode.shots
              .filter((s) => s.speaker)
              .map((s, i) => (
                <li key={i} className="flex gap-3">
                  <span className="shrink-0 pt-px font-mono text-xs leading-6 text-ink-400">{timecode(s.start)}</span>
                  <span>
                    <span className="font-medium">{s.speaker}：</span>
                    {s.line}
                  </span>
                </li>
              ))}
          </ol>
        )}
      </div>
    </Modal>
  )
}

/* ---------------------------------- 合并 ---------------------------------- */

function MergeCard({ project, job }: { project: Project; job: VideoJob }) {
  const navigate = useNavigate()
  const patchWork = useProjects((s) => s.patchWork)
  const { running, run } = useAiTask()
  const [step, setStep] = useState<number | null>(null)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const merged = job.merged
  const left = job.episodes.filter((e) => e.status !== 'done').length
  const source = project.work.source
  // 拆解里的剧本是不是这次合并送过去的
  const sent = !!merged?.importedAt && source?.importedAt === merged.importedAt
  const fixed = merged?.fixes.reduce((n, f) => n + f.count, 0) ?? 0

  const merge = async () => {
    const episodes = latestProject(project.id)?.work.video?.episodes
    if (!episodes) return
    const result = await run('merge', (signal) => mergeTranscripts(episodes, setStep, signal))
    setStep(null)
    const cur = latestProject(project.id)?.work.video
    if (!result || !cur) return
    const total = result.fixes.reduce((n, f) => n + f.count, 0)
    patchWork(project.id, { video: { ...cur, merged: result } }, `合并全集转写稿：${episodes.length} 集，自动修正 ${total} 处格式问题`)
    toast('已合并成完整剧本')
  }

  const send = () => {
    const cur = latestProject(project.id)?.work.video
    if (!cur?.merged) return
    const at = new Date().toISOString()
    const name = `${project.benchmark?.title || '对标剧'}（视频转写 · ${cur.episodes.length} 集）.txt`
    const next = { ...parseSource(name, cur.merged.text), importedAt: at }
    patchWork(project.id, { source: next, breakdown: null, video: { ...cur, merged: { ...cur.merged, importedAt: at } } }, `转写剧本送入对标剧拆解：${next.episodes.length} 集`)
    toast('已送入对标剧拆解，可以开始拆解了')
    navigate(stagePath(project, 'breakdown'))
  }

  const action = merged ? (
    <div className="flex gap-2">
      <Menu
        trigger={(props) => (
          <Button variant="secondary" size="sm" {...props}>
            <Download size={14} />
            导出
          </Button>
        )}
        items={[
          { label: '完整剧本（.txt）', onSelect: () => downloadText(`${project.title}-对标剧剧本.txt`, merged.text) },
          { label: '分镜剧本（.csv，含时间码）', onSelect: () => downloadText(`${project.title}-分镜剧本.csv`, storyboardCsv(job), 'text/csv') },
          { label: '全集对白（.txt）', onSelect: () => downloadText(`${project.title}-全集对白.txt`, dialogueText(job)) },
        ]}
      />
      {sent ? (
        <Link to={stagePath(project, 'breakdown')} className="flex h-8 items-center gap-1 rounded-lg bg-emerald-50 px-3 text-[13px] font-medium text-emerald-700 hover:bg-emerald-100">
          已送入，去拆解
          <ArrowRight size={14} />
        </Link>
      ) : (
        <Button size="sm" onClick={() => (source ? setConfirmReplace(true) : send())}>
          送入对标剧拆解
          <ArrowRight size={14} />
        </Button>
      )}
    </div>
  ) : (
    <AiButton loading={running === 'merge'} disabled={left > 0} onClick={merge}>
      合并并修正格式
    </AiButton>
  )

  return (
    <Card>
      <CardHeader
        title="合并剧本"
        desc={merged ? `合并于 ${formatDateTime(merged.mergedAt)}，已自动修正 ${fixed} 处格式问题` : '全部转写完成后，按集数合并成一部剧本，自动修正格式，再送入对标剧拆解'}
        action={action}
      />
      {!merged && step === null && (
        <p className="px-5 py-4 text-[13px] text-ink-500">{left > 0 ? `还有 ${left} 集没有转写完成，完成后才能合并。` : '全部集已转写完成，可以合并了。'}</p>
      )}
      {step !== null && (
        <div className="px-5 py-4">
          <StepList steps={MERGE_STEPS} step={step} label="合并进度" />
        </div>
      )}
      {merged && (
        <div className="grid gap-5 p-5 lg:grid-cols-[240px_minmax(0,1fr)]">
          <div className="space-y-3">
            <Stat label="字数" value={merged.text.length.toLocaleString()} />
            <div className="rounded-lg bg-canvas px-3.5 py-2.5">
              <div className="mb-1.5 text-xs text-ink-500">自动修正</div>
              <ul className="space-y-1.5">
                {merged.fixes.map((f) => (
                  <li key={f.label} className="flex items-start gap-1.5 text-[13px]">
                    <CircleCheck size={13} className="mt-[3px] shrink-0 text-emerald-500" />
                    <span className="flex-1">{f.label}</span>
                    <span className="text-ink-500 tabular-nums">{f.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <pre className="scrollbar-thin max-h-96 overflow-y-auto rounded-lg bg-canvas px-4 py-3 font-mono text-xs leading-6 whitespace-pre-wrap text-ink-700">{merged.text}</pre>
        </div>
      )}
      <ConfirmDialog
        open={confirmReplace}
        onClose={() => setConfirmReplace(false)}
        onConfirm={send}
        danger={!!project.work.breakdown}
        title="替换对标剧剧本？"
        desc={`「对标剧拆解」里已有剧本《${source?.name ?? ''}》${project.work.breakdown ? '和拆解结果，送入后会一并替换，需要重新拆解' : '，送入后会被替换'}。`}
        confirmText="替换并送入"
      />
    </Card>
  )
}

export default function VideoStage({ project }: { project: Project }) {
  const job = project.work.video
  const [viewing, setViewing] = useState<number | null>(null)

  useEffect(() => {
    recoverStale(project.id)
  }, [project.id])

  if (!job) return <SourcePicker project={project} />

  return (
    <>
      <QueueCard project={project} job={job} onView={setViewing} />
      <MergeCard project={project} job={job} />
      <ShotModal job={job} ep={viewing} onClose={() => setViewing(null)} onNavigate={setViewing} />
    </>
  )
}
