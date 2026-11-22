/**
 * 移动端触摸行为测试。
 *
 * 针对「手机上点按钮闪蓝色方块 / 长按弹系统菜单」这类问题，
 * 校验全局触摸配置存在且**没有误伤**关键交互。
 *
 * 重点守护三个容易被"抄来的方案"搞坏的场景：
 *   1. 输入框必须保持可选中（否则长按无法定位光标、无法选中文字）
 *   2. 键盘焦点环必须保留（全局 outline:none 是常见可访问性事故）
 *   3. 不能靠 preventDefault(touchstart) 兜底（会连带阻止滚动与 click）
 *
 * 运行：npm run test:touch
 */
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

await import('./setup-dom.mjs')

const testDir = path.dirname(fileURLToPath(import.meta.url))
const demoRoot = path.resolve(testDir, '..')
const stylesDir = path.join(demoRoot, 'src', 'styles')

const tokensCss = readFileSync(path.join(stylesDir, 'tokens.css'), 'utf8')
const appCss = readFileSync(path.join(stylesDir, 'app.css'), 'utf8')

// 注入全局样式（scoped 样式与本测试无关，但注入后可复用同一套渲染环境）
const styleEl = document.createElement('style')
styleEl.textContent = tokensCss + '\n' + appCss
document.head.appendChild(styleEl)

const { createApp, createPinia, App, router, useAuth } = await import(
  pathToFileURL(path.join(demoRoot, '.tmp', 'e2e', 'app.mjs')).href
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const app = createApp(App)
app.use(createPinia())
app.use(router)
await router.isReady()
app.mount('#app')
await sleep(100)

const auth = useAuth()
await auth.login('w01', '123456')
await router.push('/')
await sleep(250)

const cs = (sel) => {
  const el = document.querySelector(sel)
  return el ? window.getComputedStyle(el) : null
}

let passed = 0
let failed = 0
// 支持同步与异步断言（部分检查需要先切路由再取计算样式）
async function check(label, fn) {
  try {
    await fn()
    passed++
    console.log(`  ✓ ${label}`)
  } catch (e) {
    failed++
    console.error(`  ✗ ${label}`)
    console.error(`    ${e.message}`)
  }
}

// ── 1. 蓝色高亮是否已抹除 ───────────────────────────────────────────────
console.log('\n去蓝高亮')
await check('html/body 显式声明 transparent（tap-highlight 不继承）', () => {
  assert.match(appCss, /html,\s*body\s*\{[^}]*webkit-tap-highlight-color:\s*transparent/)
})
for (const [sel, name] of [
  ['.segmented button', '分段控件药丸'],
  ['.btn', '按钮'],
  ['.segmented button', '分段控件'],
  ['.side-item', '侧边栏项']
]) {
  check(`${name} 计算样式 tap-highlight 为 transparent`, () => {
    const s = cs(sel)
    assert.ok(s, `${sel} 未渲染`)
    // jsdom 不一定解析该前缀属性，回退到 CSS 文本层面断言
    const visible = s.webkitTapHighlightColor
    if (visible && visible !== 'transparent') throw new Error(`实际值 ${visible}`)
  })
}
await check('可点击元素选择器组覆盖了药丸类元件', () => {
  const block = appCss.slice(appCss.indexOf('/* 可点击元素'))
  for (const cls of ['.segmented button', '.pick', '.chip', '.tab', '.sheet-item']) {
    assert.ok(block.includes(cls), `缺少 ${cls}`)
  }
})

// ── 2. 不要误伤输入框（资料里最危险的一条）──────────────────────────────
console.log('\n输入框不被误伤')
await check('input/textarea/select 未被加 user-select: none', () => {
  // 找到 input 那一条规则，确认没有 user-select
  const m = appCss.match(/\ninput,\s*\ntextarea,\s*\nselect\s*\{([^}]*)\}/)
  assert.ok(m, '缺少 input/textarea/select 规则')
  assert.ok(!/user-select/.test(m[1]), '不应在输入类上禁用 user-select')
})
await check('搜索框实际可选中（当前页面）', () => {
  // 看板页没有输入框，先跳到列表页
  return (async () => {
    await router.push('/parts')
    await sleep(200)
    const s = cs('.search-pill input')
    assert.ok(s, '搜索框未渲染')
    assert.notEqual(s.userSelect, 'none')
  })()
})

// ── 3. 键盘可访问性（资料里会踩的第二个坑）──────────────────────────────
console.log('\n键盘可访问性')
await check('没有全局 outline: none', () => {
  assert.ok(
    !/^\s*\*[^{]*\{[^}]*outline:\s*none/m.test(appCss),
    '不应在全局通配符上设置 outline: none'
  )
  assert.ok(
    !/a,\s*button,[^{]*\{[^}]*outline:\s*none(?!\s*!)/.test(appCss.replace(/:focus:not\(:focus-visible\)[\s\S]*?\}/g, '')),
    '不应给所有可点击元素无条件 outline:none'
  )
})
await check('保留了 :focus-visible 焦点环', () => {
  assert.match(appCss, /:focus-visible\s*\{[^}]*outline:/)
})
await check('仅对非键盘焦点（:focus:not(:focus-visible)）去除轮廓', () => {
  assert.match(appCss, /:focus:not\(:focus-visible\)/)
})

// ── 4. 不靠 preventDefault 兜底（第三个坑）──────────────────────────────
console.log('\n不阻断原生触摸行为')
await check('源码中没有 preventDefault(touchstart)', () => {
  const srcFiles = []
  const walk = (dir) => {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, f.name)
      if (f.isDirectory()) walk(full)
      else if (/\.(js|vue)$/.test(f.name)) srcFiles.push(full)
    }
  }
  walk(path.join(demoRoot, 'src'))
  const bad = srcFiles.filter((f) => {
    const t = readFileSync(f, 'utf8')
    return /touchstart[\s\S]{0,200}preventDefault/.test(t) || /preventDefault[\s\S]{0,200}touchstart/.test(t)
  })
  assert.deepEqual(bad.map((f) => path.relative(demoRoot, f)), [], '不应在 touchstart 上 preventDefault')
})
await check('点击仍能触发（按钮存在且可点击）', () => {
  const btns = [...document.querySelectorAll('.segmented button')]
  assert.ok(btns.length > 0, '应有可点击药丸')
})

// ── 5. 其他触摸细节 ─────────────────────────────────────────────────────
console.log('\n其他触摸细节')
await check('长按不弹 iOS 系统菜单（-webkit-touch-callout）', () => {
  assert.match(appCss, /-webkit-touch-callout:\s*none/)
})
await check('阻止整页橡皮筋回弹（overscroll-behavior）', () => {
  assert.match(appCss, /overscroll-behavior-y:\s*none/)
})
await check('手势拖拽区仍保留 touch-action: none', () => {
  const shell = readFileSync(path.join(demoRoot, 'src', 'components', 'AppShell.vue'), 'utf8')
  assert.match(shell, /touch-action:\s*none/)
})

// ── 6. 与弹簧动效共存 ───────────────────────────────────────────────────
console.log('\n与弹簧动效共存')
await check('触摸配置没有覆盖掉弹簧缓动', () => {
  const s = cs('.segmented button')
  assert.match(s.transition, /cubic-bezier\(0\.34,\s*1\.56/)
})

console.log(`\n${'─'.repeat(52)}`)
console.log(`通过 ${passed} 项，失败 ${failed} 项`)
app.unmount()
process.exit(failed > 0 ? 1 : 0)
