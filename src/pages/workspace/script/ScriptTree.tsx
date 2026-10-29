/** 侧栏「逐集剧本」下的草稿箱与正文章节：草稿按集分组，定稿后归入正文章节 */
import clsx from 'clsx'
import { BookOpen, ChevronDown, ChevronRight, Circle, CircleCheck, Inbox, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link, NavLink, useMatch, useNavigate, useSearchParams } from 'react-router'
import { ConfirmDialog } from '../../../components/overlay'
import { latestProject } from '../../../components/stage/StageKit'
import { DRAFT_STATUS_META } from '../../../domain/constants'
import type { Project } from '../../../domain/types'
import { draftLabel, draftsOf, scriptOf } from '../../../domain/work'
import { useProjects } from '../../../store/projects'
import { toast } from '../../../store/toast'
import { draftPath, finalPath, removeDraft, removeScript, reviewCounts, scriptStagePath } from './ops'

type Pending = { kind: 'draft'; id: string; ep: number; title: string; desc: string } | { kind: 'script'; ep: number; title: string; desc: string }

const DOT_TONE = { gray: 'bg-ink-300', amber: 'bg-amber-400', green: 'bg-emerald-500' } as const

function Group({ open, onToggle, icon, label, count, children }: { open: boolean; onToggle: () => void; icon: ReactNode; label: string; count: number; children: ReactNode }) {
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-[12.5px] font-medium text-ink-700 hover:bg-[var(--tree-hover,rgb(255_255_255/0.7))]"
      >
        {open ? <ChevronDown size={13} className="text-ink-400" /> : <ChevronRight size={13} className="text-ink-400" />}
        {icon}
        <span className="flex-1 text-left">{label}</span>
        <span className="text-[11px] font-normal text-ink-400 tabular-nums">{count} 集</span>
      </button>
      {open && children}
    </div>
  )
}

function DeleteButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="absolute top-1/2 right-1 -translate-y-1/2 rounded p-1 text-ink-400 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-50 hover:text-red-600 focus-visible:opacity-100"
    >
      <Trash2 size={12} />
    </button>
  )
}

const leaf = ({ isActive }: { isActive: boolean }) =>
  clsx('flex h-7 items-center gap-1.5 rounded-md pr-6 text-[12.5px] transition-colors', isActive ? 'bg-[var(--tree-active,white)] font-medium text-brand-700 shadow-card' : 'text-ink-700 hover:bg-[var(--tree-hover,rgb(255_255_255/0.7))]')

