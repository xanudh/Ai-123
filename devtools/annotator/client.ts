/* 开发期页面标注工具（由 vite-plugin.js 在 dev 时注入，不进入生产构建）
 * 标注模式：点击元素 → 标注该元素；拖拽 → 框选区域；⌥A 切换；Esc 退出
 * 数据实时写入 annotations/feedback.{json,md}，同时缓存在 localStorage */

const ENDPOINT = '/__annotator'
const LS_DATA = 'zy-annotator:data'
const LS_UI = 'zy-annotator:ui'
const PANEL_W = 360

const TYPES = [
  { key: '修改', color: '#7c5cff' },
  { key: '新增', color: '#0d9488' },
  { key: '删除', color: '#e03131' },
  { key: 'Bug', color: '#e8590c' },
  { key: '疑问', color: '#1c7ed6' },
] as const
type AType = (typeof TYPES)[number]['key']
const colorOf = (t: AType) => TYPES.find((x) => x.key === t)?.color ?? '#7c5cff'

interface Rect { x: number; y: number; w: number; h: number }
interface Target {
  selector: string
  tag: string
  text: string
  attrs: Record<string, string>
  components: string[] // 外层 → 内层
  sources: string[] // 源码文件线索：内层 → 外层
  rect: Rect
}
interface Region { anchor: string; dx: number; dy: number; w: number; h: number; texts: string[] }
interface Annotation {
  id: string
  n: number
  kind: 'element' | 'region' | 'page'
  type: AType
  comment: string
  route: string
  viewport: { w: number; h: number }
  createdAt: string
  updatedAt: string
  target?: Target // region 时为框选中心处的元素
  region?: Region
}
interface Store { version: 1; updatedAt: string; submittedAt?: string; annotations: Annotation[] }
interface Draft {
  kind: Annotation['kind']
  existing?: Annotation
  el?: Element
  stack: Element[] // “父级”回退栈
  region?: Region
  type: AType
  comment: string
}

// ---------- 工具 ----------
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)
const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s)
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const uid = () => Math.random().toString(36).slice(2, 10)
const now = () => new Date().toISOString()
const routeKey = () => location.pathname + location.search
const fmtTime = (iso: string) => (iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '')

function rectOf(el: Element): Rect | null {
  const r = el.getBoundingClientRect()
  if (!r.width && !r.height) return null
  return { x: r.left, y: r.top, w: r.width, h: r.height }
}
const roundRect = (r: Rect): Rect => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) })

function textOf(el: Element) {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return clip(norm(el.value || el.placeholder), 80)
  return clip(norm(el.textContent), 80)
}

