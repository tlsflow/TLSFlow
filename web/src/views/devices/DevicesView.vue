<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import BusinessResourcePage from '@/views/BusinessResourcePage.vue'
import type { BusinessPageConfig } from '@/views/business-page.types'
import { deleteManagedDeviceAsset, getManagedDevice, listManagedDevices } from '@/api/modules/devices.api'
import { deleteAgent } from '@/api/modules/assets.api'
import DeviceOnboardingWizard from './DeviceOnboardingWizard.vue'
import ManagedDeviceDetailModal from './details/ManagedDeviceDetailModal.vue'
import type { ViewRow } from '@/composables/useBusinessPage'

const { t } = useI18n()
const filters = ref<Record<string, string>>({})
const onboardingOpen = ref(false)
const reloadKey = ref(0)
const deviceDetailModal = ref<{ open: (deviceId: string) => Promise<void> } | null>(null)

async function openDetail(row: ViewRow) {
  await deviceDetailModal.value?.open(row.id)
}

async function deleteDevice(row: ViewRow) {
  const response = await getManagedDevice(row.id)
  const extension = (response.data?.extension ?? {}) as Record<string, unknown>
  const extensionSummary = (response.data?.extensionSummary ?? {}) as Record<string, unknown>
  if (extension.type === 'AGENT' || response.data?.extensionType === 'AGENT') {
    const agentId = String(extension.agentId ?? extensionSummary.agentId ?? '')
    if (!agentId) throw new Error(t('devices.errors.deleteTargetMissing'))
    await deleteAgent(agentId)
    return
  }
  const deviceAssetId = String(extension.deviceAssetId ?? extensionSummary.deviceAssetId ?? '')
  if (!deviceAssetId) throw new Error(t('devices.errors.deleteTargetMissing'))
  await deleteManagedDeviceAsset(deviceAssetId)
}

const config = computed<BusinessPageConfig>(() => ({
  title: t('devices.page.title'),
  description: t('devices.page.description'),
  readPermission: 'host.read',
  primaryPermission: 'host.create',
  primaryActionLabel: t('devices.actions.add'),
  primaryAction: () => { onboardingOpen.value = true },
  toolbarPlacement: 'hero-leading',
  moduleName: 'devices',
  resourceName: t('devices.page.title'),
  defaultStatus: 'UNKNOWN',
  defaultRisk: 'MEDIUM',
  showHeader: false,
  showMetrics: false,
  showDetailPanel: false,
  showActionPanel: false,
  columns: [
    { key: 'name', title: t('devices.columns.name'), candidates: ['displayName', 'id'] },
    { key: 'category', title: t('devices.columns.category'), candidates: ['category'] },
    { key: 'productFamily', title: t('devices.columns.productFamily'), candidates: ['productFamily'] },
    { key: 'managementMethod', title: t('devices.columns.managementMethod'), candidates: ['managementMethod'] },
    { key: 'managementAddress', title: t('devices.columns.managementAddress'), candidates: ['managementAddress'] },
    { key: 'status', title: t('devices.columns.liveness'), candidates: ['livenessStatus', 'health', 'sourceStatus'], kind: 'status' },
    { key: 'deviceVersion', title: t('devices.columns.deviceVersion'), candidates: ['softwareVersion'] },
    { key: 'controlVersion', title: t('devices.columns.controlVersion'), candidates: ['controlVersion'] },
    { key: 'applicationAssetCount', title: t('devices.columns.applications'), candidates: ['applicationAssetCount'], kind: 'count' },
    { key: 'lastSeenAt', title: t('devices.columns.lastContact'), candidates: ['lastContactAt'], kind: 'date' },
    { key: 'actions', title: t('devices.columns.actions'), candidates: [] },
  ],
  metrics: [
    { title: t('devices.metrics.total'), description: t('devices.metrics.totalDescription'), status: 'HEALTHY', risk: 'MEDIUM', kind: 'total' },
    { title: t('devices.metrics.abnormal'), description: t('devices.metrics.abnormalDescription'), status: 'UNREACHABLE', risk: 'HIGH' },
  ],
  filters: [
    { key: 'category', label: t('devices.filters.category'), type: 'select', options: [
      { label: t('devices.categories.server'), value: 'SERVER' },
      { label: t('devices.categories.networkAppliance'), value: 'NETWORK_APPLIANCE' },
      { label: t('devices.categories.securityAppliance'), value: 'SECURITY_APPLIANCE' },
    ] },
    { key: 'managementMethod', label: t('devices.filters.managementMethod'), type: 'select', options: [
      { label: t('devices.managementMethods.agent'), value: 'AGENT' },
      { label: t('devices.managementMethods.api'), value: 'API' },
    ] },
    { key: 'health', label: t('devices.filters.health'), type: 'select', options: [
      { label: t('devices.health.healthy'), value: 'HEALTHY' },
      { label: t('devices.health.degraded'), value: 'DEGRADED' },
      { label: t('devices.health.unreachable'), value: 'UNREACHABLE' },
      { label: t('devices.health.disabled'), value: 'DISABLED' },
      { label: t('devices.health.unknown'), value: 'UNKNOWN' },
    ] },
  ],
  filterValues: filters.value,
  onFiltersChange: (next) => { filters.value = next },
  emptyTitle: t('devices.empty.title'),
  emptyDescription: t('devices.empty.description'),
  load: () => {
    void reloadKey.value
    return listManagedDevices({ page: 1, pageSize: 20, sort: 'displayName:asc', filters: filters.value })
  },
  actions: [],
  rowActions: [{
    label: t('devices.actions.detail'), permission: 'host.read', reloadAfterRun: false, run: openDetail,
  }, {
    label: t('devices.actions.delete'), permission: 'host.delete', danger: true, confirmText: 'DELETE',
    riskText: t('devices.detail.deleteImpact'), run: deleteDevice,
  }],
}))
</script>

<template>
  <section class="devices-page">
    <BusinessResourcePage :key="reloadKey" :config="config" />
    <DeviceOnboardingWizard v-model:open="onboardingOpen" @completed="reloadKey += 1" />
    <ManagedDeviceDetailModal ref="deviceDetailModal" />
  </section>
</template>

<style scoped>
.devices-page {
  display: grid;
  gap: var(--gc-space-3);
}
</style>
