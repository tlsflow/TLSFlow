<script setup lang="ts">
import type { ApiRecord } from '@/api/modules/common'

defineProps<{
  capability?: ApiRecord | null
  loading?: boolean
  labels: { loading: string; missing: string; source: string; plugin: string; runtime: string; executionLocation: string }
}>()
</script>

<template>
  <section class="gc-effective-capability-card">
    <p v-if="loading">{{ labels.loading }}</p>
    <p v-else-if="!capability">{{ labels.missing }}</p>
    <dl v-else>
      <div><dt>{{ labels.source }}</dt><dd>{{ String((capability.source as ApiRecord | undefined)?.ownerType ?? '') }}</dd></div>
      <div><dt>{{ labels.plugin }}</dt><dd>{{ String((capability.plugin as ApiRecord | undefined)?.pluginVersionId ?? '') }}</dd></div>
      <div><dt>{{ labels.runtime }}</dt><dd>{{ String((capability.plugin as ApiRecord | undefined)?.runtime ?? '') }}</dd></div>
      <div><dt>{{ labels.executionLocation }}</dt><dd>{{ String(capability.executionLocation ?? '') }}</dd></div>
    </dl>
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
