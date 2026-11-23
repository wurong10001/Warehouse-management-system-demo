<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../api'
import { useAuth } from '../stores/auth'
import { useMobile } from '../composables/useMobile'
import StatusTag from '../components/StatusTag.vue'
import DetailSheet from '../components/DetailSheet.vue'
import DetailPanel from '../components/DetailPanel.vue'
import EntityFormDialog from '../components/EntityFormDialog.vue'
import { ENTITY_SCHEMA, canWrite, canEdit, canDelete, nextStatuses } from '../config/entity-schema'

const props = defineProps({
  kind: String,
  title: String,
  columns: Array
})

const DETAIL_KIND = { inbound: 'inbound', outbound: 'outbound', delivery: 'delivery', quality: 'quality', stocktake: 'stocktake', parts: 'part', basedata: 'basedata', device: 'device' }
const detailKind = computed(() => DETAIL_KIND[props.kind] || null)

// ── 写入能力：实体键与 DETAIL_KIND 不同（parts→part），需单独映射 ──
const ENTITY_KIND = { parts: 'part', basedata: 'warehouse', inbound: 'inbound', outbound: 'outbound', delivery: 'delivery', quality: 'quality', stocktake: 'stocktake' }
const entityKind = computed(() => ENTITY_KIND[props.kind] || null)
const entitySchema = computed(() => (entityKind.value ? ENTITY_SCHEMA[entityKind.value] : null))
/** 当前用户能否写这个实体（决定"新增"按钮是否出现） */
const writable = computed(() => !!entityKind.value && canWrite(auth.user, entityKind.value))

const formOpen = ref(false)
const editingId = ref(null)

function openCreate() {
  editingId.value = null
  formOpen.value = true
}
function openEdit(r) {
  editingId.value = r.id
  formOpen.value = true
}
function onSaved() { load() }

/** 删除：二次确认 */
async function onDelete(r) {
  const label = r.no || r.code || r.name || `#${r.id}`
  if (!confirm(`确定删除「${label}」吗？此操作不可撤销。`)) return
  try {
    await api.remove(entityKind.value, r.id)
    load()
  } catch (e) {
    err.value = e.message
  }
}

/** 状态推进：列出当前状态的所有合法下一状态 */
const statusMenuFor = ref(null) // { id, options }
function toggleStatusMenu(r) {
  if (statusMenuFor.value?.id === r.id) { statusMenuFor.value = null; return }
  const targets = nextStatuses(entityKind.value, r.status)
  statusMenuFor.value = targets.length ? { id: r.id, options: targets } : null
}
async function doTransition(r, to) {
  statusMenuFor.value = null
  try {
    await api.transition(entityKind.value, r.id, to)
    load()
  } catch (e) {
    err.value = e.message
  }
}
const STATUS_LABEL = {
  draft: '草稿', pending_qc: '待质检', qc_ing: '质检中', pending_shelf: '待上架',
  completed: '已完成', cancelled: '已取消', pending_review: '待审核', pending_pick: '待拣货',
  pending_check: '待复核', rejected: '已驳回', pending_count: '待盘点', counting: '盘点中',
  pending_ship: '待发运', shipped: '已发运', in_transit: '运输中', signed: '已签收',
  partial_signed: '部分签收', exception: '异常'
}
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
const route = useRoute()
const router = useRouter()

/**
 * URL 筛选参数（看板卡片下钻用）。
 * status: 逗号分隔的状态集合；low=1 表示只看库存预警。
 * 放在 URL 里而不是组件状态，好处是可直接分享、刷新后仍保持。
 */
const statusFilter = computed(() => String(route.query.status || ''))
const lowFilter = computed(() => String(route.query.low || ''))
const hasFilter = computed(() => !!statusFilter.value || lowFilter.value)

/** 筛选项的可读名称（列表顶部展示，避免用户困惑"怎么只有几条"） */
const FILTER_LABEL = {
  draft: '草稿', pending_qc: '待质检', qc_ing: '质检中', pending_shelf: '待上架',
  pending_review: '待审核', pending_pick: '待拣货', pending_check: '待复核',
  pending_count: '待盘点', counting: '盘点中', pending_ship: '待发运',
  completed: '已完成', cancelled: '已取消', rejected: '已驳回'
}
const filterText = computed(() => {
  if (lowFilter.value === '1') return '仅看库存预警'
  if (!statusFilter.value) return ''
  return statusFilter.value.split(',').map((s) => FILTER_LABEL[s.trim()] || s).join(' / ')
})

