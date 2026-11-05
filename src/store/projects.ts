import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { HERO_DETAIL, LEGACY_TAGS } from '../domain/constants'
import { defaultRhythm } from '../domain/rhythm'
import { formatScene } from '../domain/scriptFormat'
import type { Breakdown, EpisodeDraft, EpisodeScript, LineBeat, Project, ProjectDraft, ProjectWork, ReviewStatus, SceneBeat, ScriptLine } from '../domain/types'
import { analyzeSource } from '../services/mock/breakdown'
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
      genres: ['都市豪门', '穿越重生', '家族恩怨'],
      audience: 'female',
      tones: ['爽感复仇虐渣', '精致豪门质感'],
      markets: ['北美'],
      platforms: ['ReelShort', 'DramaBox'],
      spec: { totalEpisodes: 70, episodeSeconds: 90, language: 'en_zh' },
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
      genres: ['狼人传说', '白狼觉醒', '身份反转'],
      audience: 'female',
      tones: ['强拉扯暗黑浪漫', '爽感复仇虐渣', '狼人印记'],
      markets: ['北美', '欧洲'],
      platforms: ['ReelShort'],
      spec: { totalEpisodes: 60, episodeSeconds: 90, language: 'en_zh' },
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

/** 类型 / 题材 / 风格换成海外平台的分类词；场景标题改成样稿格式「日，外，地点」；补上主要势力、故事背景与人物服装、外形参考 */
function toV7(p: Project): Project {
  const tags = (list: string[], table: Record<string, string>) => [...new Set(list.map((v) => table[v] ?? v))]
  const withScenes = <T extends { lines: ScriptLine[] }>(s: T): T => ({ ...s, lines: s.lines.map((l) => (l.kind === 'scene' ? { ...l, zh: formatScene(l.zh) } : l)) })
  const a = p.work.architecture
  return {
    ...p,
    category: (p.category && LEGACY_TAGS.category[p.category]) || p.category,
    genres: tags(p.genres, LEGACY_TAGS.genres),
    tones: tags(p.tones, LEGACY_TAGS.tones),
    work: {
      ...p.work,
      architecture: a && { ...a, factions: a.factions ?? '', background: a.background ?? '' },
      characters: p.work.characters.map((c) => newCharacter(c)),
      drafts: p.work.drafts.map(withScenes),
      scripts: p.work.scripts.map(withScenes),
    },
  }
}

/** 删掉画幅（页面上一直没有入口，跟开发确认删除） */
function toV8(p: Project): Project {
  const spec = { ...p.spec } as Project['spec'] & { aspectRatio?: string }
  delete spec.aspectRatio
  return { ...p, spec }
}

/** 故事架构不再分层确认：去掉逐层「已定」的记录，确认与否只看 status */
function toV9(p: Project): Project {
  const a = p.work.architecture as (Project['work']['architecture'] & { layers?: unknown }) | null
  if (!a || !('layers' in a)) return p
  const { layers: _, ...architecture } = a
  return { ...p, work: { ...p.work, architecture } }
}

/** 仿写去掉改写方案：已有的改写方案并进改写想法（改写想法里已经有的不重复），原创的整体框架不动 */
function toV10(p: Project): Project {
  const a = p.work.architecture
  if (p.mode === 'original' || !a?.plan.trim()) return p
  const idea = a.idea.includes(a.plan.trim()) ? a.idea : [a.idea.trim(), a.plan.trim()].filter(Boolean).join('\n')
  return { ...p, work: { ...p.work, architecture: { ...a, idea, plan: '' } } }
}

/**
 * 对标剧拆解：故事梗概加金手指、期待值；逐集明细改成内容简介（每集走向 + 第 1 集到一卡细拆），去掉新出场人物、关系变化、付费卡点位置。
 * 新字段按导入的原文重新拆一遍补上；编剧改过的旧字段不动（故事简介、冲突主线、一卡位置要看新版就点「重新拆解」）
 */
