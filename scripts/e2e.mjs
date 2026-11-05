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
/** 集标题：第一集（≤ 99） */
const cnEpisode = (n) => {
  const d = '零一二三四五六七八九'
  return `第${n < 10 ? d[n] : `${n >= 20 ? d[Math.floor(n / 10)] : ''}十${n % 10 ? d[n % 10] : ''}`}集`
}
const profile = mkdtempSync(join(tmpdir(), 'jb-e2e-'))
// 关掉后台定时器节流：屏幕空闲 / 锁屏时无头页面的定时器会被压到一分钟一次，整轮从几分钟拖到半小时以上，等待全部超时
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--hide-scrollbars', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, '--window-size=1440,1000', 'about:blank',
], { stdio: 'ignore' })
// 出错、超时或被中断时也要关掉自己启动的无头 Chrome
process.on('exit', () => chrome.kill())
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(130))
process.on('uncaughtException', (e) => { console.error(e); process.exit(1) })
process.on('unhandledRejection', (e) => { console.error(e); process.exit(1) })

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
  for (const o of opts) {
    // 选项多的下拉框只显示当前分组：先搜再点
    if (await evaluate(`!!document.querySelector('[role=listbox] input[aria-label=搜索选项]')`)) {
      await t(`__t.type(document.querySelector('[role=listbox] input[aria-label=搜索选项]'), '${o}')`)
      await until(`!!__t.find('[role=option]', '${o}')`, '搜到 ' + o)
    }
    await t(`__t.click('[role=option]', '${o}')`)
  }
  await evaluate(`document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`)
  await waitFor(`!document.querySelector('[role=listbox]')`, '下拉收起')
}
/** 带页面工具函数的等待：表达式里可以用 __t */
const until = (expr, label, timeout) => waitFor(`(() => { ${helpers}; return ${expr} })()`, label, timeout)
const dialog = (text) => `[...document.querySelectorAll('[role=dialog]')].some((d) => d.innerText.includes('${text}'))`
/** 故事架构逐项生成：刚生成的提示条停在哪一项 */
const stepAt = `(document.querySelector('[data-step-review]')?.closest('[data-node]')?.getAttribute('data-node') ?? '')`
/** 点一次「AI 生成 / 继续生成」，等它生成完下一项停下来；返回停在哪一项 */
const stepOnce = async () => {
  const prev = await evaluate(stepAt)
  await evaluate(`(document.querySelector('[data-step-next]') ?? document.querySelector('[data-fill-next]')).click()`)
  await waitFor(`${stepAt} && ${stepAt} !== '${prev}' && !document.querySelector('[data-fill-next]')?.disabled`, '逐项生成一项', 8000)
  return evaluate(stepAt)
}
/** 一项一项点到底：返回依次停在哪些项 */
const stepAll = async () => {
  const seen = []
  for (let i = 0; i < 14 && (await evaluate(`!!document.querySelector('[data-fill-next]')`)); i++) seen.push(await stepOnce())
  return seen
}

await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
await goto('/'); await evaluate('localStorage.clear()'); await goto('/projects/new')

/* ---------------------------------- 立项 ---------------------------------- */

await check('立项：未填必填项不能创建，逐项报错', async () => {
  await t(`__t.click('button', '创建剧本')`)
  await until(`__t.has('请填写剧本名称')`, '必填报错')
  if (!(await t(`__t.has('还有 1 处需要修改')`))) throw new Error('底部未汇总报错数')
})
await check('立项：只有基本信息、市场与发行两块；故事设定立项后到故事架构填', async () => {
  await goto('/projects/new')
  const heads = await evaluate(`[...document.querySelectorAll('[data-new-project] section h3')].map((h) => h.textContent)`)
  if (heads.join() !== '基本信息,市场与发行') throw new Error('立项应只有基本信息、市场与发行：' + heads)
  if (await evaluate(`!!document.querySelector('input[aria-label=总集数], input[aria-label=单集时长], [aria-haspopup=listbox], select[aria-label=类型]')`)) throw new Error('立项不应再有类型、题材、集数、时长')
  if (await t(`__t.has('一句话灵感') || __t.has('每集字数')`)) throw new Error('仍有一句话灵感或每集字数')
  await t(`__t.type(document.querySelector('input[maxlength="30"]'), '端到端测试剧')`)
  await shot('new-form')
  await t(`__t.click('button', '创建剧本')`)
  await waitFor(`/\\/projects\\/[\\w-]+$/.test(location.pathname) && document.body.innerText.includes('端到端测试剧')`, '跳转到工作台')
  await waitFor(`document.body.innerText.includes('剧本已创建')`, 'toast')
  projectPath = await evaluate('location.pathname')
  projectId = projectPath.split('/').pop()
  const p = await project()
  if (p.spec.episodeSeconds !== 90 || p.spec.totalEpisodes < 10 || 'episodeWords' in p.spec) throw new Error('立项应先用默认集数和时长：' + JSON.stringify(p.spec))
})

/* -------------------------------- 故事架构 -------------------------------- */

