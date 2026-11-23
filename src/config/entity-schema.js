/**
 * 实体写入配置（两版共用）。
 *
 * 这是一份**纯数据 + 纯函数**模块：不含浏览器 API、不引用 localStorage，
 * 因此 Node 测试、静态版 mock、以及未来的 Fastify 后端都能直接 import。
 *
 * 它统一描述了三件事：
 *   1. 每个实体有哪些可写字段、怎么校验（前端表单与后端校验共用一份）
 *   2. 谁能写这个实体（角色白名单 + 菜单键双重判定）
 *   3. 单据的初始状态、单号前缀、状态机合法迁移
 *
 * ⚠️ 权限白名单是对照 SQL 种子数据（sys_permission）实际菜单核对的，
 *    不是凭感觉写的。若改了种子数据里的角色菜单，这里要同步。
 */

// ── 单位预设（备件档案用） ──────────────────────────────────────────────
export const UNITS = ['台', '件', '个', '根', '套', '对', '桶', '米']

// ── 状态机：只允许表里列出的迁移 ────────────────────────────────────────
// 注意：出库的终止状态是 cancelled，不是 rejected；
// rejected 属于质检单（见 01_schema.sql 的 CHECK 约束）。
export const TRANSITIONS = {
  inbound: {
    draft: ['pending_qc', 'cancelled'],
    pending_qc: ['qc_ing', 'cancelled'],
    qc_ing: ['pending_shelf', 'cancelled'],
    pending_shelf: ['completed', 'cancelled'],
    completed: [],
    cancelled: []
  },
  outbound: {
    pending_review: ['pending_pick', 'cancelled'],
    pending_pick: ['pending_check', 'cancelled'],
    pending_check: ['completed', 'cancelled'],
    completed: [],
    cancelled: []
  },
  quality: {
    pending_qc: ['qc_ing', 'rejected'],
    qc_ing: ['completed', 'rejected'],
    completed: [],
    rejected: []
  },
  stocktake: {
    pending_count: ['counting'],
    counting: ['pending_review'],
    pending_review: ['completed'],
    completed: []
  },
  delivery: {
    pending_review: ['pending_ship', 'cancelled'],
    pending_ship: ['shipped', 'exception', 'cancelled'],
    shipped: ['in_transit', 'exception'],
    in_transit: ['signed', 'partial_signed', 'exception'],
    signed: [],
    partial_signed: [],
    exception: ['in_transit', 'signed', 'cancelled'],
    cancelled: []
  }
}

// ── 哪些状态允许编辑 / 删除（已过账的历史不可篡改） ──────────────────────
const EDITABLE_STATUS = {
  inbound: ['draft'],
  outbound: ['pending_review'],
  quality: ['pending_qc'],
  stocktake: ['pending_count'],
  delivery: ['pending_review']
}
const DELETABLE_STATUS = {
  inbound: ['draft', 'cancelled'],
  outbound: ['pending_review', 'cancelled'],
  quality: ['pending_qc', 'rejected'],
  stocktake: ['pending_count'],
  delivery: ['pending_review', 'cancelled']
}

// ── 表单字段类型 ────────────────────────────────────────────────────────
// text | number | select | switch | textarea
const F = (key, label, type, opts = {}) => ({ key, label, type, ...opts })

/**
 * 实体配置总表。
 *
 * writeRoles：允许写该实体的角色 code（与 sys_role.code 对应）
 * menuKey：   必须同时拥有的菜单权限键（与 sys_permission.menu_key 对应）
 */
