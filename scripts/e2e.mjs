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
await check('情节大纲：AI 一键生成全部（总览 + 粗纲 + 集纲）', async () => {
  await goto(projectPath + '/stage/outline')
  if (await evaluate(`document.body.innerText.includes('本次生成范围')`)) throw new Error('生成范围一行应已删除')
  await t(`__t.click('button', 'AI 一键生成全部')`)
  await waitFor(`(() => { const p = JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}'); return p.work.plot?.overview && p.work.outline.length >= p.spec.totalEpisodes })()`, '全部集纲', 20000)
  await waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.includes('已全部生成'))`, '按钮变为已全部生成')
  if (!(await t(`!!__t.find('main button', '重新生成集纲')`))) throw new Error('阶段卡片上应有「重新生成集纲」')
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
await check('质检交付：左侧总结与目录、中间标色定稿、右侧问题详情', async () => {
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
  for (const s of ['/ 100', '一致性终检', '角色一致性', '故事流程', '节奏曲线对比', '付费点专项', '创新点落地', '格式合规', '章节目录', '全剧', '第 6 集', '问题详情']) {
    if (!(await t(`__t.has(${JSON.stringify(s)})`))) throw new Error('缺少「' + s + '」')
  }
  const cols = await evaluate(`(() => { const g = [...document.querySelectorAll('div')].find((d) => d.className.includes('xl:grid-cols-[220px')); return [...g.children].map((c) => { const r = c.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), Math.round(r.top)] }) })()`)
  if (cols.length !== 3 || !(cols[0][1] <= cols[1][0] && cols[1][1] <= cols[2][0]) || new Set(cols.map((c) => c[2])).size !== 1) throw new Error('应为左中右三栏：' + JSON.stringify(cols))
  const report = (await project()).work.qa
  if (!report || report.issues.length === 0) throw new Error('没有问题')
  const want = Math.round(report.checks.reduce((s, c, i) => s + c.score * [0.15, 0.15, 0.15, 0.15, 0.15, 0.1, 0.15][i], 0))
  if (report.score !== want) throw new Error(`总分应为分项加权：${report.score} vs ${want}`)
  await t(`__t.click('button', '第 2 集')`)
  await waitFor(`[...document.querySelectorAll('mark')].some((m) => m.textContent === '王总') && [...document.querySelectorAll('mark')].some((m) => m.textContent === '不禁')`, '问题字段标色')
  await shot('qa-overview')
})
await check('质检交付：点分项只看该项问题，点问题定位到行', async () => {
  await t(`__t.click('button[aria-pressed]', '格式合规')`)
  await waitFor(`[...document.querySelectorAll('li[id^=qa-issue-]')].length > 0 && [...document.querySelectorAll('li[id^=qa-issue-]')].every((li) => li.innerText.includes('格式合规'))`, '按分项筛选')
  await t(`__t.click('button[aria-pressed]', '格式合规')`)
  const issue = (await project()).work.qa.issues.find((i) => i.ep === 2 && i.lineId && i.quote === '王总')
  await evaluate(`document.querySelector('#qa-issue-${issue.id} button').click()`)
  await waitFor(`document.querySelector('#qa-issue-${issue.id}').className.includes('border-brand-300') && document.querySelector('#qa-line-${issue.lineId}')`, '问题高亮并定位')
})
await check('质检交付：有严重问题不能交付，逐条标记已处理后可交付与撤回', async () => {
  if (!(await t(`__t.find('button', '确认交付').disabled`))) throw new Error('有严重问题时「确认交付」应禁用')
  await evaluate(`(() => { const head = [...document.querySelectorAll('h3')].find((h) => h.textContent === '问题详情'); [...head.parentElement.querySelectorAll('button')].find((b) => b.textContent === '全部').click() })()`)
  // 级别筛选按钮以级别名开头；分项行的摘要里也有「严重」字样，不能按包含匹配
  await evaluate(`[...document.querySelectorAll('button[aria-pressed]')].find((b) => b.textContent.startsWith('严重')).click()`)
  for (let i = 0; i < 40; i++) {
    const left = await evaluate(`(() => { const b = [...document.querySelectorAll('li[id^=qa-issue-] button')].find((e) => e.textContent.includes('标记已处理')); b?.click(); return !!b })()`)
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
})
await check('状态库：伏笔环节看写作进度上的当前集；可收起、可打开完整视图', async () => {
  await goto(projectPath + '/stage/foreshadow')
  await waitFor(`${panel}?.innerText.includes('第 7 集')`, '伏笔环节当前集')
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

await check('状态库：草稿页按这份草稿显示本集，注明不计入全剧，并附写作前检查', async () => {
  await patchStored(`async (p) => {
    const { writeEpisode } = await import('/src/services/mock/writer.ts')
    const d = writeEpisode(p, 7, 0)
    const at = new Date().toISOString()
    p.work.drafts.push({ id: 'e2e-draft-7', ep: 7, version: 1, title: d.title, lines: d.lines, status: 'draft', translated: false, states: d.states, reviews: [], notes: [], createdAt: at, updatedAt: at })
  }`, projectPath + '/stage/script/draft/e2e-draft-7')
  await waitFor(`${panel}?.innerText.includes('草稿_v1 · 未定稿，不计入全剧状态')`, '草稿依据')
  if (!(await panelText()).includes('写作前检查')) throw new Error('未定稿的集应附写作前检查')
  await sleep(300)
  await shot('state-panel-draft')
  await panelTab('全剧')
  await waitFor(`${panel}.innerText.includes('已定稿至第 6 集') && ${panel}.innerText.includes('1 集草稿未定稿')`, '全剧不计草稿')
})

await check('正文编辑：稿纸排版，点选段落在上方浮出工具条，可标注与添加到助手', async () => {
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
  await t(`document.querySelector('textarea[aria-label="第 3 段"]').click()`)
  await waitFor(`document.querySelector('[role=toolbar][aria-label=段落工具]')`, '浮动工具条')
  const bar = await evaluate(`(() => { const b = document.querySelector('[role=toolbar]').getBoundingClientRect(); const p = document.querySelector('textarea[aria-label="第 3 段"]').getBoundingClientRect(); return { above: b.bottom <= p.top + 2, text: document.querySelector('[role=toolbar]').innerText } })()`)
  if (!bar.above) throw new Error('工具条应在选中段落上方')
  for (const label of ['标注', '添加到助手', 'AI', '润色', '扩写', '续写', '对话']) if (!bar.text.includes(label)) throw new Error('工具条缺少 ' + label)
  await t(`__t.type(document.querySelector('[aria-label=标注内容]'), '这里节奏太慢')`)
  await t(`__t.click('[role=toolbar] button', '标注')`)
  await t(`__t.click('[role=toolbar] button', '添加到助手')`)
  await waitFor(`JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').work.drafts.find((d) => d.id === 'e2e-draft-7').notes.length === 2`, '两条标注')
  await sleep(200)
  await shot('draft-editor')
})

await check('审稿 / 修稿兜底：审稿有范围说明；正文没改不重复审稿；同一集最多修稿 3 轮', async () => {
  if (!(await evaluate(`document.querySelector('[role=tooltip]')?.textContent.includes('AI 审稿检查什么')`))) throw new Error('缺少审稿范围说明')
  await t(`__t.click('button', 'AI 审稿')`)
  await waitFor(`document.body.innerText.includes('审查报告 #1')`, '审稿报告', 6000)
  await waitFor(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'AI 审稿')?.disabled`, '没改动时审稿禁用')
  for (let round = 1; round <= 3; round++) {
    const path = await evaluate('location.pathname')
    await t(`__t.click('button', 'AI 修稿')`)
    await waitFor(`location.pathname !== '${path}'`, `第 ${round} 轮修稿`, 8000)
  }
  await waitFor(`document.body.innerText.includes('自动修稿已停止')`, '修稿上限提示')
  if (!(await t(`__t.find('button', 'AI 修稿').disabled`))) throw new Error('达到上限后 AI 修稿应禁用')
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
