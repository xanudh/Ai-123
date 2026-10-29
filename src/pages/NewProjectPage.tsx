import clsx from 'clsx'
import { ArrowLeft, Check, Lock } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { ConfirmDialog } from '../components/overlay'
import { MODE_ICON } from '../components/project/ProjectBits'
import { BasicSection, ScriptUploadField, SpecSection, StorySection } from '../components/project/ProjectForm'
import { Badge, Button, Card, Field } from '../components/ui'
import { EPISODE_RANGE, EPISODE_SECONDS, GENRES, MODE_META, PALETTES } from '../domain/constants'
import { defaultRhythm } from '../domain/rhythm'
import type { ProjectDraft, ProjectMode, SourceScript } from '../domain/types'
import { hasErrors, validateAll, withSpecDefaults } from '../domain/validate'
import { useProjects } from '../store/projects'
import { toast } from '../store/toast'

/** 按一句话灵感里的关键词预选类型，猜不到就用“都市” */
const CATEGORY_HINTS: [RegExp, string][] = [
  [/修仙|仙门|仙尊|渡劫|宗门|飞升/, '仙侠'],
  [/斗气|玄幻|斗破|异世|魔法|血脉|觉醒/, '玄幻'],
  [/星际|机甲|AI|人工智能|未来|穿越时空/, '科幻'],
  [/末日|末世|丧尸|天灾/, '末世'],
  [/皇|王爷|宫|侯府|嫡女|古代/, '古装'],
  [/凶手|命案|悬疑|侦探|失踪/, '悬疑'],
  [/年代|七十年代|八十年代|知青/, '年代'],
  [/校园|高中|大学|同桌/, '校园'],
]

function initialDraft(params: URLSearchParams): ProjectDraft {
  const mode = (['original', 'adaptation', 'video'] as const).find((m) => m === params.get('mode')) ?? 'original'
  const genres = (params.get('genres') ?? '').split(',').filter((g) => (GENRES as readonly string[]).includes(g))
  // 首页输入的一句话保留为原始灵感，同时预填到核心设定供继续打磨
  const idea = params.get('idea') ?? ''
  return {
    mode,
    title: '',
    titleEn: '',
    idea,
    logline: idea,
    category: CATEGORY_HINTS.find(([re]) => re.test(idea))?.[1] ?? '都市',
    genres,
    audience: 'female',
    tones: [],
    markets: ['北美'],
    platforms: [],
    spec: { totalEpisodes: EPISODE_RANGE.default, episodeSeconds: EPISODE_SECONDS.default, aspectRatio: '9:16', language: 'en_zh' },
    rhythm: defaultRhythm(EPISODE_RANGE.default),
    benchmark: mode === 'original' ? null : { title: '', platform: 'ReelShort', url: '', episodes: null, notes: '' },
    palette: Math.floor(Math.random() * PALETTES.length),
  }
}

function ModePicker({ draft, patch }: { draft: ProjectDraft; patch: (p: Partial<ProjectDraft>) => void }) {
  const setMode = (mode: ProjectMode) =>
    patch({
      mode,
      benchmark: mode === 'original' ? null : (draft.benchmark ?? { title: '', platform: 'ReelShort', url: '', episodes: null, notes: '' }),
    })
  const phase = MODE_META[draft.mode].phase

  return (
    <Field label="创作方式" hint="起点决定项目在工作台中经过哪些环节，创建后不可更改；三条路最终汇入同一套写作流程">
      <div className="grid gap-3 md:grid-cols-3">
        {(Object.keys(MODE_META) as ProjectMode[]).map((mode) => {
          const meta = MODE_META[mode]
          const Icon = MODE_ICON[mode]
          const selected = draft.mode === mode
          return (
            <button
              key={mode}
              type="button"
              onClick={() => setMode(mode)}
              aria-pressed={selected}
              className={clsx(
                'relative rounded-xl border p-4 text-left transition',
                selected ? 'border-brand-500 bg-brand-50/50 ring-3 ring-brand-500/10' : 'border-line bg-white hover:border-ink-300',
              )}
            >
              <div className="flex items-center justify-between">
                <div className={clsx('flex size-9 items-center justify-center rounded-lg', selected ? 'bg-brand-600 text-white' : 'bg-canvas text-ink-700')}>
                  <Icon size={18} />
                </div>
                <span className="flex gap-1">
                  {meta.primary && <Badge tone="violet">主流程</Badge>}
                  {meta.phase && (
                    <Badge tone="gray">
                      <Lock size={10} />
                      {meta.phase}上线
                    </Badge>
                  )}
                </span>
              </div>
              <div className="mt-3 text-xs text-ink-500">{meta.entry}</div>
              <div className="mt-0.5 text-sm font-semibold">{meta.label}</div>
              <p className="mt-1 text-xs leading-5 text-ink-500">{meta.desc}</p>
            </button>
          )
        })}
      </div>
      {phase && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
          {MODE_META[draft.mode].label}的视频转写将在{phase}开放。现在可以先立项并登记对标剧，也可以直接在「对标剧拆解」上传已有剧本继续。
        </p>
      )}
    </Field>
  )
}

