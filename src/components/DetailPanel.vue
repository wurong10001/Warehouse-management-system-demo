<script setup>
import { computed } from 'vue'
import { statusInfo } from '../api/status'
import { SRC, OTYPE, FTYPE, DTYPE } from '../api/dict'
import StatusSteps from './StatusSteps.vue'

const props = defineProps({ kind: String, data: Object })

const DOC_KINDS = ['inbound', 'outbound', 'delivery', 'quality', 'stocktake']
const fmtT = (s) => (s ? new Date(s).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—')
const h = computed(() => props.data?.header || {})

function fields() {
  const x = h.value
  switch (props.kind) {
    case 'inbound': return [['单号', x.no], ['来源', SRC[x.from_src] || x.from_src], ['关联单号', x.ref_no], ['基地', x.base_name], ['仓库', x.warehouse_name], ['创建人', x.creator_name], ['创建时间', fmtT(x.created_at)]]
    case 'outbound': return [['单号', x.no], ['类型', OTYPE[x.type] || x.type], ['领用部门', x.dept_name], ['基地', x.base_name], ['仓库', x.warehouse_name], ['创建人', x.creator_name], ['创建时间', fmtT(x.created_at)]]
    case 'delivery': return [['单号', x.no], ['路线', x.route], ['承运商', x.carrier_name], ['配送员', x.courier_name], ['总数量', x.qty], ['发运时间', fmtT(x.shipped_at)], ['签收时间', fmtT(x.signed_at)]]
    case 'quality': return [['质检单号', x.no], ['来源单号', x.from_no], ['基地', x.base_name], ['仓库', x.warehouse_name], ['总数 / 合格 / 不合格', `${x.total} / ${x.pass_qty} / ${x.fail_qty}`], ['创建人', x.creator_name], ['创建时间', fmtT(x.created_at)]]
    case 'stocktake': return [['盘点单号', x.no], ['范围', x.scope], ['仓库', x.warehouse_name], ['创建人', x.creator_name], ['创建时间', fmtT(x.created_at)]]
    case 'part': return [['编码', x.code], ['名称', x.name], ['规格型号', x.spec], ['单位', x.unit], ['安全库存', x.safe_stock], ['供应商', x.supplier_name], ['联系方式', x.supplier_contact], ['档案状态', x.is_scrap ? '已报废' : '在用']]
    case 'inventory': return [['备件', `${x.part_name} · ${x.part_code}`], ['规格', x.spec], ['仓库', x.warehouse_name], ['库位', x.location_code], ['批次', x.batch], ['更新时间', fmtT(x.updated_at)]]
    case 'device': return [['设备编号', x.code], ['名称', x.name], ['类型', DTYPE[x.type] || x.type], ['绑定仓库', x.warehouse_name], ['最后心跳', fmtT(x.last_heartbeat)]]
    case 'basedata': return [['仓库编码', x.code], ['仓库名称', x.name], ['所属基地', x.base_name], ['负责人', x.manager_name], ['地址', x.address]]
  }
  return []
}

const SUBS = {
  inbound: [{ title: '入库明细', rows: 'items', prim: (r) => [r.part_name, r.part_code], cols: [{ k: 'batch', label: '批次' }, { k: 'expect_qty', label: '应入', num: 1 }, { k: 'received_qty', label: '已入', num: 1 }, { k: 'remain_qty', label: '剩余', num: 1 }, { k: 'location_code', label: '库位' }] }],
  outbound: [{ title: '出库明细', rows: 'items', prim: (r) => [r.part_name, r.part_code], cols: [{ k: 'location_code', label: '库位' }, { k: 'plan_qty', label: '计划', num: 1 }, { k: 'picked_qty', label: '已拣', num: 1 }] }],
  delivery: [{ title: '配送明细', rows: 'items', prim: (r) => [r.part_name, r.part_code], cols: [{ k: 'plan_qty', label: '应发', num: 1 }, { k: 'shipped_qty', label: '实发', num: 1 }, { k: 'signed_qty', label: '签收', num: 1 }] }],
  quality: [{ title: '质检明细', rows: 'items', prim: (r) => [r.part_name, r.part_code], cols: [{ k: 'batch', label: '批次' }, { k: 'check_qty', label: '应检', num: 1 }, { k: 'checked_qty', label: '已检', num: 1 }, { k: 'pass_qty', label: '合格', num: 1 }, { k: 'fail_qty', label: '不合格', num: 1, heat: (r) => r.fail_qty > 0 }, { k: 'fail_reason', label: '原因', heat: (r) => r.fail_qty > 0 }] }],
  stocktake: [{ title: '盘点明细', rows: 'items', prim: (r) => [r.part_name, r.part_code], cols: [{ k: 'location_code', label: '库位' }, { k: 'batch', label: '批次' }, { k: 'book_qty', label: '账面', num: 1 }, { k: 'actual_qty', label: '实盘', num: 1 }, { k: 'diff', label: '差异', num: 1, heat: (r) => r.diff != null && r.diff !== 0 }, { k: 'reason', label: '原因' }] }],
  part: [
    { title: '库存分布', rows: 'stock', prim: (r) => [r.warehouse_name, `${r.location_code} · ${r.batch}`], cols: [{ k: 'avail_qty', label: '可用', num: 1 }, { k: 'frozen_qty', label: '冻结', num: 1 }, { k: 'in_transit_qty', label: '在途', num: 1 }, { k: 'status', label: '状态', tag: 1 }] },
    { title: '近期流水', rows: 'flows', prim: (r) => [(r.qty_change > 0 ? '+' : '') + r.qty_change, FTYPE[r.type] || r.type], cols: [{ k: 'ref_doc', label: '单据' }, { k: 'after_qty', label: '结余', num: 1 }, { k: 'ts', label: '时间', time: 1 }] }
  ],
  inventory: [
    { title: '近期流水', rows: 'flows', prim: (r) => [(r.qty_change > 0 ? '+' : '') + r.qty_change, FTYPE[r.type] || r.type], cols: [{ k: 'ref_doc', label: '单据' }, { k: 'before_qty', label: '变动前', num: 1 }, { k: 'after_qty', label: '结余', num: 1 }, { k: 'ts', label: '时间', time: 1 }] }
  ]
}

const subs = computed(() => SUBS[props.kind] || [])
const isHeat = (r, c) => c.heat ? c.heat(r) : false
</script>

<template>
  <div class="dp">
    <StatusSteps v-if="DOC_KINDS.includes(kind)" :kind="kind" :status="h.status" class="steps-block" />

    <div v-if="kind === 'device'" class="dev-online">
      <span :class="h.online ? 'dot-live' : 'dot-off'"></span>{{ h.online ? '在线' : '离线' }}
    </div>

    <div class="panel">
      <div v-for="[label, value] in fields()" :key="label" class="field-row">
        <label>{{ label }}</label>
        <span class="fv">{{ value ?? '—' }}</span>
      </div>
    </div>

    <div v-if="kind === 'basedata' && data?.stats?.length" class="panel metrics3 section-gap">
      <div class="metric m3"><span class="v">{{ data.stats[0].bin_count }}</span><span class="k">库位数</span></div>
      <div class="metric m3"><span class="v">{{ data.stats[0].part_count }}</span><span class="k">在库备件</span></div>
      <div class="metric m3"><span class="v">{{ data.stats[0].avail_qty }}</span><span class="k">可用总量</span></div>
    </div>

    <template v-for="sub in subs" :key="sub.title">
      <div v-if="(data[sub.rows] || []).length" class="panel section-gap">
        <div class="panel-head"><h3>{{ sub.title }}</h3></div>
        <div v-for="(r, i) in data[sub.rows]" :key="i" class="srow">
          <div class="sprim">
            <div class="sp-main num">{{ sub.prim(r)[0] }}</div>
            <div class="sp-sub">{{ sub.prim(r)[1] }}</div>
          </div>
          <div class="srest">
            <template v-for="c in sub.cols" :key="c.k">
              <span v-if="c.tag" class="tag" :class="statusInfo(r[c.k]).tone">{{ statusInfo(r[c.k]).label }}</span>
              <span v-else class="sval" :class="{ num: c.num || c.time, heat: isHeat(r, c) }" :data-label="c.label">
                {{ c.time ? fmtT(r[c.k]) : (r[c.k] ?? '—') }}
              </span>
            </template>
          </div>
        </div>
      </div>
      <div v-else class="panel section-gap"><div class="state">暂无记录</div></div>
    </template>
  </div>
</template>

<style scoped>
.steps-block { margin: 4px 2px 20px; padding: 14px 10px 8px; background: var(--surface); border-radius: var(--r-card); box-shadow: var(--sh-card); }
.dev-online { display: flex; align-items: center; gap: 8px; font-size: 14px; color: var(--text-2); margin: 0 2px 16px; }
.fv { font-size: 14px; color: var(--text-2); text-align: right; min-width: 0; overflow-wrap: anywhere; }
.metrics3 { display: grid; grid-template-columns: repeat(3, 1fr); }
.m3 { padding: 18px; border-right: 1px solid var(--hairline); }
.m3:last-child { border-right: none; }
.srow { display: flex; align-items: center; gap: 14px; padding: 10px 22px; border-bottom: 1px solid var(--hairline); }
.srow:last-child { border-bottom: none; }
.sprim { flex: 1; min-width: 0; }
.sp-main { font-size: 14px; font-weight: 550; }
.sp-sub { font-size: 12px; color: var(--text-3); }
.srest { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; justify-content: flex-end; }
.sval { font-size: 13px; color: var(--text-2); }
.sval::before { content: attr(data-label) ' '; color: var(--text-4); font-size: 12px; }
.sval.heat { color: var(--heat); font-weight: 650; }
.state { padding: 28px; text-align: center; color: var(--text-3); font-size: 13px; }
@media (max-width: 520px) {
  .srow { flex-direction: column; align-items: flex-start; gap: 6px; }
  .srest { justify-content: flex-start; gap: 10px 14px; }
}
</style>
