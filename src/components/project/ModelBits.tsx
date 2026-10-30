import clsx from 'clsx'
import { AlertTriangle, Check, ChevronDown, Info } from 'lucide-react'
import { useState } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { DEFAULT_MODELS, MODEL_GROUPS, modelLabel, modelOf, modelsFor, projectGroups, withModel } from '../../domain/models'
import type { EpisodeDraft, ModelGroup, ModelId, Project } from '../../domain/types'
import { batchOf, useBatchRun } from '../../store/batchRun'
import type { BatchRun } from '../../store/batchRun'
import { useProjects } from '../../store/projects'
import { toast } from '../../store/toast'
import { Menu, Modal } from '../overlay'
import { AiButton, latestProject } from '../stage/StageKit'
import { Button } from '../ui'

type SplitProps = Pick<ComponentProps<typeof AiButton>, 'variant' | 'title' | 'loading' | 'disabled' | 'children'>

/**
 * AI 按钮 + ▾：直接点用项目的文本模型；点 ▾ 可以这次换一个模型，不改项目的选择。
 * onRun 收到 undefined 表示用项目的文本模型；tags 给某个模型加说明，off 写明点不了的原因。
 */
function ModelSplit({
  project,
  onRun,
  verb,
  header,
  note,
  tags,
  caretDisabled,
  variant = 'primary',
  title,
  loading,
  disabled,
  children,
}: SplitProps & {
  project: Project
  onRun: (model?: ModelId) => void
  verb: string
  header: string
  note: ReactNode
  tags?: (id: ModelId) => { tags?: string[]; off?: string }
  caretDisabled?: boolean
}) {
  const def = modelOf(project, 'text')
  return (
    <span className="inline-flex">
      <AiButton variant={variant} loading={loading} disabled={disabled} title={disabled ? title : `${title ? `${title}，` : ''}用 ${modelLabel(def)} ${verb}`} className="rounded-r-none" onClick={() => onRun()}>
        {children}
      </AiButton>
      <Menu
        header={header}
        note={<ModelNote>{note}</ModelNote>}
        items={modelsFor('text').map((m) => {
          const { tags: extra = [], off } = tags?.(m.id) ?? {}
          const all = [...(m.id === def ? ['项目默认'] : []), ...extra]
          return { label: all.length ? `${m.label}（${all.join('，')}）` : m.label, disabled: !!off, title: off, onSelect: () => onRun(m.id === def ? undefined : m.id) }
        })}
        trigger={(props) => (
          <Button
            {...props}
            variant={variant}
            size="caret"
            disabled={caretDisabled ?? (disabled || loading)}
            aria-label={`换个模型${verb}`}
            title={`默认用 ${modelLabel(def)} ${verb}，点开可以这次换个模型`}
            className={clsx('rounded-l-none', variant === 'primary' ? 'border-l border-white/30' : '-ml-px')}
          >
            <ChevronDown size={14} />
          </Button>
        )}
      />
    </span>
  )
}

/** 写作按钮 + ▾：这次换个模型写，不改项目的选择 */
export function WriteButton({ onWrite, ...props }: SplitProps & { project: Project; onWrite: (model?: ModelId) => void }) {
  return <ModelSplit {...props} onRun={onWrite} verb="写作" header="这次换个模型写" note="换模型写的这一版，文风可能和前几集不同，适合用来对比" />
}

/**
 * AI 审稿按钮 + ▾：这次换个模型审，看出写作模型自己的盲点。
 * 标出写这一版的模型；reviewed 是已经审过当前正文的模型：它们不重复审，别的模型还能再审一遍。
 */
export function ReviewButton({
  draft,
  reviewed,
  busy,
  onReview,
  ...props
}: Omit<SplitProps, 'disabled'> & { project: Project; draft: EpisodeDraft; reviewed: ModelId[]; busy: boolean; onReview: (model?: ModelId) => void }) {
  const def = modelOf(props.project, 'text')
  const done = new Set(reviewed)
  const writer = draft.model ? modelLabel(draft.model) : ''
  return (
    <ModelSplit
      {...props}
      onRun={onReview}
      verb="审稿"
      header="这次换个模型审"
      note={writer ? `这一版是 ${writer} 写的：换个模型审，更容易看出它自己看不出的问题` : '换个模型审，更容易看出写作模型自己看不出的问题'}
      tags={(id) => ({
        tags: [...(id === draft.model ? ['写这一版的'] : []), ...(done.has(id) ? ['已审过'] : [])],
        off: done.has(id) ? `${modelLabel(id)} 已经审过这一版正文，正文没改过不重复审` : undefined,
      })}
      disabled={busy || done.has(def)}
      caretDisabled={busy || modelsFor('text').every((m) => done.has(m.id))}
    />
  )
}

/** 模型菜单顶部的提示；warn：已经生成过内容，换模型会前后不一致 */
function ModelNote({ warn, children }: { warn?: boolean; children: ReactNode }) {
  const Icon = warn ? AlertTriangle : Info
  return (
    <p data-model-note className={clsx('flex gap-1.5 rounded-md px-2 py-1.5 text-xs leading-5', warn ? 'bg-amber-50 text-amber-800' : 'bg-canvas text-ink-500')}>
      <Icon size={13} className="mt-[3px] shrink-0" />
      <span>{children}</span>
    </p>
  )
}

/** 已经生成了多少：文本看写过的集（草稿或定稿），视频看转写完的集 */
function producedOf(project: Project, group: ModelGroup) {
  if (group === 'video') return project.work.video?.episodes.filter((e) => e.status === 'done').length ?? 0
  return new Set([...project.work.drafts.map((d) => d.ep), ...project.work.scripts.map((s) => s.ep)]).size
}

