// 用 Chrome DevTools Protocol 驱动无头 Chrome 做端到端检查（Node 24 自带 WebSocket）
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = 'http://127.0.0.1:5173'
const OUT = process.argv[2] ?? '/tmp/jb_out/e2e'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9333

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const profile = mkdtempSync(join(tmpdir(), 'jb-e2e-'))
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, '--window-size=1440,1000', 'about:blank',
], { stdio: 'ignore' })

let targets
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (targets.some((t) => t.type === 'page')) break } catch {}
  await sleep(200)
}
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))

let seq = 0
const pending = new Map()
const problems = []
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data)
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return }
  if (msg.method === 'Runtime.exceptionThrown') problems.push('exception: ' + msg.params.exceptionDetails.exception?.description)
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    problems.push(`console.${msg.params.type}: ` + msg.params.args.map((a) => a.value ?? a.description).join(' '))
  }
})
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq
  pending.set(id, (m) => (m.error ? reject(new Error(method + ': ' + m.error.message)) : resolve(m.result)))
  ws.send(JSON.stringify({ id, method, params }))
})
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  return r.result.value
}
const waitFor = async (expr, label, timeout = 4000) => {
  const end = Date.now() + timeout
  while (Date.now() < end) { if (await evaluate(`!!(${expr})`)) return; await sleep(80) }
  throw new Error('等待超时：' + label)
}
const goto = async (path) => { await send('Page.navigate', { url: BASE + path }); await waitFor('document.querySelector("#root > *")', 'render ' + path) }
const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, name + '.png'), Buffer.from(data, 'base64'))
}

// 页面内工具函数

// 页面内工具函数
const helpers = `
window.__t = {
  find(sel, text) { return [...document.querySelectorAll(sel)].find((e) => e.textContent.trim() === text) ?? [...document.querySelectorAll(sel)].find((e) => e.textContent.includes(text)) },
  click(sel, text) { const el = this.find(sel, text); if (!el) throw new Error('找不到 ' + sel + ' ' + text); el.click(); return true },
  type(el, v) { const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); return true },
  // 数字输入框：先 type，下一轮再 enter（等 React 把输入渲染进状态）
  enter(el) { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true },
  // React 的 onBlur 监听 focusout
  blur(el) { el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); return true },
  has(text) { return document.body.innerText.includes(text) },
  // 多选下拉框：n 为页面上第几个下拉框（0 起），打开后点选项
  pick(n, ...opts) { document.querySelectorAll('[aria-haspopup=listbox]')[n].click(); return opts },
  // 文本 a 在页面上出现在文本 b 之前
  before(a, b) { const t = document.querySelector('main').innerText; const i = t.indexOf(a); const j = t.indexOf(b); return i >= 0 && j >= 0 && i < j },
}`
const t = (code) => evaluate(`(${'() => { ' + helpers + '; return ' + code + ' }'})()`)

const results = []
const check = async (name, fn) => {
  try { await fn(); results.push(['PASS', name]) } catch (e) { results.push(['FAIL', name, e.message]); await shot('fail-' + results.length).catch(() => {}) }
}

const KEY = 'zhiying.projects.v1'
const projects = () => evaluate(`JSON.parse(localStorage.getItem('${KEY}')).state.projects`)
let projectId = ''
let projectPath = ''
const project = async () => (await projects()).find((p) => p.id === projectId)
/** 直接改本地存储后重新加载页面（store 从存储重新水合） */
const patchStored = async (fn, path) => {
  await evaluate(`(async () => { const raw = JSON.parse(localStorage.getItem('${KEY}')); const p = raw.state.projects.find((x) => x.id === '${projectId}'); await (${fn})(p); localStorage.setItem('${KEY}', JSON.stringify(raw)) })()`)
  await goto(path)
}
const pick = async (n, ...opts) => {
  await t(`__t.pick(${n})`)
  await waitFor(`document.querySelector('[role=listbox]')`, '下拉展开')
  for (const o of opts) await t(`__t.click('[role=option]', '${o}')`)
  await evaluate(`document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`)
  await waitFor(`!document.querySelector('[role=listbox]')`, '下拉收起')
}
/** 带页面工具函数的等待：表达式里可以用 __t */
const until = (expr, label, timeout) => waitFor(`(() => { ${helpers}; return ${expr} })()`, label, timeout)
const dialog = (text) => `[...document.querySelectorAll('[role=dialog]')].some((d) => d.innerText.includes('${text}'))`

await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
await goto('/'); await evaluate('localStorage.clear()'); await goto('/projects/new')

/* ---------------------------------- 立项 ---------------------------------- */

await check('立项：未填必填项不能创建，逐项报错', async () => {
  await t(`__t.click('button', '创建剧本')`)
  await until(`__t.has('请填写剧本名称') && __t.has('至少选择 1 个题材元素')`, '必填报错')
  if (!(await t(`__t.has('还有 2 处需要修改')`))) throw new Error('底部未汇总报错数')
})
await check('立项：核心设定替代一句话灵感；单集时长（秒）为输入框，与总集数同一行', async () => {
  await goto('/projects/new')
  if (await t(`__t.has('一句话灵感') || __t.has('每集字数')`)) throw new Error('仍有一句话灵感或每集字数')
  if (!(await t(`__t.has('核心设定')`))) throw new Error('缺少核心设定')
  const seconds = `document.querySelector('input[aria-label=单集时长]')`
  if ((await evaluate(`${seconds}?.value`)) !== '90') throw new Error('单集时长默认应为 90 秒')
  if (!(await t(`__t.has('约 ') && __t.has('逐集剧本按此控制篇幅')`))) throw new Error('单集时长下没有换算字数提示')
  const [a, b] = await evaluate(`['总集数', '单集时长'].map((l) => document.querySelector('input[aria-label=' + l + ']')?.getBoundingClientRect().top)`)
  if (a == null || b == null || Math.round(a) !== Math.round(b)) throw new Error('总集数 / 单集时长不在同一行：' + [a, b])
})
await check('立项：题材下拉最多选 4 个，基调最多 3 个', async () => {
  await pick(0, '重生', '复仇', '霸总', '狼人')
  await t(`__t.pick(0)`)
  await waitFor(`document.querySelector('[role=listbox]')`, '下拉展开')
  const disabled = await evaluate(`[...document.querySelectorAll('[role=option]')].filter((o) => o.disabled).length`)
  if (disabled !== 16) throw new Error('选满 4 个后应禁用其余 16 项，实际 ' + disabled)
  await t(`__t.click('[role=option]', '狼人')`)
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
  await waitFor(`!document.querySelector('[role=listbox]')`, 'Esc 收起')
  await waitFor(`document.body.innerText.includes('已选 3')`, '取消一项后已选 3')
  await pick(1, '爽感', '虐心', '甜宠', '悬疑')
  const tones = await evaluate(`[...document.querySelectorAll('[aria-haspopup=listbox]')[1].querySelectorAll('span span')].map((e) => e.textContent)`)
  if (tones.join() !== '爽感,虐心,甜宠') throw new Error('基调应只选上前 3 个：' + tones)
})
await check('立项：AI 生成核心设定候选并选用', async () => {
  await t(`__t.click('button', '生成候选')`)
  await waitFor(`document.body.innerText.includes('爽点公式：')`, '候选', 5000)
  await t(`document.querySelector('li button').click()`)
  await waitFor(`document.querySelector('textarea').value.length > 10`, '选用候选')
  await shot('new-candidates')
})
await check('立项：单集时长越界报错，改好后创建并在概览显示时长', async () => {
  const seconds = `document.querySelector('input[aria-label=单集时长]')`
  await t(`__t.type(document.querySelector('input[maxlength="30"]'), '端到端测试剧')`)
  await t(`__t.type(${seconds}, '20')`)
  await t(`__t.click('button', '创建剧本')`)
  await waitFor(`document.body.innerText.includes('单集时长需在 30–300 秒之间')`, '时长报错')
  await t(`__t.type(${seconds}, '120')`)
  await shot('new-form')
  await t(`__t.click('button', '创建剧本')`)
  await waitFor(`/\\/projects\\/[\\w-]+$/.test(location.pathname) && document.body.innerText.includes('端到端测试剧')`, '跳转到工作台')
  await waitFor(`document.body.innerText.includes('剧本已创建')`, 'toast')
  projectPath = await evaluate('location.pathname')
  projectId = projectPath.split('/').pop()
  const p = await project()
  if (p.spec.episodeSeconds !== 120 || 'episodeWords' in p.spec) throw new Error('规格未按秒保存：' + JSON.stringify(p.spec))
  if (!p.logline || p.logline.length < 10) throw new Error('核心设定未保存')
  if (!(await t(`__t.has('2 分钟 · 约')`))) throw new Error('概览应显示单集时长与换算字数')
  if (!(await t(`__t.before('项目设定', '故事架构卡')`))) throw new Error('概览应先项目设定（左）、再故事架构卡（右）')
  await evaluate(`[...document.querySelectorAll('h2,h3')].find((h) => h.textContent === '项目设定')?.scrollIntoView({ block: 'start' })`)
  await shot('created-overview')
})

/* -------------------------------- 故事架构 -------------------------------- */

const arch = async () => (await project()).work.architecture
await check('故事架构：核心大纲顺序为 核心设定 → 3 个方向 → 爽点公式（选填）→ 创新点 → 冲突主线 → 节奏框架', async () => {
  await goto(projectPath + '/stage/architecture')
  await waitFor(`document.querySelector('textarea[aria-label=核心设定]')`, '核心设定输入框')
  if (await t(`__t.has('一句话想法') || __t.has('每集字数')`)) throw new Error('仍有一句话想法或每集字数')
  if (!(await evaluate(`!!document.querySelector('input[aria-label=单集时长]')`))) throw new Error('基本信息缺少单集时长输入框')
  const seq = ['AI 给出 3 个方向', '选填：每 X 集一次什么爽感', '同类爆款怎么做 → 我们怎么做', '默认五段式：段落可增删', '按冲突主线分段生成']
  for (let i = 1; i < seq.length; i++) {
    if (!(await t(`__t.before(${JSON.stringify(seq[i - 1])}, ${JSON.stringify(seq[i])})`))) throw new Error(`「${seq[i - 1]}」应在「${seq[i]}」之前`)
  }
})
await check('故事架构：冲突主线未填完时不能生成节奏框架', async () => {
  if (!(await t(`__t.find('button', '生成节奏框架').disabled`))) throw new Error('主线为空时「生成节奏框架」应禁用')
  if (!(await t(`__t.has('先定冲突主线，再点「生成节奏框架」')`))) throw new Error('缺少先定主线的提示')
})
await check('故事架构：AI 3 个方向在弹窗里对比，选一个点「确定录入」才写入', async () => {
  await t(`__t.click('button', 'AI 给出 3 个方向')`)
  await waitFor(dialog('AI 给出的 3 个方向'), '方向弹窗', 5000)
  const cards = await evaluate(`[...document.querySelectorAll('[role=radiogroup] label')].map((l) => l.innerText)`)
  if (cards.length !== 3) throw new Error('应有 3 个方向：' + cards.length)
  for (const c of cards) for (const h of ['整体框架', '核心设定', '冲突主线', '创新点']) if (!c.includes(h)) throw new Error('方向卡缺少「' + h + '」')
  if ((await arch())?.plan) throw new Error('弹窗打开时不应写入')
  if (!(await t(`__t.find('[role=dialog] button', '确定录入').disabled`))) throw new Error('未选方向时「确定录入」应禁用')
  await evaluate(`document.querySelectorAll('[role=radiogroup] input[type=radio]')[1].click()`)
  await until(`!__t.find('[role=dialog] button', '确定录入').disabled`, '选中后可录入')
  await sleep(300)
  await shot('architecture-directions')
  await t(`__t.click('[role=dialog] button', '确定录入')`)
  await waitFor(`!${dialog('AI 给出的 3 个方向')}`, '弹窗关闭')
  const a = await arch()
  const p = await project()
  if (!a.plan || a.innovations.length < 3 || a.mainLine.some((b) => !b.content.trim())) throw new Error('方向未完整录入：' + JSON.stringify({ plan: a.plan.length, inn: a.innovations.length }))
  if (!cards[1].includes(p.logline)) throw new Error('录入的核心设定不是选中的方向')
})
await check('故事架构：冲突主线可改集数，按主线生成节奏框架，主线设定显示在折线图下方', async () => {
  const end = `document.querySelector('input[aria-label$=结束集]')`
  // 增删段的操作列在最前面
  const firstCell = await evaluate(`${end}.closest('tr').querySelector('td').querySelector('button')?.getAttribute('aria-label') ?? ''`)
  if (!firstCell.includes('后新增一段')) throw new Error('冲突主线第一列应是增删段操作：' + firstCell)
  await evaluate(`${end}.closest('table').scrollIntoView({ block: 'center' })`)
  await sleep(200)
  await shot('architecture-mainline')
  await t(`__t.type(${end}, '8')`)
  await t(`__t.blur(${end})`)
  await waitFor(`JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').work.architecture.phaseEnds?.[0] === 8`, '第一段结束集写回')
  await t(`__t.click('button', '生成节奏框架')`)
  await waitFor(`document.body.innerText.includes('节奏框架已按冲突主线生成')`, '生成 toast')
  const p = await project()
  const ends = p.work.architecture.phaseEnds
  if (p.rhythm.paywalls.join() !== ends.slice(0, 4).join() || p.rhythm.climaxFrom !== ends[3] + 1) throw new Error('节奏未按主线分段：' + JSON.stringify({ rhythm: p.rhythm, ends }))
  const [chartTop, stripTop] = await evaluate(`(() => {
    const strip = [...document.querySelectorAll('span')].find((s) => s.textContent === '冲突主线设定')
    const block = strip.closest('.rounded-lg.border')
    const chart = [...block.querySelectorAll('svg')].sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0]
    return [chart.getBoundingClientRect().top, strip.getBoundingClientRect().top]
  })()`)
  if (!(stripTop > chartTop)) throw new Error('冲突主线设定应在折线图下方')
  if (!(await t(`__t.has('付费卡点落在每段结尾')`))) throw new Error('未提示节奏与主线对齐')
  await evaluate(`[...document.querySelectorAll('span')].find((s) => s.textContent === '冲突主线设定').scrollIntoView({ block: 'center' })`)
  await shot('architecture-rhythm')
  // 悬停提示半透明，不挡住后面的节点
  const hit = await evaluate(`(() => { const b = document.querySelector('svg rect[fill=transparent]').getBoundingClientRect(); return { x: b.left + b.width * 0.3, y: b.top + b.height * 0.5 } })()`)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...hit })
  await waitFor(`document.body.innerText.includes('点击切换该集节点')`, '悬停提示')
  const alpha = await evaluate(`Number(getComputedStyle([...document.querySelectorAll('div')].find((d) => d.textContent.endsWith('点击切换该集节点') && d.classList.contains('absolute'))).backgroundColor.match(/[\\d.]+(?=\\)$)/)?.[0] ?? 1)`)
  if (!(alpha < 0.8)) throw new Error('悬停提示仍不透明：' + alpha)
  await shot('architecture-rhythm-tooltip')
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 })
})
await check('故事架构：冲突主线 AI 生成先确认再覆盖，分段保留', async () => {
  const btn = `(() => { const head = [...document.querySelectorAll('span')].find((s) => s.textContent.startsWith('冲突主线') && s.textContent.includes('五段式')); return [...head.parentElement.querySelectorAll('button')].find((b) => b.textContent.includes('AI 生成')) })()`
  await evaluate(`${btn}.click()`)
  await waitFor(dialog('重新生成冲突主线？'), '覆盖确认')
  await t(`__t.click('[role=dialog] button', '重新生成')`)
  await waitFor(`!${dialog('重新生成冲突主线？')} && !${btn}.disabled`, '生成完成', 5000)
  const a = await arch()
  if (a.phaseEnds?.[0] !== 8 || a.mainLine.some((b) => !b.content.trim())) throw new Error('重新生成后分段或剧情不对：' + JSON.stringify(a.phaseEnds))
})
await check('故事架构：爽点公式非必填，清空后仍可确认', async () => {
  await t(`__t.type(document.querySelector('input[aria-label=爽点公式]'), '')`)
  await t(`__t.click('button', '确认故事架构')`)
  await waitFor(`document.body.innerText.includes('故事架构已确认')`, '确认 toast')
  if ((await arch()).status !== 'approved') throw new Error('架构未确认')
})

/* -------------------------------- 人物设定 -------------------------------- */

const graph = `document.querySelector('svg[aria-label^=人物关系图]')`
await check('人物设定：关系备注带关系类型，人物关系图按类型标注连线', async () => {
  await goto(projectPath + '/stage/characters')
  await t(`__t.click('button', 'AI 生成人物')`)
  await waitFor(`JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').work.characters.length > 0`, '人物生成', 6000)
  const p = await project()
  if (!p.work.relations.length || p.work.relations.some((r) => !r.kind)) throw new Error('关系缺少类型：' + JSON.stringify(p.work.relations))
  if (!(await evaluate(`document.querySelectorAll('#relation-kinds option').length > 5`))) throw new Error('关系类型缺少候选')
  await waitFor(graph, '关系图')
  const label = await evaluate(`${graph}.getAttribute('aria-label')`)
  if (!label.includes(`${p.work.relations.length} 条关系`)) throw new Error('关系图连线数不对：' + label)
  const pills = await evaluate(`[...${graph}.querySelectorAll('text')].map((e) => e.textContent)`)
  for (const r of p.work.relations) if (!pills.includes(r.kind)) throw new Error('连线上没有标出「' + r.kind + '」')
  if (!(await t(`__t.has('情感') && __t.has('亲属') && __t.has('敌对')`))) throw new Error('缺少图例')
  await evaluate(`${graph}.scrollIntoView({ block: 'center' })`)
  await shot('characters-graph')
})
await check('人物设定：改关系类型同步到关系图与关系表；点人物跳到小传', async () => {
  const kind = `document.querySelector('input[aria-label=关系类型]')`
  await t(`__t.type(${kind}, '同学')`)
  await waitFor(`[...${graph}.querySelectorAll('text')].some((e) => e.textContent === '同学')`, '关系图更新')
  await t(`__t.click('button[aria-pressed]', '关系表')`)
  await waitFor(`[...document.querySelectorAll('th')].some((e) => e.textContent === '关系') && [...document.querySelectorAll('td')].some((e) => e.textContent.includes('同学'))`, '关系表')
  await t(`__t.click('button[aria-pressed]', '关系图')`)
  await waitFor(graph, '切回关系图')
  const name = await evaluate(`(() => { const g = ${graph}.querySelectorAll('g[role=button]')[1]; g.dispatchEvent(new MouseEvent('click', { bubbles: true })); return g.getAttribute('aria-label').split('：')[1] })()`)
  await waitFor(`document.querySelector('input[aria-label=人物名]').value === ${JSON.stringify(name)}`, '小传切换到 ' + name)
})

/* ------------------------------ 大纲 → 伏笔 ------------------------------ */

