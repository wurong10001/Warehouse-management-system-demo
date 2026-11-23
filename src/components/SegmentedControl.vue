<script setup>
/**
 * 分段控件 / 药丸选择器 —— 带 iOS 滑动指示器。
 *
 * 原实现是「每个按钮自己切换 .on 背景」，换选项时两个背景各自淡入淡出，
 * 视觉上是「闪」而不是「滑」。iOS 的做法是：
 *   容器里只有 **一个** 浮起的胶囊，它移动到当前选中项的位置。
 *
 * 实现要点：
 *   - 胶囊用 transform: translateX + width 过渡，走弹簧曲线（可过冲）
 *   - 首次测量时禁用过渡，否则会从左上角「飞」进第一个选项
 *   - 监听容器尺寸变化（ResizeObserver），字体缩放/窗口 resize 后重新测量
 *   - 按钮自身不再有背景，只保留文字颜色变化，背景完全交给胶囊
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useMobile } from '../composables/useMobile'

const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  /** [{ value, label }] */
  options: { type: Array, required: true },
  /** segmented（灰底容器）| pills（透明，用于顶栏基地切换） */
  variant: { type: String, default: 'segmented' }
})
const emit = defineEmits(['update:modelValue', 'change'])

const isMobile = useMobile()
const root = ref(null)
const btnRefs = ref([])
const thumb = ref({ left: 0, width: 0 })
/** 首次定位期间关闭过渡，避免胶囊从 0 宽度/左上角飞入 */
const instant = ref(true)
let ro = null

function measure() {
  const container = root.value
  const buttons = btnRefs.value.filter(Boolean)
  if (!container || !buttons.length) return

  const idx = props.options.findIndex((o) => o.value === props.modelValue)
  const btn = buttons[idx] ?? buttons[0]
  if (!btn) return

  // offsetLeft 相对于 offsetParent（即 .segmented 容器，已设 position: relative），
  // 因此在横向滚动容器里会自然跟随内容坐标，无需额外处理滚动。
  thumb.value = { left: btn.offsetLeft, width: btn.offsetWidth }
}

async function measureThenAnimate() {
  await nextTick()
  measure()
  scrollActiveIntoView()
  // 下一帧再放开过渡，确保首帧是「无动画定位」
  requestAnimationFrame(() => { instant.value = false })
}

/**
 * 选项较多时容器可横向滚动，切换选中项后要保证胶囊在可视区域内。
 * 用 scrollIntoView 的 inline:'nearest'，避免整页纵向跳动。
 */
function scrollActiveIntoView() {
  const container = root.value
  if (!container) return
  const idx = props.options.findIndex((o) => o.value === props.modelValue)
  const btn = btnRefs.value.filter(Boolean)[idx]
  if (!btn) return
  try {
    btn.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  } catch {
    /* 老浏览器或不支持平滑滚动时忽略 */
  }
}

onMounted(async () => {
  await nextTick()
  measure()
  scrollActiveIntoView()
  requestAnimationFrame(() => { instant.value = false })

  if (typeof ResizeObserver !== 'undefined' && root.value) {
    ro = new ResizeObserver(() => measure())
    ro.observe(root.value)
  }
  window.addEventListener('resize', measure)
})

onBeforeUnmount(() => {
  ro?.disconnect()
  window.removeEventListener('resize', measure)
})

// 选中项变化 → 胶囊滑动；选项列表变化（如切换基地后数量变化）→ 重新定位
watch(() => props.modelValue, measureThenAnimate)
watch(() => props.options.length, measureThenAnimate)
// 移动端断点切换布局时尺寸会变
watch(isMobile, measureThenAnimate)

const thumbStyle = computed(() => ({
  transform: `translateX(${thumb.value.left}px)`,
  width: `${thumb.value.width}px`
}))

function select(value) {
  if (value === props.modelValue) return
  emit('update:modelValue', value)
  emit('change', value)
}
</script>

<template>
  <div
    ref="root"
    class="segmented"
    :class="[variant, { 'no-anim': instant }]"
    role="tablist"
  >
    <!-- 浮起的胶囊：唯一背景，负责「滑动」 -->
    <span class="seg-thumb" :style="thumbStyle" aria-hidden="true"></span>
    <button
      v-for="(opt, i) in options"
      :key="opt.value"
      ref="btnRefs"
      type="button"
      role="tab"
      :aria-selected="modelValue === opt.value"
      :class="{ on: modelValue === opt.value }"
      @click="select(opt.value)"
    >{{ opt.label }}</button>
  </div>
</template>

<style scoped>
.segmented {
  position: relative;
  /* 让胶囊的 inset 计算有参照 */
  isolation: isolate;

  /* ⚠️ 必须保持单行：
     胶囊靠绝对定位 + offsetLeft 定位，一旦换行，
     第二行的按钮与胶囊坐标就对不上，表现为胶囊错位/溢出。
     选项较多时用横向滚动，而不是换行。 */
  flex-wrap: nowrap;
  max-width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
  /* 滚动时留出内边距，避免首尾按钮贴边 */
  scroll-padding-inline: 4px;
}
.segmented::-webkit-scrollbar { display: none; }
/* 按钮不允许被压缩，否则文字会被压成竖排 */
.segmented button { flex: 0 0 auto; }

/* 胶囊：绝对定位，靠 transform 移动 —— 只动合成层，不触发布局 */
.seg-thumb {
  position: absolute;
  top: 2px;
  bottom: 2px;
  left: 0;
  z-index: 0;
  border-radius: var(--r-pill);
  background: var(--surface);
  box-shadow: var(--sh-card);
  pointer-events: none;
  will-change: transform, width;
  transition:
    transform var(--dur-spring) var(--ease-spring-back),
    width var(--dur-spring) var(--ease-spring-back);
}

/* 首次定位不播放动画 */
.no-anim .seg-thumb { transition: none; }

.segmented button {
  position: relative;
  z-index: 1;
  /* 背景由胶囊提供，按钮只负责文字 */
  background: transparent;
}

/* 选中项：文字加深加粗；背景交给胶囊，故清除 .on 的底色 */
.segmented button.on {
  background: transparent;
  color: var(--text);
  font-weight: 600;
  box-shadow: none;
}

/* ── 顶栏基地切换（pills 变体）── */
.pills { background: transparent; padding: 2px; }
.pills .seg-thumb {
  /* 顶栏容器本身无内边距，胶囊贴合按钮高度 */
  top: 0;
  bottom: 0;
}
.pills button { color: var(--text-3); }
.pills button.on { color: var(--text); }

/* 移动端胶囊滑动稍快一点，手感更跟手 */
@media (max-width: 820px) {
  .seg-thumb { transition-duration: var(--dur-pop); }
}

/* 尊重「减少动态效果」：胶囊直接跳位，不做滑动 */
@media (prefers-reduced-motion: reduce) {
  .seg-thumb { transition: none; }
}
</style>
