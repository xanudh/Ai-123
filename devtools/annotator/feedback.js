// 标注数据 → feedback.md：开发服务器（vite-plugin.js）、页面标注工具（client.ts）、命令行（done.mjs）共用
// 已完成的标注只在文末列一行，正文只写待处理的，读的人看一眼就知道这轮要改什么

// 时间按标注者浏览器的时区显示（store.tz），开发服务器 / 命令行所在机器的时区可能不同
export const fmtTime = (iso, tz) => (iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false, timeZone: tz || undefined }) : '')
export const clip = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s)
export const isDone = (a) => a.status === 'done'
export const sortedOf = (store) => [...store.annotations].sort((a, b) => a.n - b.n)

export function groupByRoute(list) {
  const groups = []
  for (const a of list) {
    let g = groups.find((x) => x.route === a.route)
    if (!g) groups.push((g = { route: a.route, items: [] }))
    g.items.push(a)
  }
  return groups
}

export function targetLabel(a) {
  if (a.kind === 'page') return '页面整体'
  if (a.kind === 'region') return `框选区域 ${a.region?.w}×${a.region?.h}`
  const t = a.target
  return t ? `<${t.tag}> ${t.text ? '“' + clip(t.text, 30) + '”' : ''}` : '元素'
}

export function toMarkdown(store) {
  const list = sortedOf(store)
  const open = list.filter((a) => !isDone(a))
  const done = list.filter(isDone)
  const groups = groupByRoute(open)
  const L = [
    '# 页面标注反馈',
    '',
    `- 更新时间：${fmtTime(store.updatedAt, store.tz)}${store.submittedAt ? `（${fmtTime(store.submittedAt, store.tz)} 点击了“完成并发送”）` : ''}`,
    `- 待处理 ${open.length} 条，涉及 ${groups.length} 个页面${done.length ? `；已完成 ${done.length} 条（列在文末）` : ''}${store.origin ? `；页面地址前缀 ${store.origin}` : ''}`,
    '',
  ]
  groups.forEach((g, gi) => {
    L.push(`## ${gi + 1}. \`${g.route}\``, '')
    for (const a of g.items) {
      L.push(`### #${a.n} 【${a.type}】${targetLabel(a)}`, '')
      L.push(...(a.comment ? a.comment.split('\n').map((s) => '> ' + s) : ['> （无文字说明）']), '')
      const t = a.target
      if (t) {
        const attrs = Object.entries(t.attrs).map(([k, v]) => `${k}="${v}"`).join(' ')
        const text = a.kind === 'region' ? clip(t.text, 30) : t.text
        const el = `\`<${t.tag}${attrs ? ' ' + attrs : ''}>\`${text ? ` “${text}”` : ''}`
        L.push(a.kind === 'region' ? `- 框选中心元素：${el}` : `- 元素：${el}`)
        if (t.components.length) L.push(`- 组件链：${t.components.join(' › ')}`)
        if (t.sources.length) L.push(`- 源码线索：${t.sources.join(' ← ')}`)
        L.push(`- 选择器：\`${t.selector}\``)
      }
      if (a.region) {
        L.push(`- 框选范围：${a.region.w}×${a.region.h}，相对 \`${a.region.anchor}\` 偏移 (${a.region.dx}, ${a.region.dy})`)
        if (a.region.texts.length) L.push(`- 区域内文字：${a.region.texts.map((s) => `“${s}”`).join('、')}`)
      }
      const r = t?.rect
      L.push(`- 视口 ${a.viewport.w}×${a.viewport.h}${r && a.kind === 'element' ? `，元素位于 (${r.x}, ${r.y}) 尺寸 ${r.w}×${r.h}` : ''}`, '')
    }
  })
  if (done.length) {
    L.push('## 已完成', '')
    for (const a of done) {
      const what = a.comment ? clip(a.comment.replace(/\s+/g, ' '), 40) : targetLabel(a)
      L.push(`- #${a.n} 【${a.type}】${what}（\`${a.route}\`${a.doneAt ? `，${fmtTime(a.doneAt, store.tz)}` : ''}）${a.doneNote ? `：${a.doneNote}` : ''}`)
    }
    L.push('')
  }
  return L.join('\n')
}
