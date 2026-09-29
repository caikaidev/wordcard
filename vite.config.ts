import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // 本地开发：前端跑在 vite，/api 转发给 `npm run dev:api`（wrangler dev）
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
})
