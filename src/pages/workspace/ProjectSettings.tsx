import { Lock, Save, Trash2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { ConfirmDialog, UnsavedChangesPrompt } from '../../components/overlay'
import { MODE_ICON } from '../../components/project/ProjectBits'
import { BasicSection, ScriptUploadField, SpecSection, StorySection } from '../../components/project/ProjectForm'
import { Button, Card, Segmented } from '../../components/ui'
import { MODE_META, STATUS_META } from '../../domain/constants'
import { rhythmForTotal } from '../../domain/rhythm'
import type { Project, ProjectDraft, ProjectStatus } from '../../domain/types'
import { hasErrors, validateAll, withSpecDefaults } from '../../domain/validate'
import { useProjects } from '../../store/projects'
import { toast } from '../../store/toast'
import { useCurrentProject } from './ProjectLayout'

const toDraft = (p: Project): ProjectDraft => ({
  mode: p.mode,
  title: p.title,
  titleEn: p.titleEn,
  idea: p.idea,
  logline: p.logline,
  category: p.category,
  genres: p.genres,
  audience: p.audience,
  tones: p.tones,
  markets: p.markets,
  platforms: p.platforms,
  spec: p.spec,
  rhythm: p.rhythm,
  benchmark: p.benchmark,
  palette: p.palette,
})

export default function ProjectSettings() {
  const project = useCurrentProject()
  const { updateProject, patchWork, deleteProject } = useProjects()
  const navigate = useNavigate()

  const [draft, setDraft] = useState(() => toDraft(project))
  const [status, setStatus] = useState<ProjectStatus>(project.status)
  // 仿写剧本存在项目产出里，随本页一起保存
  const [source, setSource] = useState(project.work.source)
  const [showErrors, setShowErrors] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  // 删除后跳转不需要拦截
  const leaving = useRef(false)

  const patch = (p: Partial<ProjectDraft>) => setDraft((d) => ({ ...d, ...p }))
  // 封面配色在页头直接修改，不经过本页的保存流程
  if (draft.palette !== project.palette) setDraft((d) => ({ ...d, palette: project.palette }))
  const errors = useMemo(() => validateAll(draft), [draft])
  const statusChanged = status !== project.status
  const draftChanged = JSON.stringify(draft) !== JSON.stringify(toDraft(project))
  const sourceChanged = source !== project.work.source
  const dirty = statusChanged || draftChanged || sourceChanged

  const save = () => {
    if (hasErrors(errors)) {
      setShowErrors(true)
      toast('还有未通过校验的字段', 'error')
      // 等错误提示渲染出来再定位
      requestAnimationFrame(() =>
        document.querySelector('[data-settings] p.text-red-600')?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
      )
      return
    }
    const filled = withSpecDefaults(draft)
    const clean: ProjectDraft = {
      ...filled,
      title: draft.title.trim(),
      titleEn: draft.titleEn.trim(),
      idea: draft.idea.trim(),
      logline: draft.logline.trim(),
      // 节奏框架在故事架构中编辑，这里只随总集数同步
      rhythm: rhythmForTotal(project.rhythm, project.spec.totalEpisodes, filled.spec.totalEpisodes),
    }
    if (statusChanged || draftChanged) {
      updateProject(
        project.id,
        statusChanged ? { ...clean, status } : clean,
        statusChanged ? `更新项目设置，状态改为「${STATUS_META[status].label}」` : '更新项目设置',
      )
    }
    // 与对标剧拆解里的“重新导入”一致：换了剧本，旧拆解作废
    if (sourceChanged) {
      patchWork(project.id, { source, breakdown: null }, source ? `更换仿写剧本：识别到 ${source.episodes.length} 集` : '移除仿写剧本')
    }
    setDraft(clean)
    setShowErrors(false)
    toast('设置已保存')
  }

  const discard = () => {
    setDraft(toDraft(project))
    setStatus(project.status)
    setSource(project.work.source)
    setShowErrors(false)
  }

  const shownErrors = showErrors ? errors : {}
  const ModeIcon = MODE_ICON[project.mode]

  return (
    <div data-settings className="space-y-6 pb-20">
      <Card className="p-6">
        <h3 className="text-[15px] font-semibold">项目状态</h3>
        <p className="mt-0.5 text-[13px] text-ink-500">用于在项目列表中筛选；正式版会随环节推进自动流转</p>
        <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-4">
          <Segmented
            value={status}
            onChange={setStatus}
            options={(Object.keys(STATUS_META) as ProjectStatus[]).map((s) => ({ value: s, label: STATUS_META[s].label }))}
          />
          <div className="flex items-center gap-2 text-[13px] text-ink-500">
            <ModeIcon size={15} />
            创作方式：<span className="text-ink-900">{MODE_META[project.mode].label}</span>
            <Lock size={12} className="text-ink-300" />
            <span className="text-xs text-ink-400">创建后不可更改</span>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <BasicSection
          draft={draft}
          patch={patch}
          errors={shownErrors}
          scriptUpload={
            <ScriptUploadField
              draft={draft}
              patch={patch}
              errors={shownErrors}
              source={source}
              onSource={setSource}
              warning={sourceChanged && project.work.breakdown ? '保存后会清空已有的拆解结果，需要在「对标剧拆解」重新拆解' : undefined}
            />
          }
        />
      </Card>

      <Card className="p-6">
        <StorySection draft={draft} patch={patch} errors={shownErrors} />
      </Card>

      <Card className="p-6">
        <SpecSection draft={draft} patch={patch} errors={shownErrors} />
      </Card>

      <Card className="border-red-200 p-6">
        <h3 className="text-[15px] font-semibold text-red-700">危险操作</h3>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
          <p className="text-[13px] text-ink-500">删除后项目设定与动态记录都无法恢复。</p>
          <Button variant="secondary" className="text-red-600" onClick={() => setConfirmDelete(true)}>
            <Trash2 size={14} />
            删除项目
          </Button>
        </div>
      </Card>

      {/* 有改动时出现的保存条 */}
      {dirty && (
        <div className="sticky bottom-4 z-20 flex animate-slide-up items-center justify-between gap-4 rounded-xl border border-line bg-white/95 px-5 py-3 shadow-pop backdrop-blur">
          <span className="text-[13px] text-ink-700">有未保存的修改</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={discard}>
              放弃修改
            </Button>
            <Button onClick={save}>
              <Save size={15} />
              保存
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          leaving.current = true
          deleteProject(project.id)
          toast('项目已删除')
          navigate('/projects', { replace: true })
        }}
        danger
        title="删除项目？"
        desc={`《${project.title}》及其全部设定将被删除，此操作无法撤销。`}
        confirmText="删除"
      />

      <UnsavedChangesPrompt dirty={dirty} bypass={leaving} desc="项目设置有未保存的修改，离开后将丢失。" />
    </div>
  )
}