await check('创作流程：情节大纲在伏笔线索之前，大纲未定时不能埋伏笔', async () => {
  const nav = await evaluate(`[...document.querySelectorAll('nav ol a')].map((a) => a.textContent)`)
  const [o, f] = [nav.findIndex((x) => x.includes('情节大纲')), nav.findIndex((x) => x.includes('伏笔与叙事线索'))]
  if (o < 0 || f < 0 || o > f) throw new Error('环节顺序不对：' + nav.join(' / '))
  await goto(projectPath + '/stage/foreshadow')
  await waitFor(`document.body.innerText.includes('先确定情节大纲')`, '大纲闸门')
  if (!(await t(`__t.find('button', 'AI 建议伏笔与线索').disabled`))) throw new Error('大纲未定时 AI 建议应禁用')
})
await check('情节大纲：AI 一键生成全部（总览 + 粗纲 + 集纲）；全部生成后按钮变成「重新全部生成」，确认后整份重写', async () => {
  await goto(projectPath + '/stage/outline')
  if (await evaluate(`document.body.innerText.includes('本次生成范围')`)) throw new Error('生成范围一行应已删除')
  await t(`__t.click('button', 'AI 一键生成全部')`)
  await waitFor(`(() => { const p = JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}'); return p.work.plot?.overview && p.work.outline.length >= p.spec.totalEpisodes })()`, '全部集纲', 20000)
  await until(`__t.find('main button', '重新全部生成') && !__t.find('main button', '重新全部生成').disabled`, '按钮变为重新全部生成')
  if (!(await t(`!!__t.find('main button', '重新生成集纲')`))) throw new Error('阶段卡片上应有「重新生成集纲」')
  // 阶段卡片头：「生成粗纲」排在「一键集纲 / 重新生成集纲」前面，同一行
  const order = await evaluate(`[...document.querySelectorAll('#outline-phase-0 > div:first-child > div:first-child button')].map((b) => b.textContent.trim())`)
  if (order.join('/') !== '重新生成粗纲/重新生成集纲') throw new Error('粗纲按钮应在集纲按钮前面：' + order.join('/'))
  await evaluate(`scrollTo(0, 0)`)
  await sleep(200)
  await shot('outline-head')
  const before = (await project()).work.outline.map((o) => o.event).join('|')
  await t(`__t.click('main button', '重新全部生成')`)
  await waitFor(dialog('重新全部生成情节大纲？'), '重新全部生成先确认')
  await t(`__t.click('[role=dialog] button', '重新全部生成')`)
  await waitFor(`(() => { const p = JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}'); return p.work.outline.length >= p.spec.totalEpisodes && p.work.outline.map((o) => o.event).join('|') !== ${JSON.stringify(before)} })()`, '集纲已整份重写', 20000)
  await until(`!__t.find('main button', '重新全部生成').disabled`, '重写完成', 20000)
})
await check('情节大纲：只重新生成总纲时粗纲不动；单集重新生成集纲时同段其他集不动', async () => {
  await patchStored(`(p) => { p.work.plot.overview = '旧总纲'; p.work.plot.phases[0] = '手改粗纲'; for (const o of p.work.outline) if (o.ep <= 3) o.event = '手改集纲' + o.ep }`, projectPath + '/stage/outline?ep=2')
  await waitFor(`document.querySelector('#outline-ep-2') && document.querySelector('[aria-label="重新生成第 2 集集纲"]')`, '?ep=2 定位到第 2 集所在的段')
  await t(`__t.click('main button', '重新生成总纲')`)
  await waitFor(dialog('重新生成总纲？'), '总纲确认')
  await t(`__t.click('[role=dialog] button', '重新生成')`)
  await waitFor(`JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').work.plot.overview !== '旧总纲'`, '总纲已替换', 5000)
  if ((await project()).work.plot.phases[0] !== '手改粗纲') throw new Error('重新生成总纲不应改动粗纲')
  await t(`document.querySelector('[aria-label="重新生成第 2 集集纲"]').click()`)
  await waitFor(dialog('重新生成第 2 集的集纲？'), '单集确认')
  await t(`__t.click('[role=dialog] button', '重新生成')`)
  await waitFor(`JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').work.outline.find((o) => o.ep === 2).event !== '手改集纲2'`, '第 2 集集纲已替换', 5000)
  const o = (await project()).work.outline
  if (o.find((x) => x.ep === 1).event !== '手改集纲1' || o.find((x) => x.ep === 3).event !== '手改集纲3') throw new Error('单集重新生成不应改动其他集')
})
await check('情节大纲：按总纲 → 粗纲 → 集纲的顺序生成；「付费卡点待审核」点一下跳到待审核的集', async () => {
  const before = (await project()).work
  const keep = { overview: before.plot.overview, phase1: before.plot.phases[1], approved: before.outline.filter((o) => o.approved).map((o) => o.ep) }
  // 没有总纲：粗纲按钮禁用
  await patchStored(`(p) => { p.work.plot.overview = '' }`, projectPath + '/stage/outline?ep=1')
  await waitFor(`document.querySelector('#outline-phase-0')`, '第一段')
  if (await t(`!!__t.find('main button', '生成总览与')`)) throw new Error('总览卡不应再有「总览与粗纲」合并按钮')
  if (!(await t(`__t.find('#outline-phase-0 button', '重新生成粗纲').disabled`))) throw new Error('没有总纲时粗纲按钮应禁用')
  // 有总纲、本段没有粗纲：本段集纲（整段与单集）都禁用
  await patchStored(`(p) => { p.work.plot.overview = ${JSON.stringify(keep.overview)}; p.work.plot.phases[0] = '' }`, projectPath + '/stage/outline?ep=1')
  await waitFor(`document.querySelector('[aria-label="重新生成第 1 集集纲"]')`, '第 1 集')
  if (!(await t(`document.querySelector('[aria-label="重新生成第 1 集集纲"]').disabled && [...document.querySelectorAll('#outline-phase-0 button')].find((b) => b.textContent.trim() === '重新生成集纲' && !b.getAttribute('aria-label')).disabled`)))
    throw new Error('没有粗纲时本段集纲按钮应禁用')
  await t(`__t.click('#outline-phase-0 button', '生成粗纲')`)
  await waitFor(`JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').work.plot.phases[0].trim()`, '本段粗纲已生成', 5000)
  const plot = (await project()).work.plot
  if (plot.phases[1] !== keep.phase1 || plot.overview !== keep.overview) throw new Error('生成本段粗纲不应改动总纲与其他段')
  await waitFor(`!document.querySelector('[aria-label="重新生成第 1 集集纲"]').disabled`, '有粗纲后集纲可生成')
  // 付费卡点待审核：依次跳到待审核的集
  await patchStored(`(p) => { for (const o of p.work.outline) if (p.rhythm.paywalls.includes(o.ep)) o.approved = false }`, projectPath + '/stage/outline')
  const cur = await project()
  const pays = cur.rhythm.paywalls.filter((ep) => ep <= cur.spec.totalEpisodes && cur.work.outline.some((o) => o.ep === ep)).sort((a, b) => a - b)
  await until(`!!__t.find('main button', '付费卡点待审核')`, '待审核徽标')
  // 整集都在屏幕里（段末的集滚不到上半屏，跳过去时会短暂描边）
  const inView = (ep) => `(() => { const el = document.querySelector('#outline-ep-${ep}'); if (!el) return false; const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight })()`
  await t(`__t.click('main button', '付费卡点待审核')`)
  await waitFor(inView(pays[0]), `跳到第 ${pays[0]} 集`)
  if (pays.length > 1) {
    await t(`__t.click('main button', '付费卡点待审核')`)
    await waitFor(inView(pays[1]), `再点跳到第 ${pays[1]} 集`)
  }
  await shot('outline-paywall-jump')
  await patchStored(`(p) => { for (const o of p.work.outline) o.approved = ${JSON.stringify(keep.approved)}.includes(o.ep) }`, projectPath + '/stage/outline')
})
await check('情节大纲：大纲检查放在状态库的「检查」标签页，列出的集号点一下跳到那一集', async () => {
  const keep = (await project()).work.outline.filter((o) => o.approved).map((o) => o.ep)
  await patchStored(`(p) => { for (const o of p.work.outline) if (p.rhythm.paywalls.includes(o.ep)) o.approved = false }`, projectPath + '/stage/outline')
  await waitFor(`document.querySelector('[data-open-checks]')`, '页头的检查入口')
  const wasOpen = await evaluate(`!!document.querySelector('aside[aria-label=剧本状态库]')`)
  const inMain = await evaluate(`[...document.querySelectorAll('main h3, main h2, main [class*=font-semibold]')].some((e) => !e.closest('aside') && e.textContent.trim() === '大纲检查')`)
  if (inMain) throw new Error('页面里不应再有「大纲检查」卡片')
  await evaluate(`document.querySelector('[data-open-checks]').click()`)
  await waitFor(`document.querySelector('[data-panel-tab=checks]')?.innerText.includes('付费卡点集待单独审核')`, '侧栏「检查」标签页')
  const tabs = await evaluate(`[...document.querySelectorAll('aside[aria-label=剧本状态库] [role=tab]')].map((x) => x.firstChild.textContent).join(',')`)
  if (tabs !== '状态库,检查') throw new Error('侧栏标签页应为 状态库 / 检查：' + tabs)
  const cur = await project()
  const pays = cur.rhythm.paywalls.filter((ep) => ep <= cur.spec.totalEpisodes && cur.work.outline.some((o) => o.ep === ep)).sort((a, b) => a - b)
  const target = pays.at(-1)
  const link = `[...document.querySelectorAll('[data-panel-tab=checks] li')].find((li) => li.innerText.includes('付费卡点集待单独审核')).querySelector('[data-ep-link="${target}"]')`
  await waitFor(link, `第 ${target} 集可点`)
  await evaluate(`${link}.click()`)
  await waitFor(`(() => { const el = document.querySelector('#outline-ep-${target}'); if (!el) return false; const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && el.className.includes('ring-brand-300') })()`, `跳到第 ${target} 集并描边`)
  await sleep(300)
  await shot('outline-checks-tab')
  await t(`__t.click('aside [role=tab]', '状态库')`)
  if (!wasOpen) await evaluate(`document.querySelector('[aria-label=收起剧本状态库]').click()`)
  await patchStored(`(p) => { for (const o of p.work.outline) o.approved = ${JSON.stringify(keep)}.includes(o.ep) }`, projectPath + '/stage/outline')
})
await check('伏笔线索：AI 建议先在弹窗里勾选，确定后才录入', async () => {
  await goto(projectPath + '/stage/foreshadow')
  await t(`__t.click('button', 'AI 建议伏笔与线索')`)
  await waitFor(dialog('AI 建议的伏笔与线索'), '建议弹窗', 5000)
  if ((await project()).work.foreshadows.length) throw new Error('弹窗打开时不应直接录入')
  if (!(await t(`__t.find('[role=dialog] button', '确定录入').disabled`))) throw new Error('未勾选时「确定录入」应禁用')
  const boxes = `[...document.querySelectorAll('[role=dialog] input[aria-label^="选择："]')]`
  if ((await evaluate(`${boxes}.length`)) < 3) throw new Error('建议少于 3 条')
  await evaluate(`${boxes}.slice(0, 2).forEach((b) => b.click())`)
  await waitFor(`document.body.innerText.includes('已选 2')`, '已选 2')
  await sleep(300)
  await shot('foreshadow-suggest')
  await t(`__t.click('[role=dialog] button', '确定录入 2 条')`)
  await waitFor(`document.body.innerText.includes('已录入 2 条计划')`, '录入 toast')
  if ((await project()).work.foreshadows.length !== 2) throw new Error('应只录入勾选的 2 条')
})

/* -------------------------------- 质检交付 -------------------------------- */

await check('质检交付：没有定稿时不能质检', async () => {
  await goto(projectPath + '/stage/qa')
  await waitFor(`document.body.innerText.includes('先在逐集剧本中定稿至少一集')`, '定稿闸门')
})
await check('质检交付：总结与全部问题在上，左侧目录、中间标色定稿、右侧本集问题', async () => {
  // 用 mock 写手直接生成 6 集定稿，再人为埋几个问题：第 2 集未登记称谓 + AI 味词，第 3 集删掉集末钩子
  await patchStored(`async (p) => {
    const { writeEpisode } = await import('/src/services/mock/writer.ts')
    const at = new Date().toISOString()
    p.work.scripts = [1, 2, 3, 4, 5, 6].map((ep) => { const d = writeEpisode(p, ep, 0); return { ep, title: d.title, lines: d.lines, status: 'final', translated: false, states: d.states, draftId: '', updatedAt: at } })
    const two = p.work.scripts[1].lines
    two.find((l) => l.kind === 'dialogue').speaker = '王总'
    const act = two.find((l) => l.kind === 'action'); act.zh = act.zh.replace(/^(△\s*)?/, '$1她不禁')
    p.work.scripts[2].lines = p.work.scripts[2].lines.filter((l) => l.kind !== 'hook')
  }`, projectPath + '/stage/qa')
  await t(`__t.click('button', '开始质检')`)
  await waitFor(`document.body.innerText.includes('质检总分')`, '质检报告', 6000)
  for (const s of ['/ 100', '一致性终检', '角色一致性', '故事流程', '节奏曲线对比', '付费点专项', '创新点落地', '格式合规', '章节目录', '全剧', '第 6 集', '全部问题']) {
    if (!(await t(`__t.has(${JSON.stringify(s)})`))) throw new Error('缺少「' + s + '」')
  }
  const sum = await evaluate(`(() => { const s = document.querySelector('#qa-summary'); const g = [...document.querySelectorAll('div')].find((d) => d.className.includes('xl:grid-cols-[220px')); const a = s.getBoundingClientRect(); const b = g.getBoundingClientRect(); return { below: a.bottom <= b.top, wide: Math.round(a.width) === Math.round(b.width), inside: g.contains(s) } })()`)
  if (!sum.below || !sum.wide || sum.inside) throw new Error('质检总分应横排在交付卡片下、三栏之上：' + JSON.stringify(sum))
  const cols = await evaluate(`(() => { const g = [...document.querySelectorAll('div')].find((d) => d.className.includes('xl:grid-cols-[220px')); return [...g.children].map((c) => { const r = c.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), Math.round(r.top)] }) })()`)
  if (cols.length !== 3 || !(cols[0][1] <= cols[1][0] && cols[1][1] <= cols[2][0]) || new Set(cols.map((c) => c[2])).size !== 1) throw new Error('应为左中右三栏：' + JSON.stringify(cols))
  const report = (await project()).work.qa
  if (!report || report.issues.length === 0) throw new Error('没有问题')
  const want = Math.round(report.checks.reduce((s, c, i) => s + c.score * [0.15, 0.15, 0.15, 0.15, 0.15, 0.1, 0.15][i], 0))
  if (report.score !== want) throw new Error(`总分应为分项加权：${report.score} vs ${want}`)
  if (report.model !== 'doubao' || !(await t(`__t.has('豆包 质检')`))) throw new Error('质检报告应记下并显示文本模型（默认豆包）：' + report.model)
  await t(`__t.click('button', '第 2 集')`)
  await waitFor(`[...document.querySelectorAll('mark')].some((m) => m.textContent === '王总') && [...document.querySelectorAll('mark')].some((m) => m.textContent === '不禁')`, '问题字段标色')
  await shot('qa-overview')
})
await check('质检交付：全部问题在质检总分下面，点分项角度 / 级别筛选；右侧只看本集；点问题定位到行', async () => {
  const qa = (await project()).work.qa
  const rows = `[...document.querySelectorAll('#qa-summary #qa-all [data-qa-row]')]`
  const layout = await evaluate(`(() => { const all = document.querySelector('#qa-all'); const head = document.querySelector('#qa-summary > div'); return { inside: !!all && document.querySelector('#qa-summary').contains(all), below: !!all && head.getBoundingClientRect().bottom <= all.getBoundingClientRect().top, rows: ${rows}.length, eps: new Set(${rows}.map((li) => li.innerText.match(/^第 \\d+ 集|全剧/m)?.[0])).size } })()`)
  if (!layout.inside || !layout.below || layout.rows !== qa.issues.length || layout.eps < 3) throw new Error('全部问题应在质检总分下面、列出各集全部问题：' + JSON.stringify(layout) + ' / ' + qa.issues.length)
  if (await evaluate(`[...document.querySelectorAll('h3')].some((h) => h.textContent === '问题详情')`)) throw new Error('右栏不应再有「问题详情」与本集 / 全部切换')
  if (!(await evaluate(`[...document.querySelectorAll('h3')].some((h) => /^第 \\d+ 集问题$/.test(h.textContent))`))) throw new Error('右栏标题应为「第 N 集问题」')
  // 角度：点分项只看这一项
  await t(`__t.click('#qa-summary button[aria-pressed]', '格式合规')`)
  const format = qa.issues.filter((i) => i.check === 'format').length
  await waitFor(`${rows}.length === ${format} && ${rows}.every((li) => li.innerText.includes('格式合规'))`, '按分项筛选')
  if (!(await t(`__t.has('格式合规 · ${format} 条')`))) throw new Error('标题应写出当前角度与条数')
  await t(`__t.click('#qa-summary button[aria-pressed]', '格式合规')`)
  // 级别：总分下的严重 / 建议 / 提示也能筛
  await evaluate(`[...document.querySelectorAll('#qa-summary button[aria-pressed]')].find((b) => b.textContent.startsWith('严重')).click()`)
  const blocks = qa.issues.filter((i) => i.level === 'block').length
  await waitFor(`${rows}.length === ${blocks} && ${rows}.every((li) => li.querySelector('[aria-label=严重]'))`, '按级别筛选')
  await t(`__t.click('#qa-all button', '清除筛选')`)
  await waitFor(`${rows}.length === ${qa.issues.length}`, '清除筛选')
  // 右侧只列所选那一集
  const ep2 = qa.issues.filter((i) => i.ep === 2).length
  if ((await evaluate(`document.querySelectorAll('li[id^=qa-issue-]').length`)) !== ep2) throw new Error('右栏应只列第 2 集的问题')
  const issue = qa.issues.find((i) => i.ep === 2 && i.lineId && i.quote === '王总')
  await evaluate(`document.querySelector('#qa-issue-${issue.id} button').click()`)
  await waitFor(`document.querySelector('#qa-issue-${issue.id}').className.includes('border-brand-300') && document.querySelector('#qa-line-${issue.lineId}')`, '问题高亮并定位')
  // 全部问题里点另一集的问题：切到那一集并定位到行
  const other = qa.issues.find((i) => i.ep === 3 && i.lineId)
  if (other) {
    await evaluate(`document.querySelector('[data-qa-row="${other.id}"] button').click()`)
    await waitFor(`document.querySelector('#qa-line-${other.lineId}') && document.querySelector('[data-qa-row="${other.id}"]').className.includes('bg-brand-50')`, '全部问题点选定位')
  }
  await sleep(300)
  await shot('qa-all-issues')
})
await check('质检交付：问题卡片 AI 修稿——先预览改动与设定核对，确认后才改定稿；设定里没依据的留给编剧；重新质检后问题消失', async () => {
  const qa = (await project()).work.qa
  const dlg = `document.querySelector('[data-qa-fix-dialog]')`
  const fixRow = async (issue) => {
    await evaluate(`document.querySelector('[data-qa-row="${issue.id}"] [data-qa-fix]').click()`)
    await waitFor(`${dlg}?.innerText.includes('已对照原有设定')`, 'AI 修稿预览', 5000)
  }
  // 1）AI 味词：只改这一行，预览里看得到改前改后
  const filler = qa.issues.find((i) => i.ep === 2 && i.title === 'AI 味词汇' && i.quote === '不禁')
  await fixRow(filler)
  const diff = await evaluate(`[...document.querySelectorAll('[data-fix-diff]')].map((d) => [d.dataset.fixDiff, d.innerText])`)
  if (diff.length !== 1 || diff[0][0] !== 'edit' || !diff[0][1].includes('不禁')) throw new Error('应只改问题这一行：' + JSON.stringify(diff))
  if (!(await t(`__t.has('豆包 修稿')`))) throw new Error('应写出修稿模型（写作默认豆包）')
  const epOf = (p, ep) => p.work.scripts.find((s) => s.ep === ep)
  if (!epOf(await project(), 2).lines.find((l) => l.id === filler.lineId).zh.includes('不禁')) throw new Error('确认前不应改定稿')
  await sleep(300)
  await shot('qa-ai-fix')
  await t(`__t.click('[role=dialog] button', '应用到定稿')`)
  await waitFor(`!${dlg} && !document.querySelector('[data-qa-row="${filler.id}"]')`, '修好后从列表里收起')
  let p = await project()
  if (epOf(p, 2).lines.find((l) => l.id === filler.lineId).zh.includes('不禁')) throw new Error('定稿里还有「不禁」')
  if (!p.work.qa.fixed?.includes(filler.id) || !p.work.qa.resolved.includes(filler.id)) throw new Error('应记为 AI 已修')
  await waitFor(`document.body.innerText.includes('正文在质检后有改动')`, '提示重新质检')
  // 2）结尾没有钩子：钩子取自本集蓝图 / 集纲，不擅自编
  const hook = qa.issues.find((i) => i.ep === 3 && i.title === '结尾没有钩子')
  const want = p.work.blueprints.find((b) => b.ep === 3)?.hook.trim() || p.work.outline.find((o) => o.ep === 3)?.hookLine.trim()
  await fixRow(hook)
  if (!(await evaluate(`document.querySelector('[data-fix-diff=add]')?.innerText.includes('集末钩子')`))) throw new Error('应在结尾加一行钩子')
  await t(`__t.click('[role=dialog] button', '应用到定稿')`)
  await waitFor(`!${dlg}`, '应用')
  p = await project()
  const last = epOf(p, 3).lines.at(-1)
  if (last.kind !== 'hook' || last.zh !== want) throw new Error('钩子应取自蓝图 / 集纲：' + JSON.stringify([last, want]))
  // 3）称谓对不上已登记人物：不新增人物，列给编剧
  const name = qa.issues.find((i) => i.ep === 2 && i.quote === '王总')
  const names = p.work.characters.map((c) => c.name)
  const maps = names.filter((n) => n.includes('王总') || '王总'.includes(n)).length === 1 || names.filter((n) => n.startsWith('王')).length === 1
  await fixRow(name)
  if (maps) {
    if (!(await evaluate(`!!document.querySelector('[data-fix-diff=edit]')`))) throw new Error('对得上已登记人物时应统一称谓')
    await t(`__t.click('[role=dialog] button', '取消')`)
  } else {
    if (!(await evaluate(`${dlg}.querySelector('[data-fix-manual]')?.innerText.includes('AI 不擅自新增人物') && !document.querySelector('[data-fix-diff]')`))) throw new Error('对不上人时应留给编剧、不改正文')
    if (await t(`!!__t.find('[role=dialog] button', '应用到定稿')`)) throw new Error('没有改动时不应有「应用到定稿」')
    await t(`__t.click('[role=dialog] button', '知道了')`)
  }
  await waitFor(`!${dlg}`, '关闭预览')
  if (!(await evaluate(`!!document.querySelector('[data-qa-row="${name.id}"]')`))) throw new Error('没修的问题应留在列表里')
  // 4）重新质检：修过的问题不再出现，AI 已修的记录随新报告清空
  await t(`__t.click('button', '重新质检')`)
  await until(`!__t.has('正文在质检后有改动')`, '重新质检', 8000)
  p = await project()
  if (p.work.qa.issues.some((i) => (i.ep === 2 && i.quote === '不禁') || (i.ep === 3 && i.title === '结尾没有钩子'))) throw new Error('修过的问题重新质检后仍在')
  if (p.work.qa.fixed?.length) throw new Error('新报告不应沿用 AI 已修记录')
})
await check('质检交付：有严重问题不能交付，逐条标记已处理后可交付与撤回', async () => {
  // 上一项 AI 修稿可能已修掉严重问题：再删掉第 4 集的钩子，重新质检出一个
  await patchStored(`(p) => { const s = p.work.scripts.find((x) => x.ep === 4); s.lines = s.lines.filter((l) => l.kind !== 'hook') }`, projectPath + '/stage/qa')
  await t(`__t.click('button', '重新质检')`)
  await until(`!__t.has('正文在质检后有改动') && !__t.find('button', '重新质检').disabled`, '重新质检', 8000)
  if (!(await project()).work.qa.issues.some((i) => i.level === 'block')) throw new Error('应有严重问题')
  if (!(await t(`__t.find('button', '确认交付').disabled`))) throw new Error('有严重问题时「确认交付」应禁用')
  // 总分下的级别筛选按钮以级别名开头；分项行的摘要里也有「严重」字样，不能按包含匹配
  await evaluate(`[...document.querySelectorAll('#qa-summary button[aria-pressed]')].find((b) => b.textContent.startsWith('严重')).click()`)
  for (let i = 0; i < 40; i++) {
    const left = await evaluate(`(() => { const b = [...document.querySelectorAll('[data-qa-row] button')].find((e) => e.textContent.includes('标记已处理')); b?.click(); return !!b })()`)
    if (!left) break
    await sleep(60)
  }
  await until(`!__t.find('button', '确认交付').disabled`, '可交付')
  await t(`__t.click('button', '确认交付')`)
  await waitFor(dialog('确认交付？'), '交付确认')
  await t(`__t.click('[role=dialog] button', '确认交付')`)
  await waitFor(`document.body.innerText.includes('已交付') && document.body.innerText.includes('撤回交付')`, '已交付')
  if ((await project()).status !== 'delivered') throw new Error('状态未改为已交付')
  await sleep(300)
  await shot('qa-delivered')
  await t(`__t.click('button', '撤回交付')`)
  await waitFor(`document.body.innerText.includes('确认交付')`, '撤回')
})
await check('质检交付：正文改动后提示重新质检，且不能交付', async () => {
  await patchStored(`(p) => { p.work.scripts[0].updatedAt = new Date(Date.now() + 60000).toISOString() }`, projectPath + '/stage/qa')
  await waitFor(`document.body.innerText.includes('正文在质检后有改动')`, '过期提示')
  if (!(await t(`__t.find('button', '确认交付').disabled`))) throw new Error('报告过期时「确认交付」应禁用')
})

