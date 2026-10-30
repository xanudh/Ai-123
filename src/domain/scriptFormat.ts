/**
 * 通用剧本格式（对齐《池塘通古代我成了西瓜仙人》样稿）。视频解析、AI 写作、编辑器、质检与导出都按这一套：
 *
 *   第一集
 *   1-1：日，外，余霍西瓜地
 *   人物：余霍，女搜查官
 *   △ 动作描写；镜头提示写在动作里，如 △【特写】、【快切】
 *   女搜查官：（严肃）你就是余霍？
 *   余霍os：内心独白　　母亲（ov）：画外音
 *
 * 场景标题只存「日，外，地点」，场次号「集-场」按出现顺序自动编，「人物：」行按这一场的台词与动作自动列出。
 */
import type { Character, Relation, ScriptLine, ScriptVoice } from './types'
import { plainText } from './work'

/* ---------------------------------- 场景标题 ---------------------------------- */

export interface SceneHead {
  /** 日 / 夜 / 晨 / 黄昏 */
  time: string
  /** 内 / 外 / 内外 */
  space: string
  place: string
}

export const SCENE_TIMES = ['日', '夜', '晨', '黄昏'] as const
export const SCENE_SPACES = ['内', '外', '内外'] as const

const TIME_ALIAS: Record<string, string> = { 白天: '日', 白日: '日', 清晨: '晨', 早晨: '晨', 晚上: '夜', 夜晚: '夜', 深夜: '夜', 傍晚: '黄昏' }
const TIME_RE = /^(日|夜|晨|黄昏|白天|白日|清晨|早晨|晚上|夜晚|深夜|傍晚)$/
const SPACE_RE = /^(内|外|室内|室外|内外|外内|内\s*[/／]\s*外|外\s*[/／]\s*内)$/
const timeOf = (w: string) => TIME_ALIAS[w] ?? w
const spaceOf = (w: string) => w.replace(/^室/, '').replace(/[\s/／]/g, '').length > 1 ? '内外' : w.replace(/^室/, '')

/** 场次号前缀「1-1：」 */
const SCENE_NO = /^\s*\d+\s*[-－—]\s*\d+\s*[：:]\s*/

/** 符合样稿的场景标题：日，外，地点 */
export const SCENE_RE = /^(日|夜|晨|黄昏)，(内|外|内外)，\S/

/** 读场景标题：样稿格式「日，外，地点」（可带「1-1：」场次号），也认旧格式「地点 日 外」「场景：地点（夜/内）」 */
export function parseScene(text: string): SceneHead {
  const t = text.replace(SCENE_NO, '').replace(/^场景\s*[：:]\s*/, '').trim()
  const parts = t.split(/\s*[，,]\s*/)
  if (parts.length >= 3 && TIME_RE.test(parts[0]) && SPACE_RE.test(parts[1])) {
    return { time: timeOf(parts[0]), space: spaceOf(parts[1]), place: parts.slice(2).join('，') }
  }
  const words = t.replace(/[（(]([^）)]*)[)）]/g, ' $1 ').split(/[\s，,、/／]+/).filter(Boolean)
  const tag = (w: string) => TIME_RE.test(w) || SPACE_RE.test(w)
  const time = words.find((w) => TIME_RE.test(w))
  const spaces = words.filter((w) => SPACE_RE.test(w))
  return { time: time ? timeOf(time) : '', space: spaces.length > 1 ? '内外' : spaces[0] ? spaceOf(spaces[0]) : '', place: words.filter((w) => !tag(w)).join(' ') }
}

export const sceneText = (h: SceneHead) => `${h.time}，${h.space}，${h.place}`

/** 场景标题改写成样稿格式；日夜或内外认不出来时只去掉场次号，留给审稿 / 质检提示 */
export function formatScene(text: string) {
  const h = parseScene(text)
  return h.time && h.space && h.place ? sceneText(h) : text.replace(SCENE_NO, '').replace(/^\s*场景\s*[：:]\s*/, '').trim()
}

/** 一行文字是不是场景标题：带「1-1：」场次号，或已是「日，外，地点」 */
export const isSceneHeading = (text: string) => SCENE_NO.test(text) || SCENE_RE.test(text.trim())

/** 场景标题里的地点 */
export const placeOf = (text: string) => parseScene(text).place || text.trim()

/** 每个场景标题的场次号「集-场」，按出现顺序编 */
export function sceneNumbers(ep: number, lines: ScriptLine[]) {
  const out = new Map<string, string>()
  let n = 0
  for (const l of lines) if (l.kind === 'scene') out.set(l.id, `${ep}-${++n}`)
  return out
}

/**
 * 第 at 行（场景标题）这一场的「人物：」——按出场先后列出说话的人与动作里写到的已登记人物。
 * 画外音（ov）的人不在场，不列；台词里提到的名字、动作里只以「某某的照片 / 资料」出现的名字也不算出场。
 */
