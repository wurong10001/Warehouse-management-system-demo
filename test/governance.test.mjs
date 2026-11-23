/**
 * 仓库权限隔离 + 仓库管理审批流 + 消息系统测试。
 *
 * 覆盖三块需求：
 *   1. 多仓库授权：A 仓员工只能看/管 A 仓，可授权多个仓，可收回
 *   2. 仓库增删走审批：管理员申请 → 老板确认后才执行；删除有保护
 *   3. 消息红点：新单/入库完成/质检结果/审批请求都会生成未读消息
 *
 * 运行：npm run test:governance
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

/** 切换身份登录（不重置数据，否则会抹掉前一步的改动） */
async function as(username) {
  store.delete('wms_token')
  const r = await api.login(username, '123456')
  localStorage.setItem('wms_token', r.token)
  return r.user
}

/** 从零开始一轮干净的数据 */
function fresh() {
  store.clear()
  resetDb()
}

// ══════════════════════════════════════════════════════════════════════
section('多仓库授权：数据范围隔离')
// ══════════════════════════════════════════════════════════════════════

await test('默认库管 w01 只被授权仓库 1', async () => {
  fresh()
  const u = await as('w01')
  assert.deepEqual(u.warehouses, [1])
  const inv = await api.list('inventory')
  const db = getDb()
  const whIds = [...new Set(inv.map((r) => db.inventory.find((i) => i.id === r.id).warehouse_id))]
  assert.deepEqual(whIds, [1], `只应看到仓库1，实际 ${whIds}`)
})

await test('给 w01 追加授权仓库 2 后，可见范围扩大', async () => {
  fresh()
  await as('root')
  await api.setUserWarehouses(2, [1, 2])

  const u = await as('w01')
  assert.deepEqual(u.warehouses.sort(), [1, 2])

  const inv = await api.list('inventory')
  const db = getDb()
  const whIds = [...new Set(inv.map((r) => db.inventory.find((i) => i.id === r.id).warehouse_id))].sort()
  assert.deepEqual(whIds, [1, 2])
})

await test('收回授权后立即恢复到仓库 1', async () => {
  fresh()
  await as('root')
  await api.setUserWarehouses(2, [1, 2])
  await api.setUserWarehouses(2, [1])

  const u = await as('w01')
  assert.deepEqual(u.warehouses, [1])
})

await test('授权列表为空的账号（不限仓库）可看全部仓库', async () => {
  fresh()
  const u = await as('root')
  assert.equal(u.warehouses, null, 'root 的 warehouses 应为 null（不限）')
  const list = await api.warehouses()
  assert.equal(list.length, 4, `应看到全部 4 个仓库，实际 ${list.length}`)
})

await test('仓库账号访问未授权仓库的详情 → 404', async () => {
  fresh()
  await as('w01') // 只有仓库 1
  await assert.rejects(() => api.detail('basedata', 3), /不存在或无权查看/)
})

await test('仓库账号只能给自己授权的仓库建单', async () => {
  fresh()
  await as('w01')
  // 仓库 3 未授权
  await assert.rejects(
    () => api.create('inbound', { base_id: 2, warehouse_id: 3, from_src: 'purchase', items: [{ part_id: 1, expect_qty: 1 }] }),
    /只能操作本仓库|只能操作本基地/
  )
})

// ══════════════════════════════════════════════════════════════════════
section('仓库管理：新增/删除走审批')
// ══════════════════════════════════════════════════════════════════════

/** 造一个空仓库用于删除测试 */
function addDummyWarehouse(id = 90, code = 'WH-TMP-90') {
  getDb().warehouse.push({
    id, base_id: 1, code, name: '临时仓' + id, address: null, manager_id: null,
    created_at: new Date().toISOString()
  })
  return id
}

await test('管理员申请删除空仓库 → 生成待审批，仓库未被删除', async () => {
  fresh()
  addDummyWarehouse(90)
  await as('admin')
  const r = await api.requestDeleteWarehouse(90)
  assert.equal(r.status, 'pending')
  assert.ok(r.requestId > 0)
  // 关键：此时不应真的删除
  assert.ok(getDb().warehouse.some((w) => w.id === 90), '审批通过前仓库必须还在')
})

