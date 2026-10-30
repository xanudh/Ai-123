/**
 * AI 校对合并好的转写剧本（文本模型）：只查格式、人名写法和错别字，不改剧情与台词意思。
 * 演示版按规则模拟——偏离模板的写法、人名的同音变体、常见同音错字表；真实模型按上下文判断。
 */
import { EPISODE_LINE, cnToNumber, formatScene, parseDialogue, withCast } from '../../domain/scriptFormat'
import type { ProofItem } from '../../domain/types'

const TC = /\[\d{1,2}:\d{2}\]\s*/g
const HAS_TC = /\[\d{1,2}:\d{2}\]/
const SAID = /^△\s*(?:\[\d{1,2}:\d{2}\]\s*)?([^\s：:（(“”]{1,10}?)(?:（([^）]*)）)?说：“(.*)”$/
const SCENE_PROSE = /^△\s*(?:\[\d{1,2}:\d{2}\]\s*)?(?:镜头切到|画面切到|画面转到|场景切到)(.+)$/
const LOST = /^△\s*(?:\[\d{1,2}:\d{2}\]\s*)?(\S{1,10}?)和(\S{1,10}?)(?:争执|交谈|聊|吵|说)了几句/

/** 常见同音错字 */
const TYPOS: Record<string, string> = {
  项练: '项链',
  连盟: '联盟',
  伴旅: '伴侣',
  费物: '废物',
  竞然: '竟然',
  台记: '胎记',
  以经: '已经',
  必竟: '毕竟',
  跟本: '根本',
  在见: '再见',
  做为: '作为',
  象是: '像是',
  迫不急待: '迫不及待',
  一股作气: '一鼓作气',
}

/** 人名里常被听成同音字的字 */
const HOMO: Record<string, string[]> = {
  艾: ['爱', '埃'],
  凯: ['恺', '铠', '楷'],
  恩: ['嗯'],
  薇: ['微', '威'],
  卢: ['路', '芦'],
  马: ['玛', '码'],
  莉: ['丽', '俐'],
  娜: ['纳'],
  斯: ['丝', '思'],
  拉: ['啦'],
  库: ['酷'],
  卡: ['咖'],
  安: ['按'],
}

interface Block {
  ep: number
  lines: string[]
}

/** 集标题「第一集」「第1集」的集号 */
const episodeOf = (line: string) => {
  const m = EPISODE_LINE.exec(line.trim())
  return m ? cnToNumber(m[1]) : null
}

/** 按集标题切成各集 */
function blocks(text: string): Block[] {
  const out: Block[] = []
  for (const line of text.split('\n')) {
    const ep = episodeOf(line)
    if (ep !== null) out.push({ ep, lines: [] })
    else out.at(-1)?.lines.push(line)
  }
  return out
}

const count = (text: string, s: string) => text.split(s).length - 1

/** 一行按模板改写：去掉时间码、换场叙述改成场景标题（日，外，地点；场次号在整集重整时编）、「某某说：“……”」改成台词行 */
function fixLine(raw: string) {
  const said = SAID.exec(raw)
  if (said) return `${said[1]}：${said[2] ? `（${said[2]}）` : ''}${said[3]}`
  const scene = SCENE_PROSE.exec(raw)
  if (scene) return formatScene(scene[1].trim())
  return raw.replace(TC, '')
}

/** 按模板重整第 ep 集：逐行改写，被镜头切开的同一句台词接回去，场景标题按「集-场」编号并补「人物：」行 */
function reformat(lines: string[], ep: number) {
  const out: string[] = []
  let k = 0
  for (const raw of lines) {
    const line = fixLine(raw)
    const said = SAID.exec(raw)
    const prev = out.at(-1)
    if (said && !said[2] && prev?.startsWith(`${said[1]}：`) && /，$/.test(prev)) out[out.length - 1] = prev + said[3]
    else out.push(SCENE_PROSE.test(raw) ? `${ep}-${++k}：${line}` : line)
  }
  return withCast(out)
}

function templateItems(all: Block[]): ProofItem[] {
  const out: ProofItem[] = []
  for (const b of all) {
    const said = b.lines.filter((l) => SAID.test(l)).length
    const scene = b.lines.filter((l) => SCENE_PROSE.test(l)).length
    const tc = b.lines.filter((l) => HAS_TC.test(l)).length
    const lost = b.lines.filter((l) => LOST.test(l))
    if (!said && !scene && !tc && !lost.length) continue
    const changed = b.lines.filter((l) => fixLine(l) !== l)
    // 例句：台词、换场、其余各取一条
    const picks = [b.lines.find((l) => SAID.test(l)), b.lines.find((l) => SCENE_PROSE.test(l)), changed.find((l) => !SAID.test(l) && !SCENE_PROSE.test(l))].filter((l): l is string => !!l)
    out.push({
      id: `template:${b.ep}`,
      kind: 'template',
      ep: b.ep,
      // 格式已对、只剩被概括的台词：重整帮不上，只能重新转写
      text: changed.length ? `第 ${b.ep} 集没按模板输出` : `第 ${b.ep} 集有台词没转写全`,
      count: changed.length,
      eps: [b.ep],
      problems: [
        { label: '台词写成「某某说：“……”」，没有单独成行', count: said },
        { label: '换场写成叙述，没有场景标题', count: scene },
        { label: '正文里残留时间码', count: tc },
      ].filter((p) => p.count > 0),
      // 这集的换场都写成了叙述，例句取的第一处就是第 1 场
      samples: picks.map((l) => ({ before: l, after: SCENE_PROSE.test(l) ? `${b.ep}-1：${fixLine(l)}` : fixLine(l) })),
      ...(lost.length ? { lost: { count: lost.length, sample: lost[0].replace(TC, '').replace(/^△\s*/, '') } } : {}),
    })
  }
  return out
}

/** 例句：含 from 的前两行（人物行只是名单，不做例句），改后替换成 to */
function samplesOf(text: string, from: string, to: string) {
  return text
    .split('\n')
    .filter((l) => l.includes(from) && !/^人物：/.test(l))
    .slice(0, 2)
    .map((l) => ({ before: l.replace(TC, ''), after: l.replace(TC, '').split(from).join(to) }))
}

const epsOf = (all: Block[], s: string) => all.filter((b) => b.lines.some((l) => l.includes(s))).map((b) => b.ep)

/** 同一人物名字写法不一：台词行里出现过两次以上的人名，找它的同音变体 */
function nameItems(text: string, all: Block[]): ProofItem[] {
  const speakers = new Map<string, number>()
  for (const b of all) {
    for (const l of b.lines) {
      const who = parseDialogue(l)?.speaker ?? SAID.exec(l)?.[1]
      if (who) speakers.set(who, (speakers.get(who) ?? 0) + 1)
    }
  }
  const names = [...speakers].filter(([, n]) => n >= 2).sort((a, b) => count(text, b[0]) - count(text, a[0]))
  const seen = new Set<string>()
  const out: ProofItem[] = []
  for (const [name] of names) {
    if (seen.has(name)) continue
    for (let i = 0; i < name.length; i++) {
      for (const ch of HOMO[name[i]] ?? []) {
        const from = name.slice(0, i) + ch + name.slice(i + 1)
        const n = count(text, from)
        if (seen.has(from) || !n || n >= count(text, name)) continue
        seen.add(from)
        out.push({ id: `name:${from}`, kind: 'name', from, to: name, text: `「${from}」应为「${name}」`, count: n, eps: epsOf(all, from), samples: samplesOf(text, from, name) })
      }
    }
  }
  return out
}

function typoItems(text: string, all: Block[]): ProofItem[] {
  return Object.entries(TYPOS)
    .filter(([from]) => text.includes(from))
    .map(([from, to]) => ({ id: `typo:${from}`, kind: 'typo' as const, from, to, text: `「${from}」应为「${to}」`, count: count(text, from), eps: epsOf(all, from), samples: samplesOf(text, from, to) }))
}

/** 校对一部合并好的剧本：没按模板输出的集 → 人名 → 错别字 */
export function proofread(text: string): ProofItem[] {
  const all = blocks(text)
  return [...templateItems(all), ...nameItems(text, all), ...typoItems(text, all)]
}

/** 应用选中的校对：先按模板重整那几集，再统一人名、改错字 */
export function applyProofread(text: string, items: ProofItem[]) {
  const eps = new Set(items.filter((i) => i.kind === 'template' && i.count > 0).map((i) => i.ep))
  let ep = 0
  let buf: string[] = []
  const out: string[] = []
  const flush = () => {
    out.push(...(eps.has(ep) ? reformat(buf, ep) : buf))
    buf = []
  }
  for (const line of text.split('\n')) {
    const head = episodeOf(line)
    if (head !== null) {
      flush()
      ep = head
      out.push(line)
    } else buf.push(line)
  }
  flush()
  const fixed = items.filter((i) => i.kind !== 'template' && i.from && i.to).reduce((t, i) => t.split(i.from!).join(i.to!), out.join('\n'))
  // 人名统一后「人物：」行里可能出现两个同名，去重
  return fixed.replace(/^人物：(.+)$/gm, (_, names: string) => `人物：${[...new Set(names.split('，'))].join('，')}`)
}
