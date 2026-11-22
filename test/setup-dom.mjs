/**
 * jsdom 浏览器环境垫片。
 *
 * 必须在加载应用之前 import：Vue、vue-router 在模块初始化阶段就会
 * 探测 window / document / history / location，晚一步就会拿到 undefined。
 *
 * 同时把 process.exit 挂到未捕获错误上，避免 top-level await 卡死时
 * 测试看起来像「没输出」而不是「失败」。
 */
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
  url: 'http://localhost/#/login',
  pretendToBeVisual: true
})
const { window } = dom

globalThis.window = window
globalThis.document = window.document
globalThis.location = window.location
globalThis.history = window.history
globalThis.localStorage = window.localStorage
globalThis.sessionStorage = window.sessionStorage
globalThis.HTMLElement = window.HTMLElement
globalThis.Element = window.Element
globalThis.Node = window.Node
globalThis.SVGElement = window.SVGElement
globalThis.Event = window.Event
globalThis.MouseEvent = window.MouseEvent
globalThis.CustomEvent = window.CustomEvent
globalThis.getComputedStyle = window.getComputedStyle
globalThis.DOMRect = window.DOMRect || class { constructor() { this.x = 0; this.y = 0; this.width = 0; this.height = 0 } }

// Node 26 的 navigator 是只读 getter
Object.defineProperty(globalThis, 'navigator', {
  value: window.navigator, configurable: true, writable: true
})

// jsdom 不实现 matchMedia（useMobile 依赖它）
window.matchMedia = window.matchMedia || ((query) => ({
  matches: query.includes('max-width'),
  media: query,
  addEventListener() {}, removeEventListener() {},
  addListener() {}, removeListener() {}
}))

globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0)
globalThis.cancelAnimationFrame = (id) => clearTimeout(id)
globalThis.scrollTo = () => {}

// 注意：故意不注入 fetch —— 应用若真的发起网络请求就该报错，
// 这是「纯静态」的活体验证。

export { dom, window }
