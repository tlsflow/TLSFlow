<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'
import type { DevicePresentationSchema } from './GcPluginForm.types'
import GcDataTable from './GcDataTable.vue'
import GcStatusTag from './GcStatusTag.vue'
import GcTabs from './GcTabs.vue'

const activeTab = defineModel<string>('activeTab', { default: '' })
const props = withDefaults(defineProps<{
  schema: DevicePresentationSchema
  data: Record<string, unknown>
  tabRows?: Record<string, Array<Record<string, unknown>>>
  pluginMessages?: Record<string, string>
}>(), {
  tabRows: () => ({}),
  pluginMessages: () => ({}),
})

const emit = defineEmits<{ action: [capabilityKey: string] }>()
const { t } = useI18n()
const overview = computed(() => Array.isArray(props.schema?.overview) ? props.schema.overview : [])
const actions = computed(() => Array.isArray(props.schema?.actions) ? props.schema.actions : [])
const presentationTabs = computed(() => Array.isArray(props.schema?.tabs) ? props.schema.tabs : [])
const tabs = computed(() => presentationTabs.value.map((tab) => ({ value: tab.id, label: label(tab.titleKey) })))
const selectedTab = computed(() => presentationTabs.value.find((tab) => tab.id === activeTab.value) ?? presentationTabs.value[0])

function label(key: string): string { return props.pluginMessages[key] ?? t(key) }
function read(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => current && typeof current === 'object' && !Array.isArray(current) ? (current as Record<string, unknown>)[key] : undefined, source)
}
function display(value: unknown, type: string, sensitive = false): string {
  if (sensitive && value) return t('plugins.presentation.sensitiveValue')
  if (type === 'timestamp') return formatBrowserLocalTime(value)
  if (Array.isArray(value)) return value.join(', ')
  if (value && typeof value === 'object') return JSON.stringify(value)
  return value === undefined || value === null || value === '' ? '—' : String(value)
}
</script>

<template>
  <section class="gc-device-presentation">
    <article v-for="group in overview" :key="group.id" class="gc-device-presentation__group">
      <h3>{{ label(group.titleKey) }}</h3>
      <dl>
        <div v-for="field in group.fields" :key="field.key">
          <dt>{{ label(field.labelKey) }}</dt>
          <dd v-if="field.type === 'status'"><GcStatusTag :status="String(read(data, field.valuePath) ?? '')" /></dd>
          <dd v-else>{{ display(read(data, field.valuePath), field.type, field.sensitive) }}</dd>
        </div>
      </dl>
    </article>

    <nav v-if="actions.length" class="gc-device-presentation__actions">
      <button v-for="action in actions" :key="action.capabilityKey" class="gc-button" type="button" @click="emit('action', action.capabilityKey)">
        {{ label(action.labelKey) }}
      </button>
    </nav>

    <div v-if="presentationTabs.length" class="gc-device-presentation__tabs">
      <GcTabs v-model="activeTab" :tabs="tabs" :aria-label="t('plugins.presentation.tabsAriaLabel')" />
      <GcDataTable
        v-if="selectedTab"
        :columns="selectedTab.columns.map((column) => ({ key: column.key, title: label(column.labelKey) }))"
        :rows="(tabRows[selectedTab.id] ?? []).map((row, index) => ({
          id: String(row.id ?? index),
          ...Object.fromEntries(selectedTab.columns.map((column) => [column.key, display(read(row, column.valuePath), column.type)])),
        }))"
        dense
      />
    </div>
  </section>
</template>

<style scoped>
.gc-device-presentation { display: grid; gap: var(--gc-space-4); }
.gc-device-presentation__group { padding: var(--gc-space-4); border: var(--gc-space-hairline) solid var(--gc-color-border-soft); border-radius: var(--gc-radius-lg); background: var(--gc-color-surface-glass); box-shadow: var(--gc-shadow-sm); }
.gc-device-presentation__group h3 { margin: 0 0 var(--gc-space-3); }
.gc-device-presentation__group dl { display: grid; grid-template-columns: repeat(auto-fit, minmax(var(--gc-size-card-min), 1fr)); gap: var(--gc-space-3); margin: 0; }
.gc-device-presentation__group dl div { display: grid; gap: var(--gc-space-1); }
.gc-device-presentation__group dt { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); }
.gc-device-presentation__group dd { margin: 0; overflow-wrap: anywhere; }
.gc-device-presentation__actions { display: flex; flex-wrap: wrap; gap: var(--gc-space-2); }
.gc-device-presentation__tabs { display: grid; gap: var(--gc-space-3); }
</style>
