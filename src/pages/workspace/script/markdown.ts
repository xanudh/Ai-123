/**
 * 正文编辑器的 Markdown 输入：行首快捷符切换段落样式，行内 **加粗** / *斜体* 直接记在文字里。
 * 剧本仍按段落（场景标题 / 动作 / 对白 / 集末钩子）存储，这里只做文字与段落样式之间的换算。
 */
import { EPISODE_LINE, formatScene, isSceneHeading, parseSpeaker } from '../../../domain/scriptFormat'
import type { ScriptLine, ScriptLineKind } from '../../../domain/types'
import { newId } from '../../../lib/id'

/** 编辑器工具栏与帮助里展示的快捷写法 */
export const MD_TIPS: { code: string; label: string }[] = [
  { code: '# ', label: '场景标题，写「日，外，地点」，场次号自动编' },
  { code: '△ 或 - ', label: '动作' },
  { code: '【特写】', label: '镜头提示，写在动作里，会高亮' },
  { code: '角色名：', label: '对白' },
  { code: '角色名os：', label: '内心独白' },
  { code: '角色名（ov）：', label: '画外音（人不在场）' },
  { code: '> ', label: '集末钩子' },
  { code: '**文字**', label: '加粗' },
  { code: '*文字*', label: '斜体' },
]

export interface InlineSeg {
  text: string
  bold?: boolean
  italic?: boolean
  /** 镜头提示【特写】【快切】：原样显示，只加高亮 */
  cue?: boolean
  /** 这段文字在原文里的起点，用来把点击位置换回原文光标 */
  at: number
}

/** 把一段原文拆成带样式的片段 */
export function parseInline(raw: string): InlineSeg[] {
  const out: InlineSeg[] = []
  const re = /\*\*(.+?)\*\*|\*(.+?)\*|【[^】\n]+】/g
  let last = 0
  for (let m = re.exec(raw); m; m = re.exec(raw)) {
    if (m.index > last) out.push({ text: raw.slice(last, m.index), at: last })
    if (m[1] !== undefined) out.push({ text: m[1], bold: true, at: m.index + 2 })
    else if (m[2] !== undefined) out.push({ text: m[2], italic: true, at: m.index + 1 })
    else out.push({ text: m[0], cue: true, at: m.index })
    last = m.index + m[0].length
  }
  if (last < raw.length) out.push({ text: raw.slice(last), at: last })
  return out
}

/** 段落里有要渲染的行内样式：加粗、斜体或镜头提示 */
export const hasInline = (raw: string) => /\*\*(.+?)\*\*|\*(.+?)\*|【[^】\n]+】/.test(raw)

/**
 * 行首快捷符：输入「# 」变场景标题，「> 」变集末钩子，「- 」变动作，
 * 「已登记的角色名：」变对白（「名字os：」「名字（ov）：」带上声音）；动作行开头的「△ 」不影响识别。没有命中返回 null。
 */
export function blockShortcut(text: string, names: string[]): Partial<ScriptLine> | null {
  // 动作行自带「△ 」，快捷符写在它后面也认
  const body = text.replace(/^△\s*/, '')
  const m = /^(#{1,3}|>|-)\s(.*)$/s.exec(body)
  if (m) {
    const rest = m[2]
    if (m[1].startsWith('#')) return { kind: 'scene', zh: formatScene(rest) }
    if (m[1] === '>') return { kind: 'hook', zh: rest }
    return { kind: 'action', zh: `△ ${rest}` }
  }
  const d = /^(.{1,12}?)[：:](.*)$/s.exec(body)
  const who = d && parseSpeaker(d[1])
  if (d && who && names.includes(who.speaker)) return { kind: 'dialogue', speaker: who.speaker, ...(who.voice && { voice: who.voice }), zh: d[2].trimStart() }
  return null
}

/**
 * 粘贴的多行文字：每行一段，按快捷符认出段落样式，其余按动作处理。
 * 样稿里的「1-1：日，外，地点」与旧写法「场景：地点 夜 内」认成场景标题（场次号去掉，展示时自动编）；「第一集」「人物：」行由系统生成，粘贴时跳过（返回 null）。
 */
export function parseBlock(text: string, names: string[]): ScriptLine | null {
  if (EPISODE_LINE.test(text) || /^人物\s*[：:]/.test(text)) return null
  if (isSceneHeading(text) || /^场景\s*[：:]/.test(text)) return { id: newId(), kind: 'scene', zh: formatScene(text) }
  const hit = blockShortcut(text, names)
  if (hit) return { id: newId(), kind: hit.kind ?? 'action', zh: hit.zh ?? '', ...(hit.speaker ? { speaker: hit.speaker } : {}), ...(hit.voice && { voice: hit.voice }) }
  return { id: newId(), kind: 'action', zh: text }
}

/** 工具栏切换段落样式时的文字处理：动作行补上「△ 」，离开动作时去掉 */
export function restyle(l: ScriptLine, kind: ScriptLineKind): Partial<ScriptLine> {
  const body = l.zh.replace(/^△\s*/, '')
  return {
    kind,
    zh: kind === 'action' ? `△ ${body}` : body,
    speaker: kind === 'dialogue' ? l.speaker || '' : undefined,
    en: undefined,
  }
}

/**
 * 给选中的文字加 / 去掉标记（** 或 *）。没有选中时在光标处插入一对标记。
 * 返回新文字与新的选区。
 */
export function toggleWrap(text: string, start: number, end: number, mark: '**' | '*') {
  const n = mark.length
  const sel = text.slice(start, end)
  // 选区本身带着标记
  if (sel.length >= n * 2 && sel.startsWith(mark) && sel.endsWith(mark) && !(mark === '*' && sel.startsWith('**'))) {
    const inner = sel.slice(n, -n)
    return { text: text.slice(0, start) + inner + text.slice(end), start, end: start + inner.length }
  }
  // 标记在选区两侧
  if (text.slice(start - n, start) === mark && text.slice(end, end + n) === mark && !(mark === '*' && text.slice(start - 2, start) === '**' && text.slice(end, end + 2) === '**')) {
    return { text: text.slice(0, start - n) + sel + text.slice(end + n), start: start - n, end: end - n }
  }
  return { text: text.slice(0, start) + mark + sel + mark + text.slice(end), start: start + n, end: end + n }
}
