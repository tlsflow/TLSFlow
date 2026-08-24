<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import BusinessResourcePage from '@/views/BusinessResourcePage.vue'
import type { BusinessPageConfig } from '@/views/business-page.types'
import { deleteManagedDeviceAsset, getManagedDevice, listManagedDevices } from '@/api/modules/devices.api'
import { deleteAgent } from '@/api/modules/assets.api'
import DeviceOnboardingWizard from './DeviceOnboardingWizard.vue'
import ManagedDeviceDetailModal from './details/ManagedDeviceDetailModal.vue'
import type { ViewRow } from '@/composables/useBusinessPage'

const { t } = useI18n()
const route = useRoute?.() ?? { query: {} as Record<string, string | string[] | undefined> }
const filters = ref<Record<string, string>>({})
const onboardingOpen = ref(false)
const reloadKey = ref(0)
const deviceDetailModal = ref<{ open: (deviceId: string) => Promise<void> } | null>(null)

async function openDetail(row: ViewRow) {
  await deviceDetailModal.value?.open(row.id)
}

onMounted(() => {
  const deviceId = typeof route.query.deviceId === 'string' ? route.query.deviceId : ''
  if (route.query.detailModal === '1' && deviceId) {
    void deviceDetailModal.value?.open(deviceId)
  }
})

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
  moduleName: 'devices',
  resourceName: t('devices.page.title'),
  defaultStatus: 'UNKNOWN',
  defaultRisk: 'MEDIUM',
  showHeader: false,
  showMetrics: false,
  showDetailPanel: false,
  showActionPanel: false,
  tableFixed: true,
  columns: [
    { key: 'name', title: t('devices.columns.name'), candidates: ['displayName', 'id'], width: '13%' },
    { key: 'category', title: t('devices.columns.category'), candidates: ['category'], width: '8%' },
    { key: 'productFamily', title: t('devices.columns.productFamily'), candidates: ['productFamily'], width: '11%' },
    { key: 'managementMethod', title: t('devices.columns.managementMethod'), candidates: ['managementMethod'], width: '10%' },
    { key: 'managementAddress', title: t('devices.columns.managementAddress'), candidates: ['managementAddress'], width: '13%' },
    { key: 'status', title: t('devices.columns.liveness'), candidates: ['livenessStatus', 'health', 'sourceStatus'], kind: 'status', width: '8%' },
    { key: 'deviceVersion', title: t('devices.columns.deviceVersion'), candidates: ['softwareVersion'], width: '8%' },
    { key: 'controlVersion', title: t('devices.columns.controlVersion'), candidates: ['controlVersion'], width: '8%' },
    { key: 'applicationAssetCount', title: t('devices.columns.applications'), candidates: ['applicationAssetCount'], kind: 'count', width: '6%' },
    { key: 'lastSeenAt', title: t('devices.columns.lastContact'), candidates: ['lastContactAt'], kind: 'date', width: '8%' },
    { key: 'actions', title: t('devices.columns.actions'), candidates: [], width: '7%' },
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
  <section class="gc-page devices-page">
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
