import { ArrowLeft, ArrowRight, CircleCheck, Lock, ShieldCheck } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { AiButton, latestProject, stagePath, useAiTask } from '../components/stage/StageKit'
import { Badge, buttonClass } from '../components/ui'
import { QA_CHECKS } from '../domain/pipeline'
import { preWriteCheck } from '../domain/state'
import type { Project, QaIssue } from '../domain/types'
import { draftLabel, draftsOf, finalCount, scriptOf } from '../domain/work'
import { useProjects } from '../store/projects'
import { toast } from '../store/toast'
import { draftPath, scriptStagePath } from '../pages/workspace/script/ops'
import { QaFixButton } from '../pages/workspace/script/QaFix'
import { writeDraft } from '../pages/workspace/script/write'

/** 正文页接力条：定稿之后直接接着写下一集；全部定稿后去质检交付 */
export function RelayBar({ project, ep }: { project: Project; ep: number }) {
  const navigate = useNavigate()
  const { running, run } = useAiTask()
  const w = project.work
  const total = project.spec.totalEpisodes
  const finals = finalCount(project)

  if (finals >= total) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3" data-v2="relay">
        <ShieldCheck size={18} className="shrink-0 text-emerald-600" />
        <span className="min-w-0 flex-1 text-[13px] text-emerald-900">
          全部 {total} 集已定稿：下一步是质检交付——七项检查跑一遍，处理完严重问题即可交付。
        </span>
        <Link to={stagePath(project, 'qa')} className={buttonClass('primary', 'sm')}>
          去质检交付
          <ArrowRight size={14} />
        </Link>
      </div>
    )
  }

  const next = ep + 1
  if (next > total || scriptOf(w, next)) return null
  const newest = draftsOf(w, next)[0]
  const block = newest ? null : preWriteCheck(project, next).find((c) => c.level === 'block')

  const write = async () => {
    const draft = await writeDraft(project.id, next, run)
    if (draft) navigate(draftPath(project, draft.id))
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-brand-200 bg-brand-50/60 px-4 py-3" data-v2="relay">
      <span className="min-w-0 flex-1 text-[13px]">
        <span className="font-medium text-ink-900">接着写第 {next} 集</span>
        <span className="text-ink-500">
          {newest
            ? ` —— 已有 ${draftLabel(newest)}，打开继续审稿与定稿`
            : block
              ? ` —— ${block.text}`
              : ' —— 写作前检查已通过：本集要点、伏笔与人物状态会注入下一集'}
        </span>
      </span>
      {newest ? (
        <Link to={draftPath(project, newest.id)} className={buttonClass('primary', 'sm')}>
          打开 {draftLabel(newest)}
          <ArrowRight size={14} />
        </Link>
      ) : block ? (
        <Link to={`${scriptStagePath(project)}?ep=${next}`} className={buttonClass('secondary', 'sm')}>
          <Lock size={13} />
          去分集蓝图处理
        </Link>
      ) : (
        <AiButton loading={running === 'write'} disabled={!!running} onClick={write}>
          写第 {next} 集
        </AiButton>
      )}
    </div>
  )
}

const LEVEL_LABEL: Record<QaIssue['level'], { label: string; tone: 'red' | 'amber' | 'gray' }> = {
  block: { label: '严重', tone: 'red' },
  warn: { label: '建议修改', tone: 'amber' },
  info: { label: '提示', tone: 'gray' },
}

export const qaBackPath = (p: Project, issue: QaIssue) => `${stagePath(p, 'qa')}?issue=${issue.id}`

/** 从质检「去改正文」过来：带上问题与建议，可让 AI 按问题修稿，改完一步回到原来那条问题 */
export function QaReturnBanner({ project, issue }: { project: Project; issue: QaIssue }) {
  const navigate = useNavigate()
  const patchWork = useProjects((s) => s.patchWork)
  const done = !!project.work.qa?.resolved.includes(issue.id)
  const fixed = !!project.work.qa?.fixed?.includes(issue.id)
  const level = LEVEL_LABEL[issue.level]

  const resolveAndBack = () => {
    const qa = latestProject(project.id)?.work.qa
    if (qa && !qa.resolved.includes(issue.id)) patchWork(project.id, { qa: { ...qa, resolved: [...qa.resolved, issue.id] } })
    toast('已标记处理，回到质检')
    navigate(qaBackPath(project, issue))
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3" data-v2="qa-return">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-amber-700">来自质检</span>
        <Badge tone={level.tone}>{level.label}</Badge>
        <Badge tone="gray">{QA_CHECKS.find((c) => c.key === issue.check)?.label}</Badge>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink-900">{issue.title}</span>
      </div>
      <p className="mt-1.5 text-xs leading-5 text-ink-700">
        <span className="font-medium text-ink-900">建议：</span>
        {issue.suggestion}
        {issue.lineId && <span className="text-ink-500">（问题行已在下方高亮）</span>}
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {done ? (
          <span className="flex items-center gap-1 text-xs text-emerald-700">
            <CircleCheck size={13} />
            {fixed ? 'AI 已修稿，重新质检后确认' : '已标记处理'}
          </span>
        ) : (
          <>
            <QaFixButton project={project} issue={issue} look="button" />
            <button type="button" onClick={resolveAndBack} className={buttonClass('primary', 'sm')}>
              <CircleCheck size={14} />
              标记已处理并返回质检
            </button>
          </>
        )}
        <Link to={qaBackPath(project, issue)} className={buttonClass(done ? 'primary' : 'ghost', 'sm')}>
          <ArrowLeft size={14} />
          返回质检
        </Link>
      </div>
    </div>
  )
}
