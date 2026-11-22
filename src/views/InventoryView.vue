<script setup>
import { ref, watch, onMounted } from 'vue'
import { api } from '../api'
import { useAuth } from '../stores/auth'
import { useMobile } from '../composables/useMobile'
import { statusInfo } from '../api/status'
import DetailSheet from '../components/DetailSheet.vue'
import DetailPanel from '../components/DetailPanel.vue'

const auth = useAuth()
const isMobile = useMobile()
const detailOpen = ref(false)
const detailData = ref(null)
const detailTitle = ref('')

async function openDetail(r) {
  detailOpen.value = true
  detailData.value = null
  try {
    detailData.value = await api.detail('inventory', r.id ?? r.row_id)
    detailTitle.value = `${detailData.value.header.part_name} · ${detailData.value.header.location_code}`
  } catch (e) {
    detailOpen.value = false
    err.value = e.message
  }
}
const rows = ref([])
const warehouses = ref([])
const q = ref('')
const wh = ref('')
const st = ref('')
const err = ref('')

async function load() {
  err.value = ''
  const qs = new URLSearchParams()
  if (q.value) qs.set('q', q.value)
  if (wh.value) qs.set('warehouse_id', wh.value)
  if (st.value) qs.set('status', st.value)
  try { rows.value = await api.list('inventory?' + qs.toString()) } catch (e) { err.value = e.message }
}
onMounted(async () => {
  try { warehouses.value = await api.list('warehouses') } catch {}
  load()
})
watch([q, wh, st], load)
watch(() => auth.baseId, load)

const SEGS = [
  { k: '', label: '全部' }, { k: 'normal', label: '正常' },
  { k: 'frozen', label: '冻结' }, { k: 'pending_qc', label: '待检' }, { k: 'unqualified', label: '不合格' }
]
const fmtTime = (s) => s ? new Date(s).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
</script>

<template>
  <div class="wrap-grid">
    <div class="hero">
      <h1>库存查询</h1>
      <div class="search-pill">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>
        <input v-model="q" placeholder="备件编码 / 名称" />
      </div>
    </div>

    <div class="panel filters">
      <div class="f-row">
        <span class="f-k">仓库</span>
        <select v-model="wh">
          <option value="">全部仓库</option>
          <option v-for="w in warehouses" :key="w.id" :value="w.id">{{ w.name }}</option>
        </select>
      </div>
      <div class="f-row no-border">
        <span class="f-k">库存状态</span>
        <div class="segmented">
          <button v-for="s in SEGS" :key="s.k" :class="{ on: st === s.k }" @click="st = s.k">{{ s.label }}</button>
        </div>
      </div>
    </div>

    <div class="panel section-gap">
      <template v-if="!isMobile">
        <div class="list-head inv">
          <span>备件</span><span>库位</span><span>批次</span><span>可用</span><span>冻结</span><span>在途</span><span>安全库存</span><span>状态</span><span>更新时间</span>
        </div>
        <div v-if="err" class="state">{{ err }}</div>
        <div v-else-if="!rows.length" class="state">暂无数据</div>
        <div v-for="(r, i) in rows" :key="i" class="list-row inv click" @click="openDetail(r)">
          <div class="p-cell">
            <div class="p-name">{{ r.part_name }}</div>
            <div class="p-code">{{ r.part_code }} · {{ r.spec || '—' }}</div>
          </div>
          <span>{{ r.location_code || '—' }}</span>
          <span>{{ r.batch }}</span>
          <span class="num" :class="{ heat: r.low }">{{ r.avail_qty }}</span>
          <span class="num">{{ r.frozen_qty }}</span>
          <span class="num">{{ r.in_transit_qty }}</span>
          <span class="num">{{ r.safe_stock }}</span>
          <span class="tag" :class="statusInfo(r.status).tone">{{ statusInfo(r.status).label }}</span>
          <span class="num dim">{{ fmtTime(r.updated_at) }}</span>
        </div>
      </template>

      <template v-else>
        <div v-if="err" class="state">{{ err }}</div>
        <div v-else-if="!rows.length" class="state">暂无数据</div>
        <div v-for="(r, i) in rows" :key="i" class="m-row click" @click="openDetail(r)">
          <div class="m-line1">
            <div class="m-main">
              <div>{{ r.part_name }}</div>
              <div class="p-code">{{ r.part_code }} · {{ r.spec || '—' }}</div>
            </div>
            <span class="tag" :class="statusInfo(r.status).tone">{{ statusInfo(r.status).label }}</span>
          </div>
          <div class="m-line2">
            <span class="m-sec" data-label="可用" :class="{ heat: r.low }">{{ r.avail_qty }}</span>
            <span class="m-sec" data-label="冻结">{{ r.frozen_qty }}</span>
            <span class="m-sec" data-label="在途">{{ r.in_transit_qty }}</span>
            <span class="m-sec" data-label="安全库存">{{ r.safe_stock }}</span>
            <span class="m-sec" data-label="库位">{{ r.location_code || '—' }}</span>
            <span class="m-sec" data-label="批次">{{ r.batch }}</span>
            <span class="m-sec" data-label="更新">{{ fmtTime(r.updated_at) }}</span>
          </div>
        </div>
      </template>
    </div>

    <DetailSheet :open="detailOpen" :title="detailTitle" @close="detailOpen = false">
      <DetailPanel v-if="detailData" kind="inventory" :data="detailData" />
      <div v-else class="state">加载中…</div>
    </DetailSheet>
  </div>
</template>

<style scoped>
.hero { padding-top: 12px; display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; flex-wrap: wrap; }
.search-pill { width: 260px; }
.filters { margin-top: 22px; }
.f-row { display: flex; align-items: center; gap: 16px; padding: 10px 22px; min-height: 52px; border-bottom: 1px solid var(--hairline); }
.f-row.no-border { border-bottom: none; }
.f-k { font-size: 14px; color: var(--text-2); width: 64px; flex-shrink: 0; }
.f-row select { border: none; outline: none; font: inherit; font-size: 14px; color: var(--text); background: transparent; }
.inv { grid-template-columns: 2fr 0.8fr 0.8fr 0.6fr 0.6fr 0.6fr 0.8fr 0.9fr 1fr; }
.p-name { font-size: 14px; }
.p-code { font-size: 12px; color: var(--text-3); }
.heat { color: var(--heat); font-weight: 650; }
.dim { color: var(--text-3); font-size: 13px; }
.state { padding: 40px 22px; text-align: center; color: var(--text-3); font-size: 14px; }
.list-row.click, .m-row.click { cursor: pointer; }
.list-row.click:active, .m-row.click:active { background: var(--hover); }
</style>
