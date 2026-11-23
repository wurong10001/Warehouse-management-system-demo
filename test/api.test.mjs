/**
 * 静态版 API 冒烟测试。
 *
 * 在 Node 里给 mock 层补一个 localStorage 垫片，直接验证
 * 「浏览器数据库 + 接口移植」的行为与原 Fastify 版一致：
 * 登录鉴权、数据范围隔离、列表/筛选/搜索、详情、看板、用户管理。
 *
 * 运行：npm test
 */
import assert from 'node:assert/strict'

// ── localStorage 垫片（Node 没有） ──────────────────────────────────────
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear()
}

const { default: api } = await import('../src/api/index.js')
const { getDb, resetDb } = await import('../src/mock/db.js')
const { sha256 } = await import('../src/mock/sha256.js')

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
    console.error(`    ${e.message}`)
  }
}

function section(title) {
  console.log(`\n${title}`)
}

// ── 1. 密码哈希 ─────────────────────────────────────────────────────────
section('密码哈希')
await test('sha256("123456") 与 SQL 种子一致', () => {
  assert.equal(sha256('123456'), '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92')
})

// ── 2. 登录 ─────────────────────────────────────────────────────────────
section('登录与鉴权')
await test('错误密码被拒绝', async () => {
  await assert.rejects(() => api.login('w01', 'wrong'), /invalid credentials/)
})
await test('停用账号无法登录', async () => {
  const db = getDb()
  const u = db.sys_user.find((x) => x.username === 'd02')
  u.active = false
  await assert.rejects(() => api.login('d02', '123456'), /invalid credentials/)
  u.active = true
})
await test('正确账号返回 token / user / bases', async () => {
  resetDb()
  store.clear()
  const r = await api.login('w01', '123456')
  assert.ok(r.token, 'token 存在')
  assert.equal(r.user.username, 'w01')
  assert.deepEqual(r.bases.map((b) => b.id), [1]) // w01 绑定基地 1
})
await test('未登录调用受保护接口 → unauthorized', async () => {
  store.clear()
  await assert.rejects(() => api.dashboard(), /unauthorized/)
})
await test('me() 返回当前用户', async () => {
  store.clear()
  const { token, user } = await api.login('root', '123456')
  store.set('wms_token', token)
  const r = await api.me()
  assert.equal(r.user.id, user.id)
})

// ── 3. 数据范围隔离 ─────────────────────────────────────────────────────
section('数据范围隔离')
await test('库管员 w01 只看到本仓库库存', async () => {
  store.clear()
  const { token } = await api.login('w01', '123456')
  store.set('wms_token', token)
  const rows = await api.list('inventory')
  assert.ok(rows.length > 0)
  const db = getDb()
  for (const r of rows) {
    const inv = db.inventory.find((i) => i.id === r.id)
    assert.equal(inv.warehouse_id, 1, `库存 ${r.id} 应属于仓库 1`)
  }
})
await test('华南库管 w02 只看到基地 2 的数据', async () => {
  store.clear()
  const { token } = await api.login('w02', '123456')
  store.set('wms_token', token)
  const rows = await api.list('inbound')
  const db = getDb()
  for (const r of rows) assert.equal(db.doc_in.find((d) => d.id === r.id).base_id, 2)
})
await test('总部 root 跟随 X-Base-Id 切换基地', async () => {
  store.clear()
  const { token } = await api.login('root', '123456')
  store.set('wms_token', token)

  store.set('wms_base', '1')
  const east = await api.list('stocktake')
  assert.ok(east.every((r) => getDb().stocktake.find((t) => t.id === r.id).base_id === 1))

  store.set('wms_base', '2')
  const south = await api.list('stocktake')
  assert.ok(south.every((r) => getDb().stocktake.find((t) => t.id === r.id).base_id === 2))
  localStorage.removeItem('wms_base')
})
await test('详情接口跨范围访问返回 404', async () => {
  store.clear()
  const { token } = await api.login('w01', '123456') // 仅仓库 1
  store.set('wms_token', token)
  await assert.rejects(() => api.detail('inbound', 4), /不存在或无权查看/) // 单据 4 属仓库 3
})

