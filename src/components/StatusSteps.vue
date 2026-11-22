<script setup>
import { computed } from 'vue'
import { statusInfo } from '../api/status'

const props = defineProps({ kind: String, status: String })

const FLOWS = {
  inbound: ['draft', 'pending_qc', 'qc_ing', 'pending_shelf', 'completed'],
  outbound: ['pending_review', 'pending_pick', 'pending_check', 'completed'],
  delivery: ['pending_review', 'pending_ship', 'shipped', 'in_transit', 'signed'],
  quality: ['pending_qc', 'qc_ing', 'completed'],
  stocktake: ['pending_count', 'counting', 'pending_review', 'completed']
}
const ABNORMAL = { cancelled: '已取消', rejected: '已驳回', exception: '异常' }

const abnormal = computed(() => ABNORMAL[props.status] || null)
const steps = computed(() => FLOWS[props.kind] || [])
const idx = computed(() => {
  let s = props.status
  if (s === 'partial_signed') s = 'signed'
  return steps.value.indexOf(s)
})
</script>

<template>
  <div v-if="abnormal" class="tag abnormal">流程终止 · {{ abnormal }}</div>
  <div v-else-if="steps.length && idx >= 0" class="steps">
    <div v-for="(s, i) in steps" :key="s" class="step" :class="{ done: i < idx, cur: i === idx, todo: i > idx }">
      <span class="dot">
        <svg v-if="i < idx" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
      </span>
      <span class="lbl">{{ statusInfo(s).label }}</span>
    </div>
  </div>
</template>

<style scoped>
.steps { display: flex; align-items: flex-start; gap: 0; }
.step { flex: 1; display: flex; flex-direction: column; align-items: center; position: relative; min-width: 0; }
.dot {
  width: 18px; height: 18px; border-radius: 50%;
  display: grid; place-items: center; z-index: 1;
  background: var(--surface); border: 2px solid var(--faint); color: var(--text-2);
}
.step.done .dot { border-color: var(--text-3); background: var(--text-3); color: #fff; }
.step.cur .dot { border-color: var(--accent); background: var(--accent); }
.lbl { font-size: 11px; margin-top: 5px; color: var(--text-3); white-space: nowrap; }
.step.cur .lbl { color: var(--accent-link); font-weight: 600; }
.step.done .lbl { color: var(--text-2); }
.step:not(:first-child)::before {
  content: ''; position: absolute; top: 8px; right: 50%; width: 100%; height: 2px;
  background: var(--faint); margin-right: 9px; z-index: 0;
}
.step.done:not(:first-child)::before, .step.cur:not(:first-child)::before { background: var(--text-3); }
</style>
