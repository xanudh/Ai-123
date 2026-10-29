// 开发期页面标注工具：仅 vite dev（apply: 'serve'）注入，不进入生产构建
// 标注数据实时写入 <root>/annotations/feedback.json，并由它生成 feedback.md
// feedback.json 被外部改动（如 done.mjs 标记已完成）时重新生成 feedback.md，并通知页面重新读取
import { watch } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { toMarkdown } from './feedback.js'

const ENDPOINT = '/__annotator'

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 5e6) reject(new Error('payload too large'))
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })

export function annotator({ dir = 'annotations' } = {}) {
  let outDir = ''
  return {
    name: 'dev-annotator',
    apply: 'serve',
    config: () => ({ server: { watch: { ignored: [`**/${dir}/**`] } } }),
    configResolved(config) {
      outDir = join(config.root, dir)
    },
    transformIndexHtml: () => [
      { tag: 'script', attrs: { type: 'module', src: '/devtools/annotator/client.ts' }, injectTo: 'body' },
    ],
    async configureServer(server) {
      const file = join(outDir, 'feedback.json')
      // 本插件最近一次写入 / 读到的 feedback.json：用来区分外部改动
      let last = await readFile(file, 'utf8').catch(() => '')

      const write = async (data) => {
        last = JSON.stringify(data, null, 2)
        await mkdir(outDir, { recursive: true })
        await writeFile(file, last)
        await writeFile(join(outDir, 'feedback.md'), toMarkdown(data))
      }

      let timer
      const onExternal = () => {
        clearTimeout(timer)
        timer = setTimeout(async () => {
          const text = await readFile(file, 'utf8').catch(() => '')
          if (!text || text === last) return
          try {
            await write(JSON.parse(text))
            server.ws.send({ type: 'custom', event: 'annotator:changed' })
          } catch {
            /* 写到一半或格式不对：等下一次改动 */
          }
        }, 150)
      }
      await mkdir(outDir, { recursive: true })
      const watcher = watch(outDir, (_, name) => name === 'feedback.json' && onExternal())
      server.httpServer?.once('close', () => watcher.close())

      server.middlewares.use(ENDPOINT, async (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        try {
          if (req.method === 'GET') {
            res.end(await readFile(file, 'utf8').catch(() => 'null'))
            return
          }
          if (req.method === 'POST') {
            await write(JSON.parse(await readBody(req)).data)
            res.end('{"ok":true}')
            return
          }
          res.statusCode = 405
          res.end('{"error":"method not allowed"}')
        } catch (e) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: String(e) }))
        }
      })
    },
  }
}
