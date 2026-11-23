/**
 * Fastify 后端的浏览器内等价实现。
 *
 * 原项目的 backend/src/server.js 是 535 行 Fastify + PostgreSQL。
 * 静态版把它整体搬进浏览器：数据来自 mock/db.js（localStorage），
 * 接口形状、鉴权、数据范围隔离（绑定仓库 → 绑定基地 → 跟随顶栏基地）
 * 与后端逐条对齐，因此前端视图层不需要任何改动。
 *
 * 每个函数对应一条后端路由，注释里保留了原 SQL 语义。
 */
import { getDb, persist, withTransaction, nextId, resetDb } from './db.js'
import { sha256 } from './sha256.js'
import {
  ENTITY_SCHEMA,
  SCOPE_COLUMNS,
  canWrite,
  canEdit,
  canDelete,
  canTransition,
  validate
} from '../config/entity-schema.js'

const TOKEN_KEY = 'wms_demo_tokens'

// ── 会话（对应后端内存 Map<string, userId>） ──────────────────────────
function readTokens() {
  try { return JSON.parse(localStorage.getItem(TOKEN_KEY) || '{}') } catch { return {} }
}
function writeTokens(map) {
  try { localStorage.setItem(TOKEN_KEY, JSON.stringify(map)) } catch { /* 内存模式 */ }
}

/** 小工具：模拟 SQL 的 coalesce(x, fallback) */
const or = (v, fallback = '—') => (v === null || v === undefined || v === '' ? fallback : v)

/** 模拟 ILIKE '%q%' */
const like = (v, q) => String(v ?? '').toLowerCase().includes(q.toLowerCase())

/** 模拟 SQL 排序：null 一律排最后 */
const cmp = (a, b, dir = 'asc') => {
  const an = a === null || a === undefined
  const bn = b === null || b === undefined
  if (an && bn) return 0
  if (an) return 1
  if (bn) return -1
  const r = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'zh-CN')
  return dir === 'desc' ? -r : r
}