export function sceneCast(lines: ScriptLine[], at: number, names: string[]) {
  const out: string[] = []
  const add = (name?: string) => {
    const v = name?.trim()
    if (v && !out.includes(v)) out.push(v)
  }
  for (let i = at + 1; i < lines.length && lines[i].kind !== 'scene'; i++) {
    const l = lines[i]
    if (l.kind === 'dialogue') {
      if (l.voice !== 'ov') add(l.speaker)
      continue
    }
    const text = plainText(l.zh)
    names
      .filter((n) => n && text.split(n).slice(1).some((after) => !after.startsWith('的')))
      .sort((a, b) => text.indexOf(a) - text.indexOf(b))
      .forEach(add)
  }
  return out
}

/* ---------------------------------- 台词 ---------------------------------- */

export const VOICE_LABEL: Record<ScriptVoice, string> = { os: '内心独白（os）', ov: '画外音（ov）' }

/** 说话人标注：余霍os / 母亲（ov） */
export function speakerLabel(l: Pick<ScriptLine, 'speaker' | 'voice'>) {
  const name = l.speaker?.trim() ?? ''
  return l.voice === 'os' ? `${name}os` : l.voice === 'ov' ? `${name}（ov）` : name
}

/** 读说话人标注：「余霍os」「余霍 os」「女经理Aos」「母亲（ov）」拆成名字与声音类型；VO 按画外音算 */
export function parseSpeaker(label: string): { speaker: string; voice?: ScriptVoice } {
  const t = label.trim()
  const m = /^(.+?)\s*[（(]\s*(os|ov|vo)\s*[)）]$/i.exec(t) ?? /^(.*[一-鿿][A-Za-z0-9]?)\s*(os|ov|vo)$/i.exec(t)
  if (!m) return { speaker: t }
  return { speaker: m[1].trim(), voice: m[2].toLowerCase() === 'os' ? 'os' : 'ov' }
}

/* ---------------------------------- 集 ---------------------------------- */

const CN_DIGITS = '零一二三四五六七八九'
const CN_VALUE: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }

/** 阿拉伯数字转中文（≤ 999）：12 → 十二、105 → 一百零五 */
export function cnNum(n: number): string {
  if (n < 10) return CN_DIGITS[n]
  if (n < 100) {
    const tens = Math.floor(n / 10)
    return `${tens === 1 ? '' : CN_DIGITS[tens]}十${n % 10 ? CN_DIGITS[n % 10] : ''}`
  }
  const rest = n % 100
  return `${CN_DIGITS[Math.floor(n / 100)]}百${rest === 0 ? '' : rest < 10 ? `零${CN_DIGITS[rest]}` : rest < 20 ? `一${cnNum(rest)}` : cnNum(rest)}`
}

/** 中文数字（≤ 999）或阿拉伯数字转成数值 */
export function cnToNumber(text: string) {
  if (/^\d+$/.test(text)) return Number(text)
  let total = 0
  let num = 0
  for (const ch of text) {
    if (ch in CN_VALUE) num = CN_VALUE[ch]
    else if (ch === '百') {
      total += (num || 1) * 100
      num = 0
    } else if (ch === '十') {
      total += (num || 1) * 10
      num = 0
    }
  }
  return total + num
}

/** 集标题：第一集 */
export const episodeHeading = (ep: number) => `第${cnNum(ep)}集`

/** 单独一行的集标题：第一集 / 第 12 集 */
export const EPISODE_LINE = /^第\s*([0-9零〇一二两三四五六七八九十百]+)\s*集$/

/* ---------------------------------- 人物小传 ---------------------------------- */

/** 小传标题里的定位：主角与感情线按性别写男主 / 女主，其余写反派 / 配角 */
export function roleTag(c: Character) {
  if (c.role !== '主角' && c.role !== '暧昧对象') return c.role
  return c.gender === '女' ? '女主' : c.gender === '男' ? '男主' : c.role
}

/** 补上句号；以引号收尾的（如 “好朋友”）要看引号前有没有句末标点 */
const sentence = (text: string) => {
  const t = text.trim()
  return t && (/[。！？…][”」]?$/.test(t) ? t : `${t}。`)
}

/**
 * 人物小传（样稿写法）：
 * 名字（男主）→ 一段小传（年龄、身份、性格、经历、能力、动机、缺陷、弧光）→ 人物关系 → 名字外形：→ 服装：→ 外形参考：
 */
