import clsx from 'clsx'
import { Info, TriangleAlert } from 'lucide-react'
import { BASIS_LABEL, TIERS, changedBasis, printOf } from '../../domain/basis'
import type { BasisKey, BasisRow } from '../../domain/basis'
import type { Project } from '../../domain/types'
import { useProjects } from '../../store/projects'

const TONE = { must: 'text-red-700', focus: 'text-brand-700', light: 'text-ink-500' } as const

/**
 * AI 按钮旁的 ⓘ：这一步按哪几项生成、各在哪一档（必须遵守 / 重点参考 / 不违背即可），依据里没有的用题材常识补什么。
 * 悬停或聚焦时展开；表的内容在 domain/basis.ts。
 */
export function BasisInfo({ title, row, align = 'left' }: { title: string; row: BasisRow; align?: 'left' | 'right' }) {
  return (
    <span className="group relative inline-flex">
      <button type="button" data-basis={title} aria-label={`${title}的生成依据`} className="rounded p-0.5 text-ink-400 hover:text-brand-600 focus:text-brand-600 focus:outline-none">
        <Info size={13} />
      </button>
      <span
        role="tooltip"
        className={clsx(
          'invisible absolute top-full z-40 mt-1 w-80 rounded-lg border border-line bg-white p-3 text-left text-xs leading-5 font-normal opacity-0 shadow-pop transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100',
          align === 'right' ? 'right-0' : 'left-0',
        )}
      >
        <span className="mb-1.5 block text-[13px] font-medium text-ink-900">{title} · 生成依据</span>
        {TIERS.filter((t) => row[t.key].length).map((t) => (
          <span key={t.key} className="mb-1 block">
            <span className={clsx('font-medium', TONE[t.key])}>{t.label}</span>
            <span className="text-ink-400">（{t.desc}）</span>
            <span className="block text-ink-700">{row[t.key].join('；')}</span>
          </span>
        ))}
        {row.fill && (
          <span className="mt-1.5 block border-t border-line pt-1.5 text-ink-500">
            依据里没有的，用题材常识补：{row.fill}（补的部分标「补充」）
          </span>
        )}
      </span>
    </span>
  )
}

/**
 * 依据已改：这份产物生成之后，它读过的依据又改了。不会自动重写，由编剧决定重新生成还是忽略。
 * deps 给了就按这份依据记指纹（忽略时用）；没记过指纹的（编剧自己写的、旧数据）不提醒。
 */
export function StaleNote({ project, printKey, deps, action }: { project: Project; printKey: string; deps: BasisKey[]; action: string }) {
  const patchWork = useProjects((s) => s.patchWork)
  const changed = changedBasis(project, printKey)
  if (!changed.length) return null
  return (
    <div data-stale={printKey} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <TriangleAlert size={12} className="shrink-0 text-amber-600" />
      <span>
        依据已改：<span className="font-medium">{changed.map((k) => BASIS_LABEL[k]).join('、')}</span>在生成之后改过。不会自动重写；要更新就{action}
      </span>
      <button type="button" className="ml-auto font-medium text-amber-800 hover:underline" onClick={() => patchWork(project.id, { prints: { ...project.work.prints, [printKey]: printOf(project, deps) } })}>
        忽略
      </button>
    </div>
  )
}
