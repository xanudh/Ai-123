/**
 * 主角人设可以只写一句话，也可以按人物卡格式写全（主角：/ 性别：/ 年龄：/ 外貌：/ 性格：/ 背景：/ 能力：/ 动机：/ 弧光：/ 备注：/ 关系备注：）。
 * 进人物设定时按卡拆到人物小传各项。
 */
import type { Character } from './types'
import { inferRelationKind } from './work'

export const HERO_CARD_KEYS = ['主角', '性别', '年龄', '外貌', '性格', '背景', '能力', '动机', '弧光', '备注', '关系备注'] as const
export type HeroCardKey = (typeof HERO_CARD_KEYS)[number]
export type HeroCard = Partial<Record<HeroCardKey, string>>

/** 写成人物卡的主角人设（至少 3 项）；一句话的返回 null */
export function parseHeroCard(text: string): HeroCard | null {
  const card: HeroCard = {}
  let last: HeroCardKey | null = null
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const m = /^([^：:]{1,5})\s*[：:]\s*(.*)$/.exec(line)
    const key = m && (HERO_CARD_KEYS as readonly string[]).includes(m[1].trim()) ? (m[1].trim() as HeroCardKey) : null
    if (key) {
      card[key] = m![2].trim()
      last = key
    } else if (last) card[last] = `${card[last]}\n${line}`
  }
  return Object.keys(card).length >= 3 ? card : null
}

/** 中文句子按逗号、分号切开 */
const clauses = (text: string) =>
  text
    .split(/[，,；;。\n]/)
    .map((s) => s.trim())
    .filter(Boolean)

const COSTUME = /穿|戴|衣|服|裙|西装|外套|衬衫|佩|项链|吊坠|戒指|手表|耳环|鞋|帽|围巾|发簪|披风|铠甲|制服/
const FLAW = /但|却|缺点|弱点|不敢|太|过于|冲动|多疑|自卑|固执|嘴硬|骄傲|偏执|心软/
const FEAR = /怕|恐惧|不敢|噩梦|阴影/
const DESIRE = /渴望|真正|心底|终极|其实想|最想/

/** 名字后面可能带括号说明：朴载勋（财阀继承人）→ 朴载勋 / 财阀继承人 */
export function nameOf(text: string): { name: string; note: string } {
  const m = /^([^（(，,、\s]{1,12})\s*[（(]([^）)]*)[）)]?\s*(.*)$/.exec(text.trim())
  if (m) return { name: m[1], note: [m[2], m[3]].filter(Boolean).join('，') }
  const [name, ...rest] = text.trim().split(/[，,\s]/)
  return { name: name ?? '', note: rest.join('，') }
}

export interface CardRelation {
  name: string
  kind: string
  label: string
}

export interface HeroSplit {
  name: string
  /** 拆进人物小传的各项；卡里没有的项不填（英文名、外形参考留空） */
  fields: Partial<Pick<Character, 'gender' | 'age' | 'profile' | 'appearance' | 'costume' | 'personality' | 'background' | 'ability' | 'goal' | 'desire' | 'fear' | 'flaw' | 'arc' | 'notes'>>
  /** 关系备注：每条拆成关系类型和关系备注；提到的人顺手建成人物 */
  relations: CardRelation[]
}

/**
 * 人物卡 → 人物小传：
 * 性别、年龄、性格、背景、能力、弧光、备注拆到同名项；外貌拆到外形，其中的衣着、佩物拆到服装；
 * 动机拆成表面追求、终极渴望、潜意识恐惧；身份从背景里抽，缺陷从背景和性格里抽。
 */
export function splitHeroCard(card: HeroCard): HeroSplit {
  const { name, note } = nameOf(card.主角 ?? '')
  const fields: HeroSplit['fields'] = {}
  if (card.性别) fields.gender = /女/.test(card.性别) ? '女' : /男/.test(card.性别) ? '男' : card.性别
  if (card.年龄) fields.age = card.年龄.replace(/岁.*$/, '').trim() || card.年龄
  if (card.外貌) {
    const parts = clauses(card.外貌)
    const wear = parts.filter((c) => COSTUME.test(c))
    fields.appearance = parts.filter((c) => !COSTUME.test(c)).join('，') || card.外貌
    if (wear.length) fields.costume = wear.join('，')
  }
  if (card.性格) fields.personality = card.性格
  if (card.背景) {
    fields.background = card.背景
    fields.profile = note || clauses(card.背景)[0]
  } else if (note) fields.profile = note
  const flaw = [...clauses(card.性格 ?? ''), ...clauses(card.背景 ?? '')].filter((c) => FLAW.test(c))
  if (flaw.length) fields.flaw = flaw.slice(0, 2).join('，')
  if (card.能力) fields.ability = card.能力
  if (card.动机) {
    const parts = clauses(card.动机)
    const fear = parts.filter((c) => FEAR.test(c))
    const desire = parts.filter((c) => !FEAR.test(c) && DESIRE.test(c))
    const goal = parts.filter((c) => !fear.includes(c) && !desire.includes(c))
    if (goal.length) fields.goal = goal.join('，')
    if (desire.length) fields.desire = desire.join('，')
    if (fear.length) fields.fear = fear.join('，')
  }
  if (card.弧光) fields.arc = card.弧光
  if (card.备注) fields.notes = card.备注
  const relations = (card.关系备注 ?? '')
    .split(/[；;\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((s): CardRelation[] => {
      // 「林晚：青梅竹马，后来反目」或「与林晚是青梅竹马」
      const m = /^([^：:，,]{1,8})[：:]\s*(.+)$/.exec(s) ?? /^(?:与|和|跟)([^是为的，,]{1,8})(?:是|为|的)?\s*(.+)$/.exec(s)
      if (!m) return []
      const who = nameOf(m[1]).name
      return who && who !== name ? [{ name: who, kind: inferRelationKind(m[2]) || '其他', label: m[2] }] : []
    })
  return { name, fields, relations }
}