await test('重复申请同一仓库 → 409', async () => {
  fresh()
  addDummyWarehouse(91)
  await as('admin')
  await api.requestDeleteWarehouse(91)
  await assert.rejects(() => api.requestDeleteWarehouse(91), /已有待审批/)
})

await test('有库位/库存的仓库不能申请删除（deletable=false）', async () => {
  fresh()
  await as('admin')
  const list = await api.warehouses()
  const wh1 = list.find((w) => w.id === 1)
  assert.equal(wh1.deletable, false, '仓库1 有库位库存，应不可删')
})

await test('老板可以看到待审批列表，管理员也能看到自己发起的', async () => {
  fresh()
  addDummyWarehouse(92)
  await as('admin')
  const req = await api.requestDeleteWarehouse(92)

  await as('boss')
  const pendAsBoss = await api.approvals('pending')
  assert.ok(pendAsBoss.some((a) => a.id === req.requestId), '老板应看到待审批')

  await as('admin')
  const asAdmin = await api.approvals()
  assert.ok(asAdmin.some((a) => a.id === req.requestId), '管理员应看到自己发起的')
})

await test('非老板不能执行审批', async () => {
  fresh()
  addDummyWarehouse(93)
  await as('admin')
  const req = await api.requestDeleteWarehouse(93)
  await assert.rejects(() => api.decideApproval(req.requestId, 'approve'), /仅老板/)
})

await test('老板批准后才真正删除仓库', async () => {
  fresh()
  addDummyWarehouse(94)
  await as('admin')
  const req = await api.requestDeleteWarehouse(94)
  assert.ok(getDb().warehouse.some((w) => w.id === 94), '批准前应在')

  await as('boss')
  const r = await api.decideApproval(req.requestId, 'approve')
  assert.equal(r.status, 'approved')
  assert.ok(!getDb().warehouse.some((w) => w.id === 94), '批准后应已删除')
})

await test('老板驳回 → 仓库保持不变', async () => {
  fresh()
  addDummyWarehouse(95)
  await as('admin')
  const req = await api.requestDeleteWarehouse(95)

  await as('boss')
  const r = await api.decideApproval(req.requestId, 'reject', '暂不删除')
  assert.equal(r.status, 'rejected')
  assert.ok(getDb().warehouse.some((w) => w.id === 95), '驳回后仓库必须还在')
})

await test('已处理的请求不能重复审批', async () => {
  fresh()
  addDummyWarehouse(96)
  await as('admin')
  const req = await api.requestDeleteWarehouse(96)
  await as('boss')
  await api.decideApproval(req.requestId, 'approve')
  await assert.rejects(() => api.decideApproval(req.requestId, 'approve'), /已被处理/)
})

await test('管理员申请新增仓库 → 老板批准后才落库', async () => {
  fresh()
  await as('admin')
  const r = await api.requestCreateWarehouse({ base_id: 1, code: 'WH-NEW-01', name: '新仓库' })
  assert.equal(r.status, 'pending')
  assert.ok(!getDb().warehouse.some((w) => w.code === 'WH-NEW-01'), '批准前不应存在')

  await as('boss')
  await api.decideApproval(r.requestId, 'approve')
  assert.ok(getDb().warehouse.some((w) => w.code === 'WH-NEW-01'), '批准后应已创建')
})

await test('新增仓库编码重复 → 提交时即 409', async () => {
  fresh()
  await as('admin')
  await assert.rejects(
    () => api.requestCreateWarehouse({ base_id: 1, code: 'WH-EAST-01', name: '重名' }),
    /编码已存在/
  )
})

// ══════════════════════════════════════════════════════════════════════
section('消息系统与红点')
// ══════════════════════════════════════════════════════════════════════

await test('新建单据产生未读消息', async () => {
  fresh()
  await as('root')
  const before = (await api.messages()).unread
  await api.create('inbound', {
    base_id: 1, warehouse_id: 1, from_src: 'purchase',
    items: [{ part_id: 1, expect_qty: 3 }]
  })
  const after = await api.messages()
  assert.ok(after.unread > before, '应有新的未读消息')
  assert.ok(after.items.some((m) => m.type === 'inbound_created'))
})