// ── 4. 列表 / 搜索 / 筛选 ───────────────────────────────────────────────
section('列表接口')
await test('备件列表返回全部 20 条且有供应商名', async () => {
  store.clear()
  const { token } = await api.login('s01', '123456') // 审计员，无基地绑定
  store.set('wms_token', token)
  const rows = await api.list('parts')
  assert.equal(rows.length, 20)
  assert.ok(rows.every((r) => r.supplier_name))
  assert.ok(rows.some((r) => r.supplier_name.startsWith('已报废')), '含已报废备件')
})
await test('搜索 q 命中编码/名称', async () => {
  const rows = await api.list('parts', { q: '伺服' })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].code, 'P-MTR-001')
})
await test('inventory 支持 warehouse_id + status 过滤', async () => {
  store.clear()
  const { token } = await api.login('root', '123456')
  store.set('wms_token', token)

  const normal = await api.list('inventory?status=unqualified')
  assert.ok(normal.length > 0)
  assert.ok(normal.every((r) => r.status === 'unqualified'))

  const wh1 = await api.list('inventory?warehouse_id=1')
  assert.ok(wh1.length > 0)
  assert.ok(wh1.every((r) => getDb().inventory.find((i) => i.id === r.id).warehouse_id === 1))
})
await test('库存预警 low 标记与安全库存一致', async () => {
  const rows = await api.list('inventory')
  for (const r of rows) {
    const expected = r.avail_qty < r.safe_stock && r.status === 'normal'
    assert.equal(Boolean(r.low), expected, `${r.part_code} low 标记错误`)
  }
})
await test('流水列表按时间倒序且翻译了类型', async () => {
  const rows = await api.list('flow')
  assert.ok(rows.length > 0)
  for (let i = 1; i < rows.length; i++) {
    assert.ok(new Date(rows[i - 1].ts) >= new Date(rows[i].ts), '流水应按 ts 倒序')
  }
  assert.ok(rows.every((r) => r.type && !['in', 'out', 'freeze'].includes(r.type)), '类型应已中文化')
})

// ── 5. 详情 ─────────────────────────────────────────────────────────────
section('详情接口')
await test('入库单详情含明细与剩余量', async () => {
  store.clear()
  const { token } = await api.login('w01', '123456')
  store.set('wms_token', token)
  const d = await api.detail('inbound', 1)
  assert.equal(d.header.no, 'IN-20261101-001')
  assert.equal(d.items.length, 2)
  assert.equal(d.items[0].remain_qty, d.items[0].expect_qty - d.items[0].received_qty)
})
await test('备件详情含库存分布与流水', async () => {
  const d = await api.detail('part', 1)
  assert.equal(d.header.code, 'P-MTR-001')
  assert.ok(Array.isArray(d.stock))
  assert.ok(d.stock.length > 0)
  assert.ok(Array.isArray(d.flows))
})
await test('库存详情含前后数量流水', async () => {
  const d = await api.detail('inventory', 1)
  assert.ok(d.header.part_code)
  assert.ok(d.flows.every((f) => f.before_qty !== undefined && f.after_qty !== undefined))
})
await test('仓库详情含库位数/备件数统计', async () => {
  const d = await api.detail('basedata', 1)
  assert.equal(d.stats.length, 1)
  assert.ok(d.stats[0].bin_count > 0)
})
await test('不存在的单据 → 404', async () => {
  await assert.rejects(() => api.detail('inbound', 9999), /不存在或无权查看/)
})

