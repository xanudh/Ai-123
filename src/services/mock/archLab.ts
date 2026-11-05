/**
 * 故事架构新版 Demo 的本地模拟：从一个想法（或固定格式）出发，一次给出整部剧的骨架；
 * 选定一版后逐项按意见重写，已定的项不动。接入大模型后替换这里。
 */
import { estimateChars } from '../../domain/rhythm'
import type { PlotBeat, Project } from '../../domain/types'
import { projectPhases, rangeLabel } from '../../domain/work'
import { newId } from '../../lib/id'
import { otherKits } from './kits'
import type { Kit } from './kits'
import { clip, hash, pick, rng, shuffle } from './rng'
import { BEATS, IRONY_BEATS, STRIKE_BEATS, coreCtx, fill, kitOf, mainLineOf, viewpointRule } from './writer'

/** 由小到大的八项：先定一句话，再一层层铺开到节奏与写法 */
export type LabKey = 'core' | 'synopsis' | 'background' | 'world' | 'goldenFinger' | 'hero' | 'rhythm' | 'style'

export const LAB_ORDER: LabKey[] = ['core', 'synopsis', 'background', 'world', 'goldenFinger', 'hero', 'rhythm', 'style']

export const LAB_META: Record<LabKey, { title: string; hint: string }> = {
  core: { title: '核心设定', hint: '一句话：主角是谁 + 核心困境 + 反常规点，整部剧以它为起点' },
  synopsis: { title: '故事简介', hint: '三五句讲完整部剧：开局、转折、结局' },
  background: { title: '故事背景', hint: '开场前发生了什么、主角被逼到什么处境' },
  world: { title: '世界观', hint: '时代、地点、规则与核心秘密' },
  goldenFinger: { title: '金手指 / 核心卖点', hint: '主角的依仗是什么，观众为什么追下去' },
  hero: { title: '主角', hint: '一句话人设：想要什么、缺陷是什么、怎么成长' },
  rhythm: { title: '节奏框架', hint: '冲突主线分几段、每段发生什么，付费卡点卡在哪里' },
  style: { title: '写作风格与要求', hint: '基调、视角、篇幅、台词与钩子的要求，每集写作都会带上' },
}

/** 一项的内容：节奏框架另带分段 */
export interface LabValue {
  text: string
  beats?: PlotBeat[]
  paywalls?: number[]
}

/** AI 给出的一版骨架 */
export interface LabSkeleton {
  id: string
  title: string
  pitch: string
  values: Record<LabKey, LabValue>
}

/** 固定格式的起点：填空式核心设定 */
export interface LabFormula {
  hero: string
  trouble: string
  goal: string
  twist: string
}

export const formulaText = (f: LabFormula) => {
  const parts = [f.hero && `${f.hero}`, f.trouble && `遭遇${f.trouble}`, f.goal && `必须${f.goal}`].filter(Boolean)
  const head = parts.join('，')
  return [head, f.twist && `反常规点：${f.twist}`].filter(Boolean).join('——')
}

/** 生成时带上的对标剧拆解：总纲 / 粗纲层面的结果都带，逐集明细太细不带 */
export function labReference(p: Project) {
  const bd = p.work.breakdown
  if (!bd) return null
  return {
    used: ['故事梗概', '人物与关系', '冲突主线（各段）', `付费节奏（第 ${bd.rhythm.paywalls.join('、') || '—'} 集）`],
    skipped: [`逐集明细（${bd.episodes.length} 集，集纲级内容太多）`],
  }
}

/** 节奏框架的文字版：导出与对比时用 */
export function rhythmText(v: LabValue) {
  const beats = (v.beats ?? []).map((b) => `${b.beat}（${b.range}）：${b.content}`)
  const pay = v.paywalls?.length ? [`付费卡点：第 ${v.paywalls.join('、')} 集`] : []
  return [...beats, ...pay, ...(v.text ? [v.text] : [])].join('\n')
}

export const valueText = (key: LabKey, v: LabValue) => (key === 'rhythm' ? rhythmText(v) : v.text)

