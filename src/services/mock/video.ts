/**
 * 视频转剧本的本地模拟。演示环境不访问外部链接、不读取视频内容：
 * 分集与转写内容取自示例剧，镜头切分、时间码、景别与转写时常见的格式问题按规则生成，结果可复现。
 */
import type { Shot, VideoEpisode, VideoJob } from '../../domain/types'
import { parseSource } from './breakdown'
import { hash, pick, rng } from './rng'
import type { Rng } from './rng'
import { SAMPLE_SCRIPT } from './sampleScript'

const SAMPLE = parseSource('', SAMPLE_SCRIPT).episodes

export const DEMO_SHOW = { title: 'The Alpha’s Regret', episodes: SAMPLE.length }

const HOSTS: [RegExp, string][] = [
  [/reelshort/i, 'ReelShort'],
  [/dramabox/i, 'DramaBox'],
  [/shortmax/i, 'ShortMax'],
  [/goodshort/i, 'GoodShort'],
  [/tiktok/i, 'TikTok'],
  [/flex\.?tv/i, 'FlexTV'],
]

export const platformOf = (url: string) => HOSTS.find(([re]) => re.test(url))?.[1] ?? ''

export function linkError(url: string) {
  if (!url.trim()) return '请粘贴对标剧的剧集页链接'
  if (!/^https?:\/\/[^\s/]+\.[^\s]+$/i.test(url.trim())) return '链接格式不对：需要以 http:// 或 https:// 开头的剧集页地址'
  return null
}

/* ---------------------------------- 镜头 ---------------------------------- */

/** 对白语速（字 / 秒） */
const SPEECH_RATE = 4.5

const SIZE_RULES: [RegExp, string][] = [
  [/项链|眼|手|泪|指|唇|狼牙|画像|瓶|印记|纹章|戒指|胎记|信/, '特写'],
  [/全族|众人|全场|狼群|营地|森林|边境|城墙|大会|满月|暴雨|结界|祭坛/, '全景'],
]

const SOUND_RULES: [RegExp, string][] = [
  [/雨/, '雨声'],
  [/哄笑/, '人群哄笑'],
  [/欢呼|哗然/, '人群骚动'],
  [/扑|击|撞|震飞|刺|打斗/, '打斗音效'],
  [/嚎/, '狼嚎'],
  [/屏息|心跳/, '心跳声'],
]

const round1 = (n: number) => Math.round(n * 10) / 10

const contentOf = (ep: number) => SAMPLE[(ep - 1) % SAMPLE.length].text.split('\n')

/** 转写时听错的人名与词（同音字）：演示里按规则混进转写稿，合并后由 AI 校对找出来 */
const NAME_SLIPS: Record<string, string> = { 艾拉: '爱拉', 凯恩: '恺恩', 薇薇安: '微微安', 卢卡斯: '路卡斯', 马库斯: '玛库斯', 莉娜: '丽娜' }
const WORD_SLIPS: Record<string, string> = { 项链: '项练', 联盟: '连盟', 伴侣: '伴旅', 废物: '费物', 竟然: '竞然', 胎记: '台记' }

/** 台词里听错一处：先人名、再词 */
function misheard(r: Rng, text: string) {
  let out = text
  const name = Object.keys(NAME_SLIPS).find((n) => out.includes(n))
  if (name && r() < 0.35) out = out.replace(name, NAME_SLIPS[name])
  const word = Object.keys(WORD_SLIPS).find((w) => out.includes(w))
  if (word && r() < 0.5) out = out.replace(word, WORD_SLIPS[word])
  return out
}

/** 转写时常见的问题：长台词被镜头切开、夹杂半角标点、人名和词听成同音字 */
function noisy(r: Rng, rawSpeaker: string, cue: string | undefined, rawText: string): Pick<Shot, 'speaker' | 'cue' | 'line'>[] {
  const speaker = NAME_SLIPS[rawSpeaker] && r() < 0.15 ? NAME_SLIPS[rawSpeaker] : rawSpeaker
  const text = misheard(r, rawText)
  const half = r() < 0.2 ? text.replace(/，/g, ',').replace(/？/g, '?').replace(/！/g, '!') : text
  const cut = half.search(/[，,]/)
  if (half.length >= 16 && cut > 3 && cut < half.length - 4 && r() < 0.35) {
    return [
      { speaker, cue, line: half.slice(0, cut + 1) },
      { speaker, line: half.slice(cut + 1) },
    ]
  }
  return [{ speaker, cue, line: half }]
}

