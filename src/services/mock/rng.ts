/** 本地模拟用的可复现随机数：同样的种子得到同样的结果，“换一批”时换种子 */
export type Rng = () => number

export function hash(text: string) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** mulberry32 */
export function rng(seed: number): Rng {
  let a = seed >>> 0 || 1
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function pick<T>(r: Rng, list: readonly T[]): T {
  return list[Math.floor(r() * list.length)]
}

export function shuffle<T>(r: Rng, list: readonly T[]): T[] {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** 截取前 n 个字，超出加省略号 */
export const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n)}…` : text)
