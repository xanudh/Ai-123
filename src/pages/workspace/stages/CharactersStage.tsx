import clsx from 'clsx'
import { Copy, Plus, Trash2, Users } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { ConfirmDialog } from '../../../components/overlay'
import { RELATION_GROUPS, RelationGraph, RelationLegend } from '../../../components/project/RelationGraph'
import { AiButton, AutoTextarea, CheckList, InlineInput, RelationKindList, Table, latestProject, useAiTask } from '../../../components/stage/StageKit'
import type { CheckItem } from '../../../components/stage/StageKit'
import { Button, Card, CardHeader, EmptyState, Input, Segmented, Select } from '../../../components/ui'
import { CHARACTER_ROLES } from '../../../domain/constants'
import { characterBio } from '../../../domain/scriptFormat'
import type { Character, CharacterRole, Project, Relation } from '../../../domain/types'
import { newCharacter, relationGroup } from '../../../domain/work'
import { draftCharacters, nextSeed } from '../../../services/ai'
import { useProjects } from '../../../store/projects'
import { toast } from '../../../store/toast'

const ROLE_DOT: Record<CharacterRole, string> = { 主角: 'bg-brand-500', 暧昧对象: 'bg-rose-400', 反派: 'bg-red-600', 配角: 'bg-ink-300' }

type TextField = keyof Pick<Character, 'profile' | 'appearance' | 'costume' | 'lookRef' | 'personality' | 'background' | 'ability' | 'goal' | 'desire' | 'fear' | 'flaw' | 'arc' | 'notes'>

/** 人物小传字段；外形、服装、外形参考对应样稿小传后的三项，交给选角与美术 */
const FIELDS: { key: TextField; label: string; placeholder: string }[] = [
  { key: 'profile', label: '身份', placeholder: '职业、身份、外在标签' },
  { key: 'appearance', label: '外形', placeholder: '身高身材、长相、发型、眼神、标志性细节、随身物件' },
  { key: 'costume', label: '服装', placeholder: '可按阶段写，如「战甲（1–51 集）：前期破损沾血，后期锃亮」' },
  { key: 'lookRef', label: '外形参考', placeholder: '参考演员、参考图链接，或对选角 / 美术的要求' },
  { key: 'personality', label: '性格', placeholder: '核心性格与行为习惯' },
  { key: 'background', label: '背景', placeholder: '出身、经历、与主线的关联' },
  { key: 'ability', label: '能力', placeholder: '能力 / 金手指，以及它的代价与限制' },
]

const MOTIVES: { key: TextField; label: string; placeholder: string }[] = [
  { key: 'goal', label: '表面追求', placeholder: '眼下想做成的事' },
  { key: 'desire', label: '终极渴望', placeholder: '内心真正想要的' },
  { key: 'fear', label: '潜意识恐惧', placeholder: '最怕的事' },
]

const TAIL: { key: TextField; label: string; placeholder: string }[] = [
  { key: 'flaw', label: '缺陷', placeholder: '性格上的短板，推动冲突的根源' },
  { key: 'arc', label: '弧光', placeholder: '从 A → B，成长核心是什么' },
  { key: 'notes', label: '备注', placeholder: '写作注意事项、出场节奏等' },
]

/** 主角与反派必须填的项 */
const REQUIRED: [TextField, string][] = [
  ['profile', '身份'],
  ['desire', '终极渴望'],
  ['flaw', '缺陷'],
  ['arc', '弧光'],
]

function characterChecks(project: Project): CheckItem[] {
  const { characters } = project.work
  const items: CheckItem[] = []
  const count = (role: CharacterRole) => characters.filter((c) => c.role === role).length
  if (!count('主角')) items.push({ level: 'warn', text: '缺少主角' })
  if (!count('反派')) items.push({ level: 'warn', text: '缺少反派：没有威胁感，冲突立不起来' })
  if (count('配角') < 2) items.push({ level: 'info', text: '建议安排 2–3 个关键配角（盟友 / 知情人 / 催化剂）' })
  const names = characters.map((c) => c.name.trim())
  if (names.some((n) => !n)) items.push({ level: 'warn', text: '有人物没填名字' })
  const dup = [...new Set(names.filter((n, i) => n && names.indexOf(n) !== i))]
  if (dup.length) items.push({ level: 'warn', text: `人物重名：${dup.join('、')}` })
  const bench = new Set(project.work.breakdown?.characters.map((c) => c.name) ?? [])
  const copied = names.filter((n) => bench.has(n))
  if (copied.length) items.push({ level: 'warn', text: `「${copied.join('、')}」与对标剧人物同名，仿写需全部换名` })
  for (const c of characters.filter((c) => c.role === '主角' || c.role === '反派')) {
    const empty = REQUIRED.filter(([k]) => !c[k].trim()).map(([, label]) => label)
    if (empty.length) items.push({ level: 'warn', text: `${c.name || c.role}缺少：${empty.join('、')}` })
  }
  return items
}

