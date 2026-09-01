<script setup lang="ts">
import type { ApiRecord } from '@/api/modules/common'

defineProps<{
  deviceId: string
  serviceAssetId: string
  frameworkInstanceId: string
  siteId: string
  managedTargetId: string
  devices: ApiRecord[]
  serviceAssets: ApiRecord[]
  frameworks: ApiRecord[]
  sites: ApiRecord[]
  managedTargets: ApiRecord[]
  deviceLoading?: boolean
  serviceAssetLoading?: boolean
  frameworkLoading?: boolean
  siteLoading?: boolean
  managedTargetLoading?: boolean
  labels: { device: string; framework: string; site: string; managedTarget: string }
  placeholders: { select: string; loading: string; rediscovery: string }
}>()

const emit = defineEmits<{
  'update:deviceId': [value: string]
  'update:serviceAssetId': [value: string]
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

function resourceId(item: ApiRecord): string {
  const ref = item.assetRef ?? item.asset_ref
  const refId = ref && typeof ref === 'object' && !Array.isArray(ref)
    ? (ref as ApiRecord).id ?? (ref as ApiRecord).assetId
    : undefined
  return String(item.id ?? item.assetId ?? item.asset_id ?? refId ?? '')
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

function resourceValue(item: ApiRecord, kind: 'DEVICE' | 'SERVICE_ASSET'): string {
  return `${kind}:${resourceId(item)}`
}

function handleResourceChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  if (value.startsWith('SERVICE_ASSET:')) {
    emit('update:deviceId', '')
    emit('update:serviceAssetId', value.slice('SERVICE_ASSET:'.length))
    return
  }
  if (value.startsWith('DEVICE:')) {
    emit('update:serviceAssetId', '')
    emit('update:deviceId', value.slice('DEVICE:'.length))
    return
  }
  emit('update:deviceId', '')
  emit('update:serviceAssetId', '')
}
</script>

<template>
  <div class="gc-managed-target-selector">
    <label class="gc-managed-target-selector__field">
      <span>{{ labels.device }}</span>
      <select
        class="gc-native-select"
        :value="serviceAssetId ? resourceValue({ id: serviceAssetId }, 'SERVICE_ASSET') : deviceId ? resourceValue({ id: deviceId }, 'DEVICE') : ''"
        :disabled="deviceLoading || serviceAssetLoading"
        @change="handleResourceChange"
      >
        <option value="">{{ deviceLoading || serviceAssetLoading ? placeholders.loading : placeholders.select }}</option>
        <option v-for="device in devices" :key="resourceValue(device, 'DEVICE')" :value="resourceValue(device, 'DEVICE')">{{ label(device, ['displayName', 'display_name', 'hostname', 'primaryIp', 'primary_ip']) }}</option>
        <option v-for="serviceAsset in serviceAssets" :key="resourceValue(serviceAsset, 'SERVICE_ASSET')" :value="resourceValue(serviceAsset, 'SERVICE_ASSET')">{{ label(serviceAsset, ['displayName', 'display_name', 'name', 'address', 'providerKey', 'provider_key']) }}</option>
      </select>
    </label>
    <label class="gc-managed-target-selector__field">
      <span>{{ labels.framework }}</span>
      <select class="gc-native-select" :value="frameworkInstanceId" :disabled="frameworkLoading || (!deviceId && !serviceAssetId)" @change="emit('update:frameworkInstanceId', ($event.target as HTMLSelectElement).value)">
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
