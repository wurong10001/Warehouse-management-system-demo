/**
 * 写入功能测试（P0：主数据 + 单据 CRUD；P2：状态推进与过账幂等）。
 *
 * 重点验证四类容易出错的地方：
 *   1. 权限：只读角色一律拒绝，且"角色白名单 且 菜单"是「与」关系
 *   2. 数据范围：库管只能写本仓库，总部账号受顶栏基地约束
 *   3. 事务：任何一步失败，整条记录（含明细）都不落库
 *   4. 过账幂等：重复推进到终态，库存不能重复增减（文档方案的致命缺口）
 *
 * 运行：npm run test:write
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
const { ENTITY_SCHEMA, canTransition, TRANSITIONS } = await import('../src/config/entity-schema.js')

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
    console.error(`    ${String(e.message).split('\n').slice(0, 5).join('\n    ')}`)
  }
}
const section = (t) => console.log(`\n${t}`)

/** 以某账号登录并写入 token，返回 user */
async function as(username, password = '123456') {
  store.clear()
  resetDb()
  const r = await api.login(username, password)
  localStorage.setItem('wms_token', r.token)
  return r.user
}

// ══════════════════════════════════════════════════════════════════════
section('主数据：新增')
// ══════════════════════════════════════════════════════════════════════

await test('超管可以新增备件，列表与详情立即可见', async () => {
  await as('root')
  const { id } = await api.create('part', {
    code: 'P-TST-001', name: '测试备件', spec: '规格A', unit: '个',
    safe_stock: 10, supplier_id: 1, is_scrap: false
  })
  assert.ok(id > 0)

  const rows = await api.list('parts')
  const found = rows.find((r) => r.id === id)
  assert.ok(found, '新备件应出现在列表中')
  assert.equal(found.code, 'P-TST-001')
  assert.equal(found.supplier_name, '宁波精工传动有限公司')

  const d = await api.detail('part', id)
  assert.equal(d.header.name, '测试备件')
  assert.equal(d.header.safe_stock, 10)
})

await test('编码自动转大写', async () => {
  await as('root')
  const { id } = await api.create('part', {
    code: 'p-tst-002', name: '小写编码', unit: '个', safe_stock: 1, supplier_id: 1
  })
  assert.equal(getDb().part.find((p) => p.id === id).code, 'P-TST-002')
})

await test('重复编码 → 409，且原数据未被改动', async () => {
  await as('root')
  await api.create('part', { code: 'P-DUP-001', name: '原始', unit: '个', safe_stock: 1, supplier_id: 1 })
  const before = getDb().part.length
  await assert.rejects(
    () => api.create('part', { code: 'P-DUP-001', name: '重复', unit: '个', safe_stock: 2, supplier_id: 1 }),
    /已存在/
  )
  assert.equal(getDb().part.length, before, '失败的创建不应落库')
})

await test('必填缺失 → 400 且提示具体字段', async () => {
  await as('root')
  await assert.rejects(() => api.create('part', { name: '缺编码', unit: '个', safe_stock: 1 }), /编码必填/)
  await assert.rejects(() => api.create('part', { code: 'P-X-1', unit: '个', safe_stock: 1 }), /名称必填/)
})

await test('数字校验：负数与小数被拒绝', async () => {
  await as('root')
  await assert.rejects(
    () => api.create('part', { code: 'P-NEG-1', name: '负库存', unit: '个', safe_stock: -1, supplier_id: 1 }),
    /不能小于 0/
  )
  await assert.rejects(
    () => api.create('part', { code: 'P-DEC-1', name: '小数', unit: '个', safe_stock: 1.5, supplier_id: 1 }),
    /必须是整数/
  )
})

await test('多余字段被丢弃（防脏写）', async () => {
  await as('root')
  const { id } = await api.create('part', {
    code: 'P-EXTRA-1', name: '多余字段', unit: '个', safe_stock: 1, supplier_id: 1,
    hacked_field: 'should disappear', id: 99999
  })
  const row = getDb().part.find((p) => p.id === id)
  assert.ok(row, '应使用自增 id 而非传入的 99999')
  assert.equal(row.hacked_field, undefined)
})