export function characterBio(c: Character, relations: Relation[]) {
  const name = c.name.trim() || '未命名'
  const age = c.age.trim() && `${c.age.trim().replace(/岁$/, '')}岁`
  const personality = c.personality.trim() && (c.personality.trim().startsWith('性格') ? c.personality : `性格${c.personality.trim()}`)
  const motive = [c.goal.trim() && `表面追求：${c.goal.trim()}`, c.desire.trim() && `终极渴望：${c.desire.trim()}`, c.fear.trim() && `潜意识恐惧：${c.fear.trim()}`].filter(Boolean).join('；')
  const bio = [
    sentence([age, c.profile.trim()].filter(Boolean).join('，')),
    sentence(personality),
    sentence(c.background),
    c.ability.trim() && sentence(`能力：${c.ability.trim()}`),
    sentence(motive),
    c.flaw.trim() && sentence(`缺陷：${c.flaw.trim()}`),
    c.arc.trim() && sentence(`弧光：${c.arc.trim()}`),
  ].join('')
  const rel = relations
    .filter((r) => c.name && (r.a === c.name || r.b === c.name))
    .map((r) => `与${r.a === c.name ? r.b : r.a}${r.kind ? `（${r.kind}）` : ''}${r.label ? `：${r.label}` : ''}`)
    .join('；')
  return [
    `${name}（${roleTag(c)}）${c.nameEn.trim() ? ` ${c.nameEn.trim()}` : ''}`,
    bio,
    rel && `人物关系：${rel}`,
    c.notes.trim() && `备注：${c.notes.trim()}`,
    `${name}外形：${c.appearance.trim()}`,
    `服装：${c.costume.trim()}`,
    `外形参考：${c.lookRef.trim()}`,
  ]
    .filter(Boolean)
    .join('\n')
}

/** 交付包里的人物小传：主角、感情线、反派和写了外形的配角写完整小传，其余配角归到「其他配角」一句话带过 */
export function castBios(characters: Character[], relations: Relation[]) {
  const named = characters.filter((c) => c.name.trim())
  const minor = (c: Character) => c.role === '配角' && !c.appearance.trim()
  const others = named.filter(minor).map((c) => `${c.name.trim()}：${sentence(c.profile) || '—'}`)
  return [...named.filter((c) => !minor(c)).map((c) => characterBio(c, relations)), others.length ? ['其他配角', ...others].join('\n') : ''].filter(Boolean).join('\n')
}

/* ---------------------------------- 纯文本剧本 ---------------------------------- */

const NOT_SPEAKER = new Set(['人物', '场景', '场', '字幕', '旁白', '画外音', '镜头', '音效', '备注', '时间', '地点', 'OS', 'VO'])

/**
 * 读纯文本的一行台词：「艾拉：（脸色苍白）…」「余霍 os：…」「母亲（ov）：…」「艾拉（冷笑）：…」。
 * 不是台词（动作行、场景标题、人物行、字幕等）返回 null。
 */
export function parseDialogue(line: string): { speaker: string; voice?: ScriptVoice; text: string } | null {
  const t = line.trim()
  const m = /^([^：:△▲※【，。！？\n]{1,16}?)\s*[：:]\s*(.*)$/.exec(t)
  if (!m || isSceneHeading(t)) return null
  // 名字后面的（表演提示）不算名字
  const who = parseSpeaker(m[1].replace(/\s*[（(](?!\s*(?:os|ov|vo)\s*[)）])[^）)]*[）)]\s*$/i, ''))
  if (!who.speaker || /\s/.test(who.speaker) || who.speaker.length > 10 || NOT_SPEAKER.has(who.speaker.toUpperCase())) return null
  return { ...who, text: m[2] }
}

/** 纯文本台词行里在场的说话人；画外音（ov）不在场 */
export function textSpeaker(line: string) {
  const d = parseDialogue(line)
  return d && d.voice !== 'ov' ? d.speaker : null
}

/** 纯文本的一集（视频合并、转写重整用）补上「人物：」行：每个场次标题下按出场先后列出这一场说话的人；已经写了人物行的场不动 */
export function withCast(lines: string[]) {
  const out: string[] = []
  let at = -1
  let cast: string[] = []
  let has = false
  const flush = () => {
    if (at >= 0 && !has && cast.length) out.splice(at + 1, 0, `人物：${cast.join('，')}`)
  }
  for (const line of lines) {
    if (isSceneHeading(line)) {
      flush()
      out.push(line)
      at = out.length - 1
      cast = []
      has = false
      continue
    }
    if (/^人物\s*[：:]/.test(line.trim())) has = true
    out.push(line)
    const who = textSpeaker(line)
    if (who && !cast.includes(who)) cast.push(who)
  }
  flush()
  return out
}

/* ---------------------------------- 导出 ---------------------------------- */

/** 一行正文的样稿写法（场景标题的场次号与人物行见 episodeText）；集末钩子按动作行写 */
export function lineText(l: ScriptLine) {
  const text = plainText(l.zh)
  if (l.kind === 'dialogue') return `${speakerLabel(l)}：${text}`
  if (l.kind === 'hook') return text.startsWith('△') ? text : `△ ${text}`
  return text
}

/** 一集正文排成样稿格式的纯文本；names 是已登记的人物名（列人物行用），en 为真时每行下面附英文 */
export function episodeText(ep: number, lines: ScriptLine[], names: string[], en = false) {
  const no = sceneNumbers(ep, lines)
  const out = [episodeHeading(ep)]
  lines.forEach((l, i) => {
    if (l.kind === 'scene') {
      out.push(`${no.get(l.id)}：${plainText(l.zh)}`)
      const cast = sceneCast(lines, i, names)
      if (cast.length) out.push(`人物：${cast.join('，')}`)
    } else out.push(lineText(l))
    if (en && l.en) out.push(l.kind === 'dialogue' ? `${l.speakerEn || l.speaker || ''}: ${l.en}` : l.en)
  })
  return out.join('\n')
}
