<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { MENU } from '../config/menu'
import { useAuth } from '../stores/auth'
import { useDragDismiss } from '../composables/useDragDismiss'

const auth = useAuth()
const router = useRouter()
const route = useRoute()
const scrolled = ref(false)
const sheet = ref(false)
const sheetRef = ref(null)
const { dy, dragging, onStart, onMove, onEnd, reset } = useDragDismiss(() => sheetRef.value, () => { sheet.value = false })
watch(sheet, (v) => { if (v) reset() })

const sheetStyle = computed(() => (dy.value ? { transform: `translateY(${dy.value}px)` } : null))
const scrimStyle = computed(() => {
  if (dy.value <= 0) return null
  const h = sheetRef.value?.offsetHeight || 500
  return { opacity: Math.max(0, 1 - dy.value / h) }
})

const onScroll = () => { scrolled.value = window.scrollY > 4 }
onMounted(() => window.addEventListener('scroll', onScroll, { passive: true }))
onBeforeUnmount(() => window.removeEventListener('scroll', onScroll))
watch(() => route.fullPath, () => { sheet.value = false })

const flat = MENU.flatMap((g) => g.items)
const TAB_LABEL = { dashboard: '看板', inbound: '入库', outbound: '出库', inventory: '库存' }
const tabs = computed(() =>
  ['dashboard', 'inbound', 'outbound', 'inventory']
    .map((k) => flat.find((i) => i.key === k))
    .filter((i) => i && auth.can(i.key))
    .map((i) => ({ ...i, label: TAB_LABEL[i.key] || i.label }))
)
const moreItems = computed(() =>
  flat.filter((i) => !['dashboard', 'inbound', 'outbound', 'inventory'].includes(i.key) && auth.can(i.key))
)

const isActive = (p) => route.path === p
function pickBase(id) {
  auth.setBase(id)
  router.push('/')
}
async function logout() {
  await auth.logout()
  router.replace('/login')
}
</script>

<template>
  <div class="shell">
    <aside class="side">
      <div class="brand">
        <div class="brand-mark">WMS</div>
        <div class="brand-name">备件仓储管理</div>
      </div>
      <nav>
        <template v-for="g in MENU" :key="g.group ?? '_top'">
          <div v-if="g.group" class="side-group">{{ g.group }}</div>
          <router-link
            v-for="it in g.items.filter(i => auth.can(i.key))"
            :key="it.key" :to="it.path"
            class="side-item"
            :class="{ on: isActive(it.path) }"
          >{{ it.label }}</router-link>
        </template>
      </nav>
    </aside>

    <div class="main">
      <header class="topbar" :class="{ scrolled }">
        <div class="base-pick">
          <button
            v-for="b in auth.bases" :key="b.id"
            class="base-pill" :class="{ on: auth.baseId === b.id }"
            @click="pickBase(b.id)"
          >{{ b.name }}</button>
        </div>
        <div class="spacer"></div>
        <span class="who">{{ auth.user?.name }}</span>
        <button class="btn btn-ghost logout-btn" @click="logout">退出</button>
      </header>
      <main class="content"><router-view :key="$route.path" /></main>
    </div>

    <!-- 手机端底部 Tab 栏 -->
    <nav class="tabbar">
      <button
        v-for="t in tabs" :key="t.key"
        class="tab" :class="{ on: isActive(t.path) }"
        @click="router.push(t.path)"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
          <template v-if="t.key === 'dashboard'">
            <rect x="3" y="3" width="7" height="7" rx="1.2" /><rect x="14" y="3" width="7" height="7" rx="1.2" />
            <rect x="3" y="14" width="7" height="7" rx="1.2" /><rect x="14" y="14" width="7" height="7" rx="1.2" />
          </template>
          <template v-else-if="t.key === 'inbound'">
            <path d="M12 17V3" /><path d="m6 11 6 6 6-6" /><path d="M19 21H5" />
          </template>
          <template v-else-if="t.key === 'outbound'">
            <path d="m18 9-6-6-6 6" /><path d="M12 3v14" /><path d="M19 21H5" />
          </template>
          <template v-else>
            <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
            <path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" />
          </template>
        </svg>
        <span>{{ t.label }}</span>
      </button>
      <button class="tab" :class="{ on: sheet }" @click="sheet = !sheet">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round">
          <circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" />
        </svg>
        <span>更多</span>
      </button>
    </nav>

    <!-- 更多：底部弹层（下拉拖拽关闭） -->
    <Transition name="scrim"><div v-if="sheet" class="scrim" :style="scrimStyle" @click="sheet = false"></div></Transition>
    <Transition name="sheet">
      <div v-if="sheet" ref="sheetRef" class="sheet" :class="{ dragging }" :style="sheetStyle" role="dialog" aria-label="更多功能">
        <div class="grab-area" @touchstart="onStart" @touchmove.prevent="onMove" @touchend="onEnd">
          <div class="grab"></div>
        </div>
        <div class="sheet-base">
          <span class="sb-label">当前基地</span>
          <div class="segmented">
            <button
              v-for="b in auth.bases" :key="b.id"
              :class="{ on: auth.baseId === b.id }"
              @click="pickBase(b.id)"
            >{{ b.name }}</button>
          </div>
        </div>
        <div class="sheet-rows">
          <button v-for="it in moreItems" :key="it.key" class="sheet-item" @click="router.push(it.path)">
            {{ it.label }}
          </button>
          <button class="sheet-item signout" @click="logout">退出登录 · {{ auth.user?.name }}</button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.shell { display: flex; min-height: 100vh; }