const md = (d) => {
  const dt = new Date(d)
  return `${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

// ── 鉴权：等价于后端 loadUser() ───────────────────────────────────────
export function loadUser(id) {
  const db = getDb()
  const u = db.sys_user.find((x) => x.id === id && x.active)
  if (!u) return null
  const roleIds = db.sys_user_role.filter((r) => r.user_id === u.id).map((r) => r.role_id)
  const roles = roleIds
    .map((rid) => db.sys_role.find((r) => r.id === rid)?.code)
    .filter(Boolean)
  // perm_mode = custom → 用户级菜单；否则按角色取权限（等价 CASE WHEN + json_agg）
  let menus
  if (u.perm_mode === 'custom') {
    menus = db.sys_user_permission.filter((p) => p.user_id === u.id).map((p) => p.menu_key)
  } else {
    menus = [...new Set(
      db.sys_permission.filter((p) => roleIds.includes(p.role_id)).map((p) => p.menu_key)
    )]
  }
  return { id: u.id, username: u.username, name: u.name, base_id: u.base_id, warehouse_id: u.warehouse_id, perm_mode: u.perm_mode, roles, menus }
}

function basesFor(user) {
  const db = getDb()
  const rows = user.base_id
    ? db.base.filter((b) => b.id === user.base_id)
    : [...db.base].sort((a, b) => a.id - b.id)
  return rows.map(({ id, code, name }) => ({ id, code, name }))
}

/** 当前登录用户（由前端 api 层传入 token） */
function requireUser(token) {
  const uid = readTokens()[token]
  if (!uid) throw new ApiError(401, 'unauthorized')
  const user = loadUser(uid)
  if (!user) throw new ApiError(401, 'unauthorized')
  return user
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

/**
 * 数据范围：等价于后端 scopeOf()
 * 绑定仓库 → 按仓库过滤；否则绑定基地 → 按基地过滤；
 * 都没有（总部账号）→ 跟随前端顶栏 X-Base-Id 上下文。
 */
function scopeOf(user, ctxBaseId, baseCol, whCol) {
  if (user.warehouse_id && whCol) return { field: whCol, val: user.warehouse_id }
  const base = user.base_id || Number(ctxBaseId) || null
  if (base && baseCol) return { field: baseCol, val: base }
  return null
}

function applyScope(rows, scope) {
  if (!scope) return rows
  return rows.filter((r) => r[scope.field] === scope.val)
}

function writeLog(db, userId, action, detail) {
  db.sys_log.unshift({ id: nextId(db, 'sys_log'), user_id: userId, action, detail, ts: new Date().toISOString() })
}

// ══════════════════════════════════════════════════════════════════════
//  列表接口（对应后端 LIST_ROUTES + makeListHandler）
//  每条配置给出：行来源、搜索字段、范围列、排序、投影
// ══════════════════════════════════════════════════════════════════════
const LIST_ROUTES = {
  parts: {
    rows: (db) => db.part.map((p) => {
      const s = db.supplier.find((x) => x.id === p.supplier_id)
      return {
        _code: p.code, _name: p.name, _spec: p.spec,
        out: {
          id: p.id, code: p.code, name: p.name, spec: p.spec, unit: p.unit, safe_stock: p.safe_stock,
          supplier_name: (p.is_scrap ? '已报废 · ' : '') + or(s?.name)
        }
      }
    }),
    search: (r, q) => like(r._code, q) || like(r._name, q) || like(r._spec, q),
    sort: (a, b) => cmp(a._code, b._code),
    limit: 100
  },

  inbound: {
    rows: (db) => db.doc_in.map((d) => {
      const b = db.base.find((x) => x.id === d.base_id)
      const w = db.warehouse.find((x) => x.id === d.warehouse_id)
      const ref = or(d.ref_no)
      const SRC = { purchase: '采购入库', transfer: '调拨入库' }
      return {
        _base: d.base_id, _wh: d.warehouse_id, _no: d.no, _ref: d.ref_no, _created: d.created_at,
        out: {
          id: d.id, no: d.no, base_name: b?.name, warehouse_name: w?.name, from_src: d.from_src,
          ref_no: ref, status: d.status, created_at: d.created_at,
          extra: `${SRC[d.from_src] || d.from_src} · ${ref}`
        }
      }
    }),
    baseCol: '_base', whCol: '_wh',
    search: (r, q) => like(r._no, q) || like(r._ref, q),
    sort: (a, b) => cmp(a._created, b._created, 'desc'),
    limit: 100
  },

  outbound: {
    rows: (db) => db.doc_out.map((d) => {
      const b = db.base.find((x) => x.id === d.base_id)
      const w = db.warehouse.find((x) => x.id === d.warehouse_id)
      const dept = or(d.dept_name)
      const OTYPE = { issue: '领用出库', transfer: '调拨出库', repair: '维修出库', scrap: '报废出库' }
      return {
        _base: d.base_id, _wh: d.warehouse_id, _no: d.no, _dept: d.dept_name, _created: d.created_at,
        out: {
          id: d.id, no: d.no, base_name: b?.name, warehouse_name: w?.name, type: d.type,
          dept, status: d.status, created_at: d.created_at,
          extra: `${OTYPE[d.type] || d.type} · ${dept}`
        }
      }
    }),
    baseCol: '_base', whCol: '_wh',
    search: (r, q) => like(r._no, q) || like(r._dept, q),
    sort: (a, b) => cmp(a._created, b._created, 'desc'),
    limit: 100
  },

  delivery: {
    rows: (db) => db.delivery.map((d) => {
      const fw = db.warehouse.find((x) => x.id === d.from_wh_id)
      const tw = db.warehouse.find((x) => x.id === d.to_wh_id)
      return {
        _base: d.from_base_id, _wh: d.from_wh_id, _no: d.no, _dept: d.to_dept, _created: d.created_at,
        out: {
          id: d.id, no: d.no,
          route: `${fw?.name || '—'} → ${or(tw?.name ?? d.to_dept)}`,
          qty: d.qty, courier_name: d.courier_name, status: d.status, shipped_at: d.shipped_at
        }
      }
    }),
    baseCol: '_base', whCol: '_wh',
    search: (r, q) => like(r._no, q) || like(r._dept, q),
    sort: (a, b) => cmp(a._created, b._created, 'desc'),
    limit: 100
  },

  quality: {
    rows: (db) => db.quality.map((t) => {
      const d = db.doc_in.find((x) => x.id === t.from_doc_id)
      return {
        _base: t.base_id, _wh: t.warehouse_id, _no: t.no, _fromNo: d?.no, _created: t.created_at,
        out: {
          id: t.id, no: t.no, from_no: or(d?.no), total: t.total,
          pass_qty: t.pass_qty, fail_qty: t.fail_qty, status: t.status
        }
      }
    }),
    baseCol: '_base', whCol: '_wh',
    search: (r, q) => like(r._no, q) || like(r._fromNo, q),
    sort: (a, b) => cmp(a._created, b._created, 'desc'),
    limit: 100
  },

  stocktake: {
    rows: (db) => db.stocktake.map((t) => {
      const w = db.warehouse.find((x) => x.id === t.warehouse_id)
      return {
        _base: t.base_id, _wh: t.warehouse_id, _no: t.no, _scope: t.scope, _created: t.created_at,
        out: { id: t.id, no: t.no, scope: t.scope, warehouse_name: w?.name, status: t.status, created_at: t.created_at }
      }
    }),
    baseCol: '_base', whCol: '_wh',
    search: (r, q) => like(r._no, q) || like(r._scope, q),
    sort: (a, b) => cmp(a._created, b._created, 'desc'),
    limit: 100
  },

  flow: {
    rows: (db) => db.inventory_flow.map((f) => {
      const p = db.part.find((x) => x.id === f.part_id)
      const wh = db.warehouse.find((x) => x.id === f.warehouse_id)
      const FTYPE = { in: '入库', out: '出库', transfer: '调拨', count_adjust: '盘点调整', freeze: '冻结', unfreeze: '解冻', transit_in: '在途入', transit_out: '在途出' }
      return {
        _base: wh?.base_id, _wh: f.warehouse_id, _code: p?.code, _name: p?.name, _ref: f.ref_doc, _ts: f.ts,
        out: {
          ts: f.ts, part_code: p?.code, part_name: p?.name, qty_change: f.qty_change,
          type: FTYPE[f.type] || f.type, ref_doc: f.ref_doc, after_qty: f.after_qty
        }
      }
    }),
    baseCol: '_base', whCol: '_wh',
    search: (r, q) => like(r._code, q) || like(r._name, q) || like(r._ref, q),
    sort: (a, b) => cmp(a._ts, b._ts, 'desc'),
    limit: 200
  },

  basedata: {
    rows: (db) => db.warehouse.map((w) => {
      const b = db.base.find((x) => x.id === w.base_id)
      return {
        _base: w.base_id, _wh: w.id, _code: w.code, _name: w.name,
        out: { id: w.id, base_name: b?.name, code: w.code, name: w.name, address: or(w.address) }
      }
    }),
    baseCol: '_base', whCol: '_wh',
    search: (r, q) => like(r._code, q) || like(r._name, q),
    sort: (a, b) => cmp(a._code, b._code),
    limit: 100
  },

  device: {
    rows: (db) => db.device.map((dv) => {
      const w = db.warehouse.find((x) => x.id === dv.bound_warehouse_id)
      return {
        _base: w?.base_id, _wh: dv.bound_warehouse_id, _code: dv.code, _name: dv.name,
        out: {
          id: dv.id, code: dv.code, name: dv.name, type: dv.type,
          warehouse_name: or(w?.name), online: dv.online, last_heartbeat: dv.last_heartbeat
        }
      }
    }),
    baseCol: '_base', whCol: '_wh',
    search: (r, q) => like(r._code, q) || like(r._name, q),
    sort: (a, b) => cmp(a._code, b._code),
    limit: 100
  },

  system: {
    rows: (db) => db.sys_user.map((u) => {
      const b = db.base.find((x) => x.id === u.base_id)
      const wh = db.warehouse.find((x) => x.id === u.warehouse_id)
      const roleIds = db.sys_user_role.filter((r) => r.user_id === u.id).map((r) => r.role_id)
      const roleNames = roleIds.map((rid) => db.sys_role.find((r) => r.id === rid)?.name).filter(Boolean)
      const menuKeys = db.sys_user_permission.filter((p) => p.user_id === u.id).map((p) => p.menu_key)
      return {
        _base: u.base_id, _wh: u.warehouse_id, _username: u.username, _name: u.name,
        out: {
          id: u.id, username: u.username, name: u.name, active: u.active,
          base_id: u.base_id, warehouse_id: u.warehouse_id, perm_mode: u.perm_mode,
          roles: roleNames.length ? roleNames.join(' / ') : (u.perm_mode === 'custom' ? '自定义' : '—'),
          role_ids: roleIds, menu_keys: menuKeys,
          base_name: b?.name || '全部基地',
          warehouse_name: or(wh?.name)
        }
      }
    }),
    baseCol: '_base', whCol: '_wh',
    search: (r, q) => like(r._username, q) || like(r._name, q),
    sort: (a, b) => cmp(a.out.id, b.out.id),
    limit: 100
  },

  warehouses: {
    rows: (db) => db.warehouse.map((w) => {
      const b = db.base.find((x) => x.id === w.base_id)
      return {
        _base: w.base_id, _wh: w.id, _name: w.name,
        out: { id: w.id, code: w.code, name: w.name, base_id: b?.id }
      }
    }),
    baseCol: '_base', whCol: '_wh',
    allowAll: true,
    search: (r, q) => like(r._name, q),
    sort: (a, b) => cmp(a.out.id, b.out.id),
    limit: 100
  },

  inventory: {
    rows: (db) => db.inventory.map((i) => {
      const p = db.part.find((x) => x.id === i.part_id)
      const wh = db.warehouse.find((x) => x.id === i.warehouse_id)
      const l = db.location.find((x) => x.id === i.location_id)
      return {
        _base: i.base_id, _wh: i.warehouse_id, _code: p?.code, _name: p?.name,
        filters: { warehouse_id: i.warehouse_id, status: i.status },
        out: {
          id: i.id, part_code: p?.code, part_name: p?.name, spec: p?.spec,
          // 原 SQL 版没有这一列；多仓库演示里显式带上仓库名更直观
          warehouse_name: wh?.name,
          location_code: l?.code ?? null, batch: i.batch,
          avail_qty: i.avail_qty, frozen_qty: i.frozen_qty, in_transit_qty: i.in_transit_qty,
          safe_stock: p?.safe_stock, status: i.status, updated_at: i.updated_at,
          low: i.avail_qty < (p?.safe_stock ?? 0) && i.status === 'normal'
        }
      }
    }),
    baseCol: '_base', whCol: '_wh',
    filterDefs: [
      { key: 'warehouse_id', get: (r) => r.filters.warehouse_id, numeric: true },
      { key: 'status', get: (r) => r.filters.status }
    ],
    search: (r, q) => like(r._code, q) || like(r._name, q),
    // order by p.code, w.code —— 同一备件在不同仓库时按仓库编码稳定排序
    sort: (a, b) => cmp(a._code, b._code) || cmp(a.out.location_code, b.out.location_code),
    limit: 100
  }
}

/** 等价于后端 makeListHandler(): 过滤 → 搜索 → 范围隔离 → 排序 → 截断 */
function runList(cfg, { user, token, query = {}, baseId }) {
  const db = getDb()
  let rows = cfg.rows(db)

  for (const f of cfg.filterDefs || []) {
    const v = query[f.key]
    if (v === undefined || v === '' || v === null) continue
    const want = f.numeric ? Number(v) : v
    rows = rows.filter((r) => f.get(r) === want)
  }

  if (query.q) rows = rows.filter((r) => cfg.search(r, query.q))

  const skipScope = cfg.allowAll && query.all === '1'
  if (!skipScope) {
    const scope = scopeOf(user, baseId, cfg.baseCol, cfg.whCol)
    rows = applyScope(rows, scope)
  }

  rows.sort(cfg.sort)
  return rows.slice(0, cfg.limit || 100).map((r) => r.out)
}

// ══════════════════════════════════════════════════════════════════════
//  详情接口（对应后端 DETAILS + /api/detail/:kind/:id）
// ══════════════════════════════════════════════════════════════════════
const DETAILS = {
  inbound: {
    baseCol: 'base_id', whCol: 'warehouse_id',
    header: (db, id) => {
      const d = db.doc_in.find((x) => x.id === id)
      if (!d) return null
      const b = db.base.find((x) => x.id === d.base_id)
      const w = db.warehouse.find((x) => x.id === d.warehouse_id)
      const u = db.sys_user.find((x) => x.id === d.creator_id)
      return {
        id: d.id, no: d.no, status: d.status, from_src: d.from_src, ref_no: or(d.ref_no),
        base_name: b?.name, warehouse_name: w?.name, creator_name: or(u?.name),
        created_at: d.created_at, updated_at: d.updated_at
      }
    },
    items: (db, id) => db.doc_in_item.filter((i) => i.doc_id === id).map((i) => {
      const p = db.part.find((x) => x.id === i.part_id)
      const l = db.location.find((x) => x.id === i.location_id)
      return {
        part_code: p?.code, part_name: p?.name, batch: or(i.batch), serial_no: or(i.serial_no),
        expect_qty: i.expect_qty, received_qty: i.received_qty,
        remain_qty: i.expect_qty - i.received_qty, location_code: or(l?.code)
      }
    })
  },

  outbound: {
    baseCol: 'base_id', whCol: 'warehouse_id',
    header: (db, id) => {
      const d = db.doc_out.find((x) => x.id === id)
      if (!d) return null
      const b = db.base.find((x) => x.id === d.base_id)
      const w = db.warehouse.find((x) => x.id === d.warehouse_id)
      const u = db.sys_user.find((x) => x.id === d.creator_id)
      return {
        id: d.id, no: d.no, status: d.status, type: d.type, dept_name: or(d.dept_name),
        base_name: b?.name, warehouse_name: w?.name, creator_name: or(u?.name),
        created_at: d.created_at, updated_at: d.updated_at
      }
    },
    items: (db, id) => db.doc_out_item.filter((i) => i.doc_id === id).map((i) => {
      const p = db.part.find((x) => x.id === i.part_id)
      const l = db.location.find((x) => x.id === i.location_id)
      return {
        part_code: p?.code, part_name: p?.name, location_code: or(l?.code),
        plan_qty: i.plan_qty, picked_qty: i.picked_qty
      }
    })
  },

  delivery: {
    baseCol: 'from_base_id', whCol: 'from_wh_id',
    header: (db, id) => {
      const d = db.delivery.find((x) => x.id === id)
      if (!d) return null
      const fw = db.warehouse.find((x) => x.id === d.from_wh_id)
      const tw = db.warehouse.find((x) => x.id === d.to_wh_id)
      return {
        id: d.id, no: d.no, status: d.status,
        route: `${fw?.name || '—'} → ${or(tw?.name ?? d.to_dept)}`,
        carrier_name: or(d.carrier_name), courier_name: or(d.courier_name),
        qty: d.qty, shipped_at: d.shipped_at, signed_at: d.signed_at, created_at: d.created_at
      }
    },
    items: (db, id) => db.delivery_item.filter((i) => i.doc_id === id).map((i) => {
      const p = db.part.find((x) => x.id === i.part_id)
      return { part_code: p?.code, part_name: p?.name, plan_qty: i.plan_qty, shipped_qty: i.shipped_qty, signed_qty: i.signed_qty }
    })
  },

  quality: {
    baseCol: 'base_id', whCol: 'warehouse_id',
    header: (db, id) => {
      const t = db.quality.find((x) => x.id === id)
      if (!t) return null
      const d = db.doc_in.find((x) => x.id === t.from_doc_id)
      const b = db.base.find((x) => x.id === t.base_id)
      const w = db.warehouse.find((x) => x.id === t.warehouse_id)
      const u = db.sys_user.find((x) => x.id === t.creator_id)
      return {
        id: t.id, no: t.no, from_no: or(d?.no), status: t.status,
        total: t.total, pass_qty: t.pass_qty, fail_qty: t.fail_qty,
        base_name: b?.name, warehouse_name: w?.name, creator_name: or(u?.name), created_at: t.created_at
      }
    },
    items: (db, id) => db.quality_item.filter((i) => i.doc_id === id).map((i) => {
      const p = db.part.find((x) => x.id === i.part_id)
      return {
        part_code: p?.code, part_name: p?.name, batch: or(i.batch),
        check_qty: i.check_qty, checked_qty: i.checked_qty,
        pass_qty: i.pass_qty, fail_qty: i.fail_qty, fail_reason: or(i.fail_reason)
      }
    })
  },

  stocktake: {
    baseCol: 'base_id', whCol: 'warehouse_id',
    header: (db, id) => {
      const t = db.stocktake.find((x) => x.id === id)
      if (!t) return null
      const w = db.warehouse.find((x) => x.id === t.warehouse_id)
      const u = db.sys_user.find((x) => x.id === t.creator_id)
      return {
        id: t.id, no: t.no, scope: t.scope, status: t.status,
        warehouse_name: w?.name, creator_name: or(u?.name), created_at: t.created_at
      }
    },
    items: (db, id) => db.stocktake_item.filter((i) => i.doc_id === id).map((i) => {
      const p = db.part.find((x) => x.id === i.part_id)
      const l = db.location.find((x) => x.id === i.location_id)
      return {
        part_code: p?.code, part_name: p?.name, location_code: or(l?.code),
        batch: or(i.batch), book_qty: i.book_qty, actual_qty: i.actual_qty,
        diff: i.diff, reason: or(i.reason)
      }
    })
  },

  part: {
    header: (db, id) => {
      const p = db.part.find((x) => x.id === id)
      if (!p) return null
      const s = db.supplier.find((x) => x.id === p.supplier_id)
      return {
        id: p.id, code: p.code, name: p.name, spec: or(p.spec), unit: p.unit,
        safe_stock: p.safe_stock, is_scrap: p.is_scrap,
        supplier_name: or(s?.name), supplier_contact: or(s?.contact)
      }
    },
    extras: {
      stock: (db, h) => db.inventory.filter((i) => i.part_id === h.id).map((i) => {
        const w = db.warehouse.find((x) => x.id === i.warehouse_id)
        const l = db.location.find((x) => x.id === i.location_id)
        return {
          warehouse_name: w?.name, location_code: or(l?.code), batch: i.batch,
          avail_qty: i.avail_qty, frozen_qty: i.frozen_qty, in_transit_qty: i.in_transit_qty, status: i.status
        }
      }),
      flows: (db, h) => db.inventory_flow
        .filter((f) => f.part_id === h.id)
        .sort((a, b) => cmp(a.ts, b.ts, 'desc'))
        .slice(0, 10)
        .map((f) => ({ ts: f.ts, qty_change: f.qty_change, type: f.type, ref_doc: or(f.ref_doc), after_qty: f.after_qty }))
    }
  },

  inventory: {
    baseCol: 'base_id', whCol: 'warehouse_id',
    header: (db, id) => {
      const i = db.inventory.find((x) => x.id === id)
      if (!i) return null
      const p = db.part.find((x) => x.id === i.part_id)
      const w = db.warehouse.find((x) => x.id === i.warehouse_id)
      const l = db.location.find((x) => x.id === i.location_id)
      return {
        id: i.id, part_id: i.part_id, warehouse_id: i.warehouse_id,
        part_code: p?.code, part_name: p?.name, spec: or(p?.spec),
        warehouse_name: w?.name, location_code: or(l?.code), batch: i.batch,
        avail_qty: i.avail_qty, frozen_qty: i.frozen_qty, in_transit_qty: i.in_transit_qty,
        safe_stock: p?.safe_stock, status: i.status, updated_at: i.updated_at
      }
    },
    extras: {
      flows: (db, h) => db.inventory_flow
        .filter((f) => f.part_id === h.part_id && f.warehouse_id === h.warehouse_id)
        .sort((a, b) => cmp(a.ts, b.ts, 'desc'))
        .slice(0, 15)
        .map((f) => ({
          ts: f.ts, qty_change: f.qty_change, type: f.type, ref_doc: or(f.ref_doc),
          before_qty: f.before_qty, after_qty: f.after_qty
        }))
    }
  },

  device: {
    baseCol: 'base_id', whCol: 'bound_warehouse_id',
    header: (db, id) => {
      const dv = db.device.find((x) => x.id === id)
      if (!dv) return null
      const w = db.warehouse.find((x) => x.id === dv.bound_warehouse_id)
      return {
        id: dv.id, code: dv.code, name: or(dv.name), type: dv.type, online: dv.online,
        last_heartbeat: dv.last_heartbeat, warehouse_name: or(w?.name, '未绑定')
      }
    }
  },

  basedata: {
    baseCol: 'base_id', whCol: 'id',
    header: (db, id) => {
      const w = db.warehouse.find((x) => x.id === id)
      if (!w) return null
      const b = db.base.find((x) => x.id === w.base_id)
      const u = db.sys_user.find((x) => x.id === w.manager_id)
      return {
        id: w.id, code: w.code, name: w.name, address: or(w.address),
        base_name: b?.name, manager_name: or(u?.name)
      }
    },
    extras: {
      stats: (db, h) => [{
        bin_count: db.location.filter((l) => l.warehouse_id === h.id && l.type === 'bin').length,
        part_count: new Set(db.inventory.filter((i) => i.warehouse_id === h.id).map((i) => i.part_id)).size,
        avail_qty: db.inventory.filter((i) => i.warehouse_id === h.id).reduce((s, i) => s + i.avail_qty, 0)
      }]
    }
  }
}

function runDetail(kind, id, { user, baseId }) {
  const cfg = DETAILS[kind]
  if (!cfg) throw new ApiError(404, 'unknown kind')
  const db = getDb()
  const header = cfg.header(db, id)
  if (!header) throw new ApiError(404, '不存在或无权查看')

  // 范围校验：命中不到行时等价于后端 `where id=$1 and <scope>` 查无结果。
  // 用原始行判定，避免投影后字段丢失。
  const raw = rawScopeOf(kind, db, id)
  const scope = raw ? scopeOf(user, baseId, cfg.baseCol, cfg.whCol) : null
  if (scope && raw[scope.field] !== scope.val) throw new ApiError(404, '不存在或无权查看')

  const out = { header }
  if (cfg.items) out.items = cfg.items(db, id)
  for (const [key, fn] of Object.entries(cfg.extras || {})) {
    out[key] = fn(db, header)
  }
  return out
}

/** 取原始行里的范围列（对应后端直接拿表列过滤） */
function rawScopeOf(kind, db, id) {
  switch (kind) {
    case 'inbound': return db.doc_in.find((x) => x.id === id)
    case 'outbound': return db.doc_out.find((x) => x.id === id)
    case 'delivery': return db.delivery.find((x) => x.id === id)
    case 'quality': return db.quality.find((x) => x.id === id)
    case 'stocktake': return db.stocktake.find((x) => x.id === id)
    case 'inventory': return db.inventory.find((x) => x.id === id)
    case 'device': return db.device.find((x) => x.id === id)
    case 'basedata': return db.warehouse.find((x) => x.id === id)
    default: return null
  }
}

// ══════════════════════════════════════════════════════════════════════
//  公开 API
// ══════════════════════════════════════════════════════════════════════

export function login({ username, password }) {
  const db = getDb()
  const hash = sha256(password || '')
  const u = db.sys_user.find((x) => x.username === username && x.password_hash === hash && x.active)
  if (!u) throw new ApiError(401, 'invalid credentials')
  const user = loadUser(u.id)
  const token = `demo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  const tokens = readTokens()
  tokens[token] = u.id
  writeTokens(tokens)
  withTransaction((d) => writeLog(d, u.id, 'login', '登录系统'))
  return { token, user, bases: basesFor(user) }
}