/* -------------------------------- 状态库侧栏 -------------------------------- */

const panel = `document.querySelector('aside[aria-label=剧本状态库]')`
const panelText = () => evaluate(`${panel}?.innerText ?? ''`)
const panelTab = (label) => t(`__t.click('aside[aria-label=剧本状态库] button', '${label}')`)

await check('状态库：移出创作流程，旧链接回到概览；概览不显示侧栏', async () => {
  await goto(projectPath)
  const nav = await evaluate(`[...document.querySelectorAll('nav ol a')].map((a) => a.textContent).join('/')`)
  if (nav.includes('剧本状态库')) throw new Error('流程里仍有剧本状态库：' + nav)
  if (await evaluate(`!!document.querySelector('[aria-label=展开剧本状态库]') || !!${panel}`)) throw new Error('概览不应显示状态库')
  await goto(projectPath + '/stage/state')
  await waitFor(`location.pathname === '${projectPath}'`, '重定向到概览')
})
await check('状态库：情节大纲里按选中层级切换（阶段 → 某一集 → 总览）', async () => {
  await goto(projectPath + '/stage/outline')
  await t(`document.querySelector('[aria-label=展开剧本状态库]').click()`)
  await waitFor(panel, '侧栏展开')
  let text = await panelText()
  if (!text.includes('本阶段') || !text.includes('全剧') || text.includes('本集')) throw new Error('选中阶段时应只有 本阶段 / 全剧：' + text.slice(0, 80))
  if (!text.includes('集纲') || !text.includes('人物 · 截至段末')) throw new Error('本阶段内容缺失')
  await evaluate(`document.querySelector('main button[aria-label=展开]')?.click()`)
  await t(`__t.click('main button', '第1集')`)
  await waitFor(`${panel}.innerText.includes('人物 · 截至本集')`, '切到本集')
  text = await panelText()
  if (!text.includes('第 1 集') || !text.includes('开场钩子')) throw new Error('本集快照不对：' + text.slice(0, 120))
  await sleep(300)
  await shot('state-panel-outline-ep')
  await t(`__t.click('main button', '总览')`)
  await waitFor(`!${panel}.innerText.includes('本阶段') && ${panel}.innerText.includes('已定稿至')`, '总览只看全剧')
  // 宽屏下侧栏展开时页面给它让位，内容不压在侧栏下面
  const overlap = await evaluate(`document.querySelector('#outline-overview').getBoundingClientRect().right - ${panel}.getBoundingClientRect().left`)
  if (overlap > 0) throw new Error('侧栏压住了页面内容：' + overlap)
})
await check('状态库：审阅第 1 集时，本集看第 1 集结束时的状态，全剧看整体进度', async () => {
  await goto(projectPath + '/stage/script/final/1')
  await waitFor(panel, '侧栏保持展开')
  const ep = await panelText()
  if (!ep.includes('已定稿') || !ep.includes('人物 · 截至本集') || !ep.includes('首次出场')) throw new Error('第 1 集快照不对：' + ep.slice(0, 160))
  await sleep(300)
  await shot('state-panel-final-ep1')
  await panelTab('全剧')
  await waitFor(`${panel}.innerText.includes('已定稿至第 6 集')`, '全剧进度')
  await sleep(200)
  await shot('state-panel-overall')
  await panelTab('本集')
  await t(`document.querySelector('aside[aria-label=剧本状态库] [aria-label=下一个]').click()`)
  await waitFor(`${panel}.innerText.includes('第 2 集') && ${panel}.innerText.includes('回到当前页面选中的位置')`, '侧栏里翻到第 2 集')
  // 输入集数直接跳到任意一集；下拉跳到任意一段
  if (await t(`!!document.querySelector('aside[aria-label=剧本状态库] select[aria-label=选择集]')`)) throw new Error('选择集应是数字输入框，不是下拉')
  await t(`__t.type(document.querySelector('aside[aria-label=剧本状态库] input[aria-label=选择集]'), '5')`)
  await t(`__t.enter(document.querySelector('aside[aria-label=剧本状态库] input[aria-label=选择集]'))`)
  await waitFor(`${panel}.querySelector('input[aria-label=选择集]').value === '5' && ${panel}.innerText.includes('第 5 集')`, '输入跳到第 5 集')
  await panelTab('本阶段')
  await evaluate(`(() => { const el = document.querySelector('aside[aria-label=剧本状态库] select[aria-label=选择阶段]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, '2'); el.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  await waitFor(`${panel}.querySelector('select[aria-label=选择阶段]').value === '2'`, '下拉跳到第 3 段')
  await panelTab('本集')
})
await check('状态库：伏笔环节看写作进度上的当前集；可收起、可打开完整视图', async () => {
  await goto(projectPath + '/stage/foreshadow')
  await waitFor(`${panel}?.querySelector('input[aria-label=选择集]')?.value === '7'`, '伏笔环节当前集')
  if (!(await panelText()).includes('伏笔与线索')) throw new Error('缺少伏笔信息')
  await t(`document.querySelector('[aria-label=收起剧本状态库]').click()`)
  await waitFor(`!${panel} && document.querySelector('[aria-label=展开剧本状态库]')`, '收起')
  await t(`document.querySelector('[aria-label=展开剧本状态库]').click()`)
  await waitFor(panel, '再展开')
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
  await waitFor(`!${panel}`, 'Esc 收起')
  await t(`document.querySelector('[aria-label=展开剧本状态库]').click()`)
  await panelTab('全剧')
  await t(`__t.click('aside[aria-label=剧本状态库] a', '打开完整状态库')`)
  await waitFor(`location.pathname === '${projectPath}/state' && document.body.innerText.includes('剧本状态库 · 完整视图') && document.body.innerText.includes('定稿日志')`, '完整视图')
  if (await evaluate(`!!${panel}`)) throw new Error('完整视图页不应显示侧栏')
})

await check('状态库：草稿页按这份草稿显示本集，注明不计入全剧；写作前检查只在分集蓝图的「检查」页', async () => {
  await patchStored(`async (p) => {
    const { writeEpisode } = await import('/src/services/mock/writer.ts')
    const d = writeEpisode(p, 7, 0)
    const at = new Date().toISOString()
    p.work.drafts.push({ id: 'e2e-draft-7', ep: 7, version: 1, title: d.title, lines: d.lines, status: 'draft', translated: false, states: d.states, reviews: [], notes: [], createdAt: at, updatedAt: at })
  }`, projectPath + '/stage/script/draft/e2e-draft-7')
  await waitFor(`${panel}?.innerText.includes('草稿_v1 · 未定稿，不计入全剧状态')`, '草稿依据')
  if ((await panelText()).includes('写作前检查')) throw new Error('状态库里不应再有写作前检查，它在分集蓝图的「检查」页')
  await sleep(300)
  await shot('state-panel-draft')
  await panelTab('全剧')
  await waitFor(`${panel}.innerText.includes('已定稿至第 6 集') && ${panel}.innerText.includes('1 集草稿未定稿')`, '全剧不计草稿')
})

await check('正文编辑：稿纸铺满编辑区，点选段落在上方浮出 AI 工具条，标注在状态库的「标注」页添加', async () => {
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
  const fill = await evaluate(`(() => { const ed = document.querySelector('[data-editor]').getBoundingClientRect(); const p = document.querySelector('textarea[aria-label="第 3 段"]').getBoundingClientRect(); return ed.right - p.right })()`)
  if (fill > 60) throw new Error('稿纸应铺满编辑区，右侧留白 ' + Math.round(fill))
  await t(`document.querySelector('textarea[aria-label="第 3 段"]').click()`)
  await waitFor(`document.querySelector('[role=toolbar][aria-label=段落工具]')`, '浮动工具条')
  const bar = await evaluate(`(() => { const b = document.querySelector('[role=toolbar][aria-label=段落工具]').getBoundingClientRect(); const p = document.querySelector('textarea[aria-label="第 3 段"]').getBoundingClientRect(); return { above: b.bottom <= p.top + 2, text: document.querySelector('[role=toolbar][aria-label=段落工具]').innerText } })()`)
  if (!bar.above) throw new Error('工具条应在选中段落上方')
  for (const label of ['AI', '润色', '扩写', '续写', '对话']) if (!bar.text.includes(label)) throw new Error('工具条缺少 ' + label)
  for (const label of ['标注', '添加到助手']) if (bar.text.includes(label)) throw new Error('工具条不应再有 ' + label)
  // 操作提示收进格式栏的「编辑说明」，正文上方不再压一段说明文字
  if (await evaluate(`document.querySelector('main').innerText.includes('点选任意一段')`)) throw new Error('正文上方不应再有操作说明')
  if (!(await evaluate(`[...document.querySelectorAll('[role=toolbar][aria-label=格式] [role=tooltip]')].some((x) => x.textContent.includes('AI 工具条') && x.textContent.includes('「标注」') && x.textContent.includes('Markdown'))`))) throw new Error('编辑说明缺少操作提示')
  // 页头信息行的「加标注」打开状态库侧栏的标注页，给选中段落加标注
  await t(`document.querySelector('main [data-open-notes]').click()`)
  await waitFor(`document.querySelector('[data-panel-tab=notes]')?.innerText.includes('标注第 3 行')`, '侧栏标注跟随选中段落')
  await t(`__t.type(document.querySelector('[data-panel-tab=notes] [aria-label=标注内容]'), '这里节奏太慢')`)
  await t(`document.querySelector('[data-panel-tab=notes] [aria-label=标注内容] + button').click()`)
  await waitFor(`JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').work.drafts.find((d) => d.id === 'e2e-draft-7').notes.length === 1`, '一条标注')
  if (!(await evaluate(`document.querySelector('[data-editor]').innerText.includes('这里节奏太慢')`))) throw new Error('标注应显示在段落下方')
  await sleep(200)
  await shot('draft-editor')
})

const key = async (k, code, vk) => {
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk })
}
const draft7 = async () => (await project()).work.drafts.find((d) => d.id === 'e2e-draft-7')

await check('正文编辑：Word 式稿纸与格式栏，支持 Markdown 写法、加粗与对齐，回车另起一段', async () => {
  if (!(await evaluate(`!!document.querySelector('[role=toolbar][aria-label=格式] button[aria-label^=加粗]')`))) throw new Error('缺少格式栏')
  if (await evaluate(`!!document.querySelector('[role=toolbar][aria-label=格式] select')`)) throw new Error('格式栏不再有段落样式下拉')
  const before = (await draft7()).lines.length
  // 第 3 段段尾回车：另起一段动作
  await evaluate(`(() => { const el = document.querySelector('textarea[aria-label="第 3 段"]'); el.focus(); el.setSelectionRange(el.value.length, el.value.length) })()`)
  await key('Enter', 'Enter', 13)
  await waitFor(`document.activeElement?.getAttribute('aria-label') === '第 4 段' && document.activeElement.value === '△ '`, '回车另起一段')
  // Markdown：「# 」变成场景标题
  await send('Input.insertText', { text: '# ' })
  await send('Input.insertText', { text: '天台 夜 外' })
  await waitFor(`JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').work.drafts.find((d) => d.id === 'e2e-draft-7').lines.some((l) => l.kind === 'scene' && l.zh === '天台 夜 外')`, '# 转成场景标题')
  if ((await draft7()).lines.length !== before + 1) throw new Error('回车应只多出一段')
  // 加粗：选中第 3 段的一部分，点格式栏加粗
  await evaluate(`(() => { const el = document.querySelector('textarea[aria-label="第 3 段"]'); el.focus(); el.setSelectionRange(2, 6) })()`)
  await t(`document.querySelector('[role=toolbar][aria-label=格式] button[aria-label^=加粗]').click()`)
  await waitFor(`JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').work.drafts.find((d) => d.id === 'e2e-draft-7').lines[2].zh.includes('**')`, '加粗写成 Markdown')
  // 对齐：第 1 段居中
  await evaluate(`document.querySelector('textarea[aria-label="第 1 段"]').focus()`)
  await t(`document.querySelector('[role=toolbar][aria-label=格式] button[aria-label=居中]').click()`)
  await waitFor(`JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').work.drafts.find((d) => d.id === 'e2e-draft-7').lines[0].align === 'center'`, '居中对齐')
  // 离开后加粗段按效果显示
  await waitFor(`document.querySelector('[role=textbox][aria-label="第 3 段"] .font-bold')`, '加粗渲染')
  if (await evaluate(`document.querySelector('[role=textbox][aria-label="第 3 段"]').textContent.includes('**')`)) throw new Error('渲染后不应露出 Markdown 标记')
  if (!(await evaluate(`getComputedStyle(document.querySelector('textarea[aria-label="第 1 段"]')).textAlign === 'center'`))) throw new Error('居中未生效')
  await sleep(200)
  await shot('draft-editor-word')
})

