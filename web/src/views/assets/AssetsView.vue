<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import BusinessResourcePage from '@/views/BusinessResourcePage.vue'
import type { BusinessPageConfig } from '@/views/business-page.types'
import { deleteManagedDeviceAsset, getManagedDevice, listManagedDevices } from '@/api/modules/devices.api'
import { checkAgentUpgrade, deleteAgent, dispatchAgentUpgrade, listCloudServiceAssets } from '@/api/modules/assets.api'
import { GcButton, GcModal, GcStatusTag } from '@/design-system/components'
import DeviceOnboardingWizard from '@/views/devices/DeviceOnboardingWizard.vue'
import DeviceAssetEditModal from '@/views/devices/DeviceAssetEditModal.vue'
import ManagedDeviceDetailModal from '@/views/devices/details/ManagedDeviceDetailModal.vue'
import { readString, type ViewRow } from '@/composables/useBusinessPage'

const PRODUCT_FAMILY_LABEL_KEYS: Readonly<Record<string, string>> = {
  'agent_host': 'devices.products.agentHost',
  'windows_compatibility': 'devices.products.windowsCompatibility',
  'device.chaitin-safeline-waf': 'devices.products.chaitinSafelineWaf',
  'device.f5.bigip': 'devices.products.f5BigIp',
  'device.synology-dsm': 'devices.products.synologyDsm',
  'device.nginx-proxy-manager': 'devices.products.nginxProxyManager',
  'citrix.netscaler-adc': 'devices.products.citrixAdc',
  'device.citrix.netscaler-adc': 'devices.products.citrixAdc',
  'cloud.aliyun': 'devices.products.aliyunCdn',
  'cloud.aliyun.cdn': 'devices.products.aliyunCdn',
}

const { t } = useI18n()
const route = useRoute?.() ?? { query: {} as Record<string, string | string[] | undefined> }
const filters = ref<Record<string, string>>({
  category: readQueryString('category'),
  managementMethod: readQueryString('managementMethod'),
  health: readQueryString('health'),
})
const onboardingOpen = ref(false)
const editOpen = ref(false)
const editDeviceId = ref('')
const reloadKey = ref(0)
const deviceDetailModal = ref<{ open: (deviceId: string) => Promise<void> } | null>(null)
const upgradingAgentId = ref('')
const upgradeConfirmationOpen = ref(false)
const upgradeConfirmationBusy = ref(false)
const upgradeConfirmationError = ref('')
const upgradeConfirmation = ref<{
  agentId: string
  planId: string
  currentVersion: string
  targetVersion: string
  displayName: string
} | null>(null)

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function readQueryString(key: string): string {
  const value = route.query[key]
  return typeof value === 'string' ? value : ''
}

async function loadUnifiedAssets() {
  const devicesQuery = { page: 1, pageSize: 200, sort: 'displayName:asc' as const }
  const cloudAssetsQuery = { page: 1, pageSize: 200, sort: 'updatedAt:desc' as const }
  const [devicesResult, cloudAssetsResult] = await Promise.all([
    listManagedDevices({ ...devicesQuery, filters: filters.value }),
    listCloudServiceAssets(cloudAssetsQuery),
  ])
  const devicesPage = devicesResult.data ?? { items: [], page: 1, pageSize: 200, total: 0 }
  const cloudAssetsPage = cloudAssetsResult.data ?? { items: [], page: 1, pageSize: 200, total: 0 }
  const cloudAssets = cloudAssetsPage.items
    .map(normalizeCloudServiceAsset)
    .filter((asset) => matchesCloudServiceFilters(asset, filters.value))
  const items = [...devicesPage.items, ...cloudAssets]
  items.sort((left, right) => String(left.displayName ?? left.name ?? '').localeCompare(String(right.displayName ?? right.name ?? '')))
  return {
    ...devicesResult,
    data: {
      items,
      page: 1,
      pageSize: items.length || 1,
      total: items.length,
    },
  }
}

function matchesCloudServiceFilters(asset: Record<string, unknown>, activeFilters: Record<string, string>): boolean {
  const category = activeFilters.category?.trim().toUpperCase()
  if (category && category !== 'CLOUD') return false
  const managementMethod = activeFilters.managementMethod?.trim().toUpperCase()
  if (managementMethod && managementMethod !== 'PLUGIN') return false
  const health = activeFilters.health?.trim().toUpperCase()
  if (health && health !== String(asset.health ?? '').toUpperCase()) return false
  return true
}