export function me(token, baseId) {
  const user = requireUser(token)
  return { user, bases: basesFor(user) }
}

export function list(kind, { token, baseId, query }) {
  const cfg = LIST_ROUTES[kind]
  if (!cfg) throw new ApiError(404, `unknown list: ${kind}`)
  return runList(cfg, { user: requireUser(token), baseId, query })
}

export function detail(kind, id, { token, baseId }) {
  return runDetail(kind, Number(id), { user: requireUser(token), baseId })
}

export function roles(token) {
  requireUser(token)
  return getDb().sys_role.map(({ id, code, name }) => ({ id, code, name }))
}

/** 看板：等价于后端 /api/dashboard */
export function dashboard({ token, baseId }) {
  const user = requireUser(token)
  const db = getDb()

  const whScope = user.warehouse_id || null
  const baseScope = whScope ? null : (user.base_id || Number(baseId) || null)

  /** 生成范围过滤谓词，对应后端 mcond() */
  const inScope = (row, baseField, whField) => {
    if (whScope) return row[whField] === whScope
    if (baseScope) return row[baseField] === baseScope
    return true
  }

  const metrics = {
    pending_in: db.doc_in.filter((d) => ['draft', 'pending_qc', 'qc_ing', 'pending_shelf'].includes(d.status) && inScope(d, 'base_id', 'warehouse_id')).length,
    pending_out: db.doc_out.filter((d) => ['pending_review', 'pending_pick', 'pending_check'].includes(d.status) && inScope(d, 'base_id', 'warehouse_id')).length,
    pending_qc: db.quality.filter((t) => ['pending_qc', 'qc_ing'].includes(t.status) && inScope(t, 'base_id', 'warehouse_id')).length,
    pending_delivery: db.delivery.filter((t) => ['pending_review', 'pending_ship'].includes(t.status) && inScope(t, 'from_base_id', 'from_wh_id')).length,
    stock_alerts: db.inventory.filter((i) => {
      if (i.status !== 'normal') return false
      const p = db.part.find((x) => x.id === i.part_id)
      return i.avail_qty < (p?.safe_stock ?? 0) && inScope(i, 'base_id', 'warehouse_id')
    }).length
  }

  const byDesc = (field) => (a, b) => cmp(a[field], b[field], 'desc')
  const todos = [
    ...db.doc_in.filter((d) => ['draft', 'pending_qc', 'qc_ing', 'pending_shelf'].includes(d.status) && inScope(d, 'base_id', 'warehouse_id'))
      .sort(byDesc('created_at')).slice(0, 8)
      .map((d) => ({ kind: 'inbound', no: d.no, title: `入库 · ${d.ref_no || d.from_src}`, status: d.status, created_at: d.created_at })),
    ...db.doc_out.filter((d) => ['pending_review', 'pending_pick', 'pending_check'].includes(d.status) && inScope(d, 'base_id', 'warehouse_id'))
      .sort(byDesc('created_at')).slice(0, 8)
      .map((d) => ({ kind: 'outbound', no: d.no, title: `出库 · ${d.dept_name || d.type}`, status: d.status, created_at: d.created_at })),
    ...db.quality.filter((t) => ['pending_qc', 'qc_ing'].includes(t.status) && inScope(t, 'base_id', 'warehouse_id'))
      .sort(byDesc('created_at')).slice(0, 8)
      .map((t) => ({ kind: 'quality', no: t.no, title: `质检 · ${t.total} 件`, status: t.status, created_at: t.created_at })),
    ...db.stocktake.filter((t) => ['pending_count', 'counting', 'pending_review'].includes(t.status) && inScope(t, 'base_id', 'warehouse_id'))
      .sort(byDesc('created_at')).slice(0, 8)
      .map((t) => ({ kind: 'stocktake', no: t.no, title: `盘点 · ${t.scope}`, status: t.status, created_at: t.created_at })),
    ...db.delivery.filter((t) => ['pending_review', 'pending_ship', 'in_transit'].includes(t.status) && inScope(t, 'from_base_id', 'from_wh_id'))
      .sort(byDesc('created_at')).slice(0, 8)
      .map((t) => ({ kind: 'delivery', no: t.no, title: `配送 · ${t.to_dept || '基地间'}`, status: t.status, created_at: t.created_at }))
  ]

  // 异常单据（原版此查询漏了范围过滤，这里补上，避免跨基地泄漏）
  const alerts = []
  for (const dv of db.delivery) {
    if (dv.status === 'exception' && inScope(dv, 'from_base_id', 'from_wh_id')) {
      alerts.push({ title: '配送异常', no: dv.no, reason: '配送超时', kind: 'delivery', id: dv.id })
    }
  }
  for (const t of db.quality) {
    if (t.fail_qty > 0 && inScope(t, 'base_id', 'warehouse_id')) {
      alerts.push({ title: '质检不合格', no: t.no, reason: `${t.fail_qty} 件不合格`, kind: 'quality', id: t.id })
    }
  }
  for (const t of db.stocktake) {
    if (t.status !== 'pending_review' || !inScope(t, 'base_id', 'warehouse_id')) continue
    const diff = db.stocktake_item.filter((i) => i.doc_id === t.id).reduce((s, i) => s + (i.diff || 0), 0)
    alerts.push({ title: '盘点差异待审批', no: t.no, reason: `差异 ${diff} 件`, kind: 'stocktake', id: t.id })
  }

  // 近 7 天出入库趋势
  const since = Date.now() - 7 * 24 * 60 * 60 * 1000
  const buckets = new Map()
  for (const f of db.inventory_flow) {
    const ts = new Date(f.ts).getTime()
    if (ts <= since) continue
    const wh = db.warehouse.find((x) => x.id === f.warehouse_id)
    if (whScope && f.warehouse_id !== whScope) continue
    if (!whScope && baseScope && wh?.base_id !== baseScope) continue
    const day = md(f.ts)
    const cur = buckets.get(day) || { day, in_qty: 0, out_qty: 0 }
    if (f.qty_change > 0) cur.in_qty += f.qty_change
    if (f.qty_change < 0) cur.out_qty += -f.qty_change
    buckets.set(day, cur)
  }
  const trend = [...buckets.values()].sort((a, b) => a.day.localeCompare(b.day))

  const bases = (user.base_id ? db.base.filter((b) => b.id === user.base_id) : db.base)
    .map((b) => ({
      name: b.name,
      qty: db.inventory.filter((i) => i.base_id === b.id).reduce((s, i) => s + i.avail_qty, 0)
    }))

  // 状态条显示的基地口径要与实际过滤口径一致：
  //   用户绑定基地 → 该基地名
  //   否则跟随顶栏 X-Base-Id → 该基地名
  //   都没有 → null（前端显示「全部基地」）
  // 曾经这里只处理 user.base_id，导致总部账号切换顶栏后，
  // 数据已按选中基地过滤，但状态条仍显示「全部基地」——口径不一致。
  const effectiveBaseId = user.base_id || baseScope || null
  const baseName = effectiveBaseId
    ? (db.base.find((b) => b.id === effectiveBaseId)?.name ?? null)
    : null

  return { metrics, todos, alerts, trend, bases, base_name: baseName }
}