/**
 * 选一类模型：改了马上生效，只影响之后的生成，已生成的内容仍记着当时的模型；提示里可以撤销。
 * 批量写作进行中换文本模型先确认：本批仍用开写时的模型写完，或停止本批再换。
 */
export function ModelPicker({ project, group, size = 'sm', align = 'right' }: { project: Project; group: ModelGroup; size?: 'sm' | 'md'; align?: 'left' | 'right' }) {
  const updateProject = useProjects((s) => s.updateProject)
  const batch = useBatchRun((s) => (group === 'text' && s.run?.projectId === project.id ? s.run : null))
  // 批量写作进行中想换成的模型：弹窗确认
  const [asking, setAsking] = useState<ModelId | null>(null)
  const meta = MODEL_GROUPS.find((g) => g.key === group)!
  const value = modelOf(project, group)
  const produced = producedOf(project, group)
  // 生成过程中换模型，前后风格会不一致：选之前就在菜单顶部说清楚
  const note = batch
    ? `批量写作进行中（${batch.i}/${batch.n}）：本批用 ${modelLabel(batch.model)} 写完，换模型从下一次写作开始生效`
    : group === 'video'
      ? produced
        ? `已转写 ${produced} 集：中途换模型，前后集的转写格式、人名写法可能不一致`
        : '转写过程中切换模型，可能导致前后集的转写格式不一致'
      : produced
        ? `已写 ${produced} 集：剧本生成过程中切换模型，之后写的集可能和前面文风不一致`
        : '剧本生成过程中切换模型可能导致文风不一致，建议开写前选定'

  /** keep：批量写作进行中，本批仍用原模型写完 */
  const apply = (id: ModelId, keep?: BatchRun | null) => {
    const cur = latestProject(project.id)
    if (!cur) return
    const prev = modelOf(cur, group)
    if (id === prev) return
    updateProject(project.id, { models: withModel(cur, group, id) }, `${meta.label}模型改为 ${modelLabel(id)}`)
    const done = producedOf(cur, group)
    const rest = keep ? `；本批剩下的集仍用 ${modelLabel(keep.model)} 写完` : done ? `；已${group === 'video' ? '转写' : '写'}的 ${done} 集不变，注意前后是否一致` : ''
    toast(`之后的${group === 'video' ? '视频解析' : '文本生成'}改用 ${modelLabel(id)}${rest}`, 'success', {
      label: '撤销',
      run: () => {
        const now = latestProject(project.id)
        // 撤销前又换过别的，就不动
        if (!now || modelOf(now, group) !== id) return
        updateProject(project.id, { models: withModel(now, group, prev) }, `撤销：${meta.label}模型改回 ${modelLabel(prev)}`)
        toast(`${meta.label}模型已改回 ${modelLabel(prev)}`)
      },
    })
  }

  const choose = (id: ModelId) => {
    const cur = latestProject(project.id)
    if (!cur || id === modelOf(cur, group)) return
    const live = group === 'text' ? batchOf(project.id) : null
    if (live && live.model !== id) return setAsking(id)
    apply(id)
  }

  const close = () => setAsking(null)
  return (
    <>
      <Menu
        align={align}
        header={`${meta.label}模型`}
        note={<ModelNote warn={produced > 0 || !!batch}>{note}</ModelNote>}
        items={modelsFor(group).map((m) => ({
          label: m.id === DEFAULT_MODELS[group] ? `${m.label}（默认）` : m.label,
          icon: <Check size={14} className={clsx('text-brand-600', m.id !== value && 'invisible')} />,
          onSelect: () => choose(m.id),
        }))}
        trigger={(props) => (
          <Button {...props} data-model-pick={group} variant="secondary" size={size} aria-label={`${meta.label}模型`} title={`${meta.label}模型：${meta.covers}`}>
            <span className="text-ink-400">{meta.label}</span>
            <span data-model-value>{modelLabel(value)}</span>
            <ChevronDown size={14} className="text-ink-400" />
          </Button>
        )}
      />
      {asking && (
        <Modal
          open
          onClose={close}
          title={batch ? '批量写作还在进行，现在换文本模型？' : `文本模型改用 ${modelLabel(asking)}？`}
          desc={
            batch
              ? `这一批正在用 ${modelLabel(batch.model)} 写（写到第 ${batch.ep} 集，${batch.i}/${batch.n}）。为了同一批文风一致，本批剩下的集仍用 ${modelLabel(batch.model)} 写完，换成 ${modelLabel(asking)} 从下一次写作开始生效；想马上用 ${modelLabel(asking)} 写，就停止本批再重新批量写作，已写出的草稿保留。`
              : `批量写作已经结束，换成 ${modelLabel(asking)} 从下一次写作开始生效。`
          }
          footer={
            <>
              <Button variant="secondary" onClick={close}>
                取消
              </Button>
              {batch && (
                <Button
                  variant="secondary"
                  data-batch-stop
                  onClick={() => {
                    batchOf(project.id)?.stop()
                    apply(asking)
                    close()
                  }}
                >
                  停止本批并换
                </Button>
              )}
              <Button
                data-batch-keep
                onClick={() => {
                  apply(asking, batchOf(project.id))
                  close()
                }}
              >
                {batch ? `换，本批仍用 ${modelLabel(batch.model)} 写完` : `改用 ${modelLabel(asking)}`}
              </Button>
            </>
          }
        />
      )}
    </>
  )
}

/** 页头的模型选择：视频转剧本项目有视频解析 + 文本两个，其他项目只有文本 */
export function ProjectModels({ project, size }: { project: Project; size?: 'sm' | 'md' }) {
  return (
    <div data-models className="flex items-center gap-2">
      {projectGroups(project).map((g) => (
        <ModelPicker key={g.key} project={project} group={g.key} size={size} />
      ))}
    </div>
  )
}