// ── 6. 看板 ─────────────────────────────────────────────────────────────
section('看板')
await test('看板返回 metrics/todos/alerts/trend/bases', async () => {
  store.clear()
  const { token } = await api.login('root', '123456')
  store.set('wms_token', token)
  store.set('wms_base', '1')
  const d = await api.dashboard()
  for (const k of ['pending_in', 'pending_out', 'pending_qc', 'pending_delivery', 'stock_alerts']) {
    assert.equal(typeof d.metrics[k], 'number', `${k} 应为数字`)
  }
  assert.ok(Array.isArray(d.todos))
  assert.ok(Array.isArray(d.alerts))
  assert.ok(Array.isArray(d.trend))
  assert.ok(d.bases.length >= 1)
  // 状态条口径必须与实际过滤口径一致：
  // 此处设置了 wms_base=1，所以应显示「华东基地」而不是「全部基地」
  // （曾经这里只按 user.base_id 判定，导致切基地后口径不一致）
  assert.equal(d.base_name, '华东基地')

  // 而绑定基地的账号应返回自己的基地名
  store.clear()
  const w01 = await api.login('w01', '123456')
  store.set('wms_token', w01.token)
  const dw = await api.dashboard()
  assert.equal(dw.base_name, '华东基地')
  localStorage.removeItem('wms_base')
})
await test('库管员看板不泄漏其他基地异常单', async () => {
  store.clear()
  const { token } = await api.login('w01', '123456')
  store.set('wms_token', token)
  const d = await api.dashboard()
  const db = getDb()
  for (const a of d.alerts) {
    const dv = db.delivery.find((x) => x.no === a.no)
    if (dv) assert.equal(dv.from_base_id, 1, `配送异常 ${a.no} 不应跨基地`)
  }
})
await test('看板趋势数量与流水一致', async () => {
  store.clear()
  const { token } = await api.login('root', '123456')
  store.set('wms_token', token)
  const d = await api.dashboard()
  const db = getDb()
  const since = Date.now() - 7 * 24 * 3600 * 1000
  const expectIn = db.inventory_flow
    .filter((f) => new Date(f.ts).getTime() > since && f.qty_change > 0)
    .reduce((s, f) => s + f.qty_change, 0)
  const gotIn = d.trend.reduce((s, t) => s + t.in_qty, 0)
  assert.equal(gotIn, expectIn)
})

// ── 7. 用户管理 ─────────────────────────────────────────────────────────
section('用户管理')
await test('非超管不能创建用户', async () => {
  store.clear()
  const { token } = await api.login('w01', '123456')
  store.set('wms_token', token)
  await assert.rejects(() => api.createUser({ username: 'x', name: 'x', password: 'x' }), /仅超级管理员/)
})
await test('超管可创建用户并按角色授权', async () => {
  store.clear()
  const { token } = await api.login('root', '123456')
  store.set('wms_token', token)
  const { id } = await api.createUser({
    username: 'test01', name: '测试员', password: '123456',
    base_id: 1, warehouse_id: 1, role_ids: [1], perm_mode: 'role'
  })
  assert.ok(id > 0)
  const db = getDb()
  const u = db.sys_user.find((x) => x.id === id)
  assert.equal(u.username, 'test01')
  assert.equal(u.base_id, 1)
  assert.ok(db.sys_user_role.some((r) => r.user_id === id && r.role_id === 1))
})
await test('重复账号返回 409', async () => {
  await assert.rejects(() => api.createUser({ username: 'test01', name: 'x', password: 'x' }), /账号已存在/)
})
await test('custom 模式必须至少勾选一个菜单', async () => {
  await assert.rejects(
    () => api.createUser({ username: 'test02', name: 'x', password: 'x', perm_mode: 'custom', menu_keys: [] }),
    /至少勾选一个菜单/
  )
})
await test('custom 模式登录后 menus 来自用户级权限', async () => {
  const { id } = await api.createUser({
    username: 'test03', name: '自定义', password: '123456',
    base_id: 1, perm_mode: 'custom', menu_keys: ['dashboard', 'parts'], role_ids: []
  })
  const r = await api.login('test03', '123456')
  assert.deepEqual(r.user.menus.sort(), ['dashboard', 'parts'])
  assert.equal(r.user.perm_mode, 'custom')
})
await test('不能停用自己', async () => {
  const r = await api.login('root', '123456')
  store.set('wms_token', r.token)
  await assert.rejects(() => api.updateUser(r.user.id, { active: false, name: 'x' }), /不能停用自己/)
})
await test('重置密码后可用新密码登录', async () => {
  const db = getDb()
  const u = db.sys_user.find((x) => x.username === 'test01')
  await api.resetPassword(u.id, 'newpass123')
  const r = await api.login('test01', 'newpass123')
  assert.equal(r.user.username, 'test01')
})
await test('更新用户可切换为自定义权限', async () => {
  const db = getDb()
  const u = db.sys_user.find((x) => x.username === 'test01')
  await api.updateUser(u.id, { name: '测试员2', base_id: 2, warehouse_id: 3, active: true, perm_mode: 'custom', menu_keys: ['dashboard', 'inventory'] })
  const fresh = getDb().sys_user.find((x) => x.id === u.id)
  assert.equal(fresh.name, '测试员2')
  assert.equal(fresh.perm_mode, 'custom')
  assert.equal(getDb().sys_user_permission.filter((p) => p.user_id === u.id).length, 2)
})