const relationsOf = (c: Character, relations: Relation[]) =>
  relations.map((r, i) => ({ r, i, other: r.a === c.name ? r.b : r.a })).filter(({ r }) => c.name && (r.a === c.name || r.b === c.name))

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <dt className="w-20 shrink-0 pt-2 text-[13px] text-ink-500">{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  )
}

function CharacterEditor({
  project,
  c,
  benchNames,
  onChange,
  onRemove,
}: {
  project: Project
  c: Character
  benchNames: string[] | null
  onChange: (patch: Partial<Character>) => void
  onRemove: () => void
}) {
  const patchWork = useProjects((s) => s.patchWork)
  const [view, setView] = useState<'edit' | 'doc'>('edit')
  const { characters, relations } = project.work
  const others = characters.filter((x) => x.id !== c.id && x.name.trim()).map((x) => x.name)
  const mine = relationsOf(c, relations)
  const setRelations = (next: Relation[]) => patchWork(project.id, { relations: next })
  const field = (f: { key: TextField; label: string; placeholder: string }) => (
    <Row key={f.key} label={f.label}>
      <AutoTextarea
        inline
        aria-label={f.label}
        value={c[f.key]}
        onChange={(e) => {
          const patch: Partial<Character> = {}
          patch[f.key] = e.target.value
          onChange(patch)
        }}
        placeholder={f.placeholder}
      />
    </Row>
  )
  const copy = () =>
    navigator.clipboard
      .writeText(characterBio(c, relations))
      .then(() => toast('人物小传已复制'))
      .catch(() => toast('复制失败，请在预览中手动选择', 'error'))

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
        <span className={clsx('size-2.5 shrink-0 rounded-full', ROLE_DOT[c.role])} />
        <h3 className="mr-auto text-[15px] font-semibold text-ink-900">
          {c.role}：{c.name || '未命名'}
        </h3>
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: 'edit', label: '编辑' },
            { value: 'doc', label: '小传预览' },
          ]}
        />
        <Button variant="ghost" size="sm" onClick={copy} aria-label="复制人物小传">
          <Copy size={14} />
        </Button>
        <Button variant="ghost" size="sm" className="text-red-600" onClick={onRemove}>
          <Trash2 size={14} />
          删除
        </Button>
      </div>

      {view === 'doc' ? (
        <pre className="p-5 font-sans text-[13px] leading-7 whitespace-pre-wrap text-ink-900">{characterBio(c, relations)}</pre>
      ) : (
        <div className="space-y-5 p-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <label className="block">
              <span className="mb-1 block text-xs text-ink-500">名字</span>
              <Input aria-label="人物名" value={c.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="名字" className="h-9 font-medium" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-ink-500">英文名</span>
              <Input aria-label="英文名" value={c.nameEn} onChange={(e) => onChange({ nameEn: e.target.value })} placeholder="英文名" className="h-9" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-ink-500">定位</span>
              <Select aria-label="定位" value={c.role} onChange={(e) => onChange({ role: e.target.value as CharacterRole })} className="h-9 text-[13px]">
                {CHARACTER_ROLES.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </Select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-xs text-ink-500">性别</span>
                <Select aria-label="性别" value={c.gender} onChange={(e) => onChange({ gender: e.target.value })} className="h-9 text-[13px]">
                  <option value="">—</option>
                  <option>女</option>
                  <option>男</option>
                  <option>其他</option>
                </Select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-ink-500">年龄</span>
                <Input aria-label="年龄" value={c.age} onChange={(e) => onChange({ age: e.target.value })} placeholder="如：34" className="h-9" />
              </label>
            </div>
          </div>
          {benchNames && (
            <label className="flex items-center gap-2 text-xs text-ink-500">
              对应对标剧角色
              <Select aria-label="对应对标剧角色" value={c.benchmark} onChange={(e) => onChange({ benchmark: e.target.value })} className="h-8 w-auto text-xs">
                <option value="">无（新增角色）</option>
                {benchNames.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </Select>
            </label>
          )}

          <dl className="space-y-1">{FIELDS.map(field)}</dl>

          <div className="rounded-lg bg-canvas/70 px-3 py-2">
            <div className="mb-1 text-[13px] font-medium text-ink-700">动机</div>
            <dl className="space-y-1">{MOTIVES.map(field)}</dl>
          </div>

          <dl className="space-y-1">{TAIL.map(field)}</dl>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[13px] font-medium text-ink-700">关系备注</span>
              <Button variant="ghost" size="sm" disabled={!c.name.trim() || !others.length} onClick={() => setRelations([...relations, { a: c.name, b: others[0], kind: '', label: '' }])}>
                <Plus size={14} />
                添加关系
              </Button>
            </div>
            <ul className="space-y-1">
              {mine.map(({ r, i, other }) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="shrink-0 text-[13px] text-ink-500">与</span>
                  <Select
                    aria-label="关系人物"
                    value={other}
                    onChange={(e) => setRelations(relations.map((x, j) => (j === i ? (x.a === c.name ? { ...x, b: e.target.value } : { ...x, a: e.target.value }) : x)))}
                    className="h-8 w-32 text-[13px]"
                  >
                    {!others.includes(other) && <option value={other}>{other || '选择人物'}</option>}
                    {others.map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </Select>
                  <InlineInput
                    aria-label="关系类型"
                    list="relation-kinds"
                    value={r.kind}
                    onChange={(e) => setRelations(relations.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x)))}
                    placeholder="关系，如：爱人"
                    className="w-28"
                  />
                  <InlineInput aria-label="关系备注" value={r.label} onChange={(e) => setRelations(relations.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder="备注，如：信任其记录但不信任其判断" className="flex-1" />
                  <button className="rounded p-1.5 text-ink-300 hover:bg-red-50 hover:text-red-600" aria-label="删除关系" onClick={() => setRelations(relations.filter((_, j) => j !== i))}>
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
              {!mine.length && <li className="py-1 text-xs text-ink-400">{c.name.trim() ? '暂无关系' : '先填名字再添加关系'}</li>}
            </ul>
            <RelationKindList />
          </div>
        </div>
      )}
    </div>
  )
}

export default function CharactersStage({ project, blocked }: { project: Project; blocked: boolean }) {
  const patchWork = useProjects((s) => s.patchWork)
  const { running, run } = useAiTask()
  const [confirmRegen, setConfirmRegen] = useState(false)
  const [removing, setRemoving] = useState<Character | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [graphView, setGraphView] = useState<'graph' | 'table'>('graph')
  const { characters, relations } = project.work
  const selected = characters.find((c) => c.id === selectedId) ?? characters[0]
  const benchNames = project.mode !== 'original' && project.work.breakdown ? project.work.breakdown.characters.map((c) => c.name) : null

  const generate = async () => {
    const cur = latestProject(project.id)
    if (!cur) return
    const result = await run('characters', (signal) => draftCharacters(cur, nextSeed(), signal))
    if (!result) return
    patchWork(project.id, result, `AI 生成人物设定：${result.characters.length} 个角色`)
    setSelectedId(null)
    toast('人物已生成，名字与设定都可直接修改')
  }

  const update = (id: string, patch: Partial<Character>) => {
    const cur = latestProject(project.id)
    if (!cur) return
    const old = cur.work.characters.find((c) => c.id === id)?.name
    const rename = (n: string) => (patch.name !== undefined && n === old ? patch.name : n)
    patchWork(project.id, {
      characters: cur.work.characters.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      // 改名时关系网同步
      relations: patch.name !== undefined ? cur.work.relations.map((r) => ({ ...r, a: rename(r.a), b: rename(r.b) })) : cur.work.relations,
    })
  }

  const add = () => {
    const c = newCharacter()
    patchWork(project.id, { characters: [...characters, c] })
    setSelectedId(c.id)
  }

  const remove = (c: Character) => {
    const cur = latestProject(project.id)
    if (!cur) return
    patchWork(
      project.id,
      { characters: cur.work.characters.filter((x) => x.id !== c.id), relations: cur.work.relations.filter((r) => r.a !== c.name && r.b !== c.name) },
      `删除人物：${c.name || c.role}`,
    )
  }

  const pick = (id: string) => {
    setSelectedId(id)
    document.getElementById('character-bios')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <>
      <Card id="character-bios" className="scroll-mt-4">
        <CardHeader
          title="人物小传"
          desc="外形、服装、性格、背景、能力、动机（表面追求 / 终极渴望 / 潜意识恐惧）、缺陷、弧光与关系备注；写作时按这里约束人物言行"
          action={
            <div className="flex gap-2">
              {characters.length > 0 && (
                <Button variant="ghost" size="sm" onClick={add}>
                  <Plus size={14} />
                  添加人物
                </Button>
              )}
              <AiButton variant={characters.length ? 'secondary' : 'primary'} loading={running === 'characters'} disabled={blocked} onClick={() => (characters.length ? setConfirmRegen(true) : generate())}>
                {characters.length ? '重新生成' : 'AI 生成人物'}
              </AiButton>
            </div>
          }
        />
        {characters.length && selected ? (
          <>
            <div className="border-b border-line px-5 py-3">
              <CheckList items={characterChecks(project)} empty="人物配置完整" />
            </div>
            <div className="grid lg:grid-cols-[220px_minmax(0,1fr)]">
              <ul className="space-y-0.5 border-b border-line p-2 lg:border-r lg:border-b-0">
                {characters.map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => setSelectedId(c.id)}
                      className={clsx('flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left', c.id === selected.id ? 'bg-brand-50' : 'hover:bg-canvas')}
                    >
                      <span className={clsx('mt-1.5 size-2 shrink-0 rounded-full', ROLE_DOT[c.role])} />
                      <span className="min-w-0">
                        <span className={clsx('block truncate text-[13px] font-medium', c.id === selected.id ? 'text-brand-700' : 'text-ink-900')}>{c.name || '未命名'}</span>
                        <span className="block truncate text-xs text-ink-500">
                          {c.role}
                          {c.profile && ` · ${c.profile}`}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <CharacterEditor key={selected.id} project={project} c={selected} benchNames={benchNames} onChange={(patch) => update(selected.id, patch)} onRemove={() => setRemoving(selected)} />
            </div>
          </>
        ) : (
          <EmptyState
            icon={<Users size={22} />}
            title="还没有人物"
            desc={blocked ? '确认故事架构后即可由 AI 生成人物小传' : 'AI 会按故事架构生成主角、暧昧对象、反派与关键配角，仿写项目自动避开对标剧人名'}
            action={
              <Button variant="secondary" onClick={add}>
                <Plus size={15} />
                手动添加
              </Button>
            }
          />
        )}
      </Card>

      {characters.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader
            title="人物关系图"
            desc="关系类型按剧本描述填写（爱人、同学、宿敌…），在人物小传的关系备注里修改；点人物可跳到对应小传"
            action={
              <Segmented
                value={graphView}
                onChange={setGraphView}
                options={[
                  { value: 'graph', label: '关系图' },
                  { value: 'table', label: '关系表' },
                ]}
              />
            }
          />
          {graphView === 'graph' ? (
            <div className="space-y-3 px-5 pt-3 pb-4">
              <RelationLegend />
              {relations.length ? (
                <RelationGraph characters={characters} relations={relations} selectedId={selected?.id} onSelect={pick} />
              ) : (
                <p className="py-8 text-center text-[13px] text-ink-400">还没有关系：在人物小传的「关系备注」里添加</p>
              )}
            </div>
          ) : relations.length ? (
            <Table columns={['人物', '关系', '人物', '备注']} minWidth={560}>
              {relations.map((r, i) => (
                <tr key={i}>
                  <td className="px-4 py-2.5 whitespace-nowrap">{r.a || '—'}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <span className="flex items-center gap-1.5">
                      <span className="h-0.5 w-3 rounded-full" style={{ background: RELATION_GROUPS[relationGroup(r.kind)].color }} />
                      {r.kind || <span className="text-ink-300">未填</span>}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">{r.b || '—'}</td>
                  <td className="px-4 py-2.5 text-ink-700">{r.label || <span className="text-ink-300">—</span>}</td>
                </tr>
              ))}
            </Table>
          ) : (
            <p className="px-5 py-6 text-[13px] text-ink-400">还没有关系</p>
          )}
        </Card>
      )}

      <ConfirmDialog
        open={confirmRegen}
        onClose={() => setConfirmRegen(false)}
        onConfirm={generate}
        title="重新生成人物？"
        desc="当前人物与关系网会被替换；已写的大纲和剧本不会自动改名。"
        confirmText="重新生成"
      />
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove(removing)}
        danger
        title="删除人物？"
        desc={`「${removing?.name || removing?.role}」及其相关的人物关系会被删除。`}
        confirmText="删除"
      />
    </>
  )
}
