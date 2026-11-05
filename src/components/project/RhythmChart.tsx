import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { nodeKind, targetCurve } from '../../domain/rhythm'
import type { NodeKind } from '../../domain/rhythm'
import type { RhythmFrame } from '../../domain/types'
import { Segmented } from '../ui'

const KIND_LABEL: Record<NodeKind, string> = {
  paywall: '付费卡点',
  twist: '大反转',
  climax: '结局高潮区',
  plain: '常规集',
}

const PAD = { top: 20, right: 12, bottom: 26, left: 30 }

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

/** 对标剧的对比线：拆解出的每集情绪强度与付费卡点；仿写按分段对位放到本项目的集数轴上，没给位置时按集数等比 */
export interface RhythmCompare {
  emotion: number[]
  paywalls: number[]
  /** 对标剧第 k 集落在本项目第几集（可以是小数）；null 表示那一段没对上，不画 */
  place?: (number | null)[]
  /** 本项目第 ep 集对位到对标剧的哪几集 */
  aligned?: number[][]
}

/**
 * 目标节奏曲线：单系列面积图 + 付费卡点（菱形）/ 大反转（圆点）标记 + 结局高潮灰带。
 * 支持十字准线悬停与表格视图；传入 onPick 时可点击集数编辑节点；传入 compare 时叠一条对标剧虚线。
 */
