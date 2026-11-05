import { Plus, Trash2, UserPlus } from 'lucide-react'
import { InlineInput } from '../stage/StageKit'
import { Button } from '../ui'
import type { CastLook } from '../../domain/types'

/**
 * 蓝图里的「人物本集状态」：一行一场——谁、在哪个场景进来、服化道重点。
 * 写作按它写，状态库与导出的剧本开头也按它列，方便拆资产。
 */
export function LooksEditor({ looks, cast, onChange }: { looks: CastLook[]; cast: string[]; onChange: (looks: CastLook[]) => void }) {
  const missing = cast.filter((n) => !looks.some((l) => l.name === n))
  const set = (i: number, patch: Partial<CastLook>) => onChange(looks.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  return (
    <div data-looks-editor>
      <div className="overflow-hidden rounded-lg border border-line">
        <table className="w-full table-fixed text-[13px]">
          <colgroup>
            <col className="w-[22%]" />
            <col className="w-[28%]" />
            <col />
            <col className="w-9" />
          </colgroup>
          <thead>
            <tr className="border-b border-line text-left text-xs text-ink-500">
              <th className="px-3 py-2 font-medium">人物</th>
              <th className="px-3 py-2 font-medium">进场的场景</th>
              <th className="px-3 py-2 font-medium">服化道重点</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {looks.map((l, i) => (
              <tr key={i}>
                <td className="px-1 py-1">
                  <InlineInput aria-label="人物" value={l.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="人物" />
                </td>
                <td className="px-1 py-1">
                  <InlineInput aria-label="进场的场景" value={l.scene} onChange={(e) => set(i, { scene: e.target.value })} placeholder="如：豪门住宅客厅" />
                </td>
                <td className="px-1 py-1">
                  <InlineInput aria-label="服化道重点" value={l.look} onChange={(e) => set(i, { look: e.target.value })} placeholder="如：白色晚礼服，盘发，戴月石吊坠" />
                </td>
                <td className="px-1 py-1 text-center">
                  <button type="button" aria-label={`删除${l.name || '这一行'}`} onClick={() => onChange(looks.filter((_, j) => j !== i))} className="rounded p-1 text-ink-300 hover:bg-red-50 hover:text-red-600">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
            {!looks.length && (
              <tr>
                <td colSpan={4} className="px-3 py-2.5 text-xs text-ink-400">
                  还没有登记；同一个人换场换装就多加一行
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        <Button variant="ghost" size="sm" onClick={() => onChange([...looks, { name: '', scene: '', look: '' }])}>
          <Plus size={14} />
          加一行
        </Button>
        {missing.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => onChange([...looks, ...missing.map((name) => ({ name, scene: '', look: '' }))])}>
            <UserPlus size={14} />
            补上出场关键人（{missing.join('、')}）
          </Button>
        )}
      </div>
    </div>
  )
}
