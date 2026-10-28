import clsx from 'clsx'
import { Info, MapPin, ScrollText, Users } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { CheckList, EpisodeInput, Stat, Table, stagePath } from '../../../components/stage/StageKit'
import { Badge, Card, CardHeader } from '../../../components/ui'
import { buildState, preWriteCheck, silenceThreshold } from '../../../domain/state'
import type { Project } from '../../../domain/types'
import { foreshadowName, scriptOf } from '../../../domain/work'
import type { ForeshadowStatus } from '../../../domain/work'

const STATUS_TONE: Record<ForeshadowStatus, 'gray' | 'amber' | 'green'> = { 已计划: 'gray', 已埋设: 'amber', 已回收: 'green' }

export default function StateStage({ project }: { project: Project }) {
  const total = project.spec.totalEpisodes
  const lib = buildState(project)
  const threshold = silenceThreshold(project)
  // 下一集要写的：第一个还没定稿的集
  let nextEp = 1
  while (nextEp < total && scriptOf(project.work, nextEp)) nextEp++
  const [checkEp, setCheckEp] = useState(nextEp)
  const checks = preWriteCheck(project, checkEp)

  const registered = lib.characters.filter((c) => c.role).length
  const unregistered = lib.characters.length - registered
  const active = lib.foreshadows.filter((f) => f.status === '已埋设').length
  const paid = lib.foreshadows.filter((f) => f.status === '已回收').length
  const alerts = lib.foreshadows.filter((f) => f.overdue).length

  return (
    <>
      <Card className="p-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="已定稿" value={lib.latestEp ? `至第 ${lib.latestEp} 集 / 共 ${total} 集` : `0 / ${total} 集`} />
          <Stat label="人物" value={unregistered ? `${registered} 登记 · ${unregistered} 未登记` : `${registered} 人`} tone={unregistered ? 'amber' : undefined} />
          <Stat label="伏笔与线索" value={`${active} 待回收 · ${paid} 已回收`} />
          <Stat label="需处理" value={alerts} tone={alerts ? 'red' : 'green'} />
        </div>
        {!lib.latestEp && (
          <p className="mt-4 flex items-start gap-2 rounded-lg bg-canvas px-3.5 py-2.5 text-[13px] leading-5 text-ink-700">
            <Info size={14} className="mt-[3px] shrink-0 text-ink-400" />
            <span>
              状态库只从正文章节（定稿）汇总，草稿不计入。还没有定稿的集——
              <Link to={stagePath(project, 'script')} className="font-medium text-brand-600 hover:text-brand-700">
                去逐集剧本写第 1 集
              </Link>
            </span>
          </p>
        )}
      </Card>

      <Card>
        <CardHeader
          title="写作前检查"
          desc="每写一集前对照状态库：集纲与蓝图、上一集定稿、伏笔到期与逾期、钩子承接、人物最新状态"
          action={
            <span className="flex items-center gap-1 text-[13px] text-ink-500">
              第
              <EpisodeInput label="检查集数" value={checkEp} max={total} onChange={setCheckEp} />
              集
            </span>
          }
        />
        <div className="px-5 py-4">
          <CheckList items={checks} empty="没有需要注意的事项" />
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title={<span className="flex items-center gap-1.5"><Users size={15} className="text-ink-400" />人物</span>} desc="出场按有台词计；最新状态取最近一集定稿回写的人物状态" />
        {lib.characters.length ? (
          <Table columns={['人物', '定位', '出场', '最新状态']} minWidth={640}>
            {lib.characters.map((c) => (
              <tr key={c.name}>
                <td className="px-4 py-2.5 whitespace-nowrap">
                  <span className="font-medium text-ink-900">{c.name}</span>
                  {c.nameEn && <span className="ml-1.5 text-xs text-ink-400">{c.nameEn}</span>}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap">{c.role ? <Badge tone={c.role === '主角' ? 'violet' : c.role === '反派' ? 'red' : 'gray'}>{c.role}</Badge> : <Badge tone="amber">未登记</Badge>}</td>
                <td className="px-4 py-2.5 whitespace-nowrap text-ink-700 tabular-nums">
                  {c.firstEp === null ? <span className="text-ink-300">未出场</span> : `第 ${c.firstEp}${c.lastEp !== c.firstEp ? `–${c.lastEp}` : ''} 集 · ${c.episodes} 集`}
                </td>
                <td className="px-4 py-2.5 text-ink-700">
                  {c.state ? (
                    <>
                      {c.state}
                      <span className="ml-1.5 text-xs text-ink-400 tabular-nums">第 {c.stateEp} 集后</span>
                    </>
                  ) : (
                    <span className="text-ink-300">—</span>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <p className="px-5 py-4 text-[13px] text-ink-400">还没有人物：先在人物设定中生成或添加</p>
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader title="人物关系" desc="来自人物设定的关系备注" />
          {lib.relations.length ? (
            <Table columns={['人物', '关系', '备注', '最近同场']} minWidth={440}>
              {lib.relations.map((r, i) => (
                <tr key={i}>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    {r.a} <span className="text-ink-300">↔</span> {r.b}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-ink-900">{r.kind || <span className="text-ink-300">—</span>}</td>
                  <td className="px-4 py-2.5 text-ink-700">{r.label || <span className="text-ink-300">—</span>}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-ink-700 tabular-nums">{r.lastTogether ? `第 ${r.lastTogether} 集` : <span className="text-ink-300">—</span>}</td>
                </tr>
              ))}
            </Table>
          ) : (
            <p className="px-5 py-4 text-[13px] text-ink-400">还没有关系备注</p>
          )}
        </Card>

        <Card className="overflow-hidden">
          <CardHeader title={<span className="flex items-center gap-1.5"><MapPin size={15} className="text-ink-400" />场景</span>} desc="正文场景标题去掉日 / 夜 / 内 / 外后汇总" />
          {lib.scenes.length ? (
            <Table columns={['场景', '出现集数']} minWidth={360}>
              {lib.scenes.map((s) => (
                <tr key={s.place}>
                  <td className="px-4 py-2.5 font-medium whitespace-nowrap">{s.place}</td>
                  <td className="px-4 py-2.5 text-ink-700 tabular-nums">
                    {s.episodes.length} 集<span className="ml-2 text-xs text-ink-400">第 {s.episodes.join('、')} 集</span>
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <p className="px-5 py-4 text-[13px] text-ink-400">定稿后自动汇总</p>
          )}
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeader
          title="伏笔与叙事线索进度"
          desc={
            <>
              只计编剧确认过的定稿事件；{threshold > 0 ? `连续 ${threshold} 集没推进会提醒` : '未设沉寂提醒'} ·
              <Link to={stagePath(project, 'foreshadow')} className="ml-1 text-brand-600 hover:text-brand-700">
                去确认事件
              </Link>
            </>
          }
        />
        {lib.foreshadows.length ? (
          <Table columns={['名称', '类型', '状态', '计划', '实际', '沉寂', '提醒']} minWidth={760}>
            {lib.foreshadows.map((f) => (
              <tr key={f.item.id}>
                <td className="max-w-56 px-4 py-2.5 font-medium">{foreshadowName(f.item)}</td>
                <td className="px-4 py-2.5 whitespace-nowrap text-ink-700">{f.item.type}</td>
                <td className="px-4 py-2.5 whitespace-nowrap">
                  <Badge tone={STATUS_TONE[f.status]}>{f.status}</Badge>
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap text-ink-700 tabular-nums">
                  第 {f.item.plantEp} → {f.item.payoffEp} 集
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap text-ink-700 tabular-nums">
                  {f.plantedIn === null ? <span className="text-ink-300">—</span> : `第 ${f.plantedIn}${f.paidIn !== null ? ` → ${f.paidIn}` : ''} 集`}
                </td>
                <td className={clsx('px-4 py-2.5 whitespace-nowrap tabular-nums', threshold > 0 && f.silence >= threshold ? 'font-medium text-amber-700' : 'text-ink-500')}>
                  {f.status === '已埋设' ? `${f.silence} 集` : <span className="text-ink-300">—</span>}
                </td>
                <td className="px-4 py-2.5 text-amber-800">{f.overdue ?? <span className="text-ink-300">—</span>}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <p className="px-5 py-4 text-[13px] text-ink-400">还没有伏笔计划</p>
        )}
      </Card>

      <Card>
        <CardHeader title={<span className="flex items-center gap-1.5"><ScrollText size={15} className="text-ink-400" />定稿日志</span>} desc="每定稿一集，状态库自动更新" />
        {lib.log.length ? (
          <ol className="divide-y divide-line">
            {lib.log.map((e) => (
              <li key={e.ep} className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5 px-5 py-3">
                <span className="w-16 shrink-0 text-[13px] font-medium tabular-nums">第 {e.ep} 集</span>
                <span className="min-w-0 flex-1">
                  {e.title && <span className="mr-2 text-[13px] text-ink-700">{e.title}</span>}
                  {e.changes.length ? (
                    <span className="inline-flex flex-wrap gap-1 align-middle">
                      {e.changes.map((c) => (
                        <span key={c} className="rounded bg-canvas px-1.5 py-0.5 text-[11px] text-ink-500">
                          {c}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="text-xs text-ink-400">无状态变化</span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="px-5 py-4 text-[13px] text-ink-400">还没有定稿</p>
        )}
      </Card>
    </>
  )
}
