/**
 * 质检交付的本地模拟：对已定稿的正文章节做七项检查，输出能定位到行的问题清单与分项得分。
 * 接入大模型后，一致性与节奏判断交给模型，这里的规则检查仍可作为兜底。
 */
import { QA_CHECKS } from '../../domain/pipeline'
import { estimateChars, targetCurve } from '../../domain/rhythm'
import type { EpisodeScript, Project, QaCheckKey, QaCheckResult, QaIssue, QaReport } from '../../domain/types'
import { SCENE_RE, placeOf } from '../../domain/scriptFormat'
import { foreshadowKey, foreshadowName, hookOf, phaseNames, phaseOf, projectPhases, wordCount } from '../../domain/work'
import { AI_FILLERS } from './kits'
import { clip, hash } from './rng'

type Found = Omit<QaIssue, 'id'>

/** 情绪强点：揭秘、冲突、身体动作 */
const PEAK_RE = /真相|揭晓|原来|身份|背叛|跪|耳光|当众|打脸|反转|证据|对峙|摊牌|撕|离婚|签字|血|死|滚|闭嘴|求你/g
const REVEAL_RE = /真相|原来|揭晓|身份|竟然|才是|一直在骗/

/** 单集情绪强度估算（1–5）：强点词、感叹 / 问句密度与结尾钩子 */
export function intensityOf(s: EpisodeScript) {
  const text = s.lines.map((l) => l.zh).join('')
  const peaks = text.match(PEAK_RE)?.length ?? 0
  const marks = text.match(/[！？!?]/g)?.length ?? 0
  const hook = s.lines.some((l) => l.kind === 'hook') ? 0.5 : 0
  return Math.max(1, Math.min(5, 1.8 + Math.min(1.6, peaks * 0.25) + Math.min(1.2, marks * 0.1) + hook))
}

/** 创新点在正文里的检索词：「」里的内容，否则取冒号后的前 4 个字 */
function innovationKey(ours: string) {
  const quoted = ours.match(/「([^」]{2,})」/)?.[1]
  if (quoted) return quoted.replace(/\s/g, '').slice(0, 6)
  const tail = ours.split('：')[1]?.replace(/\s/g, '')
  return tail && tail.length >= 2 ? tail.slice(0, 4) : null
}

export interface InnovationLanding {
  id: string
  theirs: string
  ours: string
  /** 检索词；null 表示没法自动核对 */
  key: string | null
  /** 在哪几集的定稿里找到了 */
  eps: number[]
}

/** 创新点落地情况：逐条在已定稿正文里检索 */
export function innovationLanding(p: Project): InnovationLanding[] {
  const scripts = p.work.scripts.filter((s) => s.ep <= p.spec.totalEpisodes)
  const texts = scripts.map((s) => ({ ep: s.ep, text: s.lines.map((l) => l.zh).join('').replace(/\s/g, '') }))
  return (p.work.architecture?.innovations ?? [])
    .filter((x) => x.ours.trim())
    .map((x) => {
      const key = innovationKey(x.ours)
      return { id: x.id, theirs: x.theirs, ours: x.ours, key, eps: key ? texts.filter((t) => t.text.includes(key)).map((t) => t.ep).sort((a, b) => a - b) : [] }
    })
}

const ranges = (eps: number[]) => {
  const out: [number, number][] = []
  for (const ep of eps) {
    const last = out.at(-1)
    if (last && ep === last[1] + 1) last[1] = ep
    else out.push([ep, ep])
  }
  return out.map(([a, b]) => (a === b ? `第 ${a} 集` : `第 ${a}–${b} 集`)).join('、')
}