await check('审稿 / 修稿：审稿有范围说明；修稿按审稿意见逐条改并记下依据；正文没改不重复审稿；同一集最多修稿 3 轮', async () => {
  if (!(await evaluate(`[...document.querySelectorAll('[role=tooltip]')].some((x) => x.textContent.includes('AI 审稿检查什么') && x.textContent.includes('道具归属'))`))) throw new Error('缺少审稿范围说明')
  await t(`__t.click('button', 'AI 审稿')`)
  // 审完弹提示框给结论；侧栏切到审核报告，展开这一份
  await waitFor(`document.querySelector('[data-review-notice]')?.innerText.includes('审稿完成') && document.querySelector('[data-review-detail]')`, '审稿提示框', 6000)
  if (await evaluate(`[...document.querySelectorAll('main h3')].some((h) => h.textContent.startsWith('审查报告'))`)) throw new Error('正文上方不应再放审查报告')
  const r1 = (await draft7()).reviews.at(-1)
  if (!r1.items.some((i) => /连贯|人物状态冲突|已在第 \d+ 集回收|道具/.test(i.text))) throw new Error('审稿缺少前文连贯检查')
  await sleep(200)
  await shot('draft-review-notice')
  await t(`__t.click('[data-review-notice] button', '查看详情')`)
  await waitFor(`!document.querySelector('[data-review-notice]')`, '提示框关闭')
  // 本集蓝图 / 审核报告 / 状态库 / 标注并入状态库侧栏，依次四个标签；草稿页不再有右侧栏
  const tabs = await evaluate(`[...document.querySelectorAll('aside[aria-label=剧本状态库] [role=tab]')].map((x) => x.firstChild.textContent).join(',')`)
  if (tabs !== '本集蓝图,审核报告,状态库,标注') throw new Error('侧栏标签不对：' + tabs)
  if (!(await evaluate(`document.querySelector('aside [role=tab][aria-selected=true]').textContent.startsWith('审核报告')`))) throw new Error('审稿后侧栏应切到审核报告')
  if (await evaluate(`!!document.querySelector('[data-side]')`)) throw new Error('草稿页不应再有右侧栏')
  await t(`document.querySelector('[data-panel-tab=reviews] button[aria-expanded]').click()`)
  await waitFor(`!document.querySelector('[data-review-detail]')`, '审核报告可收起')
  await t(`document.querySelector('[data-panel-tab=reviews] button[aria-expanded]').click()`)
  await waitFor(`document.querySelector('[data-review-detail]')`, '审核报告可展开')
  await sleep(200)
  await shot('draft-side-reviews')
  await t(`__t.click('aside [role=tab]', '状态库')`)
  await panelTab('本集')
  await waitFor(`${panel}.innerText.includes('草稿_v1 · 未定稿，不计入全剧状态')`, '状态库标签页')
  await t(`__t.click('aside [role=tab]', '标注1')`)
  await waitFor(`document.querySelector('[data-panel-tab=notes]')?.innerText.includes('这里节奏太慢')`, '标注标签页')
  await waitFor(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'AI 审稿')?.disabled`, '没改动时审稿禁用')
  // 审核报告里每份报告都能直接「按这份意见修稿」
  await t(`__t.click('aside [role=tab]', '审核报告1')`)
  await waitFor(`document.querySelector('[data-review-detail]')`, '审核报告详情')
  const hasIssues = r1.items.some((i) => i.level === 'block' || i.level === 'warn')
  if (hasIssues !== (await t(`!!__t.find('[data-review-detail] button', '按这份意见修稿')`))) throw new Error('有问题的报告才显示「按这份意见修稿」')
  for (let round = 1; round <= 3; round++) {
    const path = await evaluate('location.pathname')
    await t(`__t.click('button', 'AI 修稿')`)
    await waitFor(`location.pathname !== '${path}'`, `第 ${round} 轮修稿`, 8000)
    if (round > 1) continue
    // 审过稿再修稿：按审稿意见逐条改，记下依据；审稿没提的问题不自行改
    const created = (await project()).work.drafts.find((d) => d.from === 'e2e-draft-7')
    if (created?.revision?.reviewId !== r1.id || created.revision.reviewNo !== 1) throw new Error('修稿应按审稿 #1 的意见改')
    if (!r1.items.some((i) => i.code === 'filler') && created.revision.changes.some((c) => c.startsWith('去掉 AI 味'))) throw new Error('审稿没提 AI 味，修稿不应自行改')
    if (r1.items.some((i) => i.code === 'notes') && !created.revision.changes.some((c) => c.includes('条标注改写'))) throw new Error('标注应一并改写')
    await waitFor(`document.querySelector('[data-panel-tab=reviews] [data-revision]')?.innerText.includes('按审稿 #1 改出这一版')`, '新版本显示修稿记录')
    if (!(await evaluate(`document.querySelector('main').innerText.includes('按审稿 #1 修改')`))) throw new Error('页头应注明按哪份审稿修改')
    await sleep(200)
    await shot('draft-revision')
  }
  await waitFor(`document.body.innerText.includes('自动修稿已停止')`, '修稿上限提示')
  if (!(await t(`__t.find('button', 'AI 修稿').disabled`))) throw new Error('达到上限后 AI 修稿应禁用')
})

await check('AI 修稿按审稿意见逐条改：缺钩子、AI 味、长台词改掉；未登记人物留给编剧；审稿没提的不动', async () => {
  const r = await evaluate(`(async () => {
    const w = await import('/src/services/mock/writer.ts')
    const { AI_FILLERS } = await import('/src/services/mock/kits.ts')
    const p = JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((x) => x.id === '${projectId}')
    const base = p.work.drafts.find((d) => d.id === 'e2e-draft-7')
    // 去掉钩子，塞一个 AI 味词、一句长台词和一个没登记的人物
    const lines = base.lines.filter((l) => l.kind !== 'hook').concat([
      { id: 'x1', kind: 'action', zh: '△ 她' + AI_FILLERS[0] + '看向窗外。' },
      { id: 'x2', kind: 'dialogue', speaker: '路人甲', zh: '你听我说，这件事从头到尾都不是你想的那样，我们都被人算计了，真的。' },
    ])
    const d = { ep: 7, lines, notes: [] }
    const review = w.reviewDraft(p, d)
    const fixed = w.reviseDraft(p, d, 1, review)
    const self = w.reviseDraft(p, d, 1)
    const again = w.reviewDraft(p, { ...d, lines: fixed.lines })
    return { codes: review.items.map((i) => i.code).filter(Boolean), fixed, self, again: again.items.map((i) => i.code).filter(Boolean), filler: AI_FILLERS[0] }
  })()`)
  for (const c of ['hook', 'filler', 'longLine', 'unknown']) if (!r.codes.includes(c)) throw new Error('审稿应认出 ' + c + '，实际 ' + r.codes.join(','))
  if (!r.fixed.lines.some((l) => l.kind === 'hook')) throw new Error('应补上结尾钩子')
  if (r.fixed.lines.some((l) => l.zh.includes(r.filler))) throw new Error('应去掉 AI 味词')
  if (r.fixed.lines.some((l) => l.kind === 'dialogue' && l.zh.length > 30)) throw new Error('应拆短长台词')
  if (!r.fixed.manual.some((m) => m.includes('路人甲'))) throw new Error('未登记人物应留给编剧')
  if (!r.fixed.lines.some((l) => l.speaker === '路人甲')) throw new Error('未登记人物的台词不应被 AI 擅自改掉')
  for (const c of ['hook', 'filler', 'longLine']) if (r.again.includes(c)) throw new Error('修完再审仍有 ' + c)
  // 没审稿时按自检：不拆长台词，也没有留给人工的意见
  if (r.self.manual.length || !r.self.lines.some((l) => l.kind === 'dialogue' && l.zh.length > 30)) throw new Error('没审稿时只做自检')
})

await check('审稿按依据逐项查：核心设定 / 人物设定 / 集纲也查，每条写明依据与原句；复审只跟踪上一轮意见与改过的段落，两轮没改掉或改好又出现交人工；保留不改的不再提；写作也按这些依据写', async () => {
  const r = await evaluate(`(async () => {
    const w = await import('/src/services/mock/writer.ts')
    const { AI_FILLERS } = await import('/src/services/mock/kits.ts')
    const p = JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((x) => x.id === '${projectId}')
    p.work.architecture.writingRules += '\\n6. 不要出现“血腥”画面'
    const quiet = p.work.characters.find((c) => c.role !== '主角')
    quiet.personality = '寡言、冷淡'
    p.work.outline = p.work.outline.map((o) => (o.ep === 7 ? { ...o, event: '旧仓库里搜出那份失踪的遗嘱，局势急转' } : o))
    const base = p.work.drafts.find((d) => d.id === 'e2e-draft-7')
    const lines = base.lines.filter((l) => l.kind !== 'hook').concat([
      { id: 'q1', kind: 'action', zh: '△ 地上一片血腥。' },
      { id: 'q2', kind: 'dialogue', speaker: quiet.name, zh: '我早就知道你会来，这些年我一直在等今天，你欠我的总要还。' },
    ])
    const d = { ep: 7, lines, notes: [] }
    const r1 = w.reviewDraft(p, d)
    const fixed = w.reviseDraft(p, d, 1, r1)
    const r2 = w.reviewDraft(p, { ep: 7, lines: fixed.lines }, { base: { review: r1, lines, history: [] } })
    // 钩子一直没补：第一次复审「仍在」，第二次「AI 改不动」，修稿不再改、交给人工
    const noHook = (ls) => ls.filter((l) => l.kind !== 'hook')
    const h1 = { ...r1, id: 'h1' }
    const h2 = { ...w.reviewDraft(p, { ep: 7, lines: noHook(fixed.lines) }, { base: { review: h1, lines, history: [] } }), id: 'h2' }
    const h3 = w.reviewDraft(p, { ep: 7, lines: noHook(fixed.lines) }, { base: { review: h2, lines: noHook(fixed.lines), history: [h1] } })
    const stuckFix = w.reviseDraft(p, { ep: 7, lines: noHook(fixed.lines), notes: [] }, 1, h3)
    // 改好又出现
    const back = w.reviewDraft(p, { ep: 7, lines: noHook(fixed.lines) }, { base: { review: { ...r2, id: 'r2' }, lines: fixed.lines, history: [h1] } })
    // 复审不挑没改过的段落：上一轮没提的 AI 味，只要那行没动就不算新问题；全量重审才列出
    const plain = lines.concat([{ id: 'f1', kind: 'action', zh: '△ 她' + AI_FILLERS[0] + '回头。' }])
    const clean = { id: 'c0', at: '', score: 5, items: [] }
    const re = w.reviewDraft(p, { ep: 7, lines: plain }, { base: { review: clean, lines: plain, history: [] } })
    const full = w.reviewDraft(p, { ep: 7, lines: plain }, { base: { review: clean, lines: plain, history: [] }, kind: 'full' })
    // 保留不改：之后的审稿不再提，修稿也不动
    const kept = w.reviewDraft({ ...p, work: { ...p.work, keeps: [{ ep: 7, key: 'hook', text: 'x', level: 'block', reason: '留白', at: '' }] } }, d)
    // 写作：寡言人物的台词压短，写作依据记下这几项
    const wrote = w.writeEpisode(p, 7, 3)
    return {
      r1, fixed, r2, h2, h3, stuckFix, back, re, full, kept, wrote, quiet: quiet.name, filler: AI_FILLERS[0],
    }
  })()`)
  const by = (rev, code) => rev.items.find((i) => i.code === code)
  for (const c of ['rule', 'voice', 'event', 'hook']) if (!by(r.r1, c)) throw new Error('审稿应查出 ' + c + '：' + r.r1.items.map((i) => i.code).join())
  const rule = by(r.r1, 'rule')
  if (rule.basis !== 'core' || !rule.ref.includes('全局写作要求') || !rule.quote?.includes('血腥') || rule.lineId !== 'q1') throw new Error('核心设定意见要写明依据与原句：' + JSON.stringify(rule))
  if (by(r.r1, 'voice').basis !== 'character' || !by(r.r1, 'voice').ref.includes('寡言')) throw new Error('人物性格意见依据人物小传')
  if (by(r.r1, 'event').basis !== 'outline' || !by(r.r1, 'event').ref.includes('失踪的遗嘱')) throw new Error('集纲意见依据集纲')
  const open = r.r1.items.filter((i) => i.level === 'block' || i.level === 'warn')
  if (open.some((i) => !i.basis || !i.key || !i.ref)) throw new Error('每条意见都要有依据、依据原文与标识：' + JSON.stringify(open.filter((i) => !i.basis || !i.key || !i.ref)))
  // 修稿按依据改
  if (r.fixed.lines.some((l) => l.zh.includes('血腥'))) throw new Error('应删去写作要求不许出现的词')
  if (r.fixed.lines.some((l) => l.speaker === r.quiet && l.zh.length > 18)) throw new Error('寡言人物的长台词应压短')
  if (!r.fixed.lines.some((l) => l.zh.includes('旧仓库里搜出那份失'))) throw new Error('应补上集纲事件')
  // 复审：上一轮意见逐条标出改没改掉
  if (r.r2.kind !== 'recheck' || r.r2.baseId !== r.r1.id) throw new Error('复审应记下对照的审稿')
  for (const c of ['rule', 'voice', 'event', 'hook']) if (by(r.r2, c)?.status !== 'fixed' || by(r.r2, c).level !== 'ok') throw new Error(c + ' 应标为已改掉：' + JSON.stringify(by(r.r2, c)))
  if (by(r.h2, 'hook')?.status !== 'still') throw new Error('第一次复审没改掉应为「仍在」：' + by(r.h2, 'hook')?.status)
  if (by(r.h3, 'hook')?.status !== 'stuck') throw new Error('两轮没改掉应为「AI 改不动」：' + by(r.h3, 'hook')?.status)
  if (r.stuckFix.lines.some((l) => l.kind === 'hook') || !r.stuckFix.manual.some((m) => m.includes('两轮没改掉'))) throw new Error('AI 改不动的意见修稿不再改，交给人工')
  if (by(r.back, 'hook')?.status !== 'back') throw new Error('改好又出现应单独标出：' + by(r.back, 'hook')?.status)
  if (by(r.re, 'filler')) throw new Error('复审不应挑没改过的段落')
  if (!by(r.full, 'filler') || by(r.full, 'filler').status !== 'new') throw new Error('全量重审应列出全部问题')
  if (by(r.kept, 'hook')) throw new Error('保留不改的意见不应再提')
  // 写作依据
  const kinds = r.wrote.basis.map((b) => b.basis)
  for (const k of ['core', 'character', 'outline', 'format', 'style']) if (!kinds.includes(k)) throw new Error('写作依据缺少 ' + k + '：' + kinds.join())
  if (!r.wrote.basis.find((b) => b.basis === 'core').text.includes('血腥')) throw new Error('写作依据应写明避开的词')
  if (r.wrote.lines.some((l) => l.speaker === r.quiet && l.zh.length > 18)) throw new Error('写作时寡言人物的台词应压短')
  if (r.wrote.lines.some((l) => l.zh.includes(r.filler)) || r.wrote.lines.some((l) => l.kind === 'dialogue' && l.zh.length > 30)) throw new Error('写作时应去 AI 味、拆长台词')
  if (!r.wrote.lines.some((l) => l.zh.includes('旧仓库里搜出那份失'))) throw new Error('写作应写进集纲事件')
})

await check('审核报告：修稿出来的版本审稿是复审，写明对照哪一份；每条意见带依据与原句、可点到正文；可保留不改与撤销；有全量重审；还有严重问题时定稿要先改掉或写明理由保留', async () => {
  const back = await evaluate('location.pathname')
  await patchStored(`async (p) => {
    const { reviewDraft, writeEpisode } = await import('/src/services/mock/writer.ts')
    const at = new Date().toISOString()
    const d = writeEpisode(p, 9, 0)
    const lines = d.lines.filter((l) => l.kind !== 'hook')
    const r1 = { id: 'e2e-r9', at, ...reviewDraft(p, { ep: 9, lines }), sig: 'old' }
    const add = lines.concat([{ id: 'e2e-new', kind: 'dialogue', speaker: '路人乙', zh: '这里是新加的一句。' }])
    p.e2eHadBp9 = p.work.blueprints.some((b) => b.ep === 9)
    p.work.drafts.push(
      { id: 'e2e-d9a', ep: 9, version: 1, title: d.title, lines, status: 'revised', translated: false, states: d.states, reviews: [r1], notes: [], createdAt: at, updatedAt: at },
      { id: 'e2e-d9b', ep: 9, version: 2, title: d.title, lines: add, status: 'draft', translated: false, states: d.states, reviews: [], notes: [], from: 'e2e-d9a', revision: { reviewId: 'e2e-r9', reviewNo: 1, changes: ['x'], manual: [] }, createdAt: at, updatedAt: at },
    )
  }`, projectPath + '/stage/script/draft/e2e-d9b')
  const audit = `[...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === 'AI 审稿')`
  await waitFor(audit, 'AI 审稿按钮')
  if (!(await evaluate(`${audit}.title.includes('复审') && ${audit}.title.includes('草稿_v1 的审稿 #1')`))) throw new Error('修稿出来的版本审稿应说明是复审、对照哪一份')
  await evaluate(`${audit}.click()`)
  await waitFor(`document.querySelector('[data-review-notice]')?.innerText.includes('复审完成') && /仍在 [1-9]/.test(document.querySelector('[data-recheck-tally]')?.innerText)`, '复审提示框', 6000)
  await t(`__t.click('[data-review-notice] button', '查看详情')`)
  const rev = (await project()).work.drafts.find((d) => d.id === 'e2e-d9b').reviews.at(-1)
  if (rev.kind !== 'recheck' || rev.baseId !== 'e2e-r9') throw new Error('复审应记下对照的审稿：' + rev.kind)
  if (rev.items.find((i) => i.code === 'hook')?.status !== 'still') throw new Error('没补的钩子应为「修稿后仍在」')
  if (rev.items.find((i) => i.code === 'unknown')?.status !== 'new') throw new Error('改过的段落里的新问题应列出')
  const detail = `document.querySelector('[data-review-detail]')`
  await waitFor(`${detail}?.querySelector('[data-review-kind]')?.innerText.includes('复审：只查草稿_v1 的审稿 #1')`, '报告写明复审对照')
  if (!(await evaluate(`${detail}.innerText.includes('修稿后仍在') && ${detail}.innerText.includes('格式与篇幅') && ${detail}.querySelector('[data-review-ref]')?.innerText.startsWith('依据：')`))) throw new Error('意见应带依据标签、状态与依据原文')
  // 原句可点：正文滚到那一行
  await evaluate(`${detail}.querySelector('[data-review-item=unknown] [data-review-quote]').click()`)
  await waitFor(`document.querySelector('[data-line-id="e2e-new"]')`, '定位到正文那一行')
  await sleep(200)
  await shot('draft-recheck')
  // 建议级别一键保留不改，可撤销
  const unknownRow = `${detail}.querySelector('[data-review-item=unknown]')`
  await evaluate(`${unknownRow}.querySelector('[data-keep]').click()`)
  await waitFor(`${unknownRow}?.querySelector('[data-kept]') && document.querySelector('[data-kept-list]')`, '保留不改')
  if (!(await project()).work.keeps?.some((k) => k.ep === 9 && k.key === 'unknown')) throw new Error('保留不改应记下')
  await t(`__t.click('[data-review-item=unknown] button', '撤销')`)
  await waitFor(`!${unknownRow}?.querySelector('[data-kept]') && !document.querySelector('[data-kept-list]')`, '撤销保留')
  // 严重问题保留要写理由
  await evaluate(`${detail}.querySelector('[data-review-item=hook] [data-keep]').click()`)
  await waitFor(`${detail}.querySelector('[data-review-item=hook] input[aria-label=保留理由]')`, '严重问题要写理由')
  if (!(await evaluate(`[...${detail}.querySelectorAll('[data-review-item=hook] button')].find((b) => b.textContent === '保留').disabled`))) throw new Error('没写理由不能保留')
  await t(`__t.click('[data-review-item=hook] button', '取消')`)
  // 全量重审
  await evaluate(`${detail}.querySelector('[data-full-review]').click()`)
  await waitFor(`document.querySelector('[data-review-notice]')?.innerText.includes('审稿完成')`, '全量重审', 6000)
  await t(`__t.click('[data-review-notice] button', '知道了')`)
  const full = (await project()).work.drafts.find((d) => d.id === 'e2e-d9b').reviews.at(-1)
  if (full.kind !== 'full' || full.baseId !== 'e2e-r9') throw new Error('全量重审仍跟踪上一轮：' + full.kind)
  // 还有严重问题：定稿先过关口
  await t(`__t.click('main button', '定稿')`)
  await waitFor(`document.querySelector('[data-final-gate]')`, '定稿关口')
  const confirm = `[...document.querySelectorAll('[role=dialog] button')].find((b) => b.textContent === '保留并定稿')`
  if (!(await evaluate(`${confirm}.disabled`))) throw new Error('没写理由不能定稿')
  await sleep(200)
  await shot('draft-final-gate')
  await evaluate(`[...document.querySelectorAll('[data-final-gate] input')].forEach((el) => { ${helpers}; __t.type(el, '这一集刻意留白') })`)
  await waitFor(`!${confirm}.disabled`, '写好理由')
  await evaluate(`${confirm}.click()`)
  await waitFor(`location.pathname.endsWith('/final/9')`, '定稿后打开正文', 6000)
  const after = await project()
  if (!after.work.keeps.some((k) => k.ep === 9 && k.key === 'hook' && k.reason === '这一集刻意留白')) throw new Error('定稿关口应记下保留理由')
  // 收拾：不影响后面的检查
  await patchStored(`async (p) => {
    p.work.drafts = p.work.drafts.filter((d) => d.ep !== 9)
    p.work.scripts = p.work.scripts.filter((s) => s.ep !== 9)
    if (!p.e2eHadBp9) p.work.blueprints = p.work.blueprints.filter((b) => b.ep !== 9)
    delete p.e2eHadBp9
    p.work.keeps = []
  }`, back)
  await waitFor(`[...document.querySelectorAll('main button')].some((b) => b.textContent.trim() === '重新生成')`, '回到原来的草稿页')
})

await check('草稿页：重新生成只对本集重写一版，生成下一个版本的草稿', async () => {
  const btn = `[...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === '重新生成')`
  await waitFor(btn, '重新生成按钮')
  if (await evaluate(`${btn}.disabled`)) {
    // 写作前检查拦下（如本集没有蓝图）时按钮禁用并说明原因
    if (!(await evaluate(`${btn}.title.includes('第 7 集')`))) throw new Error('禁用时应说明原因')
    return
  }
  const before = (await project()).work.drafts.filter((d) => d.ep === 7)
  const path = await evaluate('location.pathname')
  await evaluate(`${btn}.click()`)
  await waitFor(`location.pathname !== '${path}'`, '打开新版本', 8000)
  const after = (await project()).work.drafts.filter((d) => d.ep === 7)
  if (after.length !== before.length + 1) throw new Error('应只多出一版')
  const v = Math.max(...before.map((d) => d.version)) + 1
  const created = after.find((d) => d.version === v)
  if (!created || created.from) throw new Error('新版本应为 草稿_v' + v + '，且不计入修稿轮数')
  if ((await project()).work.drafts.some((d) => d.ep !== 7 && d.updatedAt > created.createdAt)) throw new Error('不应改动其他集')
  await waitFor(`document.body.innerText.includes('草稿_v${v}') || document.body.innerText.includes('v${v}')`, '页面显示新版本')
})

await check('AI 模型：页头在「项目设置」前选视频解析 / 文本模型，改了马上生效；上传框下也能选视频解析模型；写作可临时换模型；草稿、审稿与分镜记下模型；设置页不再有模型', async () => {
  const draftPage = await evaluate('location.pathname')
  const head = (g) => `document.querySelector('[data-models] [data-model-pick=${g}]')`
  const headValue = (g) => evaluate(`${head(g)}?.querySelector('[data-model-value]')?.textContent`)
  const menuItems = () => evaluate(`[...document.querySelectorAll('[role=menu] [role=menuitem]')].map((b) => b.textContent).join()`)
  // 默认文本模型豆包；草稿页头写明这一版由哪个模型生成
  const opened = (await project()).work.drafts.find((d) => draftPage.endsWith(d.id))
  if (opened.model !== 'doubao') throw new Error('没选过模型时写作应用默认的豆包：' + opened.model)
  // AI 修稿出来的版本写「修稿」，直接写出的写「生成」
  const label = `豆包 ${opened.revision ? '修稿' : '生成'}`
  await waitFor(`document.querySelector('[data-draft-model]')?.textContent === '${label}'`, '草稿页头「' + label + '」')
  // 原创项目页头只有文本模型，在「项目设置」之前；环节页的单行页头也有
  const picks = await evaluate(`[...document.querySelectorAll('[data-models] [data-model-pick]')].map((e) => e.dataset.modelPick).join()`)
  if (picks !== 'text') throw new Error('原创项目页头应只有文本模型：' + picks)
  const before = `(() => { const a = ${head('text')}; const b = [...document.querySelectorAll('main a')].find((x) => x.textContent.includes('项目设置')); return !!a && !!b && !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) })()`
  if (!(await evaluate(before))) throw new Error('模型选择应在「项目设置」之前')
  // 设置页不再有模型卡片
  await goto(projectPath + '/settings')
  await waitFor(`document.querySelector('[data-settings]')`, '设置页')
  if (await evaluate(`document.querySelector('[data-settings]').innerText.includes('AI 模型')`)) throw new Error('设置页不应再有 AI 模型卡片')
  // 概览页头改文本模型为 Kimi：马上生效，只存和默认不同的
  await goto(projectPath)
  await waitFor(head('text'), '页头文本模型')
  if ((await headValue('text')) !== '豆包') throw new Error('默认文本模型应为豆包')
  await evaluate(`${head('text')}.click()`)
  await waitFor(`document.querySelector('[role=menu]')?.innerText.includes('文本模型')`, '文本模型菜单')
  if ((await menuItems()) !== 'DeepSeek,通义千问,豆包（默认）,Kimi,GPT,Gemini') throw new Error('文本模型应列出 6 个并标出默认：' + (await menuItems()))
  // 已经写过集：菜单顶部先提醒中途换模型会文风不一致
  const note = await evaluate(`document.querySelector('[role=menu] [data-model-note]')?.textContent ?? ''`)
  if (!/^已写 \d+ 集：/.test(note) || !note.includes('文风不一致')) throw new Error('文本模型菜单顶部应提醒中途换模型文风不一致：' + note)
  await sleep(150)
  await shot('header-models')
  await t(`__t.click('[role=menu] [role=menuitem]', 'Kimi')`)
  await waitFor(`${head('text')}.querySelector('[data-model-value]').textContent === 'Kimi' && document.body.innerText.includes('之后的文本生成改用 Kimi')`, '改为 Kimi')
  if (JSON.stringify((await project()).models) !== '{"text":"kimi"}') throw new Error('应只存改过的模型：' + JSON.stringify((await project()).models))
  // 草稿页「重新生成」旁的 ▾：这次换 Gemini 写，不改项目的选择（先补上第 7 集蓝图，免得被写作前检查拦下；测完删掉）
  const hadBlueprint = (await project()).work.blueprints.some((b) => b.ep === 7)
  await patchStored(`async (p) => {
    const { draftBlueprints } = await import('/src/services/mock/writer.ts')
    if (!p.work.blueprints.some((b) => b.ep === 7)) p.work.blueprints.push(...draftBlueprints(p, 7, 7, 0))
  }`, draftPage)
  if (!(await project()).work.blueprints.some((b) => b.ep === 7)) throw new Error('第 7 集补不上蓝图')
  await waitFor(`document.querySelector('[data-models] [data-model-pick=text]')?.textContent.includes('Kimi')`, '草稿页的单行页头也有文本模型')
  // 页头吸顶：正文滚到底，页头仍贴在顶上，随时能换模型；页头的模型下拉在最上层，不被正文、格式栏、审核报告遮住
  await evaluate(`document.querySelector('main').scrollTop = 1e6`)
  await sleep(150)
  const stuck = await evaluate(`(() => { const m = document.querySelector('main'); const h = document.querySelector('[data-project-head]'); return { scrolled: m.scrollTop, gap: Math.round(h.getBoundingClientRect().top - m.getBoundingClientRect().top) } })()`)
  if (!stuck.scrolled || Math.abs(stuck.gap) > 1) throw new Error('页头应吸顶：' + JSON.stringify(stuck))
  // 左侧环节导航让出页头的高度，不被页头盖住
  const navGap = await evaluate(`Math.round(document.querySelector('[data-stage-nav]').getBoundingClientRect().top - document.querySelector('[data-project-head]').getBoundingClientRect().bottom)`)
  if (navGap < 0) throw new Error('左侧导航被页头盖住：' + navGap)
  await evaluate(`${head('text')}.click()`)
  await waitFor(`document.querySelector('[data-project-head] [role=menu]')`, '页头文本模型菜单')
  const headCovered = await evaluate(`[...document.querySelectorAll('[data-project-head] [role=menu] [role=menuitem]')].filter((b) => { const r = b.getBoundingClientRect(); return !b.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)) }).map((b) => b.textContent)`)
  if (headCovered.length) throw new Error('页头模型菜单被遮住：' + headCovered)
  await sleep(150)
  await shot('draft-head-menu-sticky')
  await evaluate(`${head('text')}.click()`)
  await waitFor(`!document.querySelector('[data-project-head] [role=menu]')`, '关上页头菜单')
  await evaluate(`document.querySelector('main').scrollTop = 0`)
  const more = `[...document.querySelectorAll('main button[aria-label=换个模型写作]')]`
  await waitFor(`${more}.length === 1 && !${more}[0].disabled`, '重新生成旁的 ▾')
  await evaluate(`${more}[0].click()`)
  await waitFor(`document.querySelector('[role=menu]')?.innerText.includes('这次换个模型写')`, '模型菜单')
  if ((await menuItems()) !== 'DeepSeek,通义千问,豆包,Kimi（项目默认）,GPT,Gemini') throw new Error('▾ 应以文本模型为默认：' + (await menuItems()))
  if (!(await evaluate(`document.querySelector('[role=menu] [data-model-note]')?.textContent.includes('文风可能和前几集不同')`))) throw new Error('▾ 菜单应提示换模型写的这一版文风可能不同')
  // 菜单不被下方正文格式栏遮住：每一项都点得到
  const covered = await evaluate(`[...document.querySelectorAll('[role=menu] [role=menuitem]')].filter((b) => { const r = b.getBoundingClientRect(); return !b.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)) }).map((b) => b.textContent)`)
  if (covered.length) throw new Error('模型菜单被遮住：' + covered)
  await sleep(150)
  await shot('draft-model-menu')
  await t(`__t.click('[role=menu] [role=menuitem]', 'Gemini')`)
  await waitFor(`location.pathname !== '${draftPage}' && document.querySelector('[data-draft-model]')?.textContent === 'Gemini 生成'`, 'Gemini 写出的新版本', 8000)
  if (!(await t(`__t.has('换用 Gemini')`))) throw new Error('提示里应写明换用了哪个模型')
  const viaGemini = (await project()).work.drafts.filter((d) => d.ep === 7).at(-1)
  if (viaGemini.model !== 'gemini' || (await project()).models.text !== 'kimi') throw new Error('临时换模型应只记在这一版上，不改项目的文本模型')
  // 不换模型直接重新生成：用项目的文本模型；审稿也用文本模型
  const path = await evaluate('location.pathname')
  await t(`[...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === '重新生成').click()`)
  await waitFor(`location.pathname !== '${path}' && document.querySelector('[data-draft-model]')?.textContent === 'Kimi 生成'`, 'Kimi 写出的新版本', 8000)
  await t(`__t.click('button', 'AI 审稿')`)
  await waitFor(`document.querySelector('[data-review-detail] [data-review-model]')?.textContent.includes('Kimi 审稿')`, '审稿报告显示模型', 6000)
  if ((await project()).work.drafts.filter((d) => d.ep === 7).at(-1).reviews.at(-1).model !== 'kimi') throw new Error('审稿应记下文本模型')
  await evaluate(`document.querySelector('[data-review-notice] button')?.click()`)
  await sleep(200)
  await shot('draft-review-model')
  // 改回默认：不再存
  await evaluate(`${head('text')}.click()`)
  await waitFor(`document.querySelector('[role=menu]')?.innerText.includes('文本模型')`, '文本模型菜单')
  await t(`__t.click('[role=menu] [role=menuitem]', '豆包（默认）')`)
  await waitFor(`${head('text')}.querySelector('[data-model-value]').textContent === '豆包'`, '改回豆包')
  if (JSON.stringify((await project()).models) !== '{}') throw new Error('改回默认后不应再存：' + JSON.stringify((await project()).models))
  // 视频转剧本：页头多一个视频解析模型；上传框下也能选，两边是同一个选择，只列能看视频的模型
  await patchStored(`async (p) => { p.mode = 'video'; p.work.video = null }`, projectPath + '/stage/video')
  await waitFor(`document.querySelector('[data-video-model] [data-model-pick=video]')`, '上传框下的视频解析模型')
  const vpicks = await evaluate(`[...document.querySelectorAll('[data-models] [data-model-pick]')].map((e) => e.dataset.modelPick).join()`)
  if (vpicks !== 'video,text') throw new Error('视频转剧本项目页头应有视频解析 + 文本：' + vpicks)
  const below = await evaluate(`(() => { const up = [...document.querySelectorAll('main button')].find((b) => b.textContent.includes('点击或拖拽上传全集视频')); const m = document.querySelector('[data-video-model]'); return up.getBoundingClientRect().bottom <= m.getBoundingClientRect().top })()`)
  if (!below) throw new Error('视频解析模型应在上传框下面')
  await evaluate(`document.querySelector('[data-video-model] [data-model-pick=video]').click()`)
  await waitFor(`document.querySelector('[role=menu]')?.innerText.includes('视频解析模型')`, '视频解析模型菜单')
  if ((await menuItems()) !== '通义千问（默认）,豆包,Gemini') throw new Error('视频解析只列能看视频的模型：' + (await menuItems()))
  if (!(await evaluate(`document.querySelector('[role=menu] [data-model-note]')?.textContent.includes('转写格式不一致')`))) throw new Error('视频解析菜单顶部应提醒中途换模型转写格式不一致')
  await sleep(150)
  await shot('video-model')
  await t(`__t.click('[role=menu] [role=menuitem]', '豆包')`)
  await waitFor(`${head('video')}.querySelector('[data-model-value]').textContent === '豆包'`, '页头跟着变成豆包')
  if (JSON.stringify((await project()).models) !== '{"video":"doubao"}') throw new Error('视频解析模型应存在项目上：' + JSON.stringify((await project()).models))
  // 转写完的集记下解析模型
  await t(`__t.click('button', '上传示例视频')`)
  await waitFor(`document.body.innerText.includes('豆包 解析')`, '逐集转写显示解析模型')
  await waitFor(`JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').work.video?.episodes.some((e) => e.status === 'done')`, '第一集转写完', 12000)
  const doneEp = (await project()).work.video.episodes.find((e) => e.status === 'done')
  if (doneEp.model !== 'doubao') throw new Error('转写完的集应记下视频解析模型：' + doneEp.model)
  // 先停掉队列，免得它在恢复数据后又写回存储
  await evaluate(`import('/src/store/videoQueue.ts').then((m) => m.stopQueue('${projectId}'))`)
  await sleep(300)
  await patchStored(`async (p) => { p.mode = 'original'; p.work.video = null; p.models = {} }`, projectPath + '/settings')
  if (!hadBlueprint) await patchStored(`async (p) => { p.work.blueprints = p.work.blueprints.filter((b) => b.ep !== 7) }`, projectPath + '/settings')
})

