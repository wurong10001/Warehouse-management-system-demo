<script setup>
import { ref, watch, onMounted } from 'vue'
import { api } from '../api'
import { useAuth } from '../stores/auth'
import { useRouter } from 'vue-router'
import StatusTag from '../components/StatusTag.vue'
import SegmentedControl from '../components/SegmentedControl.vue'

const auth = useAuth()
const router = useRouter()
const data = ref(null)
const err = ref('')
const seg = ref('all')
const SEGS = [
  { k: 'all', label: '全部' }, { k: 'inbound', label: '入库' },
  { k: 'outbound', label: '出库' }, { k: 'quality', label: '质检' },
  { k: 'stocktake', label: '盘点' }, { k: 'delivery', label: '配送' }
]
/** 分段控件需要 { value, label } 结构 */
const SEG_OPTS = SEGS.map((s) => ({ value: s.k, label: s.label }))

async function load() {
  err.value = ''
  try { data.value = await api.dashboard() } catch (e) { err.value = e.message }
}
onMounted(load)
watch(() => auth.baseId, load)

const todos = () => (data.value?.todos || []).filter(t => seg.value === 'all' || t.kind === seg.value)
const maxTrend = () => Math.max(1, ...(data.value?.trend || []).map(t => Math.max(t.in_qty, t.out_qty)))
const maxBase = () => Math.max(1, ...(data.value?.bases || []).map(b => b.qty))

/**
 * 等待时长：把 created_at 换算成「已等待多久」。
 * 待办列表只有单号和状态时，无法判断哪单该先处理；
 * 补上等待时长 + 超时标记（>24h）能直接指导优先级。
 */