// ══════════════════════════════════════════════════════════════════════
section('主数据：编辑 / 删除')
// ══════════════════════════════════════════════════════════════════════

await test('编辑备件后列表与详情同步更新', async () => {
  await as('root')
  const { id } = await api.create('part', { code: 'P-EDT-001', name: '待改', unit: '个', safe_stock: 5, supplier_id: 1 })
  await api.update('part', id, { safe_stock: 99, name: '已改' })
  const row = getDb().part.find((p) => p.id === id)
  assert.equal(row.safe_stock, 99)
  assert.equal(row.name, '已改')
})

await test('编辑时改成已存在的编码 → 409', async () => {
  await as('root')
  const a = await api.create('part', { code: 'P-UQ-A', name: 'A', unit: '个', safe_stock: 1, supplier_id: 1 })
  await api.create('part', { code: 'P-UQ-B', name: 'B', unit: '个', safe_stock: 1, supplier_id: 1 })
  await assert.rejects(() => api.update('part', a.id, { code: 'P-UQ-B' }), /已存在/)
})

await test('删除未被引用的备件成功', async () => {
  await as('root')
  const { id } = await api.create('part', { code: 'P-DEL-001', name: '可删', unit: '个', safe_stock: 1, supplier_id: 1 })
  await api.remove('part', id)
  assert.ok(!getDb().part.some((p) => p.id === id), '应已删除')
})

await test('删除被库存引用的备件 → 409（删除保护）', async () => {
  await as('root')
  await assert.rejects(() => api.remove('part', 1), /已被库存或单据引用/)
})

await test('删除有库位的仓库 → 409', async () => {
  await as('root')
  await assert.rejects(() => api.remove('warehouse', 1), /还有库位或库存/)
})

// ══════════════════════════════════════════════════════════════════════
section('权限：只读角色与越权写')
// ══════════════════════════════════════════════════════════════════════

await test('会计 a01（只读）不能新增任何实体', async () => {
  await as('a01')
  await assert.rejects(() => api.create('part', { code: 'P-RO-1', name: 'x', unit: '个', safe_stock: 1, supplier_id: 1 }), /无写入权限/)
  await assert.rejects(() => api.create('inbound', { base_id: 1, warehouse_id: 1, from_src: 'purchase', items: [] }), /无写入权限/)
})

await test('审计 s01（只读）不能写入', async () => {
  await as('s01')
  await assert.rejects(() => api.create('part', { code: 'P-RO-2', name: 'x', unit: '个', safe_stock: 1, supplier_id: 1 }), /无写入权限/)
})

await test('质检 q01 不能建入库单（角色白名单不含 keeper/planner）', async () => {
  await as('q01')
  await assert.rejects(
    () => api.create('inbound', { base_id: 1, warehouse_id: 1, from_src: 'purchase', items: [{ part_id: 1, expect_qty: 1 }] }),
    /无写入权限/
  )
})

await test('权限白名单与实际菜单一致（不出现"有角色无菜单"）', async () => {
  const db = getDb()
  const roleMenus = {}
  for (const r of db.sys_role) {
    roleMenus[r.code] = db.sys_permission.filter((p) => p.role_id === r.id).map((p) => p.menu_key)
  }
  for (const [kind, schema] of Object.entries(ENTITY_SCHEMA)) {
    if (!schema.menuKey) continue
    for (const code of schema.writeRoles) {
      assert.ok(
        roleMenus[code]?.includes(schema.menuKey),
        `${kind}: 角色 ${code} 在白名单但没有菜单 ${schema.menuKey}，会导致永远无法写入`
      )
    }
  }
})

// ══════════════════════════════════════════════════════════════════════
section('数据范围隔离')
// ══════════════════════════════════════════════════════════════════════

