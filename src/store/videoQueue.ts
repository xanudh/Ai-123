/**
 * 视频逐集转写队列：在页面之外运行，切到别的环节也会继续转写，全部跑完弹出提示。
 * 每集的状态切换写进项目（随项目持久化），步骤百分比只放内存；刷新页面后，没跑完的集回到排队。
 */
import { create } from 'zustand'
import { modelOf } from '../domain/models'
import type { TranscribeStatus, VideoEpisode } from '../domain/types'
import { transcribeEpisode } from '../services/ai'
import { useProjects } from './projects'
import { toast } from './toast'

/** 同时转写的集数 */
export const CONCURRENCY = 3

interface QueueState {
  /** 正在跑队列的项目 */
  running: Record<string, true>
  /** `${projectId}:${ep}` → 当前步骤的百分比 */
  progress: Record<string, number>
}

export const useVideoQueue = create<QueueState>(() => ({ running: {}, progress: {} }))

const controllers = new Map<string, AbortController>()

export const progressKey = (projectId: string, ep: number) => `${projectId}:${ep}`

export const isTranscribing = (status: TranscribeStatus) => status === 'downloading' || status === 'compressing' || status === 'transcribing'

const jobOf = (projectId: string) => useProjects.getState().projects.find((p) => p.id === projectId)?.work.video ?? null

function patchEpisodes(projectId: string, map: (e: VideoEpisode) => VideoEpisode, note?: string) {
  const job = jobOf(projectId)
  if (job) useProjects.getState().patchWork(projectId, { video: { ...job, episodes: job.episodes.map(map) } }, note)
}

const patchEpisode = (projectId: string, ep: number, patch: Partial<VideoEpisode>) =>
  patchEpisodes(projectId, (e) => (e.ep === ep ? { ...e, ...patch } : e))

function setProgress(projectId: string, ep: number, value: number | null) {
  useVideoQueue.setState((s) => {
    const progress = { ...s.progress }
    if (value === null) delete progress[progressKey(projectId, ep)]
    else progress[progressKey(projectId, ep)] = value
    return { progress }
  })
}

function setRunning(projectId: string, on: boolean) {
  useVideoQueue.setState((s) => {
    const running = { ...s.running }
    if (on) running[projectId] = true
    else delete running[projectId]
    return { running }
  })
}

/** 领取下一集：第一个排队中的集标为下载中 */
function claim(projectId: string): VideoEpisode | null {
  const next = jobOf(projectId)?.episodes.find((e) => e.status === 'queued')
  if (!next) return null
  const claimed: VideoEpisode = { ...next, status: 'downloading', attempts: next.attempts + 1, error: undefined }
  patchEpisode(projectId, next.ep, claimed)
  return claimed
}

async function worker(projectId: string, signal: AbortSignal) {
  while (!signal.aborted) {
    const project = useProjects.getState().projects.find((p) => p.id === projectId)
    const job = jobOf(projectId)
    const ep = claim(projectId)
    if (!project || !job || !ep) return
    // 领取时的视频解析模型；中途换模型只影响之后领取的集
    const model = modelOf(project, 'video')
    let status: TranscribeStatus = ep.status
    try {
      const shots = await transcribeEpisode(
        job,
        ep,
        (next, percent) => {
          if (next !== status) {
            status = next
            patchEpisode(projectId, ep.ep, { status })
          }
          setProgress(projectId, ep.ep, percent)
        },
        signal,
        model,
      )
      patchEpisode(projectId, ep.ep, { status: 'done', shots, doneAt: new Date().toISOString(), model })
    } catch (e) {
      // 暂停：回到排队，这次不算尝试
      if ((e as Error).name === 'AbortError') patchEpisode(projectId, ep.ep, { status: 'queued', attempts: ep.attempts - 1 })
      else patchEpisode(projectId, ep.ep, { status: 'failed', error: (e as Error).message })
    } finally {
      setProgress(projectId, ep.ep, null)
    }
  }
}

function finished(projectId: string) {
  const job = jobOf(projectId)
  if (!job) return
  const done = job.episodes.filter((e) => e.status === 'done').length
  const failed = job.episodes.filter((e) => e.status === 'failed').length
  if (done + failed < job.episodes.length) return
  if (failed) {
    toast(`逐集转写结束：${done} 集完成，${failed} 集失败，重试后才能合并`, 'error')
  } else {
    useProjects.getState().patchWork(projectId, {}, `视频逐集转写完成：共 ${done} 集`)
    toast(`全部 ${done} 集已转写完成，可以合并剧本了`)
  }
}

export function startQueue(projectId: string) {
  if (controllers.has(projectId)) return
  const c = new AbortController()
  controllers.set(projectId, c)
  setRunning(projectId, true)
  Promise.all(Array.from({ length: CONCURRENCY }, () => worker(projectId, c.signal))).finally(() => {
    // 已暂停或被新队列取代时不再收尾
    if (controllers.get(projectId) !== c) return
    controllers.delete(projectId)
    setRunning(projectId, false)
    finished(projectId)
  })
}

/** 暂停：正在转写的集回到排队 */
export function stopQueue(projectId: string) {
  controllers.get(projectId)?.abort()
  controllers.delete(projectId)
  setRunning(projectId, false)
}

/** 失败的集重新排队（不传集数则全部重试） */
export function retryFailed(projectId: string, ep?: number) {
  patchEpisodes(projectId, (e) => (e.status === 'failed' && (ep === undefined || e.ep === ep) ? { ...e, status: 'queued', error: undefined } : e))
  startQueue(projectId)
}

/** 刷新页面后：队列没在跑，但存档里还有转写中的集，放回排队 */
export function recoverStale(projectId: string) {
  if (controllers.has(projectId)) return
  const job = jobOf(projectId)
  if (!job?.episodes.some((e) => isTranscribing(e.status))) return
  patchEpisodes(projectId, (e) => (isTranscribing(e.status) ? { ...e, status: 'queued', attempts: Math.max(0, e.attempts - 1) } : e))
}
