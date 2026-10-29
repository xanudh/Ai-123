#!/usr/bin/env node
// 把改完的标注标记为已完成，并重新生成 feedback.md；开着的页面会收到通知自动刷新清单
// 用法：node devtools/annotator/done.mjs <编号> "<改了什么>" [<编号> "<改了什么>" ...]
//       node devtools/annotator/done.mjs --reopen <编号> [<编号> ...]
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { toMarkdown } from './feedback.js'

const dir = join(process.cwd(), 'annotations')
const file = join(dir, 'feedback.json')
const args = process.argv.slice(2)
const reopen = args[0] === '--reopen'

const store = JSON.parse(await readFile(file, 'utf8'))
const at = new Date().toISOString()
const missing = []
const marked = []

const find = (n) => store.annotations.find((a) => a.n === Number(n))
if (reopen) {
  for (const n of args.slice(1)) {
    const a = find(n)
    if (!a) missing.push(n)
    else {
      delete a.status
      delete a.doneAt
      delete a.doneNote
      marked.push(n)
    }
  }
} else {
  for (let i = 0; i < args.length; i += 2) {
    const a = find(args[i])
    if (!a) missing.push(args[i])
    else {
      Object.assign(a, { status: 'done', doneAt: at, doneNote: (args[i + 1] ?? '').trim() })
      marked.push(args[i])
    }
  }
}

if (!marked.length) {
  console.error(missing.length ? `找不到标注 #${missing.join('、#')}` : '用法：node devtools/annotator/done.mjs <编号> "<改了什么>" …')
  process.exit(1)
}
store.updatedAt = at
await writeFile(file, JSON.stringify(store, null, 2))
await writeFile(join(dir, 'feedback.md'), toMarkdown(store))
console.log(`${reopen ? '已重新打开' : '已标记完成'}：#${marked.join('、#')}${missing.length ? `；找不到 #${missing.join('、#')}` : ''}`)
