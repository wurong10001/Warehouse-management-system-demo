<script setup>
/**
 * 消息中心面板。
 *
 * 展示站内消息（新单据、入库完成、质检结果、审批请求/结果），
 * 支持逐条/全部标记已读。未读数由父组件（AppShell）维护用于红点。
 */
import { ref, computed, watch } from 'vue'
import { api } from '../api'
import { useRouter } from 'vue-router'

const props = defineProps({ open: Boolean })
const emit = defineEmits(['close'])
const router = useRouter()

const items = ref([])
const unread = ref(0)
const loading = ref(false)
const err = ref('')

async function load() {
  loading.value = true
  err.value = ''
  try {
    const r = await api.messages()
    items.value = r.items
    unread.value = r.unread
  } catch (e) {
    err.value = e.message
  } finally {
    loading.value = false
  }
}

watch(() => props.open, (v) => { if (v) load() })

async function markAll() {
  try {
    await api.markMessagesRead()
    await load()
  } catch (e) { err.value = e.message }
}

/** 点击单条：标记已读，并按 ref_doc 尝试跳到对应单据列表 */
async function openItem(m) {
  if (!m.read_at) {
    try {
      await api.markMessagesRead(m.id)
      m.read_at = new Date().toISOString()
      unread.value = Math.max(0, unread.value - 1)
    } catch { /* 忽略 */ }
  }
  // 按消息类型跳到相关页面
  const path = PATH_OF[m.type]
  if (path) {
    emit('close')
    router.push(path)
  }
}

const PATH_OF = {
  inbound_created: '/inbound', inbound_completed: '/inbound',
  outbound_created: '/outbound', outbound_completed: '/outbound',
  quality_created: '/quality', quality_result: '/quality',
  stocktake_created: '/stocktake', stocktake_completed: '/stocktake',
  delivery_created: '/delivery', delivery_signed: '/delivery',
  approval_request: '/warehouse', approval_result: '/warehouse'
}

const fmtTime = (s) => {
  if (!s) return ''
  const d = new Date(s)
  const diff = Date.now() - d.getTime()
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

const levelClass = (lv) => (lv === 'warn' ? 'warn' : lv === 'success' ? 'success' : '')
</script>

<template>
  <Transition name="scrim"><div v-if="open" class="mscrim" @click="emit('close')"></div></Transition>
  <Transition name="slide">
    <aside v-if="open" class="msg-drawer" role="dialog" aria-label="消息中心">
      <header class="mh">
        <h3>消息<template v-if="unread"> · {{ unread }} 条未读</template></h3>
        <div class="mh-ops">
          <button v-if="unread" class="btn btn-ghost sm" @click="markAll">全部已读</button>
          <button class="close" aria-label="关闭" @click="emit('close')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
      </header>

      <div class="mbody">
        <div v-if="loading" class="state">加载中…</div>
        <div v-else-if="err" class="state">{{ err }}</div>
        <div v-else-if="!items.length" class="state">暂无消息</div>
        <button
          v-for="m in items" :key="m.id"
          class="msg-item" :class="[{ unread: !m.read_at }, levelClass(m.level)]"
          @click="openItem(m)"
        >
          <span class="mi-dot" :class="{ on: !m.read_at }"></span>
          <span class="mi-main">
            <span class="mi-title">{{ m.title }}</span>
            <span class="mi-body">{{ m.body }}</span>
            <span class="mi-meta">{{ fmtTime(m.created_at) }}<template v-if="m.ref_doc"> · {{ m.ref_doc }}</template></span>
          </span>
        </button>
      </div>
    </aside>
  </Transition>
</template>

<style scoped>
.mscrim { position: fixed; inset: 0; z-index: 65; background: rgba(0,0,0,0.32); }
.msg-drawer {
  position: fixed; top: 0; right: 0; bottom: 0; z-index: 70;
  width: 400px; max-width: 92vw;
  background: rgba(245,245,247,0.92);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  border-left: 1px solid var(--hairline);
  box-shadow: var(--sh-overlay);
  display: flex; flex-direction: column;
}
.mh {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px 12px; flex-shrink: 0;
  border-bottom: 1px solid var(--hairline);
}
.mh h3 { font-size: 16px; font-weight: 650; }
.mh-ops { display: flex; align-items: center; gap: 8px; }
.btn.sm { min-height: 32px; padding: 0 10px; font-size: 13px; }
.close {
  width: 30px; height: 30px; border-radius: 50%; border: none; cursor: pointer;
  background: rgba(0,0,0,0.05); color: var(--text-2);
  display: grid; place-items: center;
}
.mbody { flex: 1; overflow-y: auto; padding: 6px 0 20px; }
.state { padding: 40px; text-align: center; color: var(--text-3); font-size: 14px; }

.msg-item {
  display: flex; gap: 10px; width: 100%; text-align: left;
  border: none; background: none; cursor: pointer;
  padding: 12px 20px; border-bottom: 1px solid var(--hairline);
  font: inherit;
  transition: background 0.15s var(--ease-out-quart);
}
.msg-item:active { background: var(--hover); }
.msg-item.unread { background: rgba(0,113,227,0.04); }
.mi-dot {
  flex-shrink: 0; width: 7px; height: 7px; border-radius: 50%;
  margin-top: 7px; background: transparent;
}
.mi-dot.on { background: var(--heat); }
.mi-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.mi-title { font-size: 14px; font-weight: 600; color: var(--text); }
.msg-item.warn .mi-title { color: var(--heat); }
.mi-body { font-size: 13px; color: var(--text-2); overflow-wrap: anywhere; }
.mi-meta { font-size: 11px; color: var(--text-4); }

.slide-enter-active { transition: transform 0.4s var(--ease-spring); }
.slide-leave-active { transition: transform 0.28s var(--ease-spring); }
.slide-enter-from, .slide-leave-to { transform: translateX(100%); }
.scrim-enter-active, .scrim-leave-active { transition: opacity 0.22s; }
.scrim-enter-from, .scrim-leave-to { opacity: 0; }

@media (max-width: 820px) {
  .msg-drawer { width: auto; left: 0; top: auto; max-height: 82vh;
    border-left: none; border-radius: var(--r-panel) var(--r-panel) 0 0;
    padding-bottom: env(safe-area-inset-bottom); }
  .slide-enter-from, .slide-leave-to { transform: translateY(100%); }
}
@media (prefers-reduced-motion: reduce) {
  .slide-enter-active, .slide-leave-active { transition: opacity 0.2s; }
  .slide-enter-from, .slide-leave-to { transform: none; opacity: 0; }
}
@media (prefers-reduced-transparency: reduce) {
  .msg-drawer { background: var(--bg); backdrop-filter: none; -webkit-backdrop-filter: none; }
}
</style>