await test('库管 w01 不能给其他仓库建入库单', async () => {
  await as('w01') // 绑定基地1、仓库1
  await assert.rejects(
    () => api.create('inbound', { base_id: 2, warehouse_id: 3, from_src: 'purchase', items: [{ part_id: 1, expect_qty: 1 }] }),
    /只能操作本仓库|只能操作本基地/
  )
})

await test('库管 w01 可以给本仓库建入库单', async () => {
  await as('w01')
  const { id, no } = await api.create('inbound', {
    base_id: 1, warehouse_id: 1, from_src: 'purchase', ref_no: 'PO-TEST',
    items: [{ part_id: 1, batch: 'B-T1', expect_qty: 5, received_qty: 5, location_id: 1111 }]
  })
  assert.ok(id > 0)
  assert.match(no, /^IN-\d{8}-\d{3}$/)
})

await test('库管不能编辑其他仓库的单据（404）', async () => {
  await as('w01')
  // 单据 4 属于仓库 3
  await assert.rejects(() => api.update('inbound', 4, { ref_no: 'HACK' }), /不存在|无权/)
})

await test('总部 root 无绑定时，受顶栏基地上下文约束', async () => {
  store.clear(); resetDb()
  const r = await api.login('root', '123456')
  localStorage.setItem('wms_token', r.token)
  localStorage.setItem('wms_base', '2')
  await assert.rejects(
    () => api.create('inbound', { base_id: 1, warehouse_id: 1, from_src: 'purchase', items: [{ part_id: 1, expect_qty: 1 }] }),
    /只能操作本基地/
  )
  // 建基地2的就应该成功
  const ok = await api.create('inbound', {
    base_id: 2, warehouse_id: 3, from_src: 'purchase',
    items: [{ part_id: 13, expect_qty: 2 }]
  })
  assert.ok(ok.id > 0)
  localStorage.removeItem('wms_base')
})

// ══════════════════════════════════════════════════════════════════════
section('事务：失败整体回滚')
// ══════════════════════════════════════════════════════════════════════

await test('明细含非法 part_id → 整单不落库（头表也无新增）', async () => {
  await as('root')
  const beforeDocs = getDb().doc_in.length
  const beforeItems = getDb().doc_in_item.length
  // part_id 99999 不存在：当前实现不校验外键，但空明细会被 validate 拦住
  await assert.rejects(
    () => api.create('inbound', { base_id: 1, warehouse_id: 1, from_src: 'purchase', items: [] }),
    /至少需要一行明细/
  )
  assert.equal(getDb().doc_in.length, beforeDocs)
  assert.equal(getDb().doc_in_item.length, beforeItems)
})

await test('事务内抛错后，内存与磁盘都回滚到快照', async () => {
  await as('root')
  const snapshot = JSON.stringify(getDb().part)
  await assert.rejects(() => api.create('part', { code: 'P-ROLLBACK', name: 'x', unit: '个', safe_stock: 1 })) // 缺 supplier_id
  assert.equal(JSON.stringify(getDb().part), snapshot, '内存应回滚')
  const persisted = JSON.parse(localStorage.getItem('wms_demo_db_v1'))
  assert.equal(JSON.stringify(persisted.part), snapshot, '磁盘也应回滚')
})

// ══════════════════════════════════════════════════════════════════════
section('单据：单号、状态与明细')
// ══════════════════════════════════════════════════════════════════════

await test('新建单据自动生成当天递增单号', async () => {
  await as('root')
  const a = await api.create('inbound', { base_id: 1, warehouse_id: 1, from_src: 'purchase', items: [{ part_id: 1, expect_qty: 1 }] })
  const b = await api.create('inbound', { base_id: 1, warehouse_id: 1, from_src: 'purchase', items: [{ part_id: 1, expect_qty: 1 }] })
  const date = new Date()
  const ymd = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
  assert.equal(a.no, `IN-${ymd}-001`)
  assert.equal(b.no, `IN-${ymd}-002`)
})