// 尽量短且稳定的选择器：遇到唯一 id / data-testid 即停
function cssPath(el: Element): string {
  if (el === document.body) return 'body'
  const parts: string[] = []
  let cur: Element | null = el
  while (cur && cur !== document.body && cur !== document.documentElement) {
    const id = cur.id
    if (id && /^[A-Za-z][\w-]*$/.test(id) && document.querySelectorAll('#' + CSS.escape(id)).length === 1) {
      parts.unshift('#' + CSS.escape(id))
      return parts.join(' > ')
    }
    const testId = cur.getAttribute('data-testid')
    if (testId) {
      parts.unshift(`[data-testid="${CSS.escape(testId)}"]`)
      return parts.join(' > ')
    }
    const tag: string = cur.localName
    const parent: Element | null = cur.parentElement
    let part = tag
    if (parent) {
      const same = Array.from(parent.children).filter((c) => c.localName === tag)
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`
    }
    parts.unshift(part)
    cur = parent
  }
  return 'body > ' + parts.join(' > ')
}

// React 19 开发态：从 fiber 取组件链和 JSX 所在源文件
const SKIP_COMPONENTS = /^(RenderedRoute|Routes?|Router|RouterProvider\d*|DataRoutes\d*|MemoizedDataRoutes|Outlet|RenderErrorBoundary|ErrorBoundary|DefaultErrorComponent|StrictMode|Suspense|Fragment|Await)$/
type Fiber = any
// React fiber tag：FunctionComponent / ClassComponent / ForwardRef / MemoComponent / SimpleMemoComponent
const COMPONENT_TAGS = new Set([0, 1, 11, 14, 15])
function fiberOf(el: Element): Fiber {
  for (const k in el) if (k.startsWith('__reactFiber$')) return (el as unknown as Record<string, Fiber>)[k]
  return null
}
function componentName(type: Fiber): string | null {
  if (!type || typeof type === 'string') return null
  if (typeof type === 'function') return type.displayName || type.name || null
  if (typeof type === 'object') return type.displayName || componentName(type.render) || componentName(type.type)
  return null
}
function sourceOf(fiber: Fiber): string | null {
  const stack: unknown = fiber?._debugStack?.stack
  if (typeof stack !== 'string') return null
  for (const line of stack.split('\n').slice(1)) {
    if (line.includes('node_modules')) continue
    const m = line.match(/\/(src\/[^?:)\s]+)/)
    if (m) return m[1]
  }
  return null
}
function reactInfo(el: Element): { components: string[]; sources: string[] } {
  let start: Element | null = el
  let f0: Fiber = null
  while (start && !(f0 = fiberOf(start))) start = start.parentElement
  const components: string[] = []
  const sources: string[] = []
  const addSource = (f: Fiber) => {
    const s = sourceOf(f)
    if (s && !sources.includes(s)) sources.push(s)
  }
  addSource(f0)
  for (let f = f0?.return; f && components.length < 8; f = f.return) {
    if (!COMPONENT_TAGS.has(f.tag)) continue // 跳过 Context Provider 等非组件 fiber
    const name = componentName(f.type)
    if (!name || !/^[A-Z]/.test(name) || SKIP_COMPONENTS.test(name) || components.at(-1) === name) continue
    components.push(name)
    if (sources.length < 4) addSource(f)
  }
  return { components: components.reverse(), sources }
}

const ATTRS = ['aria-label', 'placeholder', 'title', 'href', 'role', 'name', 'type', 'alt']
function describe(el: Element): Target {
  const attrs: Record<string, string> = {}
  for (const k of ATTRS) {
    const v = el.getAttribute(k)
    if (v) attrs[k] = clip(v, 80)
  }
  const r = el.getBoundingClientRect()
  return {
    selector: cssPath(el),
    tag: el.localName,
    text: textOf(el),
    attrs,
    ...reactInfo(el),
    rect: roundRect({ x: r.left, y: r.top, w: r.width, h: r.height }),
  }
}

function resolveTarget(t: Target): Element | null {
  let el: Element | null = null
  try {
    el = document.querySelector(t.selector)
  } catch {
    /* 选择器失效 */
  }
  if (el && el.localName === t.tag && (!t.text || textOf(el) === t.text)) return el
  if (t.text) {
    const hit = Array.from(document.getElementsByTagName(t.tag)).find((e) => textOf(e) === t.text)
    if (hit) return hit
  }
  return el && el.localName === t.tag ? el : null
}

// ---------- 状态 ----------
let store: Store = { version: 1, updatedAt: '', annotations: [] }
const ui = {
  mode: false,
  panel: false,
  pins: true,
  collapsed: false,
  pos: null as null | { x: number; y: number },
}
let hoverEl: Element | null = null
let drag: null | { x0: number; y0: number; x1: number; y1: number; moved: boolean } = null
let draft: Draft | null = null
let flashId: string | null = null
let pinHover: string | null = null
let syncState: 'idle' | 'saving' | 'saved' | 'offline' = 'idle'
let dirty = false
let lastRoute = routeKey()

// ---------- DOM ----------
const CSS_TEXT = String.raw`
* { box-sizing: border-box; }
.ui, .pin, .toast, .banner, .hl-label {
  font: 13px/1.45 -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', sans-serif;
  color: #1f1d2b; letter-spacing: 0;
}
.ui { pointer-events: auto; cursor: default; }
button { font: inherit; color: inherit; background: none; border: 0; margin: 0; cursor: pointer; }
button:disabled { opacity: .4; cursor: default; }
kbd { font: 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace; padding: 2px 4px; border-radius: 4px; background: rgba(255,255,255,.14); }

.hl, .band, .focus, .rbox { position: fixed; pointer-events: none; display: none; border-radius: 4px; }
.hl { border: 2px solid #7c5cff; background: rgba(124,92,255,.08); }
.hl-label { position: absolute; left: -2px; bottom: calc(100% + 4px); white-space: nowrap; background: #7c5cff; color: #fff;
  font-size: 11px; font-weight: 600; line-height: 1; padding: 4px 6px; border-radius: 4px; }
.hl.below .hl-label { bottom: auto; top: calc(100% + 4px); }
.hl.quiet .hl-label { display: none; }
.band { border: 2px dashed #7c5cff; background: rgba(124,92,255,.1); }
.focus { border: 2px solid var(--c); box-shadow: 0 0 0 4px color-mix(in srgb, var(--c) 22%, transparent); }
.rbox { display: block; border: 1.5px dashed var(--c); background: color-mix(in srgb, var(--c) 6%, transparent); }

.pin { position: fixed; pointer-events: auto; min-width: 22px; height: 22px; padding: 0 5px; border-radius: 11px 11px 11px 3px;
  color: #fff; font-size: 11px; font-weight: 700; line-height: 22px; text-align: center; cursor: pointer;
  box-shadow: 0 0 0 2px #fff, 0 3px 8px rgba(0,0,0,.25); transform-origin: 0 100%; transition: transform .12s; }
.pin:hover { transform: scale(1.15); }

.banner { position: fixed; top: 10px; left: 50%; transform: translateX(-50%); display: none; pointer-events: none; white-space: nowrap;
  background: rgba(31,29,43,.9); color: #fff; font-size: 12px; padding: 6px 14px; border-radius: 999px; box-shadow: 0 6px 20px -6px rgba(0,0,0,.4); }
.banner.show { display: block; }
.banner b { color: #b9a6ff; }

.bar { position: fixed; display: flex; align-items: center; gap: 2px; padding: 5px; background: #1f1d2b; color: #fff;
  border-radius: 12px; box-shadow: 0 12px 32px -8px rgba(0,0,0,.45); user-select: none; }
.bar button { padding: 6px 10px; border-radius: 8px; color: #d9d6e8; white-space: nowrap; display: inline-flex; align-items: center; gap: 6px; }
.bar button:hover { background: rgba(255,255,255,.09); color: #fff; }
.bar button.on { background: #7c5cff; color: #fff; }
.bar button.primary { background: #fff; color: #1f1d2b; font-weight: 600; }
.bar button.primary:hover { background: #ece9ff; }
.bar .count { min-width: 18px; padding: 0 5px; border-radius: 9px; background: rgba(255,255,255,.16); font-size: 11px; line-height: 18px; text-align: center; }
.bar .dot { width: 7px; height: 7px; border-radius: 50%; background: #6f6b85; }
.bar .on .dot { background: #fff; box-shadow: 0 0 0 3px rgba(255,255,255,.3); }
.grip { padding: 6px 4px 6px 6px; color: #6f6b85; cursor: grab; font-size: 12px; letter-spacing: -2px; }
.bar.collapsed { padding: 0; background: none; box-shadow: none; }
.fab { width: 44px; height: 44px; border-radius: 22px !important; justify-content: center; background: #1f1d2b !important; color: #fff !important;
  box-shadow: 0 10px 28px -6px rgba(0,0,0,.45); position: relative; padding: 0 !important; }
.fab .count { position: absolute; top: -4px; right: -4px; background: #7c5cff; }

.panel { position: fixed; top: 0; right: 0; bottom: 0; width: ${PANEL_W}px; display: flex; flex-direction: column; background: #fff;
  border-left: 1px solid #e9e8ef; box-shadow: -16px 0 40px -16px rgba(22,21,28,.2); transform: translateX(100%); visibility: hidden;
  transition: transform .18s ease, visibility .18s; }
.panel.open { transform: none; visibility: visible; }
.panel header { display: flex; align-items: center; gap: 8px; padding: 14px 12px 12px 16px; border-bottom: 1px solid #efeef4; }
.panel header b { font-size: 14px; }
.muted { color: #908da0; font-size: 12px; }
.sync { font-size: 11px; color: #908da0; display: inline-flex; align-items: center; gap: 4px; }
.sync::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.sync.saved { color: #0d9488; } .sync.offline { color: #e8590c; }
.x { width: 28px; height: 28px; border-radius: 6px; color: #908da0; font-size: 16px; }
.x:hover { background: #f4f3f8; color: #1f1d2b; }
.tools { padding: 10px 16px 0; }
.list { flex: 1; overflow: auto; padding: 4px 12px 16px; }
.group h4 { margin: 14px 4px 6px; display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: #6b6878; }
.group h4 code { font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: #3d3b47; word-break: break-all; }
.here { font-size: 10px; font-weight: 600; color: #6a45f0; background: #f4f1ff; padding: 1px 6px; border-radius: 999px; white-space: nowrap; }
.link { color: #6a45f0; font-size: 12px; margin-left: auto; white-space: nowrap; }
.item { border: 1px solid #ecebf2; border-radius: 10px; padding: 9px 11px; margin-top: 6px; cursor: pointer; transition: border-color .12s, background .12s; }
.item:hover { border-color: #d7ccff; background: #fbfaff; }
.item.flash { border-color: #7c5cff; background: #f4f1ff; }
.item-head { display: flex; align-items: center; gap: 6px; min-width: 0; }
.what { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: #6b6878; }
.miss { font-size: 10px; color: #e8590c; white-space: nowrap; }
.item-body { margin-top: 5px; white-space: pre-wrap; word-break: break-word; }
.item-body em { color: #908da0; font-style: normal; }
.item-acts { display: flex; gap: 12px; margin-top: 6px; font-size: 12px; color: #908da0; }
.item-acts button:hover { color: #1f1d2b; }
.item-acts .danger:hover { color: #e03131; }
.empty { margin: 14px 4px; padding: 14px 16px; border-radius: 10px; background: #f7f7fa; color: #3d3b47; }
.empty ol { margin: 8px 0 0; padding-left: 18px; }
.empty li { margin: 4px 0; }
.empty kbd { background: #e9e8ef; color: #3d3b47; }
.panel footer { display: flex; gap: 8px; align-items: center; padding: 12px 16px; border-top: 1px solid #efeef4; }
.sp { flex: 1; }

.num { flex: none; display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 20px; padding: 0 5px;
  border-radius: 10px; color: #fff; font-size: 11px; font-weight: 700; }
.tag { flex: none; font-size: 11px; font-weight: 600; color: var(--c); background: color-mix(in srgb, var(--c) 12%, #fff);
  padding: 1px 6px; border-radius: 4px; }
.btn { padding: 6px 12px; border-radius: 8px; border: 1px solid #e3e1ec; background: #fff; white-space: nowrap; }
.btn:hover { border-color: #cfcbe0; background: #fafafc; }
.btn.primary { background: #7c5cff; border-color: #7c5cff; color: #fff; font-weight: 600; }
.btn.primary:hover { background: #6a45f0; }
.btn.danger { color: #e03131; }
.btn.ghost { border-color: transparent; }
.btn.block { width: 100%; border-style: dashed; color: #6b6878; }
.btn.block:hover { color: #6a45f0; border-color: #b9a6ff; }

.pop { position: fixed; display: none; width: 340px; padding: 12px; background: #fff; border-radius: 12px;
  box-shadow: 0 18px 44px -12px rgba(22,21,28,.35), 0 0 0 1px rgba(22,21,28,.07); }
.pop-head { display: flex; align-items: center; gap: 8px; }
.pop-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.pop-title code { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; color: #6a45f0; background: #f4f1ff; padding: 1px 4px; border-radius: 4px; }
.mini { padding: 2px 7px; border-radius: 6px; border: 1px solid #e3e1ec; font-size: 12px; color: #6b6878; white-space: nowrap; }
.mini:hover:not(:disabled) { border-color: #b9a6ff; color: #6a45f0; }
.pop-meta { margin-top: 4px; font-size: 11px; color: #908da0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.types { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 8px; }
.types button { padding: 2px 10px; border-radius: 999px; border: 1px solid #e3e1ec; font-size: 12px; color: #6b6878; }
.types button:hover { border-color: var(--c); color: var(--c); }
.types button.on { background: var(--c); border-color: var(--c); color: #fff; }
textarea { display: block; width: 100%; min-height: 88px; max-height: 260px; resize: vertical; padding: 8px 10px; border: 1px solid #e3e1ec;
  border-radius: 8px; font: inherit; color: #1f1d2b; outline: none; user-select: text; cursor: text; }
textarea:focus { border-color: #7c5cff; box-shadow: 0 0 0 3px rgba(124,92,255,.15); }
.pop-foot { display: flex; align-items: center; gap: 6px; margin-top: 10px; }
.hint { font-size: 11px; color: #908da0; }
.shake { animation: shake .32s; }
@keyframes shake { 20%, 60% { transform: translateX(-5px); } 40%, 80% { transform: translateX(5px); } }

.toast { position: fixed; left: 50%; bottom: 84px; max-width: 560px; transform: translate(-50%, 8px); opacity: 0; pointer-events: none;
  background: #1f1d2b; color: #fff; padding: 10px 16px; border-radius: 10px; box-shadow: 0 12px 32px -8px rgba(0,0,0,.4); transition: .2s; }
.toast.show { opacity: 1; transform: translate(-50%, 0); }
`

const host = document.createElement('zy-annotator')
host.style.cssText = 'position:fixed;inset:0;z-index:2147483600;pointer-events:none;display:block;'
const shadow = host.attachShadow({ mode: 'open' })
shadow.innerHTML = `<style>${CSS_TEXT}</style>
<div id="regions"></div>
<div class="hl" id="hl"><span class="hl-label"></span></div>
<div class="band" id="band"></div>
<div class="focus" id="focus"></div>
<div id="pins"></div>
<div class="banner" id="banner"><b>标注模式</b>　点击元素添加标注 · 拖拽框选区域 · <kbd>⌥A</kbd> 切换 · <kbd>Esc</kbd> 退出</div>
<aside class="panel ui" id="panel"></aside>
<div class="pop ui" id="pop"></div>
<div class="bar ui" id="bar"></div>
<div class="toast" id="toast"></div>`

const byId = <T extends HTMLElement = HTMLElement>(id: string) => shadow.getElementById(id) as T
const hl = byId('hl')
const hlLabel = hl.firstElementChild as HTMLElement
const band = byId('band')
const focusBox = byId('focus')
const regionsLayer = byId('regions')
const pinsLayer = byId('pins')
const banner = byId('banner')
const panel = byId('panel')
const pop = byId('pop')
const bar = byId('bar')
const toastEl = byId('toast')
const pinEls = new Map<string, HTMLElement>()
const boxEls = new Map<string, HTMLElement>()

const globalStyle = document.createElement('style')
globalStyle.textContent = `html.zy-annotating, html.zy-annotating body *:not(zy-annotator) { cursor: crosshair !important; user-select: none !important; -webkit-user-select: none !important; }`

// ---------- 持久化 ----------
function persistLocal() {
  try {
    localStorage.setItem(LS_DATA, JSON.stringify({ store, dirty }))
  } catch {
    /* 存储满或被禁用 */
  }
}
function saveUI() {
  localStorage.setItem(LS_UI, JSON.stringify({ pins: ui.pins, collapsed: ui.collapsed, pos: ui.pos, panel: ui.panel }))
}
const payload = () => JSON.stringify({ data: store, markdown: toMarkdown() })

let syncTimer = 0
function scheduleSync() {
  syncState = 'saving'
  renderSync()
  clearTimeout(syncTimer)
  syncTimer = window.setTimeout(syncNow, 500)
}
async function syncNow(): Promise<boolean> {
  clearTimeout(syncTimer)
  syncTimer = 0
  try {
    const r = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload() })
    if (!r.ok) throw new Error(String(r.status))
    syncState = 'saved'
    dirty = false
    persistLocal()
  } catch {
    syncState = 'offline'
  }
  renderSync()
  return syncState === 'saved'
}

function commit() {
  store.updatedAt = now()
  dirty = true
  persistLocal()
  scheduleSync()
  renderBar()
  renderPanel()
  schedule()
}

async function load() {
  let local: { store: Store; dirty: boolean } | null = null
  try {
    local = JSON.parse(localStorage.getItem(LS_DATA) ?? 'null')
  } catch {
    /* 忽略损坏的缓存 */
  }
  try {
    const saved = JSON.parse(localStorage.getItem(LS_UI) ?? 'null')
    if (saved) Object.assign(ui, { pins: saved.pins ?? true, collapsed: !!saved.collapsed, pos: saved.pos ?? null, panel: !!saved.panel })
  } catch {
    /* 同上 */
  }
  let remote: Store | null | undefined
  try {
    const r = await fetch(ENDPOINT)
    if (r.ok) remote = await r.json()
  } catch {
    /* 开发服务器不可达 */
  }
  const valid = (s: Store | null | undefined): s is Store => !!s && Array.isArray(s.annotations)
  if (remote !== undefined && !(local?.dirty && valid(local.store))) {
    // 服务器可达且本地没有未同步的修改：以文件为准（文件被清理时这里也随之清空）
    if (valid(remote)) store = remote
    syncState = valid(remote) ? 'saved' : 'idle'
  } else if (local && valid(local.store)) {
    store = local.store
    dirty = local.dirty
    if (dirty && remote !== undefined) void syncNow()
  }
}

// ---------- Markdown ----------
function groupByRoute(list: Annotation[]) {
  const groups: { route: string; items: Annotation[] }[] = []
  for (const a of list) {
    let g = groups.find((x) => x.route === a.route)
    if (!g) groups.push((g = { route: a.route, items: [] }))
    g.items.push(a)
  }
  return groups
}
const sorted = () => [...store.annotations].sort((a, b) => a.n - b.n)

function targetLabel(a: Annotation): string {
  if (a.kind === 'page') return '页面整体'
  if (a.kind === 'region') return `框选区域 ${a.region?.w}×${a.region?.h}`
  const t = a.target
  return t ? `<${t.tag}> ${t.text ? '“' + clip(t.text, 30) + '”' : ''}` : '元素'
}

function toMarkdown(): string {
  const list = sorted()
  const groups = groupByRoute(list)
  const L: string[] = [
    '# 页面标注反馈',
    '',
    `- 更新时间：${fmtTime(store.updatedAt)}${store.submittedAt ? `（${fmtTime(store.submittedAt)} 点击了“完成并发送”）` : ''}`,
    `- 共 ${list.length} 条，涉及 ${groups.length} 个页面；页面地址前缀 ${location.origin}`,
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
  return L.join('\n')
}

// ---------- 定位 ----------
const cache = new Map<string, { el: Element | null; at: number }>()
function cached(key: string, find: () => Element | null): Element | null {
  const c = cache.get(key)
  const t = performance.now()
  if (c && (c.el ? c.el.isConnected : t - c.at < 800)) return c.el
  const el = find()
  cache.set(key, { el, at: t })
  return el
}
function anchorOf(region: Region): Element | null {
  try {
    return document.querySelector(region.anchor)
  } catch {
    return null
  }
}
function regionRect(region: Region, anchor: Element | null): Rect | null {
  if (!anchor) return null
  const ar = anchor.getBoundingClientRect()
  return { x: ar.left + region.dx, y: ar.top + region.dy, w: region.w, h: region.h }
}
function annElement(a: Annotation): Element | null {
  if (a.kind === 'element' && a.target) {
    const t = a.target
    return cached(a.id, () => resolveTarget(t))
  }
  if (a.kind === 'region' && a.region) {
    const rg = a.region
    return cached(a.id, () => anchorOf(rg))
  }
  return null
}
function annRect(a: Annotation): Rect | null {
  const el = annElement(a)
  if (!el) return null
  return a.kind === 'region' && a.region ? regionRect(a.region, el) : rectOf(el)
}

function pickAt(x: number, y: number): Element | null {
  let el = document.elementFromPoint(x, y)
  if (!el || el === host || el === document.documentElement || el === document.body) return null
  if (el instanceof SVGElement && !(el instanceof SVGSVGElement)) el = el.ownerSVGElement ?? el
  return el
}

function textsIn(r: Rect): string[] {
  const out: string[] = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  let node: Node | null
  let i = 0
  while ((node = walker.nextNode()) && out.length < 12 && i++ < 8000) {
    const t = norm(node.textContent)
    if (!t) continue
    range.selectNodeContents(node)
    const b = range.getBoundingClientRect()
    if (!b.width || b.right < r.x || b.left > r.x + r.w || b.bottom < r.y || b.top > r.y + r.h) continue
    const s = clip(t, 40)
    if (!out.includes(s)) out.push(s)
  }
  return out
}

function buildRegion(r: Rect): { region: Region; center: Element | null } {
  const center = pickAt(r.x + r.w / 2, r.y + r.h / 2)
  // 锚定到“完整包住框选范围”的最近祖先，滚动/布局变化时跟着它走
  let anchor: Element = center ?? document.body
  while (anchor !== document.body && anchor.parentElement) {
    const ar = anchor.getBoundingClientRect()
    if (ar.left <= r.x + 1 && ar.top <= r.y + 1 && ar.right >= r.x + r.w - 1 && ar.bottom >= r.y + r.h - 1) break
    anchor = anchor.parentElement
  }
  const ar = anchor.getBoundingClientRect()
  return {
    center,
    region: {
      anchor: cssPath(anchor),
      dx: Math.round(r.x - ar.left),
      dy: Math.round(r.y - ar.top),
      w: Math.round(r.w),
      h: Math.round(r.h),
      texts: textsIn(r),
    },
  }
}

function navigate(route: string) {
  if (route === routeKey()) return
  // react-router 监听 popstate，这样切页不会整页刷新
  history.pushState({ usr: null, key: uid(), idx: ((history.state?.idx as number) ?? 0) + 1 }, '', route)
  dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
}

function locate(a: Annotation, retry = true) {
  if (a.route !== routeKey()) {
    navigate(a.route)
    if (retry) setTimeout(() => locate(a, false), 400)
    return
  }
  flashId = a.id
  renderPanel()
  if (a.kind !== 'page') {
    const el = annElement(a)
    if (!el) toast('当前页面上找不到这个元素（可能在弹窗、折叠或其他步骤里）')
    else el.scrollIntoView({ block: a.kind === 'region' ? 'nearest' : 'center', behavior: 'smooth' })
  }
  schedule()
  setTimeout(() => {
    if (flashId !== a.id) return
    flashId = null
    renderPanel()
    schedule()
  }, 1600)
}

// ---------- 渲染 ----------
let toastTimer = 0
function toast(msg: string, ms = 2800) {
  toastEl.textContent = msg
  toastEl.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), ms)
}

function shortLabel(el: Element) {
  const comp = reactInfo(el).components.at(-1)
  const r = el.getBoundingClientRect()
  return `${el.localName}${comp ? ' · ' + comp : ''}  ${Math.round(r.width)}×${Math.round(r.height)}`
}
function showHL(el: Element, quiet = false) {
  const r = el.getBoundingClientRect()
  Object.assign(hl.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' })
  hl.classList.toggle('below', r.top < 26)
  hl.classList.toggle('quiet', quiet)
  if (!quiet) hlLabel.textContent = shortLabel(el)
}
const hideHL = () => (hl.style.display = 'none')
function showBox(box: HTMLElement, r: Rect) {
  Object.assign(box.style, { display: 'block', left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' })
}

function placeBar() {
  const s = bar.style
  if (ui.pos) {
    const r = bar.getBoundingClientRect()
    ui.pos = { x: clamp(ui.pos.x, 0, innerWidth - r.width), y: clamp(ui.pos.y, 0, innerHeight - r.height) }
    Object.assign(s, { left: ui.pos.x + 'px', top: ui.pos.y + 'px', right: 'auto', bottom: 'auto' })
  } else {
    Object.assign(s, { left: 'auto', top: 'auto', right: (ui.panel ? PANEL_W + 20 : 20) + 'px', bottom: '20px' })
  }
}

function renderBar() {
  const n = store.annotations.length
  bar.classList.toggle('collapsed', ui.collapsed)
  bar.innerHTML = ui.collapsed
    ? `<button class="fab" data-act="expand" title="展开标注工具">✎<span class="count">${n}</span></button>`
    : `<span class="grip" data-drag title="拖动">⋮⋮</span>
<button data-act="mode" class="${ui.mode ? 'on' : ''}" title="快捷键 ⌥A"><span class="dot"></span>${ui.mode ? '标注中' : '开始标注'}<kbd>⌥A</kbd></button>
<button data-act="panel" class="${ui.panel ? 'on' : ''}">清单<span class="count">${n}</span></button>
<button data-act="pins" title="显示或隐藏页面上的标注点">${ui.pins ? '隐藏标注点' : '显示标注点'}</button>
<button data-act="submit" class="primary">完成并发送</button>
<button data-act="collapse" title="收起">—</button>`
  placeBar()
}

function renderSync() {
  const el = shadow.getElementById('sync')
  if (!el) return
  const text = { idle: '未保存', saving: '保存中…', saved: '已写入 annotations/feedback.md', offline: '未连上开发服务器，仅存本地' }[syncState]
  el.className = 'sync ' + syncState
  el.textContent = text
}

const HELP = `<div class="empty"><b>怎么标注</b><ol>
<li>按 <kbd>⌥A</kbd>（Alt+A）或点「开始标注」进入标注模式</li>
<li>点击页面上的元素写意见；按住拖拽可以框选一块区域</li>
<li>弹窗、下拉、向导后续步骤等：先退出标注模式正常操作到那个状态，再按 <kbd>⌥A</kbd> 标注</li>
<li>没有具体位置的意见，用上方「当前页整体意见」</li>
<li>全部标完点「完成并发送」，回到对话里说“标注好了”</li>
</ol></div>`

function renderItem(a: Annotation, current: boolean) {
  const c = colorOf(a.type)
  const missing = current && a.kind !== 'page' && !annElement(a)
  return `<div class="item ${flashId === a.id ? 'flash' : ''}" data-act="locate" data-id="${a.id}">
<div class="item-head"><span class="num" style="background:${c}">${a.n}</span><span class="tag" style="--c:${c}">${a.type}</span>
<span class="what">${esc(targetLabel(a))}</span>${missing ? '<span class="miss">当前不可见</span>' : ''}</div>
<div class="item-body">${a.comment ? esc(a.comment) : '<em>（无文字说明）</em>'}</div>
<div class="item-acts"><button data-act="edit" data-id="${a.id}">编辑</button><button data-act="del" data-id="${a.id}" class="danger">删除</button></div>
</div>`
}

function renderPanel() {
  panel.classList.toggle('open', ui.panel)
  if (!ui.panel) return
  const list = sorted()
  const cur = routeKey()
  // 当前页的分组排最前
  const groups = groupByRoute(list).sort((a, b) => Number(b.route === cur) - Number(a.route === cur))
  const scroll = shadow.querySelector('.list')?.scrollTop ?? 0
  panel.innerHTML = `<header><b>标注清单</b><span class="muted">${list.length} 条</span><span class="sp"></span><span class="sync" id="sync"></span>
<button class="x" data-act="close-panel" title="关闭">✕</button></header>
<div class="tools"><button class="btn block" data-act="add-page">＋ 当前页整体意见</button></div>
<div class="list">${
    list.length
      ? groups
          .map(
            (g) => `<div class="group"><h4>${g.route === cur ? '<span class="here">当前页</span>' : ''}<code>${esc(g.route)}</code>${
              g.route === cur ? '' : `<button class="link" data-act="goto" data-route="${esc(g.route)}">前往 →</button>`
            }</h4>${g.items.map((a) => renderItem(a, g.route === cur)).join('')}</div>`,
          )
          .join('')
      : HELP
  }</div>
<footer><button class="btn" data-act="copy">复制 Markdown</button><button class="btn ghost danger" data-act="clear">清空</button>
<span class="sp"></span><button class="btn primary" data-act="submit">完成并发送</button></footer>`
  const listEl = shadow.querySelector('.list')
  if (listEl) listEl.scrollTop = scroll
  renderSync()
}

const nextN = () => store.annotations.reduce((m, a) => Math.max(m, a.n), 0) + 1

function draftRect(d: Draft): Rect {
  if (d.existing) {
    const r = annRect(d.existing)
    if (r) return r
  } else if (d.kind === 'region' && d.region) {
    const r = regionRect(d.region, anchorOf(d.region))
    if (r) return r
  } else if (d.el?.isConnected) {
    const r = rectOf(d.el)
    if (r) return r
  }
  return { x: (innerWidth - 340) / 2, y: innerHeight * 0.22, w: 340, h: 0 }
}

function renderPop() {
  if (!draft) {
    pop.style.display = 'none'
    pop.innerHTML = ''
    return
  }
  const d = draft
  const n = d.existing?.n ?? nextN()
  const t = d.existing?.target ?? (d.el && d.kind !== 'page' ? describe(d.el) : undefined)
  let head = ''
  let meta = ''
  if (d.kind === 'page') {
    head = '页面整体意见'
    meta = d.existing?.route ?? routeKey()
  } else if (d.kind === 'region') {
    const rg = d.existing?.region ?? d.region
    head = `框选区域 ${rg?.w}×${rg?.h}`
    meta = rg?.texts.length ? '包含：' + rg.texts.slice(0, 4).join(' / ') : t?.components.join(' › ') ?? ''
  } else if (t) {
    head = `<code>&lt;${t.tag}&gt;</code> ${esc(clip(t.text, 26))}`
    meta = t.components.join(' › ') || t.selector
  }
  const canWalk = d.kind === 'element' && !d.existing
  pop.innerHTML = `<div class="pop-head"><span class="num" id="pop-num" style="background:${colorOf(d.type)}">${n}</span>
<div class="pop-title">${head}</div>${
    canWalk
      ? `<button class="mini" data-act="parent" title="改为标注父元素">↑ 父级</button><button class="mini" data-act="child" title="退回上一个元素" ${d.stack.length ? '' : 'disabled'}>↓</button>`
      : ''
  }</div>
${meta ? `<div class="pop-meta" title="${esc(meta)}">${esc(meta)}</div>` : ''}
<div class="types">${TYPES.map((x) => `<button data-act="type" data-type="${x.key}" class="${x.key === d.type ? 'on' : ''}" style="--c:${x.color}">${x.key}</button>`).join('')}</div>
<textarea placeholder="写下你的意见：改成什么样、为什么…">${esc(d.comment)}</textarea>
<div class="pop-foot">${d.existing ? '<button class="btn ghost danger" data-act="delete">删除</button>' : ''}<span class="hint">⌘/Ctrl+Enter 保存</span><span class="sp"></span>
<button class="btn" data-act="cancel">取消</button><button class="btn primary" data-act="save">保存</button></div>`
  pop.style.display = 'block'
  placePop()
  const ta = pop.querySelector('textarea')
  if (ta) {
    ta.focus()
    ta.setSelectionRange(ta.value.length, ta.value.length)
  }
}

function placePop() {
  if (!draft) return
  const r = draftRect(draft)
  const W = pop.offsetWidth
  const H = pop.offsetHeight
  const m = 10
  const right = innerWidth - (ui.panel ? PANEL_W : 0) - m
  let top = r.y + r.h + m
  if (top + H > innerHeight - m) top = r.y - H - m
  if (top < m) top = clamp(r.y + m, m, innerHeight - H - m)
  pop.style.left = clamp(r.x, m, right - W) + 'px'
  pop.style.top = top + 'px'
}

function shakePop() {
  pop.classList.remove('shake')
  void pop.offsetWidth
  pop.classList.add('shake')
  pop.querySelector('textarea')?.focus()
}

// ---------- 主循环：跟随滚动/布局/路由更新标注点 ----------
let raf = 0
const schedule = () => {
  if (!raf) raf = requestAnimationFrame(update)
}

function syncLayer(map: Map<string, HTMLElement>, layer: HTMLElement, id: string, make: () => HTMLElement) {
  let el = map.get(id)
  if (!el) {
    el = make()
    layer.append(el)
    map.set(id, el)
  }
  return el
}

function update() {
  raf = 0
  const route = routeKey()
  if (route !== lastRoute) {
    lastRoute = route
    cache.clear()
    hoverEl = null
    if (draft && !draft.existing && draft.kind !== 'page') closeDraft()
    renderPanel()
  }

  const vw = innerWidth
  const vh = innerHeight
  const seen = new Set<string>()
  if (ui.pins) {
    for (const a of store.annotations) {
      if (a.route !== route || a.kind === 'page') continue
      const r = annRect(a)
      if (!r || r.y + r.h < 0 || r.y > vh || r.x + r.w < 0 || r.x > vw) continue
      seen.add(a.id)
      const c = colorOf(a.type)
      const pin = syncLayer(pinEls, pinsLayer, a.id, () => {
        const b = document.createElement('button')
        b.className = 'pin'
        b.dataset.act = 'pin'
        b.dataset.id = a.id
        return b
      })
      pin.textContent = String(a.n)
      pin.title = `#${a.n} ${a.type}：${clip(a.comment, 80)}`
      pin.style.background = c
      pin.style.left = clamp(r.x - 4, 2, vw - 28) + 'px'
      pin.style.top = clamp(r.y - 20, 2, vh - 26) + 'px'
      if (a.kind === 'region') {
        const box = syncLayer(boxEls, regionsLayer, a.id, () => {
          const d = document.createElement('div')
          d.className = 'rbox'
          return d
        })
        box.style.setProperty('--c', c)
        showBox(box, r)
      }
    }
  }
  for (const map of [pinEls, boxEls])
    for (const [id, el] of map) {
      if (seen.has(id)) continue
      el.remove()
      map.delete(id)
    }

  const fid = flashId ?? pinHover ?? draft?.existing?.id ?? null
  const fa = fid ? store.annotations.find((a) => a.id === fid) : undefined
  const fr = fa && fa.route === route && fa.kind !== 'page' ? annRect(fa) : null
  if (fa && fr) {
    focusBox.style.setProperty('--c', colorOf(fa.type))
    showBox(focusBox, fr)
  } else focusBox.style.display = 'none'

  if (draft && !draft.existing && draft.kind === 'element' && draft.el?.isConnected) showHL(draft.el, true)
  else if (ui.mode && !draft && !drag && hoverEl?.isConnected) showHL(hoverEl)
  else hideHL()

  if (draft && !draft.existing && draft.kind === 'region') showBox(band, draftRect(draft))
  else if (!drag?.moved) band.style.display = 'none'

  if (draft) placePop()
}

// ---------- 交互 ----------
function setMode(on: boolean) {
  ui.mode = on
  document.documentElement.classList.toggle('zy-annotating', on)
  banner.classList.toggle('show', on)
  if (!on) {
    hoverEl = null
    drag = null
    band.style.display = 'none'
  }
  renderBar()
  schedule()
}

function openDraft(d: Omit<Draft, 'stack' | 'comment' | 'type'> & Partial<Draft>) {
  draft = { stack: [], type: d.existing?.type ?? '修改', comment: d.existing?.comment ?? '', ...d }
  hideHL()
  renderPop()
  schedule()
}
function closeDraft() {
  draft = null
  renderPop()
  schedule()
}
const draftDirty = () => !!draft && draft.comment.trim() !== (draft.existing?.comment ?? '').trim()

function openEdit(a: Annotation) {
  if (a.route !== routeKey()) {
    navigate(a.route)
    setTimeout(() => a.route === routeKey() && openDraft({ kind: a.kind, existing: a }), 400)
    return
  }
  openDraft({ kind: a.kind, existing: a })
}

function saveDraft() {
  if (!draft) return
  const d = draft
  const comment = d.comment.trim()
  if (!comment && d.type !== '删除') {
    shakePop()
    toast('写一句意见再保存（类型选“删除”时可以留空）')
    return
  }
  const t = now()
  if (d.existing) {
    Object.assign(d.existing, { comment, type: d.type, updatedAt: t })
  } else {
    const a: Annotation = {
      id: uid(),
      n: nextN(),
      kind: d.kind,
      type: d.type,
      comment,
      route: routeKey(),
      viewport: { w: innerWidth, h: innerHeight },
      createdAt: t,
      updatedAt: t,
    }
    if (d.el?.isConnected && d.kind !== 'page') a.target = describe(d.el)
    if (d.region) a.region = d.region
    store.annotations.push(a)
  }
  closeDraft()
  commit()
}

function removeAnnotation(id: string) {
  store.annotations = store.annotations.filter((a) => a.id !== id)
  cache.delete(id)
  if (draft?.existing?.id === id) closeDraft()
  commit()
}

async function copyMarkdown(): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(toMarkdown())
    return true
  } catch {
    return false
  }
}

async function submit() {
  if (draft && draftDirty()) {
    shakePop()
    toast('还有一条标注没保存')
    return
  }
  closeDraft()
  const n = store.annotations.length
  if (!n) {
    toast('还没有任何标注')
    return
  }
  store.submittedAt = now()
  store.updatedAt = store.submittedAt
  persistLocal()
  const copied = await copyMarkdown()
  const ok = await syncNow()
  setMode(false)
  if (ok) toast(`已保存 ${n} 条标注到 annotations/feedback.md${copied ? '，Markdown 也已复制' : ''}。回到对话说“标注好了”即可`, 7000)
  else if (copied) toast('写入文件失败，但 Markdown 已复制，直接粘贴到对话里发给我即可', 7000)
  else toast('写入文件和复制都失败了，请打开清单手动复制', 7000)
}

const fromUI = (e: Event) => e.composedPath().includes(host)
const stop = (e: Event) => {
  e.preventDefault()
  e.stopImmediatePropagation()
}

function onAction(act: string, btn: HTMLElement) {
  const id = btn.dataset.id
  const ann = id ? store.annotations.find((a) => a.id === id) : undefined
  switch (act) {
    case 'mode':
      return setMode(!ui.mode)
    case 'panel':
      ui.panel = !ui.panel
      saveUI()
      renderBar()
      renderPanel()
      return schedule()
    case 'close-panel':
      ui.panel = false
      saveUI()
      renderBar()
      return renderPanel()
    case 'pins':
      ui.pins = !ui.pins
      saveUI()
      renderBar()
      return schedule()
    case 'collapse':
    case 'expand':
      ui.collapsed = act === 'collapse'
      saveUI()
      return renderBar()
    case 'submit':
      return void submit()
    case 'copy':
      return void copyMarkdown().then((ok) => toast(ok ? 'Markdown 已复制到剪贴板' : '复制失败'))
    case 'clear':
      if (store.annotations.length && confirm(`确定清空全部 ${store.annotations.length} 条标注？`)) {
        store.annotations = []
        delete store.submittedAt
        cache.clear()
        closeDraft()
        commit()
      }
      return
    case 'add-page':
      return openDraft({ kind: 'page' })
    case 'goto':
      return navigate(btn.dataset.route ?? '/')
    case 'locate':
      return ann && locate(ann)
    case 'pin':
    case 'edit':
      return ann && openEdit(ann)
    case 'del':
      return ann && removeAnnotation(ann.id)
    // 弹层
    case 'type': {
      if (!draft) return
      draft.type = btn.dataset.type as AType
      pop.querySelectorAll<HTMLElement>('.types button').forEach((b) => b.classList.toggle('on', b === btn))
      const num = shadow.getElementById('pop-num')
      if (num) num.style.background = colorOf(draft.type)
      return
    }
    case 'parent': {
      const p = draft?.el?.parentElement
      if (!draft?.el || !p || p === document.body || p === document.documentElement) return
      draft.stack.push(draft.el)
      draft.el = p
      renderPop()
      return schedule()
    }
    case 'child':
      if (!draft?.stack.length) return
      draft.el = draft.stack.pop()
      renderPop()
      return schedule()
    case 'save':
      return saveDraft()
    case 'cancel':
      return closeDraft()
    case 'delete':
      return draft?.existing && removeAnnotation(draft.existing.id)
  }
}

function bindEvents() {
  // 标注工具内部的事件不外泄给页面（避免触发页面的“点击外部关闭”、全局快捷键等）
  shadow.addEventListener('click', (e) => {
    const btn = (e.target as Element).closest<HTMLElement>('[data-act]')
    if (btn && !(btn as HTMLButtonElement).disabled) onAction(btn.dataset.act ?? '', btn)
  })
  for (const type of ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'keydown', 'keyup', 'keypress', 'input', 'focusin', 'focusout', 'wheel'])
    shadow.addEventListener(type, (e) => e.stopPropagation())

  pop.addEventListener('input', (e) => {
    if (draft && e.target instanceof HTMLTextAreaElement) draft.comment = e.target.value
  })
  pinsLayer.addEventListener('pointerover', (e) => {
    pinHover = (e.target as HTMLElement).closest<HTMLElement>('.pin')?.dataset.id ?? null
    schedule()
  })
  pinsLayer.addEventListener('pointerout', () => {
    pinHover = null
    schedule()
  })

  // 工具条拖动
  bar.addEventListener('pointerdown', (e) => {
    const grip = (e.target as Element).closest<HTMLElement>('[data-drag]')
    if (!grip) return
    e.preventDefault()
    const r = bar.getBoundingClientRect()
    const ox = e.clientX - r.left
    const oy = e.clientY - r.top
    grip.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      ui.pos = { x: ev.clientX - ox, y: ev.clientY - oy }
      placeBar()
    }
    const up = () => {
      grip.removeEventListener('pointermove', move)
      grip.removeEventListener('pointerup', up)
      saveUI()
    }
    grip.addEventListener('pointermove', move)
    grip.addEventListener('pointerup', up)
  })

  // 标注模式下拦截页面交互
  for (const type of ['mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'touchstart', 'touchend'])
    window.addEventListener(type, (e) => ui.mode && !fromUI(e) && stop(e), true)

  window.addEventListener(
    'pointerdown',
    (e) => {
      if (!ui.mode || fromUI(e)) return
      stop(e)
      if (e.button !== 0) return
      if (draft) {
        if (draftDirty()) return shakePop()
        closeDraft()
      }
      drag = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, moved: false }
    },
    true,
  )
  window.addEventListener(
    'pointermove',
    (e) => {
      if (!ui.mode) return
      if (drag) {
        drag.x1 = e.clientX
        drag.y1 = e.clientY
        if (!drag.moved && Math.hypot(drag.x1 - drag.x0, drag.y1 - drag.y0) > 6) drag.moved = true
        if (drag.moved) {
          hideHL()
          const x = Math.min(drag.x0, drag.x1)
          const y = Math.min(drag.y0, drag.y1)
          showBox(band, { x, y, w: Math.abs(drag.x1 - drag.x0), h: Math.abs(drag.y1 - drag.y0) })
        }
        return
      }
      if (draft) return
      hoverEl = fromUI(e) ? null : pickAt(e.clientX, e.clientY)
      if (hoverEl) showHL(hoverEl)
      else hideHL()
    },
    true,
  )
  window.addEventListener(
    'pointerup',
    (e) => {
      if (!ui.mode) return
      if (!drag) return void (fromUI(e) || stop(e))
      stop(e)
      const d = drag
      drag = null
      band.style.display = 'none'
      if (d.moved) {
        const r = { x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1), w: Math.abs(d.x1 - d.x0), h: Math.abs(d.y1 - d.y0) }
        if (r.w < 12 || r.h < 12) return
        const { region, center } = buildRegion(r)
        openDraft({ kind: 'region', region, el: center ?? undefined })
      } else {
        const el = pickAt(d.x0, d.y0)
        if (el) openDraft({ kind: 'element', el })
      }
    },
    true,
  )
  window.addEventListener('pointercancel', () => {
    drag = null
    band.style.display = 'none'
  })

  window.addEventListener(
    'keydown',
    (e) => {
      if (e.altKey && !e.metaKey && !e.ctrlKey && e.code === 'KeyA') {
        stop(e)
        return setMode(!ui.mode)
      }
      if (e.key === 'Escape') {
        if (draft) {
          stop(e)
          closeDraft()
        } else if (ui.mode) {
          stop(e)
          setMode(false)
        } else if (ui.panel && fromUI(e)) {
          ui.panel = false
          saveUI()
          renderBar()
          renderPanel()
        }
        return
      }
      if (draft && fromUI(e) && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        stop(e)
        saveDraft()
      }
    },
    true,
  )

  addEventListener('scroll', schedule, { capture: true, passive: true })
  addEventListener('resize', () => {
    placeBar()
    schedule()
  })
  addEventListener('pagehide', () => {
    if (syncTimer) navigator.sendBeacon(ENDPOINT, new Blob([payload()], { type: 'application/json' }))
  })
  new MutationObserver(schedule).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true })
  setInterval(schedule, 400) // 兜底：路由切换、CSS 动画
}

async function init() {
  if (document.querySelector('zy-annotator')) return
  document.head.append(globalStyle)
  document.body.append(host)
  await load()
  renderBar()
  renderPanel()
  bindEvents()
  schedule()
}

void init()

export {}