function toV11(p: Project): Project {
  type Old = Omit<Breakdown, 'episodes'> & { episodes: (Breakdown['episodes'][number] & { newCharacters?: string; relationChange?: string; paywallMoment?: string })[] }
  const b = p.work.breakdown as Old | null
  if (!b) return p
  const fresh = p.work.source?.episodes.length ? analyzeSource(p.work.source, p.mode) : null
  const byEp = new Map(fresh?.episodes.map((e) => [e.ep, e]))
  const episodes = b.episodes.map(({ newCharacters: _n, relationChange: _r, paywallMoment: _m, ...e }) => ({
    ...e,
    flow: e.flow ?? byEp.get(e.ep)?.flow ?? '',
    scenes: e.scenes ?? byEp.get(e.ep)?.scenes ?? [],
  }))
  const synopsis = { ...b.synopsis, goldenFinger: b.synopsis.goldenFinger ?? fresh?.synopsis.goldenFinger ?? '' }
  return { ...p, work: { ...p.work, breakdown: { ...b, synopsis, episodes } } }
}

/**
 * 对标剧拆解（11/4 标注）：期待值和核心亮点重了，字段删掉，核心亮点就是期待值；冲突主线 · 节奏和内容简介合成一块审核，原来两块都确认过才算确认。
 * 世界观、金手指、核心亮点、故事简介、冲突主线换了写法，编剧改过的内容不动，要看新版就点「重新拆解」
 */
function toV12(p: Project): Project {
  type Old = Omit<Breakdown, 'synopsis' | 'review'> & { synopsis: Breakdown['synopsis'] & { expectation?: string }; review: Breakdown['review'] & { episodes?: ReviewStatus } }
  const b = p.work.breakdown as Old | null
  if (!b) return p
  const { expectation: _e, ...synopsis } = b.synopsis
  const { episodes, ...review } = b.review
  return { ...p, work: { ...p.work, breakdown: { ...b, synopsis, review: { ...review, mainline: review.mainline === 'approved' && episodes !== 'pending' ? 'approved' : 'pending' } } } }
}

/**
 * 对标剧拆解（11/4 标注）：一卡前的细拆从「每场一个情绪转折 + 一句核心台词」改成逐句（每句的情绪、哪句带来转折）；主角另拆身份、背景、金手指、动机、缺陷、弧光和代表台词。
 * 逐句和主角的新项按导入的原文重新拆一遍补上；编剧改过的场次、关键动作和已有的人物项不动
 */
function toV13(p: Project): Project {
  type OldScene = Omit<SceneBeat, 'lines'> & { lines?: LineBeat[]; turn?: string; line?: string }
  const b = p.work.breakdown
  if (!b) return p
  const fresh = p.work.source?.episodes.length ? analyzeSource(p.work.source, p.mode) : null
  const byEp = new Map(fresh?.episodes.map((e) => [e.ep, e.scenes]))
  const episodes = b.episodes.map((e) => ({
    ...e,
    scenes: (e.scenes as OldScene[]).map(({ turn, line, lines, ...s }, i): SceneBeat => {
      if (lines) return { ...s, lines }
      const again = byEp.get(e.ep)?.[i]?.lines
      return { ...s, lines: again ?? (line?.trim() ? [{ text: line, emotion: turn?.split('→').pop()?.trim() ?? '', turn: true }] : []) }
    }),
  }))
  const freshHero = fresh?.characters.find((c) => c.role === '主角')
  const characters = b.characters.map((c) => {
    if (c.role !== '主角' || !freshHero || freshHero.name !== c.name) return c
    const filled = { ...c }
    for (const k of HERO_DETAIL) if (!filled[k]?.trim()) filled[k] = freshHero[k] ?? ''
    return filled
  })
  return { ...p, work: { ...p.work, breakdown: { ...b, episodes, characters } } }
}

/**
 * 对标剧拆解（11/4 第五轮标注）：首集另拆前 3 秒、前 30 秒，一卡另拆卡点；主角加简介，配角加在这部剧里的作用。
 * 按导入的原文重新拆一遍补上空着的；编剧写过的不动
 */
