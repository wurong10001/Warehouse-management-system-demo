/**
 * 药丸（pill）弹簧动效测试。
 *
 * 验证目标：所有圆角为 999px 的可点击元素，其 transform 过渡使用的是
 * iOS 风格的过冲缓动 cubic-bezier(0.34, 1.56, 0.64, 1)，而不是普通 ease。
 *
 * ⚠️ 两个测试装置上的坑（都踩过）：
 *   1. SFC scoped 样式的 data-v-* 哈希是**每次构建随机**的。
 *      必须注入与 DOM「同一次构建」产出的 CSS，否则选择器匹配不到，
 *      所有计算样式都会是初始值（曾误判为 border-radius 塌成 0px）。
 *   2. lib 模式构建的 CSS 只含 SFC scoped 样式；因为 app.entry.mjs 没经过
 *      main.js，全局的 tokens.css / app.css 不在里面，必须单独读源码注入。
 *
 * 运行：npm run test:spring
 */
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

await import('./setup-dom.mjs')

const testDir = path.dirname(fileURLToPath(import.meta.url))
const demoRoot = path.resolve(testDir, '..')

// ── 注入 CSS（全局 + scoped，见文件头说明）──────────────────────────────
const stylesDir = path.join(demoRoot, 'src', 'styles')
const globalCss =
  readFileSync(path.join(stylesDir, 'tokens.css'), 'utf8') +
  '\n' +
  readFileSync(path.join(stylesDir, 'app.css'), 'utf8')
const scopedCss = readFileSync(path.join(demoRoot, '.tmp', 'e2e', 'wms-static-demo.css'), 'utf8')

const styleEl = document.createElement('style')
styleEl.textContent = `${globalCss}\n${scopedCss}`
document.head.appendChild(styleEl)