await check('视频转剧本：合并后 AI 校对（文本模型）查出没按模板输出的集、人名写法不一、同音错字；勾选确认后才改，被概括的台词提示重新转写这一集', async () => {
  const video = `(await import('/src/services/mock/video.ts'))`
  await patchStored(`async (p) => {
    const v = ${video}
    const at = '2026-10-29T10:00:00.000Z'
    const job = { origin: 'link', url: 'https://www.reelshort.com/x', platform: 'ReelShort', createdAt: at, merged: null, episodes: v.resolveLink('https://www.reelshort.com/x').episodes }
    job.episodes = job.episodes.map((e) => ({ ...e, attempts: 1, status: 'done', doneAt: at, model: 'qwen', shots: v.transcribe(e.ep, v.offTemplateOf(job, { ...e, attempts: 1 })) }))
    p.e2eSource = p.work.source ?? null
    p.mode = 'video'
    p.models = {}
    p.work.video = job
  }`, projectPath + '/stage/video')
  // 逐集转写表里先标出没按模板输出的那一集
  await waitFor(`document.querySelectorAll('[data-off-template]').length === 1`, '转写表标出没按模板输出的集')
  const offEp = (await project()).work.video.episodes.find((e) => !e.shots.some((s) => s.speaker)).ep
  await t(`__t.click('main button', '合并并修正格式')`)
  await waitFor(`document.querySelector('[data-proofread-record=none]')`, '合并后提示还没 AI 校对', 6000)
  // AI 校对：用文本模型，分三组列出
  await t(`__t.click('main button', 'AI 校对')`)
  await waitFor(`document.querySelector('[data-proofread-dialog]')`, '校对结果', 6000)
  const dialog = `document.querySelector('[data-proofread-dialog]')`
  if (!(await evaluate(`document.querySelector('[role=dialog]').innerText.includes('豆包 校对')`))) throw new Error('校对应写明用的文本模型')
  const tpl = `${dialog}.querySelector('[data-proof-item="template:${offEp}"]')`
  if (!(await evaluate(`${tpl}?.innerText.includes('没按模板输出') && ${tpl}.innerText.includes('残留时间码') && ${tpl}.innerText.includes('场景：')`))) throw new Error('应查出第 ' + offEp + ' 集没按模板输出，并给出改后的例句')
  if (!(await evaluate(`${tpl}.querySelector('[data-proof-lost] [data-retranscribe]')?.textContent.includes('重新转写第 ${offEp} 集')`))) throw new Error('被概括的台词应提示重新转写这一集')
  const names = await evaluate(`[...${dialog}.querySelectorAll('[data-proof-group=name] [data-proof-item]')].map((e) => e.dataset.proofItem)`)
  const typos = await evaluate(`[...${dialog}.querySelectorAll('[data-proof-group=typo] [data-proof-item]')].map((e) => e.dataset.proofItem)`)
  if (!names.includes('name:爱拉') || !typos.length) throw new Error('应查出人名写法不一与同音错字：' + names + ' / ' + typos)
  await sleep(200)
  await shot('video-proofread')
  // 取消一项错字：只改勾选的
  const skip = typos[0]
  const total = await evaluate(`${dialog}.querySelectorAll('input[type=checkbox]').length`)
  await evaluate(`${dialog}.querySelector('[data-proof-item="${skip}"] input[type=checkbox]').click()`)
  await waitFor(`[...document.querySelectorAll('[role=dialog] button')].some((b) => b.textContent === '应用选中的 ${total - 1} 项')`, '取消一项后的应用按钮')
  await t(`__t.click('[role=dialog] button', '应用选中的')`)
  await waitFor(`document.querySelector('[data-proofread-record=done]')?.innerText.includes('第 ${offEp} 集按模板重整')`, '校对记录')
  await evaluate(`document.querySelector('[data-proofread-record]').scrollIntoView({ block: 'center' })`)
  await sleep(300)
  await shot('video-proofread-applied')
  const merged = (await project()).work.video.merged
  const block = merged.text.split('\n\n').find((b) => b.startsWith('第' + offEp + '集'))
  if (/说：“|\[\d{2}:\d{2}\]|镜头切到/.test(block) || !block.includes('场景：')) throw new Error('没按模板输出的集应重整成标准格式：' + block.slice(0, 200))
  if (merged.text.includes('爱拉') || !merged.text.includes(skip.slice(5))) throw new Error('只改勾选的项：人名统一，没勾的错字保留')
  if (merged.proofread.model !== 'doubao' || merged.proofread.applied.length !== total - 1 || merged.importedAt !== null) throw new Error('应记下校对模型与应用了哪些：' + JSON.stringify(merged.proofread))
  // 再校对：只剩没勾的错字，和重整补不回来、要重新转写的那一集
  await t(`__t.click('main button', '重新校对')`)
  await waitFor(`document.querySelector('[data-proofread-dialog]')`, '再次校对', 6000)
  const left = await evaluate(`[...document.querySelectorAll('[data-proofread-dialog] [data-proof-item]')].map((e) => e.dataset.proofItem).join()`)
  if (left !== `template:${offEp},${skip}`) throw new Error('再校对应只剩没勾的错字和没转写全的集：' + left)
  if (!(await evaluate(`document.querySelector('[data-proof-item="template:${offEp}"]').innerText.includes('台词没转写全') && !document.querySelector('[data-proof-item="template:${offEp}"] input')`))) throw new Error('只剩被概括台词的集不能勾选应用，只能重新转写')
  // 重新转写这一集：合并稿作废，转写完按模板输出，重新合并后校对不再报这一集
  await evaluate(`document.querySelector('[data-retranscribe]').click()`)
  await waitFor(`[...document.querySelectorAll('[role=dialog]')].some((d) => d.innerText.includes('重新转写第 ${offEp} 集？'))`, '重新转写确认')
  await t(`__t.click('[role=dialog] button', '重新转写')`)
  await waitFor(`!document.querySelector('[data-proofread-record]') && document.body.innerText.includes('还有 1 集没有转写完成')`, '合并稿作废、这一集重新排队')
  await waitFor(`!document.querySelector('[data-off-template]') && [...document.querySelectorAll('main button')].some((b) => b.textContent.includes('合并并修正格式') && !b.disabled)`, '重新转写完成', 12000)
  await t(`__t.click('main button', '合并并修正格式')`)
  await waitFor(`document.querySelector('[data-proofread-record=none]')`, '重新合并', 6000)
  await t(`__t.click('main button', 'AI 校对')`)
  await waitFor(`document.querySelector('[data-proofread-dialog]')`, '重新合并后校对', 6000)
  if (await evaluate(`!!document.querySelector('[data-proof-group=template]')`)) throw new Error('重新转写后这一集应按模板输出')
  await t(`__t.click('[role=dialog] button', '取消')`)
  await evaluate(`import('/src/store/videoQueue.ts').then((m) => m.stopQueue('${projectId}'))`)
  await sleep(200)
  await patchStored(`async (p) => { p.mode = 'original'; p.work.video = null; p.models = {}; p.work.source = p.e2eSource; delete p.e2eSource }`, projectPath + '/settings')
})