function waited(iso) {
  if (!iso) return null
  const hours = (Date.now() - new Date(iso).getTime()) / 3600000
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} 分钟`
  if (hours < 24) return `${Math.round(hours)} 小时`
  return `${Math.floor(hours / 24)} 天`
}
/** 超过 24 小时视为需要优先处理 */
const isOverdue = (iso) => !!iso && (Date.now() - new Date(iso).getTime()) > 24 * 3600000

/** 指标卡下钻：点击跳到对应列表并带上筛选意图 */
const METRIC_LINKS = {
  pending_in: { path: '/inbound', label: '待入库' },
  pending_out: { path: '/outbound', label: '待出库' },
  pending_qc: { path: '/quality', label: '待质检' },
  pending_delivery: { path: '/delivery', label: '待配送' },
  stock_alerts: { path: '/inventory', label: '库存预警' }
}
function drill(metric) {
  const target = METRIC_LINKS[metric]
  if (target) router.push(target.path)
}
</script>

<template>
  <div class="wrap-grid">
    <div v-if="err" class="panel state">{{ err }}</div>
    <template v-else-if="data">
      <div class="hero">
        <div>
          <div class="eyebrow"><span class="dot-live"></span> 实时 · {{ data.base_name || '全部基地' }}</div>
          <h1>今日任务</h1>
        </div>
      </div>

      <div class="panel metrics section-gap">
        <button class="metric m drill" @click="drill('pending_in')">
          <span class="v">{{ data.metrics.pending_in }}</span><span class="k">今日待入库</span>
        </button>
        <button class="metric m drill" @click="drill('pending_out')">
          <span class="v">{{ data.metrics.pending_out }}</span><span class="k">今日待出库</span>
        </button>
        <button class="metric m drill" @click="drill('pending_qc')">
          <span class="v">{{ data.metrics.pending_qc }}</span><span class="k">待质检</span>
        </button>
        <button class="metric m drill" @click="drill('pending_delivery')">
          <span class="v">{{ data.metrics.pending_delivery }}</span><span class="k">待配送</span>
        </button>
        <button class="metric m drill" @click="drill('stock_alerts')">
          <span class="v" :class="{ heat: data.metrics.stock_alerts > 0 }">{{ data.metrics.stock_alerts }}</span>
          <span class="k">库存预警<template v-if="data.metrics.stock_alerts > 0"> ›</template></span>
        </button>
      </div>

      <div class="cols section-gap">
        <div class="col-main">
          <div class="panel">
            <div class="panel-head">
              <h3>我的待办</h3>
              <SegmentedControl :model-value="seg" :options="SEG_OPTS" @update:model-value="seg = $event" />
            </div>
            <div v-for="(t, i) in todos()" :key="i" class="panel-row">
              <div class="grow">
                <div class="row-t">{{ t.title }}</div>
                <div class="row-s">
                  {{ t.no }}
                  <template v-if="t.created_at">
                    <span class="sep">·</span>
                    <span :class="{ overdue: isOverdue(t.created_at) }">
                      已等 {{ waited(t.created_at) }}<template v-if="isOverdue(t.created_at)">（超时）</template>
                    </span>
                  </template>
                </div>
              </div>
              <StatusTag :code="t.status" />
            </div>
            <div v-if="!todos().length" class="state">当前筛选下没有待办</div>
          </div>

          <div class="panel section-gap">
            <div class="panel-head"><h3>异常单据</h3></div>
            <div
              v-for="(a, i) in data.alerts" :key="i"
              class="panel-row" :class="{ clickable: a.kind }"
              @click="a.kind && router.push('/' + a.kind)"
            >
              <div class="grow">
                <div class="row-t">{{ a.title }}</div>
                <div class="row-s">{{ a.no }}</div>
              </div>
              <span class="tag abnormal">{{ a.reason }}</span>
            </div>
            <div v-if="!data.alerts.length" class="state">暂无异常单据</div>
          </div>
        </div>

        <aside class="col-side">
          <div class="panel">
            <div class="panel-head"><h3>各基地库存分布</h3></div>
            <div v-for="b in data.bases" :key="b.name" class="panel-row bar-row">
              <span class="bar-label">{{ b.name }}</span>
              <div class="bar-track"><div class="bar-fill" :style="{ width: (b.qty / maxBase() * 100) + '%' }"></div></div>
              <span class="num bar-val">{{ b.qty }}</span>
            </div>
          </div>

          <div class="panel section-gap">
            <div class="panel-head"><h3>近 7 天出入库</h3><span class="more"><i class="lg"></i>入库 <i class="dg"></i>出库</span></div>
            <div class="trend">
              <div v-for="t in data.trend" :key="t.day" class="tcol">
                <div class="tgroup">
                  <div class="tbar lg" :style="{ height: (t.in_qty / maxTrend() * 72) + 'px' }"></div>
                  <div class="tbar dg" :style="{ height: (t.out_qty / maxTrend() * 72) + 'px' }"></div>
                </div>
                <span class="tday">{{ t.day }}</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </template>
    <div v-else class="panel state">加载中…</div>
  </div>
</template>

<style scoped>
.hero { padding-top: 12px; }
.metrics { display: grid; grid-template-columns: repeat(5, 1fr); }
.m { padding: 22px; border-right: 1px solid var(--hairline); text-align: left; }
.m:last-child { border-right: none; }

/* 指标卡改为 button 后重置默认样式，并给按压反馈 */
.m.drill {
  border: none; border-top: none; border-bottom: none; border-left: none;
  background: transparent; font: inherit; cursor: pointer;
  transition: background 0.15s var(--ease-out-quart), transform var(--dur-spring) var(--ease-spring-back);
}
.m.drill:hover { background: var(--hover); }
.m.drill:active { transform: scale(0.97); }
.m.drill .k { display: inline-flex; align-items: center; gap: 2px; }

/* 待办等待时长 */
.row-s .sep { margin: 0 4px; color: var(--text-4); }
.row-s .overdue { color: var(--heat); font-weight: 600; }

/* 可下钻的异常行 */
.panel-row.clickable { cursor: pointer; }
.panel-row.clickable:active { background: var(--hover); }
.v.heat { color: var(--heat); }
.cols { display: grid; grid-template-columns: 1fr 320px; gap: 22px; align-items: start; }
.grow { flex: 1; min-width: 0; }
.row-t { font-size: 14px; }
.row-s { font-size: 12px; color: var(--text-3); }
.state { padding: 36px; text-align: center; color: var(--text-3); font-size: 14px; }
.bar-row { gap: 10px; }
.bar-label { width: 84px; font-size: 13px; color: var(--text-2); flex-shrink: 0; }
.bar-track { flex: 1; height: 6px; border-radius: var(--r-pill); background: var(--track); overflow: hidden; }
.bar-fill { height: 100%; border-radius: var(--r-pill); background: var(--accent); }
.bar-val { width: 44px; text-align: right; font-size: 13px; color: var(--text-2); }
.trend { display: flex; align-items: flex-end; gap: 10px; padding: 18px 22px 16px; height: 120px; }
.tcol { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.tgroup { display: flex; align-items: flex-end; gap: 3px; height: 72px; }
.tbar { width: 10px; border-radius: 3px 3px 0 0; min-height: 2px; }
.tbar.lg { background: var(--faint); }
.tbar.dg { background: var(--accent); }
.tday { font-size: 11px; color: var(--text-4); }
.more { font-size: 12px; color: var(--text-3); display: inline-flex; align-items: center; gap: 4px; }
.lg, .dg { width: 7px; height: 7px; border-radius: 2px; display: inline-block; }
.lg { background: var(--faint); } .dg { background: var(--accent); }
@media (max-width: 900px) {
  .metrics { grid-template-columns: repeat(2, 1fr); }
  .m { border-bottom: 1px solid var(--hairline); }
  .cols { grid-template-columns: 1fr; }
}
@media (max-width: 820px) {
  .trend { gap: 6px; padding: 18px 14px 16px; }
  .m { padding: 16px 18px; }
  .v { font-size: 24px; }
  .panel-row { padding: 10px 18px; }
}
</style>
