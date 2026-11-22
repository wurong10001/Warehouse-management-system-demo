import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// 必须在加载应用之前完成 window/document/history 垫片
await import('./setup-dom.mjs')

const testDir = path.dirname(fileURLToPath(import.meta.url))
const demoRoot = path.resolve(testDir, '..')

// 加载由 Vite 打好包的整个应用（Node 无法直接 import .vue）
const bundlePath = path.join(demoRoot, '.tmp', 'e2e', 'app.mjs')
const { createApp, createPinia, App, router, useAuth, api } =
  await import(pathToFileURL(bundlePath).href)

let passed = 0
let failed = 0
async function test(name, fn) {
  try {
    await fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    failed++
    console.error(`  ✗ ${name}`)
    console.error(`    ${String(e.message).split('\n').slice(0, 4).join('\n    ')}`)
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const appEl = () => document.getElementById('app')
const textOf = () => appEl().textContent || ''

console.log('\n环境')
await test('jsdom 环境就绪', () => {
  assert.ok(globalThis.localStorage)
  assert.ok(appEl())
  assert.equal(typeof window.fetch, 'undefined', 'jsdom 默认没有 fetch，说明不会走网络')
})

// ── 3. 挂载应用 ────────────────────────────────────────────────────────
console.log('\n应用挂载')
let app
await test('Vue 应用能挂载到 #app', async () => {
  app = createApp(App)
  app.use(createPinia())
  app.use(router)
  await router.isReady()
  app.mount('#app')
  await sleep(80)
  assert.ok(appEl().innerHTML.length > 0, '挂载后应有 DOM 内容')
})

// ── 4. 登录页 ──────────────────────────────────────────────────────────
console.log('\n登录页')
await test('未登录访问首页被守卫送到 /login', async () => {
  await router.push('/')
  await sleep(80)
  assert.equal(router.currentRoute.value.name, 'login')
})
await test('登录页渲染标题、输入框、演示账号标签', async () => {
  const html = appEl().innerHTML
  assert.ok(html.includes('备件仓储管理系统'), '应渲染标题')
  assert.ok(document.querySelectorAll('input').length >= 2, '应有账号与密码输入框')
  const buttons = [...document.querySelectorAll('button')]
  assert.ok(buttons.some((b) => b.textContent.includes('登录')), '应有登录按钮')
  assert.ok(buttons.some((b) => b.textContent.trim() === '超管'), '应有演示账号快捷标签')
  assert.ok(buttons.some((b) => b.textContent.includes('重置演示数据')), '应有重置按钮')
})

// ── 5. 登录（库管视角） ────────────────────────────────────────────────
console.log('\n登录 · 库管视角')
const auth = useAuth()

await test('w01 登录成功，菜单按角色下发', async () => {
  await auth.login('w01', '123456')
  assert.equal(auth.user.username, 'w01')
  assert.ok(auth.menus.has('inbound'), '库管应有入库')
  assert.ok(auth.menus.has('inventory'), '库管应有库存')
  assert.ok(!auth.menus.has('system'), '库管不应有用户管理')
})

await test('看板渲染指标卡与待办', async () => {
  await router.push('/')
  await sleep(150)
  assert.equal(router.currentRoute.value.name, 'dashboard')
  const t = textOf()
  assert.ok(t.includes('今日任务'), '应显示看板标题')
  assert.ok(t.includes('今日待入库'), '应显示指标')
  assert.ok(t.includes('库存预警'), '应显示预警指标')
  assert.ok(t.includes('我的待办'), '应显示待办面板')
})

await test('侧边栏按权限过滤，库管看不到「用户与权限」', async () => {
  const t = textOf()
  assert.ok(t.includes('入库管理'), '应出现有权限菜单')
  assert.ok(!t.includes('用户与权限'), '不应出现无权限菜单')
})

// ── 6. 列表页 ──────────────────────────────────────────────────────────
console.log('\n列表页')
await test('入库列表渲染单号与状态标签', async () => {
  await router.push('/inbound')
  await sleep(180)
  const t = textOf()
  assert.ok(t.includes('IN-20261106-003'), '应显示入库单号')
  assert.ok(document.querySelectorAll('.tag').length > 0, '应有状态标签')
})

await test('备件列表渲染供应商与报废标记', async () => {
  await router.push('/parts')
  await sleep(180)
  const t = textOf()
  assert.ok(t.includes('伺服电机'), '应显示备件名')
  assert.ok(t.includes('已报废'), '应显示报废供应商前缀')
  assert.ok(document.querySelectorAll('.list-row, .m-row').length > 0, '应有列表行')
})

await test('搜索接口按编码/名称命中', async () => {
  const rows = await api.list('parts', { q: '伺服' })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].name, '伺服电机')
})

