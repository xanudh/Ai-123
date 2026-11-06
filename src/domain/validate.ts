import { EPISODE_RANGE, EPISODE_SECONDS } from './constants'
import { parsePaywalls } from './rhythm'
import type { ProjectDraft } from './types'

export type FormErrors = Partial<Record<'title' | 'titleEn' | 'benchmarkTitle' | 'benchmarkPaywalls' | 'markets', string>>

/** 立项页与项目设置页的字段：基本信息、市场与发行（故事设定和节奏框架都在故事架构里编辑） */
export function validateAll(d: ProjectDraft): FormErrors {
  const e: FormErrors = {}
  const title = d.title.trim()
  if (!title) e.title = '请填写剧本名称'
  else if (title.length > 30) e.title = '剧本名称不超过 30 个字'
  if (d.titleEn.length > 60) e.titleEn = '英文剧名不超过 60 个字符'
  if (d.mode !== 'original' && !d.benchmark?.title.trim()) e.benchmarkTitle = '请填写对标剧剧名'
  if (d.mode !== 'original' && d.benchmark?.paywalls?.trim()) {
    const paywalls = parsePaywalls(d.benchmark.paywalls)
    const episodes = d.benchmark.episodes
    if (!paywalls) e.benchmarkPaywalls = '只填集数，多个用「，」隔开，例：8，15，25'
    else if (episodes && paywalls[paywalls.length - 1] > episodes) e.benchmarkPaywalls = `对标剧只有 ${episodes} 集`
  }
  // 题材类型、风格元素、集数与时长不在立项和设置里填：立项先用默认值，到故事架构填，原创的题材在确认故事架构时检查
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
