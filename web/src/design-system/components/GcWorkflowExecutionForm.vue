<script setup lang="ts">
import type { ApiRecord } from '@/api/modules/common'

defineProps<{
  workflowId: string
  versionSelection: 'PINNED' | 'LATEST_PUBLISHED'
  workflowVersionId: string
  runner: 'CONTROL_PLANE' | 'GATEWAY'
  gatewayId: string
  workflows: readonly ApiRecord[]
  versions: readonly ApiRecord[]
  gateways: readonly ApiRecord[]
  workflowLoading?: boolean
  versionLoading?: boolean
  gatewayLoading?: boolean
  labels: {
    workflow: string
    workflowPlaceholder: string
    versionSelection: string
    pinned: string
    latestPublished: string
    version: string
    versionPlaceholder: string
    runner: string
    controlPlane: string
    gateway: string
    gatewayPlaceholder: string
  }
}>()

const emit = defineEmits<{
  'update:workflowId': [value: string]
  'update:versionSelection': [value: 'PINNED' | 'LATEST_PUBLISHED']
  'update:workflowVersionId': [value: string]
  'update:runner': [value: 'CONTROL_PLANE' | 'GATEWAY']
  'update:gatewayId': [value: string]
}>()

function recordText(record: ApiRecord, keys: readonly string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number') return String(value)
  }
  return ''
}
</script>

<template>
  <div class="gc-workflow-execution-form">
    <label>
      <span>{{ labels.workflow }}</span>
      <select :value="workflowId" :disabled="workflowLoading" @change="emit('update:workflowId', ($event.target as HTMLSelectElement).value)">
        <option value="">{{ labels.workflowPlaceholder }}</option>
        <option v-for="workflow in workflows" :key="String(workflow.id)" :value="String(workflow.id)">
          {{ recordText(workflow, ['name', 'displayName', 'id']) }}
        </option>
      </select>
    </label>
    <label>
      <span>{{ labels.versionSelection }}</span>
      <select :value="versionSelection" :disabled="!workflowId" @change="emit('update:versionSelection', ($event.target as HTMLSelectElement).value as 'PINNED' | 'LATEST_PUBLISHED')">
        <option value="PINNED">{{ labels.pinned }}</option>
        <option value="LATEST_PUBLISHED">{{ labels.latestPublished }}</option>
      </select>
    </label>
    <label v-if="versionSelection === 'PINNED'">
      <span>{{ labels.version }}</span>
      <select :value="workflowVersionId" :disabled="versionLoading || !workflowId" @change="emit('update:workflowVersionId', ($event.target as HTMLSelectElement).value)">
        <option value="">{{ labels.versionPlaceholder }}</option>
        <option v-for="version in versions" :key="String(version.id)" :value="String(version.id)">
          {{ recordText(version, ['versionNumber', 'version', 'id']) }}
        </option>
      </select>
    </label>
    <label>
      <span>{{ labels.runner }}</span>
      <select :value="runner" @change="emit('update:runner', ($event.target as HTMLSelectElement).value as 'CONTROL_PLANE' | 'GATEWAY')">
        <option value="CONTROL_PLANE">{{ labels.controlPlane }}</option>
        <option value="GATEWAY">{{ labels.gateway }}</option>
      </select>
    </label>
    <label v-if="runner === 'GATEWAY'">
      <span>{{ labels.gateway }}</span>
      <select :value="gatewayId" :disabled="gatewayLoading" @change="emit('update:gatewayId', ($event.target as HTMLSelectElement).value)">
        <option value="">{{ labels.gatewayPlaceholder }}</option>
        <option v-for="gateway in gateways" :key="String(gateway.id)" :value="String(gateway.id)">
          {{ recordText(gateway, ['name', 'displayName', 'id']) }}
        </option>
      </select>
    </label>
  </div>
</template>

<style scoped>
.gc-workflow-execution-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gc-space-3);
}

.gc-workflow-execution-form label {
  display: grid;
  gap: var(--gc-space-2);
}

.gc-workflow-execution-form span {
  color: var(--gc-color-text-secondary);
  font-size: var(--gc-font-size-sm);
}
</style>
