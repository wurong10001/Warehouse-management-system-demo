/**
 * 看板数据范围隔离测试（防跨仓/跨基地泄漏）。
 *
 * 背景：仓库级账号曾经能在看板看到其他仓库/基地的数据，
 * 是用户实测反馈的真实缺陷。本测试逐维度锁死：
 *   metrics / todos / alerts / bases / trend
 *
 * 运行：npm run test:scope
 */
import assert from 'node:assert/strict'

const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear()
}

const { default: api } = await import('../src/api/index.js')
const { getDb, resetDb } = await import('../src/mock/db.js')
const { default: mockApi } = await import('../src/mock/api.js')

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
const section = (t) => console.log(`\n${t}`)

async function as(username) {
  store.delete('wms_token')
  const r = await api.login(username, '123456')
  localStorage.setItem('wms_token', r.token)
  return r.user
}
const fresh = () => { store.clear(); resetDb() }

/** 单据所属仓库（不同类型字段不同） */
function whOf(db, no) {
  const d =
    db.doc_in.find((x) => x.no === no) ||
    db.doc_out.find((x) => x.no === no) ||
    db.quality.find((x) => x.no === no) ||
    db.stocktake.find((x) => x.no === no) ||
    db.delivery.find((x) => x.no === no)
  return d?.warehouse_id ?? d?.from_wh_id ?? null
}

// ══════════════════════════════════════════════════════════════════════
section('仓库级账号：五维度不得泄漏')
// ══════════════════════════════════════════════════════════════════════

fresh()
await as('root')
await api.setUserWarehouses(1, [1]) // admin 只授权仓库 1
await as('admin')

await test('todos 全部来自授权仓库', async () => {
  const d = await api.dashboard()
  const db = getDb()
  const bad = d.todos.filter((t) => whOf(db, t.no) !== 1)
  assert.deepEqual(bad.map((b) => b.no), [], '存在跨仓待办')
})

await test('alerts 全部来自授权仓库', async () => {
  const d = await api.dashboard()
  const db = getDb()
  const bad = d.alerts.filter((a) => whOf(db, a.no) !== 1)
  assert.deepEqual(bad.map((b) => b.no), [], '存在跨仓异常单据')
})

await test('bases 分布不含其他基地（核心泄漏点）', async () => {
  const d = await api.dashboard()
  const names = d.bases.map((b) => b.name)
  assert.ok(!names.includes('华南基地'), `不应出现华南基地，实际 ${names}`)
})

await test('bases 数值等于授权仓库的库存合计', async () => {
  const d = await api.dashboard()
  const db = getDb()
  const expect = db.inventory.filter((i) => i.warehouse_id === 1).reduce((s, i) => s + i.avail_qty, 0)
  const east = d.bases.find((b) => b.name === '华东基地')
  assert.ok(east, '应有华东基地行')
  assert.equal(east.qty, expect, `数值应只含仓库1的库存`)
})

await test('trend 只统计授权仓库的流水', async () => {
  const d = await api.dashboard()
  const db = getDb()
  const since = Date.now() - 7 * 24 * 3600 * 1000
  const expectIn = db.inventory_flow
    .filter((f) => f.warehouse_id === 1 && new Date(f.ts).getTime() > since && f.qty_change > 0)
    .reduce((s, f) => s + f.qty_change, 0)
  const gotIn = d.trend.reduce((s, t) => s + t.in_qty, 0)
  assert.equal(gotIn, expectIn)
})

await test('metrics 各指标均按授权仓库统计', async () => {
  const d = await api.dashboard()
  const db = getDb()
  const expect = {
    pending_in: db.doc_in.filter((x) => ['draft', 'pending_qc', 'qc_ing', 'pending_shelf'].includes(x.status) && x.warehouse_id === 1).length,
    pending_out: db.doc_out.filter((x) => ['pending_review', 'pending_pick', 'pending_check'].includes(x.status) && x.warehouse_id === 1).length,
    pending_qc: db.quality.filter((x) => ['pending_qc', 'qc_ing'].includes(x.status) && x.warehouse_id === 1).length
  }
  for (const [k, v] of Object.entries(expect)) {
    assert.equal(d.metrics[k], v, `${k} 应为 ${v}`)
  }
})

// ══════════════════════════════════════════════════════════════════════
section('多仓授权：统计应合并')
// ══════════════════════════════════════════════════════════════════════

fresh()
await as('root')
await api.setUserWarehouses(1, [1, 2])
await as('admin')

await test('授权 [1,2] 后 stock_alerts 含两仓合计', async () => {
  const d = await api.dashboard()
  const db = getDb()
  const expect = db.inventory.filter((i) => {
    const p = db.part.find((x) => x.id === i.part_id)
    return i.status === 'normal' && i.avail_qty < (p?.safe_stock ?? 0) && [1, 2].includes(i.warehouse_id)
  }).length
  assert.equal(d.metrics.stock_alerts, expect)
  // 且比只授权仓库1时更多（证明真的合并了）
  await as('root')
  await api.setUserWarehouses(1, [1])
  await as('admin')
  const only1 = await api.dashboard()
  assert.ok(d.metrics.stock_alerts > only1.metrics.stock_alerts, '两仓合计应大于单仓')
})

// ══════════════════════════════════════════════════════════════════════
section('不限仓库账号：看全部')
// ══════════════════════════════════════════════════════════════════════

fresh()

await test('root 看板 stats 等于全库统计', async () => {
  await as('root')
  const d = await api.dashboard()
  const db = getDb()
  const allDelivery = db.delivery.filter((x) => ['pending_review', 'pending_ship'].includes(x.status)).length
  assert.equal(d.metrics.pending_delivery, allDelivery)
  assert.equal(d.bases.length, db.base.length, '应看到所有基地')
})

await test('boss 同样不受仓库限制', async () => {
  await as('boss')
  const d = await api.dashboard()
  const db = getDb()
  const allDelivery = db.delivery.filter((x) => ['pending_review', 'pending_ship'].includes(x.status)).length
  assert.equal(d.metrics.pending_delivery, allDelivery)
})

// ══════════════════════════════════════════════════════════════════════
section('切换基地：不跳转（回归防护）')
// ══════════════════════════════════════════════════════════════════════

await test('pickBase 不再包含 router.push', async () => {
  const { readFileSync } = await import('node:fs')
  const path = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const dir = path.dirname(fileURLToPath(import.meta.url))
  const src = readFileSync(path.join(dir, '..', 'src', 'components', 'AppShell.vue'), 'utf8')
  // 找 pickBase 函数体
  const m = src.match(/function pickBase\(id\)\s*\{([\s\S]*?)\n\}/)
  assert.ok(m, '应能找到 pickBase')
  assert.ok(!/router\.push/.test(m[1]), 'pickBase 不应再跳转（会导致切基地被弹回看板）')
})

console.log(`\n${'─'.repeat(52)}`)
console.log(`通过 ${passed} 项，失败 ${failed} 项`)
if (failed > 0) process.exit(1)
