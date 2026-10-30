import { MODE_STAGES } from './pipeline'
import type { ModelGroup, ModelId, Project } from './types'

/** 可选的大模型。video：能直接读视频 / 音频（视频解析只列这些） */
export const MODELS: { id: ModelId; label: string; region: '国产' | '海外'; video: boolean }[] = [
  { id: 'deepseek', label: 'DeepSeek', region: '国产', video: false },
  { id: 'qwen', label: '通义千问', region: '国产', video: true },
  { id: 'doubao', label: '豆包', region: '国产', video: true },
  { id: 'kimi', label: 'Kimi', region: '国产', video: false },
  { id: 'gpt', label: 'GPT', region: '海外', video: false },
  { id: 'gemini', label: 'Gemini', region: '海外', video: true },
]

/** 两类模型：视频解析只管逐集转写；文本管拆解之后的全部文本环节（原创、仿写、视频转剧本都一样） */
export const MODEL_GROUPS: { key: ModelGroup; label: string; covers: string }[] = [
  { key: 'video', label: '视频解析', covers: '只用于视频转剧本的逐集转写，只列能直接看视频、听音频的模型' },
  { key: 'text', label: '文本', covers: '拆解、故事架构、人物、伏笔、大纲、蓝图、正文、审稿、修稿、质检、翻译都用它；写作时可在 ▾ 里临时换一个' },
]

/** 没选过时用的默认模型 */
export const DEFAULT_MODELS: Record<ModelGroup, ModelId> = { video: 'qwen', text: 'doubao' }

export const modelOf = (p: Pick<Project, 'models'>, group: ModelGroup): ModelId => p.models?.[group] ?? DEFAULT_MODELS[group]

export const modelLabel = (id: ModelId) => MODELS.find((m) => m.id === id)?.label ?? id

/** 这一类能选的模型 */
export const modelsFor = (group: ModelGroup) => MODELS.filter((m) => group !== 'video' || m.video)

/** 本项目用得到的模型类别：只有视频转剧本才有视频解析 */
export const projectGroups = (p: Pick<Project, 'mode'>) => MODEL_GROUPS.filter((g) => g.key !== 'video' || MODE_STAGES[p.mode].includes('video'))

/** 改一类模型后要存的 models：和默认相同的不存，以后跟着默认走 */
export function withModel(p: Pick<Project, 'models'>, group: ModelGroup, id: ModelId): Partial<Record<ModelGroup, ModelId>> {
  const next = { ...p.models, [group]: id }
  return Object.fromEntries(Object.entries(next).filter(([g, m]) => g in DEFAULT_MODELS && m !== DEFAULT_MODELS[g as ModelGroup]))
}
