/**
 * 故事架构三项设定的写法（11/4 标注）和读法，逐项生成（chain.ts）和 AI 方向卡（writer.ts）共用：
 * - 世界观：总分写，世界总览 → 阵营设定 → 主要地点（私设的专有名词写细）
 * - 金手指：首行写名字，再写首次出现、核心能力（每项来历和能做到什么、哪个层面的硬金手指）、表现方式、与主线强相关；
 *   不标类型（11/4 第五轮标注），类型只在套件里用来定能力是哪个层面
 * - 故事背景：写成故事简介，一段话从主角的处境讲到结局
 * 读的时候也认旧写法（「时代与地点：」「核心秘密：」「开场前：」「旧事：」），旧项目不用重写。
 */
import { GOLDEN_FINGER_KINDS } from '../../domain/constants'
import type { GoldenFingerKind } from '../../domain/constants'
import type { Kit } from './kits'

/* ---------------------------------- 读 ---------------------------------- */

/** 多行「标题：内容」里某个标题后面的内容 */
export const lineOf = (text: string | undefined, key: string) =>
  (text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith(`${key}：`))
    ?.slice(key.length + 1)
    .trim() ?? ''

const firstLine = (text: string | undefined) => (text ?? '').split('\n').find((l) => l.trim())?.trim() ?? ''

/** 一段话按句号切开 */
const sentencesOf = (text: string | undefined) =>
  (text ?? '')
    .split(/(?<=[。！？])/)
    .map((s) => s.trim())
    .filter(Boolean)

/** 金手指首行：「银月项链」；旧写法带类型「「银月项链」（力量型 + 身份型）」或「一枚黑色令牌——隐世家族继承人身份的钥匙」 */
export const fingerHead = (text: string | undefined) => lineOf(text, '金手指') || firstLine(text).replace(/^[^：]{1,8}：/, '')

/** 金手指的名字：「」里的；没有就取首行去掉类型括号、破折号后面的话 */
export function fingerName(text: string | undefined) {
  const head = fingerHead(text)
  return (/「([^「」]+)」/.exec(head)?.[1] ?? head.replace(/（[^（）]*）$/, '').split('——')[0]).trim()
}

/** 核心能力下面的各项（「· 能力名：……」），到下一个标题为止；每项下面缩进写的来历、能做到不算 */
const abilitiesOf = (finger: string | undefined) => {
  const lines = (finger ?? '').split('\n').map((l) => l.trim())
  const from = lines.findIndex((l) => l.startsWith('核心能力'))
  if (from < 0) return []
  const rest = lines.slice(from + 1)
  const stop = rest.findIndex((l) => /^(首次出现|表现方式|与主线强相关)：/.test(l))
  return (stop < 0 ? rest : rest.slice(0, stop)).filter((l) => l.startsWith('·'))
}

/** 能力名：「· 月祭司传人：……」→ 月祭司传人；旧写法名字后面带（类型） */
const abilityName = (line: string) => line.replace(/^·\s*/, '').split('：')[0].replace(/（[^（）]*）$/, '').trim()

const IDENTITY = /身份|继承人|传人|血脉|血统|后裔|千金|转世|王族|公主|皇子|少爷/

/** 揭开身份的那一项：旧写法标了（身份型）；新写法不标类型，看能力名，再看「其实是」 */
const identityLine = (finger: string | undefined) => {
  const list = abilitiesOf(finger)
  return list.find((l) => l.includes('（身份型）')) ?? list.find((l) => IDENTITY.test(abilityName(l))) ?? list.find((l) => /其实是|身份揭开/.test(l))
}

/** 揭开的身份：金手指里揭开身份的那一项；旧写法读世界观的「核心秘密」 */
export function secretOf(world: string | undefined, finger: string | undefined) {
  const old = lineOf(world, '核心秘密')
  if (old) return old
  const ability = identityLine(finger)
  return ability ? ability.replace(/^·\s*/, '').replace(/^[^：]*：/, '').replace(/。这是其.*$/, '').split('；')[0].trim() : ''
}

/** 金手指里揭开身份那一项的名字（揭开后的身份，如「月祭司传人」） */
export const identityOf = (finger: string | undefined) => {
  const line = identityLine(finger)
  return line ? abilityName(line) : ''
}

/** 世界总览那一句；旧写法读「时代与地点」 */
export const worldLead = (world: string | undefined) => lineOf(world, '世界总览') || lineOf(world, '时代与地点') || firstLine(world)

/** 世界观里写了不出现现代物品（古代题材的硬规则） */
export const noModern = (world: string | undefined) => /不出现现代物品/.test(world ?? '')

/** 故事背景的第一句：主角的处境；旧写法读「开场前」 */
export const openingOf = (background: string | undefined) => lineOf(background, '开场前') || sentencesOf(background)[0] || ''

/** 故事背景的第二句：谁为了什么、怎么逼主角；旧写法读「旧事」 */
export const grudgeOf = (background: string | undefined) => lineOf(background, '旧事') || sentencesOf(background)[1] || ''

/** 故事背景的结局：故事简介的最后一句（「最终，……」）；旧写法没有结局 */
export const endingOf = (background: string | undefined) => (isStory(background) ? (sentencesOf(background).at(-1) ?? '').replace(/^最终[，,]\s*/, '') : '')

/* ---------------------------------- 写 ---------------------------------- */

