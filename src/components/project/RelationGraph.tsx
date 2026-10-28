import clsx from 'clsx'
import { useState } from 'react'
import type { Character, CharacterRole, Relation } from '../../domain/types'
import { relationGroup } from '../../domain/work'
import type { RelationGroup } from '../../domain/work'

/** 连线配色：情感 / 亲属 / 敌对三色已过全组合色盲校验，同伴类用中性灰；每条线都直接标出关系类型，颜色不单独承担信息 */
export const RELATION_GROUPS: Record<RelationGroup, { label: string; color: string }> = {
  love: { label: '情感', color: '#e87ba4' },
  family: { label: '亲属', color: '#2a78d6' },
  hostile: { label: '敌对', color: '#d03b3b' },
  ally: { label: '同伴 / 其他', color: '#908da0' },
}

const ROLE_NODE: Record<CharacterRole, { fill: string; ring: string }> = {
  主角: { fill: '#f4f1ff', ring: '#7c5cff' },
  暧昧对象: { fill: '#fff1f2', ring: '#fb7185' },
  反派: { fill: '#fef2f2', ring: '#dc2626' },
  配角: { fill: '#f7f7fa', ring: '#c3c1cf' },
}

const ROLE_ORDER: CharacterRole[] = ['主角', '暧昧对象', '反派', '配角']

const W = 640
const H = 380
const R = 28

interface Node {
  c: Character
  x: number
  y: number
}

interface Edge {
  i: number
  r: Relation
  a: Node
  b: Node
  d: string
  lx: number
  ly: number
  color: string
}

/** 主角居中，其余人物按定位顺序排在椭圆上（从正上方顺时针） */
function layout(characters: Character[]): Node[] {
  const named = characters.filter((c) => c.name.trim())
  const sorted = [...named].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))
  const center = sorted.length >= 3 && sorted[0].role === '主角' ? sorted[0] : null
  const ring = center ? sorted.slice(1) : sorted
  const nodes: Node[] = center ? [{ c: center, x: W / 2, y: H / 2 }] : []
  if (ring.length <= 2 && !center) {
    ring.forEach((c, i) => nodes.push({ c, x: ring.length === 1 ? W / 2 : W / 2 + (i ? 130 : -130), y: H / 2 }))
    return nodes
  }
  const rx = W / 2 - 80
  const ry = H / 2 - 56
  ring.forEach((c, i) => {
    const t = -Math.PI / 2 + (i / ring.length) * Math.PI * 2
    nodes.push({ c, x: W / 2 + rx * Math.cos(t), y: H / 2 + ry * Math.sin(t) })
  })
  return nodes
}

/** 同一对人物有多条关系时弯成弧线错开 */
function edgesOf(nodes: Node[], relations: Relation[]): Edge[] {
  const byName = new Map(nodes.map((n) => [n.c.name, n]))
  const pairKey = (r: Relation) => [r.a, r.b].sort().join('|')
  const pairs = new Map<string, number[]>()
  relations.forEach((r, i) => {
    if (!byName.has(r.a) || !byName.has(r.b) || r.a === r.b) return
    pairs.set(pairKey(r), [...(pairs.get(pairKey(r)) ?? []), i])
  })
  const out: Edge[] = []
  for (const list of pairs.values()) {
    list.forEach((i, k) => {
      const r = relations[i]
      const a = byName.get(r.a)!
      const b = byName.get(r.b)!
      const offset = (k - (list.length - 1) / 2) * 34
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
      const cx = (a.x + b.x) / 2 + (-(b.y - a.y) / len) * offset
      const cy = (a.y + b.y) / 2 + ((b.x - a.x) / len) * offset
      out.push({
        i,
        r,
        a,
        b,
        d: `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`,
        lx: 0.25 * a.x + 0.5 * cx + 0.25 * b.x,
        ly: 0.25 * a.y + 0.5 * cy + 0.25 * b.y,
        color: RELATION_GROUPS[relationGroup(r.kind)].color,
      })
    })
  }
  return out
}

/** 标签宽度估算：中文按字宽，西文按半宽 */
const textWidth = (s: string, size: number) => [...s].reduce((w, ch) => w + (/[\x00-\xff]/.test(ch) ? size * 0.58 : size), 0)

const clipName = (s: string) => ([...s].length > 4 ? `${[...s].slice(0, 4).join('')}…` : s)

export function RelationLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-500">
      {(Object.keys(RELATION_GROUPS) as RelationGroup[]).map((g) => (
        <span key={g} className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full" style={{ background: RELATION_GROUPS[g].color }} />
          {RELATION_GROUPS[g].label}
        </span>
      ))}
      <span className="h-3 w-px bg-line" />
      {ROLE_ORDER.map((role) => (
        <span key={role} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full border-2" style={{ background: ROLE_NODE[role].fill, borderColor: ROLE_NODE[role].ring }} />
          {role}
        </span>
      ))}
    </div>
  )
}

