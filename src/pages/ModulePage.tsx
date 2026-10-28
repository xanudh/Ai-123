import { ArrowRight, Clapperboard, Lock, Radar, ShieldCheck, Video } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { PageHeader } from '../components/layout/AppShell'
import { ProjectCover } from '../components/project/ProjectBits'
import { Badge, Card, CardHeader, buttonClass } from '../components/ui'
import { QA_CHECKS } from '../domain/pipeline'
import type { Project, ProjectMode, StageKey } from '../domain/types'
import { finalCount } from '../domain/work'
import { timeAgo } from '../lib/format'
import { useProjects } from '../store/projects'
import NotFound from './NotFound'

interface ModuleInfo {
  title: string
  icon: typeof Radar
  phase: string
  desc: string
  flow: string[]
  points: { title: string; desc: string }[]
  /** 可以先立项的创作方式 */
  mode?: ProjectMode
  /** 已在当前版本上线 */
  live?: boolean
  /** 在项目工作台里使用的环节：列出全部项目并直达该环节 */
  stage?: StageKey
}

const MODULES: Record<string, ModuleInfo> = {
  adaptation: {
    title: '对标剧仿写',
    icon: Clapperboard,
    phase: '第二阶段',
    desc: '出海短剧绝大多数从一部明确的对标剧出发做本土化改写——结构经过市场验证，不容易出错。这是剧本 Agent 的主流程。',
    flow: ['上传对标剧剧本', '四大板块拆解', '审核 · 一键引用', '商量改写方案', '改写人物 / 主线 / 集纲', '逐集写作'],
    points: [
      { title: '四大板块拆解', desc: '故事梗概、人物设定、冲突主线与节奏框架、粗纲与分集提纲（每集 12 字段），逐块审核' },
      { title: '一键引用', desc: '审核通过的拆解结果直接带入改写，主线结构与节奏尽量保持与对标剧一致' },
      { title: '和 AI 商量改写方案', desc: '有想法时 AI 评估可行性；没想法时 AI 基于拆解结果给出 3 个创意方向' },
      { title: '创新点清单', desc: '逐条写清「对标剧怎么做 → 我们怎么做」，避免只是换皮' },
    ],
    mode: 'adaptation',
    live: true,
  },
  video: {
    title: '视频转剧本',
    icon: Video,
    phase: '第三阶段',
    desc: '只有对标剧视频时，先把全集视频转成剧本，再进入拆解。核心是把目前人工逐集操作的流程自动化。',
    flow: ['粘贴对标剧链接', '一键下载全集', '逐集转写', '自动合并 · 修正格式', '进入对标剧拆解'],
    points: [
      { title: '逐集转写', desc: '一次上传多集效果明显变差，按集压缩后逐集喂给能直接读视频的多模态模型' },
      { title: '自动排队与合并', desc: '50 集人工逐集操作要多花 3–4 小时；工具自动排队转写、批量合并成一部剧本' },
      { title: '带时间码的分镜剧本', desc: '短剧的钩子一大半在画面里，产出的不是字幕稿，而是带动作与镜头的分镜剧本' },
    ],
    mode: 'video',
    live: true,
  },
  radar: {
    title: '选题雷达',
    icon: Radar,
    phase: '后续规划',
    desc: '从榜单、趋势和投放素材中发现值得对标的爆款。数据抓取实现周期最长，排在最后上线，前期继续沿用现有工具。',
    flow: ['看榜单', '看趋势', '看投放素材', '编导拍板对标剧'],
    points: [
      { title: '路径 A · 榜单对标', desc: '每天抓取各出海短剧 App 热剧榜 / 潜力榜，存历史快照，筛选上线 30 天内、排名前 20 的候选' },
      { title: '路径 B · 爆剧趋势', desc: '按题材统计近 60 天在榜数量，标注萌芽 / 升温 / 成熟 / 衰退，输出月报' },
      { title: '投放素材', desc: '新剧上线即投素材，素材起量是最早能发现一部剧要火的信号' },
    ],
  },
  qa: {
    title: '质检交付',
    icon: ShieldCheck,
    phase: '',
    desc: 'AI 写的剧本常见伏笔丢失、人设漂移、节奏塌陷等问题，交付前统一跑一遍自动质检，不合格精准打回对应环节。',
    flow: ['逐集剧本定稿', '七项自动检查', '打回 / 修正', '导出交付'],
    points: QA_CHECKS.map((c) => ({ title: c.label, desc: c.desc })),
    live: true,
    stage: 'qa',
  },
}