// ══════════════════════════════════════════════════════════════════════
//  通用写入（配置驱动，与 entity-schema.js 共用一份字段/权限/状态机定义）
//
//  与后端 Fastify 版的对应关系：
//    create/update/remove  → POST/PATCH/DELETE /api/:kind[/:id]
//    options               → GET /api/options
//    transition            → POST /api/:kind/:id/transition
//  所有写操作都在 withTransaction 内完成，失败整体回滚。
// ══════════════════════════════════════════════════════════════════════

/** 取实体配置；未知 kind 直接 404，避免任意表被写 */
function schemaOf(kind) {
  const schema = ENTITY_SCHEMA[kind]
  if (!schema) throw new ApiError(404, `unknown kind: ${kind}`)
  return schema
}

/** 写权限：角色白名单 且 拥有对应菜单（与前端 canWrite 同源） */
function requireWrite(user, kind) {
  if (!canWrite(user, kind)) throw new ApiError(403, '当前角色无写入权限')
}

/**
 * 取一条数据并校验数据范围。
 * 与 runDetail 的语义一致：范围外按 404 处理，不暴露"存在但无权"的信号。
 */
function scopedRowOr404(kind, db, id, user, baseId) {
  const schema = schemaOf(kind)
  const row = db[schema.table].find((r) => r.id === id)
  if (!row) throw new ApiError(404, '数据不存在')

  const cols = SCOPE_COLUMNS[kind]
  // 主数据若未配置范围列，则所有登录用户可改自己权限内的实体（权限已由 requireWrite 把关）
  if (!cols) return row

  const scope = scopeOf(user, baseId, cols.base, cols.warehouse)
  if (scope && row[scope.field] !== scope.val) throw new ApiError(404, '不存在或无权查看')
  return row
}