// ── 8. 事务 / 持久化 / 重置 ─────────────────────────────────────────────
section('持久化与事务')
await test('重置数据后回到种子状态', async () => {
  resetDb()
  const db = getDb()
  // 14 = 原 13 个演示账号 + 老板 boss（新增审批角色）
  assert.equal(db.sys_user.length, 14)
  assert.equal(db.part.length, 20)
  assert.equal(db.inventory.length, 19)
  assert.equal(db.sys_user_permission.length, 0)
})
await test('写操作已落盘到 localStorage', async () => {
  store.clear()
  const { token } = await api.login('root', '123456')
  store.set('wms_token', token)
  await api.createUser({ username: 'persist01', name: '持久化', password: '123456', role_ids: [1] })
  const raw = localStorage.getItem('wms_demo_db_v1')
  assert.ok(raw, 'localStorage 应有数据')
  assert.ok(raw.includes('persist01'))
})
await test('事务失败整体回滚，不留半写状态', async () => {
  resetDb()
  const before = getDb().sys_user.length
  const { withTransaction } = await import('../src/mock/db.js')
  assert.throws(() => withTransaction((db) => {
    db.sys_user.push({ id: 999, username: 'ghost' })
    throw new Error('boom')
  }), /boom/)
  assert.equal(getDb().sys_user.length, before, '回滚后不应留下 ghost 用户')
  assert.ok(!getDb().sys_user.some((u) => u.username === 'ghost'))
})

// ── 9. 状态机数据完整性 ─────────────────────────────────────────────────
section('种子数据完整性')
await test('所有外键引用都能解析', () => {
  const db = getDb()
  const partIds = new Set(db.part.map((p) => p.id))
  const whIds = new Set(db.warehouse.map((w) => w.id))
  const baseIds = new Set(db.base.map((b) => b.id))

  for (const i of db.inventory) {
    assert.ok(partIds.has(i.part_id), `inventory ${i.id} part_id 无效`)
    assert.ok(whIds.has(i.warehouse_id), `inventory ${i.id} warehouse_id 无效`)
    assert.ok(baseIds.has(i.base_id), `inventory ${i.id} base_id 无效`)
  }
  for (const d of db.doc_in) assert.ok(whIds.has(d.warehouse_id))
  for (const d of db.doc_out) assert.ok(whIds.has(d.warehouse_id))
  for (const it of db.doc_in_item) assert.ok(partIds.has(it.part_id))
})
await test('单据状态均合法', () => {
  const db = getDb()
  const IN = ['draft', 'pending_qc', 'qc_ing', 'pending_shelf', 'completed', 'cancelled']
  const OUT = ['pending_review', 'cancelled', 'pending_pick', 'pending_check', 'completed']
  const DLV = ['pending_review', 'pending_ship', 'shipped', 'in_transit', 'signed', 'partial_signed', 'cancelled', 'exception']
  for (const d of db.doc_in) assert.ok(IN.includes(d.status), d.status)
  for (const d of db.doc_out) assert.ok(OUT.includes(d.status), d.status)
  for (const d of db.delivery) assert.ok(DLV.includes(d.status), d.status)
})
await test('每个角色都有菜单权限', () => {
  const db = getDb()
  for (const r of db.sys_role) {
    const keys = db.sys_permission.filter((p) => p.role_id === r.id)
    assert.ok(keys.length > 0, `角色 ${r.code} 没有任何菜单权限`)
  }
})
await test('所有权限 menu_key 都是前端已注册的菜单', async () => {
  const { MENU } = await import('../src/config/menu.js')
  const valid = new Set(MENU.flatMap((g) => g.items.map((i) => i.key)))
  const db = getDb()
  for (const p of db.sys_permission) {
    assert.ok(valid.has(p.menu_key), `未知菜单 key: ${p.menu_key}（角色 ${p.role_id}）`)
  }
})

// ── 汇总 ────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(52)}`)
console.log(`通过 ${passed} 项，失败 ${failed} 项`)
if (failed > 0) process.exit(1)