export function RelationGraph({
  characters,
  relations,
  selectedId,
  onSelect,
}: {
  characters: Character[]
  relations: Relation[]
  selectedId?: string
  onSelect?: (id: string) => void
}) {
  const [hoverNode, setHoverNode] = useState<string | null>(null)
  const [hoverEdge, setHoverEdge] = useState<number | null>(null)
  const nodes = layout(characters)
  const edges = edgesOf(nodes, relations)
  const linked = (e: Edge) => !hoverNode || e.r.a === hoverNode || e.r.b === hoverNode
  const near = new Set(hoverNode ? [hoverNode, ...edges.filter(linked).flatMap((e) => [e.r.a, e.r.b])] : [])
  const tip = hoverEdge !== null ? edges.find((e) => e.i === hoverEdge) : undefined

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={`人物关系图：${nodes.length} 个人物，${edges.length} 条关系`}>
        {edges.map((e) => (
          <g key={e.i} className="transition-opacity" opacity={linked(e) && (hoverEdge === null || hoverEdge === e.i) ? 1 : 0.15}>
            <path d={e.d} fill="none" stroke={e.color} strokeWidth={hoverEdge === e.i ? 3 : 2} strokeLinecap="round" />
            {/* 加宽的透明命中区 */}
            <path d={e.d} fill="none" stroke="transparent" strokeWidth={16} onMouseEnter={() => setHoverEdge(e.i)} onMouseLeave={() => setHoverEdge(null)} />
          </g>
        ))}
        {edges.map((e) => {
          const text = e.r.kind.trim() || '未填'
          const w = textWidth(text, 11) + 14
          return (
            <g
              key={`l${e.i}`}
              transform={`translate(${e.lx} ${e.ly})`}
              className="cursor-default transition-opacity"
              opacity={linked(e) && (hoverEdge === null || hoverEdge === e.i) ? 1 : 0.15}
              onMouseEnter={() => setHoverEdge(e.i)}
              onMouseLeave={() => setHoverEdge(null)}
            >
              <rect x={-w / 2} y={-9} width={w} height={18} rx={9} fill="#fff" stroke={e.color} strokeWidth={1} />
              <text textAnchor="middle" dy="0.35em" fontSize={11} fill={e.r.kind.trim() ? '#3d3b47' : '#908da0'}>
                {text}
              </text>
            </g>
          )
        })}
        {nodes.map((n) => {
          const sel = n.c.id === selectedId
          const style = ROLE_NODE[n.c.role]
          return (
            <g
              key={n.c.id}
              transform={`translate(${n.x} ${n.y})`}
              tabIndex={onSelect ? 0 : undefined}
              role={onSelect ? 'button' : undefined}
              aria-label={`${n.c.role}：${n.c.name}`}
              className={clsx('transition-opacity outline-none', onSelect && 'cursor-pointer')}
              opacity={!hoverNode || near.has(n.c.name) ? 1 : 0.35}
              onMouseEnter={() => setHoverNode(n.c.name)}
              onMouseLeave={() => setHoverNode(null)}
              onFocus={() => setHoverNode(n.c.name)}
              onBlur={() => setHoverNode(null)}
              onClick={() => onSelect?.(n.c.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect?.(n.c.id)
                }
              }}
            >
              {sel && <circle r={R + 5} fill="none" stroke="#d7ccff" strokeWidth={3} />}
              <circle r={R} fill={style.fill} stroke={style.ring} strokeWidth={sel ? 3 : 2} />
              <text textAnchor="middle" dy="0.35em" fontSize={12} fontWeight={600} fill="#16151c">
                {clipName(n.c.name)}
              </text>
              {/* 白色描边垫底：穿过节点下方的连线不压字 */}
              <text textAnchor="middle" y={R + 15} fontSize={11} fill="#6b6878" stroke="#fff" strokeWidth={4} strokeLinejoin="round" paintOrder="stroke">
                {n.c.role}
              </text>
            </g>
          )
        })}
      </svg>
      {tip && (
        <div
          className="pointer-events-none absolute z-10 w-max max-w-64 -translate-x-1/2 -translate-y-[calc(100%+14px)] rounded-lg bg-ink-900 px-2.5 py-1.5 text-xs leading-5 text-white shadow-pop"
          style={{ left: `${(tip.lx / W) * 100}%`, top: `${(tip.ly / H) * 100}%` }}
        >
          <div className="font-medium">
            {tip.r.a} — {tip.r.b}：{tip.r.kind || '关系未填'}
          </div>
          {tip.r.label && <div className="text-white/75">{tip.r.label}</div>}
        </div>
      )}
    </div>
  )
}
