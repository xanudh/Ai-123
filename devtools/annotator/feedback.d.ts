export type AType = '修改' | '新增' | '删除' | 'Bug' | '疑问'

export interface Rect { x: number; y: number; w: number; h: number }
export interface Target {
  selector: string
  tag: string
  text: string
  attrs: Record<string, string>
  components: string[] // 外层 → 内层
  sources: string[] // 源码文件线索：内层 → 外层
  rect: Rect
}
export interface Region { anchor: string; dx: number; dy: number; w: number; h: number; texts: string[] }
export interface Annotation {
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
  /** 改完后标记已完成；重新打开时去掉 */
  status?: 'done'
  doneAt?: string
  /** 改了什么（改的人写） */
  doneNote?: string
}
export interface Store {
  version: 1
  updatedAt: string
  submittedAt?: string
  /** 页面地址前缀，写进 feedback.md */
  origin?: string
  /** 标注者浏览器的时区，feedback.md 里的时间按它显示 */
  tz?: string
  /** 用过的最大编号：删掉已完成的标注后编号也不回退 */
  seq?: number
  annotations: Annotation[]
}

export function fmtTime(iso: string, tz?: string): string
export function clip(s: string, n: number): string
export function isDone(a: Annotation): boolean
export function sortedOf(store: Store): Annotation[]
export function groupByRoute(list: Annotation[]): { route: string; items: Annotation[] }[]
export function targetLabel(a: Annotation): string
export function toMarkdown(store: Store): string