const BEAT_SETS = [BEATS, STRIKE_BEATS, IRONY_BEATS]

function paywallsOf(p: Project) {
  const bd = p.work.breakdown
  const total = p.spec.totalEpisodes
  if (p.rhythm.paywalls.length) return p.rhythm.paywalls
  if (bd?.rhythm.paywalls.length) return bd.rhythm.paywalls.map((e) => Math.max(1, Math.round((e / bd.totalEpisodes) * total)))
  return [Math.round(total * 0.15)]
}

/** 题材套件铺出的整套骨架 */
function skeletonOf(p: Project, kit: Kit, core: string, beats: string[], variant: number): Record<LabKey, LabValue> {
  const ctx = coreCtx(p, kit)
  const hero = kit.roles.hero
  const mainLine = mainLineOf(p, beats, ctx)
  const ranges = projectPhases(p)
  const paywalls = paywallsOf(p)
  const tones = p.tones.length ? p.tones.join('、') : '爽感、反转'
  const viewpoint = p.work.architecture?.viewpoint ?? '第三人称 · 跟随主角'
  const chars = estimateChars(p.spec.episodeSeconds)
  const synopsis = [
    `${fill(kit.opening, ctx)}。`,
    `${mainLine[1]?.content ?? ''}。`,
    `到了${rangeLabel(ranges[Math.min(2, ranges.length - 1)])}，${mainLine[2]?.content ?? ''}。`,
    `${fill(kit.ending, ctx)}。`,
  ]
  return {
    core: { text: core },
    synopsis: { text: (variant === 1 ? synopsis.slice(1) : synopsis).join('') },
    background: { text: `${fill(kit.grudge, ctx)}，${ctx.hero}对此一无所知。${fill(kit.opening, ctx)}——走投无路之际，${kit.prop}成了唯一的依仗。` },
    world: { text: [`${kit.world}。`, `核心秘密：${fill(kit.secret, ctx)}`, `主要场景：${kit.places.map((pl) => pl.zh).join('、')}`].join('\n') },
    goldenFinger: { text: [`金手指：${kit.prop}——${ctx.hero}唯一的依仗，也是「${kit.identity}」身份的钥匙`, `核心卖点：${clip(core, 60)}`, `爽点公式：${kit.formula}`].join('\n') },
    hero: { text: `${ctx.hero}：${fill(hero.profile, ctx)}。想要${fill(hero.desire, ctx)}，最大的缺陷是${fill(hero.flaw, ctx)}。弧光：${hero.arc}。` },
    rhythm: { text: '', beats: mainLine, paywalls },
    style: {
      text: [
        `风格：${tones}`,
        `视角：${viewpoint}——${viewpointRule(viewpoint)}`,
        `篇幅：每集 ${p.spec.episodeSeconds} 秒（约 ${chars} 字），开场 5 秒内出现冲突或悬念`,
        '台词：口语化，单句不超过 25 字；少用“仿佛、不禁、嘴角勾起”等 AI 味词',
        '钩子：每集结尾留钩子，同一种钩子不连续出现；付费卡点卡在情绪最高处',
      ].join('\n'),
    },
  }
}

/** 起点文字整理成核心设定：太短时用题材套件补上困境与反常规点 */
function coreFrom(seedText: string, fallback: string, kit: Kit, p: Project) {
  const text = seedText.trim().replace(/[。.]$/, '')
  if (!text) return fallback
  if (text.length >= 30) return `${text}。`
  return `${text}——${fill(kit.secret, coreCtx(p, kit))}。`
}

