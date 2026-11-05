import clsx from 'clsx'
import type { Project } from '../domain/types'
import { EPISODE_STEPS, episodeSteps } from './flow'
import type { StepState } from './flow'

const DOT: Record<StepState, string> = {
  done: 'bg-emerald-500',
  skipped: 'bg-amber-400',
  current: 'bg-brand-500',
  todo: 'bg-ink-900/10',
}

const MARK: Record<StepState, string> = { done: ' ✓', skipped: '（未做）', current: '（进行中）', todo: '' }

/** 单集流程的紧凑版：5 个进度点，用在逐集蓝图的列表里（单集流程步骤条 11/5 标注 #90 全局删掉，只留这一版） */
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
