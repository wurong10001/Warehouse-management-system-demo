<script setup>
import { ref, computed, watch } from 'vue'
import { useMobile } from '../composables/useMobile'
import { useDragDismiss } from '../composables/useDragDismiss'

const props = defineProps({ open: Boolean, title: String })
const emit = defineEmits(['close'])
const isMobile = useMobile()
const sheetRef = ref(null)
const { dy, dragging, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, reset } = useDragDismiss(() => sheetRef.value, () => emit('close'))
watch(() => props.open, (v) => { if (v) reset() })

const sheetStyle = computed(() => {
  if (!isMobile.value || !dy.value) return null
  return { transform: `translateY(${dy.value}px)` }
})
const scrimStyle = computed(() => {
  if (!isMobile.value || dy.value <= 0) return null
  const h = sheetRef.value?.offsetHeight || 500
  return { opacity: Math.max(0, 1 - dy.value / h) }
})
</script>

<template>
  <Transition name="scrim"><div v-if="open" class="dscrim" :style="scrimStyle" @click="emit('close')"></div></Transition>
  <Transition :name="isMobile ? 'up' : 'slide'">
    <aside v-if="open" ref="sheetRef" class="drawer" :class="{ mobile: isMobile, dragging }" :style="sheetStyle" role="dialog" :aria-label="title">
      <div
        v-if="isMobile"
        class="grab-area"
        @pointerdown.prevent="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerCancel"
      ><div class="grab"></div></div>
      <header class="dhead">
        <h3>{{ title }}</h3>
        <button v-if="!isMobile" class="close" aria-label="关闭" @click="emit('close')">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </header>
      <div class="dbody"><slot /></div>
    </aside>
  </Transition>
</template>

<style scoped>
.dscrim { position: fixed; inset: 0; z-index: 65; background: rgba(0,0,0,0.32); }
.drawer {
  position: fixed; top: 0; right: 0; bottom: 0; z-index: 70;
  width: 460px; max-width: 92vw;
  background: rgba(245,245,247,0.88);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  border-left: 1px solid var(--hairline);
  box-shadow: var(--sh-overlay);
  display: flex; flex-direction: column;
}
.drawer.mobile {
  top: auto; left: 0; width: auto; max-width: none; max-height: 86vh;
  border-left: none; border-radius: var(--r-panel) var(--r-panel) 0 0;
  padding-bottom: env(safe-area-inset-bottom);
}
.grab-area { padding: 12px 0 4px; flex-shrink: 0; touch-action: none; cursor: grab; }
.grab { width: 38px; height: 5px; border-radius: var(--r-pill); background: var(--faint); margin: 0 auto; }
.drawer.dragging { transition: none !important; }
.dhead {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 22px 12px; flex-shrink: 0;
}
.close {
  width: 30px; height: 30px; border-radius: 50%; border: none; cursor: pointer;
  background: rgba(0,0,0,0.05); color: var(--text-2);
  display: grid; place-items: center;
}
.close:active { transform: scale(0.94); }
.dbody { flex: 1; overflow-y: auto; padding: 0 22px 28px; }

/* 转场保留原有空间路径（桌面从右、移动从下），并叠加玻璃材质化：
   backdrop-filter 与 scale/opacity 同步走，材质「抵达」而非单纯「淡入」。
   transform-origin 锚定到触发侧，符合 motion.md §4 的空间一致性。 */
.slide-enter-active, .slide-leave-active {
  transition:
    transform 0.4s var(--ease-spring),
    backdrop-filter 0.4s var(--ease-spring),
    -webkit-backdrop-filter 0.4s var(--ease-spring),
    opacity 0.4s var(--ease-spring);
  transform-origin: right center;
}
.slide-enter-from, .slide-leave-to {
  transform: translateX(100%);
  backdrop-filter: blur(0px) saturate(100%);
  -webkit-backdrop-filter: blur(0px) saturate(100%);
  opacity: 0;
}
.up-enter-active, .up-leave-active {
  transition:
    transform 0.4s var(--ease-spring),
    backdrop-filter 0.4s var(--ease-spring),
    -webkit-backdrop-filter 0.4s var(--ease-spring),
    opacity 0.4s var(--ease-spring);
  transform-origin: bottom center;
}
.up-enter-from, .up-leave-to {
  transform: translateY(100%);
  backdrop-filter: blur(0px) saturate(100%);
  -webkit-backdrop-filter: blur(0px) saturate(100%);
  opacity: 0;
}
.scrim-enter-active, .scrim-leave-active { transition: opacity 0.22s; }
.scrim-enter-from, .scrim-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) {
  .slide-enter-active, .slide-leave-active, .up-enter-active, .up-leave-active { transition: opacity 0.2s; }
  .slide-enter-from, .slide-leave-to, .up-enter-from, .up-leave-to { transform: none; opacity: 0; backdrop-filter: none; -webkit-backdrop-filter: none; }
}
@media (prefers-reduced-transparency: reduce) {
  .drawer { background: var(--surface); backdrop-filter: none; -webkit-backdrop-filter: none; }
}
</style>