/** 校验 body 里的 base_id / warehouse_id 是否落在当前用户范围内 */
function assertWriteScope(kind, body, user, baseId) {
  const cols = SCOPE_COLUMNS[kind]
  if (!cols) return

  // 用户绑定仓库 → 只能写本仓库
  if (user.warehouse_id) {
    const wh = body[cols.warehouse]
    if (wh != null && Number(wh) !== user.warehouse_id) {
      throw new ApiError(403, '只能操作本仓库的数据')
    }
    return
  }

  // 用户绑定基地（或无绑定、跟随顶栏） → 只能写本基地
  const effectiveBase = user.base_id || Number(baseId) || null
  if (effectiveBase) {
    const b = body[cols.base]
    if (b != null && Number(b) !== effectiveBase) {
      throw new ApiError(403, '只能操作本基地的数据')
    }
  }
}

// ── 单号生成：PREFIX-YYYYMMDD-NNN，当天同前缀最大序号 +1 ────────────────
function genNo(db, table, prefix) {
  const d = new Date()
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  const head = `${prefix}-${date}-`
  const maxSeq = (db[table] || [])
    .map((r) => String(r.no || ''))
    .filter((no) => no.startsWith(head))
    .reduce((max, no) => Math.max(max, Number(no.slice(head.length)) || 0), 0)
  return `${head}${String(maxSeq + 1).padStart(3, '0')}`
}

/** 按配置从 body 里挑出可写字段（丢弃多余字段，防脏写） */
function pickFields(fields, body) {
  const out = {}
  for (const f of fields) {
    if (!(f.key in (body || {}))) continue
    let v = body[f.key]
    if (v === '' || v === undefined) v = null
    if (f.type === 'number' && v !== null) v = Number(v)
    if (f.type === 'switch') v = Boolean(v)
    if (f.type === 'text' && typeof v === 'string' && f.upper) v = v.toUpperCase()
    out[f.key] = v
  }
  return out
}

/** 写入明细行（逐行分配 id） */
/**
 * 明细外键校验：postgres 有 FK 兜底，浏览器版必须自己查。
 *
 * 两个容易漏掉的点：
 *   1. part_id 必须存在 —— 否则详情页会显示 undefined，库存永远配不上
 *   2. location_id 必须属于**本单据的仓库** —— 仅校验"库位存在"不够，
 *      把仓库 3 的库位填进仓库 1 的单据会造成跨仓上架，账实直接错位
 */
