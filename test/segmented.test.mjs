/**
 * iOS 滑动胶囊（segmented control）测试。
 *
 * 验证的核心不是「有没有动画」，而是：
 *   1. 容器里只有 **一个** 浮起的胶囊（不是每个选项各自切换背景）
 *   2. 胶囊的位置与宽度跟随选中项（translateX + width）
 *   3. 过渡使用弹簧曲线，且有「首次定位不播放动画」的抑制
 *   4. 切换选项后胶囊真的移动了
 *
 * 运行：npm run test:segmented
 */
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

await import('./setup-dom.mjs')

const testDir = path.dirname(fileURLToPath(import.meta.url))
const demoRoot = path.resolve(testDir, '..')

// jsdom 没有布局引擎：offsetLeft/offsetWidth 恒为 0，
// ResizeObserver 也缺失。这里补一个最小垫片让组件能跑起来，
// 并让每个按钮有可预测的尺寸/位置，从而能断言"胶囊移动"。
const BTN_W = 60
const BTN_GAP = 2
window.ResizeObserver = window.ResizeObserver || class {
  observe() {} unobserve() {} disconnect() {}
}
Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', {
  configurable: true,
  get() {
    // 仅对本测试中的分段按钮返回固定宽度
    if (this.tagName === 'BUTTON' && this.closest && this.closest('.segmented')) return BTN_W
    return 0
  }
})
Object.defineProperty(window.HTMLElement.prototype, 'offsetLeft', {
  configurable: true,
  get() {
    if (this.tagName === 'BUTTON' && this.closest && this.closest('.segmented')) {
      const parent = this.parentElement
      const idx = [...parent.querySelectorAll('button')].indexOf(this)
      return idx * (BTN_W + BTN_GAP)
    }
    return 0
  }
})

// 注入全局 + scoped 样式（scoped 必须与 DOM 同源构建）
const globalCss =
  readFileSync(path.join(demoRoot, 'src', 'styles', 'tokens.css'), 'utf8') +
  '\n' +
  readFileSync(path.join(demoRoot, 'src', 'styles', 'app.css'), 'utf8')
const scopedCss = readFileSync(path.join(demoRoot, '.tmp', 'e2e', 'wms-static-demo.css'), 'utf8')
const styleEl = document.createElement('style')
styleEl.textContent = `${globalCss}\n${scopedCss}`
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
await sleep(300)

const cs = (el) => (el ? window.getComputedStyle(el) : null)

let passed = 0
let failed = 0
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

// ── 1. 结构：单一胶囊 ──────────────────────────────────────────────────
console.log('\n结构：只有一个滑动胶囊')
await check('分段控件内存在且仅存在一个 .seg-thumb', () => {
  const segs = document.querySelectorAll('.segmented')
  assert.ok(segs.length > 0, '页面应有分段控件')
  for (const seg of segs) {
    const thumbs = seg.querySelectorAll('.seg-thumb')
    assert.equal(thumbs.length, 1, `每个分段控件应只有 1 个胶囊，实际 ${thumbs.length}`)
  }
})
await check('胶囊在按钮之前渲染（z-index 分层正确）', () => {
  const seg = document.querySelector('.segmented')
  const first = seg.firstElementChild
  assert.ok(first.classList.contains('seg-thumb'), '首个子元素应是胶囊')
})
await check('按钮自身不再有选中背景（背景交给胶囊）', () => {
  const on = document.querySelector('.segmented button.on')
  assert.ok(on, '应有选中按钮')
  const bg = cs(on).backgroundColor
  assert.ok(
    bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)',
    `选中按钮背景应为透明，实际 ${bg}`
  )
})

// ── 2. 胶囊定位 ────────────────────────────────────────────────────────
console.log('\n胶囊定位与宽度')
await check('胶囊有 translateX 与 width 内联样式', () => {
  const thumb = document.querySelector('.seg-thumb')
  assert.match(thumb.getAttribute('style') || '', /translateX\((-?\d+)px\)/)
  assert.match(thumb.getAttribute('style') || '', /width:\s*\d+px/)
})
await check('胶囊宽度等于按钮宽度', () => {
  const seg = document.querySelector('.segmented')
  const thumb = seg.querySelector('.seg-thumb')
  const style = thumb.getAttribute('style')
  const w = Number(style.match(/width:\s*(\d+)px/)[1])
  assert.equal(w, BTN_W, `胶囊宽度应等于按钮宽度 ${BTN_W}`)
})
await check('选中首项时胶囊 left 为 0', () => {
  const seg = document.querySelector('.segmented')
  const onIdx = [...seg.querySelectorAll('button')].findIndex((b) => b.classList.contains('on'))
  const thumb = seg.querySelector('.seg-thumb')
  const x = Number(thumb.getAttribute('style').match(/translateX\((-?\d+)px\)/)[1])
  if (onIdx === 0) assert.equal(x, 0)
})