export function ScriptTree({ project }: { project: Project }) {
  const w = project.work
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const patchWork = useProjects((s) => s.patchWork)
  // 布局路由拿不到子路由参数，用 useMatch 找当前打开的草稿 / 正文
  const draftMatch = useMatch('/projects/:id/stage/script/draft/:draftId')
  const finalMatch = useMatch('/projects/:id/stage/script/final/:ep')
  const activeDraft = w.drafts.find((d) => d.id === draftMatch?.params.draftId)
  const activeEp = finalMatch ? Number(finalMatch.params.ep) : null

  const [boxOpen, setBoxOpen] = useState(true)
  const [finalOpen, setFinalOpen] = useState(true)
  const [openEps, setOpenEps] = useState<number[]>(activeDraft ? [activeDraft.ep] : [])
  const [pending, setPending] = useState<Pending | null>(null)

  // 打开了某个草稿：自动展开它所在的集
  const [seen, setSeen] = useState(activeDraft?.id)
  if (activeDraft && activeDraft.id !== seen) {
    setSeen(activeDraft.id)
    setBoxOpen(true)
    if (!openEps.includes(activeDraft.ep)) setOpenEps([...openEps, activeDraft.ep])
  }

  const boxEps = [...new Set(w.drafts.map((d) => d.ep))].sort((a, b) => a - b)
  const scripts = [...w.scripts].sort((a, b) => a.ep - b.ep)
  const toggleEp = (ep: number) => setOpenEps((list) => (list.includes(ep) ? list.filter((e) => e !== ep) : [...list, ep]))

  const confirm = () => {
    const cur = latestProject(project.id)
    if (!cur || !pending) return
    if (pending.kind === 'draft') {
      const d = cur.work.drafts.find((x) => x.id === pending.id)
      if (activeDraft?.id === pending.id) navigate(`${scriptStagePath(project)}?ep=${pending.ep}`)
      patchWork(project.id, removeDraft(cur.work, pending.id), `删除第 ${pending.ep} 集 ${d ? draftLabel(d) : '草稿'}`)
      toast('草稿已删除')
    } else {
      if (activeEp === pending.ep) navigate(`${scriptStagePath(project)}?ep=${pending.ep}`)
      patchWork(project.id, removeScript(cur.work, pending.ep), `删除正文第 ${pending.ep} 集`)
      toast(`正文第 ${pending.ep} 集已删除，来源草稿退回草稿箱`)
    }
  }

  return (
    <div className="mt-1 mb-1 ml-[22px] space-y-0.5 border-l border-line pl-1.5">
      <Group open={boxOpen} onToggle={() => setBoxOpen((v) => !v)} icon={<Inbox size={13} className="text-ink-400" />} label="草稿箱" count={boxEps.length}>
        {boxEps.length ? (
          <ul className="space-y-px">
            {boxEps.map((ep) => {
              const versions = draftsOf(w, ep)
              const done = !!scriptOf(w, ep)
              const open = openEps.includes(ep)
              return (
                <li key={ep}>
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => toggleEp(ep)}
                    title={`第 ${ep} 集 ${versions[0].title}`}
                    className="flex h-7 w-full items-center gap-1.5 rounded-md pl-3 pr-1.5 text-[12.5px] text-ink-700 hover:bg-[var(--tree-hover,rgb(255_255_255/0.7))]"
                  >
                    {done ? <CircleCheck size={13} className="shrink-0 text-emerald-500" /> : <Circle size={13} className="shrink-0 text-ink-300" />}
                    <span className="min-w-0 flex-1 truncate text-left">
                      第{ep}集 {versions[0].title}
                    </span>
                    <span className="shrink-0 text-[11px] text-ink-400 tabular-nums">{versions.length} 稿</span>
                  </button>
                  {open && (
                    <ul className="space-y-px">
                      {versions.map((d) => {
                        const meta = DRAFT_STATUS_META[d.status]
                        return (
                          <li key={d.id}>
                            <div className="group relative">
                              <NavLink to={draftPath(project, d.id)} end className={(s) => clsx(leaf(s), 'pl-8')}>
                                <span className={clsx('size-1.5 shrink-0 rounded-full', DOT_TONE[meta.tone])} />
                                <span className="truncate">{draftLabel(d)}</span>
                                <span className="shrink-0 text-[11px] font-normal text-ink-400">{meta.label}</span>
                              </NavLink>
                              <DeleteButton
                                label={`删除${draftLabel(d)}`}
                                onClick={() =>
                                  setPending({
                                    kind: 'draft',
                                    id: d.id,
                                    ep,
                                    title: `删除${draftLabel(d)}？`,
                                    desc:
                                      d.status === 'final'
                                        ? `这是第 ${ep} 集正文的来源版本；删除后正文章节不受影响。`
                                        : `第 ${ep} 集的这个版本及其审核报告、标注将被删除，无法撤销。`,
                                  })
                                }
                              />
                            </div>
                            {d.reviews.length > 0 && (
                              <ul>
                                {d.reviews.map((r, i) => {
                                  const { block, warn } = reviewCounts(r)
                                  const active = activeDraft?.id === d.id && params.get('review') === r.id
                                  return (
                                    <li key={r.id}>
                                      <Link
                                        to={draftPath(project, d.id, r.id)}
                                        className={clsx('flex h-6 items-center gap-1 truncate rounded-md pr-1.5 pl-12 text-[11.5px]', active ? 'bg-[var(--tree-active,white)] text-brand-700 shadow-card' : 'text-ink-500 hover:bg-[var(--tree-hover,rgb(255_255_255/0.7))]')}
                                      >
                                        审核报告 #{i + 1}
                                        <span className="text-ink-300">·</span>
                                        <span className={block ? 'text-red-600' : undefined}>{block} 严重</span>
                                        <span className="text-ink-300">·</span>
                                        <span className={warn ? 'text-amber-700' : undefined}>{warn} 建议</span>
                                      </Link>
                                    </li>
                                  )
                                })}
                              </ul>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="py-1 pl-8 text-[11.5px] text-ink-400">还没有草稿</p>
        )}
      </Group>

      <Group open={finalOpen} onToggle={() => setFinalOpen((v) => !v)} icon={<BookOpen size={13} className="text-ink-400" />} label="正文章节" count={scripts.length}>
        {scripts.length ? (
          <ul className="space-y-px">
            {scripts.map((s) => (
              <li key={s.ep} className="group relative">
                <NavLink to={finalPath(project, s.ep)} end title={`第 ${s.ep} 集 ${s.title}`} className={(st) => clsx(leaf(st), 'pl-3')}>
                  <CircleCheck size={13} className="shrink-0 text-emerald-500" />
                  <span className="truncate">
                    第{s.ep}集 {s.title}
                  </span>
                </NavLink>
                <DeleteButton
                  label={`删除正文第 ${s.ep} 集`}
                  onClick={() =>
                    setPending({ kind: 'script', ep: s.ep, title: `删除正文第 ${s.ep} 集？`, desc: '正文里的修改将丢失；来源草稿会退回草稿箱，可重新定稿。状态库会按剩余正文重新汇总。' })
                  }
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-1 pl-8 text-[11.5px] text-ink-400">草稿定稿后归到这里</p>
        )}
      </Group>

      <ConfirmDialog open={!!pending} onClose={() => setPending(null)} onConfirm={confirm} danger title={pending?.title ?? ''} desc={pending?.desc} confirmText="删除" />
    </div>
  )
}
