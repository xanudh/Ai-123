import { defineConfig, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 本地开发工具：devtools/ 不进仓库，存在时才加载（仅 dev 生效）
const devtools = (): Promise<PluginOption[]> =>
  import(/* @vite-ignore */ new URL('./devtools/annotator/vite-plugin.js', import.meta.url).href).then(
    (m) => [m.annotator()],
    (e) => {
      if (e?.code === 'ERR_MODULE_NOT_FOUND') return []
      throw e
    },
  )

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss(), ...(await devtools())],
  server: { port: 5173, host: '127.0.0.1' },
}))