// ── 3. 切换后胶囊移动 ─────────────────────────────────────────────────
console.log('\n切换选项时胶囊移动')
await check('点击第 2 项后胶囊平移', async () => {
  // 用看板页的"我的待办"分段控件
  const segs = [...document.querySelectorAll('.segmented')]
  const seg = segs.find((s) => s.querySelectorAll('button').length >= 3)
  assert.ok(seg, '应有 >=3 项的分段控件')

  const thumb = seg.querySelector('.seg-thumb')
  const before = Number(thumb.getAttribute('style').match(/translateX\((-?\d+)px\)/)[1])

  const buttons = [...seg.querySelectorAll('button')]
  buttons[1].click()
  await sleep(60)

  const after = Number(thumb.getAttribute('style').match(/translateX\((-?\d+)px\)/)[1])
  assert.notEqual(after, before, '胶囊应移动到新位置')
  assert.equal(after, BTN_W + BTN_GAP, `第 2 项位置应为 ${BTN_W + BTN_GAP}px，实际 ${after}`)
  assert.ok(buttons[1].classList.contains('on'), '第 2 项应变为选中')
})

// ── 4. 弹簧动画 ───────────────────────────────────────────────────────
console.log('\n弹簧动画')
await check('胶囊过渡使用过冲缓动（y=1.56）', () => {
  const thumb = document.querySelector('.seg-thumb')
  const t = cs(thumb).transition
  assert.match(t, /cubic-bezier\(0\.34,\s*1\.56,\s*0\.64,\s*1\)/, `transition=${t}`)
})
await check('过渡属性包含 transform 与 width', () => {
  const thumb = document.querySelector('.seg-thumb')
  const t = cs(thumb).transition
  assert.match(t, /transform/)
  assert.match(t, /width/)
})
await check('will-change 已声明（走合成层，不触发重排）', () => {
  const thumb = document.querySelector('.seg-thumb')
  assert.equal(cs(thumb).willChange.includes('transform'), true)
})
await check('首次定位时禁用过渡（避免从角落飞入）', () => {
  const src = readFileSync(
    path.join(demoRoot, 'src', 'components', 'SegmentedControl.vue'),
    'utf8'
  )
  assert.match(src, /\.no-anim \.seg-thumb\s*\{\s*transition:\s*none/)
  assert.match(src, /instant\.value = false/)
})
await check('prefers-reduced-motion 下不滑动', () => {
  const src = readFileSync(
    path.join(demoRoot, 'src', 'components', 'SegmentedControl.vue'),
    'utf8'
  )
  assert.match(src, /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,120}transition:\s*none/)
})

// ── 5. 无障碍 ─────────────────────────────────────────────────────────
console.log('\n无障碍')
await check('容器有 role=tablist，按钮有 role=tab', () => {
  const seg = document.querySelector('.segmented')
  assert.equal(seg.getAttribute('role'), 'tablist')
  assert.equal(seg.querySelector('button').getAttribute('role'), 'tab')
})
await check('选中按钮 aria-selected=true', () => {
  const seg = document.querySelector('.segmented')
  const on = seg.querySelector('button.on')
  assert.equal(on.getAttribute('aria-selected'), 'true')
})
await check('胶囊 aria-hidden（纯装饰）', () => {
  const thumb = document.querySelector('.seg-thumb')
  assert.equal(thumb.getAttribute('aria-hidden'), 'true')
})

// ── 6. 覆盖范围 ───────────────────────────────────────────────────────
console.log('\n覆盖范围')
await check('所有原 .segmented 容器均已使用新组件结构', () => {
  const segs = [...document.querySelectorAll('.segmented')]
  assert.ok(segs.length > 0)
  const missing = segs.filter((s) => !s.querySelector('.seg-thumb'))
  assert.deepEqual(
    missing.map((s) => s.parentElement?.className),
    [],
    '仍有旧结构的分段控件'
  )
})
await check('顶栏基地切换使用 pills 变体', async () => {
  const pills = document.querySelector('.segmented.pills')
  assert.ok(pills, '应存在 pills 变体')
  assert.ok(pills.querySelector('.seg-thumb'), 'pills 也应有胶囊')
})

// ── 7. 移动端不能换行（回归防护）──────────────────────────────────────
console.log('\n移动端布局防回归')
await check('全局样式中没有给 .segmented 加 flex-wrap', () => {
  const css = readFileSync(path.join(demoRoot, 'src', 'styles', 'app.css'), 'utf8')
  // 曾经为了适配移动端写过 `.segmented { flex-wrap: wrap; }`，
  // 但胶囊靠 offsetLeft 单行定位，换行后必然错位 —— 禁止再出现。
  assert.ok(
    !/\.segmented\s*\{[^}]*flex-wrap\s*:\s*wrap/.test(css),
    '.segmented 不应出现 flex-wrap: wrap'
  )
})

await check('组件自身声明 nowrap + 横向滚动', () => {
  const src = readFileSync(
    path.join(demoRoot, 'src', 'components', 'SegmentedControl.vue'),
    'utf8'
  )
  assert.match(src, /flex-wrap:\s*nowrap/)
  assert.match(src, /overflow-x:\s*auto/)
})

await check('按钮不被压缩（flex: 0 0 auto）', () => {
  const src = readFileSync(
    path.join(demoRoot, 'src', 'components', 'SegmentedControl.vue'),
    'utf8'
  )
  assert.match(src, /\.segmented button\s*\{[^}]*flex:\s*0 0 auto/)
})

await check('切换选项后会把胶囊滚入可视区', () => {
  const src = readFileSync(
    path.join(demoRoot, 'src', 'components', 'SegmentedControl.vue'),
    'utf8'
  )
  assert.match(src, /scrollIntoView/)
})

console.log(`\n${'─'.repeat(52)}`)
console.log(`通过 ${passed} 项，失败 ${failed} 项`)
app.unmount()
process.exit(failed > 0 ? 1 : 0)
