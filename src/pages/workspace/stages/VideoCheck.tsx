import clsx from 'clsx'
import { Check, ChevronLeft, ChevronRight, FileVideo, Pause, Pencil, Play, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ConfirmDialog } from '../../../components/overlay'
import { AutoTextarea, latestProject } from '../../../components/stage/StageKit'
import { Badge, Button, Card, Select } from '../../../components/ui'
import { modelLabel, modelOf } from '../../../domain/models'
import { formatScene, speakerLabel } from '../../../domain/scriptFormat'
import type { Project, Shot, VideoEpisode, VideoJob } from '../../../domain/types'
import { useProjects } from '../../../store/projects'
import { toast } from '../../../store/toast'
import { useVideoFiles } from '../../../store/videoFiles'
import { retranscribe } from '../../../store/videoQueue'

const pad = (n: number) => String(n).padStart(2, '0')
const clock = (sec: number) => `${Math.floor(sec / 60)}:${pad(Math.floor(sec % 60))}`

/** 右侧剧本的一行：按通用剧本格式排（场次标题 / 人物 / △ 动作 / 台词），每行记着对应镜头的起始时间 */
interface Entry {
  key: string
  kind: 'scene' | 'cast' | 'action' | 'dialogue'
  text: string
  start: number
  shot: number
  /** 场次号「集-场」，只在场次标题上 */
  no?: string
}

function entriesOf(ep: number, shots: Shot[]): Entry[] {
  const out: Entry[] = []
  let k = 0
  shots.forEach((s, i) => {
    if (s.scene) {
      const no = `${ep}-${++k}`
      out.push({ key: `s${i}`, kind: 'scene', text: `${no}：${formatScene(s.scene)}`, start: s.start, shot: i, no })
      // 这一场的人物：说话的人按出场先后，画外音的人不在场不列
      const cast: string[] = []
      for (let j = i; j < shots.length && (j === i || !shots[j].scene); j++) {
        const who = shots[j].speaker
        if (who && shots[j].voice !== 'ov' && !cast.includes(who)) cast.push(who)
      }
      if (cast.length) out.push({ key: `c${i}`, kind: 'cast', text: `人物：${cast.join('，')}`, start: s.start, shot: i })
    }
    if (s.speaker && s.line !== undefined) out.push({ key: `d${i}`, kind: 'dialogue', text: `${speakerLabel(s)}：${s.cue ? `（${s.cue}）` : ''}${s.line}`, start: s.start, shot: i })
    else out.push({ key: `a${i}`, kind: 'action', text: s.size === '特写' ? `△【特写】${s.action}` : `△ ${s.action}`, start: s.start, shot: i })
  })
  return out
}

/** 这一行改的是镜头里的哪一段文字 */
const editableOf = (e: Entry, s: Shot) => (e.kind === 'scene' ? formatScene(s.scene ?? '') : e.kind === 'dialogue' ? (s.line ?? '') : e.kind === 'action' ? s.action : null)

/**
 * 左侧播放器：选了本集视频文件就播真实视频；没有视频时用模拟播放（按时间轴走，画面显示这一镜头的画面描述和字幕），
 * 方便演示「点剧本跳到那一刻、播放时剧本跟着走」。
 */