function assertItemRefs(db, schema, row, headerRow) {
  if (row.part_id != null) {
    const part = db.part.find((p) => p.id === Number(row.part_id))
    if (!part) throw new ApiError(400, `备件不存在（id=${row.part_id}）`)
  }

  if (row.location_id != null) {
    const loc = db.location.find((l) => l.id === Number(row.location_id))
    if (!loc) throw new ApiError(400, `库位不存在（id=${row.location_id}）`)
    // 库位必须落在单据所属仓库内
    const whId = headerRow?.warehouse_id ?? headerRow?.from_wh_id ?? null
    if (whId != null && loc.warehouse_id !== whId) {
      throw new ApiError(400, `库位 ${loc.code} 不属于本单据的仓库`)
    }
    // 库位类型必须是 bin（库区/货架不能直接放货）
    if (loc.type !== 'bin') {
      throw new ApiError(400, `库位 ${loc.code} 不是可存放的库位（类型为 ${loc.type}）`)
    }
  }
}

function insertItems(db, schema, docId, items, headerRow) {
  for (const raw of items || []) {
    const row = pickFields(schema.items, raw)
    assertItemRefs(db, schema, row, headerRow)
    row.id = nextId(db, schema.itemTable)
    row.doc_id = docId
    // 派生字段：盘点差异自动计算，不信任前端
    if (schema.itemTable === 'stocktake_item') {
      row.diff = row.actual_qty == null || row.book_qty == null
        ? null
        : Number(row.actual_qty) - Number(row.book_qty)
    }
    db[schema.itemTable].push(row)
  }
}

/** 文档类实体的头表汇总字段（total / qty 由明细重算） */
function recomputeHeaderTotals(db, kind, row) {
  const schema = schemaOf(kind)
  if (!schema.itemTable) return
  const items = db[schema.itemTable].filter((i) => i.doc_id === row.id)
  if (kind === 'quality') {
    row.total = items.reduce((s, i) => s + (Number(i.check_qty) || 0), 0)
    row.pass_qty = items.reduce((s, i) => s + (Number(i.pass_qty) || 0), 0)
    row.fail_qty = items.reduce((s, i) => s + (Number(i.fail_qty) || 0), 0)
  }
  if (kind === 'delivery') {
    row.qty = items.reduce((s, i) => s + (Number(i.plan_qty) || 0), 0)
  }
}

/** 唯一性检查（编码类字段） */
function assertUnique(db, schema, body, excludeId = null) {
  for (const f of schema.fields) {
    if (!f.unique) continue
    const v = body[f.key]
    if (v == null) continue
    const dup = db[schema.table].find((r) => r[f.key] === v && r.id !== excludeId)
    if (dup) throw new ApiError(409, `${f.label}已存在`)
  }
}

/** 删除保护：被引用的数据不允许硬删 */
function assertDeletable(db, kind, row) {
  if (kind === 'part') {
    const usedInInventory = db.inventory.some((i) => i.part_id === row.id)
    const usedInItems = ['doc_in_item', 'doc_out_item', 'quality_item', 'stocktake_item', 'delivery_item']
      .some((t) => (db[t] || []).some((i) => i.part_id === row.id))
    if (usedInInventory || usedInItems) {
      throw new ApiError(409, '该备件已被库存或单据引用，不可删除。可改为「已报废」标记')
    }
  }
  if (kind === 'warehouse') {
    const hasLoc = (db.location || []).some((l) => l.warehouse_id === row.id)
    const hasInv = (db.inventory || []).some((i) => i.warehouse_id === row.id)
    if (hasLoc || hasInv) throw new ApiError(409, '该仓库下还有库位或库存，不可删除')
  }
  if (kind === 'base') {
    const hasWh = (db.warehouse || []).some((w) => w.base_id === row.id)
    if (hasWh) throw new ApiError(409, '该基地下还有仓库，不可删除')
  }
  if (kind === 'supplier') {
    const hasPart = (db.part || []).some((p) => p.supplier_id === row.id)
    if (hasPart) throw new ApiError(409, '该供应商已被备件引用，不可删除')
  }
}

// ── 公开写入接口 ──────────────────────────────────────────────────────

/** 新建（对应后端 POST /api/:kind） */
export function create(kind, body, { token, baseId } = {}) {
  const user = requireUser(token)
  const schema = schemaOf(kind)
  requireWrite(user, kind)

  const { ok, errors } = validate(kind, body)
  if (!ok) {
    const first = Object.values(errors)[0]
    throw new ApiError(400, first || '数据校验未通过')
  }
  assertWriteScope(kind, body, user, baseId)

  return withTransaction((db) => {
    assertUnique(db, schema, body)
    const row = pickFields(schema.fields, body)
    row.id = nextId(db, schema.table)

    if (schema.prefix) {
      row.no = genNo(db, schema.table, schema.prefix)
      row.status = schema.initialStatus
      row.creator_id = user.id
      row.created_at = new Date().toISOString()
      row.updated_at = row.created_at
      // 过账标记：null 表示尚未过账，用于 transition 幂等保护
      row.posted_at = null
    } else if (schema.table === 'part') {
      row.is_scrap = Boolean(body.is_scrap)
      row.created_at = new Date().toISOString()
    }

    db[schema.table].push(row)
    if (schema.itemTable) {
      insertItems(db, schema, row.id, body.items, row)
      recomputeHeaderTotals(db, kind, row)
    }

    writeLog(db, user.id, `${kind}.create`, `新建${schema.label} ${row.no || row.code || '#' + row.id}`)
    return { id: row.id, ...(row.no ? { no: row.no } : {}) }
  })
}

/** 编辑（对应后端 PATCH /api/:kind/:id） */
export function update(kind, id, body, { token, baseId } = {}) {
  const user = requireUser(token)
  const schema = schemaOf(kind)
  requireWrite(user, kind)

  const { ok, errors } = validate(kind, body, { partial: true })
  if (!ok) throw new ApiError(400, Object.values(errors)[0] || '数据校验未通过')

  return withTransaction((db) => {
    const row = scopedRowOr404(kind, db, Number(id), user, baseId)

    // 状态保护：只有允许编辑的状态才能改
    if (schema.itemTable && !canEdit(kind, row.status)) {
      throw new ApiError(409, '该状态不可编辑')
    }
    assertUnique(db, schema, body, row.id)
    assertWriteScope(kind, body, user, baseId)

    Object.assign(row, pickFields(schema.fields, body))
    if (schema.itemTable) {
      row.updated_at = new Date().toISOString()
      // 明细采用「全量替换」语义：传了 items 才重写
      if (Array.isArray(body.items)) {
        db[schema.itemTable] = db[schema.itemTable].filter((i) => i.doc_id !== row.id)
        insertItems(db, schema, row.id, body.items, row)
      }
      recomputeHeaderTotals(db, kind, row)
    }

    writeLog(db, user.id, `${kind}.update`, `修改${schema.label} ${row.no || row.code || '#' + row.id}`)
    return { ok: true }
  })
}

/** 删除（对应后端 DELETE /api/:kind/:id） */
export function remove(kind, id, { token, baseId } = {}) {
  const user = requireUser(token)
  const schema = schemaOf(kind)
  requireWrite(user, kind)

  return withTransaction((db) => {
    const row = scopedRowOr404(kind, db, Number(id), user, baseId)

    if (schema.itemTable && !canDelete(kind, row.status)) {
      throw new ApiError(409, '该状态不可删除')
    }
    assertDeletable(db, kind, row)

    db[schema.table] = db[schema.table].filter((r) => r.id !== row.id)
    if (schema.itemTable) {
      db[schema.itemTable] = db[schema.itemTable].filter((i) => i.doc_id !== row.id)
    }

    writeLog(db, user.id, `${kind}.remove`, `删除${schema.label} ${row.no || row.code || '#' + row.id}`)
    return { ok: true }
  })
}

/**
 * 表单下拉数据（对应后端 GET /api/options）。
 * 一次性返回，减少请求；数据量是演示级（几十条），可接受。
 */