export default function NewProjectPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const createProject = useProjects((s) => s.createProject)
  const patchWork = useProjects((s) => s.patchWork)
  const [draft, setDraft] = useState<ProjectDraft>(() => initialDraft(params))
  // 对标剧仿写在立项时上传的剧本，创建后写入项目产出
  const [source, setSource] = useState<SourceScript | null>(null)
  const [showErrors, setShowErrors] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)

  const patch = (p: Partial<ProjectDraft>) => setDraft((d) => ({ ...d, ...p }))
  // 直接打开本页时没有站内历史，返回到项目列表
  const leave = () => ((window.history.state?.idx ?? 0) > 0 ? navigate(-1) : navigate('/projects'))
  const errors = useMemo(() => validateAll(draft), [draft])
  const dirty = draft.title !== '' || draft.logline !== draft.idea || source !== null
  const shownErrors = showErrors ? errors : {}
  const errorCount = Object.keys(shownErrors).length

  const submit = () => {
    if (hasErrors(errors)) {
      setShowErrors(true)
      toast('还有未填写或不合规的字段', 'error')
      // 等错误提示渲染出来再定位到第一处
      requestAnimationFrame(() =>
        document.querySelector('[data-new-project] p.text-red-600')?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
      )
      return
    }
    const filled = withSpecDefaults(draft)
    const project = createProject({
      ...filled,
      title: draft.title.trim(),
      titleEn: draft.titleEn.trim(),
      idea: draft.idea.trim(),
      logline: draft.logline.trim(),
      // 立项时不设节奏框架，先按总集数给推荐值，到故事架构再调整
      rhythm: defaultRhythm(filled.spec.totalEpisodes),
    })
    const imported = draft.mode === 'adaptation' ? source : null
    if (imported) patchWork(project.id, { source: imported }, `导入仿写剧本：识别到 ${imported.episodes.length} 集`)
    toast(imported ? `剧本已创建，已导入 ${imported.episodes.length} 集仿写剧本` : '剧本已创建')
    navigate(`/projects/${project.id}`, { replace: true })
  }

  return (
    <div data-new-project className="px-6 pt-8 pb-6 xl:px-8">
      <button
        onClick={() => (dirty ? setConfirmLeave(true) : leave())}
        className="mb-3 flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900"
      >
        <ArrowLeft size={14} />
        返回
      </button>
      <h1 className="text-[26px] font-semibold tracking-tight">新建剧本</h1>
      <p className="mt-1 text-sm text-ink-500">整页填完三部分，点「创建剧本」即可；之后在项目工作台中推进对标剧拆解、故事架构、情节大纲与逐集剧本。</p>

      <div className="mt-6 space-y-5">
        <Card className="p-6">
          <BasicSection
            index={1}
            draft={draft}
            patch={patch}
            errors={shownErrors}
            modePicker={<ModePicker draft={draft} patch={patch} />}
            scriptUpload={<ScriptUploadField draft={draft} patch={patch} errors={shownErrors} source={source} onSource={setSource} />}
            autoFocusName
          />
        </Card>
        <Card className="p-6">
          <StorySection index={2} draft={draft} patch={patch} errors={shownErrors} />
        </Card>
        <Card className="p-6">
          <SpecSection index={3} draft={draft} patch={patch} errors={shownErrors} />
        </Card>
      </div>

      <div className="sticky bottom-4 z-20 mt-6 flex items-center justify-between gap-4 rounded-xl border border-line bg-white/95 px-5 py-3 shadow-pop backdrop-blur">
        <span className={clsx('text-[13px]', errorCount ? 'text-red-600' : 'text-ink-500')}>
          {errorCount ? `还有 ${errorCount} 处需要修改` : '带 * 的为必填项，其余可在项目设置中随时补充'}
        </span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => (dirty ? setConfirmLeave(true) : leave())}>
            取消
          </Button>
          <Button onClick={submit}>
            <Check size={15} />
            创建剧本
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmLeave}
        onClose={() => setConfirmLeave(false)}
        onConfirm={leave}
        title="放弃新建？"
        desc="已填写的内容不会被保存。"
        confirmText="放弃"
        danger
      />
    </div>
  )
}