await test('入库完成产生消息', async () => {
  fresh()
  await as('root')
  const { id } = await api.create('inbound', {
    base_id: 1, warehouse_id: 1, from_src: 'purchase',
    items: [{ part_id: 1, expect_qty: 2, received_qty: 2, location_id: 1111 }]
  })
  for (const st of ['pending_qc', 'qc_ing', 'pending_shelf', 'completed']) {
    await api.transition('inbound', id, st)
  }
  const m = await api.messages()
  assert.ok(m.items.some((x) => x.type === 'inbound_completed'), '应有入库完成消息')
})

await test('质检不合格产生告警级消息', async () => {
  fresh()
  await as('root')
  const { id } = await api.create('quality', {
    base_id: 1, warehouse_id: 1,
    items: [{ part_id: 1, check_qty: 5, checked_qty: 5, pass_qty: 3, fail_qty: 2, fail_reason: '外观' }]
  })
  await api.transition('quality', id, 'qc_ing')
  await api.transition('quality', id, 'completed')
  const m = await api.messages()
  const qm = m.items.find((x) => x.type === 'quality_result')
  assert.ok(qm, '应有质检结果消息')
  assert.equal(qm.level, 'warn', '不合格应为 warn 级别')
})

await test('标记已读后未读数归零', async () => {
  fresh()
  await as('root')
  await api.create('inbound', { base_id: 1, warehouse_id: 1, from_src: 'purchase', items: [{ part_id: 1, expect_qty: 1 }] })
  assert.ok((await api.messages()).unread > 0)
  await api.markMessagesRead()
  assert.equal((await api.messages()).unread, 0)
})

await test('标记单条已读只影响该条', async () => {
  fresh()
  await as('root')
  await api.create('inbound', { base_id: 1, warehouse_id: 1, from_src: 'purchase', items: [{ part_id: 1, expect_qty: 1 }] })
  await api.create('outbound', { type: 'issue', base_id: 1, warehouse_id: 1, items: [{ part_id: 1, plan_qty: 1 }] })
  const before = await api.messages()
  assert.ok(before.unread >= 2)
  await api.markMessagesRead(before.items[0].id)
  const after = await api.messages()
  assert.equal(after.unread, before.unread - 1)
})

await test('审批请求会通知老板，审批结果会通知申请人', async () => {
  fresh()
  addDummyWarehouse(97)
  await as('admin')
  const req = await api.requestDeleteWarehouse(97)

  await as('boss')
  const bossMsg = await api.messages()
  assert.ok(bossMsg.items.some((m) => m.type === 'approval_request'), '老板应收到审批请求')

  await api.decideApproval(req.requestId, 'approve')

  await as('admin')
  const adminMsg = await api.messages()
  assert.ok(adminMsg.items.some((m) => m.type === 'approval_result'), '申请人应收到审批结果')
})

await test('消息按用户隔离，看不到别人的', async () => {
  fresh()
  await as('root')
  await api.create('inbound', { base_id: 1, warehouse_id: 1, from_src: 'purchase', items: [{ part_id: 1, expect_qty: 1 }] })
  const rootUnread = (await api.messages()).unread
  assert.ok(rootUnread > 0)

  await as('a01') // 会计，与此单据无关
  const accUnread = (await api.messages()).unread
  assert.notEqual(accUnread, rootUnread, '不同用户的未读数不应相同')
})

// ══════════════════════════════════════════════════════════════════════
section('老板角色权限边界')
// ══════════════════════════════════════════════════════════════════════

await test('老板有审批权但没有日常作业写权限', async () => {
  fresh()
  const u = await as('boss')
  assert.ok(u.roles.includes('boss'))
  // 老板不参与入库等作业
  await assert.rejects(
    () => api.create('inbound', { base_id: 1, warehouse_id: 1, from_src: 'purchase', items: [{ part_id: 1, expect_qty: 1 }] }),
    /无写入权限/
  )
})

await test('老板可看全部仓库（不受仓库授权限制）', async () => {
  fresh()
  await as('boss')
  const list = await api.warehouses()
  assert.equal(list.length, 4)
})

await test('boss 账号密码为 123456，可在登录页使用', async () => {
  fresh()
  const u = await as('boss')
  assert.equal(u.username, 'boss')
})

console.log(`\n${'─'.repeat(52)}`)
console.log(`通过 ${passed} 项，失败 ${failed} 项`)
if (failed > 0) process.exit(1)
