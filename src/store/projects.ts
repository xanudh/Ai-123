import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { defaultRhythm } from '../domain/rhythm'
import type { EpisodeDraft, EpisodeScript, Project, ProjectDraft, ProjectWork } from '../domain/types'
import { emptyArchitecture, emptyWork, inferRelationKind, newCharacter } from '../domain/work'
import { newId } from '../lib/id'

const now = () => new Date().toISOString()

function daysAgo(days: number) {
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

/** 首次访问时放入的示例项目，便于直观看到列表与工作台效果 */
function sampleProjects(): Project[] {
  return [
    {
      id: 'demo-rebirth',
      mode: 'original',
      title: '重生之豪门弃妇的反击',
      titleEn: 'The Billionaire’s Second-Chance Bride',
      idea: '被丈夫和闺蜜联手害死的女主重生回到婚礼前夜',
      logline: '带着前世记忆回来复仇的新娘，发现丈夫也是重生的。',
      category: '都市',
      genres: ['重生', '复仇', '豪门'],
      audience: 'female',
      tones: ['爽感', '虐心'],
      markets: ['北美'],
      platforms: ['ReelShort', 'DramaBox'],
      spec: { totalEpisodes: 70, episodeSeconds: 90, aspectRatio: '9:16', language: 'en_zh' },
      rhythm: defaultRhythm(70),
      benchmark: null,
      status: 'writing',
      palette: 1,
      sample: true,
      createdAt: daysAgo(6),
      updatedAt: daysAgo(1),
      activity: [
        { at: daysAgo(6), text: '创建项目' },
        { at: daysAgo(1), text: '调整节奏框架：首付费第 10 集' },
      ],
      work: emptyWork(),
    },
    {
      id: 'demo-alpha',
      mode: 'adaptation',
      title: '被拒绝的狼后',
      titleEn: 'Rejected by the Alpha',
      idea: '被狼王当众拒绝的女主，三年后带着隐藏血脉归来',
      logline: '被狼王当众拒绝的“废柴”伴侣，原来是失落王族最后的血脉。',
      category: '奇幻',
      genres: ['狼人', '隐藏身份', '追妻火葬场'],
      audience: 'female',
      tones: ['虐心', '爽感'],
      markets: ['北美', '欧洲'],
      platforms: ['ReelShort'],
      spec: { totalEpisodes: 60, episodeSeconds: 90, aspectRatio: '9:16', language: 'en_zh' },
      rhythm: defaultRhythm(60),
      benchmark: {
        title: 'The Alpha’s Regret',
        platform: 'ReelShort',
        url: '',
        episodes: 72,
        notes: '近 30 天热剧榜前 10，拒婚—归来结构',
      },
      status: 'draft',
      palette: 4,
      sample: true,
      createdAt: daysAgo(3),
      updatedAt: daysAgo(3),
      activity: [{ at: daysAgo(3), text: '创建项目，登记对标剧《The Alpha’s Regret》' }],
      work: emptyWork(),
    },
  ]
}

/** v2 存档里的剧本：草稿与定稿混在一起，没有标题与草稿来源 */
type LegacyScript = Omit<EpisodeScript, 'status' | 'title' | 'draftId'> & { status: 'draft' | 'final'; title?: string; draftId?: string }

/** 补齐二期新增字段；v2 里未定稿的剧本移进草稿箱 */
function toV3(p: Project): Project {
  const w: ProjectWork = { ...emptyWork(), ...p.work }
  const total = p.spec.totalEpisodes
  const legacy = w.scripts as unknown as LegacyScript[]
  const title = (ep: number) => w.outline.find((o) => o.ep === ep)?.title ?? ''
  return {
    ...p,
    category: p.category ?? (p.genres.some((g) => ['狼人', '吸血鬼'].includes(g)) ? '奇幻' : '都市'),
    work: {
      ...w,
      architecture: w.architecture && { ...emptyArchitecture(total), ...w.architecture },
      characters: w.characters.map((c) => newCharacter(c)),
      foreshadows: w.foreshadows.map((f) => ({ ...f, title: f.title ?? '', events: f.events ?? [] })),
      outline: w.outline.map((o) => ({ ...o, title: o.title ?? '' })),
      drafts: [
        ...w.drafts,
        ...legacy
          .filter((s) => s.status !== 'final')
          .map((s): EpisodeDraft => ({
            id: newId(),
            ep: s.ep,
            version: 1,
            title: s.title ?? title(s.ep),
            lines: s.lines,
            status: 'draft',
            translated: s.translated,
            states: s.states,
            reviews: [],
            notes: [],
            createdAt: s.updatedAt,
            updatedAt: s.updatedAt,
          })),
      ],
      scripts: legacy
        .filter((s) => s.status === 'final')
        .map((s): EpisodeScript => ({ ...s, status: 'final', title: s.title ?? title(s.ep), draftId: s.draftId ?? '' })),
    },
  }
}

/** 去掉每集字数（改由单集时长换算）；冲突主线补上可调整的分段 */
function toV5(p: Project): Project {
  const spec = { ...p.spec } as Project['spec'] & { episodeWords?: number }
  delete spec.episodeWords
  const a = p.work.architecture
  return { ...p, spec, work: { ...p.work, architecture: a && { ...a, phaseEnds: a.phaseEnds ?? null } } }
}

/** 人物关系补上关系类型（按旧备注推断）；新增质检报告 */
function toV6(p: Project): Project {
  const withKind = (list: Project['work']['relations']) => list.map((r) => ({ ...r, kind: r.kind ?? inferRelationKind(r.label) }))
  const b = p.work.breakdown
  return {
    ...p,
    work: { ...p.work, relations: withKind(p.work.relations), breakdown: b && { ...b, relations: withKind(b.relations) }, qa: p.work.qa ?? null },
  }
}

interface ProjectsState {
  projects: Project[]
  createProject: (draft: ProjectDraft) => Project
  updateProject: (id: string, patch: Partial<ProjectDraft & Pick<Project, 'status' | 'models'>>, note?: string) => void
  /** 写入环节产出（自动保存）；note 有值时记一条项目动态 */
  patchWork: (id: string, patch: Partial<ProjectWork>, note?: string) => void
  duplicateProject: (id: string) => Project | null
  deleteProject: (id: string) => void
  restoreSamples: () => void
}

/** 对标剧集数自动识别：导入剧本按识别到的集数，获取视频按视频集数 */
function detectEpisodes(p: Project, patch: Partial<ProjectWork>): Project['benchmark'] {
  const n = patch.source?.episodes.length || (patch.video && !p.work.video ? patch.video.episodes.length : 0)
  return p.benchmark && n ? { ...p.benchmark, episodes: n } : p.benchmark
}

export const useProjects = create<ProjectsState>()(
  persist(
    (set, get) => ({
      projects: sampleProjects(),

      createProject: (draft) => {
        const ts = now()
        const project: Project = {
          ...draft,
          id: newId(),
          status: 'draft',
          createdAt: ts,
          updatedAt: ts,
          activity: [{ at: ts, text: '创建项目' }],
          work: emptyWork(),
        }
        set({ projects: [project, ...get().projects] })
        return project
      },

      updateProject: (id, patch, note) => {
        const ts = now()
        set({
          projects: get().projects.map((p) =>
            p.id === id
              ? {
                  ...p,
                  ...patch,
                  updatedAt: ts,
                  activity: note ? [...p.activity, { at: ts, text: note }] : p.activity,
                }
              : p,
          ),
        })
      },

      patchWork: (id, patch, note) => {
        const ts = now()
        set({
          projects: get().projects.map((p) =>
            p.id === id
              ? {
                  ...p,
                  work: { ...p.work, ...patch },
                  benchmark: detectEpisodes(p, patch),
                  updatedAt: ts,
                  activity: note ? [...p.activity, { at: ts, text: note }] : p.activity,
                }
              : p,
          ),
        })
      },

      duplicateProject: (id) => {
        const source = get().projects.find((p) => p.id === id)
        if (!source) return null
        const ts = now()
        const copy: Project = {
          ...structuredClone(source),
          id: newId(),
          title: `${source.title}（副本）`,
          status: 'draft',
          sample: false,
          createdAt: ts,
          updatedAt: ts,
          activity: [{ at: ts, text: `复制自《${source.title}》` }],
        }
        set({ projects: [copy, ...get().projects] })
        return copy
      },

      deleteProject: (id) => set({ projects: get().projects.filter((p) => p.id !== id) }),

      restoreSamples: () => {
        const existing = new Set(get().projects.map((p) => p.id))
        set({ projects: [...get().projects, ...sampleProjects().filter((p) => !existing.has(p.id))] })
      },
    }),
    {
      name: 'zhiying.projects.v1',
      version: 6,
      // v0 → v1：规格新增每集字数；v1 → v2：新增环节产出 work；v2 → v3：二期字段（类型、情节、蓝图、草稿箱）；v3 → v4：三期视频转写任务；
      // v4 → v5：每集字数改由单集时长换算，冲突主线可调整分段；v5 → v6：人物关系类型、质检报告
      migrate: (persisted, version) => {
        const state = persisted as Pick<ProjectsState, 'projects'>
        if (version < 2) {
          state.projects = state.projects.map((p) => ({ ...p, work: p.work ?? emptyWork() }))
        }
        if (version < 3) state.projects = state.projects.map(toV3)
        if (version < 4) state.projects = state.projects.map((p) => ({ ...p, work: { ...p.work, video: p.work.video ?? null } }))
        if (version < 5) state.projects = state.projects.map(toV5)
        if (version < 6) state.projects = state.projects.map(toV6)
        return state as ProjectsState
      },
    },
  ),
)

export const useProject = (id: string | undefined) =>
  useProjects((s) => s.projects.find((p) => p.id === id))
