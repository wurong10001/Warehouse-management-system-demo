<script setup>
import { statusInfo } from '../api/status'
const props = defineProps({ code: String })
</script>

<template>
  <span class="tag" :class="statusInfo(code).tone">
    <svg v-if="statusInfo(code).tone === 'done'" width="12" height="12" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
    {{ statusInfo(code).label }}
  </span>
</template>
