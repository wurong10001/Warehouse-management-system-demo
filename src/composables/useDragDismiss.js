import { ref } from 'vue'

/**
 * 下拉关闭手势 —— Pointer Events 版（Apple 流体交互，见 motion.md §6）
 *
 * 相比原来的 touch 阈值判定，这一版增加：
 *   - setPointerCapture：手指/鼠标移出元素也能继续接收事件，1:1 跟手
 *   - 位置/时间历史 → 释放速度（px/ms）
 *   - 速度接力：快速甩出即便位移不足也能关闭
 *   - 动量投影：projected = current + (v/1000)·d/(1−d)（d≈0.998），
 *     按投影落点决定 commit，而不是按松手瞬间的位移
 *   - 边界 rubber-band：向上拖动 progressive resistance，不硬停
 *   - ~10px 方向迟滞，避免微小抖动被当成拖拽
 *
 * 同时保留旧的 TouchEvent 入口（onStart/onMove/onEnd），供降级或
 * 其他仍绑 touch 的调用方使用——两条入口复用同一套状态机。
 * 对外 API 完全不变：dy / dragging / onStart / onMove / onEnd / reset。
 */
export function useDragDismiss(getEl, onDismiss, {
  threshold = 80,
  vThreshold = 0.5,
  rubberBand = 0.55,
  hysteresis = 10,
  projectionDecay = 0.998
} = {}) {
  const dy = ref(0)
  const dragging = ref(false)

  let startY = 0
  let lastY = 0
  let lastT = 0
  let lastV = 0
  let pointerId = null
  let activeEl = null

  // ── 内部状态机（两条入口共用） ────────────────────────────────
  function begin(y, el) {
    startY = y
    lastY = y
    lastT = Date.now()
    lastV = 0
    activeEl = el || null
    dragging.value = true
  }

  function move(y, evt) {
    if (!dragging.value) return
    const raw = y - startY
    // 方向迟滞：微小抖动（<hysteresis）不算拖拽，避免误触发关闭
    if (Math.abs(raw) < hysteresis && dy.value === 0) return
    let d = raw
    // 边界 rubber-band：向上拖动（d<0）时 progressive resistance，
    // 公式见 motion.md §6，避免硬停的「撞墙感」
    if (d < 0) {
      const o = -d
      d = -(o * rubberBand * projectionDecay) / (rubberBand + projectionDecay * o)
    }
    dy.value = Math.round(d)

    const now = Date.now()
    if (now - lastT > 40) {
      lastV = (y - lastY) / Math.max(now - lastT, 1) // px/ms，向下为正
      lastT = now
      lastY = y
    }
    if (evt?.cancelable) evt.preventDefault()
  }

  function end() {
    if (!dragging.value) return
    dragging.value = false
    if (pointerId !== null && activeEl?.hasPointerCapture?.(pointerId)) {
      activeEl.releasePointerCapture(pointerId)
    }
    pointerId = null
    activeEl = null

    const h = getEl()?.offsetHeight || 500
    // 动量投影：skill §6 公式 projected = current + (v/1000)·d/(1−d)
    // lastV 单位是 px/ms，等价于 v(px/s)/1000，所以这里直接乘 d/(1−d)。
    // 上限 h 防止极快甩动时投影超出 sheet 高度导致误判。
    const projection = Math.min(
      lastV * (projectionDecay / (1 - projectionDecay)),
      h
    )
    const projected = dy.value + projection
    const commit =
      dy.value > threshold ||
      lastV > vThreshold ||
      projected > threshold

    if (commit) {
      dy.value = h
      onDismiss()
    } else {
      // 回弹到 0；下一帧再归零，确保 transition 从当前值开始（可中断）
      requestAnimationFrame(() => { dy.value = 0 })
    }
  }

  // ── Pointer Events 入口（推荐，模板用这一组） ──────────────────
  function pointY(e) { return e.clientY }

  function onPointerDown(e) {
    // 只响应主键（鼠标左键 / 触摸 / 笔尖），忽略右键等多指
    if (e.isPrimary === false || (e.pointerType === 'mouse' && e.button !== 0)) return
    begin(pointY(e), e.currentTarget)
    pointerId = e.pointerId
    activeEl = e.currentTarget
    try { activeEl?.setPointerCapture?.(e.pointerId) } catch { /* 不支持则退化为普通跟踪 */ }
    if (e.cancelable) e.preventDefault()
  }

  function onPointerMove(e) {
    if (!dragging.value || (pointerId !== null && e.pointerId !== pointerId)) return
    move(pointY(e), e)
  }

  function onPointerUp(e) {
    if (pointerId !== null && e.pointerId !== pointerId) return
    end()
  }

  function onPointerCancel() { end() }

  // ── TouchEvent 兼容入口（保留旧 API 不破坏调用方） ─────────────
  function onStart(e) {
    begin(e.touches?.[0]?.clientY ?? e.clientY, e.currentTarget)
  }
  function onMove(e) {
    move(e.touches?.[0]?.clientY ?? e.clientY, e)
  }
  function onEndCompat() { end() }

  function reset() {
    dy.value = 0
    dragging.value = false
    pointerId = null
    activeEl = null
  }

  return {
    dy,
    dragging,
    // 新 API
    onPointerDown, onPointerMove, onPointerUp, onPointerCancel,
    // 旧 API（兼容）
    onStart, onMove, onEnd: onEndCompat,
    reset
  }
}