const arch = async () => (await project()).work.architecture
await check('故事架构 · 基本信息：题材类型、风格元素两个下拉（选项取自 StoryPlay，跟着目标市场走），题材类型最多 3 个，风格元素最多 5 个；类型、题材元素、风格基调去掉', async () => {
  await goto(projectPath + '/stage/architecture')
  await waitFor(`document.querySelector('input[aria-label=单集时长]')`, '基本信息')
  if (await evaluate(`!!document.querySelector('select[aria-label=类型]')`) || (await t(`__t.has('题材元素') || __t.has('风格基调')`))) throw new Error('类型、题材元素、风格基调应已去掉')
  const region = `[...document.querySelectorAll('[data-genre-region]')].map((e) => e.textContent).join('|')`
  if ((await evaluate(region)) !== '欧美 · 最多 3 个|欧美 · 最多 5 个') throw new Error('目标市场北美应给欧美的选项：' + (await evaluate(region)))
  await pick(0, '穿越重生', '都市豪门', '契约婚姻', '狼人传说')
  await waitFor(`JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').genres.join() === '穿越重生,都市豪门,契约婚姻'`, '题材类型只选上前 3 个')
  await t(`__t.pick(0)`)
  await waitFor(`document.querySelector('[role=listbox] input[aria-label=搜索选项]')`, '选项多时有搜索框')
  // 左边分组、右边当前分组的选项；打开时停在有已选项的第一组
  const groups = await evaluate(`[...document.querySelectorAll('[role=listbox] [data-group]')].map((g) => g.dataset.group)`)
  if (groups.length !== 18 || groups.slice(0, 3).join() !== '都市,黑帮罪案,狼人' || !groups.includes('女巫') || !groups.includes('西部荒野')) throw new Error('欧美题材类型应按 StoryPlay 的 18 组分：' + groups)
  if ((await evaluate(`document.querySelector('[role=listbox] [data-group][aria-pressed=true]').dataset.group`)) !== '都市') throw new Error('打开时应停在有已选项的第一组')
  if ((await evaluate(`document.querySelector('[data-group=都市] span:last-child').textContent`)) !== '2') throw new Error('分组上应标出已选几个')
  await t(`__t.click('[data-group]', '狼人')`)
  const wolf = await evaluate(`[...document.querySelectorAll('[role=option]')].map((o) => o.textContent)`)
  if (wolf.join() !== '狼人传说,狼人部落,狼人禁忌恋,白狼觉醒,月光诅咒,兽人契约') throw new Error('狼人组的选项不对：' + wolf)
  if (await evaluate(`[...document.querySelectorAll('[role=option]')].some((o) => o.getAttribute('aria-selected') !== 'true' && !o.disabled)`)) throw new Error('选满 3 个后其余选项应禁用')
  await t(`__t.type(document.querySelector('[role=listbox] input[aria-label=搜索选项]'), '契约')`)
  await until(`document.querySelector('[data-search-results]')`, '搜索结果')
  const found = await evaluate(`[...document.querySelectorAll('[data-search-results] [role=option]')].map((o) => o.textContent)`)
  if (found.length < 5 || found.some((x) => !x.includes('契约'))) throw new Error('搜索应只列出含关键词的选项：' + found)
  // 搜分组名列出整组
  await t(`__t.type(document.querySelector('[role=listbox] input[aria-label=搜索选项]'), '吸血鬼')`)
  await until(`__t.find('[data-search-results] [role=option]', '日光行者')`, '搜分组名')
  await t(`__t.type(document.querySelector('[role=listbox] input[aria-label=搜索选项]'), '契约婚姻')`)
  await until(`!!__t.find('[role=option]', '契约婚姻')`, '搜到契约婚姻')
  await t(`__t.click('[role=option]', '契约婚姻')`)
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
  await waitFor(`!document.querySelector('[role=listbox]')`, 'Esc 收起')
  await waitFor(`JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').genres.join() === '穿越重生,都市豪门'`, '取消一项后剩 2 个')
  await pick(1, '爽感复仇虐渣', '精致豪门质感', '狼人印记', '婚前协议', '银质武器', '黑手党家族')
  const tones = await evaluate(`[...document.querySelectorAll('[aria-haspopup=listbox]')[1].querySelectorAll('span span')].map((e) => e.textContent)`)
  if (tones.join() !== '爽感复仇虐渣,精致豪门质感,狼人印记,婚前协议,银质武器') throw new Error('风格元素应只选上前 5 个：' + tones)
  await t(`__t.pick(1)`)
  await waitFor(`document.querySelector('[role=listbox] [data-group]')`, '风格元素下拉')
  if ((await evaluate(`[...document.querySelectorAll('[role=listbox] [data-group]')].map((g) => g.dataset.group).join()`)) !== '风格,元素') throw new Error('风格元素应分风格、元素两组')
  await evaluate(`document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`)
  if ((await arch())) throw new Error('改基本信息不应生成故事架构')
  // 目标市场只选日韩：换成日韩那套（日本、韩国清洗后合并）；不在这套里的已选项放在最前面，仍可取消
  await patchStored(`(p) => { p.markets = ['日韩'] }`, projectPath + '/stage/architecture')
  await waitFor(`document.querySelector('[data-genre-region]')`, '基本信息')
  if ((await evaluate(region)) !== '日韩 · 最多 3 个|日韩 · 最多 5 个') throw new Error('目标市场日韩应给日韩的选项：' + (await evaluate(region)))
  await t(`__t.pick(0)`)
  await waitFor(`document.querySelector('[role=listbox] [data-group]')`, '日韩题材下拉')
  const jk = await evaluate(`[...document.querySelectorAll('[role=listbox] [data-group]')].map((g) => g.dataset.group)`)
  if (jk[0] !== '不在选项里' || jk[1] !== '时代背景' || !['和风奇幻', '异世界转生', '古装权谋', '偶像练习生', '黑道帮派'].every((g) => jk.includes(g))) throw new Error('日韩题材类型分组不对：' + jk)
  // 穿越重生两套都有，不算旧值
  if ((await evaluate(`[...document.querySelectorAll('[role=option]')].map((o) => o.textContent).join()`)) !== '都市豪门') throw new Error('不在日韩选项里的已选项应列在最前面')
  await t(`__t.type(document.querySelector('[role=listbox] input[aria-label=搜索选项]'), '财阀')`)
  await until(`document.querySelector('[data-search-results]')`, '搜索结果')
  if (!(await evaluate(`[...document.querySelectorAll('[data-search-results] [role=option]')].some((o) => o.textContent === '财阀继承')`))) throw new Error('日韩应能搜到财阀继承')
  await evaluate(`document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`)
  // 两种市场都选：两套都给，分组前标出是哪一套
  await patchStored(`(p) => { p.markets = ['北美', '日韩'] }`, projectPath + '/stage/architecture')
  await waitFor(`document.querySelector('[data-genre-region]')`, '基本信息')
  if (!(await evaluate(region)).startsWith('欧美 + 日韩 · ')) throw new Error('两种市场都选应两套都给：' + (await evaluate(region)))
  await t(`__t.pick(0)`)
  await waitFor(`document.querySelector('[role=listbox] [data-group]')`, '题材下拉')
  const both = await evaluate(`[...document.querySelectorAll('[role=listbox] [data-group]')].map((g) => g.dataset.group)`)
  if (both[0] !== '欧美 · 都市' || !both.includes('日韩 · 时代背景') || both.length !== 18 + 26) throw new Error('两套的分组应标出欧美 / 日韩：' + both.slice(0, 3))
  await evaluate(`document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`)
  await patchStored(`(p) => { p.markets = ['北美'] }`, projectPath + '/stage/architecture')
})
await check('故事架构 · 基本信息：单集时长（秒）与总集数同一行，越界收回到范围内，概览显示时长', async () => {
  const seconds = `document.querySelector('input[aria-label=单集时长]')`
  if ((await evaluate(`${seconds}.value`)) !== '90') throw new Error('单集时长默认应为 90 秒')
  const [a, b] = await evaluate(`['总集数', '单集时长'].map((l) => document.querySelector('input[aria-label=' + l + ']')?.getBoundingClientRect().top)`)
  if (a == null || b == null || Math.round(a) !== Math.round(b)) throw new Error('总集数 / 单集时长不在同一行：' + [a, b])
  await t(`__t.type(${seconds}, '20')`)
  await t(`__t.blur(${seconds})`)
  await waitFor(`${seconds}.value === '30'`, '越界收回到 30 秒')
  await t(`__t.type(${seconds}, '120')`)
  await t(`__t.blur(${seconds})`)
  await waitFor(`JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').spec.episodeSeconds === 120`, '时长写回')
  // 11/4 标注 #80：总集数最少 1 集、最多 1000 集，新项目默认 20 集；输入框下不再写范围
  const total = `document.querySelector('input[aria-label=总集数]')`
  const stored = () => evaluate(`JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').spec.totalEpisodes`)
  if ((await evaluate(`${total}.value`)) !== '20' || (await stored()) !== 20) throw new Error('总集数默认应为 20 集')
  if ((await evaluate(`${total}.parentElement.innerText.trim()`)) !== '总集数*') throw new Error('总集数下不应再写范围提示')
  // 11/4 标注 #85：目标受众给空选项、必填；新项目先空着，没选时列为确认前还差的项
  const audience = `document.querySelector('select[aria-label=目标受众]')`
  const aud = await evaluate(`({ value: ${audience}.value, first: ${audience}.options[0].value + '|' + ${audience}.options[0].text, label: ${audience}.parentElement.querySelector('label').innerText, missing: document.querySelector('[data-live-missing]')?.innerText ?? '' })`)
  if (aud.value !== '' || aud.first !== '|请选择' || aud.label !== '目标受众*' || !aud.missing.includes('目标受众未选')) throw new Error('目标受众应有空选项、必填，新项目空着并列为缺项：' + JSON.stringify(aud))
  await evaluate(`(() => { const el = ${audience}; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, 'female'); el.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  await waitFor(`(JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').audience === 'female') && !(document.querySelector('[data-live-missing]')?.innerText ?? '').includes('目标受众')`, '选了目标受众')
  const rhythm0 = (await project()).rhythm
  for (const [typed, want] of [['0', 1], ['5000', 1000], ['20', 20]]) {
    await t(`__t.type(${total}, '${typed}')`)
    await t(`__t.blur(${total})`)
    await waitFor(`${total}.value === '${want}' && JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').spec.totalEpisodes === ${want}`, `总集数 ${typed} 收回到 ${want}`)
  }
  if (JSON.stringify((await project()).rhythm) !== JSON.stringify(rhythm0)) throw new Error('总集数改回 20 后节奏框架应回到原样')
  await goto(projectPath)
  if (!(await t(`__t.has('2 分钟 · 约')`))) throw new Error('概览应显示单集时长与换算字数')
  if (!(await t(`__t.before('项目设定', '故事架构卡')`))) throw new Error('概览应先项目设定（左）、再故事架构卡（右）')
  await evaluate(`[...document.querySelectorAll('h2,h3')].find((h) => h.textContent === '项目设定')?.scrollIntoView({ block: 'start' })`)
  await shot('created-overview')
})
await check('故事架构：核心设定 AI 生成 3 个候选并选用（原立项页的候选搬到这里）', async () => {
  await goto(projectPath + '/stage/architecture')
  await waitFor(`document.querySelector('[data-generate=核心设定]')`, '核心设定的 AI 生成')
  if (!(await evaluate(`document.querySelector('[data-generate=核心设定]').title.startsWith('生成逻辑：')`))) throw new Error('核心设定的 AI 生成没写生成逻辑')
  await evaluate(`document.querySelector('[data-generate=核心设定]').click()`)
  await waitFor(`document.querySelectorAll('[data-logline-ideas] li button').length >= 3`, '候选', 5000)
  if (await evaluate(`document.querySelector('[data-logline-ideas]').innerText.includes('爽点公式')`)) throw new Error('爽点公式已删，候选里不应再写爽点公式')
  await shot('new-candidates')
  await evaluate(`document.querySelector('[data-logline-ideas] li button').click()`)
  await waitFor(`document.querySelector('textarea[aria-label=核心设定]').value.length > 10`, '选用候选')
  const p = await project()
  if (!p.logline || p.logline.length < 10) throw new Error('核心设定未保存')
  if ((await arch())) throw new Error('选用候选不应生成故事架构')
  await t(`__t.click('[data-logline-ideas] button', '收起候选')`)
  await waitFor(`!document.querySelector('[data-logline-ideas]')`, '收起')
})
await check('故事架构：不分层，按编剧顺序 核心设定 → 世界观 → 金手指 → 故事背景 → 核心亮点 → 主角人设 → 冲突主线（节奏框架折在里面）→ 全局写作要求（参考作品、整体框架、主要势力、创新点删掉）；左侧节点带序号、标题突出；只有核心设定标必填；基本信息里没有故事结构、叙事视角、爽点公式、沉寂提醒阈值；每个生成项都有 ⓘ 三段式依据', async () => {
  await goto(projectPath + '/stage/architecture')
  await waitFor(`document.querySelector('textarea[aria-label=核心设定]')`, '核心设定输入框')
  if (await t(`__t.has('一句话想法') || __t.has('每集字数') || __t.has('核心大纲')`)) throw new Error('仍有一句话想法、每集字数或「核心大纲」')
  const basics = await evaluate(`(() => { const l = [...document.querySelectorAll('label')].find((x) => x.textContent === '风格元素'); return l && [...l.closest('.grid').querySelectorAll(':scope > div > div > label')].map((x) => x.textContent).join() })()`)
  if (basics !== '题材类型,风格元素,目标受众*') throw new Error('基本信息第一行应为 题材类型 / 风格元素 / 目标受众：' + basics)
  if (await evaluate(`!!document.querySelector('[data-layer], [data-layer-progress]')`)) throw new Error('不应再分层')
  const items = await evaluate(`[...document.querySelectorAll('#arch-items [data-item]')].map((l) => l.getAttribute('data-item')).join()`)
  if (items !== 'logline,world,goldenFinger,background,highlights,heroSetup,mainLine,writingRules') throw new Error('各项顺序不对：' + items)
  // 11/4 标注 #71：故事背景后面加核心亮点（期待值、情绪），后面的依次往后排
  const hl = await evaluate(`(() => { const n = document.querySelector('[data-node=highlights]'); return { no: n?.querySelector('[data-item-no]').textContent, title: n?.querySelector('[data-item-title]').textContent, hint: n?.innerText ?? '', box: !!n?.querySelector('textarea[aria-label=核心亮点]'), gen: !!n?.querySelector('[data-generate=核心亮点]'), polish: !!n?.querySelector('[data-polish=核心亮点]') } })()`)
  if (hl.no !== '5' || !hl.title?.startsWith('核心亮点') || !hl.hint.includes('期待值') || !hl.hint.includes('情绪') || !hl.box || !hl.gen || !hl.polish) throw new Error('故事背景后面应是 5. 核心亮点（期待值、情绪），带 AI 生成、AI 润色：' + JSON.stringify(hl))
  // 参考作品 11/4 删掉；整体框架 11/4 第五轮标注 #57 删掉；主要势力、创新点第五轮 #62 #63 删掉
  if (await t(`__t.has('参考作品')`)) throw new Error('参考作品应已删掉')
  if (await t(`__t.has('整体框架')`)) throw new Error('整体框架应已删掉')
  if (await evaluate(`!!document.querySelector('[data-item=factions], [data-item=innovations], [data-generate=创新点], textarea[aria-label=主要势力]')`) || (await t(`__t.has('主要势力') || __t.has('创新点')`))) throw new Error('主要势力、创新点应已删掉')
  // 11/4 标注 #51–#54：故事结构、叙事视角、爽点公式、沉寂提醒阈值删掉；总集数、单集时长、剧本语言同一行
  if (await evaluate(`!!document.querySelector('[data-item=formula], select[aria-label=故事结构], select[aria-label=叙事视角], input[aria-label=爽点公式], input[aria-label=沉寂提醒阈值]')`)) throw new Error('故事结构、叙事视角、爽点公式、沉寂提醒阈值应已删掉')
  if (await t(`__t.has('故事结构') || __t.has('叙事视角') || __t.has('爽点公式') || __t.has('沉寂提醒')`)) throw new Error('页面上仍提到已删的字段')
  const rowTops = await evaluate(`['input[aria-label=总集数]', 'input[aria-label=单集时长]', 'select[aria-label=剧本语言]'].map((q) => Math.round(document.querySelector(q).getBoundingClientRect().top))`)
  if (new Set(rowTops).size !== 1) throw new Error('总集数、单集时长、剧本语言应在同一行：' + rowTops)
  // 顶部的顺序说明里也有「世界观设定」，按元素位置比：按钮在核心设定这一项后面、世界观设定这一项前面
  // 11/5 标注 #86：「AI 给出 3 个方向」改名「AI 框架方向」，放在核心设定框下面、世界观设定前面
  if (!(await evaluate(`(() => { const btn = [...document.querySelectorAll('#arch-items button')].find((b) => b.textContent.trim() === 'AI 框架方向'); const box = document.querySelector('textarea[aria-label=核心设定]'); const w = document.querySelector('[data-item=world]'); return !!btn && !!(box.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING) && !!(btn.compareDocumentPosition(w) & Node.DOCUMENT_POSITION_FOLLOWING) })()`))) throw new Error('AI 框架方向应在核心设定框下面、世界观前')
  if (await t(`__t.has('AI 给出 3 个方向')`)) throw new Error('「AI 给出 3 个方向」应改名为「AI 框架方向」')
  // 11/4 第五轮标注 #58：AI 评估可行性去掉，只留 AI 框架方向
  if (await t(`__t.has('评估可行性') || __t.has('可行性')`)) throw new Error('AI 评估可行性应已去掉')
  // 节奏框架折在冲突主线里，默认收起，不单独排号
  if (!(await evaluate(`!!document.querySelector('[data-item=mainLine] [data-rhythm]')`))) throw new Error('节奏框架应折在冲突主线里')
  if (await evaluate(`document.querySelector('[data-rhythm-toggle]').getAttribute('aria-expanded') !== 'false' || !!document.querySelector('[data-rhythm] svg rect')`)) throw new Error('节奏框架应默认收起，不显示曲线')
  if (!(await evaluate(`document.querySelector('[data-rhythm-summary]').innerText.includes('首付费第')`))) throw new Error('收起时应显示节奏摘要')
  if ((await evaluate(`[...document.querySelectorAll('#arch-items [data-node]')].pop().getAttribute('data-node')`)) !== 'writingRules') throw new Error('全局写作要求应放最后')
  const order = await evaluate(`document.querySelector('[data-arch-order]').innerText`)
  if (!order.includes('主角人设 → 冲突主线（含节奏框架）') || !order.endsWith('冲突主线（含节奏框架） → 全局写作要求')) throw new Error('卡片顶部的顺序说明不对：' + order)
  const nos = await evaluate(`[...document.querySelectorAll('#arch-items [data-item-no]')].map((l) => l.textContent).join()`)
  if (nos !== '1,2,3,4,5,6,7,8') throw new Error('各项序号不对（节奏框架不单独排号）：' + nos)
  // 每一项的标题是关键节点：比说明文字大、加粗
  const title = await evaluate(`(() => { const h = getComputedStyle(document.querySelector('[data-node=world] [data-item-title]')); return [parseFloat(h.fontSize), Number(h.fontWeight)] })()`)
  if (!(title[0] >= 15 && title[1] >= 600)) throw new Error('各项标题应更突出：' + title)
  const filledNo = await evaluate(`[...document.querySelectorAll('#arch-items [data-node]')].map((n) => n.querySelector('[data-item-no]').classList.contains('bg-brand-600')).join()`)
  if (!filledNo.startsWith('true,false')) throw new Error('有内容的项节点实心、空的空心：' + filledNo)
  const star = (item) => `!!document.querySelector('[data-item=${item}] .text-red-500')`
  // 11/4 标注 #55 #56：各项里只有核心设定必填
  if (!(await evaluate(star('logline')))) throw new Error('核心设定应标必填')
  for (const item of ['world', 'goldenFinger', 'background', 'highlights', 'heroSetup', 'mainLine', 'writingRules'])
    if (await evaluate(star(item))) throw new Error('除核心设定外都不应标必填：' + item)
  // 全部展开：设定段不再折叠
  if (!(await evaluate(`['世界观设定', '故事背景', '核心亮点', '主角人设', '全局写作要求'].every((l) => document.querySelector('textarea[aria-label=' + l + ']'))`))) throw new Error('各项应全部展开')
  const basis = await evaluate(`[...document.querySelectorAll('[data-basis]')].map((b) => b.getAttribute('data-basis'))`)
  for (const k of ['核心设定', '金手指 / 核心卖点', '主角人设', '世界观设定', '故事背景', '核心亮点', '冲突主线', '节奏框架', '全局写作要求'])
    if (!basis.includes(k)) throw new Error('缺少 ⓘ 依据：' + k)
  if (basis.some((k) => k === '主要势力' || k === '创新点')) throw new Error('主要势力、创新点的依据也应去掉：' + basis)
  const lineTip = await evaluate(`document.querySelector('[data-basis="冲突主线"]').parentElement.querySelector('[role=tooltip]').textContent`)
  if (lineTip.includes('主要势力') || lineTip.includes('创新点')) throw new Error('冲突主线的依据不应再列主要势力、创新点：' + lineTip)
  const tip = await evaluate(`document.querySelector('[data-basis="金手指 / 核心卖点"]').parentElement.querySelector('[role=tooltip]').textContent`)
  if (!tip.includes('必须遵守') || !tip.includes('核心设定里的反常规点') || !tip.includes('重点参考') || !tip.includes('不违背即可')) throw new Error('ⓘ 应写三段式依据：' + tip)
  if (!tip.includes('世界观设定（金手指要在世界观的规则里成立）')) throw new Error('金手指排在世界观后面，依据应带世界观：' + tip)
  // 核心设定框更大（标注 #18）
  if ((await evaluate(`document.querySelector('textarea[aria-label=核心设定]').rows`)) < 3) throw new Error('核心设定框应至少 3 行')
})
await check('故事架构：冲突主线未填完时不能生成节奏框架（收起时按钮也在）', async () => {
  if (!(await t(`__t.find('[data-rhythm] button', '生成节奏框架').disabled`))) throw new Error('主线为空时「生成节奏框架」应禁用')
  if (!(await t(`__t.has('先定冲突主线，再点「生成节奏框架」')`))) throw new Error('缺少先定主线的提示')
})
await check('故事架构：AI 框架方向的 3 个方向在弹窗里对比，原创每个方向列出核心设定、世界观、金手指、故事背景（整体框架删掉）；选一个点「确定录入」才写入这四项', async () => {
  await t(`__t.click('button', 'AI 框架方向')`)
  await waitFor(dialog('AI 框架方向'), '方向弹窗', 5000)
  const cards = await evaluate(`[...document.querySelectorAll('[role=radiogroup] label')].map((l) => l.innerText)`)
  if (cards.length !== 3) throw new Error('应有 3 个方向：' + cards.length)
  for (const c of cards) for (const h of ['核心设定', '世界观', '金手指', '故事背景', '世界总览：', '阵营设定：', '主要地点：', '首次出现：', '核心能力：', '表现方式：']) if (!c.includes(h)) throw new Error('方向卡缺少「' + h + '」')
  const order = await evaluate(`[...document.querySelectorAll('[role=radiogroup] label')[0].querySelectorAll('[data-dir-part]')].map((e) => e.dataset.dirPart).join()`)
  if (order !== 'logline,world,goldenFinger,background') throw new Error('方向卡顺序应为 核心设定、世界观、金手指、故事背景：' + order)
  if (cards.some((c) => c.includes('整体框架') || c.includes('转折：'))) throw new Error('原创的方向卡不应再有整体框架')
  const before = await arch()
  if (before?.plan || before?.world) throw new Error('弹窗打开时不应写入')
  if (!(await t(`__t.find('[role=dialog] button', '确定录入').disabled`))) throw new Error('未选方向时「确定录入」应禁用')
  await evaluate(`document.querySelectorAll('[role=radiogroup] input[type=radio]')[1].click()`)
  await until(`!__t.find('[role=dialog] button', '确定录入').disabled`, '选中后可录入')
  await sleep(300)
  await shot('architecture-directions')
  await t(`__t.click('[role=dialog] button', '确定录入')`)
  await waitFor(`!${dialog('AI 框架方向')}`, '弹窗关闭')
  const a = await arch()
  const p = await project()
  if (a.plan || !cards[1].includes(p.logline)) throw new Error('方向应录入核心设定、不再写整体框架')
  if (!a.world.startsWith('世界总览：') || !a.world.includes('\n阵营设定：') || !a.world.includes('\n主要地点：') || !cards[1].includes(a.world.split('\n')[0])) throw new Error('方向的世界观应总分写：' + a.world)
  if (!/^金手指：「[^」]+」\n/.test(a.goldenFinger) || /型）|型 \+/.test(a.goldenFinger) || !a.goldenFinger.includes('\n核心能力：') || !a.goldenFinger.includes('硬金手指')) throw new Error('方向的金手指不标类型、写核心能力：' + a.goldenFinger)
  if (a.background.includes('\n') || /^(开场前|旧事)：/.test(a.background) || !a.background.includes('最终')) throw new Error('方向的故事背景应写成一段故事简介：' + a.background)
  if (a.heroSetup.trim() || a.mainLine.some((b) => b.content.trim()) || a.innovations.length) throw new Error('方向不应再写主角人设、冲突主线、创新点（排在后面推）')
  // 录入后清空这三项，后面的逐项生成照常从世界观往下推
  await patchStored(`(p) => { p.work.architecture.world = ''; p.work.architecture.goldenFinger = ''; p.work.architecture.background = '' }`, projectPath + '/stage/architecture')
})
await check('故事架构：整体框架删掉，没有它的 AI 生成、AI 润色，各项依据里也不再列；核心设定可 AI 润色', async () => {
  if (!(await evaluate(`!!document.querySelector('[data-polish=核心设定]')`))) throw new Error('核心设定缺少 AI 润色')
  if (await evaluate(`!!document.querySelector('[data-item=plan], [data-node=plan], [data-generate=整体框架], [data-polish=整体框架], textarea[aria-label=整体框架]')`)) throw new Error('整体框架应已删掉')
  const tips = await evaluate(`[...document.querySelectorAll('#arch-items [data-basis]')].map((b) => b.parentElement.querySelector('[role=tooltip]')?.textContent ?? '').join('|')`)
  if (tips.includes('整体框架')) throw new Error('各项依据里不应再列整体框架')
  await sleep(200)
  if (await evaluate(`!!document.querySelector('[data-marks]')`)) throw new Error('各项下面不再显示「依据说明」一行')
})
await check('故事架构：「AI 生成」每次只生成下一个空着的项，生成完停下来等编剧看，点「继续生成」再往下；冲突主线带着节奏框架一起生成；每项只读排在前面的（金手指读世界观、主角人设读故事背景，世界观不读金手指）', async () => {
  const btn = `document.querySelector('[data-fill-next]')`
  const label = await evaluate(`${btn}.textContent`)
  if (!label.includes('AI 生成「世界观设定」')) throw new Error('按钮应从第一个空着的项起：' + label)
  const logline = (await project()).logline
  if ((await stepOnce()) !== 'world') throw new Error('第一次应停在世界观设定')
  const one = await arch()
  if (!one.world.trim() || one.goldenFinger.trim() || one.heroSetup.trim()) throw new Error('一次只应生成一项：' + JSON.stringify({ world: one.world.length, gf: one.goldenFinger.length }))
  await sleep(1500)
  if ((await arch()).goldenFinger.trim()) throw new Error('生成完一项应停下来，不应自己往下')
  if (!(await evaluate(`${btn}.textContent`)).includes('继续生成「金手指 / 核心卖点」')) throw new Error('页头按钮应变成继续生成下一项：' + (await evaluate(`${btn}.textContent`)))
  if (!(await evaluate(`document.querySelector('[data-step-review]').innerText.includes('看过、改好再往下生成') && document.querySelector('[data-step-next]').textContent.includes('继续生成「金手指 / 核心卖点」')`))) throw new Error('刚生成的项下面应有「看过再继续」的提示条')
  if (!(await evaluate(`document.querySelector('[data-node=world] [data-item-no]').classList.contains('ring-4')`))) throw new Error('刚生成的项节点应高亮')
  await evaluate(`document.querySelector('[data-node=world]').scrollIntoView({ block: 'center' })`)
  await sleep(200)
  await shot('architecture-step')
  const seen = await stepAll()
  if (seen.join() !== 'goldenFinger,background,highlights,heroSetup,mainLine,writingRules') throw new Error('应一项一项往下、每次停一下：' + seen)
  if (!(await project()).work.prints?.['arch.rhythm']) throw new Error('冲突主线生成时应顺带生成节奏框架')
  if (await evaluate(`!!${btn} || !!document.querySelector('[data-step-next]')`)) throw new Error('都有内容后按钮应收起')
  if (!(await evaluate(`document.querySelector('[data-step-review]').innerText.includes('各项都有内容了')`))) throw new Error('最后一项生成后应提示看过再确认')
  const a = await arch()
  const p = await project()
  if (p.logline !== logline || a.plan) throw new Error('已有内容不应被覆盖，也不应再生成整体框架')
  if (!a.heroSetup.startsWith('主角：') || !a.heroSetup.includes('\n性格：')) throw new Error('主角人设应按人物卡写：' + a.heroSetup)
  if (!a.goldenFinger.startsWith('金手指：') || !a.marks.goldenFinger.length) throw new Error('金手指未生成或没有标记')
  if (!['首次出现：', '核心能力：', '表现方式：', '与主线强相关：', '硬金手指'].every((h) => a.goldenFinger.includes(h)) || /型）|型 \+/.test(a.goldenFinger)) throw new Error('金手指不标类型，写核心能力和表现方式：' + a.goldenFinger)
  if (!a.world.startsWith('世界总览：') || !a.world.includes('\n阵营设定：\n· ') || !a.world.includes('\n主要地点：\n· ')) throw new Error('世界观应总分写：' + a.world)
  if (a.background.includes('\n') || /^(开场前|旧事)：/.test(a.background)) throw new Error('故事背景应写成一段故事简介：' + a.background)
  // 11/4 第五轮标注 #59：故事架构的金手指也去掉类型按钮
  if (await evaluate(`!!document.querySelector('[data-gf-kinds]')`)) throw new Error('金手指的类型按钮应已去掉')
  // 11/4 第五轮标注 #62 #63：主要势力、创新点删掉，逐项生成不再生成，冲突主线也不再读
  if (a.factions.trim() || a.innovations.length) throw new Error('主要势力、创新点已删，逐项生成不应生成它们')
  if (!a.writingRules.trim()) throw new Error('全局写作要求应生成')
  if (a.mainLine.some((b) => !b.content.trim())) throw new Error('冲突主线没生成全')
  if (a.marks.mainLine.some((m) => /主要势力|创新点/.test(m.from))) throw new Error('冲突主线不应再读主要势力、创新点：' + JSON.stringify(a.marks.mainLine))
  if (a.formula) throw new Error('爽点公式已删，逐项生成不应生成它')
  if (/叙事视角|爽点按/.test(a.writingRules)) throw new Error('全局写作要求不应再读叙事视角、爽点公式：' + a.writingRules)
  // 每项只读排在前面的
  if (a.marks.world.some((m) => m.from.includes('金手指'))) throw new Error('世界观排在金手指前面，不应读金手指')
  if (!a.marks.goldenFinger.some((m) => m.from.includes('世界观'))) throw new Error('金手指应读世界观')
  if (!a.marks.background.some((m) => m.from.includes('世界观')) || a.marks.background.some((m) => m.from.includes('主角人设'))) throw new Error('故事背景应读世界观、不读主角人设')
  if (!a.marks.heroSetup.some((m) => m.from === '故事背景')) throw new Error('主角人设应从故事背景推')
  // 核心亮点：期待值（核心爽点、观众等着看、情感期待）+ 情绪（主打情绪、情绪走向）；读核心设定和故事背景，不读排在后面的主角人设
  if (!['期待值：\n· 核心爽点：你以为', '\n· 观众等着看：', '\n· 情感期待：', '\n情绪：\n· 主打情绪：', '\n· 情绪走向：'].every((h) => a.highlights.includes(h))) throw new Error('核心亮点应写期待值和情绪：' + a.highlights)
  if (!a.marks.highlights.some((m) => m.from.includes('故事背景')) || a.marks.highlights.some((m) => /主角人设|冲突主线/.test(m.from))) throw new Error('核心亮点应读故事背景、不读排在后面的项：' + JSON.stringify(a.marks.highlights))
  if (!a.marks.writingRules.some((m) => m.from === '核心亮点（情绪）') || !a.writingRules.includes('情绪：每集至少给到一次')) throw new Error('全局写作要求应按核心亮点写情绪：' + a.writingRules)
  if (!a.marks.writingRules.some((m) => m.from === '节奏框架')) throw new Error('全局写作要求排在节奏框架后面，钩子、付费卡点应按节奏框架写')
  if (!p.work.prints?.['arch.world']) throw new Error('应记下依据指纹')
  if (await evaluate(`!!document.querySelector('[data-stale]')`)) throw new Error('刚逐项生成的项不应提示依据已改')
  await evaluate(`document.querySelector('[data-item=goldenFinger]').scrollIntoView()`)
  await sleep(200)
  await shot('architecture-items')
})
await check('故事架构：冲突主线可改集数，按主线生成节奏框架，主线设定显示在折线图下方', async () => {
  const end = `document.querySelector('input[aria-label$=结束集]')`
  // 增删段的操作列在最前面
  const firstCell = await evaluate(`${end}.closest('tr').querySelector('td').querySelector('button')?.getAttribute('aria-label') ?? ''`)
  if (!firstCell.includes('后新增一段')) throw new Error('冲突主线第一列应是增删段操作：' + firstCell)
  await evaluate(`${end}.closest('table').scrollIntoView({ block: 'center' })`)
  await sleep(200)
  await shot('architecture-mainline')
  // 新项目默认 20 集（#80），默认分段 1–2 / 3–6 / …，第一段收到第 3 集
  await t(`__t.type(${end}, '3')`)
  await t(`__t.blur(${end})`)
  await waitFor(`JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').work.architecture.phaseEnds?.[0] === 3`, '第一段结束集写回')
  await t(`__t.click('button', '生成节奏框架')`)
  await waitFor(`document.body.innerText.includes('节奏框架已按冲突主线生成')`, '生成 toast')
  // 节奏框架默认收起：展开才有曲线
  await evaluate(`document.querySelector('[data-rhythm-toggle]').click()`)
  await waitFor(`document.querySelector('[data-rhythm] svg rect') && document.querySelector('[data-rhythm]').innerText.includes('还没有合适的打分依据')`, '展开节奏框架（曲线只是示意）')
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
  await evaluate(`document.querySelector('[data-generate=冲突主线]').click()`)
  await waitFor(dialog('重新生成冲突主线？'), '覆盖确认')
  await t(`__t.click('[role=dialog] button', '重新生成')`)
  await waitFor(`!${dialog('重新生成冲突主线？')} && !document.querySelector('[data-generate=冲突主线]').disabled`, '生成完成', 5000)
  const a = await arch()
  if (a.phaseEnds?.[0] !== 3 || a.mainLine.some((b) => !b.content.trim())) throw new Error('重新生成后分段或剧情不对：' + JSON.stringify(a.phaseEnds))
})
await check('故事架构：各项里只有核心设定必填——核心设定空着不能确认，其余各项空着也能确认；确认后只读', async () => {
  const logline = (await project()).logline
  const world = (await arch()).world
  const rules = (await arch()).writingRules
  await t(`__t.type(document.querySelector('textarea[aria-label=核心设定]'), '')`)
  await t(`__t.click('button', '确认故事架构')`)
  await until(`__t.has('核心设定未填写')`, '列出缺的必填项')
  if ((await arch()).status === 'approved') throw new Error('核心设定空着不应确认')
  await t(`__t.type(document.querySelector('textarea[aria-label=核心设定]'), ${JSON.stringify(logline)})`)
  await t(`__t.type(document.querySelector('textarea[aria-label=世界观设定]'), '')`)
  await t(`__t.type(document.querySelector('textarea[aria-label=全局写作要求]'), '')`)
  await t(`__t.click('button', '确认故事架构')`)
  await waitFor(`document.body.innerText.includes('故事架构已确认')`, '确认 toast')
  const a = await arch()
  if (a.status !== 'approved' || 'layers' in a) throw new Error('世界观、全局写作要求空着也应能确认，且不留逐层记录：' + JSON.stringify(a.layers))
  if (!(await evaluate(`document.querySelector('textarea[aria-label=世界观设定]').disabled`))) throw new Error('确认后各项应只读')
  if (!(await t(`!!__t.find('button', '修改故事架构')`))) throw new Error('确认后应有「修改故事架构」')
  // 后面的检查要用到这两项：改回来
  await t(`__t.click('button', '修改故事架构')`)
  await waitFor(`!document.querySelector('textarea[aria-label=世界观设定]').disabled`, '可以改')
  await t(`__t.type(document.querySelector('textarea[aria-label=世界观设定]'), ${JSON.stringify(world)})`)
  await t(`__t.type(document.querySelector('textarea[aria-label=全局写作要求]'), ${JSON.stringify(rules)})`)
  await t(`__t.click('button', '确认故事架构')`)
  await waitFor(`JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').work.architecture.status === 'approved'`, '重新确认')
  await waitFor(`document.querySelector('[data-bottom-slot] [data-stage-next=characters]')`, '确认后底部接去人物设定')
})
await check('故事架构：上游改了，下游不自动重写，也不再显示「依据已改」；修改故事架构后要重新确认', async () => {
  const before = (await project()).logline
  const gf = (await arch()).goldenFinger
  await t(`__t.click('button', '修改故事架构')`)
  await waitFor(`!document.querySelector('textarea[aria-label=核心设定]').disabled`, '可以改了')
  if ((await arch()).status === 'approved') throw new Error('修改后故事架构应回到草稿')
  await t(`__t.type(document.querySelector('textarea[aria-label=核心设定]'), '${'被全家当成废物赶出门的真千金，其实是隐世医门的唯一传人。'}')`)
  await until(`JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').logline.startsWith('被全家当成废物')`, '核心设定改了', 3000)
  await sleep(300)
  if ((await arch()).goldenFinger !== gf) throw new Error('依据改了不应自动重写')
  if (await evaluate(`!!document.querySelector('[data-stale]')`)) throw new Error('故事架构里不再显示「依据已改」')
  await t(`__t.type(document.querySelector('textarea[aria-label=核心设定]'), ${JSON.stringify(before)})`)
  await sleep(200)
  await t(`__t.click('button', '确认故事架构')`)
  await waitFor(`JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').work.architecture.status === 'approved'`, '重新确认')
  await waitFor(`document.querySelector('[data-bottom-slot] [data-stage-next=characters]')`, '确认后底部接去人物设定')
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

await check('人物设定：每项都有 AI 生成 → AI 润色并标注生成逻辑；定位可以自定义；重新生成只补不换', async () => {
  await goto(projectPath + '/stage/characters')
  await waitFor(`document.querySelector('[data-field-ai=lookRef]')`, '外形参考旁的 AI 按钮')
  const fields = await evaluate(`[...document.querySelectorAll('[data-field-ai]')].map((s) => s.innerText.replace(/\\s+/g, ' '))`)
  if (fields.length !== 13 || fields.some((x) => !(x.indexOf('AI 生成') >= 0 && x.indexOf('AI 生成') < x.indexOf('AI 润色')))) throw new Error('每项应有 AI 生成 → AI 润色：' + JSON.stringify(fields))
  if (!(await evaluate(`document.querySelector('[data-generate=外形参考]').title.startsWith('生成逻辑：')`))) throw new Error('AI 生成没有标生成逻辑')
  if (!(await evaluate(`!!document.querySelector('[aria-label^="身份的生成逻辑"]')`))) throw new Error('名字旁缺少生成逻辑 ⓘ')
  const name = await evaluate(`document.querySelector('input[aria-label=人物名]').value`)
  const me = async () => (await project()).work.characters.find((c) => c.name === name)
  const stored = (expr) => `JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').work.characters.find((c) => c.name === ${JSON.stringify(name)}).${expr}`
  if ((await me()).lookRef) throw new Error('整批生成时外形参考应先空着')
  // 空着的项：点 AI 生成直接填上
  await evaluate(`document.querySelector('[data-generate=外形参考]').click()`)
  await waitFor(stored(`lookRef.startsWith('选角方向')`), '外形参考已生成', 5000)
  // 已有内容：先对比，采用才替换
  await t(`__t.type(document.querySelector('textarea[aria-label=身份]'), '临时改的身份')`)
  await waitFor(stored(`profile === '临时改的身份'`), '身份写回')
  await evaluate(`document.querySelector('[data-generate=身份]').click()`)
  await waitFor(dialog('AI 生成 · 身份'), '对比弹窗', 5000)
  if (!(await t(`__t.has('生成依据：按定位')`))) throw new Error('对比弹窗没写生成依据')
  await t(`__t.click('[role=dialog] button', '采用')`)
  await waitFor(stored(`profile !== '临时改的身份'`), '采用后替换')

  // 定位：自定义，另选按哪类检查；改回固定定位时去掉自定义
  const role = (await me()).role
  const choose = (v) => evaluate(`(() => { const s = document.querySelector('select[aria-label=定位]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ${JSON.stringify(v)}); s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  await choose('__custom')
  await waitFor(`document.querySelector('input[aria-label=自定义定位]')`, '自定义输入框')
  await t(`__t.type(document.querySelector('input[aria-label=自定义定位]'), '女主闺蜜')`)
  await t(`__t.blur(document.querySelector('input[aria-label=自定义定位]'))`)
  await waitFor(stored(`roleLabel === '女主闺蜜'`), '自定义定位写回')
  if ((await me()).role !== role) throw new Error('自定义定位不应改掉检查用的定位')
  if (!(await t(`__t.has('女主闺蜜：' + ${JSON.stringify(name)})`))) throw new Error('标题应显示自定义定位')
  if (!(await evaluate(`!!document.querySelector('select[aria-label=按哪类定位检查]') && [...document.querySelectorAll('select[aria-label=定位] option')].some((o) => o.textContent === '女主闺蜜')`))) throw new Error('缺少归类选择或自定义选项')
  await shot('characters-custom-role')
  await choose(role)
  await waitFor(stored(`roleLabel === undefined`), '改回固定定位')

  // 重新生成：已有的人物和内容都保留，只补空着的
  const before = (await project()).work.characters
  await t(`__t.type(document.querySelector('textarea[aria-label=备注]'), '保留这句')`)
  await t(`__t.type(document.querySelector('textarea[aria-label=潜意识恐惧]'), '')`)
  await waitFor(stored(`notes === '保留这句'`) + ' && ' + stored(`fear === ''`), '改动写回')
  await t(`__t.click('#character-bios button', '重新生成')`)
  await waitFor(`document.body.innerText.includes('已补上')`, '补充 toast', 6000)
  if (await evaluate(`document.querySelectorAll('[role=dialog]').length`)) throw new Error('只补不换，不用再确认')
  const after = (await project()).work.characters
  if (before.some((c) => !after.some((x) => x.id === c.id))) throw new Error('重新生成不应替换已有人物')
  const mine = after.find((c) => c.name === name)
  const old = before.find((c) => c.name === name)
  if (mine.notes !== '保留这句' || !mine.fear.trim() || mine.lookRef !== old.lookRef || mine.profile !== old.profile) throw new Error('应保留已填内容、只补空着的项：' + JSON.stringify({ notes: mine.notes, fear: mine.fear }))
})

/* ---------------------------------- 大纲 ---------------------------------- */

await check('创作流程：伏笔与叙事线索已删——导航里没有这一步，情节大纲之后直接是逐集剧本；旧地址回到概览', async () => {
  const nav = await evaluate(`[...document.querySelectorAll('nav ol a')].map((a) => a.textContent)`)
  if (nav.some((x) => x.includes('伏笔'))) throw new Error('导航里不应再有伏笔：' + nav.join(' / '))
  const o = nav.findIndex((x) => x.includes('情节大纲'))
  if (o < 0 || !nav[o + 1]?.includes('逐集剧本')) throw new Error('情节大纲之后应直接是逐集剧本：' + nav.join(' / '))
  await goto(projectPath + '/stage/foreshadow')
  await waitFor(`location.pathname === '${projectPath}'`, '旧地址回到概览')
})
await check('情节大纲：AI 一键生成全部（总览 + 阶段总览 + 集纲）；全部生成后按钮变成「重新全部生成」，确认后整份重写', async () => {
  await goto(projectPath + '/stage/outline')
  if (await evaluate(`document.body.innerText.includes('本次生成范围')`)) throw new Error('生成范围一行应已删除')
  await t(`__t.click('button', 'AI 一键生成全部')`)
  await waitFor(`(() => { const p = JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}'); return p.work.plot?.overview && p.work.outline.length >= p.spec.totalEpisodes })()`, '全部集纲', 20000)
  await until(`__t.find('main button', '重新全部生成') && !__t.find('main button', '重新全部生成').disabled`, '按钮变为重新全部生成')
  if (!(await t(`!!__t.find('main button', '重新生成集纲')`))) throw new Error('阶段卡片上应有「重新生成集纲」')
  // 阶段卡片头：「生成阶段总览」排在「一键集纲 / 重新生成集纲」前面，同一行
  const order = await evaluate(`[...document.querySelectorAll('#outline-phase-0 > div:first-child > div:first-child button:not([data-basis])')].map((b) => b.textContent.trim())`)
  if (order.join('/') !== '重新生成阶段总览/重新生成集纲') throw new Error('阶段总览按钮应在集纲按钮前面：' + order.join('/'))
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
await check('情节大纲：集纲写成一段（发生了什么 → 主角怎么应对 → 推进到哪）；阶段总览先写这一段的剧情概况，再写段名、节点、金手指（11/4 第五轮标注 #60 #61）', async () => {
  const p = await project()
  const short = p.work.outline.filter((o) => o.event.split('。').filter(Boolean).length < 2 || o.event.length < 50)
  if (short.length) throw new Error('集纲应写成一段、不只一句：' + JSON.stringify(short.slice(0, 3).map((o) => [o.ep, o.event])))
  const beats = (await arch()).mainLine.map((b) => b.beat)
  p.work.plot.phases.forEach((text, i) => {
    const lines = text.split('\n')
    if (lines[0].startsWith(beats[i]) || lines[0].length < 40 || !lines[1]?.startsWith(beats[i] + '（')) throw new Error(`第 ${i + 1} 段阶段总览应先写剧情概况、再写「${beats[i]}（集数）：」：` + text.slice(0, 160))
    if (!lines.some((l) => l.startsWith('节点：')) && i < beats.length - 1) throw new Error('阶段总览应写节点：' + text)
  })
  // 写作开场只写集纲的第一句（本集主事件），不把整段塞进一行动作
  const lines = await evaluate(`import('/src/services/mock/writer.ts').then((m) => m.writeEpisode(JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((x) => x.id === '${projectId}'), 2, 0).lines.map((l) => l.zh))`)
  const two = p.work.blueprints.find((b) => b.ep === 2)?.conflict || p.work.outline.find((o) => o.ep === 2).event
  const [head, next] = two.split(/[；。]/).map((x) => x.trim())
  if (!lines.some((l) => l.includes(head)) || lines.some((l) => l.includes(head) && l.includes(next))) throw new Error('开场应只写集纲第一句：' + JSON.stringify(lines.slice(0, 4)))
})
await check('情节大纲：只重新生成总纲时阶段总览不动；单集重新生成集纲时同段其他集不动', async () => {
  await patchStored(`(p) => { p.work.plot.overview = '旧总纲'; p.work.plot.phases[0] = '手改阶段总览'; for (const o of p.work.outline) if (o.ep <= 3) o.event = '手改集纲' + o.ep }`, projectPath + '/stage/outline?ep=2')
  await waitFor(`document.querySelector('#outline-ep-2') && document.querySelector('[aria-label="重新生成第 2 集集纲"]')`, '?ep=2 定位到第 2 集所在的段')
  await t(`__t.click('main button', '重新生成总纲')`)
  await waitFor(dialog('重新生成总纲？'), '总纲确认')
  await t(`__t.click('[role=dialog] button', '重新生成')`)
  await waitFor(`JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').work.plot.overview !== '旧总纲'`, '总纲已替换', 5000)
  if ((await project()).work.plot.phases[0] !== '手改阶段总览') throw new Error('重新生成总纲不应改动阶段总览')
  const ov = (await project()).work.plot.overview
  const bg = (await arch()).background.trim()
  if (!ov.startsWith('【故事简介】') || ov.includes('【核心设定】') || !ov.split('\n')[0].includes(bg.slice(0, 20))) throw new Error('总览开头应是【故事简介】，用故事背景那段故事简介：' + ov.slice(0, 120))
  // 核心亮点写了就照它写，代替题材常识的【爽点】
  const hlLine = ov.split('\n').find((l) => l.startsWith('【核心亮点】')) ?? ''
  if (!hlLine.includes('核心爽点：你以为') || !hlLine.includes('主打情绪：') || ov.includes('【爽点】')) throw new Error('总览应按故事架构的核心亮点写【核心亮点】：' + ov)
  await t(`document.querySelector('[aria-label="重新生成第 2 集集纲"]').click()`)
  await waitFor(dialog('重新生成第 2 集的集纲？'), '单集确认')
  await t(`__t.click('[role=dialog] button', '重新生成')`)
  await waitFor(`JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').work.outline.find((o) => o.ep === 2).event !== '手改集纲2'`, '第 2 集集纲已替换', 5000)
  const o = (await project()).work.outline
  if (o.find((x) => x.ep === 1).event !== '手改集纲1' || o.find((x) => x.ep === 3).event !== '手改集纲3') throw new Error('单集重新生成不应改动其他集')
})
await check('情节大纲：按总纲 → 阶段总览 → 集纲的顺序生成；「付费卡点待审核」点一下跳到待审核的集', async () => {
  const before = (await project()).work
  const keep = { overview: before.plot.overview, phase1: before.plot.phases[1], approved: before.outline.filter((o) => o.approved).map((o) => o.ep) }
  // 没有总纲：阶段总览按钮禁用
  await patchStored(`(p) => { p.work.plot.overview = '' }`, projectPath + '/stage/outline?ep=1')
  await waitFor(`document.querySelector('#outline-phase-0')`, '第一段')
  if (await t(`!!__t.find('main button', '生成总览与')`)) throw new Error('总览卡不应再有「总览与阶段总览」合并按钮')
  if (!(await t(`__t.find('#outline-phase-0 button', '重新生成阶段总览').disabled`))) throw new Error('没有总纲时阶段总览按钮应禁用')
  // 有总纲、本段没有阶段总览：本段集纲（整段与单集）都禁用
  await patchStored(`(p) => { p.work.plot.overview = ${JSON.stringify(keep.overview)}; p.work.plot.phases[0] = '' }`, projectPath + '/stage/outline?ep=1')
  await waitFor(`document.querySelector('[aria-label="重新生成第 1 集集纲"]')`, '第 1 集')
  if (!(await t(`document.querySelector('[aria-label="重新生成第 1 集集纲"]').disabled && [...document.querySelectorAll('#outline-phase-0 button')].find((b) => b.textContent.trim() === '重新生成集纲' && !b.getAttribute('aria-label')).disabled`)))
    throw new Error('没有阶段总览时本段集纲按钮应禁用')
  // 11/5 标注 #88：「阶段粗纲」统一叫「阶段简介」；#94 再改叫「阶段总览」（页面、按钮、状态库）
  if (await t(`__t.has('粗纲') || __t.has('阶段简介')`)) throw new Error('「粗纲」「阶段简介」应统一叫「阶段总览」')
  await t(`__t.click('#outline-phase-0 button', '生成阶段总览')`)
  await waitFor(`JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').work.plot.phases[0].trim()`, '阶段总览已生成', 5000)
  const plot = (await project()).work.plot
  if (plot.phases[1] !== keep.phase1 || plot.overview !== keep.overview) throw new Error('生成阶段总览不应改动总纲与其他段')
  await waitFor(`!document.querySelector('[aria-label="重新生成第 1 集集纲"]').disabled`, '有阶段总览后集纲可生成')
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
  for (const s of ['/ 100', '一致性终检', '角色一致性', '故事流程', '节奏曲线对比', '付费点专项', '格式合规', '章节目录', '全剧', '跨集问题', '第 6 集', '全部问题']) {
    if (!(await t(`__t.has(${JSON.stringify(s)})`))) throw new Error('缺少「' + s + '」')
  }
  // 11/4 第五轮标注 #62：故事架构的创新点删掉，质检的「创新点落地」一起收起，剩六项
  if (await t(`__t.has('创新点')`)) throw new Error('创新点落地应已收起')
  const sum = await evaluate(`(() => { const s = document.querySelector('#qa-summary'); const g = [...document.querySelectorAll('div')].find((d) => d.className.includes('xl:grid-cols-[220px')); const a = s.getBoundingClientRect(); const b = g.getBoundingClientRect(); return { below: a.bottom <= b.top, wide: Math.round(a.width) === Math.round(b.width), inside: g.contains(s) } })()`)
  if (!sum.below || !sum.wide || sum.inside) throw new Error('质检总分应横排在交付卡片下、三栏之上：' + JSON.stringify(sum))
  const cols = await evaluate(`(() => { const g = [...document.querySelectorAll('div')].find((d) => d.className.includes('xl:grid-cols-[220px')); return [...g.children].map((c) => { const r = c.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), Math.round(r.top)] }) })()`)
  if (cols.length !== 3 || !(cols[0][1] <= cols[1][0] && cols[1][1] <= cols[2][0]) || new Set(cols.map((c) => c[2])).size !== 1) throw new Error('应为左中右三栏：' + JSON.stringify(cols))
  const report = (await project()).work.qa
  if (!report || report.issues.length === 0) throw new Error('没有问题')
  if (report.checks.map((c) => c.key).join() !== 'consistency,character,flow,rhythm,paywall,format') throw new Error('原创质检应为六项：' + report.checks.map((c) => c.key))
  if (report.issues.some((i) => i.check === 'innovation')) throw new Error('原创没有创新点，不应查创新点落地')
  // 仿写（剧本仿写、视频仿写）有创新点，质检七项、权重和原来一样
  const weights = await evaluate(`import('/src/domain/pipeline.ts').then((m) => ['original', 'adaptation', 'video'].map((mode) => m.qaChecks({ mode }).map((c) => c.key + ':' + c.weight).join()))`)
  if (weights[0] !== 'consistency:0.2,character:0.15,flow:0.15,rhythm:0.15,paywall:0.2,format:0.15' || weights[1] !== weights[2] || weights[1] !== 'consistency:0.15,character:0.15,flow:0.15,rhythm:0.15,paywall:0.15,innovation:0.1,format:0.15') throw new Error('质检项与权重不对：' + JSON.stringify(weights))
  const want = Math.round(report.checks.reduce((s, c, i) => s + c.score * [0.2, 0.15, 0.15, 0.15, 0.2, 0.15][i], 0))
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
  await waitFor(`${panel}.innerText.includes('人物 · 本集进场与服化道')`, '切到本集')
  text = await panelText()
  if ((await evaluate(`${panel}.querySelector('input[aria-label=选择集]')?.value`)) !== '1' || !text.includes('开场钩子')) throw new Error('本集快照不对：' + text.slice(0, 120))
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
  if (!ep.includes('已定稿') || !ep.includes('人物 · 本集进场与服化道') || !ep.includes('首次出场')) throw new Error('第 1 集快照不对：' + ep.slice(0, 160))
  await sleep(300)
  await shot('state-panel-final-ep1')
  await panelTab('全剧')
  await waitFor(`${panel}.innerText.includes('已定稿至第 6 集')`, '全剧进度')
  await sleep(200)
  await shot('state-panel-overall')
  await panelTab('本集')
  await t(`document.querySelector('aside[aria-label=剧本状态库] [aria-label=下一个]').click()`)
  await waitFor(`${panel}.querySelector('input[aria-label=选择集]')?.value === '2' && ${panel}.innerText.includes('回到当前页面选中的位置')`, '侧栏里翻到第 2 集')
  // 输入集数直接跳到任意一集；下拉跳到任意一段
  if (await t(`!!document.querySelector('aside[aria-label=剧本状态库] select[aria-label=选择集]')`)) throw new Error('选择集应是数字输入框，不是下拉')
  await t(`__t.type(document.querySelector('aside[aria-label=剧本状态库] input[aria-label=选择集]'), '5')`)
  await t(`__t.enter(document.querySelector('aside[aria-label=剧本状态库] input[aria-label=选择集]'))`)
  const title5 = await evaluate(`(async () => {
    const m = await import('/src/domain/snapshot.ts')
    const p = JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((x) => x.id === '${projectId}')
    return m.episodeSnapshot(p, 5).title || '第 5 集'
  })()`)
  await waitFor(`${panel}.querySelector('input[aria-label=选择集]').value === '5' && ${panel}.innerText.includes(${JSON.stringify(title5)}) && ${panel}.innerText.includes('5-1')`, '输入跳到第 5 集')
  await panelTab('本阶段')
  await evaluate(`(() => { const el = document.querySelector('aside[aria-label=剧本状态库] select[aria-label=选择阶段]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, '2'); el.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  await waitFor(`${panel}.querySelector('select[aria-label=选择阶段]').value === '2'`, '下拉跳到第 3 段')
  await panelTab('本集')
})
await check('状态库：没有伏笔与线索、需处理（伏笔这一步已删）；可收起、可打开完整视图', async () => {
  await goto(projectPath + '/stage/outline')
  await waitFor(panel, '侧栏')
  // 情节大纲默认选中阶段：本阶段 / 全剧
  for (const tab of ['本阶段', '全剧']) {
    await panelTab(tab)
    await sleep(150)
    const text = await panelText()
    if (text.includes('伏笔与线索') || text.includes('需处理')) throw new Error(`侧栏「${tab}」不应再有伏笔与线索、需处理：` + text.slice(0, 200))
  }
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
  if (await t(`__t.has('伏笔与叙事线索进度') || __t.has('伏笔与线索')`)) throw new Error('完整视图不应再有伏笔进度')
})

await check('状态库：草稿页按这份草稿显示本集，注明不计入全剧；写作前检查只在逐集蓝图的「检查」页', async () => {
  await patchStored(`async (p) => {
    const { writeEpisode } = await import('/src/services/mock/writer.ts')
    const d = writeEpisode(p, 7, 0)
    const at = new Date().toISOString()
    p.work.drafts.push({ id: 'e2e-draft-7', ep: 7, version: 1, title: d.title, lines: d.lines, status: 'draft', translated: false, states: d.states, reviews: [], notes: [], createdAt: at, updatedAt: at })
  }`, projectPath + '/stage/script/draft/e2e-draft-7')
  await waitFor(`${panel}?.innerText.includes('草稿_v1 · 未定稿，不计入全剧状态')`, '草稿依据')
  if ((await panelText()).includes('写作前检查')) throw new Error('状态库里不应再有写作前检查，它在逐集蓝图的「检查」页')
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
  for (const label of ['AI', '润色', '扩写', '续写']) if (!bar.text.includes(label)) throw new Error('工具条缺少 ' + label)
  if (bar.text.includes('对话')) throw new Error('工具条不应再有「对话」')
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
  // 离开后按样稿改写成「夜，外，天台」，前面自动编场次号
  await evaluate(`document.activeElement.blur()`)
  await waitFor(`JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').work.drafts.find((d) => d.id === 'e2e-draft-7').lines.some((l) => l.kind === 'scene' && l.zh === '夜，外，天台')`, '场景标题按样稿格式改写')
  if (!(await evaluate(`/\\d+-\\d+：/.test(document.querySelector('textarea[aria-label="第 4 段"]').closest('.flex').innerText)`))) throw new Error('场景标题前应有场次号')
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
  const coreBasis = r.wrote.basis.filter((b) => b.basis === 'core').map((b) => b.text)
  if (!coreBasis.some((x) => x.includes('血腥'))) throw new Error('写作依据应写明避开的词：' + coreBasis.join(' / '))
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
  // AI 审稿旁的 ▾：这次换个模型审。正文没改过时 Kimi 不重复审，别的模型还能再审一遍
  if (!(await t(`__t.find('main button', 'AI 审稿').disabled`))) throw new Error('正文没改过时 AI 审稿应置灰')
  const reviewMore = `document.querySelector('main button[aria-label=换个模型审稿]')`
  await waitFor(`${reviewMore} && !${reviewMore}.disabled`, '审稿旁的 ▾ 还能点')
  await evaluate(`${reviewMore}.click()`)
  await waitFor(`document.querySelector('[role=menu]')?.innerText.includes('这次换个模型审')`, '审稿模型菜单')
  if ((await menuItems()) !== 'DeepSeek,通义千问,豆包,Kimi（项目默认，写这一版的，已审过）,GPT,Gemini') throw new Error('审稿 ▾ 应标出默认、写这一版的与审过的模型：' + (await menuItems()))
  if (!(await evaluate(`[...document.querySelectorAll('[role=menu] [role=menuitem]')].find((b) => b.textContent.startsWith('Kimi')).disabled`))) throw new Error('审过这一版正文的模型不能再审')
  if (!(await evaluate(`document.querySelector('[role=menu] [data-model-note]')?.textContent.includes('这一版是 Kimi 写的')`))) throw new Error('审稿 ▾ 应写明这一版是哪个模型写的')
  await sleep(150)
  await shot('draft-review-model-menu')
  await t(`__t.click('[role=menu] [role=menuitem]', 'DeepSeek')`)
  await waitFor(`document.querySelector('[data-review-notice]')?.innerText.includes('DeepSeek 审稿')`, '换 DeepSeek 审稿', 6000)
  const reviewModels = (await project()).work.drafts.filter((d) => d.ep === 7).at(-1).reviews.map((r) => r.model).join()
  if (reviewModels !== 'kimi,deepseek' || (await project()).models.text !== 'kimi') throw new Error('换模型审稿应只记在这份审稿上：' + reviewModels)
  await waitFor(`document.querySelector('[data-panel-tab=reviews]')?.innerText.includes('DeepSeek ·')`, '审核报告列表写明审稿模型')
  await evaluate(`document.querySelector('[data-review-notice] button')?.click()`)
  // 两个模型都审过这一版：▾ 里两个都不能再选
  await evaluate(`${reviewMore}.click()`)
  await waitFor(`document.querySelector('[role=menu]')?.innerText.includes('这次换个模型审')`, '审稿模型菜单')
  const off = await evaluate(`[...document.querySelectorAll('[role=menu] [role=menuitem]')].filter((b) => b.disabled).map((b) => b.textContent.replace(/（.*/, '')).join()`)
  if (off !== 'DeepSeek,Kimi') throw new Error('审过这一版的模型都不能再审：' + off)
  await evaluate(`${reviewMore}.click()`)
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
  // 11/4 标注 #47：转写列表里看的是剧本（通用剧本格式），不是分镜
  await waitFor(`document.querySelector('[data-view-script]')`, '「剧本」按钮')
  if (await evaluate(`[...document.querySelectorAll('main button')].some((b) => b.textContent.trim() === '分镜')`)) throw new Error('转写列表里不应再有「分镜」按钮')
  await evaluate(`document.querySelector('[data-view-script]').click()`)
  await waitFor(dialog(`第 ${doneEp.ep} 集 · 剧本`), '剧本弹窗')
  const script = await evaluate(`document.querySelector('[data-episode-script]').innerText`)
  if (!script.startsWith('第') || !new RegExp(`^${doneEp.ep}-1：`, 'm').test(script) || !script.includes('△') || /\d{2}:\d{2}/.test(script)) throw new Error('应按通用剧本格式显示这一集（集标题、场次、△ 动作，不带时间码）：' + script.slice(0, 120))
  if (await evaluate(`!!document.querySelector('[role=dialog] table')`)) throw new Error('不应再显示分镜表')
  await sleep(150)
  await shot('video-episode-script')
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
  await waitFor(`!document.querySelector('[role=dialog]')`, '关闭剧本弹窗')
  // 先停掉队列，免得它在恢复数据后又写回存储
  await evaluate(`import('/src/store/videoQueue.ts').then((m) => m.stopQueue('${projectId}'))`)
  await sleep(300)
  await patchStored(`async (p) => { p.mode = 'original'; p.work.video = null; p.models = {} }`, projectPath + '/settings')
  if (!hadBlueprint) await patchStored(`async (p) => { p.work.blueprints = p.work.blueprints.filter((b) => b.ep !== 7) }`, projectPath + '/settings')
})

await check('视频转剧本：没有 AI 校对，改成人工校对——选一集，左边视频、右边按剧本格式排；点一行或场次跳到那一刻，听错的直接改；校对完标记，合并后又改过的提示重新合并', async () => {
  const video = `(await import('/src/services/mock/video.ts'))`
  await patchStored(`async (p) => {
    const v = ${video}
    const at = '2026-10-29T10:00:00.000Z'
    const job = { origin: 'link', url: 'https://www.reelshort.com/x', platform: 'ReelShort', createdAt: at, merged: null, episodes: v.resolveLink('https://www.reelshort.com/x').episodes }
    job.episodes = job.episodes.map((e) => ({ ...e, attempts: 1, status: 'done', doneAt: at, model: 'qwen', shots: v.transcribe(e.ep) }))
    p.e2eSource = p.work.source ?? null
    p.e2eBreakdown = p.work.breakdown ?? null
    p.mode = 'video'
    p.models = {}
    p.work.video = job
  }`, projectPath + '/stage/video')
  await waitFor(`document.querySelector('#video-check [data-check-script]')`, '人工校对卡片')
  if (await evaluate(`[...document.querySelectorAll('main button')].some((b) => b.textContent.includes('AI 校对'))`)) throw new Error('不应再有 AI 校对')
  // 选一集有两场以上的：右边按样稿格式排
  const eps = (await project()).work.video.episodes
  const E = eps.find((e) => e.ep > 1 && e.shots.filter((x) => x.scene).length >= 2).ep
  const N = eps.find((e) => e.ep > E).ep
  const pickEp = (n) => evaluate(`(() => { const s = document.querySelector('#video-check select[aria-label=选择集]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, '${n}'); s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  await pickEp(E)
  await waitFor(`document.querySelector('[data-check-script]').innerText.startsWith('第 ${E} 集')`, '切到第 ' + E + ' 集')
  const script = await evaluate(`document.querySelector('[data-check-script]').innerText`)
  if (!new RegExp(`${E}-1：[日夜晨]，[内外]+，\\S`).test(script) || !/人物：/.test(script) || !/△/.test(script)) throw new Error('右侧应按剧本格式排：' + script.slice(0, 200))
  if (!(await evaluate(`!!document.querySelector('#video-check [data-sim-player]')`))) throw new Error('没有视频文件时左侧应是模拟播放')
  // 点场次快速跳转：播放器跳到这一场开头，这一场高亮
  const chips = await evaluate(`[...document.querySelectorAll('[data-scene-jump] button')].map((b) => b.textContent)`)
  if (chips.length < 2 || chips[1] !== `${E}-2`) throw new Error('场次跳转应按集-场编号：' + chips)
  await evaluate(`document.querySelectorAll('[data-scene-jump] button')[1].click()`)
  await waitFor(`Number(document.querySelector('#video-check input[aria-label=播放进度]').value) > 0 && document.querySelectorAll('[data-scene-jump] button')[1].className.includes('border-brand-500')`, '跳到第二场')
  // 播放时剧本跟着走
  const before = await evaluate(`Number(document.querySelector('#video-check input[aria-label=播放进度]').value)`)
  await evaluate(`document.querySelector('#video-check [aria-label=播放]').click()`)
  await sleep(700)
  await evaluate(`document.querySelector('#video-check [aria-label=暂停]')?.click()`)
  const after = await evaluate(`Number(document.querySelector('#video-check input[aria-label=播放进度]').value)`)
  if (!(after > before)) throw new Error('模拟播放应往前走')
  // 听错的直接改：改一句台词
  const dlg = await evaluate(`[...document.querySelectorAll('[data-check-script] [data-entry]')].findIndex((e) => e.innerText.includes('：') && !/^\\d+:\\d+\\s*(人物|\\d+-\\d+)/.test(e.innerText) && !e.innerText.includes('△'))`)
  await evaluate(`document.querySelectorAll('[data-check-script] [data-entry]')[${dlg}].querySelector('[aria-label=改这一行]').click()`)
  await waitFor(`document.querySelector('[data-check-script] textarea')`, '改这一行')
  await t(`__t.type(document.querySelector('[data-check-script] textarea'), '这一句是校对时改的。')`)
  // 改完要点「确认」才保存：失焦不保存，编辑框还在
  await t(`__t.blur(document.querySelector('[data-check-script] textarea'))`)
  await sleep(200)
  if (!(await evaluate(`!!document.querySelector('[data-check-script] [data-editing]')`)) || (await project()).work.video.episodes.find((e) => e.ep === E).editedAt) throw new Error('失焦不应保存，要点确认')
  await t(`__t.click('[data-check-script] [data-editing] button', '确认')`)
  await waitFor(`!document.querySelector('[data-check-script] [data-editing]') && document.querySelector('[data-check-script]').innerText.includes('这一句是校对时改的。')`, '改好的台词')
  let ep2 = (await project()).work.video.episodes.find((e) => e.ep === E)
  if (!ep2.editedAt || !ep2.shots.some((s) => s.line === '这一句是校对时改的。')) throw new Error('改动应写回本集转写稿并记下改动时间')
  await sleep(200)
  await shot('video-check')
  // 没有「这一集校对完了」：改过的集在转写表里标出
  if (await t(`!!__t.find('#video-check button', '这一集校对完了')`)) throw new Error('「这一集校对完了」应已删掉')
  if (!(await evaluate(`[...document.querySelectorAll('main tr')].some((tr) => tr.innerText.startsWith('第 ${E} 集') && tr.innerText.includes('校对改过'))`))) throw new Error('转写表里应标出校对改过')
  // 合并：带上校对改动；合并后又改，提示重新合并
  await t(`__t.click('main button', '合并并修正格式')`)
  await waitFor(`JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').work.video.merged?.text.includes('这一句是校对时改的。')`, '合并稿带上校对改动', 6000)
  await pickEp(E)
  await waitFor(`document.querySelector('[data-check-script]').innerText.startsWith('第 ${E} 集')`, '再切回这一集')
  const idx = await evaluate(`[...document.querySelectorAll('[data-check-script] [data-entry]')].findIndex((e) => e.innerText.includes('这一句是校对时改的。'))`)
  await sleep(1100)
  await evaluate(`document.querySelectorAll('[data-check-script] [data-entry]')[${idx}].querySelector('[aria-label=改这一行]').click()`)
  await waitFor(`document.querySelector('[data-check-script] textarea')`, '再改一次')
  await t(`__t.type(document.querySelector('[data-check-script] textarea'), '合并之后又改了。')`)
  await t(`__t.click('[data-check-script] [data-editing] button', '确认')`)
  await waitFor(`document.querySelector('[data-merge-stale]')?.innerText.includes('第 ${E} 集')`, '提示重新合并')
  await t(`__t.click('main button', '重新合并')`)
  await waitFor(`!document.querySelector('[data-merge-stale]') && JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').work.video.merged.text.includes('合并之后又改了。')`, '重新合并后带上新改动', 6000)
  await evaluate(`import('/src/store/videoQueue.ts').then((m) => m.stopQueue('${projectId}'))`)
  // 11/4 标注 #72 #74：送去拆解在页面底部的环节条里；送过去直接拆，不用再点「开始拆解」
  await waitFor(`document.querySelector('[data-bottom-slot] [data-to-breakdown]')`, '底部环节条的送入对标剧拆解')
  if (await evaluate(`[...document.querySelectorAll('main button, main a')].some((b) => /送入对标剧拆解|去拆解$/.test(b.textContent.trim()))`)) throw new Error('合并卡片里不应再有送入 / 去拆解按钮')
  // 11/4 标注 #81 #82：合并卡片头只写合并时间和全剧字数，左栏不再单列字数
  const mergedHead = await evaluate(`(() => { const h = [...document.querySelectorAll('main h3')].find((x) => x.textContent === '合并剧本'); const card = h.closest('.rounded-xl') ?? h.parentElement.parentElement.parentElement; return { desc: h.parentElement.innerText, stat: [...card.querySelectorAll('*')].some((e) => e.children.length === 0 && e.textContent.trim() === '字数'), len: JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').work.video.merged.text.length } })()`)
  if (!mergedHead.desc.includes(`· 全剧 ${mergedHead.len.toLocaleString()} 字`) || !/合并于 \d/.test(mergedHead.desc) || mergedHead.desc.includes('已自动修正') || mergedHead.stat) throw new Error('合并卡片头应只写合并时间和全剧字数：' + JSON.stringify(mergedHead))
  // 11/4 标注 #83：底部条按钮靠右
  const sendPos = await evaluate(`(() => { const bar = document.querySelector('[data-bottom-slot]').getBoundingClientRect(); const b = document.querySelector('[data-bottom-slot] [data-to-breakdown]').getBoundingClientRect(); const s = [...document.querySelectorAll('[data-bottom-slot] span')].find((x) => x.textContent.startsWith('剧本已合并')).getBoundingClientRect(); return { right: bar.right - b.right, textLeft: s.left - bar.left } })()`)
  if (sendPos.right > 40 || sendPos.textLeft > 40) throw new Error('底部条应状态靠左、按钮靠右：' + JSON.stringify(sendPos))
  await evaluate(`document.querySelector('[data-bottom-slot] [data-to-breakdown]').click()`)
  await sleep(200)
  if (await evaluate(`!!document.querySelector('[role=dialog]')`)) await t(`__t.click('[role=dialog] button', '替换并送入')`)
  await waitFor(`location.pathname.endsWith('/stage/breakdown') && !!document.querySelector('[aria-label=拆解进度]')`, '进拆解就开始拆')
  await waitFor(`JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').work.breakdown && document.querySelector('[data-bottom-slot] [data-bd-bar]')`, '直接出拆解结果', 15000)
  await goto(projectPath + '/stage/video')
  await waitFor(`document.querySelector('[data-bottom-slot] [data-stage-next=breakdown]')`, '送过去后底部给去对标剧拆解')
  await sleep(200)
  await patchStored(`async (p) => { p.mode = 'original'; p.work.video = null; p.models = {}; p.work.source = p.e2eSource; p.work.breakdown = p.e2eBreakdown; delete p.e2eSource; delete p.e2eBreakdown }`, projectPath + '/settings')
})

await check('我的剧本：页头「更新日志」打开字段变更日志——按日期列出新增 / 删除 / 必填改动与页面改动，可复制给开发', async () => {
  await goto('/projects')
  await waitFor(`document.querySelector('[data-changelog-open]')`, '更新日志按钮')
  await evaluate(`document.querySelector('[data-changelog-open]').click()`)
  await waitFor(`document.querySelector('[data-changelog]')`, '更新日志弹窗')
  const text = await evaluate(`document.querySelector('[data-changelog]').innerText`)
  if (!text.includes('来源：10/30 制作组评审会') || !text.includes('EpisodeBlueprint.looks') || !text.includes('多轮对话')) throw new Error('日志内容不对：' + text.slice(0, 200))
  const kinds = await evaluate(`[...new Set([...document.querySelectorAll('[data-changelog] [data-log-kind]')].map((li) => li.dataset.logKind))].join()`)
  for (const k of ['新增', '删除', '必填 → 非必填', '非必填 → 必填']) if (!kinds.split(',').includes(k)) throw new Error('缺少类型：' + k + ' / ' + kinds)
  if (await evaluate(`document.querySelectorAll('[data-changelog] [data-log-kind=""]').length`)) throw new Error('每一条都要有类型')
  await sleep(300)
  await shot('changelog')
  await evaluate(`document.querySelector('[role=dialog] [aria-label=关闭]').click()`)
  await waitFor(`!document.querySelector('[data-changelog]')`, '关闭')
})

await check('人物本集状态：蓝图里登记每人在哪场进来、服化道重点；状态库人物栏是紧凑表格——名称、定位、首次出场、妆造变几次，下面一场一行；导出的每集开头列本集人物状态', async () => {
  // 前面的检查测完会删掉临时补的蓝图；这里先补上第 1、8 集，测完还原
  const p0 = await project()
  await patchStored(`async (p) => {
    const { draftBlueprints } = await import('/src/services/mock/writer.ts')
    for (const ep of [1, 8]) if (!p.work.blueprints.some((b) => b.ep === ep)) p.work.blueprints.push(...draftBlueprints(p, ep, ep, 0))
    p.work.blueprints.sort((a, b) => a.ep - b.ep)
  }`, projectPath + '/stage/script?ep=8')
  await waitFor(`document.querySelector('[data-looks-editor]')`, '蓝图里的人物本集状态')
  const missing = await evaluate(`[...document.querySelectorAll('[data-looks-editor] button')].find((b) => b.textContent.includes('补上出场关键人'))?.textContent ?? ''`)
  if (missing) {
    await t(`__t.click('[data-looks-editor] button', '补上出场关键人')`)
    await waitFor(`!document.querySelector('[data-looks-editor]').innerText.includes('补上出场关键人')`, '补上关键人')
  }
  const rows = await evaluate(`document.querySelectorAll('[data-looks-editor] input[aria-label=进场的场景]').length`)
  if (!rows) throw new Error('应有人物行')
  await t(`__t.type(document.querySelectorAll('[data-looks-editor] input[aria-label=进场的场景]')[0], '豪门住宅客厅')`)
  await t(`__t.type(document.querySelectorAll('[data-looks-editor] input[aria-label=服化道重点]')[0], '白色晚礼服，盘发')`)
  await waitFor(`JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').work.blueprints.find((b) => b.ep === 8)?.looks?.[0]?.look === '白色晚礼服，盘发'`, '存进蓝图')
  // 第 1 集：给一个出现两场的人登记两套不同的服化道，状态库标出妆造变了几次
  const looks = await evaluate(`(async () => {
    const m = await import('/src/domain/looks.ts')
    const p = JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((x) => x.id === '${projectId}')
    return m.episodeLooks(p, 1)
  })()`)
  const two = looks.find((c) => c.scenes.length >= 2)
  if (!two) throw new Error('第 1 集应有人出现在两场以上：' + JSON.stringify(looks).slice(0, 200))
  const plan = two.scenes.map((sc, i) => ({ name: two.name, scene: sc.place, look: i ? '换上职业套装' : '洗旧的白衬衫' }))
  await patchStored(`(p) => { const b = p.work.blueprints.find((x) => x.ep === 1); b.looks = ${JSON.stringify(plan)} }`, projectPath + '/stage/script/final/1')
  if (!(await evaluate(`!!document.querySelector('aside[aria-label=剧本状态库]')`))) await t(`document.querySelector('[aria-label=展开剧本状态库]').click()`)
  await waitFor(`document.querySelector('aside[aria-label=剧本状态库]')`, '状态库')
  await t(`__t.click('aside [role=tab]', '状态库')`)
  await waitFor(`document.querySelector('[data-cast-table]')`, '人物栏是表格')
  const head = await evaluate(`[...document.querySelectorAll('[data-cast-table] th')].map((th) => th.textContent).join()`)
  if (head !== '人物,进场,服化道重点') throw new Error('表头不对：' + head)
  const row = `document.querySelector('[data-cast-table] [data-cast="${two.name}"]')`
  await waitFor(`${row}?.innerText.includes('妆造变 1 次') && ${row}.innerText.includes('换上职业套装') && ${row}.innerText.includes('1-')`, '妆造变了几次与场次')
  if (await evaluate(`document.querySelector('[data-cast-table]').closest('section').innerText.includes('本集有变化')`)) throw new Error('「本集有变化」改成妆造变几次')
  if (!(await evaluate(`document.querySelector('[data-cast-table]').innerText.includes('首次出场')`))) throw new Error('首次出场保留')
  // 连续几场没换装，服化道只写一次
  const repeated = await evaluate(`[...document.querySelectorAll('[data-cast-table] tbody')].filter((tb) => [...tb.querySelectorAll('[data-look]')].some((td, i, all) => i && td.textContent === all[i - 1].textContent)).map((tb) => tb.dataset.cast)`)
  if (repeated.length) throw new Error('没换装的几场应合成一格：' + repeated)
  await sleep(200)
  await shot('state-cast-table')
  // 导出：每集开头的本集人物状态
  const text = await evaluate(`(async () => {
    const m = await import('/src/domain/looks.ts')
    const p = JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((x) => x.id === '${projectId}')
    return m.looksText(m.episodeLooks(p, 1))
  })()`)
  if (!text.startsWith('本集人物状态：') || !text.includes(`${two.name}：`) || !text.includes('（换上职业套装）')) throw new Error('剧本开头的人物状态：' + text)
  await patchStored(`(p) => { p.work.blueprints = ${JSON.stringify(p0.work.blueprints)} }`, projectPath)
})

await check('AI 按钮：草稿页顺序为 重新生成 → AI 润色 → AI 审稿 → AI 修稿 → 定稿；润色先看前后改动再采用，采用后可撤销；没审稿也能直接定稿；设定段与集纲也能 AI 润色', async () => {
  const p0 = await project()
  const d = p0.work.drafts.filter((x) => x.status === 'draft').sort((a, b) => a.ep - b.ep)[0]
  if (!d) throw new Error('需要一份可编辑的草稿')
  const li = d.lines.findIndex((l) => l.kind === 'dialogue')
  await patchStored(`(p) => { const x = p.work.drafts.find((y) => y.id === '${d.id}'); x.lines[${li}].zh = '我不禁仿佛想起了那一夜。' }`, projectPath + '/stage/script/draft/' + d.id)
  await waitFor(`[...document.querySelectorAll('main button')].some((b) => b.textContent.trim() === 'AI 润色')`, '草稿页的 AI 润色')
  const order = await evaluate(`(() => {
    const labels = [...document.querySelectorAll('main .relative.z-40 button')].filter((b) => !b.closest('.relative.z-40 .min-w-0.flex-1')).map((b) => b.textContent.trim())
    return ['重新生成', 'AI 润色', 'AI 审稿', 'AI 修稿', '定稿'].map((x) => labels.findIndex((l) => l === x || l.startsWith(x)))
  })()`)
  if (order.some((i) => i < 0) || order.some((v, i) => i && v <= order[i - 1])) throw new Error('按钮顺序不对：' + order)
  await t(`__t.click('main button', 'AI 润色')`)
  await waitFor(`document.querySelector('[data-polish-diff]')`, '润色前后对比', 5000)
  if (!(await evaluate(`document.querySelector('[data-polish-diff]').innerText.includes('我不禁仿佛想起了那一夜。')`))) throw new Error('对比里应有改动的那一行')
  // 只改真有问题的行：没有 AI 味词、标点也没毛病的台词不动（不会只为去掉句末句号改一遍）
  const onlyPeriod = await evaluate(`[...document.querySelectorAll('[data-polish-diff] [data-fix-diff=edit]')].map((li) => [...li.querySelectorAll('.min-w-0 > div')].slice(1).map((x) => x.textContent)).filter(([a, b]) => b && a === b + '。').length`)
  if (onlyPeriod) throw new Error('整集润色不应只为去掉句末句号改行：' + onlyPeriod + ' 行')
  await sleep(150)
  await shot('draft-polish')
  await t(`__t.click('[role=dialog] button', '采用')`)
  await waitFor(`!JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').work.drafts.find((x) => x.id === '${d.id}').lines[${li}].zh.includes('不禁')`, '采用后写进正文')
  await until(`[...document.querySelectorAll('[data-toast-action]')].some((b) => b.textContent === '撤销')`, '可撤销')
  await evaluate(`[...document.querySelectorAll('[data-toast-action]')].at(-1).click()`)
  await waitFor(`JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').work.drafts.find((x) => x.id === '${d.id}').lines[${li}].zh === '我不禁仿佛想起了那一夜。'`, '撤销后恢复')
  const fin = await evaluate(`[...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === '定稿')?.title ?? ''`)
  if (!d.reviews.length && !fin.includes('没审稿也能直接定稿')) throw new Error('定稿按钮应说明审稿可以跳过：' + fin)
  // 设定段：世界观设定
  await patchStored(`(p) => { p.work.architecture.world = '故事发生在 北美小镇 ,狼族林立。' }`, projectPath + '/stage/architecture')
  await t(`__t.click('button', '修改故事架构')`)
  await waitFor(`document.querySelector('[data-polish=世界观设定]')`, '世界观设定的 AI 润色')
  await evaluate(`document.querySelector('[data-polish=世界观设定]').click()`)
  await waitFor(`document.querySelector('[data-polish-preview]')`, '设定润色对比', 5000)
  await t(`__t.click('[role=dialog] button', '采用')`)
  await waitFor(`JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').work.architecture.world === '故事发生在北美小镇，狼族林立。'`, '润色后写回')
  await goto(projectPath + '/stage/outline')
  await waitFor(`document.querySelector('[data-polish^="第 "]')`, '集纲旁的 AI 润色')
  await patchStored(`(p) => { p.work.drafts = ${JSON.stringify(p0.work.drafts)}; p.work.architecture = ${JSON.stringify(p0.work.architecture)} }`, projectPath)
})

await check('必做 / 可跳过：每一步页头标明能不能跳；题材下拉分组并排、可直接去掉已选', async () => {
  await goto(projectPath + '/stage/architecture')
  await waitFor(`document.querySelector('[data-stage-need=must] [title]')?.title.includes('只有核心设定必填')`, '故事架构必做，只有核心设定必填')
  await goto(projectPath + '/stage/outline')
  await waitFor(`document.querySelector('[data-stage-need=quick]')?.innerText.includes('必做 · 可一键')`, '情节大纲必做可一键')
  await goto(projectPath + '/stage/architecture')
  await evaluate(`document.querySelectorAll('[aria-haspopup=listbox]')[0].click()`)
  await waitFor(`document.querySelector('[role=listbox]')`, '题材下拉')
  const cols = await evaluate(`document.querySelectorAll('[role=listbox] [data-group]').length`)
  if (cols < 3) throw new Error('题材类型应分组：' + cols)
  if (!(await evaluate(`document.querySelector('[role=listbox]').innerText.includes('已选')`))) throw new Error('下拉顶部显示已选几个')
  await sleep(150)
  await shot('genre-dropdown')
  await evaluate(`document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`)
  await waitFor(`!document.querySelector('[role=listbox]')`, '下拉收起')
  const g0 = (await project()).genres
  const n = g0.length
  await evaluate(`document.querySelector('[aria-haspopup=listbox] [aria-label^=去掉]').click()`)
  await waitFor(`JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').genres.length === ${n - 1}`, '点 × 去掉一个')
  if (await evaluate(`!!document.querySelector('[role=listbox]')`)) throw new Error('点 × 不应打开下拉')
  await patchStored(`(p) => { p.genres = ${JSON.stringify(g0)} }`, projectPath)
})

/* --------------------------------- 流程引导 --------------------------------- */

const btnClass = (label, scope = 'document') => `([...${scope}.querySelectorAll('button')].find((b) => b.textContent.trim() === '${label}')?.className ?? '')`
/** 元素顶部已滚到视口上部；最后一个板块不够长时，滚到底且已露出也算 */
const nearTop = (sel) => `(() => {
  const r = document.querySelector('${sel}')?.getBoundingClientRect()
  if (!r) return false
  if (r.top > -20 && r.top < 260) return true
  const m = document.querySelector('main')
  return m.scrollHeight - m.clientHeight - m.scrollTop < 2 && r.top < innerHeight - 120
})()`

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
  for (const s of ['剧情节点', '触发', '真相揭晓', '角色动态', '埃琳娜', '起了疑心']) if (!text.includes(s)) throw new Error('本集要点页缺少 ' + s)
  if (text.includes('伏笔推进候选')) throw new Error('本集要点不应有伏笔推进候选')
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

await check('页面底部不再有「版本二 · 交互优化 / 改动说明」：底部条只放环节的状态和操作，比原来高一倍；没东西的页面不显示（11/4 标注 #73 #75）', async () => {
  await goto(projectPath)
  await until(`__t.has('环节完成')`, '默认版本二导航')
  if (await evaluate(`!!document.querySelector('[aria-label=界面版本]') || document.body.innerText.includes('版本二 · 交互优化') || [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '改动说明')`)) throw new Error('底部不应再有版本二 · 交互优化 / 改动说明')
  const home = await evaluate(`({ h: document.querySelector('[data-bottom-slot]').offsetHeight, v: getComputedStyle(document.documentElement).getPropertyValue('--bottom-bar').trim() })`)
  if (home.h !== 0 || home.v !== '0px') throw new Error('概览没有环节操作，底部条应隐藏：' + JSON.stringify(home))
  await goto(projectPath + '/stage/outline')
  await waitFor(`document.querySelector('[data-bottom-slot] [data-stage-bar]')`, '环节条')
  const bar = await evaluate(`(() => { const b = document.querySelector('[data-bottom-slot]'); const r = b.getBoundingClientRect(); const first = b.querySelector('[data-stage-bar] a, [data-stage-bar] button, [data-stage-bar] span'); return { h: r.height, left: first.getBoundingClientRect().left - r.left, v: getComputedStyle(document.documentElement).getPropertyValue('--bottom-bar').trim() } })()`)
  if (bar.h < 96 || bar.left > 40 || bar.v !== bar.h + 'px') throw new Error('环节条应高 96、状态靠左，并写进 --bottom-bar：' + JSON.stringify(bar))
  // 11/4 标注 #83：按钮一律靠右，「去下一步」在最右
  const next = await evaluate(`(() => { const r = document.querySelector('[data-bottom-slot]').getBoundingClientRect(); const a = document.querySelector('[data-bottom-slot] [data-stage-next]'); return a && { right: r.right - a.getBoundingClientRect().right, inActions: !!a.closest('[data-stage-actions]') } })()`)
  if (!next || next.right > 40 || !next.inActions) throw new Error('去下一步应在底部条最右：' + JSON.stringify(next))
})

await check('导航显示环节状态与进度；概览「继续工作」指到具体的集，「待处理」汇总且不重复，可标记已处理并恢复', async () => {
  // 第 7 集只留一份还没审过的草稿
  await patchStored(`async (p) => {
    const { writeEpisode } = await import('/src/services/mock/writer.ts')
    const d = writeEpisode(p, 7, 0)
    const at = new Date().toISOString()
    p.work.drafts = p.work.drafts.filter((x) => x.ep !== 7)
    p.work.blueprints = p.work.blueprints.filter((x) => x.ep !== 7)
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

await check('草稿页按审稿状态推荐主操作——未审 → 审稿，审完 → 修稿或定稿', async () => {
  const advice = `(document.querySelector('[data-v2=advice]')?.innerText ?? '')`
  await waitFor(`${advice}.includes('建议下一步：AI 审稿')`, '建议审稿')
  if (!(await evaluate(`${btnClass('AI 审稿')}.includes('bg-brand-600')`))) throw new Error('AI 审稿应为主按钮')
  if (!(await evaluate(`${btnClass('AI 修稿')}.includes('bg-white')`))) throw new Error('AI 修稿应为次按钮')
  if (!(await evaluate(`${btnClass('定稿')}.includes('border-emerald-300')`))) throw new Error('定稿应降为描边按钮')
  // 单集流程步骤条 11/5 标注 #90 全局删掉：草稿页只剩「建议下一步」
  if (await evaluate(`!!document.querySelector('ol[aria-label$=集流程]')`)) throw new Error('单集流程步骤条应已删掉')
  await sleep(200)
  await shot('v2-draft')
  await t(`__t.click('button', 'AI 审稿')`)
  await waitFor(`document.querySelector('[data-review-detail]')`, '审稿报告', 6000)
  const d = (await project()).work.drafts.find((x) => x.id === 'v2-draft-7')
  const block = d.reviews.at(-1).items.filter((i) => i.level === 'block').length
  await waitFor(`${advice}.includes('建议下一步：${block ? 'AI 修稿' : '定稿'}')`, '审完后的建议')
  if (block ? !(await evaluate(`${btnClass('AI 修稿')}.includes('bg-brand-600')`)) : !(await evaluate(`${btnClass('定稿')}.includes('bg-emerald-600')`))) throw new Error('主按钮没随建议切换')
})

await check('定稿后在正文页接力写下一集；下一集没存过蓝图时按预填直接写，写的时候把预填的蓝图存下来（11/5 标注 #89）', async () => {
  await t(`__t.click('button', '定稿')`)
  await waitFor(`location.pathname === '${projectPath}/stage/script/final/7'`, '定稿后到正文', 6000)
  const relay = `(document.querySelector('[data-v2=relay]')?.innerText ?? '')`
  await waitFor(`${relay}.includes('接着写第 8 集')`, '接力写第 8 集')
  if ((await project()).work.blueprints.some((b) => b.ep === 8)) throw new Error('第 8 集应还没存蓝图')
  if (await evaluate(`${relay}.includes('去逐集蓝图处理')`)) throw new Error('有集纲就能按预填写，不应再被「没有蓝图」拦下')
  await waitFor(`[...document.querySelectorAll('[data-v2=relay] button')].some((b) => b.textContent.includes('写第 8 集'))`, '可直接写下一集')
  await sleep(200)
  await shot('v2-relay')
  await t(`__t.click('[data-v2=relay] button', '写第 8 集')`)
  await waitFor(`location.pathname.startsWith('${projectPath}/stage/script/draft/')`, '写完进草稿', 8000)
  const p8 = await project()
  if (!p8.work.drafts.some((x) => x.ep === 8)) throw new Error('第 8 集草稿未生成')
  const bp8 = p8.work.blueprints.find((b) => b.ep === 8)
  const o8 = p8.work.outline.find((x) => x.ep === 8)
  if (!bp8 || bp8.conflict !== o8.event || bp8.hook !== o8.hookLine) throw new Error('写作时应把按集纲预填的蓝图存下来：' + JSON.stringify(bp8))
})

await check('单集流程步骤条全局删掉（11/5 标注 #90），逐集蓝图列表的进度点还在；选中的一集可单独重新生成蓝图', async () => {
  if (await evaluate(`!!document.querySelector('ol[aria-label$=集流程]')`)) throw new Error('草稿页不应再有单集流程步骤条')
  await goto(projectPath + '/stage/script?ep=8')
  await waitFor(`[...document.querySelectorAll('h3')].some((h) => h.textContent.startsWith('第 8 集'))`, '选中第 8 集')
  if (await evaluate(`!!document.querySelector('ol[aria-label$=集流程]')`)) throw new Error('逐集蓝图页不应再有单集流程步骤条')
  if (!(await evaluate(`[...document.querySelectorAll('[data-bp-list] > li')].every((li) => li.querySelector('[aria-label^="当前："], [aria-label=已定稿]'))`))) throw new Error('逐集蓝图列表的单集进度点应还在')
  const before = (await project()).work.blueprints.find((b) => b.ep === 8)
  await t(`__t.click('main button', '重新生成本集蓝图')`)
  await waitFor(dialog('重新生成第 8 集蓝图？'), '蓝图确认')
  await t(`__t.click('[role=dialog] button', '重新生成')`)
  // 写作时存下的预填蓝图本来就有定位、没有承接：等 AI 写好承接、按钮停下才算生成完
  await waitFor(`!!JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').work.blueprints.find((b) => b.ep === 8).carry?.trim() && [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === '重新生成本集蓝图')?.disabled === false`, '第 8 集蓝图已重新生成', 5000)
  const after = (await project()).work.blueprints
  if (after.find((b) => b.ep === 8).guidance !== before.guidance) throw new Error('作者微操指导应保留')
  await sleep(200)
  await shot('script-blueprint-regenerate')
})

await check('逐集蓝图：本集定位、主角小目标、作者微操指导删掉（11/4 第五轮标注 #64 #65 #67），写作和写作前检查也不再读作者微操指导', async () => {
  await waitFor(`[...document.querySelectorAll('h3')].some((h) => h.textContent.startsWith('第 8 集'))`, '选中第 8 集')
  if (await evaluate(`!!document.querySelector('textarea[aria-label=作者微操指导], input[placeholder="这一集主角最想做成的一件事"]') || [...document.querySelectorAll('main label, main span')].some((e) => /^(本集定位|主角小目标|作者微操指导)/.test(e.textContent.trim()))`)) throw new Error('本集定位、主角小目标、作者微操指导应已删掉')
  if (await t(`__t.has('有指导') || __t.has('作者微操') || __t.has('小目标')`)) throw new Error('页面上不应再提作者微操指导、小目标')
  if (!(await evaluate(`!!document.querySelector('input[placeholder="主角、反派、关键配角"]')`))) throw new Error('出场关键人应还在')
  const r = await evaluate(`(async () => {
    const p = JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((x) => x.id === '${projectId}')
    const b = p.work.blueprints.find((x) => x.ep === 8)
    b.guidance = '我想在这集加入一个意外的背叛'
    const d = (await import('/src/services/mock/writer.ts')).writeEpisode(p, 8, 0)
    const checks = (await import('/src/domain/state.ts')).preWriteCheck(p, 8)
    return { wrote: d.lines.some((l) => l.zh.includes('意外的背叛')), checks: checks.map((c) => c.text).join('|') }
  })()`)
  if (r.wrote || r.checks.includes('作者微操指导')) throw new Error('写作和写作前检查不应再读作者微操指导：' + JSON.stringify(r))
})
await check('逐集蓝图：本集卡片头有「查看本集」与「去写第 N 集」；批量写作可选集数范围', async () => {
  await waitFor(`[...document.querySelectorAll('h3')].some((h) => h.textContent.startsWith('第 8 集'))`, '选中第 8 集')
  const head = `document.querySelector('[data-ep-head]')`
  const headText = await evaluate(`${head}.innerText`)
  if (!headText.includes('查看本集') || !headText.includes('去写第 8 集')) throw new Error('本集卡片头缺按钮：' + headText)
  if (await t(`[...document.querySelectorAll('main button')].filter((b) => b.textContent.includes('去写第')).length !== 1`)) throw new Error('写作按钮应只在本集卡片头')
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
  // 本集卡片头的按钮排在一行
  const tops = await evaluate(`[...document.querySelectorAll('[data-ep-head] > div:last-child button')].map((b) => Math.round(b.getBoundingClientRect().top))`)
  if (new Set(tops).size !== 1) throw new Error('本集卡片头按钮折行了：' + tops)
  await sleep(200)
  await shot('script-stage-head')
  await t(`__t.click('main button', '查看本集')`)
  await waitFor(`['/stage/script/draft/', '/stage/script/final/'].some((k) => location.pathname.includes(k))`, '查看本集打开草稿或正文')
  await goto(projectPath + '/stage/script?ep=8')
  await waitFor(`document.querySelector('textarea[aria-label=承接]')`, '回到第 8 集蓝图')
})

await check('「去写第 N 集」不走 AI（11/5 标注 #93）：没有换模型的 ▾，点了新建一版草稿，按本集蓝图列好开头承接和末尾钩子，标「自己写」，不记模型', async () => {
  const before = await project()
  await goto(projectPath + '/stage/script?ep=8')
  const go = `[...document.querySelectorAll('[data-ep-head] button')].find((b) => b.textContent.trim() === '去写第 8 集')`
  await waitFor(`${go} && !${go}.disabled`, '「去写第 8 集」')
  if (await evaluate(`!!document.querySelector('[data-ep-head] button[aria-label=换个模型写作]') || [...document.querySelectorAll('[data-ep-head] button')].some((b) => b.textContent.includes('写作第'))`)) throw new Error('本集卡片头不应再有 AI 写作按钮和换模型的 ▾')
  if (!(await evaluate(`${go}.title.includes('不用 AI')`))) throw new Error('「去写」的提示应说明不用 AI')
  await evaluate(`${go}.click()`)
  await waitFor(`location.pathname.startsWith('${projectPath}/stage/script/draft/')`, '打开自己写的草稿')
  const after = await project()
  const d = after.work.drafts.find((x) => !before.work.drafts.some((y) => y.id === x.id))
  if (!d || d.ep !== 8 || !d.manual || d.model) throw new Error('应新建一版自己写的第 8 集草稿，不记模型：' + JSON.stringify(d && { ep: d.ep, manual: d.manual, model: d.model }))
  const bp = after.work.blueprints.find((b) => b.ep === 8)
  if (d.lines[0].kind !== 'scene' || d.lines[0].zh !== '' || !/^△（(接上集|承接)）/.test(d.lines[1].zh) || d.lines.at(-1).kind !== 'hook' || d.lines.at(-1).zh !== bp.hook.trim()) throw new Error('应按本集蓝图列好架子：' + JSON.stringify(d.lines.map((l) => [l.kind, l.zh.slice(0, 16)])))
  await waitFor(`document.querySelector('[data-draft-model]')?.textContent.trim() === '自己写'`, '草稿页标「自己写」')
  if (!(await evaluate(`(() => { const box = document.querySelector('textarea[aria-label="第 1 段"]'); return !!box && !box.readOnly })()`))) throw new Error('自己写的草稿应能直接编辑')
  await patchStored(`(p) => { p.work.drafts = ${JSON.stringify(before.work.drafts)}; p.work.blueprints = ${JSON.stringify(before.work.blueprints)} }`, projectPath + '/stage/script?ep=8')
})
await check('伏笔已删：逐集蓝图的承接没有「接住前文埋点」，审稿范围、质检一致性、下游依据、写作要求都不提伏笔', async () => {
  await goto(projectPath + '/stage/script?ep=8')
  await waitFor(`[...document.querySelectorAll('h3')].some((h) => h.textContent.startsWith('第 8 集')) && document.querySelector('textarea[aria-label=承接]')`, '第 8 集蓝图')
  if (await evaluate(`!!document.querySelector('[data-carry-foreshadows]')`)) throw new Error('承接里不应再列伏笔')
  if (await t(`__t.has('前几集埋下')`)) throw new Error('承接的说明不应再提伏笔')
  const r = await evaluate(`(async () => {
    const p = JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((x) => x.id === '${projectId}')
    const review = await import('/src/domain/review.ts')
    const pipeline = await import('/src/domain/pipeline.ts')
    const basis = await import('/src/domain/basis.ts')
    const chain = await import('/src/services/mock/chain.ts')
    return {
      scope: review.reviewScope(true).map((x) => x.label + x.covers).join(' '),
      qa: pipeline.QA_CHECKS.find((c) => c.key === 'consistency'),
      down: ['episode', 'blueprint', 'write', 'review'].map((k) => basis.downBasis(p, k)),
      rules: chain.draftArchItem(p, 'writingRules').text,
    }
  })()`)
  if (r.scope.includes('伏笔')) throw new Error('审稿范围不应再有伏笔：' + r.scope)
  if (r.qa.desc.includes('伏笔')) throw new Error('质检一致性不应再提伏笔：' + JSON.stringify(r.qa))
  if (r.down.some((row) => [...row.must, ...row.focus, ...row.light].some((x) => x.startsWith('伏笔计划')))) throw new Error('下游依据不应再列伏笔计划')
  if (r.rules.includes('伏笔')) throw new Error('全局写作要求不应再写伏笔：' + r.rules)
})
await check('逐集蓝图：写作前检查在状态库的「检查」标签页；每一集都已列出，「+」确认后加一集', async () => {
  await goto(projectPath + '/stage/script?ep=8')
  await waitFor(`[...document.querySelectorAll('h3')].some((h) => h.textContent.startsWith('第 8 集'))`, '选中第 8 集')
  // 11/5 标注 #92：本集标题下的「修改自动保存 · 检查通过」删掉，写作前检查从状态库的「检查」标签页看
  if (await evaluate(`!!document.querySelector('[data-ep-head] [data-open-checks]') || document.querySelector('[data-ep-head]').innerText.includes('修改自动保存')`)) throw new Error('本集标题下的「修改自动保存 · 检查」应已删掉')
  const wasOpen = await evaluate(`!!document.querySelector('aside[aria-label=剧本状态库]')`)
  if (await evaluate(`[...document.querySelectorAll('main *')].some((e) => !e.closest('aside') && e.textContent.trim().startsWith('写作前检查 · '))`)) throw new Error('页面里不应再有写作前检查卡片')
  if (!wasOpen) await evaluate(`document.querySelector('[aria-label=展开剧本状态库]').click()`)
  await waitFor(`[...document.querySelectorAll('aside [role=tab]')].some((b) => b.textContent.includes('检查'))`, '状态库的「检查」标签')
  await t(`__t.click('aside [role=tab]', '检查')`)
  await waitFor(`document.querySelector('[data-panel-tab=checks]')?.innerText.includes('写作前检查 · 第 8 集')`, '侧栏「检查」里的写作前检查')
  await sleep(200)
  await shot('script-checks-tab')
  await t(`__t.click('aside [role=tab]', '状态库')`)
  if (!wasOpen) await evaluate(`document.querySelector('[aria-label=收起剧本状态库]').click()`)
  // 每一集都已列出：「+」确认后总集数加一，新的一集没有集纲，标「待集纲」、按人物设定预填（不存蓝图）
  const before = await project()
  const total = before.spec.totalEpisodes
  const plus = `document.querySelector('button[aria-label=新增一集蓝图]')`
  await waitFor(`${plus} && !${plus}.disabled && ${plus}.title.includes('加第 ${total + 1} 集')`, '「+」说明会加第 N+1 集')
  await evaluate(`${plus}.click()`)
  await waitFor(dialog(`加第 ${total + 1} 集？`), '加集先确认')
  await t(`__t.click('[role=dialog] button', '加到 ${total + 1} 集')`)
  await waitFor(`JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').spec.totalEpisodes === ${total + 1}`, '总集数加一')
  await waitFor(`[...document.querySelectorAll('h3')].some((h) => h.textContent.startsWith('第 ${total + 1} 集'))`, '选中新加的一集')
  if ((await evaluate(`document.querySelectorAll('[data-bp-list] > li').length`)) !== total + 1) throw new Error('列表应列出全部 ' + (total + 1) + ' 集')
  if (!(await evaluate(`document.querySelector('[data-bp-list] > li:last-child').innerText.includes('待集纲') && !!document.querySelector('[data-bp-no-outline]')`))) throw new Error('新加的一集没有集纲，应标「待集纲」并提示去情节大纲')
  if ((await project()).work.blueprints.some((b) => b.ep === total + 1)) throw new Error('新加的一集是预填的，不应存蓝图')
  await patchStored(`(p) => { p.spec = ${JSON.stringify(before.spec)}; p.rhythm = ${JSON.stringify(before.rhythm)}; p.work.blueprints = ${JSON.stringify(before.work.blueprints)} }`, projectPath + '/stage/script?ep=8')
  await waitFor(`[...document.querySelectorAll('h3')].some((h) => h.textContent.startsWith('第 8 集'))`, '恢复')
})

await check('逐集蓝图（11/5 标注 #89）：「分集蓝图」改名「逐集蓝图」；每一集都列出来，没存过的按集纲和人物设定预填，改了才存；恢复预填回到跟着集纲走，本集要点保留', async () => {
  const before = await project()
  const o = before.work.outline.filter((x) => !before.work.blueprints.some((b) => b.ep === x.ep) && !before.work.drafts.some((d) => d.ep === x.ep)).at(-1)
  if (!o) throw new Error('应有存了集纲、没存蓝图的集')
  const reset = `document.querySelector('[data-ep-head] button[aria-label=恢复预填]')`
  const stored = `JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').work.blueprints.find((b) => b.ep === ${o.ep})`
  await goto(projectPath + '/stage/script?ep=' + o.ep)
  await waitFor(`[...document.querySelectorAll('h3')].some((h) => h.textContent.startsWith('第 ${o.ep} 集'))`, '选中没存蓝图的一集')
  if ((await t(`__t.has('分集蓝图')`)) || !(await t(`__t.has('逐集蓝图')`))) throw new Error('「分集蓝图」应改名为「逐集蓝图」')
  if ((await evaluate(`document.querySelectorAll('[data-bp-list] > li').length`)) !== before.spec.totalEpisodes) throw new Error('每一集都应列出来')
  const form = await evaluate(`({ title: document.querySelector('input[placeholder=本集标题]').value, cast: document.querySelector('input[placeholder="主角、反派、关键配角"]').value, conflict: document.querySelector('textarea[placeholder="谁阻碍主角、怎么升级、在哪里反转"]').value, hook: document.querySelector('textarea[placeholder="最后 10 秒留什么让观众点下一集"]').value })`)
  if (form.title !== o.title || form.conflict !== o.event || form.hook !== o.hookLine) throw new Error('应按集纲预填标题、冲突、钩子：' + JSON.stringify(form))
  const hero = before.work.characters.find((c) => c.role === '主角')?.name
  if (hero && !form.cast.startsWith(hero)) throw new Error('出场关键人应按人物设定先列主角：' + form.cast)
  if (await evaluate(reset)) throw new Error('还是预填的集不应有「恢复预填」')
  if (await evaluate(`!!${stored}`)) throw new Error('只是看不应存蓝图')
  // 改一项：连同预填的内容一起存下来
  await t(`__t.type(document.querySelector('textarea[placeholder="最后 10 秒留什么让观众点下一集"]'), 'e2e 手改钩子')`)
  await waitFor(`${stored}?.hook === 'e2e 手改钩子'`, '改了就存')
  const saved = (await project()).work.blueprints.find((b) => b.ep === o.ep)
  if (saved.conflict !== o.event || saved.title !== o.title) throw new Error('存下来的应带上预填的内容：' + JSON.stringify(saved))
  // 恢复预填：有本集要点的按预填重写一份，要点保留
  await patchStored(`(p) => { p.work.blueprints.find((b) => b.ep === ${o.ep}).points = 'e2e 要点' }`, projectPath + '/stage/script?ep=' + o.ep)
  await waitFor(reset, '存过的集有「恢复预填」')
  await evaluate(`${reset}.click()`)
  await waitFor(dialog(`第 ${o.ep} 集蓝图恢复预填？`), '恢复预填先确认')
  await t(`__t.click('[role=dialog] button', '恢复预填')`)
  await waitFor(`${stored}?.hook === ${JSON.stringify(o.hookLine)}`, '钩子恢复成集纲的')
  if ((await project()).work.blueprints.find((b) => b.ep === o.ep).points !== 'e2e 要点') throw new Error('恢复预填应保留本集要点')
  // 没有要点的：恢复预填后不再存，回到跟着集纲走的预填
  await patchStored(`(p) => { p.work.blueprints.find((b) => b.ep === ${o.ep}).points = '' }`, projectPath + '/stage/script?ep=' + o.ep)
  await waitFor(reset, '存过的集有「恢复预填」')
  await evaluate(`${reset}.click()`)
  await waitFor(dialog(`第 ${o.ep} 集蓝图恢复预填？`), '恢复预填先确认')
  await t(`__t.click('[role=dialog] button', '恢复预填')`)
  await waitFor(`!${stored}`, '回到预填，不再存')
  await waitFor(`!${reset}`, '回到预填后没有「恢复预填」')
  await patchStored(`(p) => { p.work.blueprints = ${JSON.stringify(before.work.blueprints)} }`, projectPath + '/stage/script?ep=8')
})
await check('逐集蓝图：一键定稿——列出每集最新的草稿，审过且没问题的默认勾上，有严重问题的不能选；确认后按集号定稿', async () => {
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

await check('批量写作：整批用开写时的文本模型；中途在页头换模型先确认——本批仍用原模型写完，或停止本批再换；换模型的提示可撤销', async () => {
  const before = await project()
  const path = projectPath + '/stage/script?ep=8'
  // 从第一个没写的集起连写 3 集：补上缺的蓝图，免得被写作前检查拦下
  await patchStored(`async (p) => {
    const { draftBlueprints } = await import('/src/services/mock/writer.ts')
    const { nextUnwritten } = await import('/src/pages/workspace/script/ops.ts')
    const n = nextUnwritten(p)
    for (let ep = n; ep <= n + 2; ep++) if (!p.work.blueprints.some((b) => b.ep === ep)) p.work.blueprints.push(...draftBlueprints(p, ep, ep, 0))
    p.models = {}
  }`, path)
  const from = `document.querySelector('input[aria-label=批量写作起始集]')`
  const to = `document.querySelector('input[aria-label=批量写作结束集]')`
  const textHead = `document.querySelector('[data-models] [data-model-pick=text]')`
  await waitFor(`${from} && ${textHead}`, '批量写作与页头文本模型')
  const next = Number(await evaluate(`${from}.value`))
  const batchDrafts = async () => (await project()).work.drafts.filter((d) => d.ep >= next && d.ep <= next + 2 && !before.work.drafts.some((x) => x.id === d.id))
  const runBatch = async () => {
    await t(`__t.type(${to}, '${next + 2}')`)
    await t(`__t.enter(${to})`)
    await waitFor(`${from}.value === '${next}' && ${to}.value === '${next + 2}'`, '批量写作范围')
    await t(`__t.click('main button', '批量写作')`)
    await until(`__t.find('main button', '正在写第')`, '批量写作开始')
  }
  const pickText = async (label) => {
    await evaluate(`${textHead}.click()`)
    await waitFor(`document.querySelector('[role=menu]')?.innerText.includes('文本模型')`, '文本模型菜单')
    await t(`__t.click('[role=menu] [role=menuitem]', '${label}')`)
  }
  await runBatch()
  // 写作中打开页头的文本模型：菜单顶部写明本批用哪个模型写完
  await evaluate(`${textHead}.click()`)
  await waitFor(`document.querySelector('[role=menu] [data-model-note]')?.textContent.includes('批量写作进行中')`, '菜单提示批量写作进行中')
  const note = await evaluate(`document.querySelector('[role=menu] [data-model-note]').textContent`)
  if (!note.includes('本批用 豆包 写完')) throw new Error('菜单应写明本批用哪个模型写完：' + note)
  await t(`__t.click('[role=menu] [role=menuitem]', 'Kimi')`)
  await waitFor(dialog('批量写作还在进行'), '换模型先确认')
  const desc = await evaluate(`document.querySelector('[role=dialog]').innerText`)
  if (!desc.includes('本批剩下的集仍用 豆包 写完') || !desc.includes('停止本批并换')) throw new Error('确认框应说明本批怎么办：' + desc)
  await sleep(150)
  await shot('batch-model-confirm')
  await evaluate(`document.querySelector('[data-batch-keep]').click()`)
  await waitFor(`!document.querySelector('[role=dialog]')`, '关闭确认')
  if ((await project()).models?.text !== 'kimi') throw new Error('确认后项目的文本模型应改为 Kimi')
  await until(`__t.has('本批剩下的集仍用 豆包 写完')`, '提示写明本批仍用豆包写完')
  // 本批 3 集都用开写时的豆包写完
  await until(`!__t.find('main button', '正在写第')`, '批量写作写完', 15000)
  await until(`__t.has('已用 豆包 写出 3 集草稿')`, '写完的提示写明模型')
  const kept = await batchDrafts()
  if (kept.length !== 3 || kept.some((d) => d.model !== 'doubao')) throw new Error('本批应全部用开写时的豆包写：' + kept.map((d) => d.ep + ':' + d.model))
  // 停止本批并换：本批停下，已写出的草稿保留，项目改用新模型
  await patchStored(`(p) => { p.work.drafts = ${JSON.stringify(before.work.drafts)} }`, path)
  await waitFor(`${from} && ${from}.value === '${next}'`, '恢复到没写的集')
  await runBatch()
  await pickText('DeepSeek')
  await waitFor(dialog('批量写作还在进行'), '换模型先确认')
  if (!(await evaluate(`document.querySelector('[role=dialog]').innerText.includes('正在用 Kimi 写')`))) throw new Error('第二批应用开写时的 Kimi')
  await evaluate(`document.querySelector('[data-batch-stop]').click()`)
  await until(`!__t.find('main button', '正在写第')`, '本批已停止')
  if ((await project()).models?.text !== 'deepseek') throw new Error('停止本批后项目应改用 DeepSeek')
  if (await t(`__t.has('本批剩下的集仍用 Kimi')`)) throw new Error('停止本批后提示不应再说本批仍用原模型写完')
  await sleep(1800)
  const stopped = await batchDrafts()
  if (stopped.length >= 3 || stopped.some((d) => d.model !== 'kimi')) throw new Error('停止后不应再写，已写出的仍是 Kimi：' + stopped.map((d) => d.ep + ':' + d.model))
  // 换模型的提示里可以撤销：改回换之前的 Kimi
  await pickText('GPT')
  await waitFor(`${textHead}.querySelector('[data-model-value]').textContent === 'GPT'`, '改为 GPT')
  await until(`[...document.querySelectorAll('[data-toast-action]')].some((b) => b.textContent === '撤销')`, '提示里的撤销')
  await sleep(150)
  await shot('model-undo-toast')
  await evaluate(`[...document.querySelectorAll('[data-toast-action]')].at(-1).click()`)
  await waitFor(`${textHead}.querySelector('[data-model-value]').textContent === 'DeepSeek'`, '撤销后改回 DeepSeek')
  if ((await project()).models?.text !== 'deepseek') throw new Error('撤销后应存回 DeepSeek')
  await patchStored(`(p) => { p.work.drafts = ${JSON.stringify(before.work.drafts)}; p.work.scripts = ${JSON.stringify(before.work.scripts)}; p.work.blueprints = ${JSON.stringify(before.work.blueprints)}; p.status = '${before.status}'; p.models = ${JSON.stringify(before.models ?? {})} }`, path)
  await waitFor(`[...document.querySelectorAll('h3')].some((h) => h.textContent.startsWith('第 8 集'))`, '恢复')
})

await check('批量写作在后台跑：离开逐集蓝图页也接着写，页头显示进度、可以停', async () => {
  const before = await project()
  const path = projectPath + '/stage/script?ep=8'
  await patchStored(`async (p) => {
    const { draftBlueprints } = await import('/src/services/mock/writer.ts')
    const { nextUnwritten } = await import('/src/pages/workspace/script/ops.ts')
    const n = nextUnwritten(p)
    for (let ep = n; ep <= n + 1; ep++) if (!p.work.blueprints.some((b) => b.ep === ep)) p.work.blueprints.push(...draftBlueprints(p, ep, ep, 0))
  }`, path)
  const from = `document.querySelector('input[aria-label=批量写作起始集]')`
  const to = `document.querySelector('input[aria-label=批量写作结束集]')`
  await waitFor(from, '批量写作')
  const next = Number(await evaluate(`${from}.value`))
  await t(`__t.type(${to}, '${next + 1}')`)
  await t(`__t.enter(${to})`)
  await waitFor(`${to}.value === '${next + 1}'`, '范围')
  await t(`__t.click('main button', '批量写作')`)
  await until(`__t.find('main button', '正在写第')`, '开始写')
  // 去概览：页头显示进度，写作没有停
  await t(`__t.click('a', '项目概览')`)
  await waitFor(`location.pathname === '${projectPath}' && document.querySelector('[data-batch-chip]')?.innerText.includes('批量写作第')`, '离开后页头显示进度')
  await sleep(150)
  await shot('batch-background')
  await waitFor(`!document.querySelector('[data-batch-chip]')`, '后台写完', 15000)
  const written = (await project()).work.drafts.filter((d) => d.ep >= next && d.ep <= next + 1 && !before.work.drafts.some((x) => x.id === d.id))
  if (written.length !== 2) throw new Error('离开页面后应把 2 集都写完：' + written.map((d) => d.ep))
  await patchStored(`(p) => { p.work.drafts = ${JSON.stringify(before.work.drafts)}; p.work.blueprints = ${JSON.stringify(before.work.blueprints)}; p.status = '${before.status}' }`, path)
})

await check('逐集蓝图：末尾钩子前有「承接」，AI 生成时接上集结尾；草稿页侧栏「本集蓝图」按顺序显示', async () => {
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

await check('质检「去改正文」带着问题过去，问题行高亮；标记已处理后回到原来那一集', async () => {
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

await check('环节说明默认折叠；环节完成后「去下一步」在页面底部的环节条里（11/4 标注 #74）', async () => {
  await goto(projectPath + '/stage/characters')
  await waitFor(`document.querySelector('[data-bottom-slot] [data-stage-bar]')?.innerText.includes('人物设定已完成') && document.querySelector('[data-bottom-slot] [data-stage-next=outline]')`, '底部环节条的去情节大纲')
  if (await evaluate(`!!document.querySelector('[data-v2=next-stage]')`)) throw new Error('页头不应再有下一步条')
  const summary = '缺陷与弧光，以及人物关系'
  if (await t(`__t.has('${summary}')`)) throw new Error('环节说明应默认折叠')
  await t(`__t.click('button', '环节说明')`)
  await until(`__t.has('${summary}')`, '展开环节说明')
  await evaluate(`document.querySelector('[data-bottom-slot] [data-stage-next=outline]').click()`)
  await waitFor(`location.pathname === '${projectPath}/stage/outline'`, '去下一环节')
})

await check('故事架构确认前实时列出还差什么；状态条在页面底部的环节条里，滚到哪都在；确认后接「去人物设定」', async () => {
  await goto(projectPath + '/stage/architecture')
  await t(`__t.click('button', '修改故事架构')`)
  await until(`__t.has('必填项已填完，可以确认')`, '已填完提示')
  const saved = (await project()).work.architecture.mainLine[0].content
  const logline = (await project()).logline
  // 只有核心设定必填：冲突主线空着不算缺
  await patchStored(`(p) => { p.work.architecture.mainLine[0].content = ''; p.logline = '' }`, projectPath + '/stage/architecture')
  await until(`__t.has('确认前还差 1 项：核心设定未填写')`, '实时缺项')
  if (await t(`__t.has('冲突主线缺少')`)) throw new Error('冲突主线不是必填，不应列为缺项')
  const bar = await evaluate(`(() => { const b = document.querySelector('[data-arch-bar]'); const r = b.getBoundingClientRect(); return { docked: !!b.closest('[data-bottom-slot]'), bottom: innerHeight - r.bottom, next: !!document.querySelector('[data-stage-next]'), text: b.innerText, actions: document.querySelector('[data-bottom-slot] [data-stage-actions]')?.innerText ?? '' } })()`)
  if (!bar.docked || bar.bottom < 0 || bar.bottom > 120 || bar.next || !bar.text.includes('确认前还差') || !bar.actions.includes('确认故事架构')) throw new Error('状态条应在底部环节条里（状态靠左、按钮靠右），没确认前不给去下一步：' + JSON.stringify(bar))
  await evaluate(`document.querySelector('main').scrollTo(0, 0)`)
  await sleep(150)
  if (await evaluate(`(() => { const r = document.querySelector('[data-arch-bar]').getBoundingClientRect(); return r.bottom > innerHeight || r.top < innerHeight / 2 })()`)) throw new Error('滚到顶时状态条也应在视口底部')
  await sleep(200)
  await shot('v2-architecture')
  await patchStored(`(p) => { p.work.architecture.mainLine[0].content = ${JSON.stringify(saved)}; p.logline = ${JSON.stringify(logline)} }`, projectPath + '/stage/architecture')
  await until(`__t.has('必填项已填完，可以确认')`, '补回核心设定')
  await t(`__t.click('button', '确认故事架构')`)
  await waitFor(`JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').work.architecture.status === 'approved'`, '重新确认')
  await waitFor(`document.querySelector('[data-bottom-slot] [data-stage-next=characters]')`, '确认后底部接去人物设定')
})

await check('对标剧拆解：故事梗概 → 冲突主线 · 内容简介 → 人物设定；梗概按样例写世界观、金手指（不分类型，讲清能力）、核心亮点（期待值）、故事简介；冲突主线类比情节大纲，左边分段目录、右边段梗概和每集走向，一卡前逐场逐句拆出情绪转折和核心台词，可查看原文，节奏曲线可收起；人物参照人物设定，主角拆细；关系网有关系图；不逐块审核，板块跳转和一键引用在页面底部的环节条', async () => {
  await goto('/projects/demo-alpha/stage/breakdown')
  await t(`__t.click('button', '载入示例剧本')`)
  await t(`__t.click('button', '导入并切分')`)
  await until(`!!__t.find('button', '开始拆解')`, '导入')
  await t(`__t.click('button', '开始拆解')`)
  await until(`!!document.querySelector('[data-bottom-slot] [data-bd-bar]')`, '拆解完成', 12000)
  if (await evaluate(`[...document.querySelectorAll('button')].some((b) => /确认无误|取消确认|跳过逐块审核/.test(b.textContent)) || document.body.innerText.includes('审核进度')`)) throw new Error('不应再有逐块审核（11/4 标注 #76–#79）')
  if (await evaluate(`[...document.querySelectorAll('[data-bottom-slot] button')].find((b) => b.textContent.includes('一键引用'))?.disabled !== false`)) throw new Error('拆完就能一键引用')
  const blocks = await evaluate(`[...document.querySelectorAll('[id^=bd-block-]')].map((e) => e.id.slice(9)).join()`)
  if (blocks !== 'synopsis,mainline,characters') throw new Error('板块顺序不对：' + blocks)
  if (!(await evaluate(`document.querySelector('[data-stage-nav]')?.innerText.includes('待引用')`))) throw new Error('左侧导航应显示待引用')
  for (const f of ['世界观', '金手指', '核心亮点', '故事简介']) if (!(await evaluate(`!!document.querySelector('#bd-block-synopsis textarea[aria-label=${f}]')?.value.trim()`))) throw new Error('故事梗概缺少「' + f + '」')
  if (await evaluate(`!!document.querySelector('#bd-block-synopsis textarea[aria-label=期待值]') || !!document.querySelector('#bd-block-synopsis textarea[aria-label=核心梗概]')`)) throw new Error('期待值并进核心亮点，不再单独一栏')
  if (!(await evaluate(`document.querySelector('[data-synopsis=highlights]').innerText.includes('这里就是期待值')`))) throw new Error('核心亮点的说明应写明这里是期待值')
  const bd = (await projects()).find((p) => p.id === 'demo-alpha').work.breakdown
  const { synopsis: sy } = bd
  if ('expectation' in sy) throw new Error('期待值字段应删掉')
  if (!sy.world.startsWith('世界总览：') || !sy.world.includes('\n阵营设定：\n· ') || !sy.world.includes('\n主要地点：\n· ')) throw new Error('世界观应总分写：' + sy.world)
  if (/型）|型 \+|硬金手指/.test(sy.goldenFinger) || !['首次出现：', '核心能力：', '来历：', '能做到：', '条件与限制：', '表现方式：', '渐进释放：', '权威认证：', '与主线强相关：'].every((h) => sy.goldenFinger.includes(h))) throw new Error('金手指不分类型，核心能力每项讲清来历、能做到什么、条件与限制：' + sy.goldenFinger)
  if (!['核心爽点：你以为', '主线任务（前十集）：', '情感双线：', '子类型特征（'].every((h) => sy.highlights.includes(h))) throw new Error('核心亮点应按样例写：' + sy.highlights)
  if (sy.summary.includes('\n') || /开场前：|（第 \d/.test(sy.summary) || sy.summary.length < 200) throw new Error('故事简介应是一整段从头讲到尾：' + sy.summary)
  if (sy.coreSetup.split('。').filter(Boolean).length !== 1) throw new Error('核心设定应一句话：' + sy.coreSetup)
  if (bd.mainLine.some((b) => /第 \d+ 集/.test(b.content) || !b.content.trim())) throw new Error('冲突主线每段写梗概，不逐集列：' + JSON.stringify(bd.mainLine.map((b) => b.content)))
  const card = bd.rhythm.paywalls[0]
  if (!(card >= 2)) throw new Error('一卡不应落在第 1 集：' + card)
  if (bd.episodes.some((e) => !e.flow.trim() || 'relationChange' in e || 'newCharacters' in e || 'paywallMoment' in e)) throw new Error('每集应有走向，去掉新出场人物、关系变化、付费卡点位置')
  if (bd.episodes.some((e) => (e.ep <= card || e.paywall) !== e.scenes.length > 0) || bd.episodes.filter((e) => e.ep <= card).some((e) => e.scenes.some((s) => !s.scene || !s.action || !s.lines.length || !s.lines.some((b) => b.turn) || 'line' in s || 'turn' in s)) || bd.episodes.filter((e) => e.ep > card && e.paywall).some((e) => e.scenes.some((s) => !s.scene || !s.action || !s.lines.length) || !e.scenes.some((s) => s.lines.some((b) => b.turn)))) throw new Error('第 1 集到一卡（示例手写，每场都有转折）、之后的付费卡点集（按规则粗拆，整集至少一处转折）要逐场、逐句细拆，其余不拆：' + JSON.stringify(bd.episodes.map((e) => [e.ep, e.scenes.length])))
  if (bd.episodes[0].scenes[0].lines.filter((b) => b.turn).map((b) => b.emotion).join() !== '心碎,愤怒,盼反击,揪心') throw new Error('示例第 1 集应逐句标出情绪转折：' + JSON.stringify(bd.episodes[0].scenes[0].lines))
  // 11/4 第五轮标注 #68：首集拆前 3 秒、前 30 秒（主要动作和画面）、钩子；一卡拆卡点
  const e1 = bd.episodes[0]
  if (!e1.open3s?.trim() || (e1.open30s ?? '').split('\n').filter((l) => l.startsWith('· ')).length < 2 || !e1.endHook.trim()) throw new Error('首集应拆前 3 秒、前 30 秒和钩子：' + JSON.stringify(e1))
  if (bd.episodes.some((e) => (e.ep === card || e.paywall) !== !!e.cardPoint?.includes('卡在：'))) throw new Error('一卡和之后的付费卡点集拆卡点，其余不拆：' + JSON.stringify(bd.episodes.map((e) => [e.ep, e.cardPoint])))
  // 金手指不分类型（11/4 第二轮标注）
  if (await evaluate(`!!document.querySelector('[data-synopsis=goldenFinger] [data-gf-kinds]')`)) throw new Error('拆解的金手指去掉类型按钮')
  if (!(await evaluate(`document.querySelector('[data-synopsis=goldenFinger]').innerText.includes('最重要的是讲清金手指的能力是什么')`))) throw new Error('金手指说明应强调讲清能力')
  // 冲突主线 · 内容简介：类比情节大纲，左边分段目录，右边默认只显示一段
  const tree = await evaluate(`(() => { const b = document.querySelector('#bd-block-mainline'); const nav = b.querySelector('[data-bd-tree]'); return { nav: !!nav, sticky: nav && getComputedStyle(nav).position, links: b.querySelectorAll('[data-bd-phase-link]').length, phases: b.querySelectorAll('[data-phase]').length, left: nav && nav.getBoundingClientRect().right <= b.querySelector('[data-phase]').getBoundingClientRect().left + 1 } })()`)
  if (!tree.nav || tree.sticky !== 'sticky' || tree.links !== bd.mainLine.length || tree.phases !== 1 || !tree.left) throw new Error('冲突主线 · 内容简介应左边分段目录（吸顶）、右边一次一段：' + JSON.stringify(tree))
  await evaluate(`document.querySelector('[data-bd-phase-link="2"]').click()`)
  await waitFor(`document.querySelector('#bd-block-mainline [data-phase]')?.dataset.phase === '2'`, '点目录换段')
  await t(`__t.click('#bd-block-mainline button', '上一段')`)
  await waitFor(`document.querySelector('#bd-block-mainline [data-phase]')?.dataset.phase === '1'`, '上一段')
  await evaluate(`document.querySelector('[data-bd-ep-link="1"]').click()`)
  await waitFor(`document.querySelector('#bd-block-mainline [data-phase]')?.dataset.phase === '0' && !!document.querySelector('#bd-ep-1')`, '点目录里的集跳到那一集')
  const open = await evaluate(`(() => { const d = document.querySelector('#bd-ep-1 [data-bd-opening]'); return d ? [...d.querySelectorAll('textarea')].map((t) => t.getAttribute('aria-label') + (t.value.trim() ? '' : '（空）')).join() : '' })()`)
  if (open !== '首集前 3 秒,首集前 30 秒,首集钩子') throw new Error('首集应显示前 3 秒、前 30 秒、钩子：' + open)
  // 11/4 标注 #70：一集按左边一列栏名排，从上往下由粗到细；标题行只留集号、标签和查看原文
  const rows1 = await evaluate(`[...document.querySelectorAll('#bd-ep-1 dt')].map((d) => d.textContent).join()`)
  if (rows1 !== '走向,前 3 秒,前 30 秒,钩子,核心台词,逐场细拆') throw new Error('首集应按 走向 → 开场三栏 → 核心台词 → 逐场细拆 排：' + rows1)
  if (await evaluate(`document.querySelector('#bd-ep-1 > div').innerText.includes('逐场')`)) throw new Error('标题行不再重复写拆了哪些')
  // 一卡前逐句：每一场默认收成一行，核心台词连着整集的情绪走向放在上面；点开看逐句、情绪链
  const fine1 = await evaluate(`(() => { const s = document.querySelector('[data-scenes="1"]'); return { turns: s.querySelectorAll('[data-line-turn]').length, open: s.querySelector('[data-scene-toggle]')?.getAttribute('aria-expanded'), stats: s.querySelector('[data-scene-stats]')?.innerText ?? '', chain: document.querySelector('[data-core-lines="1"] [data-ep-chain]')?.innerText ?? '', core: document.querySelector('[data-core-lines="1"]')?.innerText ?? '' } })()`)
  if (fine1.turns || fine1.open !== 'false' || !/^\d+ 场 · \d+ 句 · 4 处转折$/.test(fine1.stats) || !fine1.chain.includes('期待') || !fine1.chain.includes('揪心') || !fine1.core.includes('你会后悔的') || !fine1.core.includes('核心台词')) throw new Error('第 1 集逐句默认收起，核心台词带整集情绪走向：' + JSON.stringify(fine1))
  await evaluate(`document.querySelector('[data-scenes="1"] [data-scene-toggle]').click()`)
  await waitFor(`document.querySelectorAll('[data-scenes="1"] [data-line-turn]').length === 4`, '点开一场看逐句')
  const chain1 = await evaluate(`document.querySelector('[data-scenes="1"] [data-chain]')?.innerText ?? ''`)
  if (!chain1.includes('期待') || !chain1.includes('揪心')) throw new Error('点开的一场应串出情绪：' + chain1)
  await evaluate(`document.querySelector('[data-bd-full]').click()`)
  await waitFor(`document.querySelectorAll('#bd-block-mainline [data-phase]').length === ${bd.mainLine.length}`, '完整视图')
  const ui = await evaluate(`(() => { const b = document.querySelector('#bd-block-mainline'); return { table: !!b.querySelector('table'), phases: b.querySelectorAll('[data-phase]').length, eps: b.querySelectorAll('[data-ep]').length, beats: b.querySelectorAll('[data-phase] header textarea').length, fine: [...b.querySelectorAll('[data-scenes]')].map((e) => +e.dataset.scenes).join(), source: b.querySelectorAll('[data-view-source]').length } })()`)
  if (ui.table || ui.phases !== bd.mainLine.length || ui.beats !== bd.mainLine.length || ui.eps !== bd.episodes.length || ui.source !== bd.episodes.length) throw new Error('冲突主线 · 内容简介应按段写梗概、列出每集，每集能查看原文：' + JSON.stringify(ui))
  if (ui.fine !== bd.episodes.filter((e) => e.ep <= card || e.paywall).map((e) => e.ep).join()) throw new Error('只有第 1 集到一卡和之后的付费卡点集显示细拆：' + ui.fine)
  const cardUi = await evaluate(`({ n: document.querySelectorAll('[data-bd-card-point]').length, text: document.querySelector('#bd-ep-${card} [data-bd-card-point] textarea')?.value ?? '', rows: [...document.querySelectorAll('#bd-ep-${card} dt')].map((d) => d.textContent).join(), tint: document.querySelector('#bd-ep-${card}').className.includes('bg-orange') })`)
  const paywalls = bd.episodes.filter((e) => e.paywall || e.ep === card).length
  if (cardUi.n !== paywalls || !cardUi.text.includes('卡在：') || cardUi.rows !== '走向,卡点,核心台词,逐场细拆' || cardUi.tint) throw new Error('一卡那一集应拆卡点，只有卡点上底色：' + JSON.stringify(cardUi))
  if (!(await evaluate(`document.querySelector('#bd-block-mainline').innerText.includes('一卡 第 ${card} 集')`))) throw new Error('应标出一卡')
  // 11/4 标注 #84：一卡之后的付费卡点集按一卡来——同样拆卡点、核心台词、逐场逐句，卡点上底色
  const later = bd.episodes.find((e) => e.paywall && e.ep > card)
  if (!later) throw new Error('示例拆解里应有一卡之后的付费卡点')
  // 目录里各段都点开，才看得到每集的标签
  await evaluate(`document.querySelectorAll('[data-bd-phase-link]').forEach((a) => a.click())`)
  await waitFor(`document.querySelector('[data-bd-ep-link="${later.ep}"]')`, '目录里展开到这一集')
  const laterUi = await evaluate(`({ rows: [...document.querySelectorAll('#bd-ep-${later.ep} dt')].map((d) => d.textContent).join(), text: document.querySelector('#bd-ep-${later.ep} [data-bd-card-point] textarea')?.value ?? '', label: document.querySelector('#bd-ep-${later.ep} [data-bd-card-point] textarea')?.getAttribute('aria-label'), badge: document.querySelector('#bd-ep-${later.ep}').innerText.includes('付费卡点'), tag: document.querySelector('[data-bd-ep-link="${later.ep}"]')?.innerText.includes('付费卡点') })`)
  if (laterUi.rows !== '走向,卡点,核心台词,逐场细拆' || !laterUi.text.includes('卡在：') || laterUi.label !== `第 ${later.ep} 集卡点` || !laterUi.badge || !laterUi.tag) throw new Error(`第 ${later.ep} 集付费卡点应按一卡拆：` + JSON.stringify(laterUi))
  const curve = `!!document.querySelector('[data-bd-curve] svg')`
  if (await evaluate(curve)) throw new Error('节奏曲线默认收起')
  await evaluate(`document.querySelector('[data-bd-rhythm-toggle]').click()`)
  await waitFor(curve, '展开节奏曲线')
  await evaluate(`document.querySelector('[data-bd-rhythm-toggle]').click()`)
  await waitFor(`!${curve}`, '收起节奏曲线')
  // 查看原文：一集一集翻
  await evaluate(`document.querySelector('[data-view-source="1"]').click()`)
  await waitFor(dialog('第 1 集原文'), '原文弹窗')
  if (!(await evaluate(`document.querySelector('[data-source-text]').innerText.includes('凯恩')`))) throw new Error('原文弹窗应显示这一集的剧本')
  await t(`__t.click('[role=dialog] button', '下一集')`)
  await waitFor(dialog('第 2 集原文'), '翻到下一集')
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await waitFor(`!document.querySelector('[role=dialog]')`, '关闭原文')
  // 人物设定：参照人物设定页，左边人物、右边拆解；主角拆简介、身份、金手指、动机，配角拆作用和定位（11/4 第五轮标注 #69）
  const hero = bd.characters.find((c) => c.role === '主角')
  const heroFields = ['简介', '身份', '金手指', '表面追求', '终极渴望', '潜意识恐惧']
  if (!hero || ['intro', 'profile', 'ability', 'goal', 'desire', 'fear'].some((k) => !hero[k]?.trim())) throw new Error('主角应拆简介、身份、金手指、动机：' + JSON.stringify(hero))
  const person = (name) => evaluate(`(() => { const d = document.querySelector('#bd-block-characters [data-bd-person-detail]'); return { name: d?.dataset.bdPersonDetail, fields: [...d.querySelectorAll('dl textarea')].map((t) => t.getAttribute('aria-label') + (t.value.trim() ? '' : '（空）')).join() } })()`)
  if ((await evaluate(`document.querySelectorAll('#bd-block-characters [data-bd-cast] button').length`)) !== bd.characters.length) throw new Error('左边应列出全部人物')
  const p0 = await person()
  if (p0.name !== hero.name || p0.fields !== heroFields.join()) throw new Error('默认选中主角，按人物设定的小传拆细：' + JSON.stringify(p0))
  const other = bd.characters.find((c) => c.role !== '主角')
  await evaluate(`document.querySelector('#bd-block-characters [data-bd-person="${other.name}"]').click()`)
  await waitFor(`document.querySelector('#bd-block-characters [data-bd-person-detail]')?.dataset.bdPersonDetail === '${other.name}'`, '点左边换人')
  if ((await person()).fields !== '作用' || !other.purpose?.trim()) throw new Error('配角拆在这部剧里的作用：' + JSON.stringify(await person()))
  if ((await evaluate(`document.querySelector('#bd-block-characters [data-bd-person-detail] input[aria-label=定位]')?.value`)) !== other.role) throw new Error('配角的定位在上面')
  // 关系网：关系图点人物切到他的拆解；关系在人物里改，关系表只看
  const bdGraph = `document.querySelector('#bd-block-characters svg[aria-label^=人物关系图]')`
  await waitFor(bdGraph, '拆解的人物关系图')
  if (!(await evaluate(`${bdGraph}.getAttribute('aria-label').includes('${bd.relations.length} 条关系')`))) throw new Error('关系图连线数不对')
  await evaluate(`[...document.querySelectorAll('#bd-block-characters svg [role=button]')].find((g) => g.textContent.includes('${hero.name}'))?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
  await waitFor(`document.querySelector('#bd-block-characters [data-bd-person-detail]')?.dataset.bdPersonDetail === '${hero.name}'`, '点关系图里的人物')
  const heroRels = bd.relations.filter((r) => r.a === hero.name || r.b === hero.name).length
  if ((await evaluate(`document.querySelectorAll('#bd-block-characters [data-bd-person-detail] input[aria-label=关系类型]').length`)) !== heroRels) throw new Error('人物的「关系」里应列出他的关系')
  await t(`__t.click('#bd-block-characters button[aria-pressed]', '关系表')`)
  await waitFor(`document.querySelectorAll('#bd-block-characters [data-bd-table] tbody tr').length === ${bd.relations.length}`, '关系表')
  await t(`__t.click('#bd-block-characters button[aria-pressed]', '关系图')`)
  // 改走向、加一场、加一句、标转折，存进拆解
  await t(`__t.type(document.querySelector('textarea[aria-label="第 3 集走向"]'), 'e2e 第 3 集走向')`)
  await t(`__t.click('[data-scenes="1"] button', '添加一场')`)
  await until(`(() => { const e = JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === 'demo-alpha').work.breakdown.episodes; return e[2].flow === 'e2e 第 3 集走向' && e[0].scenes.length === ${bd.episodes[0].scenes.length + 1} })()`, '改走向、加一场保存', 3000)
  await t(`[...[...document.querySelectorAll('[data-scenes="1"] [data-scene]')].pop().querySelectorAll('button')].find((b) => b.textContent.includes('加一句')).click()`)
  await until(`JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === 'demo-alpha').work.breakdown.episodes[0].scenes.at(-1).lines.length === 1`, '加一句', 3000)
  await t(`__t.type([...document.querySelectorAll('[data-scenes="1"] textarea[aria-label=台词]')].pop(), 'e2e：这一句带来转折')`)
  await t(`[...document.querySelectorAll('[data-scenes="1"] button[aria-pressed]')].pop().click()`)
  await until(`(() => { const b = JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === 'demo-alpha').work.breakdown.episodes[0].scenes.at(-1).lines[0]; return b.text === 'e2e：这一句带来转折' && b.turn })()`, '标成转折', 3000)
  await waitFor(`document.querySelector('[data-core-lines="1"]').innerText.includes('e2e：这一句带来转折')`, '转折句进本集核心台词')
  await t(`[...document.querySelectorAll('[data-scenes="1"] button[aria-label=删除这一场]')].pop().click()`)
  await t(`__t.type(document.querySelector('textarea[aria-label="第 3 集走向"]'), ${JSON.stringify(bd.episodes[2].flow)})`)
  await t(`__t.click('[data-bd-bar] button', '人物设定')`)
  await waitFor(nearTop('#bd-block-characters'), '点进度跳到板块', 3000)
  await sleep(200)
  await shot('v2-breakdown')
  await evaluate(`document.querySelector('#bd-block-mainline').scrollIntoView()`)
  await sleep(200)
  await shot('breakdown-story')
})

await check('对标剧拆解：视频仿写的第 1 集只拆前 3 秒、前 30 秒和钩子，不逐场逐句；剧本仿写第 1 集照样逐句拆（11/4 第五轮）', async () => {
  const fresh = await evaluate(`(async () => {
    const p = JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((x) => x.id === 'demo-alpha')
    const { analyzeSource } = await import('/src/services/mock/breakdown.ts')
    const v = analyzeSource(p.work.source, 'video')
    const a = analyzeSource(p.work.source, 'adaptation')
    return { v1: v.episodes[0].scenes.length, v2: v.episodes[1].scenes.length, a1: a.episodes[0].scenes.length, open: !!v.episodes[0].open3s?.trim() && !!v.episodes[0].open30s?.trim() }
  })()`)
  if (fresh.v1 || !fresh.v2 || !fresh.a1 || !fresh.open) throw new Error('视频仿写首集不逐句、第 2 集起照拆；剧本仿写首集逐句：' + JSON.stringify(fresh))
  const setMode = (m) => evaluate(`(() => { const raw = JSON.parse(localStorage.getItem('${KEY}')); raw.state.projects.find((x) => x.id === 'demo-alpha').mode = '${m}'; localStorage.setItem('${KEY}', JSON.stringify(raw)) })()`)
  await setMode('video')
  try {
    await goto('/projects/demo-alpha/stage/breakdown')
    await waitFor(`document.querySelector('#bd-ep-1 [data-bd-opening]')`, '视频仿写的首集开场')
    const ui = await evaluate(`({ scenes: !!document.querySelector('[data-scenes="1"]'), core: !!document.querySelector('[data-core-lines="1"]'), rows: [...document.querySelectorAll('#bd-ep-1 dt')].map((d) => d.textContent).join() })`)
    if (ui.scenes || ui.core || ui.rows !== '走向,前 3 秒,前 30 秒,钩子') throw new Error('视频仿写的首集只显示开场三栏：' + JSON.stringify(ui))
    await sleep(200)
    await shot('breakdown-video-ep1')
  } finally {
    await setMode('adaptation')
  }
})

await check('对标剧拆解：故事架构勾「完全按对标剧」后集数与单集时长跟着对标剧走', async () => {
  const demo = async () => (await projects()).find((p) => p.id === 'demo-alpha')
  const d0 = await demo()
  await goto('/projects/demo-alpha/stage/architecture')
  await waitFor(`document.querySelector('[data-follow-benchmark] input')`, '完全按对标剧的勾选')
  await evaluate(`document.querySelector('[data-follow-benchmark] input').click()`)
  const want = Math.min(1000, Math.max(1, d0.work.breakdown.totalEpisodes))
  await waitFor(`document.querySelector('input[aria-label=总集数]')?.disabled && document.querySelector('input[aria-label=总集数]').value.startsWith('${want} 集')`, '集数跟着对标剧')
  if ((await demo()).spec.totalEpisodes !== want || !(await demo()).spec.followBenchmark) throw new Error('集数应同步成对标剧的 ' + want)
  await sleep(150)
  await shot('follow-benchmark')
  await patchStored(`async (p) => {}`, '/projects/demo-alpha')
  await evaluate(`(() => { const raw = JSON.parse(localStorage.getItem('${KEY}')); const i = raw.state.projects.findIndex((x) => x.id === 'demo-alpha'); raw.state.projects[i] = ${JSON.stringify(d0)}; localStorage.setItem('${KEY}', JSON.stringify(raw)) })()`)
  await goto('/projects/demo-alpha')
})

await check('仿写：冲突主线分「对标剧（拆解）」「修改冲突主线」两个标签、表头一样，不用选对位；新加的段不对位；节奏框架按分段换算；集纲显示对位集；审稿查对标剧人名与照搬台词', async () => {
  const demo = async () => (await projects()).find((p) => p.id === 'demo-alpha')
  const d0 = await demo()
  await goto('/projects/demo-alpha/stage/breakdown')
  await t(`__t.click('button', '一键引用')`)
  await waitFor(dialog('引用到故事架构'), '引用弹窗')
  if (!(await evaluate(`document.querySelector('[role=dialog]').innerText.includes('先对段，段内按比例')`))) throw new Error('一键引用的节奏应按分段换算')
  await t(`__t.click('[role=dialog] button', '引用并进入故事架构')`)
  await waitFor(`location.pathname.endsWith('/stage/architecture') && document.querySelector('#arch-items')`, '进入故事架构')
  // 核心设定 → AI 框架方向 → 设定 → 创新点（设定写完再和对标剧比）→ 结构 → 全局写作要求（改写方案 11/3 删掉，改写想法 11/5 标注 #87 删掉；主要势力 11/4 第五轮删掉；创新点原创不要、仿写留着）
  const items = await evaluate(`[...document.querySelectorAll('#arch-items [data-item]')].map((l) => l.getAttribute('data-item')).join()`)
  if (items !== 'logline,world,goldenFinger,background,highlights,heroSetup,innovations,mainLine,writingRules') throw new Error('仿写顺序不对：' + items)
  if (await t(`__t.has('改写方案')`)) throw new Error('仿写不应再有改写方案')
  if (await t(`__t.has('改写想法')`) || (await evaluate(`!!document.querySelector('textarea[aria-label=改写想法]')`))) throw new Error('仿写不应再有改写想法')
  if (!(await evaluate(`(() => { const btn = [...document.querySelectorAll('#arch-items button')].find((b) => b.textContent.trim() === 'AI 框架方向'); const box = document.querySelector('textarea[aria-label=核心设定]'); return !!btn && !!(box.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING) })()`))) throw new Error('仿写的 AI 框架方向应在核心设定框下面')
  const seen = await stepAll()
  if (!seen.length || !(await demo()).work.prints?.['arch.rhythm']) throw new Error('仿写逐项生成到底应带出节奏框架：' + seen)
  await sleep(200)
  // 爽点公式 11/4 删掉：没有依据、不再生成
  const formula = await evaluate(`(async () => {
    const p = JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((x) => x.id === 'demo-alpha')
    const d = (await import('/src/services/mock/chain.ts')).draftArchItem(p, 'formula')
    const row = (await import('/src/domain/basis.ts')).archBasis(p, 'formula')
    return { text: d.text, row }
  })()`)
  if (formula.text || formula.row) throw new Error('爽点公式已删，不应再有依据或生成内容：' + JSON.stringify(formula))
  const marks = (await demo()).work.architecture.marks
  if (Object.values(marks).some((list) => list.some((m) => /主要势力/.test(m.from)))) throw new Error('主要势力已删，仿写各项不应再读它')
  if (!marks.highlights?.some((m) => m.from === '对标剧拆解 · 核心亮点')) throw new Error('仿写的核心亮点应参照对标剧的核心亮点：' + JSON.stringify(marks.highlights))
  if (Object.entries(marks).some(([k, list]) => ['world', 'goldenFinger', 'background', 'highlights', 'heroSetup'].includes(k) && list.some((m) => m.from === '创新点'))) throw new Error('仿写的设定排在创新点前面，不应读创新点')
  const inn = (await demo()).work.architecture.innovations
  if (inn.length < 3 || inn.some((x) => !x.theirs.trim() || !x.ours.trim())) throw new Error('仿写的创新点要写对标剧怎么做 → 我们怎么做：' + JSON.stringify(inn))
  const tip = await evaluate(`document.querySelector('[data-basis="冲突主线"]').parentElement.querySelector('[role=tooltip]').textContent`)
  if (!tip.includes('创新点') || tip.includes('主要势力')) throw new Error('仿写冲突主线的依据应列创新点、不列主要势力：' + tip)
  if ((await demo()).work.architecture.plan) throw new Error('仿写不应写改写方案')
  // 冲突主线分两个标签：对标剧拆解出来的在前（只读），「修改冲突主线」在后（可改），表头一样
  const heads = (k) => `[...document.querySelectorAll('[data-line-table=${k}] th')].map((x) => x.textContent).filter(Boolean).join()`
  const tabs = await evaluate(`[...document.querySelectorAll('[data-line-tabs] button')].map((b) => b.textContent).join()`)
  if (tabs !== '对标剧（拆解）,修改冲突主线') throw new Error('标签应是 对标剧（拆解） 在前、修改冲突主线 在后：' + tabs)
  await waitFor(`document.querySelector('[data-line-table=bench]')`, '默认先看对标剧那张表')
  if ((await evaluate(heads('bench'))) !== '段落,集数,剧情') throw new Error('对标剧冲突主线表头不对：' + (await evaluate(heads('bench'))))
  if (await evaluate(`!!document.querySelector('[data-line-table=bench] input, [data-line-table=bench] textarea, [data-line-table=bench] select')`)) throw new Error('对标剧那张表应只读')
  const benchRows = await evaluate(`document.querySelectorAll('[data-line-table=bench] tbody tr').length`)
  if (benchRows !== (await demo()).work.breakdown.mainLine.length) throw new Error('对标剧那张表应列出拆解的每一段')
  await shot('adaptation-mainline-bench')
  await t(`__t.click('[data-line-tabs] button', '修改冲突主线')`)
  await waitFor(`document.querySelector('[data-line-table=ours]')`, '切到修改冲突主线')
  if ((await evaluate(heads('ours'))) !== '段落,集数,剧情') throw new Error('修改冲突主线的表头应和对标剧一样：' + (await evaluate(heads('ours'))))
  if (await evaluate(`!!document.querySelector('[data-line-table=ours] select')`)) throw new Error('不用再选对应对标剧哪一段')
  const rules = await evaluate(`import('/src/services/mock/chain.ts').then((m) => m.draftArchItem(JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((x) => x.id === 'demo-alpha'), 'writingRules').text)`)
  if (!rules.includes('不沿用对标剧人名')) throw new Error('仿写全局写作要求应带上不沿用对标剧人名：' + rules)
  // 在第二段后面新加一段：新加的段不对位（系统自动记 PlotBeat.bench = -1），其余段照旧对位
  const before = (await demo()).work.architecture.mainLine.length
  await evaluate(`document.querySelectorAll('[data-line-table=ours] button[aria-label$=后新增一段]')[1].click()`)
  await waitFor(`JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === 'demo-alpha').work.architecture.mainLine.length === ${before + 1}`, '新加一段')
  if ((await demo()).work.architecture.mainLine[2].bench !== -1) throw new Error('新加的段应记为不对位')
  await shot('adaptation-mainline')
  // 新加的段空着：逐项生成回到冲突主线，只补这一段，编剧已有的段不覆盖
  const kept = (await demo()).work.architecture.mainLine.map((b) => b.content)
  if ((await stepOnce()) !== 'mainLine') throw new Error('新加的段空着，下一项应是冲突主线')
  const refilled = (await demo()).work.architecture.mainLine
  if (!refilled[2].content.trim() || refilled.some((b, i) => i !== 2 && b.content !== kept[i]) || refilled[2].bench !== -1) throw new Error('逐项生成冲突主线应只补空着的段：' + JSON.stringify(refilled.map((b) => b.content.slice(0, 12))))
  const r = await evaluate(`(async () => {
    const m = await import('/src/domain/align.ts')
    const p = JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((x) => x.id === 'demo-alpha')
    const ranges = (await import('/src/domain/work.ts')).projectPhases(p)
    return { inNew: m.alignEp(p, ranges[2][0]), first: m.alignEp(p, 1), rhythm: m.alignRhythm(p) }
  })()`)
  if (r.inNew.length || !r.first.length) throw new Error('新加的段不对位，其余段要对位：' + JSON.stringify(r))
  // 审稿：对标剧人名残留算严重
  const rv = await evaluate(`(async () => {
    const w = await import('/src/services/mock/writer.ts')
    const p = JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((x) => x.id === 'demo-alpha')
    const name = p.work.breakdown.characters[0].name
    const line = p.work.source.text.split('\\n').map((l) => l.trim()).find((l) => /^[^△：]{1,6}：.{10,}/.test(l))
    const [speaker, ...rest] = line.split('：')
    const lines = [{ id: 's', kind: 'scene', zh: '日，内，客厅' }, { id: 'a', kind: 'action', zh: '△ ' + name + '推门进来。' }, { id: 'd', kind: 'dialogue', speaker: '某人', zh: rest.join('：') }, { id: 'h', kind: 'hook', zh: '门外传来脚步声——' }]
    return w.reviewDraft(p, { ep: 3, lines }).items.filter((i) => i.basis === 'bench').map((i) => i.code + ':' + i.level)
  })()`)
  if (!rv.includes('benchName:block') || !rv.includes('benchLine:block')) throw new Error('仿写审稿应查出对标剧人名残留、照搬台词（严重）：' + rv)
  // 集纲：每集旁显示对位集
  await evaluate(`(() => { const raw = JSON.parse(localStorage.getItem('${KEY}')); const p = raw.state.projects.find((x) => x.id === 'demo-alpha'); p.work.architecture.status = 'approved'; p.work.characters = [{ id: 'c1', name: '林晚', nameEn: '', role: '主角', gender: '女', age: '', profile: '', appearance: '', costume: '', lookRef: '', personality: '', background: '', ability: '', goal: '', desire: '', fear: '', flaw: '', arc: '', notes: '', benchmark: '' }]; localStorage.setItem('${KEY}', JSON.stringify(raw)) })()`)
  await goto('/projects/demo-alpha/stage/outline')
  await t(`__t.click('button', '生成总纲')`)
  await waitFor(`JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === 'demo-alpha').work.plot?.overview.includes('【对照对标剧】')`, '总纲对照对标剧', 6000)
  await t(`__t.click('#outline-phase-0 button', '生成阶段总览')`)
  await waitFor(`JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === 'demo-alpha').work.plot?.phases[0]?.includes('对照对标剧')`, '阶段总览读对标剧对应段', 6000)
  await t(`__t.click('#outline-phase-0 button', '一键集纲')`)
  await waitFor(`document.querySelector('[data-align]')?.textContent.startsWith('对位：对标剧第')`, '集纲显示对位集', 8000)
  await shot('adaptation-outline')
  await evaluate(`(() => { const raw = JSON.parse(localStorage.getItem('${KEY}')); const i = raw.state.projects.findIndex((x) => x.id === 'demo-alpha'); raw.state.projects[i] = ${JSON.stringify(d0)}; localStorage.setItem('${KEY}', JSON.stringify(raw)) })()`)
  await goto('/projects/demo-alpha')
})

await check('项目卡片显示进度，「继续」直达下一步', async () => {
  await goto('/projects')
  const card = `[...document.querySelectorAll('a[href="${projectPath}"]')].find((a) => a.innerText.includes('定稿'))`
  await waitFor(`${card}?.innerText.includes('环节 · 定稿 7/')`, '卡片进度')
  await sleep(200)
  await shot('v2-projects')
  await evaluate(`[...${card}.querySelectorAll('button')].find((b) => b.textContent.startsWith('下一步 ·')).click()`)
  await waitFor(`location.pathname.startsWith('${projectPath}/stage/script/draft/')`, '继续直达草稿')
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
await check('设置：不含节奏框架；故事设定只读，点「去故事架构修改」过去改', async () => {
  await goto(projectPath + '/settings')
  await waitFor(`document.querySelector('[data-story-summary]')`, '设置页的故事设定')
  if (await t(`__t.has('结局高潮起始集')`)) throw new Error('设置页仍有节奏框架')
  if (await evaluate(`!!document.querySelector('[data-settings] input[aria-label=总集数], [data-settings] input[aria-label=单集时长], [data-settings] [aria-haspopup=listbox]')`)) throw new Error('设置页的故事设定应只读')
  const text = await evaluate(`document.querySelector('[data-story-summary]').innerText`)
  if (!text.includes('120 秒') || !text.includes('都市豪门') || !text.includes('题材类型') || text.includes('风格基调')) throw new Error('故事设定应显示当前的值：' + text)
  await t(`__t.click('a', '去故事架构修改')`)
  await waitFor(`location.pathname.endsWith('/stage/architecture') && document.querySelector('input[aria-label=总集数]')`, '跳到故事架构')
})
await check('故事架构：改总集数后节奏框架跟着收回，付费卡点与高潮不越界', async () => {
  const total = `document.querySelector('input[aria-label=总集数]')`
  await t(`__t.type(${total}, '40')`)
  await t(`__t.blur(${total})`)
  await waitFor(`JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === '${projectId}').spec.totalEpisodes === 40`, '总集数写回')
  const r = (await project()).rhythm
  if (!r.paywalls.length || r.paywalls.some((e) => e > 40) || r.climaxFrom > 40) throw new Error('节奏应收回到 40 集以内：' + JSON.stringify(r))
})
await check('故事架构：未调过的节奏框架随总集数重新推荐', async () => {
  await goto('/projects/demo-alpha/stage/architecture')
  const total = `document.querySelector('input[aria-label=总集数]')`
  await waitFor(total, '故事架构')
  await t(`__t.type(${total}, '80')`)
  await t(`__t.blur(${total})`)
  await waitFor(`JSON.parse(localStorage.getItem('${KEY}')).state.projects.find((p) => p.id === 'demo-alpha').spec.totalEpisodes === 80`, '总集数写回')
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
  await t(`__t.click('button', '创建剧本')`)
  await waitFor(`document.body.innerText.includes('请填写对标剧剧名')`, '对标剧报错')
})
await check('存储迁移：故事架构补上核心亮点；拆解补上金手指、每集走向与细拆并去掉新出场人物等三个字段，旧细拆改成逐句、主角补上拆细的几项，首集开场、一卡卡点、主角简介和配角作用按原文补上，期待值删掉、冲突主线和内容简介的审核合成一块；去掉每集字数、画幅和故事架构的逐层记录，仿写的改写方案并进改写想法（v18 随改写想法删掉），人物关系按备注补上类型，旧标签与旧场景标题换成新写法', async () => {
  await evaluate(`(() => { const raw = JSON.parse(localStorage.getItem('${KEY}')); raw.version = 4; raw.state.projects.forEach((p) => { if (p.work.architecture) delete p.work.architecture.highlights; p.spec.episodeWords = 1000; p.spec.aspectRatio = '9:16'; delete p.work.qa; const b = p.work.breakdown; if (b) { delete b.synopsis.goldenFinger; b.synopsis.expectation = 'e2e 旧期待值'; b.review = { synopsis: 'approved', characters: 'approved', mainline: 'approved', episodes: 'pending' }; b.episodes.forEach((e) => { delete e.flow; delete e.scenes; Object.assign(e, { newCharacters: '甲', relationChange: '甲 — 乙：结盟', paywallMoment: '' }) }); b.episodes[0].scenes = [{ scene: '1-1 e2e 旧场次', action: 'e2e 旧关键动作', turn: '期待 → 屈辱', line: 'e2e：旧核心台词' }]; b.characters.forEach((c) => { for (const k of ['intro', 'purpose', 'profile', 'background', 'ability', 'goal', 'desire', 'fear', 'flaw', 'arc', 'quotes']) delete c[k] }); b.episodes.forEach((e) => { delete e.open3s; delete e.open30s; delete e.cardPoint }) } if (p.work.architecture) { p.work.architecture.layers = { start: '2026-11-03T00:00:00.000Z' }; if (p.mode !== 'original') p.work.architecture.plan = 'e2e 旧改写方案：保留拒婚结构' } }); const demo = raw.state.projects.find((p) => p.id === 'demo-rebirth'); demo.work.relations = [{ a: '甲', b: '乙', label: '宿敌，处处陷害' }]; demo.category = '仙侠'; demo.tones = ['爽感', '虐心', '悬疑']; demo.work.drafts = [{ ...(demo.work.drafts[0] ?? { id: 'e2e-old', ep: 1, title: '', status: 'draft', updatedAt: new Date().toISOString(), reviews: [], notes: [] }), lines: [{ id: 'old-1', kind: 'scene', zh: '宴会厅 夜 内' }] }]; localStorage.setItem('${KEY}', JSON.stringify(raw)) })()`)
  await goto('/projects/demo-rebirth')
  await waitFor(`document.body.innerText.includes('90 秒 · 约')`, '概览显示单集时长')
  const saved = await evaluate(`JSON.parse(localStorage.getItem('${KEY}'))`)
  const demo = saved.state.projects.find((p) => p.id === 'demo-rebirth')
  if (saved.state.projects.some((p) => p.mode !== 'original' && p.work.architecture && (p.work.architecture.plan || 'idea' in p.work.architecture))) throw new Error('仿写的旧改写方案应清掉（v10 并进改写想法，v18 改写想法删掉）')
  const bds = saved.state.projects.flatMap((p) => (p.work.breakdown ? [p.work.breakdown] : []))
  if (!bds.length) throw new Error('迁移前应有拆解结果')
  if (bds.some((b) => !b.synopsis.goldenFinger || 'expectation' in b.synopsis || b.episodes.some((e) => !e.flow || !Array.isArray(e.scenes) || 'newCharacters' in e || 'relationChange' in e || 'paywallMoment' in e))) throw new Error('拆解应按原文补上金手指、每集走向，去掉期待值和旧的三个字段')
  const oldScene = bds.map((b) => b.episodes[0].scenes[0])
  if (oldScene.some((s) => s.scene !== '1-1 e2e 旧场次' || s.action !== 'e2e 旧关键动作' || 'turn' in s || 'line' in s || !s.lines?.length)) throw new Error('旧的细拆应改成逐句，场次和关键动作不动：' + JSON.stringify(oldScene))
  if (bds.some((b) => b.characters.some((c) => c.role === '主角' && !c.profile?.trim()))) throw new Error('主角应按原文补上拆细的几项')
  // v14（11/4 第五轮）：首集前 3 秒 / 前 30 秒、一卡卡点、主角简介、配角作用按原文补上
  if (bds.some((b) => !b.episodes[0].open3s?.trim() || !b.episodes[0].open30s?.trim() || !b.episodes.find((e) => e.ep === b.rhythm.paywalls[0])?.cardPoint?.trim())) throw new Error('应按原文补上首集开场和一卡卡点')
  if (bds.some((b) => b.characters.some((c) => (c.role === '主角' ? !c.intro?.trim() : !c.purpose?.trim())))) throw new Error('应按原文补上主角简介、配角作用')
  if (bds.some((b) => 'episodes' in b.review || b.review.mainline !== 'pending' || b.review.synopsis !== 'approved')) throw new Error('内容简介没确认过，合并后的冲突主线 · 内容简介应回到待审核：' + JSON.stringify(bds.map((b) => b.review)))
  // v15（11/4 标注 #71）：故事架构补上空的核心亮点
  if (saved.state.projects.some((p) => p.work.architecture && p.work.architecture.highlights !== '')) throw new Error('旧项目的故事架构应补上空的核心亮点')
  if (saved.version !== 18 || saved.state.projects.some((p) => p.work.architecture && 'layers' in p.work.architecture) || saved.state.projects.some((p) => 'aspectRatio' in p.spec) || saved.state.projects.some((p) => 'episodeWords' in p.spec || p.work.qa !== null)) throw new Error('迁移结果不对：' + JSON.stringify(saved.state.projects.map((p) => p.spec)))
  if (demo.work.relations[0].kind !== '宿敌') throw new Error('关系类型未推断：' + JSON.stringify(demo.work.relations))
  if (demo.category !== '玄幻' || demo.tones.join() !== '打脸,虐恋,反转') throw new Error('旧标签应换成平台标签：' + demo.category + ' / ' + demo.tones)
  if (demo.work.drafts[0].lines[0].zh !== '夜，内，宴会厅') throw new Error('旧场景标题应改成样稿格式：' + demo.work.drafts[0].lines[0].zh)
  if (demo.work.characters.some((c) => c.costume === undefined || c.lookRef === undefined)) throw new Error('人物应补上服装 / 外形参考字段')
})
await check('存储迁移 v16：一卡之后的付费卡点集按原文补上卡点和逐场细拆，编剧写过的不动（11/4 标注 #84）', async () => {
  await evaluate(`(() => { const raw = JSON.parse(localStorage.getItem('${KEY}')); raw.version = 15; raw.state.projects.forEach((p) => { const b = p.work.breakdown; if (!b) return; b.episodes.filter((e) => e.paywall && e.ep > b.rhythm.paywalls[0]).forEach((e, i) => { e.cardPoint = i === 0 ? 'e2e 手写卡点' : ''; e.scenes = [] }) }); localStorage.setItem('${KEY}', JSON.stringify(raw)) })()`)
  await goto('/projects')
  await waitFor(`JSON.parse(localStorage.getItem('${KEY}')).version === 18`, '迁移到最新版本')
  const bds = (await projects()).flatMap((p) => (p.work.breakdown && p.work.source?.episodes.length ? [p.work.breakdown] : []))
  const later = bds.map((b) => b.episodes.filter((e) => e.paywall && e.ep > b.rhythm.paywalls[0]))
  if (!later.some((l) => l.length)) throw new Error('示例项目里应有一卡之后的付费卡点集')
  if (later.some((l) => l.some((e, i) => !e.scenes.length || (i === 0 ? e.cardPoint !== 'e2e 手写卡点' : !e.cardPoint?.includes('卡在：'))))) throw new Error('付费卡点集应补上卡点和细拆，手写的卡点不动：' + JSON.stringify(later.map((l) => l.map((e) => [e.ep, e.cardPoint?.slice(0, 12), e.scenes.length]))))
})
await check('存储迁移 v17：伏笔与叙事线索删掉后，旧项目里的伏笔计划、沉寂阈值、审稿里的伏笔意见与保留记录、依据指纹里的伏笔计划一起清掉', async () => {
  await evaluate(`(() => {
    const raw = JSON.parse(localStorage.getItem('${KEY}'))
    raw.version = 16
    // 跑到这里时 e2e 自己的项目已删，用示例项目：给第一份草稿补一份旧审稿
    const p = raw.state.projects.find((x) => x.work.drafts.length)
    p.work.foreshadows = [{ id: 'e2e-old-fs', type: '关键道具', title: '旧伏笔', content: '', plantEp: 1, payoffEp: 3, events: [] }]
    if (p.work.architecture) p.work.architecture.silenceThreshold = 3
    const d = p.work.drafts[0]
    d.reviews.push({ id: 'e2e-old-review', at: d.updatedAt, score: 3, items: [] })
    d.reviews.at(-1).items.push({ level: 'warn', code: 'plan', key: 'plan:e2e-old-fs:plant', text: '计划本集埋设「旧伏笔」，正文里没找到' }, { level: 'warn', code: 'paid', key: 'paid:e2e-old-fs', text: '「旧伏笔」已在第 1 集回收，本集又出现' })
    p.work.keeps = [...(p.work.keeps ?? []), { ep: 1, key: 'plan:e2e-old-fs:plant', text: '旧伏笔', level: 'warn', at: '' }]
    p.work.prints = { ...p.work.prints, 'e2e.print': { foreshadows: 'x', logline: 'y' } }
    localStorage.setItem('${KEY}', JSON.stringify(raw))
    window.__e2eFsProject = p.id
  })()`)
  const id = await evaluate('window.__e2eFsProject')
  await goto('/projects')
  await waitFor(`JSON.parse(localStorage.getItem('${KEY}')).version === 18`, '迁移到最新版本')
  const p = (await projects()).find((x) => x.id === id)
  if ('foreshadows' in p.work) throw new Error('伏笔计划应删掉')
  if (p.work.architecture && 'silenceThreshold' in p.work.architecture) throw new Error('沉寂提醒阈值应删掉')
  const items = p.work.drafts.flatMap((d) => d.reviews.flatMap((r) => r.items))
  if (items.some((i) => i.code === 'plan' || i.code === 'paid')) throw new Error('审稿报告里的伏笔意见应删掉')
  if ((p.work.keeps ?? []).some((k) => k.key.startsWith('plan:'))) throw new Error('保留不改里的伏笔意见应删掉')
  const print = p.work.prints['e2e.print']
  if ('foreshadows' in print || print.logline !== 'y') throw new Error('依据指纹只去掉伏笔计划：' + JSON.stringify(print))
  await evaluate(`(() => { const raw = JSON.parse(localStorage.getItem('${KEY}')); const w = raw.state.projects.find((x) => x.id === '${id}').work; delete w.prints['e2e.print']; w.drafts[0].reviews = w.drafts[0].reviews.filter((r) => r.id !== 'e2e-old-review'); localStorage.setItem('${KEY}', JSON.stringify(raw)) })()`)
  await goto('/projects')
})
await check('存储迁移 v18：改写想法删掉（11/5 标注 #87）；核心设定空着的项目把改写想法搬进核心设定，写了的不动；依据指纹里的改写想法去掉', async () => {
  const before = await evaluate(`(() => {
    const raw = JSON.parse(localStorage.getItem('${KEY}'))
    raw.version = 17
    // 跑到这里时示例项目的故事架构可能已被前面的检查清掉：没有就临时补一份，结束后还原
    const empty = raw.state.projects.find((x) => x.mode !== 'original')
    const kept = raw.state.projects.find((x) => x.mode !== 'original' && x !== empty) ?? raw.state.projects.find((x) => x !== empty)
    if (!empty || !kept) return null
    const added = [empty, kept].filter((x) => !x.work.architecture).map((x) => x.id)
    for (const x of [empty, kept]) x.work.architecture ??= { plan: '', formula: '', mainLine: [], phaseEnds: null, innovations: [], status: 'pending', world: '', marks: {} }
    const old = { logline: empty.logline, keptLogline: kept.logline }
    empty.logline = ''
    empty.work.architecture.idea = 'e2e 改写想法：保留拒婚结构'
    empty.work.prints = { ...empty.work.prints, 'e2e.print': { idea: 'x', logline: 'y' } }
    kept.work.architecture.idea = 'e2e 另一份改写想法'
    localStorage.setItem('${KEY}', JSON.stringify(raw))
    return { ...old, empty: empty.id, kept: kept.id, added }
  })()`)
  if (!before) throw new Error('应有仿写项目和另一个项目')
  await goto('/projects')
  await waitFor(`JSON.parse(localStorage.getItem('${KEY}')).version === 18`, '迁移到 v18')
  const all = await projects()
  if (all.some((p) => p.work.architecture && 'idea' in p.work.architecture)) throw new Error('改写想法应从故事架构里删掉')
  const empty = all.find((p) => p.id === before.empty)
  if (empty.logline !== 'e2e 改写想法：保留拒婚结构') throw new Error('核心设定空着时应搬入改写想法：' + empty.logline)
  const print = empty.work.prints['e2e.print']
  if ('idea' in print || print.logline !== 'y') throw new Error('依据指纹只去掉改写想法：' + JSON.stringify(print))
  if (all.find((p) => p.id === before.kept).logline !== before.keptLogline) throw new Error('写了核心设定的项目不应改动核心设定')
  await evaluate(`(() => {
    const raw = JSON.parse(localStorage.getItem('${KEY}'))
    const p = raw.state.projects.find((x) => x.id === '${before.empty}')
    p.logline = ${JSON.stringify(before.logline)}
    delete p.work.prints['e2e.print']
    for (const x of raw.state.projects) if (${JSON.stringify(before.added)}.includes(x.id)) x.work.architecture = null
    localStorage.setItem('${KEY}', JSON.stringify(raw))
  })()`)
  await goto('/projects')
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