export function options(kind, { token, baseId } = {}) {
  const user = requireUser(token)
  const db = getDb()
  const scope = { user, baseId }

  // 范围过滤：仓库/库位按用户范围；基地按用户绑定；其余全局
  const bases = user.base_id
    ? db.base.filter((b) => b.id === user.base_id)
    : db.base
  const warehouses = applyScope(
    db.warehouse.map((w) => ({ _base: w.base_id, _wh: w.id, out: { id: w.id, name: w.name, base_id: w.base_id, code: w.code } })),
    scopeOf(user, baseId, '_base', '_wh')
  ).map((r) => r.out)
  const visibleWhIds = new Set(warehouses.map((w) => w.id))
  const locations = db.location
    .filter((l) => l.type === 'bin' && visibleWhIds.has(l.warehouse_id))
    .map((l) => ({ id: l.id, name: l.code, warehouse_id: l.warehouse_id }))

  return {
    bases: bases.map((b) => ({ id: b.id, name: b.name, code: b.code })),
    warehouses,
    locations,
    parts: db.part.map((p) => ({ id: p.id, name: p.name, code: p.code, spec: p.spec, unit: p.unit })),
    suppliers: db.supplier.map((s) => ({ id: s.id, name: s.name, code: s.code })),
    customers: db.customer.map((c) => ({ id: c.id, name: c.name, code: c.code })),
    users: db.sys_user.filter((u) => u.active).map((u) => ({ id: u.id, name: u.name, code: u.username })),
    inboundDocs: db.doc_in.map((d) => ({ id: d.id, name: d.no, code: d.no })),
    // 供前端 canWrite 判断
    currentUser: { roles: user.roles, menus: user.menus }
  }
}

/**
 * 状态推进（对应后端 POST /api/:kind/:id/transition）。
 *
 * ⚠️ 核心：过账必须幂等。
 * 用 posted_at 作为标记，只有「首次」进入终态时才过账；
 * 重复调用（重复点击 / 重试 / 并发）直接返回，不重复加减库存。
 */
export function transition(kind, id, toStatus, payload = {}, { token, baseId } = {}) {
  const user = requireUser(token)
  const schema = schemaOf(kind)
  requireWrite(user, kind)
  if (!schema.itemTable) throw new ApiError(400, '该实体没有状态流转')

  return withTransaction((db) => {
    const row = scopedRowOr404(kind, db, Number(id), user, baseId)

    if (row.status === toStatus) {
      // 已处于目标状态：幂等返回，不报错也不重复过账
      return { ok: true, posted: false }
    }
    if (!canTransition(kind, row.status, toStatus)) {
      throw new ApiError(409, `不允许从「${row.status}」流转到「${toStatus}」`)
    }

    const posted = postInventory(db, kind, row, toStatus, payload, user)
    row.status = toStatus
    row.updated_at = new Date().toISOString()

    writeLog(db, user.id, `${kind}.transition`, `${row.no || '#' + row.id} → ${toStatus}${posted ? '（已过账）' : ''}`)
    return { ok: true, posted }
  })
}

/**
 * 库存过账：只在单据进入「终态」时执行一次。
 * 返回是否真的发生了库存变动（false 表示无过账逻辑或已过账）。
 */
function postInventory(db, kind, row, toStatus, payload, user) {
  // 幂等保护：已过账的单据不再重复处理。
  // delivery 例外 —— 它有两次独立的库存动作（发运 / 签收），
  // 用 transit_out_at / transit_in_at 分别标记，不能共用单一 posted_at
  // （否则第一次发运后置了 posted_at，签收时的库存动作会被挡住）。
  if (kind !== 'delivery' && row.posted_at) return false

  const writeFlow = (args) => {
    db.inventory_flow.push({
      id: nextId(db, 'inventory_flow'),
      part_id: args.part_id,
      warehouse_id: args.warehouse_id,
      location_id: args.location_id ?? null,
      qty_change: args.qty_change,
      type: args.type,
      ref_doc: row.no,
      before_qty: args.before,
      after_qty: args.after,
      operator_id: user.id,
      ts: new Date().toISOString()
    })
  }

  /** 定位或创建库存行（按 warehouse + location + part + batch + status 唯一） */
  const findOrCreateInv = (part_id, warehouse_id, location_id, batch, status = 'normal') => {
    let inv = db.inventory.find(
      (i) => i.part_id === part_id && i.warehouse_id === warehouse_id &&
        (i.location_id ?? null) === (location_id ?? null) &&
        (i.batch || '-') === (batch || '-') && i.status === status
    )
    if (!inv) {
      const wh = db.warehouse.find((w) => w.id === warehouse_id)
      inv = {
        id: nextId(db, 'inventory'),
        base_id: wh?.base_id ?? null,
        warehouse_id,
        location_id: location_id ?? null,
        part_id,
        batch: batch || '-',
        avail_qty: 0, frozen_qty: 0, in_transit_qty: 0,
        status,
        updated_at: new Date().toISOString()
      }
      db.inventory.push(inv)
    }
    return inv
  }

  // ── 入库：完成后按 received_qty 增加可用库存 ──
  if (kind === 'inbound' && toStatus === 'completed') {
    const items = db.doc_in_item.filter((i) => i.doc_id === row.id)
    for (const it of items) {
      const qty = Number(it.received_qty) || 0
      if (qty <= 0) continue
      const inv = findOrCreateInv(it.part_id, row.warehouse_id, it.location_id, it.batch)
      const before = inv.avail_qty
      inv.avail_qty = before + qty
      inv.updated_at = new Date().toISOString()
      writeFlow({ part_id: it.part_id, warehouse_id: row.warehouse_id, location_id: it.location_id, qty_change: qty, type: 'in', before, after: inv.avail_qty })
    }
    row.posted_at = new Date().toISOString()
    return true
  }

  // ── 出库：完成后按 picked_qty 扣减，库存不足整单回滚 ──
  if (kind === 'outbound' && toStatus === 'completed') {
    const items = db.doc_out_item.filter((i) => i.doc_id === row.id)

    // 先校验库存是否足够（全部通过才动手，避免部分扣减）
    const plans = []
    for (const it of items) {
      const qty = Number(it.picked_qty) || 0
      if (qty <= 0) continue
      const inv = db.inventory.find(
        (i) => i.part_id === it.part_id && i.warehouse_id === row.warehouse_id &&
          (i.location_id ?? null) === (it.location_id ?? null) && i.status === 'normal'
      )
      if (!inv || inv.avail_qty < qty) {
        const p = db.part.find((x) => x.id === it.part_id)
        throw new ApiError(409, `库存不足，过账失败：${p?.name || '#' + it.part_id} 需要 ${qty}，可用 ${inv?.avail_qty ?? 0}`)
      }
      plans.push({ it, inv, qty })
    }
    // 全部校验通过后才执行扣减
    for (const { it, inv, qty } of plans) {
      const before = inv.avail_qty
      inv.avail_qty = before - qty
      inv.updated_at = new Date().toISOString()
      writeFlow({ part_id: it.part_id, warehouse_id: row.warehouse_id, location_id: it.location_id, qty_change: -qty, type: 'out', before, after: inv.avail_qty })
    }
    row.posted_at = new Date().toISOString()
    return true
  }

  // ── 盘点：完成后按 diff 调整库存 ──
  if (kind === 'stocktake' && toStatus === 'completed') {
    const items = db.stocktake_item.filter((i) => i.doc_id === row.id)
    for (const it of items) {
      const diff = it.diff == null ? 0 : Number(it.diff)
      if (!diff) continue
      const inv = findOrCreateInv(it.part_id, row.warehouse_id, it.location_id, it.batch)
      const before = inv.avail_qty
      inv.avail_qty = before + diff
      inv.updated_at = new Date().toISOString()
      writeFlow({ part_id: it.part_id, warehouse_id: row.warehouse_id, location_id: it.location_id, qty_change: diff, type: 'count_adjust', before, after: inv.avail_qty })
    }
    row.posted_at = new Date().toISOString()
    return true
  }

  // ── 质检：只汇总单头，不改库存（不合格品状态变更留给后续） ──
  if (kind === 'quality' && toStatus === 'completed') {
    recomputeHeaderTotals(db, 'quality', row)
    row.posted_at = new Date().toISOString()
    return true
  }

  // ── 配送：三段式在途库存 ──
  //   ① 发运(in_transit/phipped)：起运仓 avail -N，起运仓 in_transit +N
  //   ② 签收(signed/partial_signed)：起运仓 in_transit -M，目的仓 avail +M
  //   ③ 异常(exception)：不发不结，留给人工处理（在途保持不动）
  //
  //   M 取 signed_qty（部分签收时 M < N，差额继续留在在途）。
  //   注意：不同状态迁移要分开处理，所以这里用 status 判断而非 posted_at，
  //   因为一张配送单会有两次库存动作（发运、签收）。
  if (kind === 'delivery') {
    const items = db.delivery_item.filter((i) => i.doc_id === row.id)

    if (toStatus === 'in_transit' && !row.transit_out_at) {
      for (const it of items) {
        const qty = Number(it.shipped_qty) || 0
        if (qty <= 0) continue

        // 注意：delivery_item 表**没有 batch 字段**（见 01_schema.sql），
        // 跨仓配送按备件汇总数量发货，不指定批次。
        // 因此这里从该备件在起运仓的各批次库存中按顺序扣减，
        // 而不是只看某一条库存行 —— 否则一旦库存分散在多个批次就会误报"库存不足"。
        const candidates = db.inventory
          .filter((i) => i.part_id === it.part_id && i.warehouse_id === row.from_wh_id && i.status === 'normal')
          .sort((a, b) => b.avail_qty - a.avail_qty) // 优先扣大库存行，减少碎片
        const total = candidates.reduce((s, i) => s + i.avail_qty, 0)
        if (total < qty) {
          const p = db.part.find((x) => x.id === it.part_id)
          throw new ApiError(409, `库存不足，发运失败：${p?.name || '#' + it.part_id} 需要 ${qty}，可用 ${total}`)
        }

        let remain = qty
        for (const inv of candidates) {
          if (remain <= 0) break
          const take = Math.min(inv.avail_qty, remain)
          if (take <= 0) continue
          const before = inv.avail_qty
          inv.avail_qty = before - take
          inv.in_transit_qty = (inv.in_transit_qty || 0) + take
          inv.updated_at = new Date().toISOString()
          writeFlow({
            part_id: it.part_id, warehouse_id: row.from_wh_id, location_id: inv.location_id,
            qty_change: -take, type: 'transit_out', before, after: inv.avail_qty
          })
          remain -= take
        }
      }
      row.transit_out_at = new Date().toISOString()
      return true
    }

    if ((toStatus === 'signed' || toStatus === 'partial_signed') && !row.transit_in_at) {
      for (const it of items) {
        const signed = Number(it.signed_qty) || 0
        if (signed <= 0) continue

        // 起运仓：在途减少（在途可能分散在多个批次行，逐行扣）
        let transitRemain = signed
        const transitRows = db.inventory
          .filter((i) => i.part_id === it.part_id && i.warehouse_id === row.from_wh_id && (i.in_transit_qty || 0) > 0)
          .sort((a, b) => b.in_transit_qty - a.in_transit_qty)
        for (const inv of transitRows) {
          if (transitRemain <= 0) break
          const take = Math.min(inv.in_transit_qty, transitRemain)
          inv.in_transit_qty -= take
          inv.updated_at = new Date().toISOString()
          transitRemain -= take
        }

        // 目的仓：可用增加（只有目的地是仓库时才入库；纯部门签收则货已离开库存体系）
        if (row.to_wh_id) {
          const inInv = findOrCreateInv(it.part_id, row.to_wh_id, null, '-')
          const before = inInv.avail_qty
          inInv.avail_qty = before + signed
          inInv.updated_at = new Date().toISOString()
          writeFlow({
            part_id: it.part_id, warehouse_id: row.to_wh_id, location_id: null,
            qty_change: signed, type: 'transit_in', before, after: inInv.avail_qty
          })
        }
      }
      row.transit_in_at = new Date().toISOString()
      return true
    }
  }

  return false
}

