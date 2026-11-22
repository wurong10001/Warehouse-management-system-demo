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
      .map((d) => ({ kind: 'inbound', no: d.no, title: `入库 · ${d.ref_no || d.from_src}`, status: d.status })),
    ...db.doc_out.filter((d) => ['pending_review', 'pending_pick', 'pending_check'].includes(d.status) && inScope(d, 'base_id', 'warehouse_id'))
      .sort(byDesc('created_at')).slice(0, 8)
      .map((d) => ({ kind: 'outbound', no: d.no, title: `出库 · ${d.dept_name || d.type}`, status: d.status })),
    ...db.quality.filter((t) => ['pending_qc', 'qc_ing'].includes(t.status) && inScope(t, 'base_id', 'warehouse_id'))
      .sort(byDesc('created_at')).slice(0, 8)
      .map((t) => ({ kind: 'quality', no: t.no, title: `质检 · ${t.total} 件`, status: t.status })),
    ...db.stocktake.filter((t) => ['pending_count', 'counting', 'pending_review'].includes(t.status) && inScope(t, 'base_id', 'warehouse_id'))
      .sort(byDesc('created_at')).slice(0, 8)
      .map((t) => ({ kind: 'stocktake', no: t.no, title: `盘点 · ${t.scope}`, status: t.status })),
    ...db.delivery.filter((t) => ['pending_review', 'pending_ship', 'in_transit'].includes(t.status) && inScope(t, 'from_base_id', 'from_wh_id'))
      .sort(byDesc('created_at')).slice(0, 8)
      .map((t) => ({ kind: 'delivery', no: t.no, title: `配送 · ${t.to_dept || '基地间'}`, status: t.status }))
  ]

  // 异常单据（原版此查询漏了范围过滤，这里补上，避免跨基地泄漏）
  const alerts = []
  for (const dv of db.delivery) {
    if (dv.status === 'exception' && inScope(dv, 'from_base_id', 'from_wh_id')) {
      alerts.push({ title: '配送异常', no: dv.no, reason: '配送超时' })
    }
  }
  for (const t of db.quality) {
    if (t.fail_qty > 0 && inScope(t, 'base_id', 'warehouse_id')) {
      alerts.push({ title: '质检不合格', no: t.no, reason: `${t.fail_qty} 件不合格` })
    }
  }
  for (const t of db.stocktake) {
    if (t.status !== 'pending_review' || !inScope(t, 'base_id', 'warehouse_id')) continue
    const diff = db.stocktake_item.filter((i) => i.doc_id === t.id).reduce((s, i) => s + (i.diff || 0), 0)
    alerts.push({ title: '盘点差异待审批', no: t.no, reason: `差异 ${diff} 件` })
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

  const baseName = user.base_id ? (db.base.find((b) => b.id === user.base_id)?.name ?? null) : null

  return { metrics, todos, alerts, trend, bases, base_name: baseName }
}

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