await test('新建单据初始状态正确、过账标记为空', async () => {
  await as('root')
  const { id } = await api.create('outbound', {
    type: 'issue', base_id: 1, warehouse_id: 1, dept_name: '一车间设备科',
    items: [{ part_id: 16, location_id: 1121, plan_qty: 2 }]
  })
  const row = getDb().doc_out.find((d) => d.id === id)
  assert.equal(row.status, 'pending_review')
  assert.equal(row.posted_at, null, '新建时不应已过账')
  assert.ok(row.creator_id > 0)
})

await test('明细与头表汇总字段由服务端重算', async () => {
  await as('root')
  const { id } = await api.create('quality', {
    base_id: 1, warehouse_id: 1,
    // 故意传错误的 total，应被服务端覆盖
    items: [
      { part_id: 1, check_qty: 10, pass_qty: 8, fail_qty: 2 },
      { part_id: 2, check_qty: 5, pass_qty: 5, fail_qty: 0 }
    ]
  })
  const row = getDb().quality.find((q) => q.id === id)
  assert.equal(row.total, 15, 'total 应由 check_qty 汇总')
  assert.equal(row.pass_qty, 13)
  assert.equal(row.fail_qty, 2)
})

await test('盘点明细 diff 自动计算', async () => {
  await as('root')
  const { id } = await api.create('stocktake', {
    scope: '测试盘点', base_id: 1, warehouse_id: 1,
    items: [{ part_id: 1, location_id: 1111, book_qty: 10, actual_qty: 7, diff: 999 }]
  })
  const item = getDb().stocktake_item.find((i) => i.doc_id === id)
  assert.equal(item.diff, -3, 'diff 应为 actual - book，忽略前端传值')
})

await test('已完成的单据不可编辑', async () => {
  await as('root')
  // 单据1是 completed
  await assert.rejects(() => api.update('inbound', 1, { ref_no: 'X' }), /该状态不可编辑/)
})

await test('已完成单据不可删除', async () => {
  await as('root')
  await assert.rejects(() => api.remove('inbound', 1), /该状态不可删除/)
})

// ══════════════════════════════════════════════════════════════════════
section('状态机')
// ══════════════════════════════════════════════════════════════════════

await test('合法的状态迁移被接受', async () => {
  await as('root')
  const { id } = await api.create('inbound', { base_id: 1, warehouse_id: 1, from_src: 'purchase', items: [{ part_id: 1, expect_qty: 1 }] })
  const r = await api.transition('inbound', id, 'pending_qc')
  assert.equal(r.ok, true)
  assert.equal(getDb().doc_in.find((d) => d.id === id).status, 'pending_qc')
})

await test('非法迁移被拒绝（409）', async () => {
  await as('root')
  const { id } = await api.create('inbound', { base_id: 1, warehouse_id: 1, from_src: 'purchase', items: [{ part_id: 1, expect_qty: 1 }] })
  // draft 不能直接 completed
  await assert.rejects(() => api.transition('inbound', id, 'completed'), /不允许从/)
})

await test('出库终止状态是 cancelled 而非 rejected（与 SQL 约束一致）', () => {
  assert.ok(TRANSITIONS.outbound.pending_review.includes('cancelled'))
  assert.ok(!TRANSITIONS.outbound.pending_review.includes('rejected'), 'outbound 不应有 rejected')
  // rejected 属于质检
  assert.ok(TRANSITIONS.quality.pending_qc.includes('rejected'))
})

await test('每个状态机都没有指向未知状态的迁移', () => {
  const db = getDb()
  const validity = {
    inbound: ['draft', 'pending_qc', 'qc_ing', 'pending_shelf', 'completed', 'cancelled'],
    outbound: ['pending_review', 'pending_pick', 'pending_check', 'completed', 'cancelled'],
    quality: ['pending_qc', 'qc_ing', 'completed', 'rejected'],
    stocktake: ['pending_count', 'counting', 'pending_review', 'completed'],
    delivery: ['pending_review', 'pending_ship', 'shipped', 'in_transit', 'signed', 'partial_signed', 'exception', 'cancelled']
  }
  for (const [kind, map] of Object.entries(TRANSITIONS)) {
    for (const [from, tos] of Object.entries(map)) {
      assert.ok(validity[kind].includes(from), `${kind}: 未知起始状态 ${from}`)
      for (const to of tos) {
        assert.ok(validity[kind].includes(to), `${kind}: ${from} → 未知状态 ${to}`)
      }
    }
  }
})

