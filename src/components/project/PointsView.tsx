/**
 * 本集要点：数据里存的是给 AI 读的 Markdown（# 标题、## 小节、- 列表、| 表格 |），
 * 前端按结构展示，不露出 Markdown 符号。手改过的要点也能显示，认不出的行当普通段落。
 */
import type { ReactNode } from 'react'

type Row = { kind: 'item'; tag: string; text: string } | { kind: 'pair'; k: string; v: string } | { kind: 'text'; text: string }
interface PointSection {
  title: string
  rows: Row[]
}

/** 去掉行内的 Markdown 记号：加粗、斜体、行内代码 */
const inline = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1').replace(/`(.+?)`/g, '$1').trim()

export function parsePoints(md: string): PointSection[] {
  const sections: PointSection[] = []
  let cur: PointSection | null = null
  const section = () => cur ?? (sections.push((cur = { title: '', rows: [] })), cur)
  for (const raw of md.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    // 一级标题（“第 N 集 要点”）在侧栏里多余
    if (/^#\s/.test(line)) continue
    const h = line.match(/^#{2,6}\s*(.+)$/)
    if (h) {
      sections.push((cur = { title: inline(h[1]), rows: [] }))
      continue
    }
    if (line.startsWith('|')) {
      const cells = line.replace(/^\||\|$/g, '').split('|').map((c) => inline(c))
      // 分隔行与表头
      if (cells.every((c) => /^:?-+:?$/.test(c)) || cells[0] === '角色') continue
      section().rows.push({ kind: 'pair', k: cells[0] ?? '', v: cells.slice(1).join(' · ') })
      continue
    }
    const li = line.match(/^(?:[-*+]|\d+[.)])\s+(.*)$/)
    if (li) {
      const tagged = li[1].match(/^\[([^\]]+)\]\s*(.*)$/)
      section().rows.push(tagged ? { kind: 'item', tag: inline(tagged[1]), text: inline(tagged[2]) } : { kind: 'item', tag: '', text: inline(li[1]) })
      continue
    }
    section().rows.push({ kind: 'text', text: inline(line) })
  }
  return sections.filter((s) => s.rows.length)
}

export function PointsView({ points }: { points: string }) {
  const sections = parsePoints(points)
  return (
    <div className="space-y-3 text-[12.5px] leading-5" data-points>
      {sections.map((s, i) => (
        <section key={i}>
          {s.title && <h4 className="mb-1 text-xs font-medium text-ink-400">{s.title}</h4>}
          <Rows rows={s.rows} />
        </section>
      ))}
    </div>
  )
}

function Rows({ rows }: { rows: Row[] }) {
  const out: ReactNode[] = []
  rows.forEach((r, i) => {
    if (r.kind === 'pair')
      out.push(
        <div key={i} className="flex gap-2">
          <span className="w-16 shrink-0 truncate font-medium text-ink-900" title={r.k}>
            {r.k}
          </span>
          <span className="min-w-0 flex-1 text-ink-700">{r.v}</span>
        </div>,
      )
    else if (r.kind === 'item')
      out.push(
        <div key={i} className="flex gap-1.5">
          {r.tag ? <span className="mt-px h-[18px] shrink-0 rounded bg-brand-50 px-1.5 text-[11px] leading-[18px] font-medium text-brand-700">{r.tag}</span> : <span className="mt-2 size-1 shrink-0 rounded-full bg-ink-300" />}
          <span className="min-w-0 flex-1 text-ink-700">{r.text}</span>
        </div>,
      )
    else
      out.push(
        <p key={i} className="text-ink-700">
          {r.text}
        </p>,
      )
  })
  return <div className="space-y-1">{out}</div>
}