/** 清除筛选：把 URL 上的筛选参数去掉 */
function clearFilter() {
  const q = { ...route.query }
  delete q.status
  delete q.low
  router.replace({ path: route.path, query: q })
}
const rows = ref([])
const q = ref('')
const loading = ref(false)
const err = ref('')

async function load() {
  loading.value = true; err.value = ''
  try {
    // 筛选参数拼进 kind 的 query 串（api.list 支持 'kind?a=b' 形式）
    const qs = new URLSearchParams()
    if (q.value) qs.set('q', q.value)
    if (statusFilter.value) qs.set('status', statusFilter.value)
    if (lowFilter.value) qs.set('low', lowFilter.value)
    const kindWithQuery = qs.toString() ? `${props.kind}?${qs}` : props.kind
    rows.value = await api.list(kindWithQuery)
  } catch (e) { err.value = e.message } finally { loading.value = false }
}
onMounted(load)
watch(q, load)
watch(() => auth.baseId, load)
watch(() => props.kind, () => { q.value = ''; rows.value = []; load() })
// 看板卡片跳转只改 query 不改 path，必须单独监听
watch(() => [route.query.status, route.query.low], load)

const fmtTime = (s) => s ? new Date(s).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
const gridStyle = () => ({ gridTemplateColumns: props.columns.map(c => c.w || '1fr').join(' ') })
/** 有操作列时追加一列固定宽度 */
const headStyle = () => ({
  gridTemplateColumns: props.columns.map((c) => c.w || '1fr').concat(writable.value ? ['140px'] : []).join(' ')
})

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
        <button v-if="writable" class="btn btn-primary btn-add" @click="openCreate">
          + 新增{{ entitySchema?.label || '' }}
        </button>
      </div>
    </div>

    <!-- 筛选中提示：从看板下钻后明确告知正在过滤，避免误以为数据丢了 -->
    <div v-if="hasFilter" class="filter-bar">
      <span class="fb-icon">⏷</span>
      <span class="fb-text">筛选中：<b>{{ filterText }}</b></span>
      <span class="fb-count">{{ rows.length }} 条</span>
      <button class="fb-clear" @click="clearFilter">清除筛选</button>
    </div>

    <div class="panel section-gap">
      <template v-if="!isMobile">
        <div class="list-head" :style="headStyle()">
          <span v-for="c in columns" :key="c.k">{{ c.label }}</span>
          <span v-if="writable">操作</span>
        </div>
        <div v-if="loading" class="state">加载中…</div>
        <div v-else-if="err" class="state">{{ err }}</div>
        <div v-else-if="!rows.length" class="state">暂无数据</div>
        <div v-for="(r, i) in rows" :key="i" class="list-row" :class="{ click: detailKind && r.id != null }" :style="headStyle()" @click="openDetail(r)">
          <template v-for="c in columns" :key="c.k">
            <StatusTag v-if="c.tag" :code="r[c.k]" />
            <span v-else-if="c.time" class="num">{{ fmtTime(r[c.k]) }}</span>
            <span v-else-if="c.dot" class="dotcell">
              <span :class="r[c.k] ? 'dot-live' : 'dot-off'"></span>
              <em>{{ r[c.k] ? '在线' : '离线' }}</em>
            </span>
            <span v-else :class="{ num: c.num }">{{ cell(r, c) }}</span>
          </template>
          <span v-if="writable" class="ops" @click.stop>
            <button
              v-if="entitySchema?.itemTable && nextStatuses(entityKind, r.status).length"
              class="op" title="推进状态" @click="toggleStatusMenu(r)"
            >推进</button>
            <button v-if="canEdit(entityKind, r.status)" class="op" @click="openEdit(r)">编辑</button>
            <button v-if="canDelete(entityKind, r.status)" class="op danger" @click="onDelete(r)">删除</button>
          </span>
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
          <div v-if="writable" class="m-ops" @click.stop>
            <button
              v-if="entitySchema?.itemTable && nextStatuses(entityKind, r.status).length"
              class="op" @click="toggleStatusMenu(r)"
            >推进</button>
            <button v-if="canEdit(entityKind, r.status)" class="op" @click="openEdit(r)">编辑</button>
            <button v-if="canDelete(entityKind, r.status)" class="op danger" @click="onDelete(r)">删除</button>
          </div>
        </div>
      </template>
    </div>

    <!-- 状态推进：点击「推进」后浮出的目标状态选择 -->
    <Transition name="scrim">
      <div v-if="statusMenuFor" class="status-scrim" @click="statusMenuFor = null"></div>
    </Transition>
    <Transition name="pop">
      <div v-if="statusMenuFor" class="status-menu panel" role="dialog" aria-label="选择目标状态">
        <div class="sm-head">推进到</div>
        <button
          v-for="st in statusMenuFor.options" :key="st"
          class="sm-item"
          @click="doTransition({ id: statusMenuFor.id }, st)"
        >{{ STATUS_LABEL[st] || st }}</button>
        <button class="sm-item cancel" @click="statusMenuFor = null">取消</button>
      </div>
    </Transition>

    <DetailSheet :open="detailOpen" :title="detailTitle" @close="detailOpen = false">
      <DetailPanel v-if="detailData && detailKind" :kind="detailKind" :data="detailData" />
      <div v-else class="state">加载中…</div>
    </DetailSheet>

    <!-- 通用新增/编辑表单 -->
    <EntityFormDialog
      v-if="entityKind"
      :kind="entityKind"
      :entity-id="editingId"
      :open="formOpen"
      @close="formOpen = false"
      @saved="onSaved"
    />
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

