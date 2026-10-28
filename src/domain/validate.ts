import { EPISODE_RANGE, EPISODE_SECONDS } from './constants'
import type { ProjectDraft } from './types'

export type FormErrors = Partial<Record<'title' | 'titleEn' | 'benchmarkTitle' | 'genres' | 'totalEpisodes' | 'episodeSeconds' | 'markets', string>>

const inRange = (n: number, range: { min: number; max: number }) => Number.isInteger(n) && n >= range.min && n <= range.max

/** 立项页与项目设置页的全部字段（节奏框架在故事架构中单独编辑） */
export function validateAll(d: ProjectDraft): FormErrors {
  const e: FormErrors = {}
  const title = d.title.trim()
  if (!title) e.title = '请填写剧本名称'
  else if (title.length > 30) e.title = '剧本名称不超过 30 个字'
  if (d.titleEn.length > 60) e.titleEn = '英文剧名不超过 60 个字符'
  if (d.mode !== 'original' && !d.benchmark?.title.trim()) e.benchmarkTitle = '请填写对标剧剧名'
  if (d.genres.length === 0) e.genres = '至少选择 1 个题材元素'
  // 视频转剧本：集数与时长可以留空，保存时按识别结果或默认值补上
  const optional = (n: number) => d.mode === 'video' && !n
  if (!optional(d.spec.totalEpisodes) && !inRange(d.spec.totalEpisodes, EPISODE_RANGE)) e.totalEpisodes = `总集数需在 ${EPISODE_RANGE.min}–${EPISODE_RANGE.max} 之间`
  if (!optional(d.spec.episodeSeconds) && !inRange(d.spec.episodeSeconds, EPISODE_SECONDS)) e.episodeSeconds = `单集时长需在 ${EPISODE_SECONDS.min}–${EPISODE_SECONDS.max} 秒之间`
  if (d.markets.length === 0) e.markets = '至少选择 1 个目标市场'
  return e
}

/** 留空的总集数取对标剧集数（限在合法范围内），再否则取默认值；单集时长取默认值 */
export function withSpecDefaults<T extends ProjectDraft>(d: T): T {
  const { totalEpisodes, episodeSeconds } = d.spec
  if (totalEpisodes && episodeSeconds) return d
  const detected = d.benchmark?.episodes ? Math.min(EPISODE_RANGE.max, Math.max(EPISODE_RANGE.min, d.benchmark.episodes)) : 0
  return {
    ...d,
    spec: { ...d.spec, totalEpisodes: totalEpisodes || detected || EPISODE_RANGE.default, episodeSeconds: episodeSeconds || EPISODE_SECONDS.default },
  }
}

export const hasErrors = (e: FormErrors) => Object.keys(e).length > 0
