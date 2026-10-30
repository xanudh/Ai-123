import clsx from 'clsx'
import { AlertTriangle, Check, ChevronDown, Info } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { DEFAULT_MODELS, MODEL_GROUPS, modelLabel, modelOf, modelsFor, projectGroups, withModel } from '../../domain/models'
import type { ModelGroup, ModelId, Project } from '../../domain/types'
import { useProjects } from '../../store/projects'
import { toast } from '../../store/toast'
import { Menu } from '../overlay'
import { AiButton, latestProject } from '../stage/StageKit'
import { Button } from '../ui'

/**
 * 写作按钮 + ▾：直接点用项目的文本模型；点 ▾ 可以这次换一个模型写，不改项目的选择。
 * onWrite 收到 undefined 表示用项目的文本模型。
 */
export function WriteButton({
  project,
  onWrite,
  variant = 'primary',
  title,
  loading,
  disabled,
  children,
}: Pick<ComponentProps<typeof AiButton>, 'variant' | 'title' | 'loading' | 'disabled' | 'children'> & { project: Project; onWrite: (model?: ModelId) => void }) {
  const def = modelOf(project, 'text')
  return (
    <span className="inline-flex">
      <AiButton variant={variant} loading={loading} disabled={disabled} title={disabled ? title : `${title}，用 ${modelLabel(def)} 写`} className="rounded-r-none" onClick={() => onWrite()}>
        {children}
      </AiButton>
      <Menu
        header="这次换个模型写"
        note={<ModelNote>换模型写的这一版，文风可能和前几集不同，适合用来对比</ModelNote>}
        items={modelsFor('text').map((m) => ({ label: m.id === def ? `${m.label}（项目默认）` : m.label, onSelect: () => onWrite(m.id === def ? undefined : m.id) }))}
        trigger={(props) => (
          <Button
            {...props}
            variant={variant}
            size="caret"
            disabled={disabled || loading}
            aria-label="换个模型写作"
            title={`默认用 ${modelLabel(def)} 写，点开可以这次换个模型`}
            className={clsx('rounded-l-none', variant === 'primary' ? 'border-l border-white/30' : '-ml-px')}
          >
            <ChevronDown size={14} />
          </Button>
        )}
      />
    </span>
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

/** 选一类模型：改了马上生效，只影响之后的生成，已生成的内容仍记着当时的模型 */
export function ModelPicker({ project, group, size = 'sm', align = 'right' }: { project: Project; group: ModelGroup; size?: 'sm' | 'md'; align?: 'left' | 'right' }) {
  const updateProject = useProjects((s) => s.updateProject)
  const meta = MODEL_GROUPS.find((g) => g.key === group)!
  const value = modelOf(project, group)
  const produced = producedOf(project, group)
  // 生成过程中换模型，前后风格会不一致：选之前就在菜单顶部说清楚
  const note =
    group === 'video'
      ? produced
        ? `已转写 ${produced} 集：中途换模型，前后集的转写格式、人名写法可能不一致`
        : '转写过程中切换模型，可能导致前后集的转写格式不一致'
      : produced
        ? `已写 ${produced} 集：剧本生成过程中切换模型，之后写的集可能和前面文风不一致`
        : '剧本生成过程中切换模型可能导致文风不一致，建议开写前选定'
  const choose = (id: ModelId) => {
    const cur = latestProject(project.id)
    if (!cur || id === modelOf(cur, group)) return
    updateProject(project.id, { models: withModel(cur, group, id) }, `${meta.label}模型改为 ${modelLabel(id)}`)
    const done = producedOf(cur, group)
    toast(`之后的${group === 'video' ? '视频解析' : '文本生成'}改用 ${modelLabel(id)}${done ? `；已${group === 'video' ? '转写' : '写'}的 ${done} 集不变，注意前后是否一致` : ''}`)
  }
  return (
    <Menu
      align={align}
      header={`${meta.label}模型`}
      note={<ModelNote warn={produced > 0}>{note}</ModelNote>}
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