export function RhythmChart({
  rhythm,
  total,
  height = 220,
  onPick,
  showTableToggle = true,
  compare,
}: {
  rhythm: RhythmFrame
  total: number
  height?: number
  onPick?: (episode: number) => void
  showTableToggle?: boolean
  compare?: RhythmCompare
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const curve = useMemo(() => targetCurve(rhythm, total), [rhythm, total])

  const innerW = Math.max(width - PAD.left - PAD.right, 0)
  const innerH = height - PAD.top - PAD.bottom
  const x = (ep: number) => PAD.left + (total <= 1 ? innerW / 2 : ((ep - 1) / (total - 1)) * innerW)
  const y = (v: number) => PAD.top + (1 - (v - 1) / 4) * innerH

  const linePath = curve.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i + 1).toFixed(1)},${y(v).toFixed(1)}`).join('')
  // 对标剧第 k 集落在本项目的第几集（可以是小数）
  const benchN = compare?.emotion.length ?? 0
  const benchAt = (k: number) => (compare?.place ? compare.place[k - 1] : benchN <= 1 ? 1 : 1 + ((k - 1) / (benchN - 1)) * (total - 1))
  // 落在没对上的段里的点断开，不连线
  const benchPath =
    compare?.emotion
      .map((v, i) => {
        const at = benchAt(i + 1)
        if (at === null || at === undefined) return ''
        const prev = i > 0 ? benchAt(i) : null
        return `${prev === null || prev === undefined || i === 0 ? 'M' : 'L'}${x(at).toFixed(1)},${y(v).toFixed(1)}`
      })
      .join('') ?? ''
  // 悬停在本项目第 ep 集时，对应对标剧的第几集
  const benchOf = (ep: number) =>
    compare?.aligned ? (compare.aligned[ep - 1]?.[0] ?? 0) : benchN ? Math.min(benchN, Math.max(1, Math.round(((ep - 1) / Math.max(total - 1, 1)) * (benchN - 1)) + 1)) : 0
  const areaPath = `${linePath}L${x(total).toFixed(1)},${y(1)}L${x(1).toFixed(1)},${y(1)}Z`

  const xTicks = useMemo(() => {
    const step = total > 80 ? 20 : 10
    const ticks = [1]
    for (let t = step; t < total; t += step) ticks.push(t)
    if (total - ticks[ticks.length - 1] >= step / 2) ticks.push(total)
    return ticks
  }, [total])

  const episodeAt = (clientX: number, rect: DOMRect) => {
    const rel = (clientX - rect.left - PAD.left) / Math.max(innerW, 1)
    return Math.min(total, Math.max(1, Math.round(rel * (total - 1)) + 1))
  }

  const keyRows = useMemo(
    () =>
      Array.from({ length: total }, (_, i) => i + 1)
        .filter((ep) => nodeKind(ep, rhythm) === 'paywall' || nodeKind(ep, rhythm) === 'twist' || ep === rhythm.climaxFrom || ep === 1)
        .map((ep) => ({
          ep,
          kind: ep === 1 ? '开场钩子' : ep === rhythm.climaxFrom && nodeKind(ep, rhythm) === 'climax' ? '结局高潮起点' : KIND_LABEL[nodeKind(ep, rhythm)],
          isFirstPaywall: ep === rhythm.paywalls[0],
          value: curve[ep - 1],
        })),
    [total, rhythm, curve],
  )

  const hoverKind = hover ? nodeKind(hover, rhythm) : null

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-500">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full bg-curve" />
            目标情绪强度（1–5，示意）
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rotate-45 rounded-[2px] bg-paywall" />
            付费卡点
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-twist" />
            大反转
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-3 rounded-sm bg-ink-900/[0.07]" />
            结局高潮区
          </span>
          {compare && (
            <span className="flex items-center gap-1.5" data-bench-legend title={`对标剧 ${benchN} 集按比例摊到本项目 ${total} 集上`}>
              <span className="w-4 border-t-2 border-dashed border-ink-400" />
              对标剧（拆解的情绪强度）
              <span className="size-2 rotate-45 rounded-[2px] border border-ink-500 bg-white" />
              对标剧付费卡点
            </span>
          )}
        </div>
        {showTableToggle && (
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'chart', label: '曲线' },
              { value: 'table', label: '节奏框架表' },
            ]}
          />
        )}
      </div>

      {view === 'table' ? (
        <div className="overflow-hidden rounded-lg border border-line">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-canvas text-ink-500">
              <tr>
                <th className="px-3 py-2 font-medium">集数</th>
                <th className="px-3 py-2 font-medium">关键节点</th>
                <th className="px-3 py-2 text-right font-medium">目标强度</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {keyRows.map((r) => (
                <tr key={r.ep} className="border-t border-line">
                  <td className="px-3 py-2">第 {r.ep} 集</td>
                  <td className="px-3 py-2">
                    {r.kind}
                    {r.isFirstPaywall && <span className="ml-1.5 text-ink-500">（首付费）</span>}
                  </td>
                  <td className="px-3 py-2 text-right">{r.value.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={ref} className="relative select-none" style={{ height }}>
          {width > 0 && (
            <svg width={width} height={height} className="block overflow-visible" role="img" aria-label={`${total} 集目标节奏曲线`}>
              {/* 结局高潮区 */}
              <rect
                x={x(rhythm.climaxFrom) - (innerW / Math.max(total - 1, 1)) / 2}
                y={PAD.top}
                width={Math.max(x(total) - x(rhythm.climaxFrom) + innerW / Math.max(total - 1, 1) / 2, 0)}
                height={innerH}
                className="fill-ink-900/[0.05]"
              />
              <text x={x(total)} y={PAD.top - 7} textAnchor="end" className="fill-ink-500 text-[10px]">
                结局高潮
              </text>

              {/* 网格与 Y 轴 */}
              {[1, 2, 3, 4, 5].map((v) => (
                <g key={v}>
                  <line x1={PAD.left} x2={PAD.left + innerW} y1={y(v)} y2={y(v)} className="stroke-line" strokeWidth={1} />
                  <text x={PAD.left - 8} y={y(v)} dy="0.32em" textAnchor="end" className="fill-ink-400 text-[10px] tabular-nums">
                    {v}
                  </text>
                </g>
              ))}
              {xTicks.map((t) => (
                <text key={t} x={x(t)} y={height - 8} textAnchor="middle" className="fill-ink-400 text-[10px] tabular-nums">
                  {t}
                </text>
              ))}

              {compare && (
                <g data-bench-line>
                  <path d={benchPath} fill="none" className="stroke-ink-400" strokeWidth={1.5} strokeDasharray="4 3" strokeLinejoin="round" />
                  {compare.paywalls
                    .filter((k) => k >= 1 && k <= benchN && benchAt(k) != null)
                    .map((k) => {
                      const cx = x(benchAt(k)!)
                      const cy = y(compare.emotion[k - 1])
                      return <rect key={`bp${k}`} x={cx - 4} y={cy - 4} width={8} height={8} rx={1.5} transform={`rotate(45 ${cx} ${cy})`} className="fill-white stroke-ink-500" strokeWidth={1.5} />
                    })}
                </g>
              )}
              <path d={areaPath} className="fill-curve/10" />
              <path d={linePath} fill="none" className="stroke-curve" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

              {/* 十字准线 */}
              {hover && (
                <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} className="stroke-ink-400" strokeWidth={1} />
              )}

              {/* 节点标记：2px 表面色描边 */}
              {rhythm.twists.map((ep) =>
                ep <= total ? (
                  <circle key={`t${ep}`} cx={x(ep)} cy={y(curve[ep - 1])} r={5} className="fill-twist stroke-white" strokeWidth={2} />
                ) : null,
              )}
              {rhythm.paywalls.map((ep) =>
                ep <= total ? (
                  <rect
                    key={`p${ep}`}
                    x={x(ep) - 5}
                    y={y(curve[ep - 1]) - 5}
                    width={10}
                    height={10}
                    rx={2}
                    transform={`rotate(45 ${x(ep)} ${y(curve[ep - 1])})`}
                    className="fill-paywall stroke-white"
                    strokeWidth={2}
                  />
                ) : null,
              )}
              {rhythm.paywalls[0] !== undefined && rhythm.paywalls[0] <= total && (
                <text x={x(rhythm.paywalls[0])} y={y(curve[rhythm.paywalls[0] - 1]) - 12} textAnchor="middle" className="fill-ink-700 text-[10px] font-medium">
                  首付费
                </text>
              )}

              {hover && hoverKind === 'plain' && (
                <circle cx={x(hover)} cy={y(curve[hover - 1])} r={4} className="fill-curve stroke-white" strokeWidth={2} />
              )}

              {/* 悬停 / 点击热区 */}
              <rect
                x={PAD.left - 6}
                y={0}
                width={innerW + 12}
                height={height}
                fill="transparent"
                className={clsx(onPick && 'cursor-pointer')}
                onPointerMove={(e) => setHover(episodeAt(e.clientX, e.currentTarget.getBoundingClientRect()) )}
                onPointerLeave={() => setHover(null)}
                onClick={(e) => onPick?.(episodeAt(e.clientX, e.currentTarget.getBoundingClientRect()))}
              />
            </svg>
          )}

          {hover && width > 0 && (
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg border border-line/70 bg-white/55 px-3 py-2 text-xs shadow-sm"
              style={{
                left: Math.min(Math.max(x(hover), 80), width - 80),
                top: Math.max(y(curve[hover - 1]) - 74, 0),
              }}
            >
              <div className="font-semibold text-ink-900">第 {hover} 集</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-ink-500">
                <span className="tabular-nums">目标强度 {curve[hover - 1].toFixed(1)}</span>
                <span>·</span>
                <span>{hover === rhythm.paywalls[0] ? '首付费卡点' : KIND_LABEL[hoverKind!]}</span>
              </div>
              {compare && benchOf(hover) > 0 && (
                <div className="mt-0.5 text-ink-500 tabular-nums">
                  对标剧第 {benchOf(hover)} 集 · 强度 {compare.emotion[benchOf(hover) - 1]}
                  {compare.paywalls.includes(benchOf(hover)) && ' · 付费卡点'}
                </div>
              )}
              {onPick && <div className="mt-1 text-[11px] text-ink-400">点击切换该集节点</div>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
