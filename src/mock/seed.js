/**
 * 浏览器端演示数据库的初始数据。
 * 由 sql/02_seed.sql 与 sql/03_more_users.sql 平移而来：
 * 表结构、主键、状态、数量关系与 SQL 版完全一致，只是把
 * PostgreSQL 的行存成了 JS 对象数组，时间戳改为「相对当前时刻」，
 * 这样每次重置后看板上的「近 7 天」「今日待办」都始终是新鲜的。
 */

const MIN = 60 * 1000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

/** 演示账号统一密码 123456 的 SHA-256（与 SQL 种子一致） */
export const DEMO_PASSWORD_HASH =
  '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92'

export const SCHEMA_VERSION = 1

export function createSeedDatabase() {
  const t0 = Date.now()
  /** 相对当前时刻的 ISO 时间串 */
  const ago = (ms) => new Date(t0 - ms).toISOString()

  // ── 组织 ────────────────────────────────────────────────────────────
  const base = [
    { id: 1, code: 'BD-EAST', name: '华东基地', region: '华东', created_at: ago(120 * DAY) },
    { id: 2, code: 'BD-SOUTH', name: '华南基地', region: '华南', created_at: ago(120 * DAY) }
  ]

  const warehouse = [
    { id: 1, base_id: 1, code: 'WH-EAST-01', name: '华东中央仓', address: '上海市浦东新区XX路 100 号', manager_id: 2, created_at: ago(120 * DAY) },
    { id: 2, base_id: 1, code: 'WH-EAST-02', name: '华东备件二仓', address: '上海市松江区YY路 200 号', manager_id: null, created_at: ago(118 * DAY) },
    { id: 3, base_id: 2, code: 'WH-SOUTH-01', name: '华南中央仓', address: '东莞市ZZ区 AA大道 300 号', manager_id: null, created_at: ago(110 * DAY) },
    { id: 4, base_id: 2, code: 'WH-SOUTH-02', name: '华南现场仓', address: '深圳市龙岗区 BB工业园 5 栋', manager_id: null, created_at: ago(110 * DAY) }
  ]

  // 库区 zone → 货架 shelf → 库位 bin，parent_id 自引用
  const location = [
    { id: 101, warehouse_id: 1, parent_id: null, code: 'A 区', name: 'A 区 机电件', type: 'zone' },
    { id: 102, warehouse_id: 1, parent_id: null, code: 'B 区', name: 'B 区 电控件', type: 'zone' },
    { id: 111, warehouse_id: 1, parent_id: 101, code: 'A01', name: null, type: 'shelf' },
    { id: 112, warehouse_id: 1, parent_id: 101, code: 'A02', name: null, type: 'shelf' },
    { id: 121, warehouse_id: 1, parent_id: 102, code: 'B01', name: null, type: 'shelf' },
    { id: 1111, warehouse_id: 1, parent_id: 111, code: 'A01-01', name: null, type: 'bin' },
    { id: 1112, warehouse_id: 1, parent_id: 111, code: 'A01-02', name: null, type: 'bin' },
    { id: 1121, warehouse_id: 1, parent_id: 112, code: 'A02-01', name: null, type: 'bin' },
    { id: 1122, warehouse_id: 1, parent_id: 112, code: 'A02-02', name: null, type: 'bin' },
    { id: 1211, warehouse_id: 1, parent_id: 121, code: 'B01-01', name: null, type: 'bin' },
    { id: 1212, warehouse_id: 1, parent_id: 121, code: 'B01-02', name: null, type: 'bin' },

    { id: 201, warehouse_id: 2, parent_id: null, code: 'A 区', name: 'A 区 气动液压', type: 'zone' },
    { id: 202, warehouse_id: 2, parent_id: null, code: 'B 区', name: 'B 区 耗材', type: 'zone' },
    { id: 211, warehouse_id: 2, parent_id: 201, code: 'A01', name: null, type: 'shelf' },
    { id: 221, warehouse_id: 2, parent_id: 202, code: 'B01', name: null, type: 'shelf' },
    { id: 2111, warehouse_id: 2, parent_id: 211, code: 'A01-01', name: null, type: 'bin' },
    { id: 2112, warehouse_id: 2, parent_id: 211, code: 'A01-02', name: null, type: 'bin' },
    { id: 2211, warehouse_id: 2, parent_id: 221, code: 'B01-01', name: null, type: 'bin' },
    { id: 2212, warehouse_id: 2, parent_id: 221, code: 'B01-02', name: null, type: 'bin' },

    { id: 301, warehouse_id: 3, parent_id: null, code: 'A 区', name: 'A 区 通用件', type: 'zone' },
    { id: 302, warehouse_id: 3, parent_id: null, code: 'B 区', name: 'B 区 电气件', type: 'zone' },
    { id: 311, warehouse_id: 3, parent_id: 301, code: 'A01', name: null, type: 'shelf' },
    { id: 321, warehouse_id: 3, parent_id: 302, code: 'B01', name: null, type: 'shelf' },
    { id: 3111, warehouse_id: 3, parent_id: 311, code: 'A01-01', name: null, type: 'bin' },
    { id: 3112, warehouse_id: 3, parent_id: 311, code: 'A01-02', name: null, type: 'bin' },
    { id: 3211, warehouse_id: 3, parent_id: 321, code: 'B01-01', name: null, type: 'bin' },
    { id: 3212, warehouse_id: 3, parent_id: 321, code: 'B01-02', name: null, type: 'bin' },

    { id: 401, warehouse_id: 4, parent_id: null, code: 'A 区', name: 'A 区 现场备件', type: 'zone' },
    { id: 411, warehouse_id: 4, parent_id: 401, code: 'A01', name: null, type: 'shelf' },
    { id: 4111, warehouse_id: 4, parent_id: 411, code: 'A01-01', name: null, type: 'bin' },
    { id: 4112, warehouse_id: 4, parent_id: 411, code: 'A01-02', name: null, type: 'bin' }
  ]

  // ── 主数据 ──────────────────────────────────────────────────────────
  const supplier = [
    { id: 1, code: 'SUP-001', name: '宁波精工传动有限公司', contact: '张工 0574-8800xxxx' },
    { id: 2, code: 'SUP-002', name: '苏州华电自动化设备公司', contact: '李经理 0512-6600xxxx' },
    { id: 3, code: 'SUP-003', name: '广州力源液压气动公司', contact: '陈工 020-8300xxxx' }
  ]

  const customer = [
    { id: 1, code: 'CUS-001', name: '一车间设备科', contact: '刘工' },
    { id: 2, code: 'CUS-002', name: '二车间设备科', contact: '赵工' }
  ]

  const part = [
    { id: 1, code: 'P-MTR-001', name: '伺服电机', spec: '750W / 2.39N·m / 绝对值', unit: '台', safe_stock: 4, supplier_id: 2, is_scrap: false },
    { id: 2, code: 'P-RED-001', name: '行星减速机', spec: 'i=10 / 40mm', unit: '台', safe_stock: 4, supplier_id: 1, is_scrap: false },
    { id: 3, code: 'P-CPL-001', name: '联轴器', spec: '梅花型 / 24×32mm', unit: '件', safe_stock: 8, supplier_id: 1, is_scrap: false },
    { id: 4, code: 'P-ENC-001', name: '增量编码器', spec: '1024P / 空心轴', unit: '个', safe_stock: 6, supplier_id: 2, is_scrap: false },
    { id: 5, code: 'P-PRX-001', name: '接近开关', spec: 'M12 / PNP 常开', unit: '个', safe_stock: 20, supplier_id: 2, is_scrap: false },
    { id: 6, code: 'P-PHO-001', name: '光电传感器', spec: '对射型 / NPN', unit: '对', safe_stock: 12, supplier_id: 2, is_scrap: false },
    { id: 7, code: 'P-RLY-001', name: '安全继电器', spec: '双通道 / 24VDC', unit: '个', safe_stock: 5, supplier_id: 2, is_scrap: false },
    { id: 8, code: 'P-CTR-001', name: '交流接触器', spec: 'CJX2-2510 / 220V', unit: '个', safe_stock: 10, supplier_id: 2, is_scrap: false },
    { id: 9, code: 'P-VFD-001', name: '变频器', spec: '2.2kW / 三相 380V', unit: '台', safe_stock: 3, supplier_id: 2, is_scrap: false },
    { id: 10, code: 'P-BEL-001', name: '同步带', spec: '8M-1600-30', unit: '根', safe_stock: 10, supplier_id: 1, is_scrap: false },
    { id: 11, code: 'P-PUY-001', name: '同步带轮', spec: '8M-30齿 / 孔径25', unit: '个', safe_stock: 8, supplier_id: 1, is_scrap: false },
    { id: 12, code: 'P-LGV-001', name: '直线导轨', spec: 'HGR20×1500mm', unit: '根', safe_stock: 6, supplier_id: 1, is_scrap: false },
    { id: 13, code: 'P-CYL-001', name: '标准气缸', spec: 'SC63×200', unit: '件', safe_stock: 6, supplier_id: 3, is_scrap: false },
    { id: 14, code: 'P-SOL-001', name: '电磁阀', spec: '4V210-08 / DC24V', unit: '个', safe_stock: 15, supplier_id: 3, is_scrap: false },
    { id: 15, code: 'P-FRU-001', name: '气源三联件', spec: 'AC3010-03', unit: '套', safe_stock: 5, supplier_id: 3, is_scrap: false },
    { id: 16, code: 'P-BRG-001', name: '深沟球轴承', spec: '6205-2RS', unit: '个', safe_stock: 30, supplier_id: 1, is_scrap: false },
    { id: 17, code: 'P-PMP-001', name: '齿轮泵', spec: 'CB-B6.3 / 2.5MPa', unit: '台', safe_stock: 3, supplier_id: 3, is_scrap: false },
    { id: 18, code: 'P-FLT-001', name: '液压油滤芯', spec: 'HX-160×10', unit: '个', safe_stock: 12, supplier_id: 3, is_scrap: false },
    { id: 19, code: 'P-OIL-001', name: '抗磨液压油', spec: 'L-HM46 / 200L', unit: '桶', safe_stock: 4, supplier_id: 3, is_scrap: false },
    { id: 20, code: 'P-CHN-001', name: '拖链', spec: 'TL-25×57 / R38', unit: '米', safe_stock: 20, supplier_id: 1, is_scrap: true }
  ].map((p) => ({ ...p, created_at: ago(100 * DAY) }))

  const device = [
    { id: 1, code: 'DEV-SC-001', name: '扫码枪 1 号', type: 'scanner', bound_warehouse_id: 1, online: true, last_heartbeat: ago(30 * 1000) },
    { id: 2, code: 'DEV-NF-001', name: 'NFC 读写器 1 号', type: 'nfc', bound_warehouse_id: 1, online: true, last_heartbeat: ago(1 * MIN) },
    { id: 3, code: 'DEV-RF-001', name: 'RFID 通道机 1 号', type: 'rfid', bound_warehouse_id: 3, online: false, last_heartbeat: ago(6 * HOUR) },
    { id: 4, code: 'DEV-CA-001', name: '质检摄像头 1 号', type: 'camera', bound_warehouse_id: 1, online: true, last_heartbeat: ago(15 * 1000) },
    { id: 5, code: 'DEV-HD-001', name: '手持机 1 号', type: 'scanner', bound_warehouse_id: 4, online: false, last_heartbeat: ago(2 * DAY) }
  ]

  // ── 单据：入库 ──────────────────────────────────────────────────────
  const doc_in = [
    { id: 1, no: 'IN-20261101-001', base_id: 1, warehouse_id: 1, from_src: 'purchase', ref_no: 'PO-20261028-11', status: 'completed', creator_id: 2, created_at: ago(6 * DAY), updated_at: ago(6 * DAY) },
    { id: 2, no: 'IN-20261105-002', base_id: 1, warehouse_id: 1, from_src: 'purchase', ref_no: 'PO-20261101-08', status: 'pending_qc', creator_id: 2, created_at: ago(2 * DAY), updated_at: ago(2 * DAY) },
    { id: 3, no: 'IN-20261106-003', base_id: 1, warehouse_id: 1, from_src: 'transfer', ref_no: 'TF-20261104-02', status: 'qc_ing', creator_id: 2, created_at: ago(1 * DAY), updated_at: ago(1 * DAY) },
    { id: 4, no: 'IN-20261106-004', base_id: 2, warehouse_id: 3, from_src: 'purchase', ref_no: 'PO-20261102-15', status: 'pending_shelf', creator_id: 3, created_at: ago(1 * DAY), updated_at: ago(1 * DAY) },
    { id: 5, no: 'IN-20261107-005', base_id: 2, warehouse_id: 4, from_src: 'purchase', ref_no: 'PO-20261105-21', status: 'draft', creator_id: 3, created_at: ago(3 * HOUR), updated_at: ago(3 * HOUR) }
  ]

  const doc_in_item = [
    { id: 1, doc_id: 1, part_id: 1, batch: 'B2411A', serial_no: null, expect_qty: 4, received_qty: 4, location_id: 1111 },
    { id: 2, doc_id: 1, part_id: 2, batch: 'B2411A', serial_no: null, expect_qty: 4, received_qty: 4, location_id: 1112 },
    { id: 3, doc_id: 2, part_id: 5, batch: 'B2411B', serial_no: null, expect_qty: 20, received_qty: 0, location_id: null },
    { id: 4, doc_id: 2, part_id: 6, batch: 'B2411B', serial_no: null, expect_qty: 12, received_qty: 0, location_id: null },
    { id: 5, doc_id: 3, part_id: 8, batch: 'B2411C', serial_no: null, expect_qty: 10, received_qty: 6, location_id: 1211 },
    { id: 6, doc_id: 3, part_id: 7, batch: 'B2411C', serial_no: null, expect_qty: 5, received_qty: 2, location_id: 1212 },
    { id: 7, doc_id: 4, part_id: 13, batch: 'B2411D', serial_no: null, expect_qty: 6, received_qty: 6, location_id: 3111 },
    { id: 8, doc_id: 4, part_id: 14, batch: 'B2411D', serial_no: null, expect_qty: 15, received_qty: 15, location_id: 3112 },
    { id: 9, doc_id: 5, part_id: 18, batch: 'B2411E', serial_no: null, expect_qty: 12, received_qty: 0, location_id: null }
  ]

  // ── 单据：出库 ──────────────────────────────────────────────────────
  const doc_out = [
    { id: 1, no: 'OUT-20261106-001', type: 'issue', base_id: 1, warehouse_id: 1, dept_name: '一车间设备科', status: 'pending_review', creator_id: 2, created_at: ago(1 * DAY), updated_at: ago(1 * DAY) },
    { id: 2, no: 'OUT-20261106-002', type: 'issue', base_id: 1, warehouse_id: 1, dept_name: '二车间设备科', status: 'pending_pick', creator_id: 2, created_at: ago(1 * DAY), updated_at: ago(1 * DAY) },
    { id: 3, no: 'OUT-20261105-003', type: 'repair', base_id: 2, warehouse_id: 3, dept_name: '设备保全部', status: 'pending_check', creator_id: 3, created_at: ago(2 * DAY), updated_at: ago(2 * DAY) },
    { id: 4, no: 'OUT-20261104-004', type: 'scrap', base_id: 1, warehouse_id: 2, dept_name: '物资处', status: 'completed', creator_id: 2, created_at: ago(3 * DAY), updated_at: ago(3 * DAY) }
  ]

  const doc_out_item = [
    { id: 1, doc_id: 1, part_id: 16, location_id: 1121, plan_qty: 10, picked_qty: 0 },
    { id: 2, doc_id: 2, part_id: 10, location_id: 1122, plan_qty: 4, picked_qty: 0 },
    { id: 3, doc_id: 2, part_id: 11, location_id: 1122, plan_qty: 4, picked_qty: 0 },
    { id: 4, doc_id: 3, part_id: 17, location_id: 3211, plan_qty: 1, picked_qty: 1 },
    { id: 5, doc_id: 4, part_id: 20, location_id: 2211, plan_qty: 5, picked_qty: 5 }
  ]

  // ── 单据：配送 ──────────────────────────────────────────────────────
  const delivery = [
    { id: 1, no: 'DLV-20261104-001', from_base_id: 1, from_wh_id: 1, to_base_id: 2, to_wh_id: 3, to_dept: null, status: 'signed', qty: 10, carrier_name: '自营车队', courier_name: '周配送', shipped_at: ago(3 * DAY), signed_at: ago(2 * DAY), created_at: ago(4 * DAY) },
    { id: 2, no: 'DLV-20261106-002', from_base_id: 1, from_wh_id: 1, to_base_id: 2, to_wh_id: 4, to_dept: '深圳现场维护组', status: 'in_transit', qty: 14, carrier_name: '顺丰速运', courier_name: null, shipped_at: ago(6 * HOUR), signed_at: null, created_at: ago(1 * DAY) },
    { id: 3, no: 'DLV-20261107-003', from_base_id: 1, from_wh_id: 2, to_base_id: 1, to_wh_id: 1, to_dept: null, status: 'pending_review', qty: 6, carrier_name: null, courier_name: null, shipped_at: null, signed_at: null, created_at: ago(5 * HOUR) },
    { id: 4, no: 'DLV-20261103-004', from_base_id: 1, from_wh_id: 1, to_base_id: 2, to_wh_id: 3, to_dept: null, status: 'exception', qty: 8, carrier_name: '中通快运', courier_name: '黄师傅', shipped_at: ago(5 * DAY), signed_at: null, created_at: ago(5 * DAY) }
  ]

  const delivery_item = [
    { id: 1, doc_id: 1, part_id: 5, plan_qty: 10, shipped_qty: 10, signed_qty: 10 },
    { id: 2, doc_id: 2, part_id: 10, plan_qty: 8, shipped_qty: 8, signed_qty: 0 },
    { id: 3, doc_id: 2, part_id: 12, plan_qty: 6, shipped_qty: 6, signed_qty: 0 },
    { id: 4, doc_id: 3, part_id: 19, plan_qty: 6, shipped_qty: 0, signed_qty: 0 },
    { id: 5, doc_id: 4, part_id: 16, plan_qty: 8, shipped_qty: 8, signed_qty: 4 }
  ]

  // ── 单据：质检 ──────────────────────────────────────────────────────
  const quality = [
    { id: 1, no: 'QC-20261101-001', from_doc_id: 1, base_id: 1, warehouse_id: 1, status: 'completed', total: 8, pass_qty: 8, fail_qty: 0, creator_id: 5, created_at: ago(6 * DAY) },
    { id: 2, no: 'QC-20261106-002', from_doc_id: 3, base_id: 1, warehouse_id: 1, status: 'qc_ing', total: 15, pass_qty: 6, fail_qty: 1, creator_id: 5, created_at: ago(1 * DAY) },
    { id: 3, no: 'QC-20261105-003', from_doc_id: 2, base_id: 1, warehouse_id: 1, status: 'pending_qc', total: 32, pass_qty: 0, fail_qty: 0, creator_id: 5, created_at: ago(2 * DAY) }
  ]

  const quality_item = [
    { id: 1, doc_id: 1, part_id: 1, batch: 'B2411A', check_qty: 4, checked_qty: 4, pass_qty: 4, fail_qty: 0, fail_reason: null, photo_url: null },
    { id: 2, doc_id: 1, part_id: 2, batch: 'B2411A', check_qty: 4, checked_qty: 4, pass_qty: 4, fail_qty: 0, fail_reason: null, photo_url: null },
    { id: 3, doc_id: 2, part_id: 8, batch: 'B2411C', check_qty: 10, checked_qty: 8, pass_qty: 7, fail_qty: 1, fail_reason: '外壳裂纹', photo_url: null },
    { id: 4, doc_id: 2, part_id: 7, batch: 'B2411C', check_qty: 5, checked_qty: 0, pass_qty: 0, fail_qty: 0, fail_reason: null, photo_url: null },
    { id: 5, doc_id: 3, part_id: 5, batch: 'B2411B', check_qty: 20, checked_qty: 0, pass_qty: 0, fail_qty: 0, fail_reason: null, photo_url: null },
    { id: 6, doc_id: 3, part_id: 6, batch: 'B2411B', check_qty: 12, checked_qty: 0, pass_qty: 0, fail_qty: 0, fail_reason: null, photo_url: null }
  ]

  // ── 单据：盘点 ──────────────────────────────────────────────────────
  const stocktake = [
    { id: 1, no: 'ST-20261103-001', scope: '华东中央仓 A 区全量', base_id: 1, warehouse_id: 1, status: 'pending_review', creator_id: 2, created_at: ago(4 * DAY) },
    { id: 2, no: 'ST-20261106-002', scope: '华南中央仓电控件', base_id: 2, warehouse_id: 3, status: 'counting', creator_id: 3, created_at: ago(1 * DAY) },
    { id: 3, no: 'ST-20261107-003', scope: '华东备件二仓 B 区', base_id: 1, warehouse_id: 2, status: 'pending_count', creator_id: 2, created_at: ago(8 * HOUR) }
  ]

  const stocktake_item = [
    { id: 1, doc_id: 1, location_id: 1111, part_id: 1, batch: 'B2411A', book_qty: 4, actual_qty: 4, diff: 0, reason: null },
    { id: 2, doc_id: 1, location_id: 1112, part_id: 2, batch: 'B2411A', book_qty: 4, actual_qty: 3, diff: -1, reason: '疑未登记领用' },
    { id: 3, doc_id: 1, location_id: 1121, part_id: 16, batch: '-', book_qty: 30, actual_qty: 30, diff: 0, reason: null },
    { id: 4, doc_id: 2, location_id: 3211, part_id: 17, batch: '-', book_qty: 3, actual_qty: null, diff: null, reason: null },
    { id: 5, doc_id: 2, location_id: 3212, part_id: 18, batch: '-', book_qty: 12, actual_qty: null, diff: null, reason: null }
  ]

  // ── 库存 ────────────────────────────────────────────────────────────
  const inventory = [
    { id: 1, base_id: 1, warehouse_id: 1, location_id: 1111, part_id: 1, batch: 'B2411A', avail_qty: 4, frozen_qty: 0, in_transit_qty: 0, status: 'normal' },
    { id: 2, base_id: 1, warehouse_id: 1, location_id: 1112, part_id: 2, batch: 'B2411A', avail_qty: 3, frozen_qty: 0, in_transit_qty: 0, status: 'normal' },
    { id: 3, base_id: 1, warehouse_id: 1, location_id: 1121, part_id: 16, batch: '-', avail_qty: 28, frozen_qty: 0, in_transit_qty: 0, status: 'normal' },
    { id: 4, base_id: 1, warehouse_id: 1, location_id: 1122, part_id: 10, batch: '-', avail_qty: 9, frozen_qty: 4, in_transit_qty: 0, status: 'normal' },
    { id: 5, base_id: 1, warehouse_id: 1, location_id: 1122, part_id: 11, batch: '-', avail_qty: 2, frozen_qty: 0, in_transit_qty: 0, status: 'normal' },
    { id: 6, base_id: 1, warehouse_id: 1, location_id: 1211, part_id: 8, batch: 'B2411C', avail_qty: 4, frozen_qty: 0, in_transit_qty: 0, status: 'normal' },
    { id: 7, base_id: 1, warehouse_id: 1, location_id: 1212, part_id: 7, batch: 'B2411C', avail_qty: 3, frozen_qty: 0, in_transit_qty: 0, status: 'pending_qc' },
    { id: 8, base_id: 1, warehouse_id: 2, location_id: 2111, part_id: 13, batch: '-', avail_qty: 6, frozen_qty: 0, in_transit_qty: 0, status: 'normal' },
    { id: 9, base_id: 1, warehouse_id: 2, location_id: 2112, part_id: 14, batch: '-', avail_qty: 15, frozen_qty: 0, in_transit_qty: 0, status: 'normal' },
    { id: 10, base_id: 1, warehouse_id: 2, location_id: 2211, part_id: 19, batch: '-', avail_qty: 3, frozen_qty: 0, in_transit_qty: 0, status: 'normal' },
    { id: 11, base_id: 1, warehouse_id: 2, location_id: 2212, part_id: 20, batch: '-', avail_qty: 18, frozen_qty: 0, in_transit_qty: 0, status: 'normal' },
    { id: 12, base_id: 1, warehouse_id: 1, location_id: 1211, part_id: 5, batch: 'B2411B', avail_qty: 20, frozen_qty: 0, in_transit_qty: 10, status: 'normal' },
    { id: 13, base_id: 1, warehouse_id: 1, location_id: 1212, part_id: 6, batch: 'B2411B', avail_qty: 0, frozen_qty: 12, in_transit_qty: 0, status: 'unqualified' },
    { id: 14, base_id: 2, warehouse_id: 3, location_id: 3111, part_id: 13, batch: 'B2411D', avail_qty: 6, frozen_qty: 0, in_transit_qty: 0, status: 'normal' },
    { id: 15, base_id: 2, warehouse_id: 3, location_id: 3112, part_id: 14, batch: 'B2411D', avail_qty: 15, frozen_qty: 0, in_transit_qty: 0, status: 'normal' },
    { id: 16, base_id: 2, warehouse_id: 3, location_id: 3211, part_id: 17, batch: '-', avail_qty: 3, frozen_qty: 0, in_transit_qty: 0, status: 'normal' },
    { id: 17, base_id: 2, warehouse_id: 3, location_id: 3212, part_id: 18, batch: '-', avail_qty: 12, frozen_qty: 0, in_transit_qty: 0, status: 'normal' },
    { id: 18, base_id: 2, warehouse_id: 4, location_id: 4111, part_id: 15, batch: '-', avail_qty: 5, frozen_qty: 0, in_transit_qty: 0, status: 'normal' },
    { id: 19, base_id: 2, warehouse_id: 4, location_id: 4112, part_id: 16, batch: '-', avail_qty: 6, frozen_qty: 0, in_transit_qty: 8, status: 'normal' }
  ].map((r) => ({ ...r, updated_at: ago(2 * HOUR) }))

  // ── 库存流水 ────────────────────────────────────────────────────────
  const inventory_flow = [
    { id: 1, part_id: 1, warehouse_id: 1, location_id: 1111, qty_change: 4, type: 'in', ref_doc: 'IN-20261101-001', before_qty: 0, after_qty: 4, operator_id: 2, ts: ago(6 * DAY) },
    { id: 2, part_id: 2, warehouse_id: 1, location_id: 1112, qty_change: 4, type: 'in', ref_doc: 'IN-20261101-001', before_qty: 0, after_qty: 4, operator_id: 2, ts: ago(6 * DAY) },
    { id: 3, part_id: 16, warehouse_id: 1, location_id: 1121, qty_change: 30, type: 'in', ref_doc: 'IN-20261020-007', before_qty: 0, after_qty: 30, operator_id: 2, ts: ago(5 * DAY) },
    { id: 4, part_id: 5, warehouse_id: 1, location_id: 1211, qty_change: 10, type: 'transit_out', ref_doc: 'DLV-20261106-002', before_qty: 20, after_qty: 20, operator_id: 4, ts: ago(6 * HOUR) },
    { id: 5, part_id: 16, warehouse_id: 2, location_id: 4112, qty_change: 8, type: 'transit_in', ref_doc: 'DLV-20261103-004', before_qty: 0, after_qty: 8, operator_id: 4, ts: ago(3 * DAY) },
    { id: 6, part_id: 20, warehouse_id: 2, location_id: 2211, qty_change: -5, type: 'out', ref_doc: 'OUT-20261104-004', before_qty: 10, after_qty: 5, operator_id: 2, ts: ago(3 * DAY) },
    { id: 7, part_id: 2, warehouse_id: 1, location_id: 1112, qty_change: -1, type: 'count_adjust', ref_doc: 'ST-20261103-001', before_qty: 4, after_qty: 3, operator_id: 2, ts: ago(2 * DAY) },
    { id: 8, part_id: 7, warehouse_id: 1, location_id: 1212, qty_change: 3, type: 'in', ref_doc: 'IN-20261106-003', before_qty: 0, after_qty: 3, operator_id: 2, ts: ago(1 * DAY) },
    { id: 9, part_id: 8, warehouse_id: 1, location_id: 1211, qty_change: 4, type: 'in', ref_doc: 'IN-20261106-003', before_qty: 0, after_qty: 4, operator_id: 2, ts: ago(1 * DAY) },
    { id: 10, part_id: 6, warehouse_id: 1, location_id: 1212, qty_change: 12, type: 'freeze', ref_doc: 'QC-20261105-003', before_qty: 12, after_qty: 12, operator_id: 5, ts: ago(1 * DAY) }
  ]

  // ── 角色 / 权限 ─────────────────────────────────────────────────────
  const sys_role = [
    { id: 1, code: 'keeper', name: '库管员' },
    { id: 2, code: 'delivery', name: '配送员' },
    { id: 3, code: 'qc', name: '质检员' },
    { id: 4, code: 'planner', name: '计划/采购' },
    { id: 5, code: 'admin', name: '基地/仓库管理员' },
    { id: 6, code: 'accountant', name: '会计' },
    { id: 7, code: 'purchaser', name: '采购员' },
    { id: 8, code: 'auditor', name: '审计员' },
    { id: 9, code: 'super', name: '超级管理员' },
    // 老板：只做最终审批（删除仓库等不可逆操作），不参与日常作业
    { id: 10, code: 'boss', name: '老板' }
  ]

  const perm = (role_id, keys) => keys.map((menu_key) => ({ role_id, menu_key }))
  const sys_permission = [
    // 原 SQL 种子里库管员还有个 'transfer' 键，但前端从来没有对应路由（悬空权限），此处移除
    ...perm(1, ['dashboard', 'inbound', 'outbound', 'inventory', 'flow', 'stocktake', 'device']),
    ...perm(2, ['dashboard', 'delivery', 'outbound']),
    ...perm(3, ['dashboard', 'quality', 'inbound']),
    ...perm(4, ['dashboard', 'parts', 'inventory', 'flow']),
    ...perm(5, ['dashboard', 'basedata', 'parts', 'inbound', 'outbound', 'inventory', 'flow', 'delivery', 'quality', 'stocktake', 'device', 'system']),
    ...perm(6, ['dashboard', 'parts', 'inventory', 'flow', 'delivery', 'quality', 'stocktake']),
    ...perm(7, ['dashboard', 'parts', 'inbound', 'inventory', 'flow']),
    ...perm(8, ['dashboard', 'basedata', 'parts', 'inbound', 'outbound', 'inventory', 'flow', 'delivery', 'quality', 'stocktake', 'device', 'system']),
    ...perm(9, ['dashboard', 'basedata', 'parts', 'inbound', 'outbound', 'inventory', 'flow', 'delivery', 'quality', 'stocktake', 'device', 'system', 'warehouse']),
    // 老板：看板 + 仓库管理（审批）+ 消息，不做明细作业
    ...perm(10, ['dashboard', 'basedata', 'warehouse', 'inventory', 'flow'])
  ]

  const U = (id, username, name, base_id, warehouse_id) => ({
    id, username, password_hash: DEMO_PASSWORD_HASH, name, base_id, warehouse_id,
    active: true, perm_mode: 'role'
  })

  const sys_user = [
    U(1, 'admin', '系统管理员', null, null),
    U(2, 'w01', '陈库管', 1, 1),
    U(3, 'w02', '林库管', 2, 3),
    U(4, 'd01', '周配送', 1, null),
    U(5, 'q01', '吴质检', 1, 1),
    U(6, 'p01', '郑计划', 1, null),
    U(7, 'root', '超级管理员', null, null),
    U(8, 'a01', '孙会计', null, null),
    U(9, 'c01', '关采购', 1, null),
    U(10, 's01', '沈审计', null, null),
    U(11, 'w03', '何库管', 2, 4),
    U(12, 'q02', '冯质检', 2, 3),
    U(13, 'd02', '蒋配送', 2, null),
    U(14, 'boss', '董事长', null, null)
  ]

  const sys_user_role = [
    { user_id: 1, role_id: 5 },
    { user_id: 2, role_id: 1 },
    { user_id: 3, role_id: 1 },
    { user_id: 4, role_id: 2 },
    { user_id: 5, role_id: 3 },
    { user_id: 6, role_id: 4 },
    { user_id: 7, role_id: 9 },
    { user_id: 8, role_id: 6 },
    { user_id: 9, role_id: 7 },
    { user_id: 10, role_id: 8 },
    { user_id: 11, role_id: 1 },
    { user_id: 12, role_id: 3 },
    { user_id: 13, role_id: 2 },
    { user_id: 14, role_id: 10 }
  ]

  // 用户级自定义菜单（sql/04_perm_custom.sql 建表，种子为空）
  const sys_user_permission = []

  /**
   * 多仓库授权：一个用户可以被授权管理多个仓库。
   * 与 sys_user.warehouse_id（单一主仓）并存：
   *   · warehouse_id 是「主仓」，用于默认归属与表单预填
   *   · 本表是「授权范围」，决定能看到/操作哪些仓库
   * 规则：若本表有记录，以本表为准；否则回落到 warehouse_id。
   */
  const sys_user_warehouse = []

  /**
   * 审批请求（如删除仓库）。
   * 高危且不可逆的操作不直接执行，而是生成一条 pending 请求，
   * 由 boss 角色确认后才真正执行 —— 这是"双人复核"的最小实现。
   */
  const sys_approval = []

  /**
   * 站内消息（红点提示）。
   * 由业务事件产生：新建单据、入库完成、质检结果、审批请求/结果等。
   * read_at 为空即未读，前端按未读数显示红点。
   */
  const sys_message = []

  const sys_log = [
    { id: 1, user_id: 2, action: 'login', detail: '登录系统（华东基地）', ts: ago(1 * DAY) },
    { id: 2, user_id: 2, action: 'doc_in.receive', detail: 'IN-20261106-003 扫码入库 6 件 交流接触器', ts: ago(1 * DAY) },
    { id: 3, user_id: 5, action: 'quality.fail', detail: 'QC-20261106-002 交流接触器 1 件外壳裂纹', ts: ago(20 * HOUR) }
  ]

  return {
    meta: { version: SCHEMA_VERSION, seededAt: new Date(t0).toISOString() },
    base,
    warehouse,
    location,
    supplier,
    customer,
    part,
    device,
    doc_in,
    doc_in_item,
    doc_out,
    doc_out_item,
    delivery,
    delivery_item,
    quality,
    quality_item,
    stocktake,
    stocktake_item,
    inventory,
    inventory_flow,
    sys_user,
    sys_role,
    sys_user_role,
    sys_permission,
    sys_user_permission,
    sys_user_warehouse,
    sys_approval,
    sys_message,
    sys_log
  }
}
