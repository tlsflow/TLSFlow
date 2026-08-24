<script setup lang="ts">
import type { ApiRecord } from '@/api/modules/common'

defineProps<{
  deviceId: string
  frameworkInstanceId: string
  siteId: string
  managedTargetId: string
  devices: ApiRecord[]
  frameworks: ApiRecord[]
  sites: ApiRecord[]
  managedTargets: ApiRecord[]
  deviceLoading?: boolean
  frameworkLoading?: boolean
  siteLoading?: boolean
  managedTargetLoading?: boolean
  labels: { device: string; framework: string; site: string; managedTarget: string }
  placeholders: { select: string; loading: string; rediscovery: string }
}>()

const emit = defineEmits<{
  'update:deviceId': [value: string]
  'update:frameworkInstanceId': [value: string]
  'update:siteId': [value: string]
  'update:managedTargetId': [value: string]
}>()

function label(item: ApiRecord, candidates: string[]): string {
  for (const key of candidates) {
    const value = item[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return String(item.id ?? '')
}

function siteLabel(site: ApiRecord): string {
  const name = label(site, ['siteName', 'displayName', 'siteKey'])
  const bindingInformation = text(site.bindingInformation)
  const listenIp = text(site.listenIp) || firstAddress(site.metadata)
  const port = site.port === undefined || site.port === null ? '' : String(site.port)
  const protocol = text(site.protocol).toUpperCase()
  const endpoint = bindingInformation || [listenIp, port].filter(Boolean).join(':')
  const detail = [endpoint, protocol].filter(Boolean).join(' / ')
  return detail ? `${name}（${detail}）` : name
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function firstAddress(metadata: unknown): string {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return ''
  const addresses = (metadata as ApiRecord).addresses
  return Array.isArray(addresses) ? text(addresses[0]) : ''
}
</script>

<template>
  <div class="gc-managed-target-selector">
    <label class="gc-managed-target-selector__field">
      <span>{{ labels.device }}</span>
      <select class="gc-native-select" :value="deviceId" :disabled="deviceLoading" @change="emit('update:deviceId', ($event.target as HTMLSelectElement).value)">
        <option value="">{{ deviceLoading ? placeholders.loading : placeholders.select }}</option>
        <option v-for="device in devices" :key="String(device.id)" :value="String(device.id)">{{ label(device, ['displayName', 'hostname', 'primaryIp']) }}</option>
      </select>
    </label>
    <label class="gc-managed-target-selector__field">
      <span>{{ labels.framework }}</span>
      <select class="gc-native-select" :value="frameworkInstanceId" :disabled="frameworkLoading || !deviceId" @change="emit('update:frameworkInstanceId', ($event.target as HTMLSelectElement).value)">
        <option value="">{{ frameworkLoading ? placeholders.loading : placeholders.select }}</option>
        <option v-for="framework in frameworks" :key="String(framework.id)" :value="String(framework.id)">{{ label(framework, ['displayName', 'frameworkKey', 'frameworkType']) }}</option>
      </select>
    </label>
    <label class="gc-managed-target-selector__field">
      <span>{{ labels.site }}</span>
      <select class="gc-native-select" :value="siteId" :disabled="siteLoading || !frameworkInstanceId" @change="emit('update:siteId', ($event.target as HTMLSelectElement).value)">
        <option value="">{{ siteLoading ? placeholders.loading : placeholders.select }}</option>
        <option v-for="site in sites" :key="String(site.id)" :value="String(site.id)">{{ siteLabel(site) }}</option>
      </select>
    </label>
    <label class="gc-managed-target-selector__field">
      <span>{{ labels.managedTarget }}</span>
      <select class="gc-native-select" :value="managedTargetId" :disabled="managedTargetLoading || !siteId" @change="emit('update:managedTargetId', ($event.target as HTMLSelectElement).value)">
        <option value="">{{ managedTargetLoading ? placeholders.loading : placeholders.select }}</option>
        <option v-for="target in managedTargets" :key="String(target.id)" :value="String(target.id)">{{ label(target, ['bindingKey', 'targetKey', 'targetType']) }}</option>
      </select>
      <small v-if="siteId && !managedTargetLoading && managedTargets.length === 0">{{ placeholders.rediscovery }}</small>
    </label>
  </div>
</template>

<style scoped>
.gc-managed-target-selector {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gc-space-4);
}

.gc-managed-target-selector__field {
  display: grid;
  gap: var(--gc-space-2);
}

.gc-managed-target-selector__field span {
  color: var(--gc-color-text-secondary);
  font-size: var(--gc-font-size-sm);
}

.gc-managed-target-selector__field select {
  min-width: 0;
}

.gc-managed-target-selector__field small {
  color: var(--gc-color-warning);
}
</style>