// ── 加载应用 ────────────────────────────────────────────────────────────
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
function check(label, fn) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${label}`)
  } catch (e) {
    failed++
    console.error(`  ✗ ${label}`)
    console.error(`    ${e.message}`)
  }
}

const SPRING = /cubic-bezier\(0\.34,\s*1\.56,\s*0\.64,\s*1\)/

console.log('\n药丸元素：圆角')
for (const [sel, name] of [
  ['.segmented button', '分段控件药丸'],
  ['.btn', '主按钮'],
  ['.tag', '状态标签']
]) {
  check(`${name} 圆角为 999px`, () => {
    const s = cs(sel)
    assert.ok(s, `${sel} 未渲染`)
    assert.equal(s.borderRadius, '999px')
  })
}

console.log('\n药丸元素：弹簧缓动')
for (const [sel, name] of [
  ['.segmented button', '分段控件药丸'],
  ['.btn', '主按钮']
]) {
  check(`${name} 按下/回弹使用过冲缓动`, () => {
    const s = cs(sel)
    assert.ok(s, `${sel} 未渲染`)
    assert.match(s.transition, SPRING, `transition = ${s.transition}`)
  })
  check(`${name} 过渡包含 transform`, () => {
    assert.match(cs(sel).transition, /transform/)
  })
}

console.log('\n动效参数合理性')
check('回弹时长为 0.46s（不拖沓也不生硬）', () => {
  assert.match(cs('.segmented button').transition, /transform 0\.46s/)
})
check('will-change 已声明以启用 GPU 合成', () => {
  assert.equal(cs('.segmented button').willChange, 'transform')
})
check('按下态使用更短的时长（110ms 量级）', () => {
  // :active 不发散匹配，改为在 CSS 文本层面确认
  assert.match(globalCss, /--dur-press:\s*110ms/)
  assert.match(globalCss, /\.btn:active[\s\S]{0,300}var\(--dur-press\)/)
})

console.log('\n可访问性兜底')
check('存在 prefers-reduced-motion 分支', () => {
  assert.match(globalCss, /@media \(prefers-reduced-motion: reduce\)/)
})
check('减弱动效时禁用缩放位移', () => {
  const block = globalCss.slice(globalCss.indexOf('@media (prefers-reduced-motion: reduce)'))
  assert.match(block, /transform:\s*none\s*!important/)
  assert.match(block, /animation:\s*none\s*!important/)
})
check('减弱动效时保留颜色过渡（不是一刀切）', () => {
  const block = globalCss.slice(globalCss.indexOf('@media (prefers-reduced-motion: reduce)'))
  assert.match(block, /transition:\s*background 0\.15s linear/)
})

console.log('\n选中反馈不与按压冲突')
check('分段控件选中态不再叠加 scale 动画', () => {
  // 滑动胶囊已承担选中反馈；若再给 .on 加 scale 动画，
  // 会与弹簧按压的 transform 互相覆盖，按下时看不到缩放
  assert.ok(!/pill-pop/.test(globalCss), 'pill-pop 应已移除')
  const m = globalCss.match(/\.segmented button\.on\s*\{([^}]*)\}/)
  if (m) assert.ok(!/animation/.test(m[1]), '选中态不应有 animation')
})

console.log('\n玻璃材质化（materialize）')
check('定义了 materialize 转场契约', () => {
  assert.match(globalCss, /\.materialize-enter-active/)
  assert.match(globalCss, /\.materialize-leave-active/)
})
check('materialize 同步动画 blur + scale + opacity', () => {
  // 可能有多个同名规则（主定义 + reduced-motion 降级），找含 transition 的那个
  const blocks = [...globalCss.matchAll(/\.materialize-enter-active[\s\S]*?\{([^}]*)\}/g)]
  const main = blocks.find((b) => /backdrop-filter/.test(b[1]))
  assert.ok(main, '缺少 .materialize-enter-active 主定义')
  assert.match(main[1], /backdrop-filter/)
  assert.match(main[1], /transform/)
  assert.match(main[1], /opacity/)
})
check('materialize 起点含 scale 与 blur(0)', () => {
  // 跳过 reduced-motion 降级块（其中 transform: none），找主定义
  const blocks = [...globalCss.matchAll(/\.materialize-enter-from[^{]*\{([^}]*)\}/g)]
  const main = blocks.find((b) => /scale\(/.test(b[1]))
  assert.ok(main, '缺少 .materialize-enter-from 主定义')
  assert.match(main[1], /scale\(var\(--materialize-scale\)\)/)
  assert.match(main[1], /blur\(0px\)/)
})
check('新增 materialize token 已声明', () => {
  assert.match(globalCss, /--materialize-scale:/)
  assert.match(globalCss, /--materialize-travel:/)
  assert.match(globalCss, /--glass-blur:/)
})

console.log('\n可访问性三信号（全局兜底）')
check('prefers-reduced-transparency 提升为全局兜底', () => {
  const m = globalCss.match(/@media \(prefers-reduced-transparency: reduce\)\s*\{([\s\S]*?)\}/)
  assert.ok(m, 'app.css 缺少 prefers-reduced-transparency 全局块')
  assert.match(m[1], /\.glass-nav/)
  assert.match(m[1], /backdrop-filter:\s*none/)
})
check('prefers-contrast: more 全局兜底存在', () => {
  const m = globalCss.match(/@media \(prefers-contrast: more\)\s*\{([\s\S]*?)\}/)
  assert.ok(m, 'app.css 缺少 prefers-contrast 全局块')
  assert.match(m[1], /\.glass-nav/)
  assert.match(m[1], /border:/)
})
check('reduced-motion 下 materialize 退化为纯淡入', () => {
  const block = globalCss.slice(globalCss.indexOf('@media (prefers-reduced-motion: reduce)'))
  assert.match(block, /\.materialize-enter-active/)
  assert.match(block, /opacity 200ms/)
})

console.log(`\n${'─'.repeat(52)}`)
console.log(`通过 ${passed} 项，失败 ${failed} 项`)
app.unmount()
process.exit(failed > 0 ? 1 : 0)