/* ---------------------------------- 版本二 ---------------------------------- */

const UI_KEY = 'zhiying.uiVersion'
const versionPressed = (label) => `[...document.querySelectorAll('[aria-label=界面版本] button')].find((b) => b.textContent.includes('${label}'))?.getAttribute('aria-pressed') === 'true'`
const btnClass = (label, scope = 'document') => `([...${scope}.querySelectorAll('button')].find((b) => b.textContent.trim() === '${label}')?.className ?? '')`
/** 元素顶部已滚到视口上部；最后一个板块不够长时，滚到底且已露出也算 */
const nearTop = (sel) => `(() => {
  const r = document.querySelector('${sel}')?.getBoundingClientRect()
  if (!r) return false
  if (r.top > -20 && r.top < 260) return true
  const m = document.querySelector('main')
  return m.scrollHeight - m.clientHeight - m.scrollTop < 2 && r.top < innerHeight - 120
})()`

/* -------------------------------- 定稿事件 -------------------------------- */

// 新建一条计划，标题取自第 ep 集定稿里的一句，保证 AI 能在定稿里找到它
const injectPlan = (id, ep, plantEp, path) =>
  patchStored(`async (p) => {
    const s = p.work.scripts.find((x) => x.ep === ${ep})
    const raw = s.lines.filter((l) => l.kind !== 'scene' && l.zh.replace(/\s/g, '').length >= 8)[2].zh.replace(/\s/g, '')
    p.work.foreshadows = p.work.foreshadows.filter((f) => f.id !== '${id}')
    p.work.foreshadows.push({ id: '${id}', type: '关键道具', title: raw.slice(2, 6), content: '', plantEp: ${plantEp}, payoffEp: 10, events: [] })
  }`, path)
const planOf = async (id) => (await project()).work.foreshadows.find((f) => f.id === id)
const eventTotal = async () => (await project()).work.foreshadows.reduce((n, f) => n + f.events.length, 0)

await check('伏笔线索：「确认定稿事件」在卡片里展开；证据须逐字摘自定稿，AI 识别填入后由人保存', async () => {
  await injectPlan('e2e-fs1', 2, 2, projectPath + '/stage/foreshadow')
  const card = `document.getElementById('plan-e2e-fs1')`
  await waitFor(card, '计划卡片')
  await t(`__t.click('#plan-e2e-fs1 button', '确认定稿事件')`)
  await waitFor(`${card}.querySelector('[data-event-form]') && ${card}.querySelector('button[aria-expanded=true]')`, '卡片内展开表单')
  await t(`__t.type(document.querySelector('#plan-e2e-fs1 [aria-label=证据原文]'), '这句话不在定稿里')`)
  await t(`__t.type(document.querySelector('#plan-e2e-fs1 [aria-label=确认理由]'), '测试')`)
  await waitFor(`${card}.innerText.includes('定稿里没有这段原文')`, '证据逐字校验')
  if (!(await t(`__t.find('#plan-e2e-fs1 button', '保存事件').disabled`))) throw new Error('证据不在定稿里时不能保存')
  await t(`__t.click('#plan-e2e-fs1 button', 'AI 识别定稿事件')`)
  await until(`!__t.find('#plan-e2e-fs1 button', '保存事件').disabled`, 'AI 填入证据与理由', 5000)
  if ((await planOf('e2e-fs1')).events.length) throw new Error('AI 识别后不应直接记入')
  await evaluate(`${card}.scrollIntoView({ block: 'center' })`)
  await sleep(300)
  await shot('foreshadow-confirm')
  await t(`__t.click('#plan-e2e-fs1 button', '保存事件')`)
  await waitFor(`!${card}.querySelector('[data-event-form]')`, '保存后收起')
  const [ev] = (await planOf('e2e-fs1')).events
  if (!ev?.reason) throw new Error('事件应带确认理由')
  if (!(await project()).work.scripts.find((s) => s.ep === ev.ep).lines.some((l) => l.zh.includes(ev.text))) throw new Error('证据应逐字来自所选定稿')
  if (!(await evaluate(`${card}.innerText.includes('理由：')`))) throw new Error('卡片应显示确认理由')
})

await check('伏笔线索：AI 批量确认定稿先在弹窗里勾选，确认后才记入', async () => {
  await injectPlan('e2e-fs2', 3, 3, projectPath + '/stage/foreshadow')
  const title = (await planOf('e2e-fs2')).title
  const before = await eventTotal()
  await until(`!__t.find('button', 'AI 批量确认定稿').disabled`, '批量按钮可用')
  await t(`__t.click('button', 'AI 批量确认定稿')`)
  await waitFor(dialog('AI 批量确认定稿事件'), '批量弹窗', 5000)
  if ((await eventTotal()) !== before) throw new Error('弹窗打开时不应直接记入')
  const boxes = `[...document.querySelectorAll('[role=dialog] input[type=checkbox]')]`
  if (!(await evaluate(`${boxes}.some((b) => b.getAttribute('aria-label').startsWith('确认：${title}'))`))) throw new Error('批量结果缺少新计划')
  const n = await evaluate(`${boxes}.length`)
  if (n > 1) await evaluate(`${boxes}.find((b) => !b.getAttribute('aria-label').startsWith('确认：${title}')).click()`)
  const want = n > 1 ? n - 1 : n
  await sleep(200)
  await shot('foreshadow-batch')
  await t(`__t.click('[role=dialog] button', '确认 ${want} 个事件')`)
  await waitFor(`!document.querySelector('[role=dialog]')`, '关闭弹窗')
  if ((await eventTotal()) !== before + want) throw new Error('应只记入勾选的事件')
  if (!(await planOf('e2e-fs2')).events.length) throw new Error('新计划应记入事件')
})

await check('状态库：计划在本集埋设的伏笔，本集定稿后可在侧栏就地确认；未定稿时提示定稿后可确认', async () => {
  await injectPlan('e2e-fs3', 4, 4, projectPath + '/stage/script/final/4')
  const title = (await planOf('e2e-fs3')).title
  if (!(await evaluate(`!!${panel}`))) await t(`document.querySelector('[aria-label=展开剧本状态库]').click()`)
  await waitFor(panel, '状态库展开')
  await t(`__t.click('aside [role=tab]', '状态库')`)
  await panelTab('本集')
  const item = `[...document.querySelectorAll('aside[aria-label=剧本状态库] li')].find((li) => li.innerText.includes('${title}') && li.innerText.includes('还没埋设'))`
  await waitFor(item, '定稿集里计划埋设、还没确认')
  await evaluate(`[...${item}.querySelectorAll('button')].find((b) => b.textContent === '确认定稿').click()`)
  await waitFor(`${item}?.querySelector('[data-event-form]')`, '侧栏展开确认表单')
  if (!(await evaluate(`${item}.querySelector('[aria-label=定稿章节]').value === '4' && ${item}.querySelector('[aria-label=事件类型]').value === 'plant'`))) throw new Error('应预选第 4 集、埋设')
  await evaluate(`[...${item}.querySelectorAll('button')].find((b) => b.textContent.includes('AI 识别定稿事件')).click()`)
  await waitFor(`!![...${item}.querySelectorAll('button')].find((b) => b.textContent === '保存事件' && !b.disabled)`, 'AI 填入', 5000)
  await sleep(200)
  await shot('state-panel-confirm')
  await evaluate(`[...${item}.querySelectorAll('button')].find((b) => b.textContent === '保存事件').click()`)
  await waitFor(`${panel}.innerText.includes('本集已埋设')`, '侧栏显示本集已埋设')
  const [ev] = (await planOf('e2e-fs3')).events
  if (ev?.ep !== 4 || ev.kind !== 'plant') throw new Error('应记为第 4 集埋设')
  // 还没定稿的集：按钮提示定稿后可确认
  await patchStored(`async (p) => { p.work.foreshadows.push({ id: 'e2e-fs4', type: '关键道具', title: '未定稿道具', content: '', plantEp: 7, payoffEp: 10, events: [] }) }`, projectPath + '/stage/foreshadow')
  await waitFor(`${panel}?.innerText.includes('第 7 集') && ${panel}.innerText.includes('未定稿道具') && ${panel}.innerText.includes('本集需埋设')`, '第 7 集计划')
  if (!(await evaluate(`[...document.querySelectorAll('aside[aria-label=剧本状态库] button')].some((b) => b.textContent === '定稿后可确认' && b.disabled)`))) throw new Error('未定稿的集应提示定稿后可确认')
})

await check('状态库：伏笔超期不只提醒——可 AI 确认定稿、改期或不要了', async () => {
  await injectPlan('e2e-late', 2, 1, projectPath + '/stage/script/final/4')
  const title = (await planOf('e2e-late')).title
  if (!(await evaluate(`!!${panel}`))) await t(`document.querySelector('[aria-label=展开剧本状态库]').click()`)
  await waitFor(panel, '状态库展开')
  await t(`__t.click('aside [role=tab]', '状态库')`)
  await panelTab('本集')
  const item = `[...document.querySelectorAll('aside[aria-label=剧本状态库] li')].find((li) => li.innerText.includes('${title}') && li.innerText.includes('已超出'))`
  await waitFor(item, '超期提醒')
  const btn = (label) => `[...${item}.querySelectorAll('button')].find((b) => b.textContent.trim() === '${label}')`
  await evaluate(`${btn('处理')}.click()`)
  await waitFor(`${item}?.querySelector('[data-late-fix]')?.innerText.includes('还要吗')`, '展开超期处理')
  // AI 确认定稿：打开即识别，填进表单后由人保存
  await evaluate(`${btn('AI 确认定稿')}.click()`)
  await waitFor(`!!${btn('保存事件')} && !${btn('保存事件')}.disabled`, 'AI 填入定稿事件', 5000)
  await sleep(200)
  await shot('state-panel-late-fix')
  // 还要，改期：改到还没定稿的集
  await evaluate(`${btn('还要，改期')}.click()`)
  const to = await evaluate(`${item}.querySelector('[aria-label=改期埋设集]').value`)
  const written = Math.max(...(await project()).work.scripts.map((x) => x.ep))
  if (Number(to) !== written + 1) throw new Error(`改期应从第 ${written + 1} 集起，实际 ${to}`)
  await evaluate(`${btn('保存')}.click()`)
  await waitFor(`JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').work.foreshadows.find((f) => f.id === 'e2e-late').plantEp === ${to}`, '改期写回')
  const moved = await planOf('e2e-late')
  if (moved.payoffEp <= moved.plantEp) throw new Error('回收应晚于埋设')
  // 不要了：确认后删除计划
  await injectPlan('e2e-late2', 2, 1, projectPath + '/stage/script/final/4')
  const title2 = (await planOf('e2e-late2')).title
  const item2 = `[...document.querySelectorAll('aside[aria-label=剧本状态库] li')].find((li) => li.innerText.includes('${title2}') && li.innerText.includes('已超出'))`
  await waitFor(item2, '第二条超期提醒')
  await evaluate(`[...${item2}.querySelectorAll('button')].find((b) => b.textContent.trim() === '处理').click()`)
  await waitFor(`${item2}?.querySelector('[data-late-fix]')`, '展开')
  await evaluate(`[...${item2}.querySelectorAll('button')].find((b) => b.textContent.trim() === '不要了').click()`)
  await waitFor(dialog('不要这条计划了？'), '删除前确认')
  await t(`__t.click('[role=dialog] button', '删除')`)
  await waitFor(`!JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').work.foreshadows.some((f) => f.id === 'e2e-late2')`, '计划已删除')
})

await check('正文章节：侧栏并成「本集要点 / 状态库 / 标注」标签页；要点不显示 Markdown 符号、不重复人物状态；定稿也能标注', async () => {
  // 要点存在蓝图上：给第 4 集补一份带 Markdown 的要点（与 AI 提炼的格式一致）
  const ep = 4
  const points = ['# 第4集 要点', '', '## 剧情节点', '- [触发] 门外传来脚步声', '- [转折] **真相揭晓**', '', '## 角色动态', '| 角色 | 本集变化/状态 |', '|------|-------------|', '| 埃琳娜 | 起了疑心 |'].join('\\n')
  await patchStored(`async (p) => {
    p.work.blueprints = p.work.blueprints.filter((b) => b.ep !== ${ep})
    p.work.blueprints.push({ ep: ${ep}, title: '', position: '发展', cast: '', goal: '', conflict: '', hook: '', guidance: '', points: '${points}' })
  }`, projectPath + '/stage/script/final/' + ep)
  if (!(await evaluate(`!!${panel}`))) await t(`document.querySelector('[aria-label=展开剧本状态库]').click()`)
  await waitFor(`document.querySelector('aside [role=tab]')`, '侧栏标签')
  const tabs = await evaluate(`[...document.querySelectorAll('aside[aria-label=剧本状态库] [role=tab]')].map((x) => x.firstChild.textContent).join(',')`)
  if (tabs !== '本集要点,状态库,标注') throw new Error('标签页应为 本集要点,状态库,标注，实际 ' + tabs)
  if (await evaluate(`[...document.querySelectorAll('main > div *')].some((el) => !el.closest('aside') && el.textContent === '伏笔推进候选')`)) throw new Error('正文页右栏应并入侧栏')
  await t(`__t.click('aside [role=tab]', '本集要点')`)
  await waitFor(`document.querySelector('[data-panel-tab=points]')`, '本集要点标签页')
  await waitFor(`document.querySelector('[data-panel-tab=points] [data-points]')`, '本集要点')
  const text = await evaluate(`document.querySelector('[data-panel-tab=points]').innerText`)
  for (const mark of ['##', '| ', '- [', '**']) if (text.includes(mark)) throw new Error('要点不应显示 Markdown 符号 ' + mark)
  for (const s of ['剧情节点', '触发', '真相揭晓', '角色动态', '埃琳娜', '起了疑心', '伏笔推进候选']) if (!text.includes(s)) throw new Error('本集要点页缺少 ' + s)
  // 人物状态与要点里的「角色动态」、状态库标签页重复，不再单列；标签名也不在页内再重复一遍
  if (text.includes('人物状态') || text.startsWith('本集要点')) throw new Error('本集要点页不应再重复人物状态 / 标题')
  await sleep(200)
  await shot('final-side-points')
  await t(`document.querySelector('textarea[aria-label="第 2 段"]').click()`)
  await t(`document.querySelector('main [data-open-notes]').click()`)
  await waitFor(`document.querySelector('[data-panel-tab=notes]')?.innerText.includes('标注第 2 行')`, '侧栏标注跟随选中段落')
  await t(`__t.type(document.querySelector('[data-panel-tab=notes] [aria-label=标注内容]'), '定稿后再核对')`)
  await t(`document.querySelector('[data-panel-tab=notes] [aria-label=标注内容] + button').click()`)
  await waitFor(`JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').work.scripts.find((x) => x.ep === ${ep}).notes?.length === 1`, '定稿标注写回')
  if (!(await evaluate(`document.querySelector('[data-editor]').innerText.includes('定稿后再核对')`))) throw new Error('标注应显示在段落下方')
})

await check('版本二：页面底部切换版本，默认版本一；改动说明列出方法与改动', async () => {
  await goto(projectPath)
  await waitFor(versionPressed('版本一'), '默认版本一')
  if (await t(`__t.has('环节完成')`)) throw new Error('版本一不应显示环节进度')
  await t(`__t.click('[aria-label=界面版本] button', '版本二')`)
  await waitFor(`JSON.parse(localStorage.getItem('${UI_KEY}')).state.version === 2`, '版本持久化')
  await until(`__t.has('环节完成')`, '版本二导航')
  await t(`__t.click('[aria-label=界面版本] button', '改动说明')`)
  await waitFor(dialog('版本二 · 交互优化说明'), '改动说明')
  for (const s of ['画出任务链', '走一遍，标断点', '对症用模式', '守住约束', '改动清单（12 项）', '带上下文的往返', '后续可评估']) {
    if (!(await evaluate(dialog(s)))) throw new Error('改动说明缺少 ' + s)
  }
  await sleep(200)
  await shot('v2-notes')
  await t(`__t.click('[role=dialog] button', '知道了')`)
  await waitFor(`!document.querySelector('[role=dialog]')`, '关闭说明')
})