type Fill = (tpl: string) => string

const layerOf = (kind: GoldenFingerKind) => GOLDEN_FINGER_KINDS.find((k) => k.label === kind)!.layer
const end = (s: string) => s.replace(/[。；，]+$/, '')

/** 世界观：世界总览一行，阵营、主要地点各一组 */
export function worldLines(kit: Kit, fill: Fill, lead?: string) {
  const st = kit.setting
  return {
    lead: `世界总览：${end(lead ?? fill(st.overview))}。`,
    camps: st.camps.map(([name, desc]) => `· ${fill(name)}：${end(fill(desc))}。`),
    places: st.places.map(([name, desc]) => `· ${fill(name)}：${end(fill(desc))}。`),
  }
}

export const worldText = (kit: Kit, fill: Fill, lead?: string) => {
  const w = worldLines(kit, fill, lead)
  return [w.lead, '阵营设定：', ...w.camps, '主要地点：', ...w.places].join('\n')
}

export interface FingerOpts {
  /** 改写想法里给了名字就用它 */
  name?: string
  /** 核心设定里写明的反常规点：写进揭开身份的那一项 */
  twist?: string
  /** 被打脸的人 */
  foe: string
  hero: string
  /** 方向卡另加的一句（如信息差） */
  extra?: string
}

/** 金手指：首行名字，首次出现，核心能力（每项一行），表现方式，与主线强相关；类型不写出来，只用来定是哪个层面的硬金手指 */
export function fingerLines(kit: Kit, fill: Fill, o: FingerOpts) {
  const f = kit.setting.finger
  // 核心设定写明了反常规点（「原来是失落王族最后的血脉」）：揭开身份的那一项按它写，名字也用它
  const core = o.twist ? end(o.twist).replace(/^(她|他)?(自己)?(其实|原来|竟然|竟|才)?是/, '') : ''
  const twisted = (name: string, desc: string) =>
    core
      ? { name: core.length <= 14 ? core : name, desc: `${o.hero}${core !== end(o.twist!) ? `其实是${core}` : `：${core}`}；身份揭开前被当成${fill(kit.setting.surface)}，揭开后谁都要低头` }
      : { name, desc }
  const abilities = f.abilities.map(([name, kind, desc]) => ({ kind, ...(kind === '身份型' ? twisted(fill(name), fill(desc)) : { name: fill(name), desc: fill(desc) }) }))
  const name = o.name || fill(f.name)
  return {
    head: `金手指：「${name}」`,
    first: `首次出现：第 1 集（${end(fill(f.first))}）。`,
    abilities: abilities.map((x) => ({ ...x, line: `· ${x.name}：${end(x.desc)}。这是其${layerOf(x.kind)}的硬金手指。` })),
    show: [
      `· 首集展示：${end(fill(f.first))}（只埋不用，留悬念）。`,
      `· 渐进释放：${f.release.map(fill).join(' → ')}。`,
      `· 权威认证：${end(fill(f.proof))}。`,
      ...(o.extra ? [`· ${end(o.extra)}。`] : []),
    ],
    tie: `与主线强相关：「${name}」服务于打脸和身份反转。前期被隐藏，${o.hero}被当成${fill(kit.setting.surface)}受尽羞辱；后期逐步释放，成为打脸${o.foe}的武器。`,
  }
}

export const fingerText = (kit: Kit, fill: Fill, o: FingerOpts) => {
  const g = fingerLines(kit, fill, o)
  return [g.head, g.first, '核心能力：', ...g.abilities.map((x) => x.line), '表现方式：', ...g.show, g.tie].join('\n')
}

export interface StoryOpts {
  hero: string
  villain: string
  she: '她' | '他'
  /** 开场的处境；没有就用题材套件的开局 */
  opening?: string
  /** 揭开的身份 */
  secret: string
  finger: string
  /** 揭开后的身份；没有就用题材套件的 */
  identity?: string
  /** 方向卡另加的一句 */
  extra?: string
}

/** 故事背景：写成一段故事简介——处境 → 谁为了什么怎么逼 → 转机 → 变本加厉 → 结局，主角从什么变成什么 */
export function storyText(kit: Kit, fill: Fill, o: StoryOpts) {
  const st = kit.setting
  return [
    `${end(o.opening || fill(kit.opening))}。`,
    `${end(fill(st.squeeze))}；这一切的根源在于，${end(fill(kit.grudge))}。`,
    ...(o.extra ? [`${end(o.extra)}。`] : []),
    `绝境中，${o.hero}靠「${o.finger}」翻盘——${end(o.secret)}。`,
    `${o.villain}不信${o.she}能翻身，反而变本加厉，却一次次被当众打脸。`,
    `最终，${end(fill(kit.ending))}，${o.hero}从“${end(fill(st.surface))}”成为${o.identity || kit.identity}。`,
  ].join('')
}

/** 人物小传「能力」一栏：金手指的名字和各项能力名 */
export function fingerBrief(text: string | undefined) {
  const head = fingerHead(text)
  const names = abilitiesOf(text).map(abilityName).filter(Boolean)
  return names.length ? `${head}：${names.join('、')}` : head
}

/** 故事背景已经是一段故事简介（不是旧的「开场前 / 旧事」写法） */
export const isStory = (background: string | undefined) => !!background?.trim() && !/^(开场前|旧事)：/m.test(background)
