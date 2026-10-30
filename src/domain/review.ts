/**
 * 审稿依据：AI 写作和 AI 审稿对照的是同一份清单。每条审稿意见都要说清依据哪一项、依据原文是什么；
 * 说不出依据的只算建议，不拦定稿。
 */
import type { ReviewBasis, ReviewCode, ReviewItem, ReviewItemStatus, ReviewKeep } from './types'

export const REVIEW_BASIS: { key: ReviewBasis; label: string; covers: string }[] = [
  { key: 'core', label: '核心设定', covers: '故事架构里的全局写作要求：明确不许出现的内容' },
  { key: 'character', label: '人物设定', covers: '人物是否登记、主角是否有戏、台词是否符合人物性格（如寡言的人不说长句）' },
  { key: 'state', label: '状态库', covers: '与前面已定稿的剧情一致：人物状态、道具归属、已回收的伏笔' },
  { key: 'outline', label: '集纲', covers: '本集集纲里的事件是否写进正文' },
  { key: 'blueprint', label: '蓝图', covers: '开场承接、蓝图里的出场人物' },
  { key: 'foreshadow', label: '伏笔计划', covers: '计划本集埋设 / 回收的伏笔是否写进正文' },
  { key: 'format', label: '格式与篇幅', covers: '按单集时长换算的字数、场景标题、集末钩子' },
  { key: 'style', label: '文风', covers: 'AI 味词汇、过长的台词' },
]

export const basisLabel = (b?: ReviewBasis) => REVIEW_BASIS.find((x) => x.key === b)?.label ?? ''

/** 每类意见对照的依据 */
export const BASIS_OF: Record<ReviewCode, ReviewBasis | undefined> = {
  short: 'format',
  long: 'format',
  scene: 'format',
  hook: 'format',
  carry: 'blueprint',
  absent: 'blueprint',
  plan: 'foreshadow',
  hero: 'character',
  unknown: 'character',
  voice: 'character',
  state: 'state',
  paid: 'state',
  rule: 'core',
  event: 'outline',
  filler: 'style',
  longLine: 'style',
  // 标注是编剧自己的意见，不算审稿依据
  notes: undefined,
}

/** AI 不擅自改、直接交给编剧的意见：人物登记、已回收伏笔的真相 */
export const MANUAL_CODES: ReviewCode[] = ['unknown', 'paid']

/** 一条意见在各轮审稿里的标识：没有 key 的旧报告按类别、再按原文认 */
export const itemKey = (i: Pick<ReviewItem, 'key' | 'code' | 'text'>) => i.key ?? i.code ?? i.text

/** AI 改不动、交给编剧的意见 */
export const isStuck = (s?: ReviewItemStatus) => s === 'stuck' || s === 'back'

export const STATUS_LABEL: Record<ReviewItemStatus, string> = {
  new: '新发现',
  still: '修稿后仍在',
  stuck: 'AI 改不动，需人工',
  back: '改好又出现，需人工',
  fixed: '已改掉',
}

/** 编剧保留不改的意见：之后的审稿不再提 */
export const keptOf = (keeps: ReviewKeep[] | undefined, ep: number) => new Map((keeps ?? []).filter((k) => k.ep === ep).map((k) => [k.key, k]))

/** 台词要短的性格 */
export const TACITURN = /寡言|沉默|话少|少言|惜字如金|不善言辞|高冷|冷淡|冷漠|闷/

/** 寡言的人一句台词最多几个字 */
export const TACITURN_MAX = 18

/**
 * 全局写作要求里明确不许出现的词：「不要出现 / 禁止写 / 避免使用 …」后面引号里的词，
 * 或「…出现 / 写 / 用 …」后面到标点为止的一段。只说「不得偏离人物小传」这类要求不是词，不算。
 */
export function forbiddenTerms(rules: string) {
  const out: { term: string; rule: string }[] = []
  for (const raw of rules.split(/\n/)) {
    const rule = raw.trim().replace(/^\d+[.、]\s*/, '')
    for (const m of rule.matchAll(/(?:不要|禁止|避免|不能|不得|不许|严禁|少用|别用|不用)(出现|写|使用|用|提)?\s*([“"「『]([^”"」』]+)[”"」』]|[^，。；,;！!\n]+)/g)) {
      const quoted = m[3]
      const terms = quoted ? quoted.split(/[、,，/]/) : m[1] ? [m[2]] : []
      for (const t of terms.map((x) => x.trim().replace(/^(的|任何)/, '').replace(/(等.*|之类.*)$/, ''))) {
        if (t.length >= 2 && t.length <= 12 && !out.some((x) => x.term === t)) out.push({ term: t, rule })
      }
    }
  }
  return out
}