const mmss = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`

/**
 * 没按模板输出的一集：时间码写进正文、台词写成「某某说：“……”」、换场写成一句叙述，
 * 还有两处来回的对白被概括成一句（按模板重整也补不回来，要重新转写）。
 */
function offTemplate(shots: Shot[]): Shot[] {
  const out: Shot[] = []
  let summed = 0
  let last = -99
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i]
    const at = `[${mmss(s.start)}] `
    const base = { start: s.start, end: s.end, size: s.size, ...(s.sound ? { sound: s.sound } : {}) }
    if (s.scene) out.push({ start: s.start, end: s.start, size: '全景', action: `${at}镜头切到${s.scene}` })
    const next = shots[i + 1]
    if (s.speaker && next?.speaker && next.speaker !== s.speaker && !next.scene && summed < 2 && i - last > 6) {
      out.push({ ...base, end: next.end, action: `${at}${s.speaker}和${next.speaker}争执了几句` })
      summed++
      last = i
      i++
      continue
    }
    if (s.speaker && s.line !== undefined) out.push({ ...base, action: `${at}${s.speaker}${s.cue ? `（${s.cue}）` : ''}说：“${s.line}”` })
    else out.push({ ...base, action: at + s.action })
  }
  return out
}

/** 这一集没按模板输出：结构化的台词一句也没有，台词都写进了画面描述 */
export const isOffTemplate = (shots: Shot[]) => shots.length > 0 && !shots.some((s) => s.speaker) && shots.some((s) => /说：“/.test(s.action))

/** 模拟视频解析模型偶尔不按模板输出：每个任务固定一集（不和会失败的那集重合）首次转写这样输出，重新转写即恢复 */
export function offTemplateOf(job: VideoJob, ep: VideoEpisode) {
  const n = job.episodes.length
  if (n < 3 || ep.attempts > 1) return false
  const fail = 1 + (hash(job.createdAt) % (n - 1))
  return job.episodes[(fail + Math.floor(n / 2)) % n].ep === ep.ep
}

/** 第 ep 集逐镜头转写：场景标题挂在换场后的第一个镜头上；off：这次没按模板输出 */
export function transcribe(ep: number, off = false): Shot[] {
  const r = rng(hash(`video-${ep}`))
  const shots: Shot[] = []
  let t = 0
  let scene: string | undefined
  const push = (shot: Omit<Shot, 'start' | 'end'>, seconds: number) => {
    shots.push({ ...shot, ...(scene ? { scene } : {}), start: round1(t), end: round1(t + seconds) })
    scene = undefined
    t += seconds
  }
  for (const raw of contentOf(ep)) {
    const head = /^场景[：:]\s*(.+)$/.exec(raw)
    if (head) {
      scene = head[1].trim()
      continue
    }
    const speech = /^([^\s：:（(△▲]{1,10})[：:]\s*(?:[（(]([^）)]*)[）)])?\s*(.+)$/.exec(raw)
    if (speech) {
      const [, speaker, cue, text] = speech
      for (const part of noisy(r, speaker, cue, text)) {
        const size = part.cue ? '近景' : pick(r, ['近景', '近景', '中景', '特写'])
        push({ size, action: part.cue ? `${speaker}，${part.cue}` : speaker, ...part }, Math.max(1.5, part.line!.length / SPEECH_RATE + 0.4))
      }
      continue
    }
    const action = raw.replace(/^[△▲※]\s*/, '')
    const size = SIZE_RULES.find(([re]) => re.test(action))?.[1] ?? pick(r, ['中景', '中景', '近景', '全景'])
    const sound = SOUND_RULES.find(([re]) => re.test(action))?.[1]
    push({ size, action, ...(sound ? { sound } : {}) }, Math.min(6, Math.max(2, action.length / 8 + 1.5)))
  }
  if (shots.length) shots[shots.length - 1].sound = '悬念音效 · 定格'
  return off ? offTemplate(shots) : shots
}

export const durationOf = (ep: number) => {
  const shots = transcribe(ep)
  return Math.ceil(shots[shots.length - 1]?.end ?? 0)
}

const newEpisode = (ep: number, paid: boolean, file?: string): VideoEpisode => ({
  ep,
  duration: durationOf(ep),
  paid,
  ...(file ? { file } : {}),
  status: 'queued',
  attempts: 0,
  shots: [],
})

/** 解析剧集页：返回全集列表（含付费集） */
export function resolveLink(url: string): Pick<VideoJob, 'platform' | 'episodes'> {
  const free = Math.ceil(SAMPLE.length / 5)
  return {
    platform: platformOf(url),
    episodes: SAMPLE.map((e) => newEpisode(e.ep, e.ep > free)),
  }
}

/** 从文件名识别集数：第3集 / EP03 / E3 / 03.mp4，识别不到按选择顺序补位 */
export function episodesFromFiles(names: string[]): VideoEpisode[] {
  const used = new Set<number>()
  const parsed = names.map((name) => {
    const m = /第\s*(\d+)\s*集|ep?\s*[._-]?\s*(\d+)|^(\d+)/i.exec(name.replace(/\.[^.]+$/, ''))
    const n = m ? Number(m[1] ?? m[2] ?? m[3]) : 0
    const ep = n > 0 && !used.has(n) ? n : 0
    if (ep) used.add(ep)
    return { name, ep }
  })
  let next = 1
  return parsed
    .map(({ name, ep }) => {
      if (ep) return { name, ep }
      while (used.has(next)) next++
      used.add(next)
      return { name, ep: next }
    })
    .sort((a, b) => a.ep - b.ep)
    .map(({ name, ep }) => newEpisode(ep, false, name))
}

/** 模拟一次失败：每个任务里固定有一集首次尝试失败，重试即可成功 */
export function failureOf(job: VideoJob, ep: VideoEpisode) {
  if (job.episodes.length < 3 || ep.attempts > 1) return null
  const target = job.episodes[1 + (hash(job.createdAt) % (job.episodes.length - 1))]
  if (target.ep !== ep.ep) return null
  return job.origin === 'link'
    ? { status: 'downloading' as const, error: '下载超时：平台返回 504，可重试' }
    : { status: 'compressing' as const, error: '音轨解码失败：文件可能不完整，可重试' }
}

/* ---------------------------------- 合并 ---------------------------------- */

const FULL_WIDTH: Record<string, string> = { ',': '，', '?': '？', '!': '！' }

/** 合并成整部剧本：按集排序、接回被镜头切开的台词、统一标点、去掉时间码与景别，输出标准剧本格式 */
export function mergeEpisodes(episodes: VideoEpisode[]) {
  let joined = 0
  let punct = 0
  let actions = 0
  let shotCount = 0
  const blocks = [...episodes]
    .sort((a, b) => a.ep - b.ep)
    .map((e) => {
      const lines = [`第${e.ep}集`]
      let prev: Shot | null = null
      for (const s of e.shots) {
        shotCount++
        if (s.scene) lines.push(`场景：${s.scene}`)
        if (s.speaker && s.line !== undefined) {
          let text = s.line.replace(/[,?!]/g, (ch) => FULL_WIDTH[ch])
          if (text !== s.line) punct++
          // 同一角色、上一句停在逗号上：是被镜头切开的同一句台词
          if (prev?.speaker === s.speaker && !s.scene && !s.cue && /[，,]$/.test(prev.line ?? '')) {
            joined++
            lines[lines.length - 1] += text
          } else {
            text = `${s.speaker}：${s.cue ? `（${s.cue}）` : ''}${text}`
            lines.push(text)
          }
        } else {
          actions++
          lines.push(`△ ${s.action}`)
        }
        prev = s
      }
      return lines.join('\n')
    })
  return {
    text: blocks.join('\n\n'),
    fixes: [
      { label: '去掉时间码与景别标注', count: shotCount },
      { label: '接回被镜头切开的台词', count: joined },
      { label: '半角标点改为中文标点', count: punct },
      { label: '动作描述统一为「△」行', count: actions },
    ],
  }
}