// ── 7. 详情抽屉 ────────────────────────────────────────────────────────
console.log('\n详情抽屉')
await test('点击行打开详情，渲染明细与流程', async () => {
  await router.push('/inbound')
  await sleep(180)
  const row = document.querySelector('.list-row, .m-row')
  assert.ok(row, '应有可点击行')
  row.click()
  await sleep(250)

  const drawer = document.querySelector('.drawer')
  assert.ok(drawer, '应打开详情抽屉')
  const t = drawer.textContent.replace(/\s+/g, ' ')
  assert.ok(t.includes('入库明细'), '应显示明细区块')
  assert.ok(t.includes('单号'), '应显示表头字段')
  assert.ok(t.includes('来源'), '应显示来源字段')
  assert.ok(t.includes('交流接触器') || t.includes('安全继电器'), '应列出明细备件')
  // 明细里应有应入 / 已入 数量（表头列在桌面布局出现，数据值始终在）
  assert.ok(/\d+/.test(t), '应包含数量数据')
})

// ── 8. 库存页 ──────────────────────────────────────────────────────────
console.log('\n库存页')
await test('库存页渲染表头，且只显示本仓库数据', async () => {
  await router.push('/inventory')
  await sleep(200)
  const t = textOf()
  assert.ok(t.includes('库存查询'), '应显示标题')
  assert.ok(t.includes('仓库'), '应有仓库筛选项')
  assert.ok(t.includes('库存状态'), '应有状态筛选')
  // jsdom 是窄视口 → 走移动端卡片布局，表头文字不渲染，但数据行必须存在
  assert.ok(document.querySelectorAll('.m-row, .list-row').length > 0, '应有库存数据行')
  assert.ok(t.includes('正常') || t.includes('不合格'), '应显示库存状态标签')

  const rows = await api.list('inventory')
  assert.ok(rows.length > 0)
  assert.ok(rows.every((r) => r.warehouse_name === '华东中央仓'), 'w01 只应看到华东中央仓')
})

// ── 9. 权限切换 ────────────────────────────────────────────────────────
console.log('\n权限切换 · 超管视角')
await test('root 登录后看到「用户与权限」菜单', async () => {
  await auth.logout()
  await auth.login('root', '123456')
  await router.push('/')
  await sleep(180)
  assert.ok(textOf().includes('用户与权限'), '超管应看到用户管理菜单')
})

await test('用户管理页列出用户并可开添加弹层', async () => {
  await router.push('/system')
  await sleep(250)
  const t = textOf()
  assert.ok(t.includes('用户与权限'), '应显示标题')
  assert.ok(t.includes('w01'), '应列出用户')

  const addBtn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('添加用户'))
  assert.ok(addBtn, '应有添加用户按钮')
  addBtn.click()
  await sleep(200)
  assert.ok(document.body.textContent.includes('所属基地'), '弹层应打开')
  assert.ok(document.body.textContent.includes('权限模式'), '弹层应有权限模式')
})

// ── 10. 纯静态与持久化 ─────────────────────────────────────────────────
console.log('\n纯静态验证')
await test('核心读接口全程零网络请求', async () => {
  let called = 0
  const orig = window.fetch
  window.fetch = (...a) => { called++; return Promise.reject(new Error('不应请求网络')) }
  globalThis.fetch = window.fetch
  try {
    await api.list('parts')
    await api.dashboard()
    await api.detail('inbound', 1)
    await api.roles()
  } finally {
    window.fetch = orig
    delete globalThis.fetch
  }
  assert.equal(called, 0, `不应有任何 fetch，实际 ${called} 次`)
})

await test('整库快照持久化在 localStorage', () => {
  const raw = localStorage.getItem('wms_demo_db_v1')
  assert.ok(raw, 'localStorage 应有快照')
  const db = JSON.parse(raw)
  assert.ok(db.sys_user.length >= 13, '应有 13 个用户')
  assert.equal(db.part.length, 20, '应有 20 个备件')
  assert.equal(db.inventory.length, 19, '应有 19 条库存')
})

await test('权限隔离：库管访问跨范围详情被拒绝', async () => {
  await auth.logout()
  await auth.login('w01', '123456')
  await assert.rejects(() => api.detail('inbound', 4), /不存在或无权查看/)
})

console.log(`\n${'─'.repeat(52)}`)
console.log(`通过 ${passed} 项，失败 ${failed} 项`)
app?.unmount()
process.exit(failed > 0 ? 1 : 0)