export const ENTITY_SCHEMA = {
  // ══ 主数据 ══
  part: {
    table: 'part',
    label: '备件',
    menuKey: 'parts',
    writeRoles: ['super', 'admin', 'planner', 'purchaser'],
    fields: [
      F('code', '编码', 'text', { required: true, unique: true, upper: true, placeholder: 'P-XXX-000' }),
      F('name', '名称', 'text', { required: true }),
      F('spec', '规格型号', 'text'),
      F('unit', '单位', 'select', { required: true, options: UNITS.map((u) => ({ value: u, label: u })) }),
      F('safe_stock', '安全库存', 'number', { required: true, min: 0, integer: true }),
      F('supplier_id', '供应商', 'select', { required: true, optionsFrom: 'suppliers' }),
      F('is_scrap', '已报废', 'switch')
    ]
  },

  warehouse: {
    table: 'warehouse',
    label: '仓库',
    menuKey: 'basedata',
    writeRoles: ['super', 'admin'],
    fields: [
      F('base_id', '所属基地', 'select', { required: true, optionsFrom: 'bases' }),
      F('code', '仓库编码', 'text', { required: true, unique: true, upper: true, placeholder: 'WH-XXX-00' }),
      F('name', '仓库名称', 'text', { required: true }),
      F('address', '地址', 'text'),
      F('manager_id', '负责人', 'select', { optionsFrom: 'users' })
    ]
  },

  base: {
    table: 'base',
    label: '基地',
    menuKey: 'basedata',
    writeRoles: ['super'],
    fields: [
      F('code', '基地编码', 'text', { required: true, unique: true, upper: true, placeholder: 'BD-XXX' }),
      F('name', '基地名称', 'text', { required: true }),
      F('region', '地区', 'text')
    ]
  },

  supplier: {
    table: 'supplier',
    label: '供应商',
    menuKey: 'parts',
    writeRoles: ['super', 'admin', 'planner', 'purchaser'],
    fields: [
      F('code', '供应商编码', 'text', { required: true, unique: true, upper: true, placeholder: 'SUP-000' }),
      F('name', '供应商名称', 'text', { required: true }),
      F('contact', '联系方式', 'text')
    ]
  },

  customer: {
    table: 'customer',
    label: '客户',
    menuKey: 'outbound',
    writeRoles: ['super', 'admin'],
    fields: [
      F('code', '客户编码', 'text', { required: true, unique: true, upper: true, placeholder: 'CUS-000' }),
      F('name', '客户名称', 'text', { required: true }),
      F('contact', '联系人', 'text')
    ]
  },

  // ══ 单据 ══
  inbound: {
    table: 'doc_in',
    itemTable: 'doc_in_item',
    label: '入库单',
    menuKey: 'inbound',
    writeRoles: ['super', 'admin', 'keeper', 'purchaser'],
    prefix: 'IN',
    initialStatus: 'draft',
    scoped: true, // 需要 base_id / warehouse_id 范围校验
    fields: [
      F('base_id', '基地', 'select', { required: true, optionsFrom: 'bases' }),
      F('warehouse_id', '仓库', 'select', { required: true, optionsFrom: 'warehouses', dependsOn: 'base_id' }),
      F('from_src', '来源', 'select', {
        required: true,
        options: [{ value: 'purchase', label: '采购入库' }, { value: 'transfer', label: '调拨入库' }]
      }),
      F('ref_no', '关联单号', 'text')
    ],
    items: [
      F('part_id', '备件', 'select', { required: true, optionsFrom: 'parts' }),
      F('batch', '批次', 'text'),
      F('expect_qty', '应入数量', 'number', { required: true, min: 1, integer: true }),
      F('received_qty', '已入数量', 'number', { min: 0, integer: true, default: 0 }),
      F('location_id', '库位', 'select', { optionsFrom: 'locations' })
    ]
  },

  outbound: {
    table: 'doc_out',
    itemTable: 'doc_out_item',
    label: '出库单',
    menuKey: 'outbound',
    writeRoles: ['super', 'admin', 'keeper', 'delivery'],
    prefix: 'OUT',
    initialStatus: 'pending_review',
    scoped: true,
    fields: [
      F('type', '出库类型', 'select', {
        required: true,
        options: [
          { value: 'issue', label: '领用出库' },
          { value: 'transfer', label: '调拨出库' },
          { value: 'repair', label: '维修出库' },
          { value: 'scrap', label: '报废出库' }
        ]
      }),
      F('base_id', '基地', 'select', { required: true, optionsFrom: 'bases' }),
      F('warehouse_id', '仓库', 'select', { required: true, optionsFrom: 'warehouses', dependsOn: 'base_id' }),
      F('dept_name', '领用部门', 'select', { optionsFrom: 'customers' })
    ],
    items: [
      F('part_id', '备件', 'select', { required: true, optionsFrom: 'parts' }),
      F('location_id', '库位', 'select', { optionsFrom: 'locations' }),
      F('plan_qty', '计划数量', 'number', { required: true, min: 1, integer: true }),
      F('picked_qty', '已拣数量', 'number', { min: 0, integer: true, default: 0 })
    ]
  },

  quality: {
    table: 'quality',
    itemTable: 'quality_item',
    label: '质检单',
    menuKey: 'quality',
    writeRoles: ['super', 'admin', 'qc'],
    prefix: 'QC',
    initialStatus: 'pending_qc',
    scoped: true,
    fields: [
      F('from_doc_id', '来源入库单', 'select', { optionsFrom: 'inboundDocs' }),
      F('base_id', '基地', 'select', { required: true, optionsFrom: 'bases' }),
      F('warehouse_id', '仓库', 'select', { required: true, optionsFrom: 'warehouses', dependsOn: 'base_id' })
    ],
    items: [
      F('part_id', '备件', 'select', { required: true, optionsFrom: 'parts' }),
      F('batch', '批次', 'text'),
      F('check_qty', '应检数量', 'number', { required: true, min: 1, integer: true }),
      F('checked_qty', '已检数量', 'number', { min: 0, integer: true, default: 0 }),
      F('pass_qty', '合格数量', 'number', { min: 0, integer: true, default: 0 }),
      F('fail_qty', '不合格数', 'number', { min: 0, integer: true, default: 0 }),
      F('fail_reason', '不合格原因', 'text')
    ]
  },

  stocktake: {
    table: 'stocktake',
    itemTable: 'stocktake_item',
    label: '盘点单',
    menuKey: 'stocktake',
    writeRoles: ['super', 'admin', 'keeper'],
    prefix: 'ST',
    initialStatus: 'pending_count',
    scoped: true,
    fields: [
      F('scope', '盘点范围', 'text', { required: true, placeholder: '如：华东中央仓 A 区全量' }),
      F('base_id', '基地', 'select', { required: true, optionsFrom: 'bases' }),
      F('warehouse_id', '仓库', 'select', { required: true, optionsFrom: 'warehouses', dependsOn: 'base_id' })
    ],
    items: [
      F('part_id', '备件', 'select', { required: true, optionsFrom: 'parts' }),
      F('location_id', '库位', 'select', { optionsFrom: 'locations' }),
      F('batch', '批次', 'text'),
      F('book_qty', '账面数量', 'number', { required: true, min: 0, integer: true }),
      F('actual_qty', '实盘数量', 'number', { min: 0, integer: true }),
      F('reason', '差异原因', 'text')
    ]
  },

  delivery: {
    table: 'delivery',
    itemTable: 'delivery_item',
    label: '配送单',
    menuKey: 'delivery',
    writeRoles: ['super', 'admin', 'delivery'],
    prefix: 'DLV',
    initialStatus: 'pending_review',
    scoped: true, // 以 from_base_id / from_wh_id 为准
    fields: [
      F('from_base_id', '起始基地', 'select', { required: true, optionsFrom: 'bases' }),
      F('from_wh_id', '起始仓库', 'select', { required: true, optionsFrom: 'warehouses', dependsOn: 'from_base_id' }),
      F('to_base_id', '目标基地', 'select', { optionsFrom: 'bases' }),
      F('to_wh_id', '目标仓库', 'select', { optionsFrom: 'warehouses' }),
      F('to_dept', '收货单位', 'text'),
      F('carrier_name', '承运商', 'text'),
      F('courier_name', '配送员', 'text')
    ],
    items: [
      F('part_id', '备件', 'select', { required: true, optionsFrom: 'parts' }),
      F('plan_qty', '计划数量', 'number', { required: true, min: 1, integer: true }),
      F('shipped_qty', '实发数量', 'number', { min: 0, integer: true, default: 0 }),
      F('signed_qty', '签收数量', 'number', { min: 0, integer: true, default: 0 })
    ]
  }
}