function isCloudServiceRow(row: ViewRow): boolean {
  return String(row.raw.assetKind ?? '').toUpperCase() === 'CLOUD_SERVICE'
}

function normalizeCloudServiceAsset(asset: Record<string, unknown>): Record<string, unknown> {
  const metadata = asRecord(asset.metadata)
  const pluginVersion = String(metadata.pluginVersion ?? asset.pluginVersion ?? '').trim()
  const status = String(asset.status ?? '').toUpperCase()
  return {
    ...asset,
    displayName: asset.displayName ?? asset.name ?? asset.id,
    category: 'CLOUD',
    productFamily: metadata.productFamily ?? metadata.pluginId ?? 'cloud.service',
    managementMethod: 'PLUGIN',
    managementAddress: asset.address,
    livenessStatus: status === 'ACTIVE' ? 'ONLINE' : status === 'DELETED' ? 'OFFLINE' : 'UNKNOWN',
    health: status === 'ACTIVE' ? 'HEALTHY' : 'UNKNOWN',
    sourceStatus: status,
    softwareVersion: '-',
    controlVersion: pluginVersion || '-',
    applicationAssetCount: 0,
  }
}

async function openDetail(row: ViewRow) {
  if (isCloudServiceRow(row)) return
  await deviceDetailModal.value?.open(row.id)
}

function openEdit(row: ViewRow): void {
  editDeviceId.value = row.id
  editOpen.value = true
}

onMounted(() => {
  const deviceId = typeof route.query.deviceId === 'string' ? route.query.deviceId : ''
  if (route.query.detailModal === '1' && deviceId) {
    void deviceDetailModal.value?.open(deviceId)
  }
})