export { canWrite, canTransition }

// ── 用户管理（仅超级管理员，对应后端 requireSuper） ────────────────────
function requireSuper(user) {
  if (!user.roles?.includes('super')) throw new ApiError(403, '仅超级管理员可管理账号')
}

function setRoles(db, userId, roleIds) {
  db.sys_user_role = db.sys_user_role.filter((r) => r.user_id !== userId)
  for (const roleId of roleIds || []) db.sys_user_role.push({ user_id: userId, role_id: roleId })
}

function setMenuPerms(db, userId, mode, menuKeys) {
  const u = db.sys_user.find((x) => x.id === userId)
  u.perm_mode = mode
  db.sys_user_permission = db.sys_user_permission.filter((p) => p.user_id !== userId)
  if (mode === 'custom') {
    for (const key of menuKeys || []) db.sys_user_permission.push({ user_id: userId, menu_key: key })
  }
}

export function createUser(token, body, options) {
  const user = requireUser(token)
  requireSuper(user)
  const { username, name, password, base_id, warehouse_id, role_ids, perm_mode, menu_keys } = body || {}
  if (!username || !name || !password) throw new ApiError(400, '账号、姓名、密码必填')
  if (perm_mode === 'custom' && !(menu_keys || []).length) throw new ApiError(400, '自定义模式至少勾选一个菜单')

  return withTransaction((db) => {
    if (db.sys_user.some((u) => u.username === username)) throw new ApiError(409, '账号已存在')
    const id = nextId(db, 'sys_user')
    db.sys_user.push({
      id, username, password_hash: sha256(password), name,
      base_id: base_id || null, warehouse_id: warehouse_id || null,
      active: true, perm_mode: perm_mode === 'custom' ? 'custom' : 'role'
    })
    setRoles(db, id, role_ids)
    setMenuPerms(db, id, perm_mode === 'custom' ? 'custom' : 'role', menu_keys)
    writeLog(db, user.id, 'user.create', `创建账号 ${username}`)
    return { id }
  })
}

export function updateUser(token, id, body) {
  const user = requireUser(token)
  requireSuper(user)
  const { name, base_id, warehouse_id, active, role_ids, perm_mode, menu_keys } = body || {}
  if (id === user.id && active === false) throw new ApiError(400, '不能停用自己的账号')
  const mode = perm_mode === 'custom' ? 'custom' : 'role'
  if (mode === 'custom' && !(menu_keys || []).length) throw new ApiError(400, '自定义模式至少勾选一个菜单')

  return withTransaction((db) => {
    const u = db.sys_user.find((x) => x.id === id)
    if (!u) throw new ApiError(404, '用户不存在')
    u.name = name
    u.base_id = base_id || null
    u.warehouse_id = warehouse_id || null
    u.active = active !== false
    setRoles(db, id, mode === 'custom' ? [] : role_ids)
    setMenuPerms(db, id, mode, menu_keys)
    writeLog(db, user.id, 'user.update', `修改账号 #${id}`)
    return { ok: true }
  })
}

export function resetPassword(token, id, password) {
  const user = requireUser(token)
  requireSuper(user)
  if (!password) throw new ApiError(400, '密码必填')
  return withTransaction((db) => {
    const u = db.sys_user.find((x) => x.id === id)
    if (!u) throw new ApiError(404, '用户不存在')
    u.password_hash = sha256(password)
    writeLog(db, user.id, 'user.reset_pwd', `重置账号 #${id} 密码`)
    return { ok: true }
  })
}

export function health() {
  return { ok: true, ts: new Date().toISOString() }
}

/** 退出登录：删除当前 token（对应后端缺失的登出能力，这里补齐） */
export function logout(token) {
  const tokens = readTokens()
  delete tokens[token]
  writeTokens(tokens)
  return { ok: true }
}

export { resetDb }