function toV14(p: Project): Project {
  const b = p.work.breakdown
  if (!b || !p.work.source?.episodes.length) return p
  const fresh = analyzeSource(p.work.source, p.mode)
  const freshEp = new Map(fresh.episodes.map((e) => [e.ep, e]))
  const freshChar = new Map(fresh.characters.map((c) => [c.name, c]))
  const keep = (old: string | undefined, next: string | undefined) => (old?.trim() ? old : next)
  const episodes = b.episodes.map((e) => {
    const n = freshEp.get(e.ep)
    return n ? { ...e, open3s: keep(e.open3s, n.open3s), open30s: keep(e.open30s, n.open30s), cardPoint: keep(e.cardPoint, n.cardPoint) } : e
  })
  const characters = b.characters.map((c) => {
    const n = freshChar.get(c.name)
    return n ? { ...c, intro: keep(c.intro, n.intro), purpose: keep(c.purpose, n.purpose) } : c
  })
  return { ...p, work: { ...p.work, breakdown: { ...b, episodes, characters } } }
}

/** 故事架构在故事背景后面加核心亮点（11/4 标注 #71）：旧项目补空，编剧自己写或点 AI 生成 */
function toV15(p: Project): Project {
  const a = p.work.architecture
  if (!a || typeof a.highlights === 'string') return p
  return { ...p, work: { ...p.work, architecture: { ...a, highlights: '' } } }
}

/**
 * 对标剧拆解（11/4 标注 #84）：一卡之后的付费卡点集也按一卡拆卡点、逐场逐句。
 * 按导入的原文重新拆一遍，补上这些集空着的卡点和细拆；编剧写过的不动
 */
function toV16(p: Project): Project {
  const b = p.work.breakdown
  if (!b || !p.work.source?.episodes.length || !b.episodes.some((e) => e.paywall)) return p
  const fresh = new Map(analyzeSource(p.work.source, p.mode).episodes.map((e) => [e.ep, e]))
  const episodes = b.episodes.map((e) => {
    const n = e.paywall ? fresh.get(e.ep) : undefined
    if (!n) return e
    return { ...e, cardPoint: e.cardPoint?.trim() ? e.cardPoint : n.cardPoint, scenes: e.scenes?.length ? e.scenes : n.scenes }
  })
  return { ...p, work: { ...p.work, breakdown: { ...b, episodes } } }
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
      version: 16,
      // v0 → v1：规格新增每集字数；v1 → v2：新增环节产出 work；v2 → v3：二期字段（类型、情节、蓝图、草稿箱）；v3 → v4：三期视频转写任务；
      // v4 → v5：每集字数改由单集时长换算，冲突主线可调整分段；v5 → v6：人物关系类型、质检报告；v6 → v7：平台分类词、样稿剧本格式
      migrate: (persisted, version) => {
        const state = persisted as Pick<ProjectsState, 'projects'>
        if (version < 2) {
          state.projects = state.projects.map((p) => ({ ...p, work: p.work ?? emptyWork() }))
        }
        if (version < 3) state.projects = state.projects.map(toV3)
        if (version < 4) state.projects = state.projects.map((p) => ({ ...p, work: { ...p.work, video: p.work.video ?? null } }))
        if (version < 5) state.projects = state.projects.map(toV5)
        if (version < 6) state.projects = state.projects.map(toV6)
        if (version < 7) state.projects = state.projects.map(toV7)
        if (version < 8) state.projects = state.projects.map(toV8)
        if (version < 9) state.projects = state.projects.map(toV9)
        if (version < 10) state.projects = state.projects.map(toV10)
        if (version < 11) state.projects = state.projects.map(toV11)
        if (version < 12) state.projects = state.projects.map(toV12)
        if (version < 13) state.projects = state.projects.map(toV13)
        if (version < 14) state.projects = state.projects.map(toV14)
        if (version < 15) state.projects = state.projects.map(toV15)
        if (version < 16) state.projects = state.projects.map(toV16)
        return state as ProjectsState
      },
    },
  ),
)

export const useProject = (id: string | undefined) =>
  useProjects((s) => s.projects.find((p) => p.id === id))
