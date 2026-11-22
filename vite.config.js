import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/**
 * 静态版构建配置。
 * 相对 base：产物可放在 Cloudflare Pages 根目录，也可放子路径（如 /wms/）。
 * 无 proxy —— 后端已整体搬进浏览器，没有任何 HTTP 请求。
 */
export default defineConfig({
  base: './',
  plugins: [vue()],
  server: {
    port: 5173,
    strictPort: true,
    // Termux 上 inotify 配额紧张，与主项目保持一致关闭文件监听；
    // 如果你在普通桌面环境开发，可以删掉这一行以获得热更新。
    watch: null
  },
  build: {
    outDir: 'dist',
    // 简历展示用，保留可读性而非极限压缩
    sourcemap: false,
    chunkSizeWarningLimit: 900
  }
})