await check('版本二：导航显示环节状态与进度；概览「继续工作」指到具体的集，「待处理」汇总且不重复，可标记已处理并恢复', async () => {
  // 第 7 集只留一份还没审过的草稿
  await patchStored(`async (p) => {
    const { writeEpisode } = await import('/src/services/mock/writer.ts')
    const d = writeEpisode(p, 7, 0)
    const at = new Date().toISOString()
    p.work.drafts = p.work.drafts.filter((x) => x.ep !== 7)
    p.work.drafts.push({ id: 'v2-draft-7', ep: 7, version: 1, title: d.title, lines: d.lines, status: 'draft', translated: false, states: d.states, reviews: [], notes: [], createdAt: at, updatedAt: at })
  }`, projectPath)
  const total = (await project()).spec.totalEpisodes
  const nav = `(document.querySelector('nav[aria-label=创作流程]')?.innerText ?? '')`
  await waitFor(`${nav}.includes('定稿 6/${total}') && ${nav}.includes('环节完成')`, '导航进度')
  if (!(await evaluate(`!!document.querySelector('nav[aria-label=创作流程] [aria-label=已完成]')`))) throw new Error('导航缺少已完成标记')
  // 白底面板，可收起成一列图标
  if (await evaluate(`getComputedStyle(document.querySelector('nav[aria-label=创作流程]')).backgroundColor !== 'rgb(255, 255, 255)'`)) throw new Error('流程导航应为白底')
  await t(`document.querySelector('nav[aria-label=创作流程] button[aria-label=收起创作流程]').click()`)
  await waitFor(`document.querySelector('nav[aria-label=创作流程][data-collapsed]') && document.querySelector('nav[aria-label=创作流程]').getBoundingClientRect().width < 80`, '流程导航收起')
  await sleep(200)
  await shot('v2-nav-collapsed')
  await t(`document.querySelector('nav[aria-label=创作流程] button[aria-label=展开创作流程]').click()`)
  await waitFor(`${nav}.includes('环节完成')`, '流程导航展开')
  const cont = `(document.querySelector('[data-v2=continue]')?.innerText ?? '')`
  await waitFor(`${cont}.includes('继续第 7 集（草稿_v1）：待审稿') && ${cont}.includes('AI 审稿')`, '继续工作')
  const todos = await evaluate(`document.querySelector('#todos')?.innerText ?? ''`)
  if (!todos.includes('正文在质检后有改动')) throw new Error('待处理缺少质检过期：' + todos)
  if (todos.includes('第 7 集 草稿_v1')) throw new Error('待处理不应重复「继续工作」那一条')
  if (!(await t(`__t.has('已自动保存')`))) throw new Error('页头缺少自动保存提示')
  await sleep(200)
  await shot('v2-overview')
  // 标记已处理：收起这条，「已处理」里能看到并恢复；不改项目数据
  const stale = `[...document.querySelectorAll('#todos li:not([data-todo-done])')].find((li) => li.innerText.includes('正文在质检后有改动'))`
  const before = JSON.stringify((await project()).work)
  await evaluate(`[...${stale}.querySelectorAll('button')].find((b) => b.textContent.includes('标记已处理')).click()`)
  await waitFor(`!${stale} && document.querySelector('#todos').innerText.includes('已处理 1 项')`, '标记后收起')
  if (JSON.stringify((await project()).work) !== before) throw new Error('标记已处理不应改项目数据')
  await t(`__t.click('#todos button', '已处理 1 项')`)
  await waitFor(`document.querySelector('#todos [data-todo-done]')?.innerText.includes('正文在质检后有改动')`, '已处理里能看到')
  await sleep(200)
  await shot('v2-todos-done')
  await t(`__t.click('#todos [data-todo-done] button', '恢复')`)
  await waitFor(`!!${stale}`, '恢复后重新出现')
  await t(`__t.click('[data-v2=continue] a', 'AI 审稿')`)
  await waitFor(`location.pathname === '${projectPath}/stage/script/draft/v2-draft-7'`, '直达草稿')
})

await check('版本二：草稿页按审稿状态推荐主操作——未审 → 审稿，审完 → 修稿或定稿', async () => {
  const advice = `(document.querySelector('[data-v2=advice]')?.innerText ?? '')`
  await waitFor(`${advice}.includes('建议下一步：AI 审稿')`, '建议审稿')
  if (!(await evaluate(`${btnClass('AI 审稿')}.includes('bg-brand-600')`))) throw new Error('AI 审稿应为主按钮')
  if (!(await evaluate(`${btnClass('AI 修稿')}.includes('bg-white')`))) throw new Error('AI 修稿应为次按钮')
  if (!(await evaluate(`${btnClass('定稿')}.includes('border-emerald-300')`))) throw new Error('定稿应降为描边按钮')
  if (!(await evaluate(`!!document.querySelector('ol[aria-label="第 7 集流程"] [aria-current=step]')`))) throw new Error('缺少单集流程步骤条')
  // 草稿还没审：停在「草稿」这一步，「审稿」不应亮起
  const cur = await evaluate(`document.querySelector('ol[aria-label="第 7 集流程"] [aria-current=step]').textContent`)
  if (!cur.includes('草稿') || cur.includes('审稿')) throw new Error('未审的草稿应停在草稿一步：' + cur)
  // 第 7 集没有蓝图：步骤条如实标「未做」，不冒充已完成
  if (!(await evaluate(`document.querySelector('ol[aria-label="第 7 集流程"]').textContent.includes('蓝图未做')`))) throw new Error('缺蓝图应标为未做')
  await sleep(200)
  await shot('v2-draft')
  await t(`__t.click('button', 'AI 审稿')`)
  await waitFor(`document.querySelector('[data-review-detail]')`, '审稿报告', 6000)
  const d = (await project()).work.drafts.find((x) => x.id === 'v2-draft-7')
  const now = await evaluate(`document.querySelector('ol[aria-label="第 7 集流程"] [aria-current=step]')?.textContent ?? ''`)
  if (!now.includes('定稿')) throw new Error('审完后应走到定稿一步：' + now)
  const block = d.reviews.at(-1).items.filter((i) => i.level === 'block').length
  await waitFor(`${advice}.includes('建议下一步：${block ? 'AI 修稿' : '定稿'}')`, '审完后的建议')
  if (block ? !(await evaluate(`${btnClass('AI 修稿')}.includes('bg-brand-600')`)) : !(await evaluate(`${btnClass('定稿')}.includes('bg-emerald-600')`))) throw new Error('主按钮没随建议切换')
})

await check('版本二：定稿后在正文页接力写下一集；写作前检查拦下时指向分集蓝图', async () => {
  await t(`__t.click('button', '定稿')`)
  await waitFor(`location.pathname === '${projectPath}/stage/script/final/7'`, '定稿后到正文', 6000)
  const relay = `(document.querySelector('[data-v2=relay]')?.innerText ?? '')`
  await waitFor(`${relay}.includes('接着写第 8 集') && ${relay}.includes('去分集蓝图处理')`, '没有蓝图时指向分集蓝图')
  await patchStored(`(p) => { const o = p.work.outline.find((x) => x.ep === 8); p.work.blueprints = p.work.blueprints.filter((b) => b.ep !== 8).concat({ ep: 8, title: o?.title ?? '', position: '', cast: '', goal: '', conflict: o?.event ?? '', hook: o?.hookLine ?? '', guidance: '', points: '' }) }`, projectPath + '/stage/script/final/7')
  await waitFor(`[...document.querySelectorAll('[data-v2=relay] button')].some((b) => b.textContent.includes('写第 8 集'))`, '可直接写下一集')
  await sleep(200)
  await shot('v2-relay')
  await t(`__t.click('[data-v2=relay] button', '写第 8 集')`)
  await waitFor(`location.pathname.startsWith('${projectPath}/stage/script/draft/')`, '写完进草稿', 8000)
  if (!(await project()).work.drafts.some((x) => x.ep === 8)) throw new Error('第 8 集草稿未生成')
})

await check('版本二：单集步骤条里做过的步骤可以点开；选中的一集可单独重新生成蓝图', async () => {
  const steps = `document.querySelector('ol[aria-label="第 8 集流程"]')`
  await waitFor(steps, '草稿页步骤条')
  if (await evaluate(`[...${steps}.querySelectorAll('a')].some((a) => a.textContent.includes('草稿'))`)) throw new Error('当前所在的草稿一步不应再是链接')
  await evaluate(`[...${steps}.querySelectorAll('a')].find((a) => a.textContent.includes('蓝图')).click()`)
  await waitFor(`location.pathname === '${projectPath}/stage/script' && location.search === '?ep=8' && [...document.querySelectorAll('h3')].some((h) => h.textContent.startsWith('第 8 集'))`, '点蓝图回到这一集蓝图')
  await waitFor(steps, '蓝图页步骤条')
  await evaluate(`[...${steps}.querySelectorAll('a')].find((a) => a.textContent.includes('草稿')).click()`)
  await waitFor(`location.pathname.startsWith('${projectPath}/stage/script/draft/') && document.querySelector('ol[aria-label="第 8 集流程"]')`, '点草稿打开最新草稿')
  await evaluate(`[...${steps}.querySelectorAll('a')].find((a) => a.textContent.includes('集纲')).click()`)
  await waitFor(`location.pathname === '${projectPath}/stage/outline' && document.querySelector('#outline-ep-8')`, '点集纲到情节大纲这一集')
  await goto(projectPath + '/stage/script?ep=8')
  await waitFor(`[...document.querySelectorAll('h3')].some((h) => h.textContent.startsWith('第 8 集'))`, '选中第 8 集')
  const before = (await project()).work.blueprints.find((b) => b.ep === 8)
  await t(`__t.click('main button', '重新生成本集蓝图')`)
  await waitFor(dialog('重新生成第 8 集蓝图？'), '蓝图确认')
  await t(`__t.click('[role=dialog] button', '重新生成')`)
  await waitFor(`JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').work.blueprints.find((b) => b.ep === 8).position !== ''`, '第 8 集蓝图已重新生成', 5000)
  const after = (await project()).work.blueprints
  if (after.find((b) => b.ep === 8).guidance !== before.guidance) throw new Error('作者微操指导应保留')
  await sleep(200)
  await shot('v2-steps-links')
})

await check('分集蓝图：本集卡片头有「查看本集」与「写作第 N 集」；批量写作可选集数范围；承接可接住前几集的伏笔', async () => {
  await waitFor(`[...document.querySelectorAll('h3')].some((h) => h.textContent.startsWith('第 8 集'))`, '选中第 8 集')
  const head = `document.querySelector('[data-ep-head]')`
  const headText = await evaluate(`${head}.innerText`)
  if (!headText.includes('查看本集') || !headText.includes('写作第 8 集')) throw new Error('本集卡片头缺按钮：' + headText)
  if (await t(`[...document.querySelectorAll('main button')].filter((b) => b.textContent.includes('写作第')).length !== 1`)) throw new Error('写作按钮应只在本集卡片头')
  if (await t(`__t.has('批量创作')`)) throw new Error('批量创作应改名为批量写作')
  // 起止集是输入框：输入后回车生效，超出范围的数收回到边界
  const from = `document.querySelector('input[aria-label=批量写作起始集]')`
  const to = `document.querySelector('input[aria-label=批量写作结束集]')`
  const typeEnter = async (el, v) => {
    await t(`__t.type(${el}, '${v}')`)
    await t(`__t.enter(${el})`)
  }
  if (await t(`!!document.querySelector('select[aria-label=批量写作起始集], select[aria-label=批量写作结束集]')`)) throw new Error('批量写作起止集应是输入框')
  const total = (await project()).spec.totalEpisodes
  const next = Number(await evaluate(`${from}.value`))
  // 起始集不能越过没写的集
  await typeEnter(from, total)
  await waitFor(`${from}.value === '${next}'`, '起始集收回到第一个没写的集')
  // 结束集可以写到最后一集，超出时收回到最后一集
  await typeEnter(to, total + 5)
  await waitFor(`${to}.value === '${total}'`, '结束集可到最后一集')
  // 起始集改成 1：结束集跟着变成 1 + 上限 - 1
  await typeEnter(from, 1)
  await waitFor(`${to}.value === '5'`, '结束集跟随起始集')
  await t(`__t.click('main button', '批量写作')`)
  await waitFor(dialog('批量写作第 1–5 集？'), '范围里有写过的集先确认')
  await t(`__t.click('[role=dialog] button', '取消')`)
  await until(`!document.querySelector('[role=dialog]')`, '关闭确认')
  // 承接：前几集埋下、本集之后才收的伏笔可一键接住
  const w = (await project()).work
  const due = w.foreshadows.filter((f) => f.plantEp < 8 && f.payoffEp >= 8)
  if (due.length) {
    await waitFor(`document.querySelector('[data-carry-foreshadows] button:not(:disabled)')`, '承接里的伏笔')
    await evaluate(`document.querySelector('[data-carry-foreshadows] button:not(:disabled)').click()`)
    await waitFor(`JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').work.blueprints.find((b) => b.ep === 8).carry.includes('在本集响起')`, '伏笔写进承接')
  }
  // 写作按钮带 ▾ 换模型，本集卡片头的按钮仍排在一行
  const tops = await evaluate(`[...document.querySelectorAll('[data-ep-head] > div:last-child button')].map((b) => Math.round(b.getBoundingClientRect().top))`)
  if (new Set(tops).size !== 1) throw new Error('本集卡片头按钮折行了：' + tops)
  if (!(await evaluate(`!!document.querySelector('[data-ep-head] button[aria-label=换个模型写作]')`))) throw new Error('写作按钮旁缺少换模型的 ▾')
  await sleep(200)
  await shot('script-stage-head')
  await t(`__t.click('main button', '查看本集')`)
  await waitFor(`['/stage/script/draft/', '/stage/script/final/'].some((k) => location.pathname.includes(k))`, '查看本集打开草稿或正文')
  await goto(projectPath + '/stage/script?ep=8')
  await waitFor(`document.querySelector('textarea[aria-label=承接]')`, '回到第 8 集蓝图')
})

await check('分集蓝图：写作前检查在状态库的「检查」标签页；全部集都有蓝图时「+」确认后加一集', async () => {
  await goto(projectPath + '/stage/script?ep=8')
  await waitFor(`document.querySelector('[data-ep-head] [data-open-checks]')`, '本集卡片头的检查入口')
  const wasOpen = await evaluate(`!!document.querySelector('aside[aria-label=剧本状态库]')`)
  if (await evaluate(`[...document.querySelectorAll('main *')].some((e) => !e.closest('aside') && e.textContent.trim().startsWith('写作前检查 · '))`)) throw new Error('页面里不应再有写作前检查卡片')
  await evaluate(`document.querySelector('[data-ep-head] [data-open-checks]').click()`)
  await waitFor(`document.querySelector('[data-panel-tab=checks]')?.innerText.includes('写作前检查 · 第 8 集')`, '侧栏「检查」里的写作前检查')
  await sleep(200)
  await shot('script-checks-tab')
  await t(`__t.click('aside [role=tab]', '状态库')`)
  if (!wasOpen) await evaluate(`document.querySelector('[aria-label=收起剧本状态库]').click()`)
  // 全部集都有蓝图：「+」不再置灰，确认后总集数加一并新建最后一集的空蓝图
  const before = await project()
  const total = before.spec.totalEpisodes
  await patchStored(`(p) => { const has = new Set(p.work.blueprints.map((b) => b.ep)); for (let ep = 1; ep <= p.spec.totalEpisodes; ep++) if (!has.has(ep)) p.work.blueprints.push({ ep, title: '', position: '', cast: '', goal: '', conflict: '', hook: '', guidance: '', points: '' }) }`, projectPath + '/stage/script?ep=8')
  const plus = `document.querySelector('button[aria-label=新增一集蓝图]')`
  await waitFor(`${plus} && !${plus}.disabled && ${plus}.title.includes('加第 ${total + 1} 集')`, '「+」说明会加第 N+1 集')
  await evaluate(`${plus}.click()`)
  await waitFor(dialog(`加第 ${total + 1} 集？`), '加集先确认')
  await t(`__t.click('[role=dialog] button', '加到 ${total + 1} 集')`)
  await waitFor(`(() => { const p = JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}'); return p.spec.totalEpisodes === ${total + 1} && p.work.blueprints.some((b) => b.ep === ${total + 1}) })()`, '总集数加一并有新蓝图')
  await waitFor(`[...document.querySelectorAll('h3')].some((h) => h.textContent.startsWith('第 ${total + 1} 集'))`, '选中新加的一集')
  await patchStored(`(p) => { p.spec = ${JSON.stringify(before.spec)}; p.rhythm = ${JSON.stringify(before.rhythm)}; p.work.blueprints = ${JSON.stringify(before.work.blueprints)} }`, projectPath + '/stage/script?ep=8')
  await waitFor(`[...document.querySelectorAll('h3')].some((h) => h.textContent.startsWith('第 8 集'))`, '恢复')
})

await check('分集蓝图：一键定稿——列出每集最新的草稿，审过且没问题的默认勾上，有严重问题的不能选；确认后按集号定稿', async () => {
  const before = await project()
  const keep = { drafts: before.work.drafts, scripts: before.work.scripts, blueprints: before.work.blueprints }
  const [a, b] = [before.spec.totalEpisodes - 1, before.spec.totalEpisodes]
  await patchStored(`async (p) => {
    const { writeEpisode } = await import('/src/services/mock/writer.ts')
    const { linesSig } = await import('/src/pages/workspace/script/ops.ts')
    const at = new Date().toISOString()
    for (const ep of [${a}, ${b}]) {
      const d = writeEpisode(p, ep, 0)
      const draft = { id: 'e2e-fa-' + ep, ep, version: 1, title: d.title, lines: d.lines, status: 'draft', translated: false, states: d.states, notes: [], createdAt: at, updatedAt: at }
      const items = ep === ${b} ? [{ level: 'block', text: '缺少末尾钩子', key: 'e2e-hook' }] : [{ level: 'ok', text: '没有发现问题' }]
      draft.reviews = [{ id: 'e2e-fa-r' + ep, at, score: 80, items, sig: linesSig(draft) }]
      p.work.drafts.push(draft)
    }
  }`, projectPath + '/stage/script?ep=8')
  await until(`__t.find('main button', '一键定稿') && !__t.find('main button', '一键定稿').disabled`, '一键定稿按钮')
  await t(`__t.click('main button', '一键定稿')`)
  await waitFor(dialog('一键定稿'), '一键定稿弹窗')
  const box = (ep) => `document.querySelector('[data-finalize-all] input[aria-label="定稿第 ${ep} 集"]')`
  await waitFor(`${box(a)} && ${box(b)}`, '列出两集')
  if (!(await evaluate(`${box(a)}.checked && !${box(a)}.disabled`))) throw new Error('审过且没问题的应默认勾上')
  if (!(await evaluate(`${box(b)}.disabled && !${box(b)}.checked`))) throw new Error('有严重问题的不能选')
  if (!(await evaluate(`${box(b)}.closest('li').innerText.includes('1 条严重问题') && ${box(b)}.closest('li').innerText.includes('去处理')`))) throw new Error('严重问题应写明条数并可去处理')
  await sleep(200)
  await shot('finalize-all')
  // 只定稿第 a 集：先清空，再勾上
  await t(`__t.click('[role=dialog] button', '清空')`)
  await waitFor(`!${box(a)}.checked`, '清空勾选')
  await evaluate(`${box(a)}.click()`)
  await until(`__t.find('[role=dialog] button', '定稿 1 集') && !__t.find('[role=dialog] button', '定稿 1 集').disabled`, '定稿 1 集')
  await t(`__t.click('[role=dialog] button', '定稿 1 集')`)
  await waitFor(`(() => { const w = JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').work; return w.scripts.some((s) => s.ep === ${a} && s.draftId === 'e2e-fa-${a}') })()`, '第 a 集已定稿')
  const w = (await project()).work
  if (w.drafts.find((d) => d.id === 'e2e-fa-' + b).status !== 'draft' || w.scripts.some((s) => s.ep === b)) throw new Error('有严重问题的一集不应定稿')
  if (w.scripts.length !== keep.scripts.length + 1) throw new Error('只应定稿勾选的一集')
  await patchStored(`(p) => { p.work.drafts = ${JSON.stringify(keep.drafts)}; p.work.scripts = ${JSON.stringify(keep.scripts)}; p.work.blueprints = ${JSON.stringify(keep.blueprints)} }`, projectPath + '/stage/script?ep=8')
  await waitFor(`[...document.querySelectorAll('h3')].some((h) => h.textContent.startsWith('第 8 集'))`, '恢复')
})

