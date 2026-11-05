import clsx from 'clsx'
import { ClipboardCopy, History } from 'lucide-react'
import { Fragment, useMemo, useState } from 'react'
import raw from '../../../docs/字段变更日志.md?raw'
import { toast } from '../../store/toast'
import { Modal } from '../overlay'
import { Badge, Button } from '../ui'

/** 一条改动：「类型｜位置｜内容」 */
interface Entry {
  kind: string
  where: string
  what: string
}

interface Section {
  title: string
  groups: { title: string; entries: Entry[] }[]
}

/** 日志只有一份：docs/字段变更日志.md，这里按它的写法拆成「日期 → 字段 / 页面与功能 → 一条条改动」 */
function parseLog(md: string): { intro: string; sections: Section[] } {
  const intro: string[] = []
  const sections: Section[] = []
  for (const line of md.split('\n').map((l) => l.trim())) {
    if (!line || line.startsWith('# ')) continue
    if (line.startsWith('## ')) sections.push({ title: line.slice(3), groups: [] })
    else if (line.startsWith('### ')) sections.at(-1)?.groups.push({ title: line.slice(4), entries: [] })
    else if (line.startsWith('- ')) {
      const sec = sections.at(-1)
      if (!sec) continue
      if (!sec.groups.length) sec.groups.push({ title: '', entries: [] })
      // 「类型｜位置｜内容」；只有两段的是「类型｜内容」
      const parts = line.slice(2).split('｜')
      const entry = parts.length >= 3 ? { kind: parts[0], where: parts[1], what: parts.slice(2).join('｜') } : parts.length === 2 ? { kind: parts[0], where: '', what: parts[1] } : { kind: '', where: '', what: parts[0] }
      sec.groups.at(-1)!.entries.push(entry)
    } else if (!sections.length) intro.push(line)
  }
  return { intro: intro.join(''), sections }
}

const kindTone = (kind: string) =>
  kind.startsWith('新增') ? 'green' : kind.startsWith('删除') ? 'red' : kind.includes('必填') ? 'amber' : kind.startsWith('不进') ? 'gray' : 'violet'

/** 行内的 `字段名` 显示成代码样式 */
const Inline = ({ text }: { text: string }) => (
  <>
    {text.split('`').map((part, i) =>
      i % 2 ? (
        <code key={i} className="rounded bg-ink-900/[0.05] px-1 py-px font-mono text-[11.5px] text-ink-800">
          {part}
        </code>
      ) : (
        <Fragment key={i}>{part}</Fragment>
      ),
    )}
  </>
)

/** 「我的剧本」页头的更新日志：每轮原型改了哪些字段、哪些页面加了什么，前后端对齐用 */
export function ChangelogButton() {
  const [open, setOpen] = useState(false)
  const log = useMemo(() => parseLog(raw), [])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(raw)
      toast('已复制更新日志，可以直接发给开发')
    } catch {
      toast('复制失败，请手动选中文字复制', 'error')
    }
  }
  return (
    <>
      <Button variant="secondary" data-changelog-open onClick={() => setOpen(true)}>
        <History size={16} />
        更新日志
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        width={760}
        title="更新日志"
        desc={<Inline text={log.intro} />}
        footer={
          <>
            <Button variant="secondary" onClick={copy}>
              <ClipboardCopy size={14} />
              复制全文
            </Button>
            <Button onClick={() => setOpen(false)}>知道了</Button>
          </>
        }
      >
        <div data-changelog className="scrollbar-thin -mx-6 max-h-[64vh] space-y-6 overflow-y-auto px-6">
          {log.sections.map((s, si) => (
            <section key={si}>
              <h3 className="sticky top-0 z-[1] bg-white pb-2 text-[14px] font-semibold text-ink-900">{s.title}</h3>
              <div className="space-y-4">
                {s.groups.map((g, gi) => (
                  <div key={gi}>
                    {g.title && <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-ink-400">{g.title}</div>}
                    <ul className="divide-y divide-line rounded-lg border border-line">
                      {g.entries.map((e, ei) => (
                        <LogRow key={ei} e={e} />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </Modal>
    </>
  )
}

function LogRow({ e }: { e: Entry }) {
  return (
    <li data-log-kind={e.kind} className={clsx('grid gap-x-3 gap-y-0.5 px-3 py-2 text-[12.5px] leading-5', e.kind ? 'grid-cols-[88px_minmax(0,1fr)]' : 'grid-cols-1')}>
      {e.kind && (
        <span className="pt-px">
          <Badge tone={kindTone(e.kind)}>{e.kind}</Badge>
        </span>
      )}
      <div className="min-w-0">
        {e.where && <div className="font-medium text-ink-900">{e.where}</div>}
        <div className="text-ink-600">
          <Inline text={e.what} />
        </div>
      </div>
    </li>
  )
}