export function runQa(p: Project): Omit<QaReport, 'at' | 'resolved'> {
  const total = p.spec.totalEpisodes
  const scripts = p.work.scripts.filter((s) => s.ep <= total).sort((a, b) => a.ep - b.ep)
  const curve = targetCurve(p.rhythm, total)
  const target = estimateChars(p.spec.episodeSeconds)
  const known = new Set(p.work.characters.map((c) => c.name))
  const hero = p.work.characters.find((c) => c.role === '主角')?.name
  const benchNames = (p.work.breakdown?.characters ?? []).map((c) => c.name).filter((n) => n.length >= 2 && !known.has(n))
  const found: Found[] = []
  const add = (f: Found) => found.push(f)

  const collapsed: number[] = []
  const paywallChecked: number[] = []

  for (const s of scripts) {
    const { ep, lines } = s
    const flat = lines.map((l) => l.zh).join('').replace(/\s/g, '')

    /* 格式合规 */
    const first = lines[0]
    if (first && first.kind !== 'scene') {
      add({ check: 'format', level: 'block', ep, lineId: first.id, title: '开场缺少场景标题', detail: `第一行是「${clip(first.zh, 16)}」，制作线无法据此排场`, suggestion: '在开头补一行场景标题：日 / 夜，内 / 外，地点，如「夜，内，宴会厅」' })
    }
    for (const l of lines.filter((x) => x.kind === 'scene' && !SCENE_RE.test(x.zh.trim()))) {
      add({ check: 'format', level: 'warn', ep, lineId: l.id, quote: l.zh.trim(), title: '场景标题格式不规范', detail: '缺少日 / 夜、内 / 外或地点，分场表无法自动生成', suggestion: '按「日，外，地点」书写，场次号「1-1」会自动编' })
    }
    if (!lines.some((l) => l.kind === 'hook')) {
      add({ check: 'format', level: 'block', ep, lineId: lines.at(-1)?.id ?? null, title: '结尾没有钩子', detail: '最后一行不是集末钩子，观众没有理由点下一集', suggestion: '用悬念、反转或半句话收尾，并标成「集末钩子」行' })
    }
    for (const l of lines.filter((x) => x.kind === 'dialogue' && !x.speaker?.trim())) {
      add({ check: 'format', level: 'block', ep, lineId: l.id, title: '台词缺少角色名', detail: `「${clip(l.zh, 14)}」没有标注是谁说的`, suggestion: '补上说话人' })
    }
    let fillers = 0
    for (const l of lines) {
      const w = AI_FILLERS.find((x) => l.zh.includes(x))
      if (!w || fillers >= 4) continue
      fillers++
      add({ check: 'format', level: 'warn', ep, lineId: l.id, quote: w, title: 'AI 味词汇', detail: `「${w}」读起来像模型腔，演员也很难演`, suggestion: '删掉，或换成具体的动作 / 表情' })
    }
    for (const l of lines.filter((x) => x.kind === 'dialogue' && x.zh.length > 30).slice(0, 2)) {
      add({ check: 'format', level: 'info', ep, lineId: l.id, title: '台词过长', detail: `这句 ${l.zh.length} 字，竖屏短剧单句建议 25 字以内`, suggestion: '拆成两句，或交给动作来表达' })
    }
    if (p.spec.language !== 'zh') {
      const untranslated = lines.filter((l) => l.kind === 'dialogue' && !l.en?.trim())
      if (untranslated.length) {
        add({ check: 'format', level: 'warn', ep, lineId: untranslated[0].id, title: '台词未翻译', detail: `${untranslated.length} 句台词还没有英文，交付包缺英文版`, suggestion: '在正文章节点「一键翻译」，再人工校对' })
      }
    }
    const words = wordCount(s)
    if (words < target * 0.7 || words > target * 1.3) {
      add({
        check: 'format',
        level: 'warn',
        ep,
        lineId: null,
        title: words < target ? '篇幅不足' : '篇幅超出单集时长',
        detail: `本集 ${words} 字，单集 ${p.spec.episodeSeconds} 秒约 ${target} 字`,
        suggestion: words < target ? '补一场戏或扩写动作描写' : '删减过场，或拆到下一集',
      })
    }

    /* 一致性终检 */
    if (known.size) {
      const seen = new Set<string>()
      for (const l of lines) {
        const name = l.kind === 'dialogue' ? l.speaker?.trim() : undefined
        if (!name || known.has(name) || seen.has(name)) continue
        seen.add(name)
        add({ check: 'character', level: 'warn', ep, lineId: l.id, quote: name, title: '人物未登记 / 称谓不统一', detail: `「${name}」不在人物设定里，可能是称谓前后不一致，或是没登记的新角色`, suggestion: '改成已登记的称谓，或到人物设定补登记' })
      }
      if (hero && !lines.some((l) => l.kind === 'dialogue' && l.speaker === hero)) {
        add({ check: 'character', level: 'info', ep, lineId: null, title: '主角本集没有台词', detail: `主角${hero}整集没有开口`, suggestion: '确认是否有意为之；短剧通常每集都要有主角的主动选择' })
      }
    }
    for (const name of benchNames) {
      const l = lines.find((x) => x.zh.includes(name) || x.speaker === name)
      if (l) add({ check: 'consistency', level: 'block', ep, lineId: l.id, quote: name, title: '仍出现对标剧人名', detail: `「${name}」是对标剧里的人物，仿写交付有侵权风险`, suggestion: '替换成本剧人物' })
    }
    for (const f of p.work.foreshadows) {
      const key = foreshadowKey(f)
      if (!key) continue
      for (const [kind, at] of [['埋设', f.plantEp], ['回收', f.payoffEp]] as const) {
        if (at === ep && !flat.includes(key)) {
          add({ check: 'consistency', level: 'warn', ep, lineId: null, title: `伏笔未${kind}`, detail: `计划本集${kind}「${foreshadowName(f)}」，正文里没找到`, suggestion: '回到草稿箱补写后重新定稿，或在伏笔计划里调整集数' })
        }
      }
    }

    /* 节奏曲线对比 */
    const actual = intensityOf(s)
    const goal = curve[ep - 1] ?? 3
    const gap = goal - actual
    if (gap > 1.2) {
      collapsed.push(ep)
      add({ check: 'rhythm', level: gap > 2 ? 'block' : 'warn', ep, lineId: null, title: '情绪低于目标曲线', detail: `目标强度 ${goal.toFixed(1)}，成稿约 ${actual.toFixed(1)}，这一集会显得平`, suggestion: '加一场正面冲突，或把揭秘 / 打脸提前到本集' })
    }
    if (p.rhythm.twists.includes(ep) && !REVEAL_RE.test(flat)) {
      add({ check: 'rhythm', level: 'warn', ep, lineId: null, title: '大反转不够明显', detail: '本集是节奏框架里的大反转集，正文里没有明确的揭秘或反转', suggestion: '让关键信息在本集当面揭开，并给出人物反应' })
    }

    /* 付费点专项 */
    if (p.rhythm.paywalls.includes(ep)) {
      paywallChecked.push(ep)
      const hook = [...lines].reverse().find((l) => l.kind === 'hook')
      if (!hook) {
        add({ check: 'paywall', level: 'block', ep, lineId: null, title: '付费卡点没有钩子', detail: '付费集结尾必须卡在情绪最高处', suggestion: '在揭晓 / 选择前一秒收尾' })
      } else if (hook.zh.trim().length < 8 || !/[？?！!…—]/.test(hook.zh)) {
        add({ check: 'paywall', level: 'warn', ep, lineId: hook.id, quote: hook.zh.trim(), title: '付费钩子不够力', detail: '钩子是陈述句，没有把观众卡住', suggestion: '改成问句或半句话，卡在答案揭晓之前' })
      }
      if (goal - actual > 0.8) {
        add({ check: 'paywall', level: 'warn', ep, lineId: null, title: '卡点没落在情绪波峰', detail: `目标强度 ${goal.toFixed(1)}，成稿约 ${actual.toFixed(1)}`, suggestion: '把本集最大的痛点 / 爽点挪到最后一场' })
      }
      const o = p.work.outline.find((x) => x.ep === ep)
      if (o && !o.approved) {
        add({ check: 'paywall', level: 'info', ep, lineId: null, title: '付费卡点集纲未审核', detail: '情节大纲里这一集的集纲还没单独审核', suggestion: '到情节大纲审核本集集纲' })
      }
    }
  }

  const phases = projectPhases(p)
  const names = phaseNames(p)
  const byEp = new Map(scripts.map((s) => [s.ep, s]))

  /* 角色一致性：跨集、跨阶段看主要人物 */
  const appears = (s: EpisodeScript, name: string) => s.lines.some((l) => (l.kind === 'dialogue' && l.speaker === name) || l.zh.includes(name))
  const firstLine = (s: EpisodeScript, name: string) => s.lines.find((l) => l.speaker === name || l.zh.includes(name))
  for (const c of p.work.characters.filter((x) => x.role !== '配角' && x.name.trim())) {
    const eps = scripts.filter((s) => appears(s, c.name)).map((s) => s.ep)
    phases.forEach(([a, b], i) => {
      const written = scripts.filter((s) => s.ep >= a && s.ep <= b)
      if (written.length >= 2 && !written.some((s) => appears(s, c.name))) {
        add({ check: 'character', level: c.role === '主角' ? 'block' : 'warn', ep: null, lineId: null, quote: c.name, title: '整段缺席', detail: `${c.role}${c.name}在「${names[i]}」（已定稿 ${written.length} 集）里一次都没出场`, suggestion: '确认人物去向，或在这一段安排一场戏交代' })
      }
    })
    for (let k = 1; k < eps.length; k++) {
      const gap = eps[k] - eps[k - 1] - 1
      if (gap < 8) continue
      const s = byEp.get(eps[k])!
      add({ check: 'character', level: 'info', ep: s.ep, lineId: firstLine(s, c.name)?.id ?? null, quote: c.name, title: '久未出场', detail: `${c.name}隔了 ${gap} 集才再次出场（上次在第 ${eps[k - 1]} 集）`, suggestion: '出场时用一句台词或动作交代这段时间的去向' })
    }
    // 状态记录：没出场却变了状态 = 突变；跨阶段始终不变 = 弧线停滞
    const changes = scripts.filter((s) => s.states[c.name]?.trim())
    for (const s of changes.filter((x) => !appears(x, c.name))) {
      add({ check: 'character', level: 'warn', ep: s.ep, lineId: null, title: '状态突变没有交代', detail: `本集把${c.name}的状态记为「${clip(s.states[c.name], 20)}」，但${c.name}本集没有出场`, suggestion: '补一场戏让状态变化可见，或修正这一集的人物状态' })
    }
    const spanned = new Set(eps.map((e) => phaseOf(e, phases)))
    if (eps.length >= 4 && spanned.size >= 2) {
      const lastChange = changes.at(-1)?.ep
      const lastPhase = phaseOf(eps.at(-1)!, phases)
      if (lastChange === undefined) {
        add({ check: 'character', level: 'info', ep: null, lineId: null, quote: c.name, title: '人物状态停滞', detail: `${c.name}已出场 ${eps.length} 集、跨 ${spanned.size} 个阶段，状态始终没有变化`, suggestion: '在阶段转折处安排一次成长、黑化或关系变化，并在定稿时记下人物状态' })
      } else if (lastPhase - phaseOf(lastChange, phases) >= 2) {
        add({ check: 'character', level: 'info', ep: null, lineId: null, quote: c.name, title: '人物状态停滞', detail: `${c.name}的状态自第 ${lastChange} 集（${names[phaseOf(lastChange, phases)]}）后再没变化，之后又过了 ${lastPhase - phaseOf(lastChange, phases)} 个阶段`, suggestion: '后面的阶段给这个人物一次新的转变' })
      }
    }
  }

  /* 故事流程：断档、钩子承接、场景单调、阶段情绪递进 */
  const lastEp = scripts.at(-1)?.ep ?? 0
  for (let ep = 1; ep < lastEp; ep++) {
    if (!byEp.has(ep)) add({ check: 'flow', level: 'block', ep, lineId: null, title: '剧情断档', detail: `第 ${ep} 集还没定稿，前后两集的剧情接不上`, suggestion: '先补写并定稿这一集' })
  }
  for (const s of scripts) {
    const prev = byEp.get(s.ep - 1)
    const prevHook = prev && hookOf(prev)
    if (!prevHook) continue
    const opening = s.lines.slice(0, 6).map((l) => l.zh).join('')
    if (!opening.includes(prevHook.slice(0, 8))) {
      add({ check: 'flow', level: 'warn', ep: s.ep, lineId: s.lines[0]?.id ?? null, title: '没承接上一集的钩子', detail: `上一集停在「${clip(prevHook, 20)}」，本集开场没有接住`, suggestion: '开场先回应上集的悬念，再推进新事件' })
    }
  }
  let run: { place: string; from: number; to: number } | null = null
  const flushRun = () => {
    if (run && run.to - run.from >= 3) {
      add({ check: 'flow', level: 'warn', ep: run.to, lineId: null, quote: run.place, title: '场景单调', detail: `第 ${run.from}–${run.to} 集的主场景都在「${run.place}」，节奏容易显得拖沓`, suggestion: '换一个场景推进冲突，或把部分戏挪到外景' })
    }
  }
  for (const s of scripts) {
    const heading = s.lines.find((l) => l.kind === 'scene')
    const place = heading ? placeOf(heading.zh) : ''
    if (run && place && place === run.place && s.ep === run.to + 1) run.to = s.ep
    else {
      flushRun()
      run = place ? { place, from: s.ep, to: s.ep } : null
    }
  }
  flushRun()
  const phaseAvg = phases.map(([a, b]) => {
    const list = scripts.filter((s) => s.ep >= a && s.ep <= b)
    return list.length ? list.reduce((n, s) => n + intensityOf(s), 0) / list.length : null
  })
  phaseAvg.forEach((avg, i) => {
    const prev = phaseAvg[i - 1]
    if (i === 0 || avg === null || prev == null || prev - avg < 0.8) return
    add({ check: 'flow', level: i === phases.length - 1 ? 'block' : 'warn', ep: null, lineId: null, title: '阶段情绪回落', detail: `「${names[i]}」平均强度约 ${avg.toFixed(1)}，比上一段「${names[i - 1]}」（${prev.toFixed(1)}）明显回落`, suggestion: i === phases.length - 1 ? '高潮段要比前面更强：把最大的揭秘与对决集中到这里' : '这一段开头加一次升级或新危机，别让剧情掉下来' })
  })

  /* 创新点落地：全剧层面 */
  const innovations = innovationLanding(p)
  const landed = innovations.filter((x) => x.eps.length).length
  for (const x of innovations) {
    if (!x.key) {
      add({ check: 'innovation', level: 'info', ep: null, lineId: null, title: '创新点需人工确认', detail: `「${clip(x.ours, 30)}」无法自动核对`, suggestion: '通读后确认是否落地' })
    } else if (!x.eps.length) {
      add({ check: 'innovation', level: 'warn', ep: null, lineId: null, quote: x.key, title: '创新点未落地', detail: `「${clip(x.ours, 30)}」在已定稿的 ${scripts.length} 集里没找到对应内容`, suggestion: '在后续集纲 / 蓝图里安排落地，或回到故事架构调整创新点' })
    }
  }
  if (!innovations.length) {
    add({ check: 'innovation', level: 'warn', ep: null, lineId: null, title: '没有创新点', detail: '故事架构里还没有创新点，无法核对与对标剧的差异', suggestion: '回到故事架构补充创新点' })
  }

  // 同一个问题重新质检时 id 不变，已处理的标记得以保留
  const used = new Set<string>()
  const issues: QaIssue[] = found.map((f) => {
    let id = `qa-${hash(`${f.check}|${f.ep}|${f.lineId}|${f.title}|${f.quote ?? ''}`).toString(36)}`
    while (used.has(id)) id += 'x'
    used.add(id)
    return { id, ...f }
  })

  const n = Math.max(scripts.length, 5)
  const checks: QaCheckResult[] = QA_CHECKS.map(({ key }) => {
    const list = issues.filter((i) => i.check === key)
    const count = (level: QaIssue['level']) => list.filter((i) => i.level === level).length
    const [block, warn, info] = [count('block'), count('warn'), count('info')]
    const penalty = key === 'innovation' ? block * 20 + warn * 12 + info * 3 : ((block * 15 + warn * 5 + info) * 8) / n
    const counts = [block && `${block} 个严重`, warn && `${warn} 个建议`, info && `${info} 个提示`].filter(Boolean).join('、')
    const extra: Record<QaCheckKey, string> = {
      consistency: `对照 ${p.work.foreshadows.length} 条伏笔与时间线`,
      character: `对照 ${p.work.characters.length} 个人物与 ${phases.length} 个阶段`,
      flow: `${scripts.length} 集的承接、场景与阶段递进`,
      rhythm: collapsed.length ? `塌陷段：${ranges(collapsed)}` : '与目标曲线基本一致',
      paywall: `检查了 ${paywallChecked.length} 个付费卡点`,
      innovation: `${landed}/${innovations.length} 条已落地`,
      format: `${scripts.length} 集场景、台词与钩子格式`,
    }
    return { key, score: Math.max(0, Math.round(100 - penalty)), summary: `${counts || '全部通过'} · ${extra[key]}` }
  })
  const score = Math.round(checks.reduce((sum, c, i) => sum + c.score * QA_CHECKS[i].weight, 0))

  return { versions: Object.fromEntries(scripts.map((s) => [s.ep, s.updatedAt])), score, checks, issues }
}
