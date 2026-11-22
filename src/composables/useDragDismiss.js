import { ref } from 'vue'

export function useDragDismiss(getEl, onDismiss, { threshold = 80, vThreshold = 0.5 } = {}) {
  const dy = ref(0)
  const dragging = ref(false)
  let startY = 0, lastY = 0, lastT = 0, lastV = 0

  function onStart(e) {
    startY = e.touches[0].clientY
    lastY = startY
    lastT = Date.now()
    lastV = 0
    dragging.value = true
  }

  function onMove(e) {
    if (!dragging.value) return
    const y = e.touches[0].clientY
    const d = y - startY
    dy.value = d > 0 ? d : Math.round(d / 5)
    const now = Date.now()
    if (now - lastT > 40) {
      lastV = (y - lastY) / Math.max(now - lastT, 1)
      lastT = now
      lastY = y
    }
    e.preventDefault()
  }

  function onEnd() {
    if (!dragging.value) return
    dragging.value = false
    const h = getEl()?.offsetHeight || 500
    if (dy.value > threshold || lastV > vThreshold) {
      dy.value = h
      onDismiss()
    } else {
      requestAnimationFrame(() => { dy.value = 0 })
    }
  }

  function reset() { dy.value = 0 }

  return { dy, dragging, onStart, onMove, onEnd, reset }
}