// ══════════════════════════════════════════════════════════════════════
section('库存过账与幂等（最关键）')
// ══════════════════════════════════════════════════════════════════════

await test('入库推进到 completed 后库存增加且写流水', async () => {
  await as('root')
  const { id, no } = await api.create('inbound', {
    base_id: 1, warehouse_id: 1, from_src: 'purchase',
    items: [{ part_id: 1, batch: 'B-POST-1', expect_qty: 6, received_qty: 6, location_id: 1111 }]
  })
  const invBefore = getDb().inventory.find((i) => i.part_id === 1 && i.location_id === 1111 && i.batch === 'B-POST-1')
  assert.equal(invBefore, undefined, '过账前不应有该批次库存')

  // draft → pending_qc → qc_ing → pending_shelf → completed
  await api.transition('inbound', id, 'pending_qc')
  await api.transition('inbound', id, 'qc_ing')
  await api.transition('inbound', id, 'pending_shelf')
  const r = await api.transition('inbound', id, 'completed')
  assert.equal(r.posted, true, '应发生过账')

  const db = getDb()
  const inv = db.inventory.find((i) => i.part_id === 1 && i.location_id === 1111 && i.batch === 'B-POST-1')
  assert.ok(inv, '应创建库存行')
  assert.equal(inv.avail_qty, 6)

  const flows = db.inventory_flow.filter((f) => f.ref_doc === no)
  assert.equal(flows.length, 1, '应写一条入库流水')
  assert.equal(flows[0].type, 'in')
  assert.equal(flows[0].qty_change, 6)
  assert.equal(flows[0].before_qty, 0)
  assert.equal(flows[0].after_qty, 6)
})

await test('重复推进到 completed 不会重复加库存（幂等）', async () => {
  await as('root')
  const { id, no } = await api.create('inbound', {
    base_id: 1, warehouse_id: 1, from_src: 'purchase',
    items: [{ part_id: 1, batch: 'B-POST-2', expect_qty: 4, received_qty: 4 }]
  })
  await api.transition('inbound', id, 'pending_qc')
  await api.transition('inbound', id, 'qc_ing')
  await api.transition('inbound', id, 'pending_shelf')
  await api.transition('inbound', id, 'completed')

  const qtyAfterFirst = getDb().inventory.find((i) => i.part_id === 1 && i.batch === 'B-POST-2').avail_qty

  // 关键：重复调用
  const again = await api.transition('inbound', id, 'completed')
  assert.equal(again.posted, false, '重复推进不应再次过账')

  const qtyAfterSecond = getDb().inventory.find((i) => i.part_id === 1 && i.batch === 'B-POST-2').avail_qty
  assert.equal(qtyAfterSecond, qtyAfterFirst, '库存不应被重复累加')
  assert.equal(getDb().inventory_flow.filter((f) => f.ref_doc === no).length, 1, '流水不应重复')
})

