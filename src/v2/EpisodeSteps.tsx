import clsx from 'clsx'
import { Check, ChevronRight } from 'lucide-react'
import { Fragment } from 'react'
import { Link } from 'react-router'
import type { Project } from '../domain/types'
import { EPISODE_STEPS, episodeStepLinks, episodeSteps } from './flow'
import type { StepState } from './flow'

type EpisodeStep = (typeof EPISODE_STEPS)[number]

const DOT: Record<StepState, string> = {
  done: 'bg-emerald-500',
  skipped: 'bg-amber-400',
  current: 'bg-brand-500',
  todo: 'bg-ink-900/10',
}

const MARK: Record<StepState, string> = { done: ' ✓', skipped: '（未做）', current: '（进行中）', todo: '' }

/** 单集流程的紧凑版：5 个进度点，用在列表里 */
export function EpisodeDots({ project, ep }: { project: Project; ep: number }) {
  const steps = episodeSteps(project, ep)
  const current = steps.indexOf('current')
  return (
    <span className="flex items-center gap-0.5" aria-label={current < 0 ? '已定稿' : `当前：${EPISODE_STEPS[current]}`} title={EPISODE_STEPS.map((s, i) => s + MARK[steps[i]]).join(' → ')}>
      {steps.map((s, i) => (
        <span key={i} className={clsx('size-1.5 rounded-full', DOT[s])} />
      ))}
    </span>
  )
}

/**
 * 单集流程步骤条：集纲 → 蓝图 → 草稿 → 审稿 → 定稿。
 * 做过的步骤和进行中的步骤（有内容时）可以点，直接跳到对应页面；here 是当前页面所在的那一步，不再出链接。
 */
export function EpisodeSteps({ project, ep, here, className }: { project: Project; ep: number; here?: EpisodeStep; className?: string }) {
  const steps = episodeSteps(project, ep)
  const links = episodeStepLinks(project, ep)
  return (
    <ol className={clsx('flex items-center gap-1.5 text-[12px]', className)} aria-label={`第 ${ep} 集流程`}>
      {EPISODE_STEPS.map((label, i) => {
        const link = label === here || (steps[i] !== 'done' && steps[i] !== 'current') ? null : links[i]
        const tone = clsx(
          'flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5',
          steps[i] === 'done' && 'bg-emerald-50 text-emerald-700',
          steps[i] === 'skipped' && 'text-amber-700 outline-1 -outline-offset-1 outline-amber-300 outline-dashed',
          steps[i] === 'current' && 'bg-brand-50 font-medium text-brand-700 ring-1 ring-brand-300',
          steps[i] === 'todo' && 'text-ink-400',
          link && clsx('transition-colors hover:underline hover:underline-offset-2', steps[i] === 'current' ? 'hover:bg-brand-100' : 'hover:bg-emerald-100'),
          label === here && 'font-semibold',
        )
        const body = (
          <>
            {steps[i] === 'done' ? <Check size={11} strokeWidth={3} /> : <span className="text-[10px] tabular-nums">{i + 1}</span>}
            {label}
            {steps[i] === 'skipped' && <span className="text-[10px]">未做</span>}
            {link && <ChevronRight size={11} className="-mr-0.5 opacity-60" />}
          </>
        )
        const tip = steps[i] === 'skipped' ? `本集没有${label}，后面的步骤已经做过` : label === here ? '当前页面' : link?.tip
        return (
          <Fragment key={label}>
            {i > 0 && <span className={clsx('h-px w-4 shrink-0', steps[i - 1] === 'todo' || steps[i - 1] === 'current' ? 'bg-line' : 'bg-emerald-300')} />}
            <li aria-current={steps[i] === 'current' ? 'step' : undefined} title={tip} className={link ? 'shrink-0' : tone}>
              {link ? (
                <Link to={link.to} className={tone}>
                  {body}
                </Link>
              ) : (
                body
              )}
            </li>
          </Fragment>
        )
      })}
    </ol>
  )
}
