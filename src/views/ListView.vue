<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { api } from '../api'
import { useAuth } from '../stores/auth'
import { useMobile } from '../composables/useMobile'
import StatusTag from '../components/StatusTag.vue'
import DetailSheet from '../components/DetailSheet.vue'
import DetailPanel from '../components/DetailPanel.vue'

const props = defineProps({
  kind: String,
  title: String,
  columns: Array
})

const DETAIL_KIND = { inbound: 'inbound', outbound: 'outbound', delivery: 'delivery', quality: 'quality', stocktake: 'stocktake', parts: 'part', basedata: 'basedata', device: 'device' }
const detailKind = computed(() => DETAIL_KIND[props.kind] || null)
const detailOpen = ref(false)
const detailData = ref(null)
const detailTitle = ref('')

async function openDetail(r) {
  if (!detailKind.value || r.id == null) return
  detailOpen.value = true
  detailData.value = null
  try {
    detailData.value = await api.detail(detailKind.value, r.id)
    const hd = detailData.value.header
    detailTitle.value = hd.no || hd.code || hd.name || props.title
  } catch (e) {
    detailOpen.value = false
    err.value = e.message
  }
}

const auth = useAuth()
const isMobile = useMobile()
const rows = ref([])
const q = ref('')
const loading = ref(false)
const err = ref('')

async function load() {
  loading.value = true; err.value = ''
  try {
    rows.value = await api.list(props.kind, { q: q.value })
  } catch (e) { err.value = e.message } finally { loading.value = false }
}
onMounted(load)
watch(q, load)
watch(() => auth.baseId, load)
watch(() => props.kind, () => { q.value = ''; rows.value = []; load() })

const fmtTime = (s) => s ? new Date(s).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
const gridStyle = () => ({ gridTemplateColumns: props.columns.map(c => c.w || '1fr').join(' ') })

const mainCol = computed(() => props.columns.find((c) => !c.tag) || props.columns[0])
const tagCol = computed(() => props.columns.find((c) => c.tag) || null)
const secCols = computed(() => props.columns.filter((c) => c !== mainCol.value && c !== tagCol.value))

function cell(row, col) {
  const v = row[col.k]
  if (col.tag) return v
  if (col.time) return fmtTime(v)
  if (col.dot) return v ? '在线' : '离线'
  return v ?? '—'
}
</script>

<template>
  <div class="wrap-grid">
    <div class="hero">
      <h1>{{ title }}</h1>
      <div class="tools">
        <div class="search-pill">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>
          <input v-model="q" placeholder="搜索编码 / 名称 / 单号" />
        </div>
      </div>
    </div>

    <div class="panel section-gap">
      <template v-if="!isMobile">
        <div class="list-head" :style="gridStyle()">
          <span v-for="c in columns" :key="c.k">{{ c.label }}</span>
        </div>
        <div v-if="loading" class="state">加载中…</div>
        <div v-else-if="err" class="state">{{ err }}</div>
        <div v-else-if="!rows.length" class="state">暂无数据</div>
        <div v-for="(r, i) in rows" :key="i" class="list-row" :class="{ click: detailKind && r.id != null }" :style="gridStyle()" @click="openDetail(r)">
          <template v-for="c in columns" :key="c.k">
            <StatusTag v-if="c.tag" :code="r[c.k]" />
            <span v-else-if="c.time" class="num">{{ fmtTime(r[c.k]) }}</span>
            <span v-else-if="c.dot" class="dotcell">
              <span :class="r[c.k] ? 'dot-live' : 'dot-off'"></span>
              <em>{{ r[c.k] ? '在线' : '离线' }}</em>
            </span>
            <span v-else :class="{ num: c.num }">{{ cell(r, c) }}</span>
          </template>
        </div>
      </template>

      <template v-else>
        <div v-if="loading" class="state">加载中…</div>
        <div v-else-if="err" class="state">{{ err }}</div>
        <div v-else-if="!rows.length" class="state">暂无数据</div>
        <div v-for="(r, i) in rows" :key="i" class="m-row" :class="{ click: detailKind && r.id != null }" @click="openDetail(r)">
          <div class="m-line1">
            <span class="m-main">{{ cell(r, mainCol) }}</span>
            <StatusTag v-if="tagCol" :code="r[tagCol.k]" />
          </div>
          <div class="m-line2">
            <span v-for="c in secCols" :key="c.k" class="m-sec" :data-label="c.label">{{ cell(r, c) }}</span>
          </div>
        </div>
      </template>
    </div>

    <DetailSheet :open="detailOpen" :title="detailTitle" @close="detailOpen = false">
      <DetailPanel v-if="detailData && detailKind" :kind="detailKind" :data="detailData" />
      <div v-else class="state">加载中…</div>
    </DetailSheet>
  </div>
</template>

<style scoped>
.hero { padding-top: 12px; display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; flex-wrap: wrap; }
.tools { display: flex; gap: 10px; }
.search-pill { width: 260px; }
.state { padding: 40px 22px; text-align: center; color: var(--text-3); font-size: 14px; }
.dotcell { display: flex; align-items: center; gap: 8px; }
.dotcell em { font-style: normal; font-size: 13px; color: var(--text-2); }
.list-row.click, .m-row.click { cursor: pointer; }
.list-row.click:active, .m-row.click:active { background: var(--hover); }
</style>