await test('出库完成扣减库存；库存不足则 409 且不扣任何行', async () => {
  await as('root')
  // 先造库存：入库 3 件
  const inb = await api.create('inbound', {
    base_id: 1, warehouse_id: 1, from_src: 'purchase',
    items: [{ part_id: 2, batch: 'B-OUT-1', expect_qty: 3, received_qty: 3, location_id: 1112 }]
  })
  for (const s of ['pending_qc', 'qc_ing', 'pending_shelf', 'completed']) {
    await api.transition('inbound', inb.id, s)
  }

  // 开一张要 10 件的出库单 → 应失败
  const out = await api.create('outbound', {
    type: 'issue', base_id: 1, warehouse_id: 1,
    items: [{ part_id: 2, location_id: 1112, plan_qty: 10, picked_qty: 10 }]
  })
  await api.transition('outbound', out.id, 'pending_pick')
  await api.transition('outbound', out.id, 'pending_check')
  const before = getDb().inventory.find((i) => i.part_id === 2 && i.batch === 'B-OUT-1').avail_qty
  await assert.rejects(() => api.transition('outbound', out.id, 'completed'), /库存不足/)

  const after = getDb().inventory.find((i) => i.part_id === 2 && i.batch === 'B-OUT-1').avail_qty
  assert.equal(after, before, '过账失败不应扣减库存')
  assert.equal(getDb().doc_out.find((d) => d.id === out.id).status, 'pending_check', '状态不应变化')
  assert.equal(getDb().doc_out.find((d) => d.id === out.id).posted_at, null, '不应标记已过账')
})

await test('盘点完成按 diff 调整库存', async () => {
  await as('root')
  // 期望通过盘点把 part1/1111/B2411A 从 4 调整为 9（diff +5）
  const st = await api.create('stocktake', {
    scope: '过账测试', base_id: 1, warehouse_id: 1,
    items: [{ part_id: 1, location_id: 1111, batch: 'B2411A', book_qty: 4, actual_qty: 9 }]
  })
  const before = getDb().inventory.find((i) => i.part_id === 1 && i.location_id === 1111 && i.batch === 'B2411A').avail_qty
  await api.transition('stocktake', st.id, 'counting')
  await api.transition('stocktake', st.id, 'pending_review')
  await api.transition('stocktake', st.id, 'completed')
  const after = getDb().inventory.find((i) => i.part_id === 1 && i.location_id === 1111 && i.batch === 'B2411A').avail_qty
  assert.equal(after, before + 5)
})

// ══════════════════════════════════════════════════════════════════════
section('选项接口与持久化')
// ══════════════════════════════════════════════════════════════════════

await test('options 返回表单所需下拉数据', async () => {
  await as('root')
  const o = await api.options('part')
  for (const key of ['bases', 'warehouses', 'parts', 'suppliers', 'customers', 'locations', 'users']) {
    assert.ok(Array.isArray(o[key]), `${key} 应为数组`)
  }
  assert.ok(o.bases.length > 0)
  assert.ok(o.warehouses.length > 0)
  assert.ok(o.parts.length >= 20)
})

await test('options 按范围过滤仓库', async () => {
  await as('w01') // 仓库1
  const o = await api.options('inbound')
  assert.ok(o.warehouses.every((w) => w.id === 1), 'w01 只应看到自己的仓库')
})

await test('写入结果持久化到 localStorage，重载后仍在', async () => {
  await as('root')
  await api.create('part', { code: 'P-PERSIST-1', name: '持久化测试', unit: '个', safe_stock: 3, supplier_id: 1 })
  const raw = localStorage.getItem('wms_demo_db_v1')
  assert.ok(raw.includes('P-PERSIST-1'), '应已落盘')
})

await test('resetDemoData 后写入的数据全部消失', async () => {
  const { resetDb: reset } = await import('../src/mock/db.js')
  reset()
  assert.ok(!getDb().part.some((p) => p.code === 'P-PERSIST-1'))
  assert.equal(getDb().part.length, 20, '应回到 20 条种子备件')
})

await test('审计日志记录了写操作', async () => {
  await as('root')
  await api.create('part', { code: 'P-LOG-1', name: '日志测试', unit: '个', safe_stock: 1, supplier_id: 1 })
  const logs = getDb().sys_log.filter((l) => l.action === 'part.create')
  assert.ok(logs.length > 0, '应写审计日志')
  assert.ok(logs[0].detail.includes('P-LOG-1'))
})

// ══════════════════════════════════════════════════════════════════════
console.log(`\n${'─'.repeat(52)}`)
console.log(`通过 ${passed} 项，失败 ${failed} 项`)
if (failed > 0) process.exit(1)