/** 从起点生成 1 版或 3 版骨架 */
export function labSkeletons(p: Project, seedText: string, count: 1 | 3, seed: number): LabSkeleton[] {
  const kit = kitOf(p)
  const r = rng(hash(p.id) + seed)
  const other = pick(r, otherKits(kit))
  const [first, second] = shuffle(r, kit.loglines)
  const worldOf = (k: Kit) => k.world.split('：')[0]
  const all: LabSkeleton[] = [
    { id: newId(), title: '按你的起点展开', pitch: `沿着起点铺开，题材保持「${kit.label}」，爽点：${kit.formula.split('，')[0]}`, values: skeletonOf(p, kit, coreFrom(seedText, first, kit, p), BEATS, 0) },
    {
      id: newId(),
      title: '开局即反击',
      pitch: '同一个起点，第一集当晚就反将一军，后面层层揭开更大的局',
      values: skeletonOf(p, kit, coreFrom(seedText, second, kit, p).replace(/。$/, `，而这一次，${coreCtx(p, kit).hero}第一晚就出手了。`), STRIKE_BEATS, 1),
    },
    {
      id: newId(),
      title: '题材迁移',
      pitch: `把起点搬到「${worldOf(other)}」，爽点改为${other.formula.split('，')[0]}`,
      values: skeletonOf(p, other, coreFrom(seedText, pick(r, other.loglines), other, p), IRONY_BEATS, 2),
    },
  ]
  return count === 1 ? [all[seed % 2 === 0 ? 0 : 1]] : all
}

/** 每项的备选写法：按意见重写时轮换，保证每次结果不同 */
function altText(p: Project, key: LabKey, seed: number): LabValue {
  const kit = kitOf(p)
  const skel = skeletonOf(p, kit, p.logline || kit.loglines[seed % kit.loglines.length], BEAT_SETS[seed % BEAT_SETS.length], seed)
  return skel[key]
}

export interface LabRewrite {
  value: LabValue
  /** 改了什么、哪些已定的项保持不动、有没有冲突 */
  notes: string[]
}

/** 按修改意见只重写这一项；locked 是已定的项，不能被改动 */
export function labRewrite(p: Project, key: LabKey, current: LabValue, comment: string, locked: Partial<Record<LabKey, string>>, seed: number): LabRewrite {
  const ask = comment.trim()
  const notes: string[] = []
  const lockedKeys = (Object.keys(locked) as LabKey[]).filter((k) => k !== key)
  let value: LabValue
  if (key === 'rhythm') {
    const base = altText(p, 'rhythm', seed)
    value = { text: ask ? `按意见调整：${ask}` : '', beats: base.beats, paywalls: current.paywalls ?? base.paywalls }
    notes.push('付费卡点位置保持不变，只重写各段剧情')
  } else if (key === 'core' && ask) {
    value = { text: `${current.text.replace(/。$/, '')}，${ask.replace(/[。.]$/, '')}。` }
  } else {
    const alt = altText(p, key, seed).text
    value = { text: ask ? `${alt}\n按意见调整：${ask}` : alt }
  }
  if (ask) notes.push(`已按意见改写：「${clip(ask, 30)}」`)
  else notes.push('没有填写意见，换了一种写法')

  // 意见里提到已定的项：已定的项不动，提示重新打开那一项
  for (const k of lockedKeys) {
    if (ask.includes(LAB_META[k].title.split(' ')[0])) notes.push(`意见里提到已定的「${LAB_META[k].title}」：它保持不变；要改的话请先重新打开那一项`)
  }
  // 仿写：不能出现对标剧的人物名
  const names = p.work.breakdown?.characters.map((c) => c.name).filter((n) => valueText(key, value).includes(n)) ?? []
  if (names.length) notes.push(`出现了对标剧人物名（${names.join('、')}），仿写需要换掉`)
  if (lockedKeys.length) notes.push(`已对照已定的 ${lockedKeys.length} 项（${lockedKeys.map((k) => LAB_META[k].title).join('、')}），这些内容没有改动`)
  return { value, notes }
}

/** 全部定完后的导出文本：核心设定直接输出那一段话 */
export function labExport(values: Partial<Record<LabKey, LabValue>>) {
  return LAB_ORDER.filter((k) => values[k])
    .map((k) => `【${LAB_META[k].title}】\n${valueText(k, values[k]!)}`)
    .join('\n\n')
}
