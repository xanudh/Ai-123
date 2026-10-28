// 开发期页面标注工具：仅 vite dev（apply: 'serve'）注入，不进入生产构建
// 标注数据实时写入 <root>/annotations/feedback.json 与 feedback.md
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

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
    configureServer(server) {
      server.middlewares.use(ENDPOINT, async (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        try {
          if (req.method === 'GET') {
            res.end(await readFile(join(outDir, 'feedback.json'), 'utf8').catch(() => 'null'))
            return
          }
          if (req.method === 'POST') {
            const { data, markdown } = JSON.parse(await readBody(req))
            await mkdir(outDir, { recursive: true })
            await writeFile(join(outDir, 'feedback.json'), JSON.stringify(data, null, 2))
            await writeFile(join(outDir, 'feedback.md'), markdown)
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
