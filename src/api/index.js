/**
 * 前端 API 适配层。
 *
 * 与 SQL 版最大的不同只有一处：不再 fetch('/api/...') 打到 Fastify，
 * 而是直接调用浏览器内的 mock/api.js。函数名、参数、返回值形状
 * 与原版保持完全一致，所以 src/views、src/stores 一行都不用改。
 *
 * 所有接口都是同步计算，这里用 `async` 包一层，保持原有 await 写法，
 * 也方便日后换回真实后端时只替换本文件。
 */
import * as mock from '../mock/api.js'

const TOKEN_KEY = 'wms_token'
const BASE_KEY = 'wms_base'

const getToken = () => localStorage.getItem(TOKEN_KEY)
const getBaseId = () => localStorage.getItem(BASE_KEY)

/** 写接口统一上下文：token 与顶栏基地 */
const ctx = () => ({ token: getToken(), baseId: getBaseId() })

/** 浏览器环境判断：Node 测试 / SSR 下没有 location、window */
const hasWindow = typeof window !== 'undefined'
const currentHash = () => (hasWindow ? window.location.hash : '')
function goLogin() {
  if (hasWindow && window.location.hash !== '#/login') window.location.hash = '#/login'
}

function assertLoggedIn() {
  if (!getToken()) throw new Error('unauthorized')
}

/**
 * 统一入口：把 UI 的「请求」翻译成对本地库的调用，
 * 并保留原版的错误语义（401 清 token 跳登录、其余抛 message）。
 */
function call(fn) {
  try {
    return fn()
  } catch (e) {
    if (e.status === 401) {
      localStorage.removeItem(TOKEN_KEY)
      goLogin()
      throw new Error('unauthorized')
    }
    throw new Error(e.message || '操作失败')
  }
}

/** 前端历史遗留写法：api.list('inventory?q=xx&status=normal') —— 拆成 kind + query */
function splitKind(input) {
  const [kind, search = ''] = String(input).split('?')
  const query = {}
  for (const [k, v] of new URLSearchParams(search)) query[k] = v
  return { kind, query }
}

/**
 * 登录专用：这里的 401 表示「账号密码错」，不是「会话过期」，
 * 不能走 call() 的清 token + 跳登录分支，否则界面只会显示 unauthorized。
 */
function callLogin(fn) {
  try {
    return fn()
  } catch (e) {
    throw new Error(e.message || '登录失败')
  }
}

export const api = {
  login: async (username, password) =>
    callLogin(() => mock.login({ username, password })),

  me: async () => call(() => mock.me(getToken(), getBaseId())),

  logout: async () => {
    try { mock.logout(getToken()) } catch { /* 忽略 */ }
    localStorage.removeItem(TOKEN_KEY)
    return { ok: true }
  },

  dashboard: async () => call(() => {
    assertLoggedIn()
    return mock.dashboard({ token: getToken(), baseId: getBaseId() })
  }),

  /**
   * list(kind, params)
   * 兼容两种调用：
   *   api.list('inbound', { q })           → 第二参数传 query
   *   api.list('inventory?q=a&status=b')   → query 拼在 kind 里
   */
  list: async (kind, params = {}) => call(() => {
    assertLoggedIn()
    const { kind: realKind, query } = splitKind(kind)
    return mock.list(realKind, {
      token: getToken(),
      baseId: getBaseId(),
      query: { ...query, ...(params.q ? { q: params.q } : {}) }
    })
  }),

  detail: async (kind, id) => call(() => {
    assertLoggedIn()
    return mock.detail(kind, id, { token: getToken(), baseId: getBaseId() })
  }),

  roles: async () => call(() => {
    assertLoggedIn()
    return mock.roles(getToken())
  }),

  // ── 通用写入（与后端 Fastify 版签名一致，视图层只写一遍） ────────────
  /** 新建；单据自动分配单号 */
  create: async (kind, body) => call(() => {
    assertLoggedIn()
    return mock.create(kind, body, ctx())
  }),

  /** 编辑；仅允许编辑的状态才生效 */
  update: async (kind, id, body) => call(() => {
    assertLoggedIn()
    return mock.update(kind, Number(id), body, ctx())
  }),

  /** 删除；有引用或状态不允许时返回 409 */
  remove: async (kind, id) => call(() => {
    assertLoggedIn()
    return mock.remove(kind, Number(id), ctx())
  }),

  /** 表单下拉数据（基地/仓库/库位/备件/供应商/客户/用户） */
  options: async (kind) => call(() => {
    assertLoggedIn()
    return mock.options(kind, ctx())
  }),

  /** 状态推进（含库存过账，内部幂等） */
  transition: async (kind, id, toStatus, payload) => call(() => {
    assertLoggedIn()
    return mock.transition(kind, Number(id), toStatus, payload || {}, ctx())
  }),

  createUser: async (body) => call(() => mock.createUser(getToken(), body)),

  updateUser: async (id, body) => call(() => mock.updateUser(getToken(), Number(id), body)),

  resetPassword: async (id, password) =>
    call(() => mock.resetPassword(getToken(), Number(id), password)),

  /** 演示专用：重置全部数据回种子状态（简历 demo 的「一键还原」） */
  resetDemoData: async () => {
    mock.resetDb()
    localStorage.removeItem(TOKEN_KEY)
    goLogin()
    return { ok: true }
  },

  health: async () => mock.health()
}

export default api
