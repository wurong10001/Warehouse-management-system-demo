/**
 * 构建 E2E 测试用的应用 bundle。
 *
 * 关键点：用 **client lib 模式**而不是 SSR 模式。
 * SSR 构建会把组件转成服务端渲染代码（useSSRContext 等），在 jsdom 里
 * 跑不起来；lib 模式产出的是普通浏览器 ES 模块，可以直接在 Node 里
 * import —— 前提是 jsdom 垫片已经就位（见 test/setup-dom.mjs）。
 *
 * 用法：node test/build-e2e.mjs
 */
import { build } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const demoRoot = path.resolve(testDir, '..')

await build({
  root: demoRoot,
  configFile: false,
  logLevel: 'warn',
  plugins: [vue()],
  build: {
    target: 'esnext',
    outDir: '.tmp/e2e',
    emptyOutDir: true,
    minify: false,
    cssCodeSplit: false,
    // 把 SFC 的 scoped 样式也抽成文件，测试里注入它就能正确匹配 data-v-*
    // （必须与 DOM 来自同一次构建，否则 scope 哈希对不上）
    lib: {
      entry: path.resolve(testDir, 'app.entry.mjs'),
      formats: ['es'],
      fileName: () => 'app.mjs'
    },
    rollupOptions: {
      // 路由用了 () => import(...)，需内联进单文件产物
      output: { inlineDynamicImports: true }
    }
  }
})

console.log('E2E bundle 构建完成 → .tmp/e2e/app.mjs')
