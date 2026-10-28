import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { annotator } from './devtools/annotator/vite-plugin.js'

export default defineConfig({
  // annotator：开发期页面标注工具，仅 dev 生效
  plugins: [react(), tailwindcss(), annotator()],
  server: { port: 5173, host: '127.0.0.1' },
})