async function deleteDevice(row: ViewRow) {
  if (isCloudServiceRow(row)) return
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

async function upgradeAgent(row: ViewRow) {
  if (isCloudServiceRow(row)) return
  if (upgradingAgentId.value || upgradeConfirmationOpen.value) return
  const agentId = String(row.raw.agentId ?? '').trim()
  if (!agentId) throw new Error(t('devices.errors.upgradeTargetMissing'))
  upgradingAgentId.value = agentId
  try {
    const planResponse = await checkAgentUpgrade(agentId)
    const plan = asRecord(planResponse.data)
    if (String(plan.status ?? '').toLowerCase() === 'not_required') {
      throw new Error(t('devices.errors.upgradeNotRequired'))
    }
    const planId = String(plan.id ?? '').trim()
    if (!planId) throw new Error(t('devices.errors.upgradePlanMissing'))
    const currentVersion = String(plan.currentVersion ?? row.controlVersion ?? row.raw.controlVersion ?? t('devices.upgrade.values.unknownVersion'))
    const targetVersion = String(plan.targetVersion ?? '').trim()
    if (!targetVersion) throw new Error(t('devices.errors.upgradeTargetVersionMissing'))
    upgradeConfirmationError.value = ''
    upgradeConfirmation.value = {
      agentId,
      planId,
      currentVersion,
      targetVersion,
      displayName: String(row.raw.displayName ?? row.raw.name ?? row.id),
    }
    upgradeConfirmationOpen.value = true
  } finally {
    upgradingAgentId.value = ''
  }
}

async function confirmAgentUpgrade(): Promise<void> {
  const confirmation = upgradeConfirmation.value
  if (!confirmation || upgradeConfirmationBusy.value) return
  upgradeConfirmationBusy.value = true
  upgradeConfirmationError.value = ''
  try {
    await dispatchAgentUpgrade(confirmation.agentId, confirmation.planId)
    upgradeConfirmationOpen.value = false
    upgradeConfirmation.value = null
    reloadKey.value += 1
  } catch (error) {
    upgradeConfirmationError.value = error instanceof Error ? error.message : t('devices.errors.upgradeDispatchFailed')
  } finally {
    upgradeConfirmationBusy.value = false
  }
}

function closeUpgradeConfirmation(): void {
  if (upgradeConfirmationBusy.value) return
  upgradeConfirmationOpen.value = false
  upgradeConfirmation.value = null
  upgradeConfirmationError.value = ''
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
  resourceListLabel: t('devices.page.inventory'),
  defaultStatus: 'UNKNOWN',
  defaultRisk: 'MEDIUM',
  showHeader: false,
  showMetrics: false,
  showDetailPanel: false,
  showActionPanel: false,
  tableFixed: true,
  clientSidePagination: true,
  showTotalInPagination: true,
  columns: [
    { key: 'name', title: t('devices.columns.name'), candidates: ['displayName', 'id'], width: '12%' },
    {
      key: 'category',
      title: t('devices.columns.category'),
      candidates: ['category'],
      format: (record) => {
        const category = String(record.category ?? '').toUpperCase()
        const categoryKeys: Readonly<Record<string, string>> = {
          SERVER: 'devices.categories.server',
          NETWORK_APPLIANCE: 'devices.categories.networkAppliance',
          SECURITY_APPLIANCE: 'devices.categories.securityAppliance',
          CLOUD: 'devices.categories.cloud',
          APPLIANCE: 'devices.categories.appliance',
        }
        const labelKey = categoryKeys[category]
        return labelKey ? t(labelKey) : readString(record, ['category'])
      },
      width: '8%',
    },
    {
      key: 'productFamily',
      title: t('devices.columns.productFamily'),
      candidates: ['productFamily'],
      format: (record) => {
        const productFamily = readString(record, ['productFamily'])
        const labelKey = PRODUCT_FAMILY_LABEL_KEYS[productFamily.trim().toLowerCase()]
        return labelKey ? t(labelKey) : productFamily
      },
      width: '11%',
    },
    {
      key: 'managementMethod',
      title: t('devices.columns.managementMethod'),
      candidates: ['managementMethod'],
      format: (record) => {
        const managementMethod = String(record.managementMethod ?? '').toUpperCase()
        if (managementMethod === 'AGENT') return t('devices.managementMethods.agent')
        if (managementMethod === 'PLUGIN') return t('devices.managementMethods.plugin')
        if (managementMethod === 'API' || managementMethod === 'REST_API') return t('devices.managementMethods.api')
        return readString(record, ['managementMethod'])
      },
      width: '10%',
    },
    { key: 'managementAddress', title: t('devices.columns.managementAddress'), candidates: ['managementAddress'], width: '12%' },
    { key: 'status', title: t('devices.columns.liveness'), candidates: ['livenessStatus', 'health', 'sourceStatus'], kind: 'status', width: '8%' },
    { key: 'deviceVersion', title: t('devices.columns.deviceVersion'), candidates: ['softwareVersion'], width: '12%', truncate: true },
    { key: 'controlVersion', title: t('devices.columns.controlVersion'), candidates: ['controlVersion'], width: '10%' },
    { key: 'applicationAssetCount', title: t('devices.columns.sites'), candidates: ['applicationAssetCount'], kind: 'count', width: '5%' },
    { key: 'actions', title: t('devices.columns.actions'), candidates: [], width: '12%' },
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
      { label: t('devices.categories.cloud'), value: 'CLOUD' },
    ] },
    { key: 'managementMethod', label: t('devices.filters.managementMethod'), type: 'select', options: [
      { label: t('devices.managementMethods.agent'), value: 'AGENT' },
      { label: t('devices.managementMethods.api'), value: 'API' },
      { label: t('devices.managementMethods.plugin'), value: 'PLUGIN' },
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
    return loadUnifiedAssets()
  },
  actions: [],
  rowActions: [{
    label: t('devices.actions.detail'), permission: 'host.read', reloadAfterRun: false, hidden: isCloudServiceRow, run: openDetail,
  }, {
    label: t('devices.actions.operation'), permission: 'host.read', reloadAfterRun: false, hidden: isCloudServiceRow,
    menu: [{
      label: t('devices.actions.edit'), permission: 'application.device.update', reloadAfterRun: false, run: async (row) => { openEdit(row) },
    }, {
      label: t('devices.actions.delete'), permission: 'host.delete', danger: true, confirmText: 'DELETE',
      riskText: t('devices.detail.deleteImpact'), run: deleteDevice,
    }, {
      label: t('devices.actions.upgrade'), permission: 'host.update', reloadAfterRun: true,
      hidden: (row) => row.raw.upgradeAvailable !== true || !String(row.raw.agentId ?? '').trim(),
      run: upgradeAgent,
    }],
  }],
}))
</script>

