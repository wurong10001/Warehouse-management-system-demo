/**
 * E2E 测试的应用入口。
 *
 * Node 不能直接 import .vue 文件，所以先把整个应用（含 SFC、路由、
 * store、api）交给 Vite 打包成一个 SSR bundle，再由测试脚本在
 * jsdom 环境准备好之后动态加载它 —— 顺序很关键：Vue 在模块初始化
 * 时就会读 document，必须让环境垫片先执行。
 */
export { createApp } from 'vue'
export { createPinia } from 'pinia'
export { default as App } from '../src/App.vue'
export { default as router } from '../src/router/index.js'
export { useAuth } from '../src/stores/auth.js'
export { api } from '../src/api/index.js'