await check('分集蓝图：末尾钩子前有「承接」，AI 生成时接上集结尾；草稿页侧栏「本集蓝图」按顺序显示', async () => {
  const w = (await project()).work
  const carry = w.blueprints.find((b) => b.ep === 8).carry
  if (!carry?.trim()) throw new Error('AI 生成的蓝图应写好承接')
  const before = await evaluate(`!!(document.querySelector('textarea[aria-label=承接]').compareDocumentPosition(document.querySelector('textarea[placeholder^="最后 10 秒"]')) & Node.DOCUMENT_POSITION_FOLLOWING)`)
  if (!before) throw new Error('承接应在末尾悬念钩子之前')
  const draft = w.drafts.filter((d) => d.ep === 8).sort((a, b) => b.version - a.version)[0]
  await goto(projectPath + '/stage/script/draft/' + draft.id)
  await waitFor(`document.querySelector('[aria-label=展开剧本状态库]') || ${panel}`, '状态库入口')
  await evaluate(`document.querySelector('[aria-label=展开剧本状态库]')?.click()`)
  await waitFor(`document.querySelector('aside [role=tab]')`, '侧栏标签')
  await t(`__t.click('aside [role=tab]', '本集蓝图')`)
  await waitFor(`document.querySelector('[data-panel-tab=blueprint]')?.innerText.includes('承接')`, '本集蓝图里的承接')
  const text = await evaluate(`document.querySelector('[data-panel-tab=blueprint]').innerText`)
  const at = ['冲突与转折', '承接', '末尾钩子'].map((k) => text.indexOf(k))
  if (!(at[0] < at[1] && at[1] < at[2])) throw new Error('承接应在冲突与转折之后、末尾钩子之前：' + at)
  if (!text.includes(carry.replace(/\*/g, '').slice(0, 8))) throw new Error('承接内容不对')
  await sleep(200)
  await shot('draft-side-blueprint')
})

await check('版本二：质检「去改正文」带着问题过去，问题行高亮；标记已处理后回到原来那一集', async () => {
  await goto(projectPath + '/stage/qa')
  await t(`__t.click('button', '重新质检')`)
  await until(`!__t.has('正文在质检后有改动')`, '重新质检', 8000)
  const qa = (await project()).work.qa
  const issue = qa.issues.find((i) => i.ep !== null && i.lineId && i.check !== 'paywall' && !qa.resolved.includes(i.id))
  if (!issue) throw new Error('没有可定位到行的问题')
  // 返回路径本身：?issue= 恢复选中的集与问题
  await goto(`${projectPath}/stage/qa?issue=${issue.id}`)
  await waitFor(`document.querySelector('#qa-issue-${issue.id}')?.className.includes('border-brand-300')`, '恢复选中问题')
  const href = await evaluate(`[...document.querySelectorAll('#qa-issue-${issue.id} a')].find((a) => a.textContent.includes('去改正文'))?.getAttribute('href')`)
  if (!href?.includes(`from=qa&issue=${issue.id}`)) throw new Error('去改正文没带上问题：' + href)
  await evaluate(`[...document.querySelectorAll('#qa-issue-${issue.id} a')].find((a) => a.textContent.includes('去改正文')).click()`)
  await waitFor(`location.pathname === '${projectPath}/stage/script/final/${issue.ep}' && document.querySelector('[data-v2=qa-return]')`, '正文页带问题')
  if (!(await evaluate(`document.querySelector('[data-v2=qa-return]').innerText.includes(${JSON.stringify(issue.title)})`))) throw new Error('缺少问题标题')
  await waitFor(`document.querySelector('[data-line-id="${issue.lineId}"]')?.className.includes('ring-amber-400')`, '问题行高亮')
  if (await evaluate(`!!document.querySelector('[data-v2=relay]')`)) throw new Error('从质检过来时不应显示接力条')
  // 来自质检的卡片上也能 AI 修稿：先预览，取消则不改
  const lines = JSON.stringify((await project()).work.scripts.find((s) => s.ep === issue.ep).lines)
  await evaluate(`document.querySelector('[data-v2=qa-return] [data-qa-fix]').click()`)
  await waitFor(`document.querySelector('[data-qa-fix-dialog]')?.innerText.includes('已对照原有设定')`, '正文页 AI 修稿预览', 5000)
  await sleep(300)
  await shot('v2-qa-return-fix')
  await t(`__t.click('[role=dialog] button', document.querySelector('[data-fix-diff]') ? '取消' : '知道了')`)
  await waitFor(`!document.querySelector('[data-qa-fix-dialog]')`, '关闭预览')
  if (JSON.stringify((await project()).work.scripts.find((s) => s.ep === issue.ep).lines) !== lines) throw new Error('取消后不应改定稿')
  await sleep(400)
  await shot('v2-qa-return')
  await t(`__t.click('[data-v2=qa-return] button', '标记已处理并返回质检')`)
  await waitFor(`location.pathname === '${projectPath}/stage/qa'`, '回到质检')
  if (!(await project()).work.qa.resolved.includes(issue.id)) throw new Error('问题未标记已处理')
  await waitFor(`[...document.querySelectorAll('h3')].some((h) => h.textContent.includes('第 ${issue.ep} 集 ·'))`, '回到原来那一集')
})

await check('版本二：环节说明默认折叠；环节完成后页头出现「下一步」', async () => {
  await goto(projectPath + '/stage/characters')
  await waitFor(`document.querySelector('[data-v2=next-stage]')?.innerText.includes('下一步：情节大纲')`, '下一步条')
  const summary = '缺陷与弧光，以及人物关系'
  if (await t(`__t.has('${summary}')`)) throw new Error('环节说明应默认折叠')
  await t(`__t.click('button', '环节说明')`)
  await until(`__t.has('${summary}')`, '展开环节说明')
  await t(`__t.click('[data-v2=next-stage] a', '去情节大纲')`)
  await waitFor(`location.pathname === '${projectPath}/stage/outline'`, '去下一环节')
})

await check('版本二：故事架构确认前实时列出还差什么', async () => {
  await goto(projectPath + '/stage/architecture')
  await t(`__t.click('button', '取消确认')`)
  await until(`__t.has('核心大纲已填完，可以确认')`, '已填完提示')
  const saved = (await project()).work.architecture.mainLine[0].content
  await patchStored(`(p) => { p.work.architecture.mainLine[0].content = '' }`, projectPath + '/stage/architecture')
  await until(`__t.has('确认前还差 1 项：冲突主线缺少')`, '实时缺项')
  if (!(await evaluate(`[...document.querySelectorAll('div')].some((d) => d.className.includes('sticky') && d.innerText.includes('确认前还差'))`))) throw new Error('状态卡应吸顶')
  await sleep(200)
  await shot('v2-architecture')
  await patchStored(`(p) => { p.work.architecture.mainLine[0].content = ${JSON.stringify(saved)} }`, projectPath + '/stage/architecture')
  await t(`__t.click('button', '确认故事架构')`)
  await waitFor(`JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').work.architecture.status === 'approved'`, '重新确认')
})

await check('版本二：对标剧拆解审核条吸顶，确认一个板块后自动滚到下一个', async () => {
  await goto('/projects/demo-alpha/stage/breakdown')
  await t(`__t.click('button', '载入示例剧本')`)
  await t(`__t.click('button', '导入并切分')`)
  await until(`!!__t.find('button', '开始拆解')`, '导入')
  await t(`__t.click('button', '开始拆解')`)
  await until(`__t.has('审核进度')`, '拆解完成', 12000)
  if (!(await evaluate(`[...document.querySelectorAll('div')].some((d) => d.className.includes('sticky') && d.innerText.startsWith('审核进度'))`))) throw new Error('审核条应吸顶')
  await evaluate(`[...document.querySelectorAll('#bd-block-synopsis button')].find((b) => b.textContent.includes('确认无误')).click()`)
  await waitFor(nearTop('#bd-block-characters'), '滚到下一个板块', 3000)
  await t(`__t.click('button', '粗纲 · 分集提纲')`)
  await waitFor(nearTop('#bd-block-episodes'), '点进度跳到板块', 3000)
  await sleep(200)
  await shot('v2-breakdown')
})

await check('版本二：项目卡片显示进度，「继续」直达下一步', async () => {
  await goto('/projects')
  const card = `[...document.querySelectorAll('a[href="${projectPath}"]')].find((a) => a.innerText.includes('定稿'))`
  await waitFor(`${card}?.innerText.includes('环节 · 定稿 7/')`, '卡片进度')
  await sleep(200)
  await shot('v2-projects')
  await evaluate(`[...${card}.querySelectorAll('button')].find((b) => b.textContent.startsWith('下一步 ·')).click()`)
  await waitFor(`location.pathname.startsWith('${projectPath}/stage/script/draft/')`, '继续直达草稿')
  // 回到版本一，后面的检查按版本一跑
  await evaluate(`localStorage.setItem('${UI_KEY}', JSON.stringify({ state: { version: 1 }, version: 0 }))`)
})

/* ---------------------------------- 设置 ---------------------------------- */

await check('工作台：点击封面更换配色，设置页不误报未保存', async () => {
  await goto(projectPath)
  const before = (await project()).palette
  const target = (before + 1) % 6
  await t(`__t.click('a', '项目设置')`)
  await waitFor(`location.pathname.endsWith('/settings')`, '设置页')
  await t(`document.querySelector('[aria-label=更换封面配色]').click()`)
  await waitFor(`document.body.innerText.includes('封面配色')`, '配色弹层')
  await t(`document.querySelector('[aria-label="封面配色 ${target + 1}"]').click()`)
  await waitFor(`JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').palette === ${target}`, '配色已保存')
  await sleep(200)
  if (await t(`__t.has('有未保存的修改')`)) throw new Error('改配色后设置页误报未保存')
})
await check('设置：返回回到来源页；项目状态不在设置页', async () => {
  if (await t(`__t.has('项目状态')`)) throw new Error('设置页仍有项目状态')
  await t(`__t.click('[data-settings] button', '返回')`)
  await waitFor(`location.pathname === '${projectPath}' && document.querySelector('[data-status-card]')`, '回到概览')
  await goto(projectPath + '/stage/characters')
  await waitFor(`location.pathname.endsWith('/stage/characters') && [...document.querySelectorAll('a')].some((a) => a.textContent.includes('项目设置'))`, '人物设定')
  await t(`__t.click('a', '项目设置')`)
  await waitFor(`document.querySelector('[data-settings]')`, '设置页')
  await t(`__t.click('[data-settings] button', '返回')`)
  await waitFor(`location.pathname === '${projectPath}/stage/characters'`, '回到人物设定')
  await goto(projectPath + '/settings')
  await waitFor(`document.querySelector('[data-settings]')`, '设置页')
  await t(`__t.click('[data-settings] button', '返回')`)
  await waitFor(`location.pathname === '${projectPath}'`, '直接打开时回概览')
})
await check('概览：项目状态点选即保存', async () => {
  const LABEL = { draft: '立项中', writing: '创作中', reviewing: '质检中', delivered: '已交付' }
  await waitFor(`document.querySelector('[data-status-card]')`, '概览状态卡')
  const before = (await project()).status
  const target = before === 'writing' ? 'reviewing' : 'writing'
  await t(`__t.click('[data-status-card] button', '${LABEL[target]}')`)
  await waitFor(`document.body.innerText.includes('项目状态已改为「${LABEL[target]}」')`, '提示')
  const after = await project()
  if (after.status !== target) throw new Error('状态未保存：' + after.status)
  if (!after.activity.at(-1).text.includes(`项目状态改为「${LABEL[target]}」`)) throw new Error('动态未记录')
  await shot('overview-status')
  await t(`__t.click('[data-status-card] button', '${LABEL[before]}')`)
  await waitFor(`JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').status === '${before}'`, '改回原状态')
})
await check('工作台：不属于原创流程的环节回到概览', async () => {
  await goto(projectPath + '/stage/breakdown')
  await waitFor(`location.pathname === '${projectPath}'`, '重定向')
})
await check('设置：修改后出现保存条，离开时拦截', async () => {
  await t(`__t.click('a', '项目设置')`)
  await waitFor(`location.pathname.endsWith('/settings') && document.querySelector('input[maxlength="30"]')`, '设置页')
  await t(`__t.type(document.querySelector('input[maxlength="30"]'), '端到端测试剧·改')`)
  await waitFor(`document.body.innerText.includes('有未保存的修改')`, '保存条')
  await t(`document.querySelector('header a[aria-label=我的剧本]').click()`)
  await waitFor(`document.body.innerText.includes('离开此页？')`, '拦截弹窗')
  await shot('settings-blocked')
  await t(`__t.click('button', '继续编辑')`)
  await waitFor(`!document.body.innerText.includes('离开此页？') && location.pathname.endsWith('/settings')`, '留在设置页')
})
await check('设置：清空剧名保存会报错', async () => {
  await t(`__t.type(document.querySelector('input[maxlength="30"]'), '')`)
  await t(`__t.click('button', '保存')`)
  await waitFor(`document.body.innerText.includes('还有未通过校验的字段') && document.body.innerText.includes('请填写剧本名称')`, '校验报错')
})
await check('设置：保存成功后标题更新且不再拦截', async () => {
  await t(`__t.type(document.querySelector('input[maxlength="30"]'), '  端到端测试剧·改  ')`)
  await t(`__t.click('button', '保存')`)
  await waitFor(`document.body.innerText.includes('设置已保存') && !document.body.innerText.includes('有未保存的修改')`, '保存')
  await waitFor(`document.querySelector('h1')?.textContent === '端到端测试剧·改'`, '标题更新（已去空格）')
  await t(`document.querySelector('header a[aria-label=我的剧本]').click()`)
  await waitFor(`location.pathname === '/projects'`, '直接离开')
})
await check('设置：不含节奏框架；改总集数后按主线生成过的节奏只收回越界节点', async () => {
  await goto(projectPath + '/settings')
  await waitFor(`document.querySelector('input[aria-label=总集数]')`, '设置页')
  if (await t(`__t.has('结局高潮起始集')`)) throw new Error('设置页仍有节奏框架')
  const before = (await project()).rhythm
  await t(`__t.type(document.querySelector('input[aria-label=总集数]'), '40')`)
  await t(`__t.click('button', '保存')`)
  await waitFor(`document.body.innerText.includes('设置已保存')`, '保存')
  const r = (await project()).rhythm
  if (r.paywalls.join() !== before.paywalls.filter((e) => e <= 40).join() || r.climaxFrom !== Math.min(before.climaxFrom, 40)) throw new Error('应只收回越界节点：' + JSON.stringify({ before, r }))
})
await check('设置：未调过的节奏框架随总集数重新推荐', async () => {
  await goto('/projects/demo-alpha/settings')
  await waitFor(`document.querySelector('input[aria-label=总集数]')`, '设置页')
  await t(`__t.type(document.querySelector('input[aria-label=总集数]'), '8')`)
  await t(`__t.type(document.querySelector('input[aria-label=总集数]'), '80')`)
  await t(`__t.click('button', '保存')`)
  await waitFor(`document.body.innerText.includes('设置已保存')`, '保存')
  const r = (await projects()).find((p) => p.id === 'demo-alpha').rhythm
  if (r.paywalls.join() !== '11,29,46,63') throw new Error('应按 80 集重新推荐：' + r.paywalls)
  await goto(projectPath + '/settings')
})
await check('设置：有改动时删除项目不被拦截', async () => {
  await t(`__t.type(document.querySelector('input[maxlength="30"]'), '临时改动')`)
  await t(`__t.click('button', '删除项目')`)
  await waitFor(`document.body.innerText.includes('删除项目？')`, '删除确认')
  await t(`__t.click('[role=dialog] button', '删除')`)
  await waitFor(`location.pathname === '/projects' && !document.body.innerText.includes('离开此页？')`, '删除后跳转')
  const left = (await projects()).map((p) => p.title)
  if (left.some((x) => x.includes('端到端'))) throw new Error('项目仍在：' + left)
})

/* ---------------------------------- 其他 ---------------------------------- */

await check('仿写模式：必须登记对标剧剧名', async () => {
  await goto('/projects/new?mode=adaptation')
  await t(`__t.type(document.querySelector('input[maxlength="30"]'), '仿写测试')`)
  await pick(0, '狼人')
  await t(`__t.click('button', '创建剧本')`)
  await waitFor(`document.body.innerText.includes('请填写对标剧剧名')`, '对标剧报错')
})
await check('存储迁移：去掉每集字数，人物关系按备注补上类型', async () => {
  await evaluate(`(() => { const raw = JSON.parse(localStorage.getItem('${KEY}')); raw.version = 4; raw.state.projects.forEach((p) => { p.spec.episodeWords = 1000; delete p.work.qa }); raw.state.projects.find((p) => p.id === 'demo-rebirth').work.relations = [{ a: '甲', b: '乙', label: '宿敌，处处陷害' }]; localStorage.setItem('${KEY}', JSON.stringify(raw)) })()`)
  await goto('/projects/demo-rebirth')
  await waitFor(`document.body.innerText.includes('90 秒 · 约')`, '概览显示单集时长')
  const saved = await evaluate(`JSON.parse(localStorage.getItem('${KEY}'))`)
  const demo = saved.state.projects.find((p) => p.id === 'demo-rebirth')
  if (saved.version !== 6 || saved.state.projects.some((p) => 'episodeWords' in p.spec || p.work.qa !== null)) throw new Error('迁移结果不对：' + JSON.stringify(saved.state.projects.map((p) => p.spec)))
  if (demo.work.relations[0].kind !== '宿敌') throw new Error('关系类型未推断：' + JSON.stringify(demo.work.relations))
})
await check('全局：侧边栏隐藏，首页直接是我的剧本', async () => {
  await goto('/')
  await waitFor(`location.pathname === '/projects'`, '首页重定向到我的剧本')
  if (await evaluate(`[...document.querySelectorAll('aside a')].some((a) => a.textContent.includes('工作台'))`)) throw new Error('侧边栏仍显示')
  if (!(await evaluate(`!!document.querySelector('header a[aria-label=我的剧本]')`))) throw new Error('顶栏缺少回到我的剧本的入口')
})
await check('模块页与 404', async () => {
  await goto('/modules/video')
  await waitFor(`document.body.innerText.includes('逐集转写')`, '视频模块')
  await goto('/modules/qa')
  await waitFor(`document.body.innerText.includes('已上线') && document.body.innerText.includes('各项目的质检') && document.body.innerText.includes('还没有定稿，暂不能质检')`, '质检模块')
  await goto('/modules/unknown')
  await waitFor(`document.body.innerText.includes('页面不存在')`, '未知模块')
  await goto('/projects/not-exist')
  await waitFor(`document.body.innerText.includes('项目不存在')`, '未知项目')
})

for (const r of results) console.log(r.join('  '))
console.log(problems.length ? '浏览器报错：\n' + [...new Set(problems)].join('\n') : '浏览器控制台：无错误 / 警告')
ws.close(); chrome.kill()
process.exit(results.some((r) => r[0] === 'FAIL') ? 1 : 0)