function qaStatus(p: Project) {
  const n = finalCount(p)
  if (p.status === 'delivered') return `已交付 · 质检 ${p.work.qa?.score ?? '—'} 分`
  if (p.work.qa) return `质检 ${p.work.qa.score} 分 · 覆盖 ${Object.keys(p.work.qa.versions).length} 集定稿`
  return n ? `已定稿 ${n} 集，尚未质检` : '还没有定稿，暂不能质检'
}

export default function ModulePage() {
  const { key } = useParams()
  const info = key ? MODULES[key] : undefined
  const projects = useProjects((s) => s.projects)

  if (!info) return <NotFound />

  const Icon = info.icon
  const related = info.mode ? projects.filter((p) => p.mode === info.mode) : []

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <PageHeader
        title={
          <span className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
              <Icon size={19} />
            </span>
            {info.title}
            {info.live ? (
              <Badge tone="green">{info.phase ? `${info.phase} · ` : ''}已上线</Badge>
            ) : (
              <Badge tone="gray">
                <Lock size={10} />
                {info.phase}
              </Badge>
            )}
          </span>
        }
        desc={info.desc}
        actions={
          info.mode && (
            <Link to={`/projects/new?mode=${info.mode}`} className={buttonClass()}>
              {info.live ? (info.mode === 'video' ? '新建视频转写剧本' : '新建仿写剧本') : '先立项并登记对标剧'}
              <ArrowRight size={15} />
            </Link>
          )
        }
      />

      <Card>
        <CardHeader title="流程" />
        <ol className="flex flex-wrap items-center gap-2 px-5 py-5">
          {info.flow.map((step, i) => (
            <li key={step} className="flex items-center gap-2">
              <span className="flex items-center gap-2 rounded-lg border border-line bg-canvas/60 px-3 py-2 text-[13px]">
                <span className="text-xs text-ink-400 tabular-nums">{i + 1}</span>
                {step}
              </span>
              {i < info.flow.length - 1 && <ArrowRight size={14} className="text-ink-300" />}
            </li>
          ))}
        </ol>
      </Card>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {info.points.map((p) => (
          <Card key={p.title} className="px-5 py-4">
            <div className="text-sm font-semibold">{p.title}</div>
            <p className="mt-1 text-[13px] leading-6 text-ink-500">{p.desc}</p>
          </Card>
        ))}
      </div>

      {info.stage && (
        <Card className="mt-6">
          <CardHeader title="各项目的质检" desc="质检在项目工作台的「质检交付」环节进行，逐集剧本至少定稿一集后即可开始" />
          {projects.length ? (
            <ul className="divide-y divide-line">
              {projects.map((p) => (
                <li key={p.id}>
                  <Link to={`/projects/${p.id}/stage/${info.stage}`} className="flex items-center gap-3 px-5 py-3 hover:bg-canvas/60">
                    <ProjectCover project={p} compact className="h-10 w-7 shrink-0 rounded" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{p.title}</span>
                      <span className="block truncate text-xs text-ink-500">{qaStatus(p)}</span>
                    </span>
                    <span className="text-xs text-ink-400">{timeAgo(p.updatedAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-6 text-[13px] text-ink-500">还没有项目。</p>
          )}
        </Card>
      )}

      {info.mode && (
        <Card className="mt-6">
          <CardHeader title="已立项的项目" desc={info.live ? (info.mode === 'video' ? '进入项目即可继续转写、拆解与改写' : '进入项目即可继续拆解与改写') : '功能上线后可直接在这些项目中继续'} />
          {related.length ? (
            <ul className="divide-y divide-line">
              {related.map((p) => (
                <li key={p.id}>
                  <Link to={`/projects/${p.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-canvas/60">
                    <ProjectCover project={p} compact className="h-10 w-7 shrink-0 rounded" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{p.title}</span>
                      <span className="block truncate text-xs text-ink-500">对标：{p.benchmark?.title || '—'}</span>
                    </span>
                    <span className="text-xs text-ink-400">{timeAgo(p.updatedAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-6 text-[13px] text-ink-500">还没有{info.title}项目。</p>
          )}
        </Card>
      )}
    </div>
  )
}