function Player({
  src,
  episode,
  time,
  playing,
  seek,
  onTime,
  onPlaying,
}: {
  src?: string
  episode: VideoEpisode
  time: number
  playing: boolean
  seek: { t: number; n: number }
  onTime: (t: number) => void
  onPlaying: (v: boolean) => void
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const duration = episode.duration

  // 外面点了某一行：跳到那一刻
  useEffect(() => {
    if (ref.current && seek.n) ref.current.currentTime = seek.t
  }, [seek])

  // 模拟播放：每 100ms 往前走
  useEffect(() => {
    if (src || !playing) return
    const id = setInterval(() => {
      const next = Math.min(duration, time + 0.1)
      onTime(next)
      if (next >= duration) onPlaying(false)
    }, 100)
    return () => clearInterval(id)
  }, [src, playing, time, duration, onTime, onPlaying])

  if (src)
    return (
      <video
        ref={ref}
        src={src}
        controls
        className="aspect-[9/16] max-h-[62vh] w-full rounded-lg bg-black object-contain"
        onTimeUpdate={(e) => onTime(e.currentTarget.currentTime)}
        onPlay={() => onPlaying(true)}
        onPause={() => onPlaying(false)}
      />
    )

  const shot = [...episode.shots].reverse().find((s) => s.start <= time + 0.01) ?? episode.shots[0]
  return (
    <div data-sim-player>
      <div className="relative flex aspect-[9/16] max-h-[62vh] w-full flex-col justify-between overflow-hidden rounded-lg bg-ink-900 p-4 text-white">
        <div className="flex items-center justify-between text-[11px] text-white/60">
          <span>模拟播放 · 没有选择视频文件</span>
          {shot && <span className="rounded bg-white/10 px-1.5 py-0.5">{shot.size}</span>}
        </div>
        <p className="text-center text-[13px] leading-6 text-white/80">{shot?.action}</p>
        <p className="min-h-12 text-center text-[14px] leading-6 font-medium">{shot?.speaker && shot.line ? `${speakerLabel(shot)}：${shot.line}` : ''}</p>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Button variant="secondary" size="sm" aria-label={playing ? '暂停' : '播放'} onClick={() => (time >= duration ? (onTime(0), onPlaying(true)) : onPlaying(!playing))}>
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </Button>
        <input
          type="range"
          aria-label="播放进度"
          min={0}
          max={duration}
          step={0.1}
          value={time}
          onChange={(e) => onTime(Number(e.target.value))}
          className="min-w-0 flex-1 accent-brand-600"
        />
        <span className="shrink-0 text-xs text-ink-500 tabular-nums">
          {clock(time)} / {clock(duration)}
        </span>
      </div>
    </div>
  )
}

/**
 * 视频转写的人工校对：选一集，左边看视频、右边对剧本。
 * 格式由后台按模板约束，这里只核对内容：点任意一行跳到那一刻，播放时剧本跟着走；发现听错、漏掉的直接改。可跳过。
 */
export function VideoCheck({ project, job }: { project: Project; job: VideoJob }) {
  const patchWork = useProjects((s) => s.patchWork)
  const attach = useVideoFiles((s) => s.attach)
  const files = useVideoFiles((s) => s.files[project.id])
  const done = job.episodes.filter((e) => e.status === 'done')
  const [ep, setEp] = useState(() => done[0]?.ep ?? 1)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [seek, setSeek] = useState({ t: 0, n: 0 })
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [redo, setRedo] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const index = done.findIndex((e) => e.ep === ep)
  const episode = done[index] ?? done[0]
  const entries = useMemo(() => (episode ? entriesOf(episode.ep, episode.shots) : []), [episode])
  const active = entries.reduce((at, e, i) => (e.start <= time + 0.05 ? i : at), 0)
  const edited = done.filter((e) => e.editedAt).length

  // 换集：从头开始
  useEffect(() => {
    setTime(0)
    setPlaying(false)
    setEditing(null)
    setSeek((s) => ({ t: 0, n: s.n + 1 }))
    listRef.current?.scrollTo({ top: 0 })
  }, [episode?.ep])

  // 播放时剧本跟着走：当前行不在视野里就滚到上三分之一处
  useEffect(() => {
    const box = listRef.current
    const el = box?.querySelector<HTMLElement>(`[data-entry="${active}"]`)
    if (!box || !el || !playing || editing) return
    if (el.offsetTop < box.scrollTop || el.offsetTop + el.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTo({ top: el.offsetTop - box.clientHeight / 3, behavior: 'smooth' })
  }, [active, playing, editing])

  if (!episode) return null

  const jump = (t: number) => {
    setTime(t)
    setSeek((s) => ({ t, n: s.n + 1 }))
  }

  const patchEpisode = (patch: (e: VideoEpisode) => VideoEpisode, note: string) => {
    const cur = latestProject(project.id)?.work.video
    if (!cur) return
    patchWork(project.id, { video: { ...cur, episodes: cur.episodes.map((e) => (e.ep === episode.ep ? patch(e) : e)) } }, note)
  }

  const save = (e: Entry) => {
    setEditing(null)
    const s = episode.shots[e.shot]
    const before = editableOf(e, s)
    const text = draft.trim()
    if (before === null || text === before.trim() || (!text && e.kind !== 'action')) return
    const next: Shot = e.kind === 'scene' ? { ...s, scene: formatScene(text) } : e.kind === 'dialogue' ? { ...s, line: text } : { ...s, action: text }
    patchEpisode((x) => ({ ...x, shots: x.shots.map((y, i) => (i === e.shot ? next : y)), editedAt: new Date().toISOString() }), `人工校对第 ${episode.ep} 集：改了一处`)
    toast(`第 ${episode.ep} 集已改一处`)
  }


  const onFile = (list: FileList | null) => {
    const file = list?.[0]
    if (!file) return
    attach(project.id, [{ ep: episode.ep, file }])
    toast(`第 ${episode.ep} 集已载入视频：${file.name}`)
  }

  const scenes = entries.filter((e) => e.kind === 'scene')
  const curScene = scenes.reduce((at, e) => (e.start <= time + 0.05 ? e.key : at), scenes[0]?.key)
  const src = files?.[episode.ep]

  return (
    <Card id="video-check">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-[15px] font-semibold text-ink-900">
            人工校对
            <span className="text-[13px] font-normal text-ink-500 tabular-nums">
              改过 {edited} / {done.length} 集
            </span>
          </h3>
          <p className="mt-0.5 text-[13px] text-ink-500">选一集，左边看视频、右边对剧本：点任意一行跳到那一刻，播放时剧本跟着走；听错、漏掉的点 ✎ 改，改完点「确认」才保存。可以跳过，不校对也能合并</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="ghost" size="sm" aria-label="上一集" disabled={index <= 0} onClick={() => setEp(done[index - 1].ep)}>
            <ChevronLeft size={15} />
          </Button>
          <Select aria-label="选择集" value={episode.ep} onChange={(e) => setEp(Number(e.target.value))} className="w-36">
            {done.map((e) => (
              <option key={e.ep} value={e.ep}>
                第 {e.ep} 集{e.editedAt ? ' · 改过' : ''}
              </option>
            ))}
          </Select>
          <Button variant="ghost" size="sm" aria-label="下一集" disabled={index >= done.length - 1} onClick={() => setEp(done[index + 1].ep)}>
            <ChevronRight size={15} />
          </Button>
        </div>
      </div>

      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]">
        <div className="space-y-2 lg:sticky lg:top-stick lg:self-start">
          <Player src={src} episode={episode} time={time} playing={playing} seek={seek} onTime={setTime} onPlaying={setPlaying} />
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
            <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
              <FileVideo size={14} />
              {src ? '换一个视频文件' : '选择本集视频文件'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setRedo(true)} title="漏了一大段、整集对不上时用">
              <RotateCcw size={14} />
              重新转写本集
            </Button>
            <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={(e) => onFile(e.target.files)} />
          </div>
          {episode.file && !src && <p className="text-xs text-ink-400">上传时的文件：{episode.file}（刷新后需要重新选择才能播放）</p>}
        </div>

        <div className="min-w-0">
          {scenes.length > 1 && (
            <div data-scene-jump className="mb-2 flex flex-wrap gap-1.5">
              {scenes.map((e) => (
                <button
                  key={e.key}
                  type="button"
                  onClick={() => jump(e.start)}
                  className={clsx(
                    'rounded-md border px-2 py-0.5 text-xs tabular-nums transition-colors',
                    e.key === curScene ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line text-ink-600 hover:border-brand-300',
                  )}
                  title={e.text}
                >
                  {e.no}
                </button>
              ))}
            </div>
          )}
          <div ref={listRef} data-check-script className="scrollbar-thin relative max-h-[66vh] overflow-y-auto rounded-lg border border-line py-2 text-[13px] leading-6">
            <div className="px-4 pb-1 font-semibold text-ink-900">第 {episode.ep} 集</div>
            {entries.map((e, i) => {
              const s = episode.shots[e.shot]
              const editable = editableOf(e, s) !== null
              const on = i === active
              return (
                <div
                  key={e.key}
                  data-entry={i}
                  className={clsx('group flex items-start gap-2 px-4 py-0.5 transition-colors', on ? 'bg-brand-50' : 'hover:bg-canvas', e.kind === 'scene' && 'mt-2')}
                >
                  <button type="button" onClick={() => jump(e.start)} className="w-11 shrink-0 pt-px text-left font-mono text-[11px] leading-6 text-ink-400 hover:text-brand-600" title="跳到这一刻">
                    {clock(e.start)}
                  </button>
                  {editing === e.key ? (
                    <div data-editing className="min-w-0 flex-1">
                      <AutoTextarea
                        autoFocus
                        inline
                        aria-label="改这一行"
                        value={draft}
                        onChange={(x) => setDraft(x.target.value)}
                        onKeyDown={(x) => {
                          if (x.key === 'Enter' && !x.shiftKey) {
                            x.preventDefault()
                            save(e)
                          }
                          if (x.key === 'Escape') setEditing(null)
                        }}
                        className="w-full bg-white ring-1 ring-brand-300"
                      />
                      <div className="mt-1 flex items-center gap-1.5">
                        <Button size="sm" onClick={() => save(e)}>
                          <Check size={13} />
                          确认
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                          取消
                        </Button>
                        <span className="text-xs text-ink-400">Enter 确认 · Esc 取消；改动点「确认」才保存</span>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => jump(e.start)}
                      className={clsx('min-w-0 flex-1 text-left', e.kind === 'scene' ? 'font-semibold text-ink-900' : e.kind === 'cast' ? 'text-ink-500' : 'text-ink-800')}
                    >
                      {e.kind === 'dialogue' && s.speaker ? (
                        <>
                          <span className="font-medium text-ink-900">{speakerLabel(s)}：</span>
                          {s.cue && `（${s.cue}）`}
                          {s.line}
                        </>
                      ) : (
                        e.text
                      )}
                    </button>
                  )}
                  {editable && editing === null && (
                    <button
                      type="button"
                      aria-label="改这一行"
                      onClick={() => {
                        setPlaying(false)
                        setDraft(editableOf(e, s) ?? '')
                        setEditing(e.key)
                      }}
                      className="invisible shrink-0 rounded p-1 text-ink-400 group-hover:visible hover:bg-white hover:text-brand-600"
                    >
                      <Pencil size={13} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-400">
            {episode.model && <span>{modelLabel(episode.model)} 解析</span>}
            {episode.editedAt && <Badge tone="amber">校对时改过</Badge>}
            <span>台词只改说的内容；说话人、格式由后台按模板生成</span>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={redo}
        onClose={() => setRedo(false)}
        onConfirm={() => retranscribe(project.id, episode.ep, '人工校对时发现对不上')}
        title={`重新转写第 ${episode.ep} 集？`}
        desc={`用视频解析模型（${modelLabel(modelOf(project, 'video'))}）重新转写这一集，本集的校对改动会丢掉；合并好的剧本会作废，转写完成后重新合并。`}
        confirmText="重新转写"
      />
    </Card>
  )
}
