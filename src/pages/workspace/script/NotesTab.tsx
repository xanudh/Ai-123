/** 状态库侧栏「标注」标签页：给正文里选中的一行加标注，列出已有标注。草稿页与定稿页共用 */
import { useState } from 'react'
import { Button, Input } from '../../../components/ui'
import type { LineNote, ScriptLine } from '../../../domain/types'
import { newId } from '../../../lib/id'
import type { LinePick, Updater } from './ScriptEditor'

export function NotesTab({ lines, notes, pick, onNotes, footer }: { lines: ScriptLine[]; notes: LineNote[]; pick: LinePick | null; onNotes: Updater<LineNote>; footer: string }) {
  const [text, setText] = useState('')
  const pickAt = pick ? lines.findIndex((l) => l.id === pick.lineId) : -1

  const add = () => {
    const t = text.trim()
    const line = lines[pickAt]
    if (!t || !pick || !line) return
    onNotes((ns) => [...ns, { id: newId(), lineId: line.id, quote: pick.quote || line.zh, text: t, at: new Date().toISOString() }])
    setText('')
  }

  return (
    <div className="px-4">
      {pickAt >= 0 ? (
        <div className="mb-3">
          <p className="mb-1.5 truncate text-xs text-ink-400">
            标注第 {pickAt + 1} 行{pick?.quote ? `「${pick.quote}」` : ''}
          </p>
          <div className="flex gap-1.5">
            <Input
              aria-label="标注内容"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && add()}
              placeholder="这段有什么问题？"
              className="h-8 text-[13px]"
            />
            <Button size="sm" variant="secondary" disabled={!text.trim()} onClick={add}>
              标注
            </Button>
          </div>
        </div>
      ) : (
        <p className="mb-3 text-xs text-ink-400">点选正文一行即可标注</p>
      )}
      {notes.length > 0 && (
        <>
          <ul className="space-y-1.5">
            {notes.map((n) => {
              const at = lines.findIndex((l) => l.id === n.lineId)
              return (
                <li key={n.id} className="text-[12.5px] leading-5">
                  <span className="mr-1 text-ink-400 tabular-nums">{at >= 0 ? `第 ${at + 1} 行` : '原行已删除'}</span>
                  <span className="text-ink-900">{n.text}</span>
                </li>
              )
            })}
          </ul>
          <p className="mt-2 text-xs text-ink-400">{footer}</p>
        </>
      )}
    </div>
  )
}
