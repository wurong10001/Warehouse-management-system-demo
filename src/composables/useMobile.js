import { ref, onMounted, onBeforeUnmount } from 'vue'

export function useMobile(query = '(max-width: 820px)') {
  const mq = window.matchMedia(query)
  const isMobile = ref(mq.matches)
  const onChange = (e) => { isMobile.value = e.matches }
  onMounted(() => mq.addEventListener('change', onChange))
  onBeforeUnmount(() => mq.removeEventListener('change', onChange))
  return isMobile
}
