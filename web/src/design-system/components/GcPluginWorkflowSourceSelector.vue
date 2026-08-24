<script setup lang="ts">
import { computed, ref, watch } from 'vue'
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
  }
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

interface PluginWorkflowSourceWorkflowGroup {
  workflowKey: string
  workflowName: string
  workflowDisplayName: string
  pluginDisplayName: string
  capabilities: Array<'certificate.deploy' | 'certificate.rollback'>
  items: ApiRecord[]
}

const groups = computed<PluginWorkflowSourceWorkflowGroup[]>(() => {
  const grouped = new Map<string, PluginWorkflowSourceWorkflowGroup>()
  for (const item of props.items) {
    const workflowKey = workflowGroupKey(item)
    const workflowName = String(item.workflowName ?? item.displayName ?? item.pluginId ?? workflowKey)
    const workflowDisplayName = String(item.workflowDisplayName ?? item.displayName ?? workflowName)
    const pluginDisplayName = String(item.displayName ?? item.pluginId ?? '')
    const capabilityKey = normalizeCapabilityKey(item.capabilityKey)
    const current = grouped.get(workflowKey)
    if (!current) {
      grouped.set(workflowKey, {
        workflowKey,
        workflowName,
        workflowDisplayName,
        pluginDisplayName,
        capabilities: capabilityKey ? [capabilityKey] : [],
        items: [],
      })
    } else if (capabilityKey && !current.capabilities.includes(capabilityKey)) {
      current.capabilities.push(capabilityKey)
    }
    const group = grouped.get(workflowKey)!
    if (String(item.pluginVersionId ?? '')) group.items.push(item)
  }
  return [...grouped.values()]
    .map((group) => ({
      ...group,
      capabilities: [...group.capabilities].sort(compareCapabilityKeys),
      items: [...group.items].sort(compareItems),
    }))
    .sort((left, right) =>
      left.workflowDisplayName.localeCompare(right.workflowDisplayName)
      || left.workflowName.localeCompare(right.workflowName)
      || left.workflowKey.localeCompare(right.workflowKey),
    )
})

const selectedWorkflowKey = ref('')
const expandedWorkflowKey = ref('')

watch(
  () => [props.modelValue, props.items] as const,
  () => {
    const selected = findItemBySourceId(props.items, props.modelValue)
    if (selected) {
      selectedWorkflowKey.value = workflowGroupKey(selected)
      expandedWorkflowKey.value = workflowGroupKey(selected)
      return
    }
    selectedWorkflowKey.value = ''
    if (expandedWorkflowKey.value && groups.value.some((group) => group.workflowKey === expandedWorkflowKey.value)) return
    expandedWorkflowKey.value = ''
  },
  { immediate: true, deep: true },
)

function workflowGroupKey(item: ApiRecord): string {
  const pluginId = String(item.pluginId ?? '')
  const resourcePath = String(item.workflowResourcePath ?? '')
  if (pluginId && resourcePath) return `${pluginId}:${resourcePath}`
  const workflowName = String(item.workflowName ?? item.displayName ?? '')
  return `${pluginId}:${workflowName}`
}

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

function normalizeCapabilityKey(value: unknown): 'certificate.deploy' | 'certificate.rollback' | null {
  return value === 'certificate.rollback' || value === 'certificate.deploy' ? value : null
}

function compareCapabilityKeys(left: 'certificate.deploy' | 'certificate.rollback', right: 'certificate.deploy' | 'certificate.rollback'): number {
  const order = new Map([
    ['certificate.deploy', 0],
    ['certificate.rollback', 1],
  ] as const)
  return (order.get(left) ?? 99) - (order.get(right) ?? 99)
}

function compareItems(left: ApiRecord, right: ApiRecord): number {
  return compareCapabilityKeys(normalizeCapabilityKey(left.capabilityKey) ?? 'certificate.deploy', normalizeCapabilityKey(right.capabilityKey) ?? 'certificate.deploy')
    || sourceId(left).localeCompare(sourceId(right))
}

function findItemBySourceId(items: readonly ApiRecord[], value: string): ApiRecord | undefined {
  return items.find((item) => sourceId(item) === value)
}

function toggleWorkflow(group: PluginWorkflowSourceWorkflowGroup) {
  expandedWorkflowKey.value = expandedWorkflowKey.value === group.workflowKey ? '' : group.workflowKey
}

function selectCapability(group: PluginWorkflowSourceWorkflowGroup, item: ApiRecord) {
  selectedWorkflowKey.value = group.workflowKey
  expandedWorkflowKey.value = group.workflowKey
  emit('update:modelValue', sourceId(item))
}

function workflowSelected(group: PluginWorkflowSourceWorkflowGroup): boolean {
  return selectedWorkflowKey.value === group.workflowKey
}

function workflowExpanded(group: PluginWorkflowSourceWorkflowGroup): boolean {
  return expandedWorkflowKey.value === group.workflowKey
}