<template>
  <section class="gc-page devices-page">
    <BusinessResourcePage :key="reloadKey" :config="config">
      <template #cell-status="{ row }">
        <GcStatusTag :status="String(row.status)" />
      </template>
      <template #cell-deviceVersion="{ row }">
        <span>{{ row.deviceVersion }}</span>
      </template>
      <template #cell-controlVersion="{ row }">
        <span class="devices-page__control-version">
          <span>{{ row.controlVersion }}</span>
          <GcStatusTag
            v-if="row.raw.upgradeAvailable"
            status="available"
            :label="t('devices.actions.upgradeNew')"
            tone="success"
          />
        </span>
      </template>
    </BusinessResourcePage>
    <DeviceOnboardingWizard v-model:open="onboardingOpen" @completed="reloadKey += 1" />
    <DeviceAssetEditModal v-model:open="editOpen" :device-id="editDeviceId" @completed="reloadKey += 1" />
    <ManagedDeviceDetailModal ref="deviceDetailModal" />
    <GcModal
      v-model:open="upgradeConfirmationOpen"
      size="sm"
      :title="t('devices.upgrade.confirmTitle')"
      :description="t('devices.upgrade.confirmDescription')"
      :busy="upgradeConfirmationBusy"
      :error="upgradeConfirmationError"
      @update:open="(open) => { if (!open) closeUpgradeConfirmation() }"
    >
      <div v-if="upgradeConfirmation" class="devices-page__upgrade-confirmation">
        <div class="devices-page__upgrade-target">
          <span class="devices-page__upgrade-label">{{ t('devices.upgrade.fields.target') }}</span>
          <strong>{{ upgradeConfirmation.displayName }}</strong>
        </div>
        <dl class="devices-page__upgrade-versions">
          <div>
            <dt>{{ t('devices.upgrade.fields.currentVersion') }}</dt>
            <dd>{{ upgradeConfirmation.currentVersion }}</dd>
          </div>
          <div>
            <dt>{{ t('devices.upgrade.fields.targetVersion') }}</dt>
            <dd class="devices-page__upgrade-target-version">{{ upgradeConfirmation.targetVersion }}</dd>
          </div>
        </dl>
        <p class="devices-page__upgrade-notice">{{ t('devices.upgrade.notice') }}</p>
      </div>
      <template #actions>
        <GcButton variant="secondary" :disabled="upgradeConfirmationBusy" @click="closeUpgradeConfirmation">
          {{ t('devices.actions.cancel') }}
        </GcButton>
        <GcButton variant="primary" :loading="upgradeConfirmationBusy" @click="confirmAgentUpgrade">
          {{ t('devices.upgrade.confirmAction') }}
        </GcButton>
      </template>
    </GcModal>
  </section>
</template>

<style scoped>
.devices-page {
  display: grid;
  gap: var(--gc-space-3);
}

.devices-page :deep(.business-page__row-actions) {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  min-width: max-content;
  white-space: nowrap;
}

.devices-page :deep(.business-page__row-actions > *) {
  flex: 0 0 auto;
  min-width: max-content;
  white-space: nowrap;
  overflow-wrap: normal;
}

.devices-page__control-version {
  display: inline-flex;
  align-items: center;
  gap: var(--gc-space-1);
  max-width: 100%;
  white-space: nowrap;
}

.devices-page__upgrade-confirmation {
  display: grid;
  gap: var(--gc-space-4);
}

.devices-page__upgrade-target {
  display: grid;
  gap: var(--gc-space-1);
  padding: var(--gc-space-3);
  background: var(--gc-color-surface-soft);
  border: var(--gc-space-hairline) solid var(--gc-color-border);
  border-radius: var(--gc-radius-card);
}

.devices-page__upgrade-label,
.devices-page__upgrade-versions dt {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-caption);
}

.devices-page__upgrade-versions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gc-space-3);
  margin: 0;
}

.devices-page__upgrade-versions div {
  display: grid;
  gap: var(--gc-space-1);
  min-width: 0;
}

.devices-page__upgrade-versions dd {
  margin: 0;
  color: var(--gc-color-text-strong);
  font-weight: var(--gc-font-weight-semibold);
  overflow-wrap: anywhere;
}

.devices-page__upgrade-target-version {
  color: var(--gc-color-success) !important;
}

.devices-page__upgrade-notice {
  margin: 0;
  color: var(--gc-color-text-muted);
  line-height: var(--gc-line-height-relaxed);
}

@media (max-width: 640px) {
  .devices-page__upgrade-versions {
    grid-template-columns: 1fr;
  }
}
</style>