/** 单据类实体（有状态机、明细、单号） */
export const DOC_KINDS = Object.keys(ENTITY_SCHEMA).filter((k) => ENTITY_SCHEMA[k].itemTable)
/** 主数据类实体 */
export const MASTER_KINDS = Object.keys(ENTITY_SCHEMA).filter((k) => !ENTITY_SCHEMA[k].itemTable)

// ══════════════════════════════════════════════════════════════════════
//  纯函数：权限判定 / 校验 / 状态检查
// ══════════════════════════════════════════════════════════════════════

/**
 * 是否能写某实体：角色白名单 **且** 拥有对应菜单。
 *
 * 为什么是「与」而不是「或」：
 *   角色决定职责边界（质检员不该建入库单），
 *   菜单决定界面可见性（没有入库菜单的用户连入口都看不到）。
 *   两者同时满足才允许，避免"权限比界面更宽"的越权面。
 */
export function canWrite(user, kind) {
  const schema = ENTITY_SCHEMA[kind]
  if (!schema || !user) return false
  const roles = user.roles || []
  const menus = user.menus || []
  const roleOk = roles.some((r) => schema.writeRoles.includes(r))
  const menuOk = !schema.menuKey || menus.includes(schema.menuKey)
  return roleOk && menuOk
}

/** 某个按钮/入口是否应该显示（供前端使用，与 canWrite 同源，避免前后端判定不一致） */
export function canWriteAny(user, kind) {
  return canWrite(user, kind)
}

