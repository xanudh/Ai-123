import { AUDIENCES, LANGUAGES } from '../domain/constants'
import type { Audience, ScriptLanguage } from '../domain/types'

export function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60_000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return new Date(iso).toLocaleDateString('zh-CN')
}

export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export const audienceLabel = (a: Audience) => AUDIENCES.find((x) => x.value === a)?.label ?? a

export const languageLabel = (l: ScriptLanguage) => LANGUAGES.find((x) => x.value === l)?.label ?? l

export const durationLabel = (seconds: number) => (seconds % 60 === 0 ? `${seconds / 60} 分钟` : `${seconds} 秒`)

export const episodeList = (eps: number[]) => (eps.length ? eps.map((e) => `第${e}集`).join(' / ') : '—')
