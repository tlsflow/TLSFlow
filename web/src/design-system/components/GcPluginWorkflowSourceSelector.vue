<script setup lang="ts">
import { computed } from 'vue'
import type { ApiRecord } from '@/api/modules/common'
import type { StatusTone } from '@/design-system/status/status-map'

const props = defineProps<{
  modelValue: string
  items: readonly ApiRecord[]
  loading?: boolean
  labels: {
    loading: string
    empty: string
    deploy: string
    rollback: string
    version: string
    workflowVersion: string
  }
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

interface PluginWorkflowSourceGroup {
  pluginVersionId: string
  item: ApiRecord
  capabilities: ApiRecord[]
}

const groups = computed<PluginWorkflowSourceGroup[]>(() => {
  const grouped = new Map<string, PluginWorkflowSourceGroup>()
  for (const item of props.items) {
    const pluginVersionId = String(item.pluginVersionId ?? '')
    if (!pluginVersionId) continue
    const current = grouped.get(pluginVersionId)
    if (current) {
      current.capabilities.push(item)
      continue
    }
    grouped.set(pluginVersionId, { pluginVersionId, item, capabilities: [item] })
  }
  return [...grouped.values()]
})

function sourceId(item: ApiRecord): string {
  return sourceIdFor(item, String(item.capabilityKey ?? ''))
}

function sourceIdFor(item: ApiRecord, capabilityKey: string): string {
  return `${String(item.pluginVersionId ?? '')}:${capabilityKey}`
}

function capabilityLabel(capabilityKey: unknown): string {
  return capabilityKey === 'certificate.rollback' ? props.labels.rollback : props.labels.deploy
}

function sourceTone(item: ApiRecord): StatusTone {
  return item.capabilityKey === 'certificate.rollback' ? 'warning' : 'info'
}
</script>

<template>
  <div class="gc-plugin-workflow-source-selector">
    <p v-if="loading">{{ labels.loading }}</p>
    <p v-else-if="!items.length">{{ labels.empty }}</p>
    <div
      v-for="group in groups"
      v-else
      :key="group.pluginVersionId"
      class="gc-plugin-workflow-source-selector__item"
      :data-selected="group.capabilities.some((item) => modelValue === sourceId(item)) ? 'true' : 'false'"
      :data-tone="sourceTone(group.capabilities[0]!)"
    >
      <span>
        <strong>{{ String(group.item.displayName ?? group.item.pluginId ?? group.pluginVersionId) }}</strong>
        <small>{{ labels.version }} {{ String(group.item.pluginVersion ?? group.pluginVersionId) }}</small>
        <small v-if="group.item.workflowVersion !== undefined">{{ labels.workflowVersion }} {{ String(group.item.workflowVersion) }}</small>
      </span>
      <span class="gc-plugin-workflow-source-selector__capabilities">
        <label
          v-for="item in group.capabilities"
          :key="sourceId(item)"
          class="gc-plugin-workflow-source-selector__capability"
          :data-selected="modelValue === sourceId(item) ? 'true' : 'false'"
          :data-tone="sourceTone(item)"
        >
          <input type="radio" :value="sourceId(item)" :checked="modelValue === sourceId(item)" @change="emit('update:modelValue', sourceIdFor(item, String(item.capabilityKey ?? '')))" />
          <span>{{ capabilityLabel(item.capabilityKey) }}</span>
        </label>
      </span>
    </div>
  </div>
</template>

<style scoped>
.gc-plugin-workflow-source-selector {
  display: grid;
  gap: var(--gc-space-3);
}

.gc-plugin-workflow-source-selector__item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--gc-space-3);
  padding: var(--gc-space-3);
  border: var(--gc-border-width) solid var(--gc-color-border);
  border-radius: var(--gc-radius-md);
  background: var(--gc-color-surface-subtle);
  cursor: pointer;
}

.gc-plugin-workflow-source-selector__capabilities {
  display: inline-flex;
  align-items: center;
  gap: var(--gc-space-1);
  flex-wrap: wrap;
  justify-content: flex-end;
}

.gc-plugin-workflow-source-selector__capability {
  display: inline-flex;
  align-items: center;
  gap: var(--gc-space-1);
  min-height: var(--gc-control-height-sm);
  padding: 0 var(--gc-space-2);
  border: var(--gc-border-width) solid var(--gc-color-border-muted);
  border-radius: var(--gc-radius-sm);
  background: var(--gc-color-surface-solid);
  color: var(--gc-color-text-muted);
  cursor: pointer;
}

.gc-plugin-workflow-source-selector__capability[data-selected='true'] {
  border-color: var(--gc-color-primary-border);
  background: var(--gc-color-primary-soft);
  color: var(--gc-color-primary-strong);
}

.gc-plugin-workflow-source-selector__capability input {
  margin: 0;
}

.gc-plugin-workflow-source-selector__item[data-selected='true'][data-tone='info'] {
  border-color: var(--gc-color-info-border);
  background: var(--gc-color-info-soft);
}

.gc-plugin-workflow-source-selector__item[data-selected='true'][data-tone='warning'] {
  border-color: var(--gc-color-warning-border);
  background: var(--gc-color-warning-soft);
}

.gc-plugin-workflow-source-selector__item span {
  display: grid;
  gap: var(--gc-space-1);
}

.gc-plugin-workflow-source-selector__item small {
  color: var(--gc-color-text-muted);
}

@media (max-width: 640px) {
  .gc-plugin-workflow-source-selector__item {
    grid-template-columns: 1fr;
  }

  .gc-plugin-workflow-source-selector__capabilities {
    justify-content: flex-start;
  }
}
</style>