function isEmpty(v) {
  return v === undefined || v === null || v === ''
}

/**
 * 校验实体数据（前端表单与后端写入共用）。
 * 返回 { ok, errors: { 字段名: 提示 } }，不抛异常，便于表单就地显示错误。
 *
 * @param {string} kind
 * @param {object} body
 * @param {{ partial?: boolean }} opts  partial=true 时只校验传了的字段（编辑场景）
 */
export function validate(kind, body, opts = {}) {
  const schema = ENTITY_SCHEMA[kind]
  if (!schema) return { ok: false, errors: { _: `未知实体类型：${kind}` } }

  const errors = {}
  const data = body || {}

  const checkFields = (fields, source, prefix = '') => {
    for (const f of fields) {
      const key = prefix ? `${prefix}.${f.key}` : f.key
      const raw = source?.[f.key]

      // 编辑时允许只传部分字段
      if (opts.partial && !(f.key in (source || {}))) continue

      if (f.required && isEmpty(raw)) {
        errors[key] = `${f.label}必填`
        continue
      }
      if (isEmpty(raw)) continue

      if (f.type === 'number') {
        const n = Number(raw)
        if (!Number.isFinite(n)) {
          errors[key] = `${f.label}必须是数字`
          continue
        }
        if (f.integer && !Number.isInteger(n)) {
          errors[key] = `${f.label}必须是整数`
          continue
        }
        if (f.min !== undefined && n < f.min) {
          errors[key] = `${f.label}不能小于 ${f.min}`
        }
      }

      if (f.type === 'text' && typeof raw === 'string' && raw.length > 256) {
        errors[key] = `${f.label}过长（最多 256 字符）`
      }
    }
  }

  checkFields(schema.fields, data)

  // 单据明细：新建时至少一行；编辑时若传了 items 才校验
  if (schema.itemTable && !opts.partial) {
    const items = Array.isArray(data.items) ? data.items : []
    if (!items.length) {
      errors.items = '至少需要一行明细'
    } else {
      items.forEach((row, i) => checkFields(schema.items, row, `items[${i}]`))
    }
  }

  return { ok: Object.keys(errors).length === 0, errors }
}

/** 该状态是否允许编辑 */
export function canEdit(kind, status) {
  const allowed = EDITABLE_STATUS[kind]
  // 主数据无状态机，任何时候都可编辑
  if (!allowed) return true
  return allowed.includes(status)
}

/** 该状态是否允许删除 */
export function canDelete(kind, status) {
  const allowed = DELETABLE_STATUS[kind]
  if (!allowed) return true
  return allowed.includes(status)
}

/** 状态迁移是否合法 */
export function canTransition(kind, from, to) {
  const map = TRANSITIONS[kind]
  if (!map) return false
  return (map[from] || []).includes(to)
}

/** 列出某状态下所有可迁移到的目标状态（前端按钮用） */
export function nextStatuses(kind, status) {
  return (TRANSITIONS[kind] || {})[status] || []
}

/** 单据表的范围列名（不同表字段名不同，集中在这里避免各处硬编码） */
export const SCOPE_COLUMNS = {
  inbound: { base: 'base_id', warehouse: 'warehouse_id' },
  outbound: { base: 'base_id', warehouse: 'warehouse_id' },
  quality: { base: 'base_id', warehouse: 'warehouse_id' },
  stocktake: { base: 'base_id', warehouse: 'warehouse_id' },
  delivery: { base: 'from_base_id', warehouse: 'from_wh_id' },
  warehouse: { base: 'base_id', warehouse: 'id' },
  base: { base: 'id', warehouse: null }
}