</script>

<template>
  <div class="gc-plugin-workflow-source-selector">
    <p v-if="loading">{{ labels.loading }}</p>
    <p v-else-if="!items.length">{{ labels.empty }}</p>
    <div
      v-for="group in groups"
      v-else
      :key="group.workflowKey"
      class="gc-plugin-workflow-source-selector__workflow"
      :data-selected="workflowSelected(group) ? 'true' : 'false'"
    >
      <button
        class="gc-plugin-workflow-source-selector__workflow-head"
        type="button"
        :aria-pressed="workflowSelected(group)"
        :aria-expanded="workflowExpanded(group)"
        @click="toggleWorkflow(group)"
      >
        <span class="gc-plugin-workflow-source-selector__workflow-copy">
          <strong>{{ group.workflowDisplayName }}</strong>
          <small>{{ group.pluginDisplayName }}</small>
        </span>
        <span class="gc-plugin-workflow-source-selector__workflow-capabilities">
          <span
            v-for="capability in group.capabilities"
            :key="capability"
            class="gc-plugin-workflow-source-selector__capability-chip"
            :data-tone="capability === 'certificate.rollback' ? 'warning' : 'info'"
          >
            {{ capabilityLabel(capability) }}
          </span>
        </span>
      </button>

      <div v-if="workflowExpanded(group)" class="gc-plugin-workflow-source-selector__capabilities">
        <button
          v-for="item in group.items"
          :key="sourceId(item)"
          class="gc-plugin-workflow-source-selector__capability"
          type="button"
          :data-selected="modelValue === sourceId(item) ? 'true' : 'false'"
          :data-tone="sourceTone(item)"
          @click="selectCapability(group, item)"
        >
          {{ capabilityLabel(item.capabilityKey) }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gc-plugin-workflow-source-selector {
  display: grid;
  gap: var(--gc-space-3);
}

.gc-plugin-workflow-source-selector__workflow {
  border: var(--gc-border-width) solid var(--gc-color-border-soft);
  border-radius: var(--gc-radius-md);
  background: var(--gc-color-surface-glass);
  box-shadow: var(--gc-shadow-sm);
  overflow: hidden;
}

.gc-plugin-workflow-source-selector__workflow[data-selected='true'] {
  border-color: var(--gc-color-primary-border);
  box-shadow: var(--gc-shadow-sm);
}

.gc-plugin-workflow-source-selector__workflow-head {
  width: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--gc-space-3);
  padding: var(--gc-space-3);
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.gc-plugin-workflow-source-selector__workflow-copy,
.gc-plugin-workflow-source-selector__workflow-capabilities,
.gc-plugin-workflow-source-selector__capabilities {
  display: flex;
  gap: var(--gc-space-2);
  flex-wrap: wrap;
  align-items: center;
}

.gc-plugin-workflow-source-selector__workflow-copy {
  flex-direction: column;
  align-items: flex-start;
  gap: var(--gc-space-1);
}

.gc-plugin-workflow-source-selector__workflow-copy small {
  color: var(--gc-color-text-muted);
}

.gc-plugin-workflow-source-selector__capability-chip,
.gc-plugin-workflow-source-selector__capability {
  display: inline-flex;
  align-items: center;
  min-height: var(--gc-control-height-sm);
  padding: 0 var(--gc-space-2);
  border: var(--gc-border-width) solid var(--gc-color-border-muted);
  border-radius: var(--gc-radius-sm);
  background: var(--gc-color-surface-solid);
  color: var(--gc-color-text-muted);
}

.gc-plugin-workflow-source-selector__capability-chip[data-tone='info'],
.gc-plugin-workflow-source-selector__capability[data-tone='info'][data-selected='true'] {
  border-color: var(--gc-color-info-border);
}

.gc-plugin-workflow-source-selector__capability-chip[data-tone='warning'],
.gc-plugin-workflow-source-selector__capability[data-tone='warning'][data-selected='true'] {
  border-color: var(--gc-color-warning-border);
}

.gc-plugin-workflow-source-selector__capabilities {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  gap: var(--gc-space-2);
  padding: 0 var(--gc-space-3) var(--gc-space-3);
}

.gc-plugin-workflow-source-selector__capability {
  min-height: var(--gc-control-height-sm);
  border: var(--gc-border-width) solid var(--gc-color-border-muted);
  border-radius: var(--gc-radius-sm);
  background: var(--gc-color-surface-subtle);
  color: var(--gc-color-text-muted);
  padding: 0 var(--gc-space-2);
  cursor: pointer;
}

.gc-plugin-workflow-source-selector__capability[data-selected='true'] {
  background: var(--gc-color-primary-soft);
  color: var(--gc-color-primary-strong);
}

@media (max-width: 40rem) {
  .gc-plugin-workflow-source-selector__workflow-head {
    grid-template-columns: 1fr;
  }
}
</style>
