/**
 * 看板卡片下钻测试。
 *
 * 验证「点卡片 → URL 带筛选 → 列表精确展示那几条」的完整链路：
 *   1. 列表接口支持 status 多值过滤 / inventory 的 low 预警过滤
 *   2. ListView 从 URL query 读取筛选条件
 *   3. 看板卡片跳转时带上对应参数
 *   4. 卡片数字与列表条数一致（这是用户最直接的体感）
 *
 * 运行：npm run test:drill
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
  localStorage.removeItem('wms_base')   // 避免基地上下文干扰统计
  const r = await api.login(username, '123456')
  localStorage.setItem('wms_token', r.token)
  localStorage.removeItem('wms_base')
  return r.user
}

// ══════════════════════════════════════════════════════════════════════
section('列表接口：多值 status 过滤')
// ══════════════════════════════════════════════════════════════════════

store.clear(); resetDb()
await as('root')

await test('单状态过滤', async () => {
  const rows = await api.list('inbound?status=pending_qc')
  assert.ok(rows.length > 0)
  assert.ok(rows.every((r) => r.status === 'pending_qc'), '状态应全部为 pending_qc')
})

await test('多状态并集过滤（逗号分隔）', async () => {
  const rows = await api.list('inbound?status=draft,pending_qc')
  const want = ['draft', 'pending_qc']
  assert.ok(rows.every((r) => want.includes(r.status)), `状态应为 ${want} 之一`)
  // 应等于两种状态之和
  const a = await api.list('inbound?status=draft')
  const b = await api.list('inbound?status=pending_qc')
  assert.equal(rows.length, a.length + b.length)
})

await test('五类单据都支持 status 过滤', async () => {
  for (const [kind, status] of [
    ['inbound', 'pending_qc'],
    ['outbound', 'pending_review'],
    ['quality', 'qc_ing'],
    ['stocktake', 'counting'],
    ['delivery', 'in_transit']
  ]) {
    const rows = await api.list(`${kind}?status=${status}`)
    assert.ok(rows.every((r) => r.status === status), `${kind} 过滤失败`)
  }
})

await test('空 status 参数不报错', async () => {
  const rows = await api.list('inbound?status=')
  assert.ok(rows.length > 0)
})

// ══════════════════════════════════════════════════════════════════════
section('库存：low 预警过滤')
// ══════════════════════════════════════════════════════════════════════

await test('low=1 只返回低于安全库存的行', async () => {
  const rows = await api.list('inventory?low=1')
  assert.ok(rows.length > 0)
  assert.ok(rows.every((r) => r.low === true), '应全部为 low=true')
})

await test('low 与 status 可叠加', async () => {
  const rows = await api.list('inventory?low=1&status=normal')
  assert.ok(rows.every((r) => r.low === true && r.status === 'normal'))
})

// ══════════════════════════════════════════════════════════════════════
section('卡片数字与列表条数一致（核心体感）')
// ══════════════════════════════════════════════════════════════════════

await test('待入库：卡片数字 = 筛选后列表条数', async () => {
  const d = await api.dashboard()
  const rows = await api.list('inbound?status=draft,pending_qc,qc_ing,pending_shelf')
  assert.equal(rows.length, d.metrics.pending_in,
    `卡片显示 ${d.metrics.pending_in}，列表 ${rows.length} 条`)
})

await test('待出库：卡片数字 = 筛选后列表条数', async () => {
  const d = await api.dashboard()
  const rows = await api.list('outbound?status=pending_review,pending_pick,pending_check')
  assert.equal(rows.length, d.metrics.pending_out)
})

await test('待质检：卡片数字 = 筛选后列表条数', async () => {
  const d = await api.dashboard()
  const rows = await api.list('quality?status=pending_qc,qc_ing')
  assert.equal(rows.length, d.metrics.pending_qc)
})

await test('待配送：卡片数字 = 筛选后列表条数', async () => {
  const d = await api.dashboard()
  const rows = await api.list('delivery?status=pending_review,pending_ship')
  assert.equal(rows.length, d.metrics.pending_delivery)
})

await test('库存预警：卡片数字 = low 列表条数', async () => {
  const d = await api.dashboard()
  const rows = await api.list('inventory?low=1')
  assert.equal(rows.length, d.metrics.stock_alerts,
    `卡片 ${d.metrics.stock_alerts}，列表 ${rows.length}`)
})

// ══════════════════════════════════════════════════════════════════════
section('范围隔离下仍然一致（防止修了总数漏了范围）')
// ══════════════════════════════════════════════════════════════════════

await test('仓库级账号：卡片与列表都在授权范围内且一致', async () => {
  store.clear(); resetDb()
  await as('root')
  await api.setUserWarehouses(1, [1])   // admin 只授权仓库 1
  await as('admin')

  const d = await api.dashboard()
  const rows = await api.list('inbound?status=draft,pending_qc,qc_ing,pending_shelf')
  assert.equal(rows.length, d.metrics.pending_in, '数量应一致')

  const db = getDb()
  assert.ok(rows.every((r) => {
    const doc = db.doc_in.find((x) => x.id === r.id)
    return doc.warehouse_id === 1
  }), '列表应只含仓库1')
})

// ══════════════════════════════════════════════════════════════════════
section('看板跳转参数定义正确')
// ══════════════════════════════════════════════════════════════════════

await test('METRIC_LINKS 每张卡片都带筛选参数', async () => {
  const { readFileSync } = await import('node:fs')
  const path = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const dir = path.dirname(fileURLToPath(import.meta.url))
  const src = readFileSync(path.join(dir, '..', 'src', 'views', 'DashboardView.vue'), 'utf8')

  const block = src.slice(src.indexOf('const METRIC_LINKS'), src.indexOf('function drill'))
  for (const key of ['pending_in', 'pending_out', 'pending_qc', 'pending_delivery', 'stock_alerts']) {
    assert.ok(block.includes(key), `缺少 ${key}`)
  }
  // 5 条映射都应有 query
  const queries = block.match(/query:\s*\{/g) || []
  assert.equal(queries.length, 5, `应有 5 个 query，实际 ${queries.length}`)
})

await test('ListView 从 route.query 读取筛选', async () => {
  const { readFileSync } = await import('node:fs')
  const path = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const dir = path.dirname(fileURLToPath(import.meta.url))
  const src = readFileSync(path.join(dir, '..', 'src', 'views', 'ListView.vue'), 'utf8')
  assert.match(src, /route\.query\.status/)
  assert.match(src, /route\.query\.low/)
  assert.match(src, /clearFilter/)
})

console.log(`\n${'─'.repeat(52)}`)
console.log(`通过 ${passed} 项，失败 ${failed} 项`)
if (failed > 0) process.exit(1)
