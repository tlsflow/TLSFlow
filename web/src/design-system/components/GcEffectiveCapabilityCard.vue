<script setup lang="ts">
import { computed } from 'vue'
import type { ApiRecord } from '@/api/modules/common'

const props = defineProps<{
  capability?: ApiRecord | null
  pendingCapability?: ApiRecord | null
  loading?: boolean
  labels: {
    loading: string
    missing: string
    pending: string
    source: string
    plugin: string
    runtime: string
    executionLocation: string
  }
}>()

const displayedCapability = computed(() => props.pendingCapability ?? props.capability ?? null)
</script>

<template>
  <section class="gc-effective-capability-card">
    <p v-if="loading">{{ labels.loading }}</p>
    <template v-else-if="displayedCapability">
      <p v-if="pendingCapability">{{ labels.pending }}</p>
      <dl>
        <div><dt>{{ labels.source }}</dt><dd>{{ String((displayedCapability.source as ApiRecord | undefined)?.ownerType ?? '') }}</dd></div>
        <div><dt>{{ labels.plugin }}</dt><dd>{{ String((displayedCapability.plugin as ApiRecord | undefined)?.pluginVersionId ?? '') }}</dd></div>
        <div><dt>{{ labels.runtime }}</dt><dd>{{ String((displayedCapability.plugin as ApiRecord | undefined)?.runtime ?? '') }}</dd></div>
        <div><dt>{{ labels.executionLocation }}</dt><dd>{{ String(displayedCapability.executionLocation ?? '') }}</dd></div>
      </dl>
    </template>
    <p v-else>{{ labels.missing }}</p>
  </section>
</template>

<style scoped>
.gc-effective-capability-card {
  padding: var(--gc-space-4);
  border: var(--gc-border-width) solid var(--gc-color-border);
  border-radius: var(--gc-radius-md);
  background: var(--gc-color-surface-subtle);
}

.gc-effective-capability-card dl,
.gc-effective-capability-card div {
  display: grid;
  gap: var(--gc-space-2);
}

.gc-effective-capability-card div {
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
}

.gc-effective-capability-card dt {
  color: var(--gc-color-text-muted);
}

.gc-effective-capability-card dd {
  margin: 0;
}
</style>