.btn-add { min-height: 40px; font-size: 14px; white-space: nowrap; }

/* 筛选提示条 */
.filter-bar {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin-top: 18px; padding: 10px 16px;
  border-radius: var(--r-card);
  background: rgba(0,113,227,0.06);
  font-size: 13px; color: var(--text-2);
}
.fb-icon { color: var(--accent); font-size: 12px; }
.fb-text b { color: var(--accent-link); font-weight: 600; }
.fb-count { color: var(--text-3); font-size: 12px; }
.fb-clear {
  margin-left: auto; border: none; background: none; cursor: pointer;
  font: inherit; font-size: 13px; color: var(--accent-link);
  padding: 4px 8px; border-radius: var(--r-pill);
}
.fb-clear:hover { background: rgba(0,113,227,0.08); }

/* 操作列 */
.ops { display: flex; gap: 6px; justify-content: flex-end; }
.m-ops { display: flex; gap: 8px; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--hairline); }
.op {
  border: none; background: rgba(0,0,0,0.05); cursor: pointer;
  font: inherit; font-size: 13px; color: var(--text-2);
  padding: 6px 12px; border-radius: var(--r-pill); min-height: 30px;
}
.op:active { transform: scale(0.94); }
.op.danger { color: var(--heat); background: var(--heat-bg); }
.op:hover { background: rgba(0,0,0,0.08); }
.op.danger:hover { background: rgba(255,107,0,0.18); }

/* 状态推进菜单 */
.status-scrim { position: fixed; inset: 0; z-index: 66; background: rgba(0,0,0,0.28); }
.status-menu {
  position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);
  z-index: 71; width: min(320px, 88vw); padding: 8px 0 12px;
}
.sm-head { padding: 12px 20px 8px; font-size: 13px; color: var(--text-3); }
.sm-item {
  display: block; width: 100%; text-align: left; border: none; background: none;
  font: inherit; font-size: 15px; color: var(--text); cursor: pointer;
  padding: 12px 20px; min-height: 46px;
}
.sm-item:active { background: var(--hover); }
.sm-item.cancel { color: var(--text-3); border-top: 1px solid var(--hairline); margin-top: 6px; }

.pop-enter-active { transition: opacity 0.28s var(--ease-spring), transform 0.28s var(--ease-spring); }
.pop-leave-active { transition: opacity 0.18s ease; }
.pop-enter-from, .pop-leave-to { opacity: 0; transform: translate(-50%, -46%) scale(0.94); }
.scrim-enter-active, .scrim-leave-active { transition: opacity 0.2s; }
.scrim-enter-from, .scrim-leave-to { opacity: 0; }
</style>