.side {
  width: 216px; flex-shrink: 0; background: var(--surface);
  border-right: 1px solid var(--hairline);
  padding: 20px 12px; position: sticky; top: 0; height: 100vh; overflow-y: auto;
}
.brand { display: flex; align-items: center; gap: 10px; padding: 0 12px 18px; }
.brand-mark {
  width: 34px; height: 34px; border-radius: var(--r-thumb);
  background: var(--grad-cta); color: #fff;
  display: grid; place-items: center;
  font-size: 11px; font-weight: 700; letter-spacing: 0.02em;
}
.brand-name { font-size: 14px; font-weight: 650; letter-spacing: -0.01em; }
.side-group { font-size: 11px; color: var(--text-4); padding: 16px 12px 6px; }
.side-item {
  display: block; padding: 9px 12px; margin: 1px 0;
  border-radius: var(--r-thumb); font-size: 14px; color: var(--text-2);
  transition: background 0.15s var(--ease-out-quart), color 0.15s;
}
.side-item:hover { background: var(--hover); color: var(--text); }
.side-item.on { background: rgba(0,113,227,0.08); color: var(--accent-link); font-weight: 600; }
.main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.spacer { flex: 1; }
.base-pick { display: flex; gap: 6px; }
.base-pill {
  border: none; cursor: pointer; font: inherit; font-size: 13px;
  padding: 7px 14px; border-radius: var(--r-pill);
  background: transparent; color: var(--text-3);
  transition: background 0.2s var(--ease-out-quart), color 0.2s;
}
.base-pill.on { background: var(--surface); color: var(--text); font-weight: 600; box-shadow: var(--sh-card); }
.who { font-size: 13px; color: var(--text-2); }
.content { flex: 1; padding: 32px 0 64px; }

/* 底部 Tab（默认隐藏，手机端显示） */
.tabbar { display: none; }
.tab {
  flex: 1; min-height: 56px; border: none; background: none; cursor: pointer;
  font: inherit; font-size: 10px; color: var(--text-3);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
  transition: color 0.15s var(--ease-out-quart), transform 0.1s;
}
.tab svg { width: 24px; height: 24px; }
.tab.on { color: var(--accent); }
.tab:active { transform: scale(0.96); }

.scrim { position: fixed; inset: 0; z-index: 65; background: rgba(0,0,0,0.32); }
.sheet {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 70;
  background: rgba(245,245,247,0.92);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  border-radius: var(--r-panel) var(--r-panel) 0 0;
  box-shadow: var(--sh-overlay);
  padding: 8px 0 calc(env(safe-area-inset-bottom) + 10px);
  max-height: 74vh; overflow-y: auto;
}
.grab-area { padding: 12px 0 4px; touch-action: none; cursor: grab; }
.grab { width: 38px; height: 5px; border-radius: var(--r-pill); background: var(--faint); margin: 0 auto; }
.sheet.dragging { transition: none !important; }
.sheet-base { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 22px 12px; flex-wrap: wrap; }
.sb-label { font-size: 13px; color: var(--text-2); }
.sheet-rows { margin: 4px 16px 0; background: var(--surface); border-radius: var(--r-card); box-shadow: var(--sh-card); overflow: hidden; }
.sheet-item {
  display: flex; align-items: center; width: 100%; text-align: left;
  border: none; border-bottom: 1px solid var(--hairline); background: none;
  font: inherit; font-size: 15px; color: var(--text);
  min-height: 52px; padding: 0 18px; cursor:pointer;
}
.sheet-item:last-child { border-bottom: none; }
.sheet-item:active { background: var(--hover); }
.sheet-item.signout { color: var(--accent-link); }

@media (max-width: 820px) {
  .side { display: none; }
  .tabbar {
    display: flex; position: fixed; left: 0; right: 0; bottom: 0; z-index: 60;
    background: rgba(245,245,247,0.82);
    backdrop-filter: saturate(180%) blur(20px);
    -webkit-backdrop-filter: saturate(180%) blur(20px);
    border-top: 1px solid var(--hairline);
    padding-bottom: env(safe-area-inset-bottom);
  }
  .content { padding: 20px 0 100px; }
  .who, .logout-btn { display: none; }
  .base-pick { overflow-x: auto; scrollbar-width: none; }
  .base-pick::-webkit-scrollbar { display: none; }
}

.sheet-enter-active { transition: transform 0.4s var(--ease-spring); }
.sheet-leave-active { transition: transform 0.28s var(--ease-spring); }
.sheet-enter-from, .sheet-leave-to { transform: translateY(100%); }
.scrim-enter-active, .scrim-leave-active { transition: opacity 0.22s; }
.scrim-enter-from, .scrim-leave-to { opacity: 0; }

@media (prefers-reduced-motion: reduce) {
  .sheet-enter-active, .sheet-leave-active { transition: opacity 0.2s; }
  .sheet-enter-from, .sheet-leave-to { transform: none; opacity: 0; }
}
@media (prefers-reduced-transparency: reduce) {
  .tabbar, .sheet { background: var(--bg); backdrop-filter: none; -webkit-backdrop-filter: none; }
  .sheet { background: var(--surface); }
}
</style>
