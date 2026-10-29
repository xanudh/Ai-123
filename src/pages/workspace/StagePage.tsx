import { ArrowLeft, ArrowRight, Lock, MessageSquareQuote, Package } from 'lucide-react'
import { Link, Navigate, useParams } from 'react-router'
import { useV2 } from '../../store/uiVersion'
import { StageHeadV2 } from '../../v2/StageHead'
import { GateNotice, stagePath } from '../../components/stage/StageKit'
import { Badge, Button, Card, CardHeader } from '../../components/ui'
import { MODE_STAGES, QA_CHECKS, STAGES } from '../../domain/pipeline'
import type { StageMeta } from '../../domain/pipeline'
import type { Project, StageKey } from '../../domain/types'
import { stageGate } from '../../domain/work'
import { useCurrentProject } from './ProjectLayout'
import ArchitectureStage from './stages/ArchitectureStage'
import BreakdownStage from './stages/BreakdownStage'
import CharactersStage from './stages/CharactersStage'
import ForeshadowStage from './stages/ForeshadowStage'
import OutlineStage from './stages/OutlineStage'
import QaStage from './stages/QaStage'
import ScriptStage from './stages/ScriptStage'
import VideoStage from './stages/VideoStage'

function QaPreview() {
  return (
    <ul className="divide-y divide-line">
      {QA_CHECKS.map((c, i) => (
        <li key={c.label} className="flex items-start gap-4 px-5 py-3.5">
          <span className="mt-0.5 text-xs text-ink-400 tabular-nums">{i + 1}</span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium">{c.label}</div>
            <div className="mt-0.5 text-xs text-ink-500">{c.desc}</div>
          </div>
          <Badge tone="gray">待运行</Badge>
        </li>
      ))}
    </ul>
  )
}

/** 还没开放的环节：说明 + 需求评审补充 + 产出结构预览 */
function LockedStage({ meta }: { meta: StageMeta }) {
  return (
    <>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-6 px-6 py-5">
          <div className="min-w-0 flex-1">
            <p className="max-w-2xl text-[13px] leading-6 text-ink-700">{meta.summary}</p>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <Package size={13} className="text-ink-400" />
              <span className="mr-1 text-xs text-ink-500">产出</span>
              {meta.deliverables.map((d) => (
                <Badge key={d} tone="violet">
                  {d}
                </Badge>
              ))}
            </div>
          </div>
          <div className="w-full rounded-xl border border-dashed border-line bg-canvas/60 p-4 sm:w-64">
            <div className="flex items-center gap-1.5 text-[13px] font-medium">
              <Lock size={13} className="text-ink-400" />
              {meta.phase === '后续规划' ? '已列入后续规划' : `将在${meta.phase}开放`}
            </div>
            <p className="mt-1 text-xs leading-5 text-ink-500">当前演示版暂不开放本环节，项目设定会作为本环节的输入保留。</p>
            <Button className="mt-3 w-full" disabled>
              开始{meta.label}
            </Button>
          </div>
        </div>
      </Card>

      {meta.notes && (
        <Card>
          <CardHeader title={<span className="flex items-center gap-1.5"><MessageSquareQuote size={15} className="text-brand-500" />需求评审补充</span>} />
          <ul className="space-y-2 px-5 py-4">
            {meta.notes.map((n) => (
              <li key={n} className="flex gap-2.5 text-[13px] leading-6 text-ink-700">
                <span className="mt-2.5 size-1 shrink-0 rounded-full bg-ink-400" />
                {n}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="overflow-hidden">
        <CardHeader title="产出结构预览" desc="字段结构取自需求文档；灰色占位将在上线后由 AI 生成" />
        <QaPreview />
      </Card>
    </>
  )
}

function StageBody({ stage, project }: { stage: StageKey; project: Project }) {
  const gate = stageGate(project, stage)
  const blocked = !!gate
  const body = (() => {
    switch (stage) {
      case 'video':
        return <VideoStage project={project} />
      case 'breakdown':
        return <BreakdownStage project={project} />
      case 'architecture':
        return <ArchitectureStage project={project} blocked={blocked} />
      case 'characters':
        return <CharactersStage project={project} blocked={blocked} />
      case 'foreshadow':
        return <ForeshadowStage project={project} blocked={blocked} />
      case 'outline':
        return <OutlineStage project={project} blocked={blocked} />
      case 'script':
        return <ScriptStage project={project} blocked={blocked} />
      case 'qa':
        return <QaStage project={project} blocked={blocked} />
      default:
        return null
    }
  })()
  return (
    <>
      {gate && <GateNotice project={project} gate={gate} />}
      {body}
    </>
  )
}

function StageHead({ meta, index }: { meta: StageMeta; index: number }) {
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          {/* 需求文档里的出处（如「第五步 · 逐集剧本生成」）编号与这里的步数不一致，只放在悬停提示里 */}
          <div className="text-xs text-ink-500 tabular-nums" title={`需求文档：${meta.source}`}>
            第 {index + 1} 步
          </div>
          <h2 className="mt-1 flex items-center gap-2 text-lg font-semibold">
            {meta.label}
            {meta.phase && (
              <Badge tone="gray">
                <Lock size={10} />
                {meta.phase}
              </Badge>
            )}
          </h2>
        </div>
      </div>
      {!meta.phase && <p className="-mt-2 max-w-3xl text-[13px] leading-6 text-ink-500">{meta.summary}</p>}
    </>
  )
}

export default function StagePage() {
  const project = useCurrentProject()
  const { stage } = useParams()
  const v2 = useV2()
  const stages = MODE_STAGES[project.mode]
  const index = stages.indexOf(stage as StageKey)

  // 不属于当前创作方式的环节回到概览
  if (index <= 0) return <Navigate to={`/projects/${project.id}`} replace />

  const meta = STAGES[stages[index]]
  const prev = STAGES[stages[index - 1]]
  const next = index < stages.length - 1 ? STAGES[stages[index + 1]] : null

  return (
    <div className="space-y-4">
      {v2 ? <StageHeadV2 project={project} meta={meta} index={index} next={next} /> : <StageHead meta={meta} index={index} />}

      {/* key：切换项目时重置各环节的本地状态 */}
      {meta.phase ? <LockedStage meta={meta} /> : <StageBody key={`${project.id}-${meta.key}`} stage={meta.key} project={project} />}

      <div className="flex items-center justify-between gap-3 pt-2">
        <Link to={stagePath(project, prev.key)} className="flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900">
          <ArrowLeft size={14} />
          {prev.label}
        </Link>
        {next && (
          <Link to={stagePath(project, next.key)} className="flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900">
            {next.label}
            <ArrowRight size={14} />
          </Link>
        )}
      </div>
    </div>
  )
}
